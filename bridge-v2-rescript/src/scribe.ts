/**
 * deepgram-bridge-v11/src/scribe.ts — Bella Scribe Module
 *
 * Best-effort memory enrichment layer. Runs inside ctx.waitUntil() —
 * completion is not guaranteed under all network conditions per Cloudflare docs.
 * Acceptable for V1: the regex MEMORY_PATTERNS in call-brain-do catch critical
 * stated facts durably via the main /turn path. Scribe adds inferred observations
 * as a best-effort enrichment layer.
 *
 * Pipeline: isScribeEligible → buildScribeMessages → callScribeWorkersAI → postNotesToBrain
 * Fails closed to [] / no-op, never throws upward, never interferes with the
 * main conversation path.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ScribeNote {
  text: string;
  category: string;
  tags: string[];
}

// ─── Category / Tag Constants ───────────────────────────────────────────────
// V1 TECH DEBT: These are duplicated from call-brain-do's SCRIBE_ALLOWED_CATEGORIES
// and SCRIBE_ALLOWED_TAGS. When we unify the build, extract to a shared constants package.
// Until then, if you update one, update both.

const SCRIBE_ALLOWED_CATEGORIES = new Set([
  'preference', 'personal', 'business_context', 'objection',
  'relationship', 'scheduling', 'communication_style', 'constraint',
]);

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

// ─── Filler Detection ───────────────────────────────────────────────────────
// Strict filler-only detector. High precision — only matches pure acknowledgments,
// encouragement, and filler with no business fact. Reference: call-brain-do extract.ts.

const FILLER_ONLY = /^((yeah|yep|yes|yup|sure|ok|okay|mm+h?m?|uh\s*huh|right|got\s*it|hmm+|ah+|oh+|cool|nice|alright|sounds?\s*good|go\s*ahead|go\s*for\s*it|sure\s*thing|for\s*sure|that'?s?\s*fine|no\s*worries|haha|fair\s*enough|give\s*me\s*a\s*sec|I'?m\s*driving|that\s*makes?\s*sense|I\s*think\s*so|I\s*reckon|totally|absolutely|definitely|exactly|yea|I\s*see|interesting|tell\s*me\s*more)\s*[.,!?]*\s*)+$/i;

// ─── Signal Detection (observability only — NOT a gate) ─────────────────────
// Retained for optional logging, metrics, and future tuning.
// Does NOT decide eligibility.

const SIGNAL_PATTERN = /\b(\d+|hundred|thousand|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|staff|employee|team|people|hire|hiring|receptionist|admin|assistant|manager|open|close|days|hours|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|after\s*hours|morning|evening|wife|husband|partner|daughter|son|brother|sister|family|tried|expensive|didn'?t\s+work|burned|hate|concern|problem|challenge|struggling|killing|losing|issue|CRM|system|software|use|using|salesforce|hubspot|cliniko|servicem8|spreadsheet|google|excel|voicemail|follow\s*up|call\s*back|nobody|missed|unanswered|budget|can'?t|limited|afford|cost|prefer|email|text|sms|don'?t\s+call|growing|expanding|scaling|new\s+location|flat\s+out|booked\s+out|chews?\s+time|after[\s-]hours|tradies?|just\s+me|my\s+(?:wife|husband|partner|daughter|son|brother|sister|dad|mum|mom|father|mother))\b/i;

// ─── Eligibility Gate ───────────────────────────────────────────────────────
// Broad prefilter: only exclude very short utterances (<10 chars) and obvious filler.
// Let Gemini's prompt + schema + post-parse validation do the selectivity work.

export type SkipReason = 'too_short' | 'filler';

export function isScribeEligible(utterance: string): { eligible: boolean; reason?: SkipReason } {
  const trimmed = utterance.trim().replace(/\s{2,}/g, ' ');

  // Hard floor — under 5 chars is never worth a Gemini call
  // (lowered from 10 to catch extreme-short high-value like "3x ROI")
  if (trimmed.length < 5) {
    return { eligible: false, reason: 'too_short' };
  }

  // Strict filler check — only pure acknowledgments / encouragement
  if (FILLER_ONLY.test(trimmed)) {
    return { eligible: false, reason: 'filler' };
  }

  // Everything else goes to Gemini for selectivity
  return { eligible: true };
}

// ─── Gemini Scribe Payload Builder ──────────────────────────────────────────

const SCRIBE_SYSTEM_PROMPT = `You are a selective sales-call memory scribe for an AI voice agent called Bella.

TASK: Read the prospect's latest utterance and extract 0-5 structured memory notes. These notes persist across future conversation turns so Bella sounds attentive and informed.

OUTPUT FORMAT: Respond ONLY with a JSON object: {"notes": [...]}. No markdown, no explanation, no wrapping — just the raw JSON object.

EXTRACTION RULES:
- Return {"notes": []} if the utterance contains nothing memory-worthy
- Only extract facts STATED or CLEARLY IMPLIED by the prospect in this utterance
- Do NOT infer hidden causes, unstated emotions, or business metrics not mentioned
- Do NOT note anything the assistant said — only prospect speech
- Prefer ONE ATOMIC FACT per note — split team size, opening hours, and staffing into separate notes rather than combining
- Each note text: 15-200 characters, a concrete paraphrase, self-contained
- If a note involves a person, generalise away PII — say "spouse handles bookings" not a name
- Do NOT include phone numbers, email addresses, street addresses, or any PII

IMPORTANT — SHORT UTTERANCES:
- Short utterances can still be memory-worthy if they express budget, ROI, staffing, scheduling, relationship, vendor history, pain points, or communication preferences.
- Do not assume short means trivial. Examples of short but memory-worthy utterances:
  - "3x ROI" → budget/ROI context
  - "Partner decides" → decision-maker relationship
  - "Solo operator" → team size / business context
  - "Weekends kill us" → scheduling pain point
  - "Text don't call" → communication preference
- Return empty notes ONLY when the utterance is filler, acknowledgment, or lacks any durable business/personal context.

CATEGORIES (use exactly one per note):
preference, personal, business_context, objection, relationship, scheduling, communication_style, constraint

ALLOWED TAGS BY CATEGORY:
- preference: channel_preference, interest, preference
- personal: family, interest, sport, preference
- business_context: hours, peak, scope, specialty, history, expansion, team_size, voicemail, follow_up_method, no_follow_up, manual_process, current_tool, competitor, marketing_spend, growth_intent
- objection: past_experience, past_failure, price, aversion, disinterest, concern, pain_point, past_vendor
- relationship: staff, decision_maker, family_staff
- scheduling: day, peak, hours
- communication_style: channel_preference
- constraint: budget, limitation, availability, scheduling, timeline, decision_gate

If unsure about a tag, use an empty tags array [].

NOT MEMORY-WORTHY (return empty notes array):
- "yeah sounds good" → {"notes": []}
- "go ahead" → {"notes": []}
- "ok cool" → {"notes": []}
- "that makes sense" → {"notes": []}
- "sure thing" → {"notes": []}
- Pure acknowledgments, filler, or agreement without new factual content → {"notes": []}

MEMORY-WORTHY EXAMPLES (note: one atomic fact per note):
Input: "We have about twenty staff and open six days a week"
→ {"notes": [
  {"text": "Business has approximately 20 staff", "category": "business_context", "tags": ["team_size"]},
  {"text": "Open six days per week", "category": "business_context", "tags": ["hours"]}
]}

Input: "My wife handles all the bookings and admin"
→ {"notes": [{"text": "Spouse handles all bookings and admin", "category": "relationship", "tags": ["family_staff"]}]}

Input: "We tried a virtual receptionist last year but it was too expensive"
→ {"notes": [{"text": "Previously tried virtual receptionist, found too expensive", "category": "objection", "tags": ["past_experience", "price"]}]}

Input: "Calls go to voicemail and nobody follows up"
→ {"notes": [
  {"text": "Missed calls go to voicemail", "category": "business_context", "tags": ["voicemail"]},
  {"text": "No follow-up process for missed calls", "category": "business_context", "tags": ["no_follow_up"]}
]}`;

/** Max chars per turn content sent to Gemini to bound token usage. */
const MAX_TURN_CHARS = 500;
/** Max number of active memory titles sent to Gemini. */
const MAX_MEMORY_TITLES = 20;
/** Max chars per memory title. */
const MAX_MEMORY_TITLE_CHARS = 100;

