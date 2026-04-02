/**
 * call-brain-do/src/index.ts — v3.0.0-bella-v2
 * CallBrainDO: Durable Object HTTP handler.
 *
 * V2 controller loop (stepBella pattern):
 *   - Deterministic stage progression via buildStageDirective
 *   - ROI calculators called by controller, not by directive builder
 *   - Question budget tracking via questionCounts
 *   - Force-advance via shouldForceAdvance / maxQuestionsReached
 *   - WOW uses WowStepId enum, not numeric stalls
 *
 * Routes:
 *   POST /turn   — hot path: extract → control → directive → response
 *   POST /event  — all other BrainEvents (session_init, intel, llm_reply_done, call_end)
 *   POST /notes  — scribe note ingestion (background, inferred confidence)
 *   GET  /state  — debug/shadow-mode state snapshot
 */

import type {
  Env,
  BrainEvent,
  ConversationState,
  StageId,
  WowStepId,
  StageDirective,
  MergedIntel,
  CoreAgent,
  AnyAgent,
  MemoryCategory,
  MemoryNote,
  TranscriptEntry,
  ComplianceLogEntry,
} from './types';

import { CRITICAL_STAGES } from './types';
import { runLlmJudge } from './compliance';

import {
  initState,
  loadState,
  persistState,
  exportMemoryToKV,
  importMemoryFromKV,
  mergeImportedMemory,
  exportCompatToKV,
} from './state';
import { extractFromTranscript, applyExtraction, appendTranscript, extractBellaMemoryNotes, commitmentKey, prescanForEarlyROI, inferAcvMultiplier } from './extract';
import { geminiExtract, geminiExtractHistory } from './gemini-extract';
import { deterministicExtract } from './deterministic-extract';
import { mergeIntel, initQueueFromIntel, deepMerge } from './intel';
import { buildStageDirective, buildCriticalFacts, buildContextNotes } from './moves';
import { deriveEligibility, maxQuestionsReached } from './gate';
import {
  processFlow,
  tryRunCalculator,
  buildMergedIntel,
  resolveDeliveryCompleted,
  resolveDeliveryBargedIn,
  resolveDeliveryFailed,
  resolveDeliveryTimeout,
} from './flow';
import { DELIVERY_TIMEOUT_MS } from './flow-constants';

// ─── Constants ──────────────────────────────────────────────────────────────

const VERSION = 'v6.5.1-rec-opener-source';

// ─── WOW step ordering ─────────────────────────────────────────────────────

const WOW_STEP_ORDER: WowStepId[] = [
  'wow_1_research_intro',
  'wow_2_reputation_trial',
  'wow_3_icp_problem_solution',
  'wow_4_conversion_action',
  'wow_5_alignment_bridge',
  'wow_6_scraped_observation',
  'wow_7_explore_or_recommend',
  'wow_8_source_check',
];

function wowStepToNumber(step: WowStepId | null | undefined): number {
  if (!step) return 0;
  const idx = WOW_STEP_ORDER.indexOf(step);
  return idx >= 0 ? idx + 1 : 0;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function shouldApplyVersion(next: number, current?: number): boolean {
  return current == null || next > current;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── V2 extraction targets per stage ────────────────────────────────────────

function extractTargetsForStage(stage: StageId, wowStep?: WowStepId | null): string[] {
  switch (stage) {
    case 'greeting':              return [];
    case 'wow': {
      if (wowStep === 'wow_8_source_check') {
        return ['leadSourceDominant', 'adsConfirmed', 'websiteRelevant', 'phoneRelevant', '_just_demo'];
      }
      return ['_just_demo'];
    }
    case 'recommendation':        return ['proceedToROI'];
    case 'anchor_acv':            return ['acv'];
    case 'ch_alex':               return ['inboundLeads', 'inboundConversions', 'inboundConversionRate', 'responseSpeedBand'];
    case 'ch_chris':              return ['webLeads', 'webConversions', 'webConversionRate'];
    case 'ch_maddie':             return ['phoneVolume', 'missedCalls', 'missedCallRate'];
    case 'ch_sarah':              return ['oldLeads'];
    case 'ch_james':              return ['newCustomersPerWeek', 'currentStars', 'hasReviewSystem'];
    case 'roi_delivery':          return [];
    case 'optional_side_agents':  return [];
    case 'close':                 return ['closeChoice', 'agentRequested', 'trialEmail'];
  }
}

// ─── Active Memory Context Builder ──────────────────────────────────────────

/** Common leading filler words to strip from memory text before injection. */
const FILLER_PREFIX = /^(yeah|yep|yes|yup|nah|no|um+|uh+|ah+|oh+|so|like|well|look|okay|ok|right|sure)[,.\s]+/i;

/**
 * Normalize raw memory note text for voice-safe prompt injection.
 * Returns null if the cleaned text is too short to be useful (<8 chars).
 */
function normalizeMemoryLineText(text: string): string | null {
  let s = text.trim();
  // Strip leading filler (may need multiple passes for "yeah so like...")
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s.replace(FILLER_PREFIX, '');
    if (s === before) break;
  }
  // Collapse repeated whitespace
  s = s.replace(/\s+/g, ' ').trim();
  // Capitalise first letter after cleanup
  if (s.length > 0) s = s.charAt(0).toUpperCase() + s.slice(1);
  return s.length >= 8 ? s : null;
}

/**
 * Truncate a string to maxLen on a word boundary.
 * Appends "..." only if truncation occurred.
 * Falls back to hard cut if no whitespace exists.
 */
function truncateOnWordBoundary(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const cutRegion = text.slice(0, maxLen - 2); // leave room for "..."
  const lastSpace = cutRegion.lastIndexOf(' ');
  const breakAt = lastSpace > maxLen * 0.4 ? lastSpace : maxLen - 3;
  return text.slice(0, breakAt).trimEnd() + '...';
}

/** Stage-aware category boosts: which memory categories matter most per stage. */
const STAGE_BOOSTS: Partial<Record<StageId, MemoryCategory[]>> = {
  ch_alex: ['roi_context', 'business_context'],
  ch_chris: ['roi_context', 'business_context'],
  ch_maddie: ['roi_context', 'business_context'],
  close: ['objection', 'constraint'],
  wow: ['personal', 'relationship'],
};

/**
 * Select and format active memory notes for injection into the runtime prompt.
 * Controller decides what's relevant — bridge only renders.
 * Returns max 10 compact lines (each ≤80 chars).
 *
 * Hygiene gates:
 *  - status === 'active' only
 *  - category !== 'other' for facts (low-signal catch-all excluded)
 *  - normalizeMemoryLineText must return non-null (≥8 chars after filler strip)
 *  - truncation on word boundary (no mid-word cuts)
 *
 * Confidence ranking: stated notes outrank inferred at same salience.
 * Inferred notes (salience 1) fill remaining slots after stated notes.
 */
function buildActiveMemoryContext(
  state: ConversationState,
  stage: StageId,
): string[] {
  const active = state.memoryNotes.filter(
    n => n.status === 'active',
  );
  if (active.length === 0) return [];

  // Split into commitments (always priority, stated only) and facts (exclude 'other' category)
  const commitments: MemoryNote[] = [];
  const facts: MemoryNote[] = [];
  for (const note of active) {
    if (note.category === 'commitment' && note.confidence === 'stated') {
      commitments.push(note);
    } else if (note.category !== 'other' && note.category !== 'commitment') {
      facts.push(note);
    }
  }

  // Sort commitments: most recent first
  commitments.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // Sort facts: confidence rank (stated=2, inferred=1), then salience desc, then recency desc
  facts.sort((a, b) => {
    const ca = a.confidence === 'stated' ? 2 : 1;
    const cb = b.confidence === 'stated' ? 2 : 1;
    if (cb !== ca) return cb - ca;
    const sa = a.salience ?? 2;
    const sb = b.salience ?? 2;
    if (sb !== sa) return sb - sa;
    return b.createdAt.localeCompare(a.createdAt);
  });

  // Stage-aware boost: move matching categories to front of facts
  const boostSet = new Set(STAGE_BOOSTS[stage] ?? []);
  if (boostSet.size > 0) {
    const boosted: MemoryNote[] = [];
    const rest: MemoryNote[] = [];
    for (const f of facts) {
      if (boostSet.has(f.category)) {
        boosted.push(f);
      } else {
        rest.push(f);
      }
    }
    facts.length = 0;
    facts.push(...boosted, ...rest);
  }

  // Take up to 3 commitments + up to 7 facts = max 10
  // Apply text normalization — skip notes that don't pass hygiene
  const lines: string[] = [];

  let commitSlots = 0;
  for (const c of commitments) {
    if (commitSlots >= 3) break;
    const cleaned = normalizeMemoryLineText(c.text);
    if (!cleaned) continue;
    const line = `[BELLA COMMITTED] ${cleaned}`;
    lines.push(truncateOnWordBoundary(line, 80));
    commitSlots++;
  }

  let factSlots = 0;
  let statedFacts = 0;
  let inferredFacts = 0;
  const maxFacts = 10 - commitSlots;
  for (const f of facts) {
    if (factSlots >= maxFacts) break;
    const cleaned = normalizeMemoryLineText(f.text);
    if (!cleaned) continue;
    const label = f.category.toUpperCase().replace(/_/g, ' ');
    const line = `[${label}] ${cleaned}`;
    lines.push(truncateOnWordBoundary(line, 80));
    factSlots++;
    if (f.confidence === 'stated') statedFacts++;
    else inferredFacts++;
  }

  if (inferredFacts > 0) {
    console.log(`[ACTIVE_MEMORY] stage=${stage} commits=${commitSlots} stated=${statedFacts} inferred=${inferredFacts}`);
  }

  return lines;
}

// ─── Compliance: extract key phrases from directive speak text ───────────────

/** Filler openers to skip when extracting key phrases. */
const FILLER_OPENERS = /^(so|and|but|now|well|okay|ok|right|great|yeah|yes|no|alright|absolutely|definitely|sure|perfect|exactly|look)\b/i;

/**
 * Extract 1-5 high-signal phrases from directive speak text for compliance checking.
 * Returns empty array for empty/short text (<20 chars) — caller must not check compliance.
 * Pure function — no side effects.
 */
function extractKeyPhrases(speakText: string): string[] {
  if (!speakText || speakText.length < 20) return [];

  // Split on sentence boundaries
  const sentences = speakText.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length >= 10);
  if (sentences.length === 0) return [];

  const phrases: string[] = [];

  for (const sentence of sentences) {
    if (phrases.length >= 5) break;

    // Strip filler opener
    const cleaned = sentence.replace(FILLER_OPENERS, '').trim();
    if (cleaned.length < 10) continue;

    // Extract a 3-6 word window from the middle-to-start of the sentence
    const words = cleaned.split(/\s+/);
    if (words.length < 3) continue;

    // Take first 3-5 substantive words as the phrase
    const windowSize = Math.min(5, words.length);
    const phrase = words.slice(0, windowSize).join(' ');

    // Skip if too short or too generic
    if (phrase.length < 8) continue;

    phrases.push(phrase);
  }

  return phrases;
}

// ─── Map StageDirective to bridge-compat packet ─────────────────────────────

function directiveToPacket(
  directive: StageDirective,
  state: ConversationState,
  moveId?: string,
): Record<string, any> {
  const coreAgents: CoreAgent[] = ['alex', 'chris', 'maddie'];
  const coreResults = Object.entries(state.calculatorResults)
    .filter(([k, v]) => v != null && coreAgents.includes(k as CoreAgent));

  const criticalFacts = buildCriticalFacts(state);
  const contextNotes = buildContextNotes(state.currentStage, state);

  // Persist for /debug observability (FIX 5)
  state.lastCriticalFacts = criticalFacts;
  state.lastContextNotes = contextNotes;

  return {
    stage: state.currentStage,
    wowStall: state.currentStage === 'wow' ? wowStepToNumber(state.currentWowStep) : null,
    objective: directive.objective,
    chosenMove: {
      // Sprint 1A: use semantic moveId from processFlow when provided (includes _synthesis suffix)
      // Falls back to flat pattern for session_init and other non-flow paths.
      id: moveId ?? `v2_${state.currentStage}${state.currentWowStep ? '_' + state.currentWowStep : ''}`,
      kind: directive.ask ? 'question' : directive.calculatorKey ? 'roi' : 'bridge',
      text: directive.speak,
    },
    criticalFacts,
    contextNotes,
    extractTargets: directive.extract ?? [],
    validation: {
      mustCaptureAny: directive.extract ?? [],
      advanceOnlyIf: directive.advanceOn ?? [],
      doNotAdvanceIf: [],
    },
    style: {
      tone: state.industryLanguage.tone,
      industryTerms: state.industryLanguage.examples.slice(0, 3),
      maxSentences: 3,
      noApology: true,
    },
    ...(coreResults.length > 0 ? {
      roi: {
        agentValues: Object.fromEntries(coreResults.map(([k, v]) => [k, v!.weeklyValue])),
        totalValue: coreResults.reduce((sum, [_, v]) => sum + v!.weeklyValue, 0),
      },
    } : {}),
    // Sarah pool value: separate from recurring roi.totalValue (one-time dormant-database value, not weekly)
    ...(state.calculatorResults.sarah ? {
      sarahPoolValue: state.calculatorResults.sarah.weeklyValue,
    } : {}),
    activeMemory: buildActiveMemoryContext(state, state.currentStage),
    ...(Object.keys(state.detectedInputUnits).length > 0 ? {
      detectedInputUnits: state.detectedInputUnits,
    } : {}),
    // M3: compliance phrases for delivery verification (observability only)
    complianceChecks: {
      mustContainPhrases: extractKeyPhrases(directive.speak),
    },
    // E2A: mandatory flag — bridge must deliver text exactly, no LLM paraphrase
    mandatory: !!(
      state.currentStage === 'roi_delivery' ||
      directive.calculatorKey ||
      (coreResults.length > 0 && directive.speak.includes('$'))
    ),
  };
}

// ─── Scribe note validation & dedup ──────────────────────────────────────────

/** Allowed categories for scribe notes (excludes commitment, roi_context, other) */
const SCRIBE_ALLOWED_CATEGORIES: Set<MemoryCategory> = new Set([
  'preference', 'personal', 'business_context', 'objection',
  'relationship', 'scheduling', 'communication_style', 'constraint',
]);

/** Closed tag allow-list per category */
const SCRIBE_ALLOWED_TAGS: Record<string, Set<string>> = {
  preference: new Set(['channel_preference', 'interest', 'preference']),
  personal: new Set(['family', 'interest', 'sport', 'preference']),
  business_context: new Set([
    'hours', 'peak', 'scope', 'specialty', 'history', 'expansion', 'team_size',
    'voicemail', 'follow_up_method', 'no_follow_up', 'manual_process', 'current_tool',
    'competitor', 'marketing_spend', 'growth_intent',
  ]),
  objection: new Set([
    'past_experience', 'past_failure', 'price', 'aversion', 'disinterest',
    'concern', 'pain_point', 'past_vendor',
  ]),
  relationship: new Set(['staff', 'decision_maker', 'family_staff']),
  scheduling: new Set(['day', 'peak', 'hours']),
  communication_style: new Set(['channel_preference']),
  constraint: new Set(['budget', 'limitation', 'availability', 'scheduling', 'timeline', 'decision_gate']),
};

/** PII patterns — reject notes containing these */
const PII_PATTERN = /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b|\b04\d{2}[-.\s]?\d{3}[-.\s]?\d{3}\b|\b0\d{1}[-.\s]?\d{4}[-.\s]?\d{4}\b|\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b|\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/i;

/** Filler-only check for scribe notes */
const SCRIBE_FILLER = /^((yeah|yep|yes|yup|sure|ok|okay|mm+h?m?|uh\s*huh|right|got\s*it|hmm+|ah+|oh+|cool|nice|alright|sounds?\s*good|go\s*ahead|for\s*sure|no\s*worries)\s*[.,!?]*\s*)+$/i;

/** Common stop words for minimum-word-quality check */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'am',
  'do', 'does', 'did', 'has', 'have', 'had', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'up',
  'out', 'if', 'or', 'and', 'but', 'not', 'no', 'so', 'yet',
  'it', 'its', 'he', 'she', 'we', 'they', 'i', 'me', 'my', 'our',
  'your', 'you', 'that', 'this', 'them', 'their',
]);

interface ValidatedNote {
  text: string;
  category: MemoryCategory;
  tags: string[];
}

function validateScribeNote(raw: unknown): { rejected: boolean; reason?: string; note?: ValidatedNote } {
  if (!raw || typeof raw !== 'object') return { rejected: true, reason: 'invalid_shape' };

  const obj = raw as Record<string, unknown>;
  const text = typeof obj.text === 'string' ? obj.text.trim() : '';
  const category = typeof obj.category === 'string' ? obj.category : '';
  const tags = Array.isArray(obj.tags) ? obj.tags.filter((t): t is string => typeof t === 'string') : [];

  // Length check
  if (text.length < 15) return { rejected: true, reason: 'too_short' };
  if (text.length > 200) return { rejected: true, reason: 'too_long' };

  // Word count check (≥2 words)
  const words = text.split(/\s+/);
  if (words.length < 2) return { rejected: true, reason: 'too_few_words' };

  // Quality: at least 1 word ≥4 chars that's not a stop word
  const hasSubstantiveWord = words.some(w => {
    const clean = w.replace(/[^a-zA-Z]/g, '').toLowerCase();
    return clean.length >= 4 && !STOP_WORDS.has(clean);
  });
  if (!hasSubstantiveWord) return { rejected: true, reason: 'no_substantive_word' };

  // Filler check
  if (SCRIBE_FILLER.test(text)) return { rejected: true, reason: 'filler' };

  // PII check
  if (PII_PATTERN.test(text)) return { rejected: true, reason: 'pii_detected' };

  // Category check
  if (!SCRIBE_ALLOWED_CATEGORIES.has(category as MemoryCategory)) {
    return { rejected: true, reason: `disallowed_category:${category}` };
  }

  // Tag check — filter to allowed tags only (silently drop unknown tags)
  const allowedTagSet = SCRIBE_ALLOWED_TAGS[category];
  const validTags = allowedTagSet ? tags.filter(t => allowedTagSet.has(t)) : [];
  if (validTags.length === 0 && tags.length > 0) {
    return { rejected: true, reason: 'no_valid_tags' };
  }

  return {
    rejected: false,
    note: { text, category: category as MemoryCategory, tags: validTags.length > 0 ? validTags : tags },
  };
}

/** Tokenize text into lowercase words for dedup comparison */
function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 0);
}

/** Check if two arrays share 4+ consecutive words */
function hasConsecutiveOverlap(a: string[], b: string[], minLen: number): boolean {
  if (a.length < minLen || b.length < minLen) return false;
  const bStr = ' ' + b.join(' ') + ' ';
  for (let i = 0; i <= a.length - minLen; i++) {
    const seq = ' ' + a.slice(i, i + minLen).join(' ') + ' ';
    if (bStr.includes(seq)) return true;
  }
  return false;
}

/** Jaccard similarity of two word sets */
function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Check if two tag arrays are identical sets */
function identicalTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every(t => setA.has(t));
}

/**
 * Find duplicate in existing notes. Returns reason string if dup found, null if clear.
 * Primary: same category + overlapping tag + 4 consecutive shared words
 * Secondary: same category + identical tag set + Jaccard > 0.8
 */
function findDuplicate(
  incoming: ValidatedNote,
  existing: MemoryNote[],
): string | null {
  const inTokens = tokenize(incoming.text);
  const inTags = incoming.tags;

  for (const ex of existing) {
    if (ex.status !== 'active') continue;
    if (ex.category !== incoming.category) continue;

    const exTags = ex.tags ?? [];

    // Primary: overlapping tag + 4 consecutive words
    const sharedTag = inTags.some(t => exTags.includes(t));
    if (sharedTag) {
      const exTokens = tokenize(ex.text);
      if (hasConsecutiveOverlap(inTokens, exTokens, 4)) {
        return 'consecutive_words';
      }
    }

    // Secondary: identical tags + Jaccard > 0.8
    if (identicalTags(inTags, exTags)) {
      const exTokens = tokenize(ex.text);
      if (jaccard(inTokens, exTokens) > 0.8) {
        return 'jaccard_overlap';
      }
    }
  }

  return null;
}

/** Scope assignment for scribe notes — mirrors extract.ts scopeForCategory */
function scopeForCategory(category: MemoryCategory): 'session' | 'lead' | 'account' {
  switch (category) {
    case 'business_context': return 'account';
    case 'constraint': return 'account';
    case 'scheduling': return 'account';
    case 'relationship': return 'account';
    case 'personal': return 'lead';
    case 'preference': return 'lead';
    case 'communication_style': return 'lead';
    case 'objection': return 'lead';
    case 'commitment': return 'lead';
    case 'roi_context': return 'session';
    case 'other': return 'session';
  }
}

// ─── Durable Object ─────────────────────────────────────────────────────────

export class CallBrainDO {
  private state: DurableObjectState;
  private env: Env;
  private geminiKey: string | null = null;
  /** H1: monotonic counter for stale-write prevention on KV compat exports */
  private _latestExportSeq = 0;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    // Secrets don't appear in DO env — worker injects via header
    if (!this.geminiKey) {
      this.geminiKey = request.headers.get('x-gemini-key') || this.env.GEMINI_API_KEY || null;
    }
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (request.method === 'POST' && path === '/turn') {
        return await this.handleTurn(request);
      }
      if (request.method === 'POST' && path === '/event') {
        return await this.handleEvent(request);
      }
      if (request.method === 'GET' && path === '/state') {
        return await this.handleGetState();
      }
      if (request.method === 'POST' && path === '/notes') {
        return await this.handleNotes(request);
      }
      if (request.method === 'GET' && path === '/debug') {
        return await this.handleDebug(url);
      }