export function buildScribeMessages(
  utterance: string,
  recentTurns: Array<{ role: string; content: string }>,
  currentStage: string,
  activeMemoryTitles: string[],
): Array<{ role: string; content: string }> {
  // Filter to user/assistant turns only, discard empty/non-string content, last 4
  const filtered = recentTurns
    .filter(t => (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string' && t.content.trim().length > 0)
    .slice(-4)
    .map(t => ({ role: t.role, content: t.content.slice(0, MAX_TURN_CHARS) }));

  // Bound memory titles
  const boundedTitles = activeMemoryTitles
    .slice(0, MAX_MEMORY_TITLES)
    .map(t => t.slice(0, MAX_MEMORY_TITLE_CHARS));

  const recentConversation = filtered.length > 0
    ? filtered.map(t => `${t.role === 'user' ? 'Prospect' : 'Bella'}: ${t.content}`).join('\n')
    : 'No recent turns';

  const memorySection = boundedTitles.length > 0
    ? boundedTitles.join('\n')
    : 'None yet';

  const userContent = `STAGE: ${currentStage}

EXISTING MEMORY (avoid duplicating these):
${memorySection}

RECENT CONVERSATION:
${recentConversation}

LATEST PROSPECT UTTERANCE:
"${utterance.slice(0, MAX_TURN_CHARS)}"`;

  return [
    { role: 'system', content: SCRIBE_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}

// ─── Workers AI Caller ──────────────────────────────────────────────────────

function extractAIText(result: any): string {
  if (!result) return '';
  let text = '';
  if (typeof result === 'string') text = result;
  else if (typeof result?.response === 'string') text = result.response;
  else if (typeof result?.result?.response === 'string') text = result.result.response;
  else if (Array.isArray(result?.result)) text = (result.result as any[]).map((r: any) => r?.response || '').join('');
  // Strip Qwen3 thinking blocks — reasoning model emits <think>...</think> before answering
  return text.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
}

/** Tokenize text for within-response dedup. */
function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 0);
}

/** Jaccard similarity between two token arrays. */
function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export async function callScribeWorkersAI(
  messages: Array<{ role: string; content: string }>,
  currentStage: string,
  env: { AI: any },
  timeoutMs: number = 15000,
): Promise<ScribeNote[]> {
  const start = Date.now();

  try {
    const result = await Promise.race([
      env.AI.run('@cf/qwen/qwen3-30b-a3b-fp8', { messages, max_tokens: 3000 }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]) as any;

    const latency = Date.now() - start;
    const messageContent = extractAIText(result);

    if (typeof messageContent !== 'string' || messageContent.trim().length === 0) {
      console.log(`[SCRIBE_WAI_ERR] stage=${currentStage} reason=no_content latency=${latency}ms`);
      return [];
    }

    let parsed: any;
    try {
      parsed = JSON.parse(messageContent);
    } catch {
      // Fallback: extract JSON from mixed text (markdown fences, etc.)
      const match = messageContent.match(/\{[\s\S]*"notes"\s*:\s*\[[\s\S]*\]\s*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch { /* malformed */ }
      }
    }
    if (!parsed) {
      console.log(`[SCRIBE_WAI_ERR] stage=${currentStage} reason=json_parse_fail latency=${latency}ms len=${messageContent.length}`);
      return [];
    }

    const rawNotes = parsed?.notes;
    if (!Array.isArray(rawNotes)) {
      console.log(`[SCRIBE_WAI_ERR] stage=${currentStage} reason=no_notes_array latency=${latency}ms`);
      return [];
    }

    // Validate and clean each note
    const validated: ScribeNote[] = [];
    for (const raw of rawNotes) {
      if (!raw || typeof raw !== 'object') continue;
      if (typeof raw.text !== 'string' || typeof raw.category !== 'string') continue;

      // Trim + collapse whitespace (Appendix H)
      const text = raw.text.trim().replace(/\s{2,}/g, ' ');
      const category = raw.category;

      // Length check
      if (text.length < 15 || text.length > 200) continue;

      // Category check
      if (!SCRIBE_ALLOWED_CATEGORIES.has(category)) continue;

      // Tag validation — filter invalid tags, keep note with [] if needed
      const rawTags = Array.isArray(raw.tags) ? raw.tags.filter((t: unknown): t is string => typeof t === 'string') : [];
      const allowedSet = SCRIBE_ALLOWED_TAGS[category];
      const validTags = allowedSet ? rawTags.filter((t: string) => allowedSet.has(t)) : [];

      // Within-response dedup (Appendix H) — skip near-identical notes
      const tokens = tokenize(text);
      const isDupe = validated.some(existing => {
        if (existing.category !== category) return false;
        return jaccardSimilarity(tokens, tokenize(existing.text)) > 0.8;
      });
      if (isDupe) continue;

      validated.push({ text, category, tags: validTags });

      // Cap at 5 notes
      if (validated.length >= 5) break;
    }

    if (validated.length === 0) {
      console.log(`[SCRIBE_WAI] stage=${currentStage} notes=0 latency=${latency}ms (nothing memory-worthy)`);
    } else {
      console.log(`[SCRIBE_WAI] stage=${currentStage} notes=${validated.length} latency=${latency}ms`);
    }

    return validated;
  } catch (err: any) {
    const latency = Date.now() - start;
    if (err.message === 'timeout') {
      console.log(`[SCRIBE_WAI_TIMEOUT] stage=${currentStage} timeout=${timeoutMs}ms`);
    } else {
      console.log(`[SCRIBE_WAI_ERR] stage=${currentStage} reason=${err.message?.slice(0, 100)} latency=${latency}ms`);
    }
    return [];
  }
}

// ─── POST /notes Caller ─────────────────────────────────────────────────────

export async function postNotesToBrain(
  callId: string,
  turnIndex: number,
  notes: ScribeNote[],
  brainBinding: Fetcher,
): Promise<void> {
  try {
    const res = await brainBinding.fetch(
      new Request(`https://do-internal/notes?callId=${encodeURIComponent(callId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-call-id': callId },
        body: JSON.stringify({ callId, turnIndex, notes }),
      }),
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => 'no-body');
      console.log(`[SCRIBE_POST_ERR] callId=${callId} reason=http_${res.status} body_len=${errText.length}`);
      return;
    }

    const result = await res.json() as { accepted?: number; rejected?: number; results?: Array<{ status: string; reason?: string }> };
    const accepted = result.accepted ?? 0;
    const rejected = result.rejected ?? 0;

    console.log(`[SCRIBE_POST] callId=${callId} turnIndex=${turnIndex} accepted=${accepted} rejected=${rejected}`);

    // Log rejection reasons (never raw note text)
    if (rejected > 0 && Array.isArray(result.results)) {
      const reasons = result.results
        .filter(r => r.status === 'rejected' && r.reason)
        .map(r => r.reason);
      if (reasons.length > 0) {
        console.log(`[SCRIBE_POST_REJECTED] callId=${callId} reasons=${reasons.join(',')}`);
      }
    }
  } catch (err: any) {
    console.log(`[SCRIBE_POST_ERR] callId=${callId} reason=${err.message?.slice(0, 100)}`);
  }
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

export async function runScribe(
  utterance: string,
  recentTurns: Array<{ role: string; content: string }>,
  currentStage: string,
  activeMemoryTitles: string[],
  callId: string,
  turnIndex: number,
  env: { AI: any },
  brainBinding: Fetcher,
): Promise<void> {
  try {
    // 1. Eligibility gate
    const eligibility = isScribeEligible(utterance);
    if (!eligibility.eligible) {
      console.log(`[SCRIBE_SKIP] callId=${callId} reason=${eligibility.reason} chars=${utterance.trim().length}`);
      return;
    }

    // Optional signal observability (not a gate — for metrics/tuning only)
    const hasSignal = SIGNAL_PATTERN.test(utterance);
    if (!hasSignal) {
      console.log(`[SCRIBE_META] callId=${callId} signal=false chars=${utterance.trim().length} (sent to Workers AI anyway)`);
    }

    // 2. Build Workers AI messages
    const messages = buildScribeMessages(utterance, recentTurns, currentStage, activeMemoryTitles);

    // 3. Call Workers AI
    const notes = await callScribeWorkersAI(messages, currentStage, env);

    // 4. Check for empty result
    if (notes.length === 0) {
      console.log(`[SCRIBE_SKIP] callId=${callId} reason=wai_empty`);
      return;
    }

    // 5. Post to brain DO
    await postNotesToBrain(callId, turnIndex, notes, brainBinding);

    // 6. Summary
    console.log(`[SCRIBE_DONE] callId=${callId} stage=${currentStage} generated=${notes.length}`);
  } catch (err: any) {
    console.log(`[SCRIBE_ERR] callId=${callId} ${err.message?.slice(0, 150)}`);
  }
}