      return json({ error: 'not_found', message: `Unknown route: ${request.method} ${path}` }, 404);
    } catch (err: any) {
      console.error('[CallBrainDO] Unhandled error:', err.message, err.stack);
      return json({ error: 'internal', message: err.message }, 500);
    }
  }

  // ── Idempotent session creation ────────────────────────────────────────────

  private async ensureSession(
    leadId: string,
    starterIntel?: Record<string, unknown>,
  ): Promise<{ brain: ConversationState; created: boolean }> {
    let brain = await loadState(this.state.storage) as ConversationState | null;

    if (!brain) {
      brain = initState(this.state.id.toString(), leadId);

      // ── KV self-hydration: DO reads all intel sources on first session ────
      // Parity with bridge loadMergedIntel() + loadCallBrief().
      // Priority (lowest→highest): stub → deepIntel → deep_flags → intel → fast-intel → call_brief
      // Late-arriving intel (deep-scrape mid-call) still arrives via /event.
      // If KV is empty (scraping not done yet), DO starts with nothing and hydrates when /event fires.
      let kvIntel: Record<string, any> | null = null;
      if (!starterIntel && leadId && leadId !== 'unknown') {
        try {
          const [stubRaw, fastIntelRaw, deepIntelRaw, deepFlagsRaw, intelRaw, callBriefRaw, deepScriptFillsRaw] = await Promise.all([
            this.env.LEADS_KV.get(`lead:${leadId}:stub`, 'json'),
            this.env.LEADS_KV.get(`lead:${leadId}:fast-intel`, 'json'),
            this.env.LEADS_KV.get(`lead:${leadId}:deepIntel`, 'json'),
            this.env.LEADS_KV.get(`lead:${leadId}:deep_flags`, 'json'),
            this.env.LEADS_KV.get(`lead:${leadId}:intel`, 'json'),
            this.env.LEADS_KV.get(`lead:${leadId}:call_brief`, 'json'),
            this.env.LEADS_KV.get(`lead:${leadId}:deep_scriptFills`, 'json'),
          ]) as [Record<string, any> | null, Record<string, any> | null, Record<string, any> | null, Record<string, any> | null, Record<string, any> | null, Record<string, any> | null, Record<string, any> | null];

          const hasSomething = stubRaw || fastIntelRaw || deepIntelRaw || deepFlagsRaw || intelRaw || callBriefRaw || deepScriptFillsRaw;
          if (hasSomething) {
            // Strip fast-intel placeholder deep field (matches bridge behavior)
            if (fastIntelRaw?.deep && Object.keys(fastIntelRaw.deep).length === 1 && fastIntelRaw.deep.status === 'processing') {
              delete fastIntelRaw.deep;
            }

            // deepMerge chain: stub (lowest) → deepIntel → deep_flags → intel → fast-intel (highest)
            let merged: Record<string, any> = {};
            if (stubRaw) merged = deepMerge(merged, stubRaw);
            if (deepIntelRaw) merged = deepMerge(merged, deepIntelRaw);
            if (deepFlagsRaw) merged = deepMerge(merged, deepFlagsRaw);
            if (intelRaw) merged = deepMerge(merged, intelRaw);
            if (fastIntelRaw) merged = deepMerge(merged, fastIntelRaw);

            // Inject deep-scrape structured data at merged.deep (matches bridge deep_flags→intel.deep transform)
            if (deepFlagsRaw && (deepFlagsRaw.google_rating !== undefined || deepFlagsRaw.google_maps || deepFlagsRaw.indeed_count || deepFlagsRaw.google_search_count || deepFlagsRaw.google_ads_transparency_count)) {
              merged.deep = {
                status: 'done',
                googleMaps: {
                  rating: deepFlagsRaw.google_rating ?? null,
                  review_count: deepFlagsRaw.review_count ?? 0,
                  address: deepFlagsRaw.address ?? '',
                  categories: deepFlagsRaw.categories ?? [],
                  reviews_sample: deepFlagsRaw.reviews_sample ?? [],
                  opening_hours: deepFlagsRaw.opening_hours ?? null,
                  phone: deepFlagsRaw.phone ?? null,
                  listed_website: deepFlagsRaw.listed_website ?? null,
                  photos_count: deepFlagsRaw.photos_count ?? 0,
                },
                ads: {
                  fb_ads_count: deepFlagsRaw.fb_ads_count ?? 0,
                  fb_ads_sample: deepFlagsRaw.fb_ads_sample ?? [],
                  is_running_fb_ads: deepFlagsRaw.is_running_fb_ads ?? false,
                  google_search_count: deepFlagsRaw.google_search_count ?? 0,
                  google_search_results: deepFlagsRaw.google_search_results ?? [],
                  google_ads_count: deepFlagsRaw.google_ads_transparency_count ?? 0,
                  is_running_google_ads: deepFlagsRaw.is_running_google_ads ?? false,
                  google_ads_sample: deepFlagsRaw.google_ads_sample ?? [],
                },
                hiring: {
                  is_hiring: (deepFlagsRaw.indeed_count ?? 0) > 0 || (deepFlagsRaw.seek_count ?? 0) > 0,
                  indeed_count: deepFlagsRaw.indeed_count ?? 0,
                  jobs_sample: deepFlagsRaw.jobs_sample ?? [],
                  seek_count: deepFlagsRaw.seek_count ?? 0,
                  seek_sample: deepFlagsRaw.seek_sample ?? [],
                  hiring_agent_matches: deepFlagsRaw.hiring_agent_matches ?? [],
                  top_hiring_wedge: deepFlagsRaw.top_hiring_wedge ?? null,
                },
                linkedin: deepFlagsRaw.linkedin ?? {},
                ad_landing_pages: deepFlagsRaw.ad_landing_pages ?? [],
              };
            } else if (deepIntelRaw && (deepIntelRaw.googleMaps || deepIntelRaw.linkedin || deepIntelRaw.hiring)) {
              merged.deep = { status: 'done', ...deepIntelRaw };
            }

            // Inject deep_scriptFills into merged.deep so moves.ts can access it
            // as state.intel.deep.deep_scriptFills (separate KV key from deep_flags)
            if (deepScriptFillsRaw) {
              if (!merged.deep) merged.deep = { status: 'done' };
              merged.deep.deep_scriptFills = deepScriptFillsRaw;
              console.log(`[KV_HYDRATE_FILLS] lid=${leadId} deepInsights=${deepScriptFillsRaw.deepInsights?.length ?? 0} heroReview=${!!deepScriptFillsRaw.heroReview?.available}`);
            }

            // call_brief takes highest precedence when it has a valid status field
            if (callBriefRaw && callBriefRaw.status) {
              merged = deepMerge(merged, callBriefRaw);
              console.log(`[KV_HYDRATE_BRIEF] lid=${leadId} status=${callBriefRaw.status} keys=${Object.keys(callBriefRaw).length}`);
            }

            kvIntel = merged;
            const sources = [
              stubRaw ? 'stub' : null, fastIntelRaw ? 'fast-intel' : null,
              deepIntelRaw ? 'deepIntel' : null, deepFlagsRaw ? 'deep_flags' : null,
              intelRaw ? 'intel' : null, callBriefRaw ? 'call_brief' : null,
              deepScriptFillsRaw ? 'deep_scriptFills' : null,
            ].filter(Boolean);
            console.log(`[KV_HYDRATE] lid=${leadId} sources=[${sources.join(',')}] consultant=${!!kvIntel.consultant} biz=${(kvIntel.business_name ?? 'none').slice(0, 30)}`);
          } else {
            console.log(`[KV_HYDRATE] lid=${leadId} no intel in KV yet`);
          }
        } catch (err: any) {
          console.error(`[KV_HYDRATE_ERR] lid=${leadId} error=${err.message}`);
        }
      }

      const intelSource = starterIntel ?? kvIntel;
      if (intelSource) {
        const src = intelSource as any;

        // Fast intel: the envelope root IS the fast intel blob
        brain.intel.fast = src;

        // Consultant intel: top-level `consultant` key in the envelope
        if (src.consultant) brain.intel.consultant = src.consultant;

        // Deep intel: top-level `deep` or nested `intel.deep`
        const deepBlob = src.deep ?? src.intel?.deep;
        if (deepBlob) {
          brain.intel.deep = deepBlob;
          // D10+B12: stamp scriptFillsArrived if deep_scriptFills already in KV at init time
          if ((deepBlob as any)?.deep_scriptFills) {
            brain.scriptFillsArrived = true;
            brain.supplementVersion = Date.now();
            brain.supplementUpdatedAt = new Date().toISOString();
            console.log(`[INIT_FILLS] deep_scriptFills present at init deepInsights=${(deepBlob as any).deep_scriptFills?.deepInsights?.length ?? 0} — scriptFillsArrived=true supplementVersion stamped`);
          }
        }

        brain.intel.mergedVersion = 1;

        // Identity — try every known path in the KV envelope
        const ci = src.core_identity ?? {};
        brain.firstName = src.first_name ?? src.firstName ?? ci.first_name ?? brain.firstName;
        brain.business = src.business_name ?? ci.business_name ?? brain.business;
        brain.industry = ci.industry ?? src.industry ?? brain.industry;

        // Eligibility signals from tech_stack and flags
        const ts = src.tech_stack ?? {};
        const flags = src.flags ?? {};
        if (src.websiteExists || ts.has_chat !== undefined || ts.has_booking !== undefined) brain.websiteRelevant = true;
        if (src.phoneVisible) brain.phoneRelevant = true;
        if (flags.is_running_ads || ts.is_running_ads
            || deepFlagsRaw?.is_running_fb_ads
            || deepFlagsRaw?.is_running_google_ads
            || (deepFlagsRaw?.fb_ads_count ?? 0) > 0
            || (deepFlagsRaw?.google_ads_transparency_count ?? 0) > 0) brain.adsConfirmed = true;

        // Seed Places into deep.googleMaps for wow_2 reputation step
        const gm = src.deep?.googleMaps ?? src.places;
        if (gm?.rating) {
          if (!brain.intel.deep) brain.intel.deep = {};
          if (!(brain.intel.deep as any).googleMaps) {
            (brain.intel.deep as any).googleMaps = { rating: gm.rating, review_count: gm.review_count, name: gm.name };
            console.log(`[KV_HYDRATE_PLACES] rating=${gm.rating} reviews=${gm.review_count}`);
          }
        }

        // Build IndustryLanguagePack + eligibility + queue from hydrated intel
        initQueueFromIntel(brain);

        console.log(`[KV_HYDRATE_DONE] source=${starterIntel ? 'caller' : 'kv'} name=${brain.firstName ?? 'none'} biz=${(brain.business ?? 'none').slice(0, 30)} industry=${brain.industry ?? 'none'} consultant=${!!brain.intel.consultant} deep=${!!brain.intel.deep} queue=${brain.currentQueue.length}`);
      }

      // Import cross-call memory from prior sessions (new session only)
      if (leadId && leadId !== 'unknown') {
        try {
          const priorMemory = await importMemoryFromKV(this.env.LEADS_KV, leadId);
          if (priorMemory.length > 0) {
            brain.memoryNotes = mergeImportedMemory(brain.memoryNotes, priorMemory);
            console.log(`[MEMORY_IMPORT] loaded ${priorMemory.length} notes for leadId=${leadId}`);
          }
        } catch (err: any) {
          console.error(`[MEMORY_IMPORT_ERR] leadId=${leadId} error=${err.message}`);
        }
      }

      await persistState(this.state.storage, brain);
      await this.scheduleNextAlarm(brain);
      // DIAG: Intel state at session creation — reveals timing gap between enrichment push and DO init
      console.log(`[INIT] callId=${this.state.id.toString()} leadId=${leadId} stage=${brain.currentStage} ts=${new Date().toISOString()} name=${brain.firstName ?? 'none'} biz=${(brain.business ?? 'none').slice(0, 30)} industry=${brain.industry ?? 'none'}`);
      console.log(`[INIT_INTEL] callId=${this.state.id.toString()} fast=${!!brain.intel.fast} consultant=${!!brain.intel.consultant} deep=${!!(brain.intel.deep as any)?.status} mergedVersion=${brain.intel.mergedVersion} kvSources=${kvIntel ? 'hydrated' : 'empty'}`);
      return { brain, created: true };
    }

    // Defensive: ensure transcriptLog and memoryNotes exist on loaded state (upgrade guard)
    if (!brain.transcriptLog) brain.transcriptLog = [];
    if (!brain.memoryNotes) brain.memoryNotes = [];
    if (!brain.spoken) brain.spoken = { moveIds: [], factsUsed: [] };
    if (!brain.scribeProcessed) brain.scribeProcessed = {};
    if (!brain.complianceLog) brain.complianceLog = [];
    if (!brain.recentUserTranscripts) brain.recentUserTranscripts = [];

    if (!brain.leadId) brain.leadId = leadId;
    if (starterIntel && !brain.intel.fast) {
      brain.intel.fast = starterIntel;
      brain.intel.mergedVersion = Math.max(brain.intel.mergedVersion, 1);
    }
    await persistState(this.state.storage, brain as any);
    console.log(`[ENSURE] existing session — stage=${brain.currentStage} wowStep=${brain.currentWowStep} name=${brain.firstName ?? 'none'} biz=${(brain.business ?? 'none').slice(0, 30)} fast=${!!brain.intel.fast} consultant=${!!brain.intel.consultant} deep=${!!(brain.intel.deep as any)?.status} mergedV=${brain.intel.mergedVersion}`);
    return { brain, created: false };
  }

  // ── POST /turn — V2 control loop ──────────────────────────────────────────

  private async handleTurn(request: Request): Promise<Response> {
    const body = await request.json<{
      leadId?: string;
      transcript: string;
      turnId: string;
      ts?: string;
      identity?: {
        firstName?: string;
        businessName?: string;
        industry?: string;
        supplement?: {
          rating?: number | null;
          reviewCount?: number;
          consultant?: Record<string, any> | null;
          deep?: Record<string, any> | null;
          fast?: Record<string, any> | null;
        };
      };
    }>();

    const { transcript, turnId, leadId } = body;
    const { brain } = await this.ensureSession(leadId ?? 'unknown');

    // ── Dedup by turnId (catches near-duplicate transcripts from voice retries) ──
    // Moved BEFORE identity population and extraction for efficiency (H1).
    const cleanTranscript = (transcript || '').trim();
    const cacheKey = `turn:${turnId}`;

    const cached = await this.state.storage.get<any>(cacheKey);
    if (cached) {
      console.log(`[DEDUP] turnId=${turnId} — returning cached packet`);
      return json({ ...cached, dedup: true });
    }

    // Populate identity from bridge-forwarded fields (bridge loads KV before /turn)
    if (body.identity) {
      const id = body.identity;
      if (id.firstName && !brain.firstName) brain.firstName = id.firstName;
      if (id.businessName && !brain.business) brain.business = id.businessName;
      if (id.industry && !brain.industry) brain.industry = id.industry;

      // Late-bind supplement: bridge provides merged KV data that may not have arrived via DO events
      if (id.supplement) {
        const s = id.supplement;
        // Rating seed for wow_2 — bridge reads star_rating from :intel (big scraper)
        if (s.rating && !(brain.intel.deep as any)?.googleMaps?.rating) {
          if (!brain.intel.deep) brain.intel.deep = {};
          (brain.intel.deep as any).googleMaps = {
            rating: s.rating,
            review_count: s.reviewCount ?? 0,
          };
          console.log(`[SUPPLEMENT_SEED] rating=${s.rating} reviews=${s.reviewCount ?? 0} source=bridge`);
        }
        // Consultant seed — full merge: bridge sends entire consultant object from KV.
        // Write each top-level key only if missing in existing data.
        // Previous version cherry-picked scriptFills/routing/etc but MISSED
        // conversionEventAnalysis (wow_4) and icpAnalysis (wow_3).
        if (s.consultant && typeof s.consultant === 'object' && Object.keys(s.consultant).length > 0) {
          if (!brain.intel.consultant) brain.intel.consultant = {};
          const existing = brain.intel.consultant as any;
          let seeded = 0;

          for (const [key, val] of Object.entries(s.consultant as Record<string, any>)) {
            if (val == null) continue;
            if (key === 'scriptFills' && typeof val === 'object') {
              // Merge scriptFills granularly — new fills fill gaps, don't overwrite
              if (!existing.scriptFills) existing.scriptFills = {};
              for (const [fk, fv] of Object.entries(val)) {
                if (fv != null && existing.scriptFills[fk] == null) {
                  existing.scriptFills[fk] = fv;
                  seeded++;
                }
              }
            } else if (existing[key] == null) {
              existing[key] = val;
              seeded++;
            }
          }

          if (seeded > 0) {
            brain.intel.mergedVersion++;
            const keys = Object.keys(s.consultant).filter(k => (s.consultant as any)[k] != null);
            console.log(`[SUPPLEMENT_SEED] consultant seeded=${seeded} keys=[${keys.join(',')}] source=bridge`);
          }
        }

        // Deep intel seed — bridge forwards completed deep-scrape data
        if (s.deep && typeof s.deep === 'object' && s.deep.status === 'done') {
          const existingDeepStatus = (brain.intel.deep as any)?.status;
          if (existingDeepStatus !== 'done') {
            mergeIntel(brain, {
              type: 'deep_ready',
              payload: s.deep,
              version: Date.now(),
            });
            console.log(`[SUPPLEMENT_SEED] deep_intel seeded googleMaps=${!!(s.deep as any).googleMaps} hiring=${!!(s.deep as any).hiring} source=bridge`);
          }
          // Lazy-load deep_scriptFills from KV if not yet in state
          // (supplement fires when deep-scrape completes mid-call — scriptFills may have arrived by now)
          if (!(brain.intel.deep as any)?.deep_scriptFills && brain.leadId && brain.leadId !== 'unknown') {
            try {
              const fills = await this.env.LEADS_KV.get(`lead:${brain.leadId}:deep_scriptFills`, 'json') as any;
              if (fills) {
                if (!brain.intel.deep) brain.intel.deep = { status: 'done' };
                (brain.intel.deep as any).deep_scriptFills = fills;
                // D10+B12: stamp scriptFillsArrived + supplementVersion when fills arrive via supplement
                brain.scriptFillsArrived = true;
                brain.supplementVersion = Date.now();
                brain.supplementUpdatedAt = new Date().toISOString();
                console.log(`[SUPPLEMENT_SEED] deep_scriptFills seeded deepInsights=${fills.deepInsights?.length ?? 0} heroReview=${!!fills.heroReview?.available} source=kv_lazy_load scriptFillsArrived=true supplementVersion=${brain.supplementVersion}`);
              }
            } catch (_) {}
          }
        }

        // Fast intel seed — bridge forwards core fast-intel fields
        if (s.fast && typeof s.fast === 'object' && !brain.intel.fast) {
          mergeIntel(brain, {
            type: 'fast_intel_ready',
            payload: s.fast,
            version: Date.now(),
          });
          console.log(`[SUPPLEMENT_SEED] fast_intel seeded biz=${((s.fast as any).core_identity?.business_name ?? 'none').slice(0, 40)} source=bridge`);
        }

        // D10+B12: Unconditional scriptFills probe — fires on any supplement, even if s.deep is absent.
        // Covers the case where bridge sends supplement without deep field but scriptFills landed in KV.
        if (!brain.scriptFillsArrived && !(brain.intel.deep as any)?.deep_scriptFills && brain.leadId && brain.leadId !== 'unknown') {
          try {
            const fills = await this.env.LEADS_KV.get(`lead:${brain.leadId}:deep_scriptFills`, 'json') as any;
            if (fills) {
              if (!brain.intel.deep) brain.intel.deep = { status: 'done' };
              (brain.intel.deep as any).deep_scriptFills = fills;
              brain.scriptFillsArrived = true;
              brain.supplementVersion = Date.now();
              brain.supplementUpdatedAt = new Date().toISOString();
              console.log(`[SUPPLEMENT_SEED] deep_scriptFills seeded via unconditional probe deepInsights=${fills.deepInsights?.length ?? 0} source=kv_unconditional scriptFillsArrived=true`);
            }
          } catch (_) {}
        }
      }
    }

    // ── 0. Rolling transcript buffer — maintain last 12 user utterances ──
    brain.recentUserTranscripts = brain.recentUserTranscripts || [];
    brain.recentUserTranscripts.push(cleanTranscript);
    if (brain.recentUserTranscripts.length > 12) {
      brain.recentUserTranscripts = brain.recentUserTranscripts.slice(-12);
    }

    // ── 1. Extract from transcript — Deterministic > Gemini > Regex ──
    const v2Targets = extractTargetsForStage(brain.currentStage, brain.currentWowStep);

    // ── 1a. Deterministic extraction — runs FIRST, no LLM needed, <1ms ──
    const deterministicResult = deterministicExtract(cleanTranscript, brain.currentStage);
    if (Object.keys(deterministicResult).length > 0) {
      console.log(`[EXTRACT] source=deterministic stage=${brain.currentStage} fields=[${Object.keys(deterministicResult).join(',')}]`);
    }

    // ── 1b. Also extract from rolling buffer to catch missed/errored turns ──
    const bufferText = brain.recentUserTranscripts.join('. ');
    const bufferDeterministic = deterministicExtract(bufferText, brain.currentStage);
    // Only use buffer results for fields that are STILL null in state AND not in current deterministic
    for (const [k, v] of Object.entries(bufferDeterministic)) {
      if (v != null && (brain as any)[k] == null && deterministicResult[k] == null) {
        (brain as any)[k] = v;
        console.log(`[EXTRACT] source=buffer-deterministic field=${k} value=${v}`);
      }
    }

    // Gemini key: prefer env, fall back to header injected by fetch handler
    const geminiKey = this.geminiKey;

    // ── 1c. Gemini extraction — demoted to fallback for fields deterministic missed ──
    let geminiResult: Awaited<ReturnType<typeof geminiExtract>> = null;
    if (geminiKey && cleanTranscript.length > 2) {
      try {
        geminiResult = await geminiExtract(cleanTranscript, brain.currentStage, brain.currentWowStep, geminiKey);
      } catch (err: any) {
        console.warn(`[GEMINI_EXTRACT_CATCH] ${err.message}`);
      }
    }

    // ── 1d. Regex — always runs, provides memory notes + final fallback ──
    const regexResult = extractFromTranscript(cleanTranscript, v2Targets, brain.currentStage, brain.industryLanguage?.industryLabel, brain);

    // ── 1e. Merge: deterministic > gemini > regex ──
    // Deterministic is trusted (rules-based, no LLM hallucination).
    // Gemini fills gaps deterministic missed. Regex provides memory notes + final fallback.
    const result = regexResult;
    const geminiFieldFlags: Record<string, boolean> = {};
    if (geminiResult && Object.keys(geminiResult.fields).length > 0) {
      for (const k of Object.keys(geminiResult.fields)) geminiFieldFlags[k] = true;
    }
    // Build merged fields with correct priority
    const mergedFields = {
      ...regexResult.fields,                          // lowest priority: regex
      ...(geminiResult?.fields ?? {}),                // middle priority: gemini
      ...deterministicResult,                          // highest priority: deterministic (trusted)
      _geminiFields: geminiFieldFlags as any,
    };
    result.fields = mergedFields;
    if (geminiResult?.correctionDetected) result.correctionDetected = true;

    // Log extraction sources
    const detKeys = Object.keys(deterministicResult);
    const gemKeys = geminiResult ? Object.keys(geminiResult.fields) : [];
    const regKeys = Object.keys(regexResult.fields).filter(k => !k.startsWith('_'));
    console.log(`[EXTRACT] stage=${brain.currentStage} det=[${detKeys.join(',')}] gemini=[${gemKeys.join(',')}]${geminiResult ? ` ms=${geminiResult.latencyMs}` : ''} regex=[${regKeys.join(',')}]`);

    // ── 1a-post. ACV industry multiplier (ported from bridge monolith) ──
    // Gemini returns literal parses for ambiguous values: "two fifty"→250, "five hundred"→500.
    // Apply industry multiplier when value is in ambiguous range AND no explicit unit keyword in transcript.
    const rawAcv = result.fields.acv;
    if (
      typeof rawAcv === 'number' && rawAcv >= 50 && rawAcv <= 999 &&
      !/\b(k|thousand|grand|hundred\s*thousand|million|mil)\b/i.test(cleanTranscript) &&
      brain.industryLanguage?.industryLabel &&
      brain.industryLanguage.industryLabel !== 'business'
    ) {
      const mult = inferAcvMultiplier(brain.industryLanguage.industryLabel);
      if (mult > 1) {
        result.fields.acv = rawAcv * mult;
        console.log(`[ACV_MULTIPLIER] raw=${rawAcv} industry=${brain.industryLanguage.industryLabel} multiplier=${mult} adjusted=${result.fields.acv}`);
      }
    }

    const applied = applyExtraction(brain, result);

    // ── 1b. Log transcript ──
    appendTranscript(brain, {
      role: 'user',
      text: cleanTranscript,
      turnId,
      ts: new Date().toISOString(),
    });

    console.log(`[TURN] turnId=${turnId} stage=${brain.currentStage} wowStep=${brain.currentWowStep} extracted=[${applied.join(',')}]`);

    // ── 2. Refresh eligibility ──
    const intel = buildMergedIntel(brain);
    const eligibility = deriveEligibility(intel, brain);
    brain.alexEligible = eligibility.alexEligible;
    brain.chrisEligible = eligibility.chrisEligible;
    brain.maddieEligible = eligibility.maddieEligible;
    brain.whyRecommended = eligibility.whyRecommended;

    // ── 3. FLOW HARNESS ──
    const flowResult = processFlow(brain, intel, cleanTranscript, turnId, Date.now());
    const advanced = flowResult.advanced;
    let directive = flowResult.directive;

    // ── 3b. POST-ADVANCE RE-EXTRACTION ────────────────────────────────────
    // When processFlow advances into a channel stage, re-extract from recent
    // user transcript history with the NEW stage's targets. Only targets the
    // PRIMARY field for each channel (lead volume, not conversions) to avoid
    // spurious matches from historical context.
    if (advanced && ['ch_alex', 'ch_chris', 'ch_maddie', 'ch_sarah', 'ch_james'].includes(brain.currentStage)) {
      const userTurns = (brain.transcriptLog || [])
        .filter((t: TranscriptEntry) => t.role === 'user')
        .slice(-8);
      // Drop the LAST user turn — it triggered the advance and was already processed
      // by the previous stage. Including it causes ACV answers to be captured as leads.
      if (userTurns.length > 1) userTurns.pop();
      const historicalText = userTurns.map((t: TranscriptEntry) => t.text).join('. ');

      if (historicalText.length > 5) {
        // 1. GEMINI PRIMARY — all-fields schema on historical text
        let historyGemini: Awaited<ReturnType<typeof geminiExtractHistory>> = null;
        if (geminiKey) {
          try {
            historyGemini = await geminiExtractHistory(historicalText, geminiKey);
          } catch (err: any) {
            console.warn(`[RE_EXTRACT_GEMINI_ERR] ${err.message}`);
          }
        }

        // 2. DETERMINISTIC EXTRACTION on historical text (Sprint E1)
        const historyDeterministic = deterministicExtract(historicalText, brain.currentStage);

        // 3. REGEX FALLBACK — ALL relevant targets per channel (Sprint E1: expanded)
        const primaryTargets: Record<string, string[]> = {
          ch_alex: ['inboundLeads', 'responseSpeedBand', 'inboundConversions', 'inboundConversionRate'],
          ch_chris: ['webLeads', 'webConversions', 'webConversionRate'],
          ch_maddie: ['phoneVolume', 'missedCalls', 'missedCallRate'],
          ch_sarah: ['oldLeads'],
          ch_james: ['newCustomersPerWeek', 'currentStars', 'hasReviewSystem'],
        };
        const reTargets = primaryTargets[brain.currentStage] ?? extractTargetsForStage(brain.currentStage, brain.currentWowStep);
        const reRegexResult = extractFromTranscript(
          historicalText, reTargets, brain.currentStage,
          brain.industryLanguage?.industryLabel, brain,
        );

        // 4. PRESCAN REGEX FALLBACK — keyword-aware cross-stage patterns
        //    (absorbed from flow.ts prescanForEarlyROI calls)
        const prescanFields = prescanForEarlyROI(brain);

        // 5. MERGE — deterministic > gemini > regex (same priority as /turn)
        //    prescanFields already wrote directly to state (write-once to null fields)
        const captured: string[] = [...prescanFields];

        // Apply deterministic fields first (highest priority, trusted)
        for (const [k, v] of Object.entries(historyDeterministic)) {
          if (v != null && (brain as any)[k] == null) {
            (brain as any)[k] = v;
            captured.push(`${k}=${v}(det-history)`);
          }
        }

        // Apply Gemini fields to remaining null state fields
        if (historyGemini && Object.keys(historyGemini.fields).length > 0) {
          for (const [k, v] of Object.entries(historyGemini.fields)) {
            if (v != null && (brain as any)[k] == null) {
              (brain as any)[k] = v;
              captured.push(`${k}=${v}`);
            }
          }
          console.log(`[RE_EXTRACT] source=gemini fields=[${Object.keys(historyGemini.fields).filter(k => historyGemini!.fields[k] != null).join(',')}] ms=${historyGemini.latencyMs}`);
        }

        // Apply regex fields to remaining null fields (lowest priority fallback)
        for (const [k, v] of Object.entries(reRegexResult.fields)) {
          if (k.startsWith('_')) continue;
          if (v != null && (brain as any)[k] == null) {
            (brain as any)[k] = v;
            captured.push(`${k}=${v}`);
          }
        }

        if (captured.length > 0) {
          console.log(`[RE_EXTRACT] post-advance to ${brain.currentStage} captured=[${captured.join(',')}]`);
          // Rebuild directive with captured data so Bella asks the NEXT question
          directive = buildStageDirective({
            stage: brain.currentStage,
            wowStep: brain.currentWowStep,
            intel,
            state: brain,
          });
          // Update pending delivery to match rebuilt directive
          if (brain.pendingDelivery) {
            brain.pendingDelivery.waitForUser = directive.waitForUser;
          }
        }
      }
    }

    // ── 4. Handle channel stage question counting ──
    // Must happen AFTER flow harness but BEFORE building packet
    // Only count if we're still in a channel stage and about to ask a question
    // SKIP if the delivery gate just cleared a FAILED delivery — the previous question was
    // never spoken to the user (stream error), so this directive is a retry, not a new question.
    const isChannelStage = brain.currentStage === 'ch_alex' || brain.currentStage === 'ch_chris' || brain.currentStage === 'ch_maddie' || brain.currentStage === 'ch_sarah' || brain.currentStage === 'ch_james';
    if (isChannelStage && directive.ask && !advanced && !flowResult.clearedFailedDelivery) {
      const qKey = brain.currentStage as keyof typeof brain.questionCounts;
      if (qKey in brain.questionCounts) {
        brain.questionCounts[qKey]++;
        console.log(`[QCOUNT] ${qKey}=${brain.questionCounts[qKey]}/${directive.maxQuestions ?? '?'}`);
      }
    } else if (isChannelStage && directive.ask && flowResult.clearedFailedDelivery) {
      console.log(`[QCOUNT_SKIP] ${brain.currentStage} — previous delivery failed, not counting retry`);
    }

    // DIAG: log every directive before it becomes the packet
    console.log(`[DIRECTIVE] ts=${new Date().toISOString()} stage=${brain.currentStage} wowStep=${brain.currentWowStep ?? 'none'} ask=${directive.ask} canSkip=${directive.canSkip} waitForUser=${directive.waitForUser} speak="${directive.speak.slice(0, 100)}"`);

    // ── 5. Build bridge-compat response ──
    // Sprint 1A: pass semantic moveId from processFlow so bridge sends it back in callDOLlmReplyDone.
    // This ensures resolveDeliveryCompleted correlation check passes and spoken.moveIds gets the
    // correct _synthesis suffix for Phase 2 advancement gating.
    const packet = directiveToPacket(directive, brain, flowResult.moveId);

    // ── 7. Update watchdog ──
    brain.watchdog.lastTurnAt = new Date().toISOString();

    // ── 8. Persist + cache ──
    const responseBody = {
      packet,
      extraction: {
        applied,
        confidence: result.confidence,
        normalized: result.normalized,
        _gemini: geminiResult ? { fields: geminiResult.fields, latencyMs: geminiResult.latencyMs, source: geminiResult.source } : null,
      },
      extractedState: brain,
      advanced,
      stage: brain.currentStage,
      wowStall: brain.currentStage === 'wow' ? wowStepToNumber(brain.currentWowStep) : null,
    };

    await persistState(this.state.storage, brain as any);
    await this.state.storage.put(cacheKey, responseBody);
    await this.scheduleNextAlarm(brain);

    // Compatibility export: mirror DO state → legacy KV keys (non-blocking, non-fatal)
    // H1: kvExportVersion + stale-write prevention via monotonic sequence
    brain.kvExportVersion++;
    const exportSeq = ++this._latestExportSeq;
    this.state.waitUntil((async () => {
      if (exportSeq < this._latestExportSeq) {
        console.log(`[COMPAT_EXPORT_STALE] seq=${exportSeq} current=${this._latestExportSeq} — skipping`);
        return;
      }
      await exportCompatToKV(this.env.LEADS_KV, brain);
    })().catch(() => {}));

    return json({ ...responseBody, dedup: false });
  }

  // ── POST /event — all other events ────────────────────────────────────────

  private async handleEvent(request: Request): Promise<Response> {
    const event = await request.json<BrainEvent>();

    switch (event.type) {
      case 'session_init': {
        const { brain, created } = await this.ensureSession(event.leadId, event.starterIntel);
        const directive = buildStageDirective({
          stage: brain.currentStage,
          wowStep: brain.currentWowStep,
          intel: buildMergedIntel(brain),
          state: brain,
        });
        const packet = directiveToPacket(directive, brain);
        return json({
          status: created ? 'initialized' : 'existing',
          callId: this.state.id.toString(),
          leadId: event.leadId,
          packet,
          stage: brain.currentStage,
          wowStall: wowStepToNumber(brain.currentWowStep),
        });
      }

      case 'fast_intel_ready':
      case 'consultant_ready':
      case 'deep_ready':
        return await this.handleIntelEvent(event);

      case 'user_turn':
        return json({ error: 'use_turn_endpoint', message: 'POST /turn for user turns' }, 400);

      case 'llm_reply_done':
        return await this.handleLlmReplyDone(event);

      case 'delivery_barged_in': {
        const brain = await loadState(this.state.storage) as ConversationState | null;
        if (!brain) return json({ error: 'no_session' }, 400);

        const resolved = resolveDeliveryBargedIn(
          brain,
          event.deliveryId,
          event.moveId,
          'event',
        );

        await persistState(this.state.storage, brain as any);
        await this.scheduleNextAlarm(brain);
        console.log(`[EVENT] delivery_barged_in eventId=${event.eventId ?? 'none'} resolved=${resolved}`);
        return json({ status: resolved ? 'resolved' : 'stale', resolution: 'barged_in', eventId: event.eventId });
      }

      case 'delivery_failed': {
        const brain = await loadState(this.state.storage) as ConversationState | null;
        if (!brain) return json({ error: 'no_session' }, 400);

        const resolved = resolveDeliveryFailed(
          brain,
          event.deliveryId,
          event.moveId,
          event.errorCode,
          'event',
        );

        await persistState(this.state.storage, brain as any);
        await this.scheduleNextAlarm(brain);
        console.log(`[EVENT] delivery_failed eventId=${event.eventId ?? 'none'} resolved=${resolved}`);
        return json({ status: resolved ? 'resolved' : 'stale', resolution: 'failed', eventId: event.eventId });
      }

      case 'call_end':
        return await this.handleCallEnd(event);

      default:
        return json({ error: 'unknown_event', message: `Unknown event type` }, 400);
    }
  }

  // ── Intel events with version guard ───────────────────────────────────────

  private async handleIntelEvent(
    event: Extract<BrainEvent, { type: 'fast_intel_ready' | 'consultant_ready' | 'deep_ready' }>,
  ): Promise<Response> {
    const callId = this.state.id.toString();
    const { brain } = await this.ensureSession(callId);

    const intelType = event.type === 'fast_intel_ready' ? 'fast'
      : event.type === 'consultant_ready' ? 'consultant'
      : 'deep';

    const eventId = event.eventId ?? 'none';
    const sentAt = (event as any).sentAt ?? 'unknown';
    const source = (event as any).source ?? 'unknown';
    const receivedAt = new Date().toISOString();

    if (!shouldApplyVersion(event.version, brain.intelVersions[intelType])) {
      console.log(`[INTEL_REJECT] eventId=${eventId} type=${event.type} version=${event.version} <= current=${brain.intelVersions[intelType]} reason=stale_version source=${source}`);
      return json({
        status: 'skipped',
        reason: 'stale_version',
        type: event.type,
        version: event.version,
        currentVersion: brain.intelVersions[intelType],
      });
    }

    brain.intelVersions[intelType] = event.version;

    mergeIntel(brain, event);

    // Re-init queue if first intel and queue is empty
    if (brain.currentQueue.length === 0 && (brain.currentStage === 'wow' || brain.currentStage === 'greeting')) {
      initQueueFromIntel(brain);
    }

    // Populate identity fields from fast intel
    if (event.type === 'fast_intel_ready') {
      const ci = (event.payload as any)?.core_identity;
      if (ci?.first_name && !brain.firstName) brain.firstName = ci.first_name;
      if (ci?.business_name && !brain.business) brain.business = ci.business_name;
      if (ci?.industry && !brain.industry) brain.industry = ci.industry;

      // Seed early Places data into deep.googleMaps (wow_2 reads it there)
      const places = (event.payload as any)?.places;
      const hasDeepGM = !!(brain.intel.deep as any)?.googleMaps;
      if (places?.rating && !hasDeepGM) {
        if (!brain.intel.deep) brain.intel.deep = {};
        (brain.intel.deep as any).googleMaps = {
          rating: places.rating,
          review_count: places.review_count,
          name: places.name,
        };
        console.log(`[PLACES_SEED] lid=${callId} ts=${new Date().toISOString()} action=SEEDED rating=${places.rating} reviews=${places.review_count} name=${(places.name ?? '').slice(0, 40)}`);
      } else {
        console.log(`[PLACES_SEED] lid=${callId} ts=${new Date().toISOString()} action=SKIP places_in_event=${!!places?.rating} deep_gm_exists=${hasDeepGM}`);
      }
    }

    console.log(`[INTEL_RECV] eventId=${eventId} type=${event.type} version=${event.version} mergedVersion=${brain.intel.mergedVersion} source=${source} sentAt=${sentAt} receivedAt=${receivedAt}`);

    // DIAG: wow-relevant field inventory after merge
    {
      const _c = (brain.intel.consultant as any) ?? {};
      const _d = (brain.intel.deep as any) ?? {};
      const _sf = _c.scriptFills ?? {};
      console.log(`[WOW_FIELDS] lid=${callId} ts=${new Date().toISOString()} type=${event.type} googleMaps=${!!_d.googleMaps} rating=${_d.googleMaps?.rating ?? 'none'} consultant=${!!brain.intel.consultant} icp_guess=${!!_sf.icp_guess} scrapedDataSummary=${!!_sf.scrapedDataSummary} mostImpressive=${_c.mostImpressive?.length ?? 0}`);
    }

    await persistState(this.state.storage, brain as any);
    await this.scheduleNextAlarm(brain);

    return json({
      status: 'merged',
      type: event.type,
      mergedVersion: brain.intel.mergedVersion,
      queueLength: brain.currentQueue.length,
    });
  }

  // ── llm_reply_done ────────────────────────────────────────────────────────

  private async handleLlmReplyDone(
    event: Extract<BrainEvent, { type: 'llm_reply_done' }>,
  ): Promise<Response> {
    const brain = await loadState(this.state.storage) as ConversationState | null;
    if (!brain) {
      return json({ error: 'no_session', message: 'No active session' }, 400);
    }

    const eventId = event.eventId ?? 'none';

    // ── Flow Harness: resolve delivery ──
    if (event.deliveryId && brain.pendingDelivery) {
      // Prefer deliveryId match (Chunk 4+ bridges send deliveryId)
      resolveDeliveryCompleted(brain, event.deliveryId, event.moveId ?? '');
    } else if (event.moveId && brain.pendingDelivery?.status === 'pending' && brain.pendingDelivery?.moveId === event.moveId) {
      // Backward compat: bridge may not send deliveryId yet (pre-Chunk 4)
      // Match on moveId as fallback — audit when fallback matching is used
      console.log(`[DELIVERY_COMPAT] llm_reply_done matched on moveId=${event.moveId} (no deliveryId)`);
      resolveDeliveryCompleted(brain, brain.pendingDelivery.deliveryId, event.moveId);
    }

    // ── Compliance handling (Sprint A2) ──
    const complianceStatus = event.compliance_status;
    const complianceScore = event.compliance_score ?? 1.0;
    const missedPhrases = event.missed_phrases ?? [];
    const deliveryStage = brain.pendingDelivery?.stage ?? brain.currentStage;
    const isCritical = CRITICAL_STAGES.includes(deliveryStage);
    const isWow = deliveryStage.startsWith('wow') || deliveryStage === 'greeting';

    if (complianceStatus && !isWow) {
      console.log(`[COMPLIANCE_INPUT] stage=${deliveryStage} status=${complianceStatus} score=${complianceScore.toFixed(2)} missed=${missedPhrases.length} critical=${isCritical}`);

      // Log entry (populated with judge results async later if judge runs)
      const logEntry: ComplianceLogEntry = {
        stage: deliveryStage,
        ts: Date.now(),
        score: complianceScore,
        driftType: null,
        judgeCompliant: null,
        missedPhrases: missedPhrases.slice(0, 5),
        reason: null,
      };

      if (complianceStatus === 'drift' && isCritical && brain.pendingDelivery) {
        // Set delivery to drifted — flow.ts will handle retry/advance
        brain.pendingDelivery.status = 'drifted';
        brain.pendingDelivery.missedPhrases = missedPhrases.slice(0, 5);
        brain.pendingDelivery.driftCount = (brain.pendingDelivery.driftCount ?? 0) + 1;
        console.log(`[COMPLIANCE_DRIFT] stage=${deliveryStage} driftCount=${brain.pendingDelivery.driftCount} missed=${JSON.stringify(missedPhrases.slice(0, 3))}`);
      } else if (complianceStatus === 'pass') {
        console.log(`[COMPLIANCE_PASS] stage=${deliveryStage} score=${complianceScore.toFixed(2)}`);
      } else if (complianceStatus === 'drift' && !isCritical) {
        // Non-critical: log only, no state mutation
        console.log(`[COMPLIANCE_DRIFT_NONCRITICAL] stage=${deliveryStage} score=${complianceScore.toFixed(2)} — log only`);
      }

      brain.complianceLog.push(logEntry);
      // Cap compliance log at 50 entries
      if (brain.complianceLog.length > 50) {
        brain.complianceLog = brain.complianceLog.slice(-50);
      }

      // Fire async judge (Decision Y: never blocks, advisory only)
      if (complianceStatus === 'drift' && this.geminiKey) {
        const spokenForJudge = (event.spokenText ?? '').slice(0, 1000);
        const stageForJudge = deliveryStage;
        const envForJudge = { GEMINI_API_KEY: this.geminiKey } as Pick<Env, 'GEMINI_API_KEY'>;
        const logIndex = brain.complianceLog.length - 1;

        this.state.waitUntil((async () => {
          try {
            const judgeResult = await runLlmJudge(spokenForJudge, missedPhrases.join('; '), stageForJudge, envForJudge);
            if (judgeResult) {
              // Update the log entry with judge results (best-effort, state may have moved on)
              const freshBrain = await loadState(this.state.storage) as ConversationState | null;
              if (freshBrain && freshBrain.complianceLog[logIndex]) {
                freshBrain.complianceLog[logIndex].judgeCompliant = judgeResult.compliant;
                freshBrain.complianceLog[logIndex].driftType = judgeResult.driftType;
                freshBrain.complianceLog[logIndex].reason = judgeResult.reason;
                await persistState(this.state.storage, freshBrain as any);
                console.log(`[JUDGE_OK] stage=${stageForJudge} compliant=${judgeResult.compliant} drift=${judgeResult.driftType} reason="${judgeResult.reason}"`);
              }
            }
          } catch (err: any) {
            console.log(`[JUDGE_ERR] stage=${stageForJudge} error=${err.message}`);
          }
        })());
      }
    }

    // Track spoken move IDs
    if (event.moveId && !brain.spoken.moveIds.includes(event.moveId)) {
      brain.spoken.moveIds.push(event.moveId);
    }

    // D8: WOW4 delivery gate — provisional confirmedCTA=true when PRIMARY_CTA branch delivered.
    // flow.ts will override to false if the user then negates or corrects.
    // This ensures confirmedCTA is never left null after WOW4 is confirmed spoken.
    if (event.moveId === 'v2_wow_wow_4_conversion_action' && brain.confirmedCTA === null) {
      brain.confirmedCTA = true;
      console.log(`[WOW4_DELIVERY] confirmedCTA=true (provisional — delivery confirmed moveId=${event.moveId})`);
    }

    // Log Bella transcript (non-empty, dedup by turnId-like moveId)
    const spokenText = (event.spokenText ?? '').trim();
    if (spokenText.length > 0) {
      const lastEntry = brain.transcriptLog[brain.transcriptLog.length - 1];
      const isDupe = lastEntry?.role === 'bella' && lastEntry?.text === spokenText;
      if (!isDupe) {
        appendTranscript(brain, {
          role: 'bella',
          text: spokenText,
          turnId: event.moveId,
          ts: event.ts,
        });

        // Extract Bella commitments from spoken text
        const turnIndex = brain.transcriptLog.length - 1;
        const bellaMemory = extractBellaMemoryNotes(spokenText, turnIndex);
        if (bellaMemory.length > 0) {
          const now = new Date().toISOString();
          const toAppend: typeof bellaMemory = [];

          // Existing active Bella commitments for comparison
          const activeCommitments = brain.memoryNotes.filter(
            n => n.category === 'commitment' && n.source === 'bella' && n.status === 'active',
          );

          for (const newNote of bellaMemory) {
            const newKey = commitmentKey(newNote.text);
            const match = activeCommitments.find(e => commitmentKey(e.text) === newKey);

            if (match) {
              // Same commitment repeated — refresh existing, do not append
              match.updatedAt = now;
              match.salience = Math.max(match.salience ?? 2, newNote.salience ?? 2) as 1 | 2 | 3;
              console.log(`[BELLA_DEDUP] refreshed existing id=${match.id} text="${match.text.slice(0, 50)}"`);
            } else {
              // Different commitment — append as a separate active note
              toAppend.push(newNote);
            }
          }

          if (toAppend.length > 0) {
            brain.memoryNotes.push(...toAppend);
            // Enforce 100-entry cap
            if (brain.memoryNotes.length > 100) {
              brain.memoryNotes = brain.memoryNotes.slice(-100);
            }
            console.log(`[BELLA_MEMORY] appended=${toAppend.length} ids=[${toAppend.map(n => n.id).join(',')}]`);
          }
        }
      }
    }

    await persistState(this.state.storage, brain as any);
    await this.scheduleNextAlarm(brain);

    // Export cross-call memory (idempotent — whichever of llm_reply_done / call_end runs last wins)
    if (brain.leadId && brain.leadId !== 'unknown') {
      try {
        await exportMemoryToKV(this.env.LEADS_KV, brain.leadId, brain.memoryNotes);
      } catch (err: any) {
        console.error(`[MEMORY_EXPORT_LLM_REPLY_ERR] leadId=${brain.leadId} error=${err.message}`);
      }
    }

    return json({
      status: 'recorded',
      moveId: event.moveId,
      stage: brain.currentStage,
      eventId,
    });
  }

  // ── call_end ──────────────────────────────────────────────────────────────

  private async handleCallEnd(
    event: Extract<BrainEvent, { type: 'call_end' }>,
  ): Promise<Response> {
    const brain = await loadState(this.state.storage) as ConversationState | null;
    if (!brain) {
      return json({ status: 'no_session' });
    }

    // Run any pending calculators for final state
    const channelStages: StageId[] = ['ch_alex', 'ch_chris', 'ch_maddie'];
    for (const stage of channelStages) {
      if (!brain.calculatorResults[stage === 'ch_alex' ? 'alex' : stage === 'ch_chris' ? 'chris' : 'maddie']) {
        tryRunCalculator(stage, brain);
      }
    }

    await persistState(this.state.storage, brain as any);

    // Export cross-call memory to KV (non-fatal)
    try {
      await exportMemoryToKV(this.env.LEADS_KV, brain.leadId, brain.memoryNotes);
    } catch (err: any) {
      console.error(`[MEMORY_EXPORT_ERR] leadId=${brain.leadId} error=${err.message}`);
    }

    // Final compatibility export: mirror DO state → legacy KV keys (awaited at call_end)
    brain.kvExportVersion++;
    this._latestExportSeq++;
    await exportCompatToKV(this.env.LEADS_KV, brain).catch((err: any) => {
      console.error(`[COMPAT_EXPORT_FINAL_ERR] leadId=${brain.leadId} error=${err.message}`);
    });

    const coreAgents: CoreAgent[] = ['alex', 'chris', 'maddie'];
    const totalValue = coreAgents.reduce((sum, a) => sum + (brain.calculatorResults[a]?.weeklyValue ?? 0), 0);

    console.log(`[CALL_END] reason=${event.reason} stage=${brain.currentStage} totalROI=$${totalValue}/wk`);

    return json({
      status: 'ended',
      finalStage: brain.currentStage,
      completedStages: brain.completedStages,
      calculatorResults: brain.calculatorResults,
      totalWeeklyValue: totalValue,
    });
  }

  // ── POST /notes — scribe note ingestion ──────────────────────────────────

  private async handleNotes(request: Request): Promise<Response> {
    const body = await request.json<{
      callId?: string;
      turnIndex?: number;
      notes?: unknown[];
    }>();

    const callId = body.callId;
    if (!callId) return json({ error: 'missing_call_id' }, 400);

    const turnIndex = body.turnIndex;
    if (turnIndex == null || typeof turnIndex !== 'number' || turnIndex < 0) {
      return json({ error: 'invalid_turn_index' }, 400);
    }

    const rawNotes = body.notes;
    if (!Array.isArray(rawNotes) || rawNotes.length === 0) {
      return json({ error: 'empty_notes' }, 400);
    }
    if (rawNotes.length > 5) {
      return json({ error: 'too_many_notes', message: 'Max 5 notes per request' }, 400);
    }

    const { brain } = await this.ensureSession(callId);

    // Per-turnIndex cap: max 5 accepted notes across all requests
    if (!brain.scribeProcessed) brain.scribeProcessed = {};
    const priorAccepted = brain.scribeProcessed[turnIndex] ?? [];
    const remainingSlots = 5 - priorAccepted.length;
    if (remainingSlots <= 0) {
      console.log(`[SCRIBE_NOOP] turnIndex=${turnIndex} reason=turn_cap_reached`);
      return json({ accepted: 0, rejected: rawNotes.length, results: rawNotes.map(() => ({ status: 'rejected', reason: 'turn_cap_reached' })) });
    }

    const results: { status: string; reason?: string; id?: string }[] = [];
    let acceptedCount = 0;

    for (const raw of rawNotes) {
      if (acceptedCount >= remainingSlots) {
        results.push({ status: 'rejected', reason: 'turn_cap_reached' });
        continue;
      }

      const v = validateScribeNote(raw);
      if (v.rejected) {
        console.log(`[SCRIBE_REJECT] turnIndex=${turnIndex} reason=${v.reason}`);
        results.push({ status: 'rejected', reason: v.reason });
        continue;
      }
      const note = v.note!;

      // ID-level dedup: already accepted this exact note id for this turn
      const noteId = `scribe-${note.category}-${turnIndex}-${acceptedCount}`;
      if (priorAccepted.includes(noteId)) {
        results.push({ status: 'rejected', reason: 'already_accepted' });
        continue;
      }

      // Content dedup against existing memoryNotes
      const dupReason = findDuplicate(note, brain.memoryNotes);
      if (dupReason) {
        console.log(`[SCRIBE_REJECT] turnIndex=${turnIndex} reason=dedup:${dupReason}`);
        results.push({ status: 'rejected', reason: `dedup:${dupReason}` });
        continue;
      }

      // Priority: inferred never supersedes stated or other inferred
      // (no supersession logic — scribe notes are additive only)

      // Build final MemoryNote with DO-owned fields
      const finalNote: MemoryNote = {
        id: noteId,
        text: note.text,
        category: note.category,
        tags: note.tags,
        source: 'user',
        sourceTurnIndex: turnIndex,
        confidence: 'inferred',
        createdAt: new Date().toISOString(),
        status: 'active',
        scope: scopeForCategory(note.category),
        salience: 1,
      };

      // Cap memoryNotes at 100 — FIFO eviction
      if (brain.memoryNotes.length >= 100) {
        brain.memoryNotes.shift();
      }
      brain.memoryNotes.push(finalNote);
      priorAccepted.push(noteId);
      acceptedCount++;

      console.log(`[SCRIBE_ACCEPT] turnIndex=${turnIndex} id=${noteId} cat=${note.category} tags=[${(note.tags ?? []).join(',')}]`);
      results.push({ status: 'accepted', id: noteId });
    }

    brain.scribeProcessed[turnIndex] = priorAccepted;
    await persistState(this.state.storage, brain as any);

    return json({ accepted: acceptedCount, rejected: rawNotes.length - acceptedCount, results });
  }

  // ── GET /state ────────────────────────────────────────────────────────────

  private async handleGetState(): Promise<Response> {
    const brain = await loadState(this.state.storage);
    if (!brain) {
      return json({ error: 'no_session', message: 'No active session' }, 404);
    }
    return json(brain);
  }

  // ── GET /debug — flow harness inspection ──────────────────────────────────

  private async handleDebug(url: URL): Promise<Response> {
    const brain = await loadState(this.state.storage) as ConversationState | null;
    if (!brain) return json({ error: 'no_session' }, 404);

    const action = url.searchParams.get('action');
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '200', 10) || 200, 500);

    let filteredLog = brain.flowLog;
    if (action) {
      filteredLog = filteredLog.filter(e => e.action === action);
    }
    filteredLog = filteredLog.slice(-limit);

    // ── Compliance summary computation ──
    const cLog = brain.complianceLog ?? [];
    const overallScore = cLog.length > 0
      ? cLog.reduce((sum, e) => sum + e.score, 0) / cLog.length
      : null;
    const driftCounts: Record<string, number> = {};
    let judgeFiredCount = 0;
    let judgeErrorCount = 0;
    for (const entry of cLog) {
      if (entry.driftType) {
        driftCounts[entry.driftType] = (driftCounts[entry.driftType] ?? 0) + 1;
      }
      if (entry.judgeCompliant !== null) {
        judgeFiredCount++;
      } else if (entry.score < 1) {
        // Judge should have fired (drift detected) but result is null → error
        judgeErrorCount++;
      }
    }

    return json({
      version: VERSION,
      callId: brain.callId,
      currentStage: brain.currentStage,
      currentWowStep: brain.currentWowStep ?? null,
      pendingDelivery: brain.pendingDelivery,
      consecutiveTimeouts: brain.consecutiveTimeouts,
      completedStages: brain.completedStages,
      completedWowSteps: brain.completedWowSteps,
      spoken: brain.spoken,
      flowLogCount: brain.flowLog.length,
      flowLog: filteredLog,
      questionCounts: brain.questionCounts,
      calculatorResults: brain.calculatorResults,
      kvExportVersion: brain.kvExportVersion,
      // FIX 5: Intelligence context observability
      lastCriticalFacts: brain.lastCriticalFacts ?? null,
      lastContextNotes: brain.lastContextNotes ?? null,
      // Extracted inputs snapshot
      extractedInputs: {
        acv: brain.acv ?? null,
        inboundLeads: brain.inboundLeads ?? null,
        inboundConversions: brain.inboundConversions ?? null,
        inboundConversionRate: brain.inboundConversionRate ?? null,
        responseSpeedBand: brain.responseSpeedBand ?? null,
        webLeads: brain.webLeads ?? null,
        webConversions: brain.webConversions ?? null,
        webConversionRate: brain.webConversionRate ?? null,
        phoneVolume: brain.phoneVolume ?? null,
        missedCalls: brain.missedCalls ?? null,
        missedCallRate: brain.missedCallRate ?? null,
      },
      // Sprint E1: rolling transcript buffer for deterministic extraction
      recentUserTranscripts: brain.recentUserTranscripts ?? [],
      complianceLog: cLog,
      complianceSummary: {
        totalChecks: cLog.length,
        overallScore,
        driftCounts,
        judgeFiredCount,
        judgeErrorCount,
      },
      // V2-specific state fields (for D7-D10 eval assertions)
      confirmedICP: brain.confirmedICP ?? null,
      overriddenICP: brain.overriddenICP ?? null,
      confirmedCTA: brain.confirmedCTA ?? null,
      overriddenCTA: brain.overriddenCTA ?? null,
      spokenDeepInsightIds: brain.spokenDeepInsightIds ?? [],
      supplementVersion: brain.supplementVersion ?? null,
    });
  }

  // ── Watchdog alarm ────────────────────────────────────────────────────────

  async alarm(): Promise<void> {
    const brain = await loadState(this.state.storage) as ConversationState | null;
    if (!brain) return;

    const now = Date.now();

    // ── Delivery timeout check (takes priority over watchdog) ──
    // Sprint 1A (Issue 6): use type-aware timeout from pendingDelivery, fall back to default
    if (brain.pendingDelivery && brain.pendingDelivery.status === 'pending') {
      const elapsed = now - brain.pendingDelivery.issuedAt;
      const effectiveTimeout = brain.pendingDelivery.timeoutMs ?? DELIVERY_TIMEOUT_MS;
      if (elapsed >= effectiveTimeout) {
        // H1 idempotency guard: re-read state to catch concurrent resolution
        const freshBrain = await loadState(this.state.storage) as ConversationState | null;
        if (!freshBrain) return;
        if (!freshBrain.pendingDelivery || freshBrain.pendingDelivery.status !== 'pending') {
          console.log(`[ALARM_IDEMPOTENT] delivery already resolved between reads — skipping`);
          await this.scheduleNextAlarm(freshBrain);
          return;
        }
        // Verify same deliveryId (not a new delivery queued between reads)
        if (freshBrain.pendingDelivery.deliveryId !== brain.pendingDelivery.deliveryId) {
          console.log(`[ALARM_IDEMPOTENT] deliveryId changed: was=${brain.pendingDelivery.deliveryId} now=${freshBrain.pendingDelivery.deliveryId} — skipping`);
          await this.scheduleNextAlarm(freshBrain);
          return;
        }

        const { reissue } = resolveDeliveryTimeout(freshBrain, 'alarm');

        // H1: persist BEFORE scheduling next alarm (persist-before-work)
        await persistState(this.state.storage, freshBrain as any);
        await this.scheduleNextAlarm(freshBrain);
        return; // Handled — don't fall through to watchdog this cycle
      }
    }

    // ── Watchdog alarm logic ──
    // Wrapped in try/finally to ensure persist-before-work even if watchdog throws
    try {
      const lastTurnMs = brain.watchdog.lastTurnAt
        ? new Date(brain.watchdog.lastTurnAt).getTime()
        : null;

      // ── Deep intel missing ──
      // Flag preserved for observability — moves.ts uses data-presence checks directly,
      // not this flag. wow_2 checks d.googleMaps?.rating, wow_6 checks fills.scrapedDataSummary,
      // wow_8 works from fast-intel flags without requiring deep data. The log line below
      // provides useful production signal for diagnosing slow deep-scrape pipelines.
      const deepStatus = (brain.intel.deep as any)?.status;
      const apifyDone = deepStatus === 'done';
      if (!apifyDone && !brain.watchdog.deepIntelMissingEscalation) {
        brain.watchdog.deepIntelMissingEscalation = true;
        console.log(`[ALARM] Deep intel missing — escalation flagged callId=${brain.callId}`);
      }

      // ── Intel gap fill: KV poll for missing intel (defense-in-depth) ──────
      // Push events (fast-intel → DO, deep-scrape → DO) may fail silently if
      // the DO wasn't created yet when the event was sent (404), or if service
      // binding had a transient error. Re-read KV as a backup.
      const callAgeMs = lastTurnMs ? now - lastTurnMs : 0;
      const lid = brain.leadId;

      // Consultant missing after 15s — re-read from fast-intel KV key
      if (!brain.intel.consultant && callAgeMs > 15_000 && lid) {
        try {
          const fastIntelRaw = await this.env.LEADS_KV.get(`lead:${lid}:fast-intel`, 'json') as Record<string, any> | null;
          if (fastIntelRaw?.consultant) {
            mergeIntel(brain, {
              type: 'consultant_ready',
              payload: fastIntelRaw.consultant,
              version: Date.now(),
            });
            console.log(`[ALARM_KV_FILL] consultant merged from KV poll lid=${lid} keys=${Object.keys(fastIntelRaw.consultant).join(',')}`);
          }
        } catch (err: any) {
          console.error(`[ALARM_KV_FILL_ERR] consultant poll failed lid=${lid}: ${err.message}`);
        }
      }

      // Fast intel missing after 10s — re-read from fast-intel KV key
      if (!brain.intel.fast && callAgeMs > 10_000 && lid) {
        try {
          const fastIntelRaw = await this.env.LEADS_KV.get(`lead:${lid}:fast-intel`, 'json') as Record<string, any> | null;
          if (fastIntelRaw) {
            mergeIntel(brain, {
              type: 'fast_intel_ready',
              payload: fastIntelRaw,
              version: Date.now(),
            });
            console.log(`[ALARM_KV_FILL] fast_intel merged from KV poll lid=${lid} biz=${(fastIntelRaw.business_name ?? 'none').slice(0, 40)}`);
          }
        } catch (err: any) {
          console.error(`[ALARM_KV_FILL_ERR] fast_intel poll failed lid=${lid}: ${err.message}`);
        }
      }

      // Deep intel missing after 30s — re-read from intel KV key (deep-scrape writes here)
      if (!apifyDone && callAgeMs > 30_000 && lid) {
        try {
          const intelRaw = await this.env.LEADS_KV.get(`lead:${lid}:intel`, 'json') as Record<string, any> | null;
          if (intelRaw?.deep?.status === 'done') {
            mergeIntel(brain, {
              type: 'deep_ready',
              payload: intelRaw.deep,
              version: Date.now(),
            });
            console.log(`[ALARM_KV_FILL] deep_intel merged from KV poll lid=${lid} googleMaps=${!!intelRaw.deep.googleMaps} hiring=${!!intelRaw.deep.hiring}`);
          }
        } catch (err: any) {
          console.error(`[ALARM_KV_FILL_ERR] deep_intel poll failed lid=${lid}: ${err.message}`);
        }
      }

      // deep_scriptFills missing after 30s — re-read from separate KV key
      const hasScriptFills = !!(brain.intel.deep as any)?.deep_scriptFills;
      if (!hasScriptFills && callAgeMs > 30_000 && lid) {
        try {
          const fillsRaw = await this.env.LEADS_KV.get(`lead:${lid}:deep_scriptFills`, 'json') as Record<string, any> | null;
          if (fillsRaw) {
            if (!brain.intel.deep) brain.intel.deep = {};
            (brain.intel.deep as any).deep_scriptFills = fillsRaw;
            // D10+B12: stamp scriptFillsArrived + supplementVersion when fills arrive via alarm poll
            brain.scriptFillsArrived = true;
            brain.supplementVersion = Date.now();
            brain.supplementUpdatedAt = new Date().toISOString();
            console.log(`[ALARM_KV_FILL] deep_scriptFills injected from KV poll lid=${lid} deepInsights=${fillsRaw.deepInsights?.length ?? 0} scriptFillsArrived=true`);
          }
        } catch (err: any) {
          console.error(`[ALARM_KV_FILL_ERR] deep_scriptFills poll failed lid=${lid}: ${err.message}`);
        }
      }

      // ── Call stale: no /turn for 120s ──
      // mustDeliverRoiNext was proposed but never implemented. Force-advance is
      // handled by gate.ts shouldForceAdvance() + maxQuestionsReached(). No
      // additional flag needed — the gate logic covers all ROI-pressure scenarios.
      if (lastTurnMs && now - lastTurnMs > 120_000) {
        console.log(`[ALARM] Call stale — no turn for ${Math.round((now - lastTurnMs) / 1000)}s callId=${brain.callId}`);
        // Run pending calculators on stale call.
        // Idempotent: the guard (!brain.calculatorResults[agent]) skips agents
        // whose ROI was already computed. tryRunCalculator itself no-ops when
        // minimum data is absent (hasXxxMinimumData returns false). Safe to
        // re-enter on repeated alarms.
        const channelStages: StageId[] = ['ch_alex', 'ch_chris', 'ch_maddie'];
        for (const stage of channelStages) {
          const agent: CoreAgent = stage === 'ch_alex' ? 'alex' : stage === 'ch_chris' ? 'chris' : 'maddie';
          if (!brain.calculatorResults[agent]) {
            console.log(`[ALARM_CALC] Running ${agent} calculator (acv=${brain.acv})`);
            tryRunCalculator(stage, brain);
          }
        }
      }

      // ── Question budget tight ──
      const isChannelStage = brain.currentStage === 'ch_alex' || brain.currentStage === 'ch_chris' || brain.currentStage === 'ch_maddie' || brain.currentStage === 'ch_sarah' || brain.currentStage === 'ch_james';
      if (isChannelStage && maxQuestionsReached(brain.currentStage, brain) && !brain.questionBudgetTight) {
        brain.questionBudgetTight = true;
        console.log(`[ALARM] Question budget tight — stage=${brain.currentStage}`);
      }
    } catch (err: any) {
      console.error(`[ALARM_WATCHDOG_ERR] ${err.message}`);
    }

    // H1: persist BEFORE scheduling next alarm (persist-before-work)
    await persistState(this.state.storage, brain as any);
    await this.scheduleNextAlarm(brain);
  }

  private async scheduleNextAlarm(brain: ConversationState): Promise<void> {
    const now = Date.now();
    const times: number[] = [];

    // Delivery timeout — pending delivery needs alarm at issuedAt + type-aware timeout
    // Sprint 1A (Issue 6): use per-delivery timeoutMs, fall back to default
    if (brain.pendingDelivery && brain.pendingDelivery.status === 'pending') {
      const effectiveTimeout = brain.pendingDelivery.timeoutMs ?? DELIVERY_TIMEOUT_MS;
      const timeoutAt = brain.pendingDelivery.issuedAt + effectiveTimeout;
      // If already past, fire soon (100ms buffer)
      times.push(Math.max(timeoutAt, now + 100));
    }

    // Deep intel still missing — check in 20s
    const deepStatus = (brain.intel.deep as any)?.status;
    const apifyDone = deepStatus === 'done';
    if (!apifyDone && !brain.watchdog.deepIntelMissingEscalation) {
      times.push(now + 20_000);
    }

    // KV gap fill — schedule alarm if any intel source is missing
    // Consultant: poll at 15s, fast: poll at 10s, deep: poll at 30s
    if (!brain.intel.consultant || !brain.intel.fast || !apifyDone) {
      const lastMs = brain.watchdog.lastTurnAt ? new Date(brain.watchdog.lastTurnAt).getTime() : 0;
      const callAge = lastMs ? now - lastMs : 0;
      // Only schedule if call is active (has had at least one turn) and gap fill hasn't run yet
      if (lastMs > 0) {
        if (!brain.intel.fast && callAge < 10_000) times.push(lastMs + 10_000);
        if (!brain.intel.consultant && callAge < 15_000) times.push(lastMs + 15_000);
        if (!apifyDone && callAge < 30_000) times.push(lastMs + 30_000);
      }
    }

    // Call stale — 120s after last turn
    if (brain.watchdog.lastTurnAt) {
      const lastMs = new Date(brain.watchdog.lastTurnAt).getTime();
      const staleAt = lastMs + 120_000;
      if (staleAt > now) {
        times.push(staleAt);
      }
    }

    if (times.length > 0) {
      const nextAlarm = Math.min(...times);
      await this.state.storage.setAlarm(nextAlarm);
      console.log(`[ALARM_SCHED] next in ${Math.round((nextAlarm - now) / 1000)}s`);
    }
  }
}

// ─── Worker entrypoint ──────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ status: 'ok', version: VERSION, worker: 'call-brain-do' });
    }

    const callId = request.headers.get('x-call-id') ?? url.searchParams.get('callId');
    if (!callId) {
      return json({ error: 'missing_call_id', message: 'Provide x-call-id header or callId param' }, 400);
    }

    const doId = env.CALL_BRAIN.idFromName(callId);
    const stub = env.CALL_BRAIN.get(doId);

    // Secrets don't propagate to DO env automatically — inject via header
    const doRequest = new Request(request, {
      headers: new Headers(request.headers),
    });
    if (env.GEMINI_API_KEY) {
      doRequest.headers.set('x-gemini-key', env.GEMINI_API_KEY);
    }

    return stub.fetch(doRequest);
  },
};
