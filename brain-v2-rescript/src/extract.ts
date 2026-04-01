/**
 * call-brain-do/src/extract.ts — v3.0.0-bella-v2
 * V2 deterministic regex extraction, correction-aware overwrites,
 * memory note detection, and transcript logging.
 *
 * Exports:
 *   parseNumber, normalizeSpokenNumbers  — battle-tested number parsers (ported from V1)
 *   extractFromTranscript                — V2 extraction with V2 StageId + field names
 *   applyExtraction                      — writes V2 fields to ConversationState
 *   extractBellaMemoryNotes              — detects commitments from Bella spoken text
 *   appendTranscript                     — appends to transcriptLog with 200-entry cap
 *
 * Memory note inclusion rules:
 *   Notes are created ONLY when an utterance contains one or more of:
 *     - explicit preference, personal identity/detail
 *     - business context, staff/relationship structure
 *     - recurring objection/concern, operational constraint
 *     - scheduling preference, trust/communication preference
 *     - buying signal / disqualifier
 *     - correction to a previously remembered fact
 *   Filler, pleasantries, and low-value one-off chatter are ignored.
 *
 * Supersession / contradiction handling:
 *   When `correctionDetected` is true, `applyExtraction` overwrites existing scalar values.
 *   For memory notes, the newest note is marked active and the older contradicted note
 *   gets `status='superseded'` and `supersededById` set to the new note's stable ID.
 *   Only explicit, clear contradictions trigger supersession — ambiguous statements
 *   are stored as additional notes without superseding.
 */

import type {
  ExtractionResult,
  ConversationState,
  UnifiedLeadState,
  StageId,
  ResponseSpeedBand,
  TranscriptEntry,
  MemoryNote,
  MemoryCategory,
} from './types';

// ─── Word maps ───────────────────────────────────────────────────────────────

const WORD_MAP: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90, hundred: 100,
};

// ─── parseNumber ─────────────────────────────────────────────────────────────

export function parseNumber(raw: string): number | null {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/,/g, '').replace(/\s+/g, ' ').trim();

  // Compound word phrases
  if (/quarter\s*(?:of\s*a\s*)?mill/i.test(s)) return 250000;
  if (/half\s*(?:a\s*)?mill/i.test(s)) return 500000;
  if (/(?:three\s*quarter|750)\s*(?:of\s*a\s*)?mill/i.test(s)) return 750000;
  if (/(?:a|one)\s*mill/i.test(s)) return 1000000;
  if (/(?:two|2)\s*mill/i.test(s)) return 2000000;
  if (/(?:a|one)\s*hundred\s*(?:thousand|k|grand)/i.test(s)) return 100000;
  if (/(?:a|one)\s*(?:thousand|grand)/i.test(s)) return 1000;
  if (/couple\s*(?:of\s*)?(?:thousand|grand)/i.test(s)) return 2000;
  if (/couple\s*(?:of\s*)?hundred/i.test(s)) return 200;
  if (/few\s*(?:thousand|grand)/i.test(s)) return 3000;
  if (/few\s*hundred/i.test(s)) return 300;

  // "[unit] hundred [and] [tens] thousand"
  const hundredThousandMatch = s.match(
    /\b(one|two|three|four|five|six|seven|eight|nine)\s*hundred\s*(?:and\s*)?(fifty|twenty|thirty|forty|sixty|seventy|eighty|ninety)?\s*(?:thousand|k|grand)\b/i
  );
  if (hundredThousandMatch) {
    const hundreds = WORD_MAP[hundredThousandMatch[1].toLowerCase()] ?? 0;
    const tens = hundredThousandMatch[2] ? (WORD_MAP[hundredThousandMatch[2].toLowerCase()] ?? 0) : 0;
    return (hundreds * 100 + tens) * 1000;
  }

  if (/couple\s*(?:of\s*)?hundred\s*(?:thousand|k|grand)/i.test(s)) return 200000;

  // "[unit] [tens] K/thousand"
  const unitTensKMatch = s.match(
    /\b(one|two|three|four|five|six|seven|eight|nine)\s+(fifty|twenty|thirty|forty|sixty|seventy|eighty|ninety)\s*(?:k|thousand|grand)\b/i
  );
  if (unitTensKMatch) {
    const hundreds = WORD_MAP[unitTensKMatch[1].toLowerCase()] ?? 0;
    const tens = WORD_MAP[unitTensKMatch[2].toLowerCase()] ?? 0;
    return (hundreds * 100 + tens) * 1000;
  }

  // "[tens] [ones] thousand"
  const wordThousandMatch = s.match(
    /^(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-]*(one|two|three|four|five|six|seven|eight|nine)?\s*(?:thousand|grand|k)\b/
  );
  if (wordThousandMatch) {
    const tens = WORD_MAP[wordThousandMatch[1]] ?? 0;
    const ones = wordThousandMatch[2] ? (WORD_MAP[wordThousandMatch[2]] ?? 0) : 0;
    return (tens + ones) * 1000;
  }

  // Single word × thousand
  for (const [word, val] of Object.entries(WORD_MAP)) {
    if (new RegExp(`^${word}\\s*(?:thousand|grand|k)\\b`).test(s)) return val * 1000;
    if (new RegExp(`^${word}\\s*hundred\\s*(?:thousand|grand|k)\\b`).test(s)) return val * 100000;
  }

  // Digit-based with suffix: "$250k", "1.5m", "2k", "500"
  const digitMatch = s.match(/\$?\s*(\d+(?:\.\d+)?)\s*(k|m|mil|million|thousand|grand|hundred)?/);
  if (digitMatch) {
    let num = parseFloat(digitMatch[1]);
    const suffix = digitMatch[2]?.toLowerCase() ?? '';
    if (suffix === 'k' || suffix === 'thousand' || suffix === 'grand') num *= 1000;
    else if (suffix === 'm' || suffix === 'mil' || suffix === 'million') num *= 1000000;
    else if (suffix === 'hundred') num *= 100;
    if (num > 0) return Math.round(num);
  }

  // Simple word numbers
  for (const [word, val] of Object.entries(WORD_MAP)) {
    if (s === word || s === `a ${word}`) return val;
  }

  return null;
}

// ─── normalizeSpokenNumbers ──────────────────────────────────────────────────

export function normalizeSpokenNumbers(text: string): string {
  const units: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  };
  const tens: Record<string, number> = {
    twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
    seventy: 70, eighty: 80, ninety: 90,
  };

  let s = text.toLowerCase();

  // Article + magnitude
  s = s.replace(/\ba\s+hundred\b/gi, '100');
  s = s.replace(/\ba\s+thousand\b/gi, '1000');
  s = s.replace(/\ba?\s*couple\s*(?:of\s*)?hundred\b/gi, '200');
  s = s.replace(/\ba?\s*few\s*hundred\b/gi, '300');
  s = s.replace(/\ba?\s*couple\s*(?:of\s*)?thousand\b/gi, '2000');
  s = s.replace(/\ba?\s*few\s*thousand\b/gi, '3000');
  // Qualifier + bare magnitude
  s = s.replace(/(?:about|around|roughly|maybe|probably|say|like|approximately)\s+hundred\b/gi, m => m.replace(/hundred/i, '100'));
  s = s.replace(/(?:about|around|roughly|maybe|probably|say|like|approximately)\s+thousand\b/gi, m => m.replace(/thousand/i, '1000'));

  const unitPat = Object.keys(units).join('|');
  const tensPat = Object.keys(tens).join('|');

  // X hundred [and] [Y[-Z]] thousand
  s = s.replace(
    new RegExp(`\\b(${unitPat})\\s+hundred\\s*(?:and\\s*)?(${tensPat})(?:[\\s-](${unitPat}))?\\s+thousand\\b`, 'gi'),
    (_, u, t, o) => String(((units[u.toLowerCase()] || 0) * 100 + (tens[t.toLowerCase()] || 0) + (o ? (units[o.toLowerCase()] || 0) : 0)) * 1000)
  );
  // X hundred thousand
  s = s.replace(
    new RegExp(`\\b(${unitPat})\\s+hundred\\s+thousand\\b`, 'gi'),
    (_, u) => String((units[u.toLowerCase()] || 0) * 100000)
  );
  // X thousand
  s = s.replace(
    new RegExp(`\\b(${unitPat}|${tensPat})\\s+thousand\\b`, 'gi'),
    (_, w) => String(((units[w.toLowerCase()] ?? tens[w.toLowerCase()]) || 0) * 1000)
  );
  // [unit] hundred [and] [tens[-unit]]
  s = s.replace(
    new RegExp(`\\b(${unitPat})\\s+hundred\\s*(?:and\\s*)?(${tensPat})(?:[\\s-](${unitPat}))?\\b`, 'gi'),
    (_, u, t, o) => String((units[u.toLowerCase()] || 0) * 100 + (tens[t.toLowerCase()] || 0) + (o ? (units[o.toLowerCase()] || 0) : 0))
  );
  // [unit] hundred
  s = s.replace(
    new RegExp(`\\b(${unitPat})\\s+hundred\\b`, 'gi'),
    (_, u) => String((units[u.toLowerCase()] || 0) * 100)
  );
  // [tens][-][unit]
  s = s.replace(
    new RegExp(`\\b(${tensPat})[\\s-](${unitPat})\\b`, 'gi'),
    (_, t, u) => String((tens[t.toLowerCase()] || 0) + (units[u.toLowerCase()] || 0))
  );
  // Standalone tens
  s = s.replace(
    new RegExp(`\\b(${tensPat})\\b(?!\\s*(?:${unitPat}|hundred|thousand))`, 'gi'),
    (_, t) => String(tens[t.toLowerCase()] || 0)
  );
  // Standalone units 2-19 with context
  const contextPat = `(?:about|around|roughly|maybe|probably|say|like|approximately|get|getting|have|had|do|did|see|saw|receive|received|handle|handled|average|total)\\s+`;
  for (const [word, val] of Object.entries(units)) {
    if (val < 2) continue;
    s = s.replace(
      new RegExp(`(?:${contextPat})\\b${word}\\b`, 'gi'),
      match => match.replace(new RegExp(`\\b${word}\\b`, 'i'), String(val))
    );
  }

  return s;
}

// ─── Correction detection ───────────────────────────────────────────────────

const CORRECTION_SIGNALS = /\b(actually|sorry|wait|I mean|not quite|correction|that'?s wrong|let me correct|no(?:\s*,|\s+it'?s|\s+that'?s|\s+I|\s+we))\b/i;

function detectCorrection(text: string): boolean {
  return CORRECTION_SIGNALS.test(text);
}

// ─── Response speed band extraction ─────────────────────────────────────────

function extractResponseSpeedBand(text: string): ResponseSpeedBand | null {
  const s = text.toLowerCase();
  if (/(?:instant|immediate|right away|straight away|within.*seconds?|under.*seconds?)/i.test(s)) return 'under_30_seconds';
  if (/(?:within.*minute|couple.*minute|under.*(?:five|5).*minute|pretty quick|minute or two)/i.test(s)) return 'under_5_minutes';
  if (/(?:within.*(?:half|30).*(?:hour|min)|10.*(?:to|-).*20.*min|under.*30.*min|(?:fifteen|15|twenty|20).*min)/i.test(s)) return '5_to_30_minutes';
  // Numeric weeks: "2 weeks", "a week" etc. (after normalizeSpokenNumbers) — always next_day_plus
  if (/\b(\d+)\s*weeks?\b/i.test(s) || /\b(?:a|one)\s+week\b/i.test(s)) return 'next_day_plus';
  // Numeric days: "3 days", "1 day" etc. (after normalizeSpokenNumbers)
  const daysMatch = s.match(/\b(\d+)\s*days?\b/);
  if (daysMatch) {
    const d = parseInt(daysMatch[1]);
    if (d <= 1) return '2_to_24_hours'; // "1 day" ≈ same day
    return 'next_day_plus';             // "2 days", "3 days", etc.
  }
  // Numeric hours: "8 hours", "3 hours", "24 hours" etc. (after normalizeSpokenNumbers)
  // Must come BEFORE generic "within.*hour" to correctly classify "within 24 hours" as 2_to_24_hours
  const hoursMatch = s.match(/\b(\d+)\s*hours?\b/);
  if (hoursMatch) {
    const h = parseInt(hoursMatch[1]);
    if (h <= 2) return '30_minutes_to_2_hours';
    if (h <= 24) return '2_to_24_hours';
    return 'next_day_plus';
  }
  if (/(?:within.*hour|couple.*hour|an hour|hour or two)/i.test(s)) return '30_minutes_to_2_hours';
  if (/(?:same day|few hours|later that day|end of day|half a day)/i.test(s)) return '2_to_24_hours';
  if (/(?:next day|day or two|couple.*day|next business|few days|tomorrow)/i.test(s)) return 'next_day_plus';
  if (/(?:depends|varies|usually|generally|try to|we try)/i.test(s)) return '2_to_24_hours';
  return null;
}

// ─── Percentage extraction ──────────────────────────────────────────────────

function extractPercentage(text: string): number | null {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)/i);
  if (match) {
    const val = parseFloat(match[1]);
    if (val > 0 && val <= 100) return val / 100;
  }
  return null;
}

// ─── Memory note ID generation ──────────────────────────────────────────────

function generateNoteId(category: string, text: string, turnIndex: number, source: string): string {
  let hash = 0;
  const str = (source + ':' + text).slice(0, 60);
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  return `${category}-${hex}-t${turnIndex}`;
}

/** Assign scope based on category — session for transient, lead for personal, account for business-wide */
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

/**
 * Produce a stable comparison key from commitment note text.
 * Normalizes contractions, casing, whitespace, punctuation, and context ellipsis
 * so "I'll send that over" and "I will send that over..." compare as equal.
 */
export function commitmentKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/^\.{3}/, '')          // strip leading ellipsis
    .replace(/\.{3}$/, '')          // strip trailing ellipsis
    .replace(/i'll/g, 'i will')     // normalize contraction
    .replace(/let's/g, 'let us')
    .replace(/that's/g, 'that is')
    .replace(/[^a-z0-9 ]/g, '')     // strip all punctuation
    .replace(/\s+/g, ' ')           // collapse whitespace
    .trim();
}

// ─── ACV industry multiplier (ported from bridge monolith) ──────────────────

/**
 * Infer a multiplier for ambiguous ACV values based on industry.
 * Bridge monolith gold — deepgram-bridge-v11/src/index.ts lines 875-888.
 * Extended with keywords from DO's KEYWORD_MAP in intel.ts: wealth, financial, landscap.
 */
export function inferAcvMultiplier(industry: string): number {
  const ind = industry.toLowerCase();
  if (/legal|law|consult|advisory|account|finance|financial|wealth|insurance|enterprise|corporate/.test(ind)) return 1000;
  if (/real.?estate|property|agency|market|architect|engineer/.test(ind)) return 100;
  if (/dental|medical|health|physio|chiro|gym|fitness|beauty|salon/.test(ind)) return 10;
  if (/trade|plumb|electric|build|construct|hvac|roof|landscap/.test(ind)) return 100;
  if (/restaurant|cafe|hospit|hotel|retail|shop|store/.test(ind)) return 1;
  return 10;
}

// ─── Memory note detection ──────────────────────────────────────────────────

interface MemoryPattern {
  pattern: RegExp;
  category: MemoryCategory;
  tags?: string[];
}

const MEMORY_PATTERNS: MemoryPattern[] = [
  // Personal
  { pattern: /\bmy\s+(?:wife|husband|partner|son|daughter|kids?|family|father|mother|dad|mum|mom|brother|sister)\b/i, category: 'personal', tags: ['family'] },
  { pattern: /\bI(?:'m|\s+am)\s+a\s+(?:big\s+)?fan\s+of\b/i, category: 'personal', tags: ['interest'] },
  { pattern: /\bI\s+love\s+(?!it\b|that\b|this\b)/i, category: 'personal', tags: ['interest'] },
  { pattern: /\bmy\s+fav(?:ou?rite)\b/i, category: 'personal', tags: ['preference'] },
  { pattern: /\bI\s+(?:follow|support|barrack for|go for)\s+/i, category: 'personal', tags: ['sport', 'interest'] },

  // Business context
  { pattern: /\bwe(?:'re|\s+are)\s+open\b/i, category: 'business_context', tags: ['hours'] },
  { pattern: /\bour\s+busiest\b/i, category: 'business_context', tags: ['peak'] },
  { pattern: /\bwe\s+only\s+(?:do|handle|take|service|work)\b/i, category: 'business_context', tags: ['scope'] },
  { pattern: /\bwe\s+don'?t\s+(?:do|handle|take|service|offer)\b/i, category: 'business_context', tags: ['scope'] },
  { pattern: /\bwe\s+focus\s+on\b/i, category: 'business_context', tags: ['specialty'] },
  { pattern: /\bwe(?:'ve|\s+have)\s+(?:been|started|opened)\b/i, category: 'business_context', tags: ['history'] },
  { pattern: /\b(?:expanding|growing|opening|second|third|new)\s+(?:location|office|branch|store|clinic|site)\b/i, category: 'business_context', tags: ['expansion'] },
  { pattern: /\b(?:\d+|couple|few|several)\s+(?:staff|employees?|team\s+members?|people)\b/i, category: 'business_context', tags: ['team_size'] },

  // Objection
  { pattern: /\bwe\s+tried\b/i, category: 'objection', tags: ['past_experience'] },
  { pattern: /\bdidn'?t\s+work\b/i, category: 'objection', tags: ['past_failure'] },
  { pattern: /\btoo\s+expensive\b/i, category: 'objection', tags: ['price'] },
  { pattern: /\bwe\s+hate\b/i, category: 'objection', tags: ['aversion'] },
  { pattern: /\bwe(?:'re|\s+are)\s+not\s+interested\s+in\b/i, category: 'objection', tags: ['disinterest'] },
  { pattern: /\bconcern(?:ed)?\s+about\b/i, category: 'objection', tags: ['concern'] },
  { pattern: /\bpreviously\s+burned\b/i, category: 'objection', tags: ['past_experience'] },
  { pattern: /\bbad\s+experience\b/i, category: 'objection', tags: ['past_experience'] },

  // Relationship / staff
  { pattern: /\bmy\s+(?:receptionist|office\s+manager|assistant|admin|secretary|PA)\b/i, category: 'relationship', tags: ['staff'] },
  { pattern: /\b(?:my\s+)?(?:business\s+)?partner\s+(?:handles?|does|manages?|runs?|looks?\s+after)\b/i, category: 'relationship', tags: ['decision_maker'] },
  { pattern: /\b(\w+)\s+(?:handles?|does|manages?|runs?|looks?\s+after)\s+(?:the\s+)?(?:calls?|phones?|leads?|marketing|sales|admin|reception)\b/i, category: 'relationship', tags: ['staff'] },
  { pattern: /\bmy\s+(?:daughter|son|wife|husband|partner)\s+(?:handles?|does|manages?|runs?|works)\b/i, category: 'relationship', tags: ['family_staff'] },

  // Constraint
  { pattern: /\bbudget\s+is\b/i, category: 'constraint', tags: ['budget'] },
  { pattern: /\bwe\s+can'?t\b/i, category: 'constraint', tags: ['limitation'] },
  { pattern: /\blimited\s+to\b/i, category: 'constraint', tags: ['limitation'] },
  { pattern: /\bonly\s+available\b/i, category: 'constraint', tags: ['availability'] },
  { pattern: /\bnot\s+on\s+weekends?\b/i, category: 'constraint', tags: ['scheduling'] },

  // Scheduling
  { pattern: /\b(?:mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?)\s+(?:are?|is)\b/i, category: 'scheduling', tags: ['day'] },
  { pattern: /\bbusiest\s+(?:day|time|period)\b/i, category: 'scheduling', tags: ['peak'] },
  { pattern: /\bafter\s+hours\b/i, category: 'scheduling', tags: ['hours'] },
  { pattern: /\bbefore\s+(?:\d+|nine|eight|seven)\b/i, category: 'scheduling', tags: ['hours'] },
  { pattern: /\bclose(?:s)?\s+(?:early|at)\b/i, category: 'scheduling', tags: ['hours'] },

  // Communication style
  { pattern: /\bI\s+prefer\s+(?:text|sms|email|call|phone)/i, category: 'communication_style', tags: ['channel_preference'] },
  { pattern: /\bonly\s+want\s+(?:text|sms|email|call|phone)/i, category: 'communication_style', tags: ['channel_preference'] },
  { pattern: /\bdon'?t\s+(?:call|email|text)\s+me\b/i, category: 'communication_style', tags: ['channel_preference'] },

  // Process / follow-up method
  { pattern: /\b(?:goes?|goes? straight|rings?|end up|straight)\s+(?:to\s+)?voicemail\b/i, category: 'business_context', tags: ['voicemail'] },
  { pattern: /\bnobody\s+(?:answers?|picks?\s*up|responds?)\b/i, category: 'business_context', tags: ['voicemail'] },
  { pattern: /\blet\s+(?:it|them|calls?)\s+(?:ring|go)\b/i, category: 'business_context', tags: ['voicemail'] },
  { pattern: /\b(?:we|I)\s+(?:call|ring|chase|follow)\s+(?:them|people|leads?)\s+back\b/i, category: 'business_context', tags: ['follow_up_method'] },
  { pattern: /\b(?:we|I)\s+(?:send|use)\s+(?:a\s+)?(?:follow[\s-]?up|callback|auto[\s-]?reply|auto[\s-]?respond)/i, category: 'business_context', tags: ['follow_up_method'] },
  { pattern: /\b(?:no[\s-]?one|nobody|don'?t|never)\s+(?:follows?\s+up|gets?\s+back|responds?|chases?)/i, category: 'business_context', tags: ['no_follow_up'] },
  { pattern: /\b(?:we|I)\s+(?:use|'re\s+on|'re\s+using|run|have)\s+(?:a\s+)?(?:Google\s+(?:Form|Sheet|Doc)|spreadsheet|paper|sticky\s+note|whiteboard|notebook|Excel)/i, category: 'business_context', tags: ['manual_process'] },
  { pattern: /\b(?:we|I)\s+(?:use|'re\s+on|'re\s+using|run|have)\s+(?:a\s+)?(?:CRM|Salesforce|HubSpot|Cliniko|ServiceM8|Jobber|Xero|MYOB|Pipedrive|Zoho|Monday|Freshworks|HighLevel|GoHighLevel)/i, category: 'business_context', tags: ['current_tool'] },
  { pattern: /\b(?:we|I)\s+(?:use|'re\s+on|'re\s+using)\s+\w+\s+(?:for|to\s+(?:manage|track|handle|run))\b/i, category: 'business_context', tags: ['current_tool'] },

  // Pain / urgency / decision gate
  { pattern: /\b(?:biggest|main|number\s+one|worst)\s+(?:problem|challenge|issue|headache|struggle|pain\s+point)\b/i, category: 'objection', tags: ['pain_point'] },
  { pattern: /\b(?:killing|drowning|losing|bleeding|costing)\s+(?:us|me)\b/i, category: 'objection', tags: ['pain_point'] },
  { pattern: /\bkeeps?\s+me\s+(?:up|awake)\b/i, category: 'objection', tags: ['pain_point'] },
  { pattern: /\b(?:need|have|want|got)\s+to\s+(?:sort|fix|solve|address|deal\s+with)\s+(?:this|it|that)\b/i, category: 'constraint', tags: ['timeline'] },
  { pattern: /\b(?:this\s+(?:month|quarter|week)|as\s+soon\s+as|asap|urgently?|right\s+away|before\s+(?:end\s+of|christmas|easter|eofy|new\s+year))\b/i, category: 'constraint', tags: ['timeline'] },
  { pattern: /\b(?:need\s+to|have\s+to|got\s+to)\s+(?:talk|check|run\s+it\s+(?:by|past)|speak|discuss\s+(?:it\s+)?with)\s+(?:my\s+)?(?:partner|wife|husband|boss|business\s+partner|co[\s-]?founder|accountant|the\s+team)\b/i, category: 'constraint', tags: ['decision_gate'] },
  { pattern: /\b(?:looking\s+to|want\s+to|trying\s+to|need\s+to|planning\s+to)\s+(?:hire|scale|grow|expand|double|triple|bring\s+on)\b/i, category: 'business_context', tags: ['growth_intent'] },

  // Competitor / tool / marketing spend
  { pattern: /\b(?:also\s+)?(?:talking\s+to|looking\s+at|comparing|spoke\s+to|met\s+with|got\s+a\s+quote\s+from|currently\s+with|signed\s+up\s+with)\s+\w+/i, category: 'business_context', tags: ['competitor'] },
  { pattern: /\b(?:used\s+to\s+use|switched\s+from|moved\s+away\s+from|left|cancelled|ditched)\s+\w+/i, category: 'objection', tags: ['past_vendor'] },
  { pattern: /\bspend(?:ing)?\s+(?:about\s+)?(?:\$[\d,.]+\s*(?:k|K)?|[\d,.]+\s*(?:k|K|thousand|grand|hundred))\s+(?:a\s+)?(?:month|week|year|quarter)\b/i, category: 'business_context', tags: ['marketing_spend'] },
  { pattern: /\b(?:marketing|ad|ads|advertising)\s+(?:budget|spend)\s+(?:is|of)\b/i, category: 'business_context', tags: ['marketing_spend'] },

  // Commitment / promise (detected from Bella utterances via extractBellaMemoryNotes)
  { pattern: /\bI(?:'ll| will)\s+(?:send|email|follow up|call you|get back|set up|prepare|share|arrange)\b/i, category: 'commitment', tags: ['follow_up'] },
  { pattern: /\bI(?:'ll| will)\s+(?:make sure|ensure|check|confirm|look into)\b/i, category: 'commitment', tags: ['action_item'] },
  { pattern: /\blet me\s+(?:set that up|arrange|check|get|send|prepare)\b/i, category: 'commitment', tags: ['action_item'] },
  { pattern: /\bnext step\b/i, category: 'commitment', tags: ['next_step'] },
  { pattern: /\bI(?:'ll| will)\s+have\s+(?:that|it|everything)\s+(?:ready|done|sent|prepared)\b/i, category: 'commitment', tags: ['deliverable'] },
];

// Filler check — don't create notes from pure filler
const FILLER_ONLY = /^((yeah|yep|yes|yup|sure|ok|okay|mm+h?m?|uh\s*huh|right|got\s*it|hmm+|ah+|oh+|cool|nice|alright|sounds?\s*good|go\s*ahead|go\s*for\s*it|sure\s*thing|for\s*sure|that'?s?\s*fine|no\s*worries|haha|fair\s*enough|give\s*me\s*a\s*sec|I'?m\s*driving)\s*[.,!?]*\s*)+$/i;

function detectMemoryNotes(text: string, turnIndex: number): MemoryNote[] {
  if (FILLER_ONLY.test(text.trim())) return [];
  if (text.trim().length < 10) return [];

  const notes: MemoryNote[] = [];
  for (const mp of MEMORY_PATTERNS) {
    if (mp.pattern.test(text)) {
      // Extract the surrounding context for the note text (up to 120 chars around the match)
      const match = text.match(mp.pattern);
      if (!match) continue;

      const idx = match.index ?? 0;
      const start = Math.max(0, idx - 30);
      const end = Math.min(text.length, idx + match[0].length + 60);
      let noteText = text.slice(start, end).trim();
      if (start > 0) noteText = '...' + noteText;
      if (end < text.length) noteText = noteText + '...';

      const noteId = generateNoteId(mp.category, noteText, turnIndex, 'user');
      notes.push({
        id: noteId,
        text: noteText,
        category: mp.category,
        tags: mp.tags,
        source: 'user',
        sourceTurnIndex: turnIndex,
        confidence: 'stated',
        createdAt: new Date().toISOString(),
        status: 'active',
        scope: scopeForCategory(mp.category),
        salience: 2,
      });
    }
  }

  return notes;
}

// ─── extractFromTranscript (V2) ─────────────────────────────────────────────

export function extractFromTranscript(
  transcript: string,
  targets: string[],
  stage: StageId,
  industryLabel?: string,
  currentState?: Partial<ConversationState>,
): ExtractionResult {
  const s = normalizeSpokenNumbers(transcript.toLowerCase());
  const fields: Record<string, number | string | boolean | null> = {};
  const normalized: Record<string, string> = {};
  const correctionDetected = detectCorrection(transcript);

  if (s !== transcript.toLowerCase()) {
    normalized['_spoken'] = transcript;
    normalized['_normalized'] = s;
  }

  // If correction detected, broaden targets to all scalar fields
  const effectiveTargets = correctionDetected
    ? [...new Set([...targets, 'acv', 'inboundLeads', 'inboundConversions', 'inboundConversionRate',
        'webLeads', 'webConversions', 'webConversionRate', 'phoneVolume', 'missedCalls',
        'missedCallRate', 'responseSpeedBand',
        'leadSourceDominant', 'websiteRelevant', 'phoneRelevant', 'adsConfirmed'])]
    : targets;

  // ── ACV ──
  if (effectiveTargets.includes('acv') && (stage === 'anchor_acv' || stage === 'wow' || correctionDetected)) {
    const dollarMatch = s.match(/\$\s*([\d,.]+\s*(?:k|m|mil|million|thousand|grand|hundred)?)/i)
      ?? s.match(/(?:about|around|roughly|maybe|probably|say|like|approximately)?\s*(?:\$\s*)?([\d,.]+\s*(?:k|m|mil|million|thousand|grand|hundred))\b/i)
      ?? s.match(/((?:quarter|half|three quarter|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred).{0,15}(?:thousand|grand|k|million|mil|m|hundred thousand))/i);
    if (dollarMatch) {
      const val = parseNumber(dollarMatch[1] ?? dollarMatch[0]);
      if (val && val >= 100) {
        fields.acv = val;
        normalized.acv = dollarMatch[0];
      }
    }
    if (!fields.acv) {
      const bareMatch = s.match(/\b(\d{3,7})\b/);
      if (bareMatch) {
        const val = parseInt(bareMatch[1]);
        if (val >= 500 && val <= 10000000) {
          fields.acv = val;
          normalized.acv = bareMatch[0];
        }
      }
    }
  }

  // ── Inbound leads (Alex — ch_alex) ──
  if (effectiveTargets.includes('inboundLeads') && (stage === 'ch_alex' || correctionDetected)) {
    const leadMatch = s.match(/(?:about|around|roughly|maybe|probably|say|like|get|getting)?\s*(\$?[\d,.]+\s*(?:k|thousand)?)\s*(?:leads?|enquir|inqu|a\s+week|a\s+month)/i);
    if (leadMatch) {
      const val = parseNumber(leadMatch[1]);
      if (val && val > 0) { fields.inboundLeads = val; normalized.inboundLeads = leadMatch[0]; }
    }
    if (!fields.inboundLeads) {
      const standaloneMatch = s.match(/(?:about|around|roughly|maybe|probably|say|like|get|getting)?\s*(?:a\s+)?(thousand|hundred|[\d,.]+\s*(?:k|thousand)?|couple\s+hundred|few\s+hundred)/i);
      if (standaloneMatch) {
        const val = parseNumber(standaloneMatch[0]);
        const acv = currentState?.acv ?? 0;
        const isAcvMatch = val !== null && acv > 0 && (val === acv || val === acv / 10 || val === acv / 100 || val === acv / 1000 || val * 10 === acv || val * 100 === acv || val * 1000 === acv);
        if (val && val > 0 && !isAcvMatch) { fields.inboundLeads = val; normalized.inboundLeads = standaloneMatch[0]; }
      }
    }
    // Bare number fallback — only for SHORT direct answers (not historical RE_EXTRACT context).
    // Guards: text < 50 chars (direct answer), not an ACV fragment, not ACV itself.
    if (!fields.inboundLeads && currentState?.inboundLeads == null && s.length < 50) {
      const bareNum = s.match(/\b(\d{1,4})\b/);
      if (bareNum) {
        const val = parseInt(bareNum[1]);
        const acv = currentState?.acv ?? 0;
        const isAcvFragment = acv > 0 && (acv === val * 1000 || acv === val * 100 || acv === val * 10 || val === acv);
        if (val > 0 && val < 10000 && !isAcvFragment) {
          fields.inboundLeads = val;
          normalized.inboundLeads = bareNum[0];
        }
      }
    }
  }

  // ── Inbound conversions (Alex — ch_alex) ──
  if (effectiveTargets.includes('inboundConversions') && (stage === 'ch_alex' || correctionDetected)) {
    const convMatch = s.match(/(?:about|around|roughly|maybe|probably|say|like|convert|converting|become|turn into)?\s*(\d+(?:\.\d+)?)\s*(?:convert|become|turn|close|sale|client|customer|booking|job|patient)/i);
    if (convMatch) {
      const val = parseInt(convMatch[1]);
      if (val > 0) { fields.inboundConversions = val; normalized.inboundConversions = convMatch[0]; }
    }
    // Contextual regex fallback (secondary to Gemini):
    // Only fires when keyword-match above missed AND the prospect's answer is short/direct.
    // Guards: value must be < inboundLeads, not ACV/revenue fragment, not staff/office count.
    if (!fields.inboundConversions && !fields.inboundLeads) {
      // Negative guard: reject if utterance mentions staff, team, office, employees
      const staffContext = /\b(?:staff|team|employee|people|office|person)\b/i.test(s);
      if (!staffContext) {
        const standaloneConv = s.match(/(?:about|around|roughly|maybe|probably|say|like|oh|uh|um|yeah)?\s*(ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|\d{1,3})\b/i);
        if (standaloneConv) {
          const val = parseNumber(standaloneConv[1]);
          const acv = currentState?.acv ?? 0;
          const leads = currentState?.inboundLeads ?? Infinity;
          const isAcvFragment = acv > 0 && (val === acv || val === acv / 10 || val === acv / 100 || val === acv / 1000 || (val && (val * 10 === acv || val * 100 === acv || val * 1000 === acv)));
          // Parent-child bound: conversions must be less than leads
          if (val && val > 0 && val < leads && val <= 500 && !isAcvFragment) {
            fields.inboundConversions = val;
            normalized.inboundConversions = standaloneConv[0];
            console.log(`[SLOT_FALLBACK] stage=ch_alex slot=inboundConversions source=regex_context val=${val}`);
          }
        }
      }
    }
  }

  // ── Inbound conversion rate (Alex — ch_alex) ──
  if (effectiveTargets.includes('inboundConversionRate') && (stage === 'ch_alex' || correctionDetected)) {
    const rate = extractPercentage(s);
    if (rate != null) {
      fields.inboundConversionRate = rate;
      normalized.inboundConversionRate = `${(rate * 100).toFixed(1)}%`;
    }
  }

  // ── Response speed band (Alex — ch_alex) ──
  if (effectiveTargets.includes('responseSpeedBand') && (stage === 'ch_alex' || correctionDetected)) {
    const band = extractResponseSpeedBand(s);
    if (band) {
      fields.responseSpeedBand = band;
      normalized.responseSpeedBand = band;
    }
  }

  // ── Web leads (Chris — ch_chris) ──
  if (effectiveTargets.includes('webLeads') && (stage === 'ch_chris' || correctionDetected)) {
    // Priority 1: keyword-aware lead match (context-aware, high confidence)
    const leadMatch = s.match(/(?:get|getting|about|around|roughly|maybe)\s*(\d+)\s*(?:lead|enquir|inqu|a week|a month)/i);
    if (leadMatch) { fields.webLeads = parseInt(leadMatch[1]); normalized.webLeads = leadMatch[0]; }

    // Priority 2: greedy single-number fallback — only for SHORT direct answers
    // (not historical RE_EXTRACT context which picks up ACV fragments)
    if (!fields.webLeads && s.length < 50) {
      const numMatches = s.match(/\b(\d+)\b/g);
      if (numMatches) {
        const acv = currentState?.acv ?? 0;
        const nums = numMatches.map(n => parseInt(n)).filter(n => {
          if (n <= 0 || n >= 100000) return false;
          // Skip ACV fragments (e.g. "20" from "$20,000")
          if (acv > 0 && (acv === n * 1000 || acv === n * 100 || acv === n * 10 || n === acv)) return false;
          return true;
        });
        if (nums.length >= 1) {
          fields.webLeads = nums[0];
          normalized.webLeads = String(nums[0]);
        }
      }
    }
  }

  // ── Web conversions (Chris — ch_chris) ──
  if (effectiveTargets.includes('webConversions') && (stage === 'ch_chris' || correctionDetected) && !fields.webConversions) {
    // Keyword-aware conversion match only — no greedy multi-number extraction
    const convMatch = s.match(/(\d+)\s*(?:convert|become|turn|close|sale|client|customer)/i);
    if (convMatch) { fields.webConversions = parseInt(convMatch[1]); normalized.webConversions = convMatch[0]; }

    // Contextual regex fallback (secondary to Gemini):
    // Short direct answer with a number, no keyword needed. Guards: < webLeads, not ACV/staff.
    if (!fields.webConversions && !fields.webLeads) {
      const staffContext = /\b(?:staff|team|employee|people|office|person)\b/i.test(s);
      if (!staffContext) {
        const standaloneConv = s.match(/(?:about|around|roughly|maybe|probably|say|like|oh|uh|um|yeah)?\s*(ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|\d{1,3})\b/i);
        if (standaloneConv) {
          const val = parseNumber(standaloneConv[1]);
          const acv = currentState?.acv ?? 0;
          const leads = currentState?.webLeads ?? Infinity;
          const isAcvFragment = acv > 0 && (val === acv || val === acv / 10 || val === acv / 100 || val === acv / 1000 || (val && (val * 10 === acv || val * 100 === acv || val * 1000 === acv)));
          if (val && val > 0 && val < leads && val <= 500 && !isAcvFragment) {
            fields.webConversions = val;
            normalized.webConversions = standaloneConv[0];
            console.log(`[SLOT_FALLBACK] stage=ch_chris slot=webConversions source=regex_context val=${val}`);
          }
        }
      }
    }
  }

  // ── Web conversion rate (Chris — ch_chris) ──
  if (effectiveTargets.includes('webConversionRate') && (stage === 'ch_chris' || correctionDetected)) {
    if (!fields.webConversionRate) {
      const rate = extractPercentage(s);
      if (rate != null) {
        fields.webConversionRate = rate;
        normalized.webConversionRate = `${(rate * 100).toFixed(1)}%`;
      }
    }
  }

  // ── Phone volume (Maddie — ch_maddie) ──
  if (effectiveTargets.includes('phoneVolume') && (stage === 'ch_maddie' || correctionDetected)) {
    const phoneMatch = s.match(/(?:about|around|roughly|maybe|probably|get|getting)?\s*(\d+)\s*(?:call|phone|ring|inbound)/i);
    if (phoneMatch) { fields.phoneVolume = parseInt(phoneMatch[1]); normalized.phoneVolume = phoneMatch[0]; }
  }

  // ── Missed calls — as number (Maddie — ch_maddie) ──
  if (effectiveTargets.includes('missedCalls') && (stage === 'ch_maddie' || correctionDetected)) {
    // Try numeric missed calls
    const missedNumMatch = s.match(/(?:miss|lose|drop)(?:ing|ed)?\s+(?:about|around|roughly|maybe|probably)?\s*(\d+)/i)
      ?? s.match(/(?:about|around|roughly|maybe|probably)?\s*(\d+)\s*(?:missed|unanswered|lost|dropped)/i);
    if (missedNumMatch) {
      const val = parseInt(missedNumMatch[1]);
      if (val > 0) { fields.missedCalls = val; normalized.missedCalls = missedNumMatch[0]; }
    }

    // Contextual regex fallback (secondary to Gemini):
    // Short direct answer with a number. Guards: <= phoneVolume, not ACV/staff.
    if (!fields.missedCalls) {
      const staffContext = /\b(?:staff|team|employee|people|office|person)\b/i.test(s);
      if (!staffContext) {
        const standaloneMatch = s.match(/(?:about|around|roughly|maybe|probably|say|like|oh|uh|um|yeah)?\s*(ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|\d{1,3})\b/i);
        if (standaloneMatch) {
          const val = parseNumber(standaloneMatch[1]);
          const acv = currentState?.acv ?? 0;
          const volume = currentState?.phoneVolume ?? Infinity;
          const isAcvFragment = acv > 0 && (val === acv || val === acv / 10 || val === acv / 100 || val === acv / 1000 || (val && (val * 10 === acv || val * 100 === acv || val * 1000 === acv)));
          // Parent-child bound: missed calls must be <= phone volume
          if (val && val > 0 && val <= volume && val <= 500 && !isAcvFragment) {
            fields.missedCalls = val;
            normalized.missedCalls = standaloneMatch[0];
            console.log(`[SLOT_FALLBACK] stage=ch_maddie slot=missedCalls source=regex_context val=${val}`);
          }
        }
      }
    }
  }

  // ── Missed call rate (Maddie — ch_maddie) ──
  if (effectiveTargets.includes('missedCallRate') && (stage === 'ch_maddie' || correctionDetected)) {
    if (!fields.missedCalls) {
      const rate = extractPercentage(s);
      if (rate != null) {
        fields.missedCallRate = rate;
        normalized.missedCallRate = `${(rate * 100).toFixed(1)}%`;
      }
    }
  }

  // ── Old leads / dormant database (Sarah — ch_sarah) ──
  if (effectiveTargets.includes('oldLeads') && (stage === 'ch_sarah' || correctionDetected)) {
    const oldLeadsMatch = s.match(/(?:about|around|roughly|maybe|probably)?\s*(\d+)\s*(?:old|dormant|past|previous|inactive|dead|stale|database|leads?\s+(?:in|on|sitting))/i)
      ?? s.match(/(?:database|list|crm|system)\s+(?:of|with|has|about|around)\s+(?:about|around|roughly|maybe)?\s*(\d+)/i);
    if (oldLeadsMatch) {
      const val = parseInt(oldLeadsMatch[1]);
      if (val > 0) { fields.oldLeads = val; normalized.oldLeads = oldLeadsMatch[0]; }
    }
  }

  // ── New customers per week (James — ch_james) ──
  if (effectiveTargets.includes('newCustomersPerWeek') && (stage === 'ch_james' || correctionDetected)) {
    const custMatch = s.match(/(?:about|around|roughly|maybe|probably)?\s*(\d+)\s*(?:new|fresh)?\s*(?:customer|client|account|patient|job|project|booking)s?\s*(?:a|per|each|every)?\s*(?:week|wk)/i)
      ?? s.match(/(?:about|around|roughly|maybe|probably)?\s*(\d+)\s*(?:a|per|each|every)\s*(?:week|wk)/i);
    if (custMatch) {
      const val = parseInt(custMatch[1]);
      if (val > 0) { fields.newCustomersPerWeek = val; normalized.newCustomersPerWeek = custMatch[0]; }
    }
  }

  // ── Current Google star rating (James — ch_james) ──
  if (effectiveTargets.includes('currentStars') && (stage === 'ch_james' || correctionDetected)) {
    const starsMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:star|rating)/i)
      ?? s.match(/(?:star|rating|rated|google)\s+(?:is|at|of)?\s*(\d+(?:\.\d+)?)/i);
    if (starsMatch) {
      const val = parseFloat(starsMatch[1] ?? starsMatch[2] ?? starsMatch[0]);
      if (val >= 1 && val <= 5) { fields.currentStars = val; normalized.currentStars = starsMatch[0]; }
    }
  }

  // ── Has review system (James — ch_james) ──
  if (effectiveTargets.includes('hasReviewSystem') && (stage === 'ch_james' || correctionDetected)) {
    if (/\b(yes|yeah|yep|yup|we do|we have|got one|use|using|have a|set up|automated|system|birdeye|podium|grade\.us|trustpilot)\b/i.test(s) && /review/i.test(s)) {
      fields.hasReviewSystem = true;
      normalized.hasReviewSystem = 'yes';
    } else if (/\b(no|nah|nope|don'?t|nothing|not really|manual|haven'?t)\b/i.test(s) && /review/i.test(s)) {
      fields.hasReviewSystem = false;
      normalized.hasReviewSystem = 'no';
    }
  }

  // ── Cross-stage standalone number fallback ──
  if (Object.keys(fields).length === 0 && !['wow', 'greeting', 'recommendation', 'roi_delivery', 'close', 'optional_side_agents'].includes(stage)) {
    const standaloneNum = s.match(
      /(?:^|(?:yeah|yep|yes|yup|um|uh|so|oh|like|well|hmm|about|around|roughly|maybe|probably|say|i'?d say)\s+)(\d+(?:\.\d+)?)\s*(?:ish|or so|maybe|i think|i guess|i reckon)?/i
    );
    if (standaloneNum) {
      const val = parseFloat(standaloneNum[1]);
      const acv = currentState?.acv ?? 0;
      // Skip if value matches ACV or is an ACV fragment (e.g. "20" from "$20,000")
      const isAcvMatch = acv > 0 && (val === acv || val === acv / 10 || val === acv / 100 || val === acv / 1000 || val * 10 === acv || val * 100 === acv || val * 1000 === acv);
      if (val > 0 && !isAcvMatch) {
        let mappedTo = '';
        if (stage === 'anchor_acv' && val >= 100) { fields.acv = val; mappedTo = 'acv'; }
        else if (stage === 'ch_alex') {
          // Parent-child bound: conversions must be < leads; not staff/office context
          const alexLeads = currentState?.inboundLeads ?? Infinity;
          const alexStaffCtx = /\b(?:staff|team|employee|people|office|person)\b/i.test(s);
          if (effectiveTargets.includes('inboundConversions') && currentState?.inboundLeads != null && currentState?.inboundConversions == null && val !== currentState.inboundLeads && val < alexLeads && !alexStaffCtx) {
            fields.inboundConversions = val; mappedTo = 'inboundConversions';
          } else if (effectiveTargets.includes('inboundLeads') && currentState?.inboundLeads == null) {
            fields.inboundLeads = val; mappedTo = 'inboundLeads';
          }
        }
        else if (stage === 'ch_chris') {
          // Parent-child bound: conversions must be < webLeads; not staff/office context
          const chrisLeads = currentState?.webLeads ?? Infinity;
          const chrisStaffCtx = /\b(?:staff|team|employee|people|office|person)\b/i.test(s);
          if (effectiveTargets.includes('webConversions') && currentState?.webLeads != null && currentState?.webConversions == null && val !== currentState.webLeads && val < chrisLeads && !chrisStaffCtx) {
            fields.webConversions = val; mappedTo = 'webConversions';
          } else if (effectiveTargets.includes('webLeads') && currentState?.webLeads == null) {
            fields.webLeads = val; mappedTo = 'webLeads';
          }
        }
        else if (stage === 'ch_maddie') {
          // Parent-child bound: missed calls must be <= phoneVolume; not staff/office context
          const maddieVolume = currentState?.phoneVolume ?? Infinity;
          const maddieStaffCtx = /\b(?:staff|team|employee|people|office|person)\b/i.test(s);
          if (effectiveTargets.includes('missedCalls') && currentState?.phoneVolume != null && currentState?.missedCalls == null && val !== currentState.phoneVolume && val <= maddieVolume && !maddieStaffCtx) {
            fields.missedCalls = val; mappedTo = 'missedCalls';
          } else if (effectiveTargets.includes('phoneVolume') && currentState?.phoneVolume == null) {
            fields.phoneVolume = val; mappedTo = 'phoneVolume';
          }
        }
        else if (stage === 'ch_sarah') {
          if (effectiveTargets.includes('oldLeads') && currentState?.oldLeads == null) {
            fields.oldLeads = val; mappedTo = 'oldLeads';
          }
        }
        else if (stage === 'ch_james') {
          if (effectiveTargets.includes('newCustomersPerWeek') && currentState?.newCustomersPerWeek == null) {
            fields.newCustomersPerWeek = val; mappedTo = 'newCustomersPerWeek';
          }
        }
        if (mappedTo) console.log(`[EXTRACT_STANDALONE] stage=${stage} val=${val} targets=[${effectiveTargets}] mapped_to=${mappedTo}`);
      }
    }
  }

  // ── 24/7 phone coverage detection (cross-stage — fires regardless of stage) ──
  if (/\b(24.?7|twenty.?four.?seven|always.?(?:someone|covered|answer(?:ed|ing|s)?|staff(?:ed)?|open)|call.?cent[re]{2}|never.?miss(?:ed)?|always.?pick.?up)\b/i.test(transcript)) {
    fields.maddieSkip = true;
    normalized.maddieSkip = 'regex_24_7';
    console.log(`[EXTRACT_24_7] regex detected in stage=${stage} transcript="${transcript.slice(0, 80)}"`);
  }

  // ── Just Demo detection (all stages — prospect may opt out of numbers at any point) ──
  if (/\b(just show me|skip .{0,15}number|no numbers|just demo|just see it|don'?t need.{0,15}number|skip.{0,15}math|just.{0,10}overview|just.{0,10}look around|just.{0,10}explore|don'?t worry about.{0,15}number)\b/.test(s)) {
    fields._just_demo = true;
    console.log(`[JUST_DEMO_DETECTED] stage=${stage} transcript="${transcript.slice(0, 80)}"`);
  }

  // ── Source-check routing fields (wow stage, wow_8 step) ──
  if (effectiveTargets.includes('leadSourceDominant') && (stage === 'wow' || correctionDetected)) {
    // Determine dominant lead source from prospect's answer
    const phoneSignal = /\b(phone|call|ring|inbound call|phone call|over the phone)\b/i.test(s);
    const websiteSignal = /\b(website|web|site|online|form|enquir|submit|landing page)\b/i.test(s);
    const adsSignal = /\b(ads?|paid|google ads?|facebook ads?|ppc|campaign|adwords|meta ads?|paid search|paid social)\b/i.test(s);
    const organicSignal = /\b(organic|seo|search engine|google search|natural search)\b/i.test(s);
    const mostlyModifier = /\b(most|mostly|mainly|primarily|main|biggest|dominant|bulk)\b/i.test(s);

    // Priority: explicit "mostly X" > first strong signal
    if (adsSignal) {
      fields.leadSourceDominant = 'ads';
      fields.adsConfirmed = true;
    } else if (phoneSignal && mostlyModifier) {
      fields.leadSourceDominant = 'phone';
    } else if (websiteSignal && mostlyModifier) {
      fields.leadSourceDominant = 'website';
    } else if (organicSignal && mostlyModifier) {
      fields.leadSourceDominant = 'organic';
    } else if (phoneSignal) {
      fields.leadSourceDominant = 'phone';
    } else if (websiteSignal) {
      fields.leadSourceDominant = 'website';
    } else if (organicSignal) {
      fields.leadSourceDominant = 'organic';
    }

    // Set boolean flags from signals
    if (websiteSignal) fields.websiteRelevant = true;
    if (phoneSignal) fields.phoneRelevant = true;
    if (adsSignal) fields.adsConfirmed = true;

    if (fields.leadSourceDominant) {
      console.log(`[EXTRACT_SOURCE] dominant=${fields.leadSourceDominant} website=${!!websiteSignal} phone=${!!phoneSignal} ads=${!!adsSignal}`);
    }
  }

  // ── Calculate confidence ──
  const realFields = Object.keys(fields).filter(k => !k.startsWith('_'));
  const confidence = realFields.length > 0 ? 0.8 : 0;

  if (realFields.length === 0 && effectiveTargets.length > 0 && !['wow', 'greeting', 'recommendation', 'roi_delivery', 'close', 'optional_side_agents'].includes(stage)) {
    console.log(`[EXTRACT_MISS] stage=${stage} targets=[${effectiveTargets}] transcript="${transcript.slice(0, 80)}"`);
  }

  // ── Detect memory notes ──
  const turnIndex = currentState?.transcriptLog?.length ?? 0;
  const memoryNotes = detectMemoryNotes(transcript, turnIndex);

  return {
    fields,
    confidence,
    raw: transcript,
    normalized,
    correctionDetected,
    memoryNotes,
  };
}

// ─── Calculator invalidation on correction ──────────────────────────────────

/** Map of calculator-input fields to the agent whose result must be cleared on correction. */
const CALC_INPUT_TO_AGENT: Record<string, string> = {
  inboundLeads: 'alex',
  inboundConversions: 'alex',
  inboundConversionRate: 'alex',
  responseSpeedBand: 'alex',
  webLeads: 'chris',
  webConversions: 'chris',
  webConversionRate: 'chris',
  phoneVolume: 'maddie',
  missedCalls: 'maddie',
  missedCallRate: 'maddie',
  acv: 'all',  // ACV affects all calculators
};

function invalidateCalculatorOnCorrection(state: ConversationState, field: string): void {
  const agent = CALC_INPUT_TO_AGENT[field];
  if (!agent) return;

  if (agent === 'all') {
    // ACV correction invalidates every agent that already has a result
    for (const key of ['alex', 'chris', 'maddie'] as const) {
      if (state.calculatorResults[key]) {
        console.log(`[CALC_INVALIDATE] Cleared ${key} result — acv corrected`);
        delete state.calculatorResults[key];
      }
    }
  } else if (state.calculatorResults[agent as keyof typeof state.calculatorResults]) {
    console.log(`[CALC_INVALIDATE] Cleared ${agent} result — ${field} corrected`);
    delete state.calculatorResults[agent as keyof typeof state.calculatorResults];
  }
}

// ─── Monthly normalization ───────────────────────────────────────────────────

/** Volume/count fields eligible for monthly→weekly normalization. */
const VOLUME_FIELDS: ReadonlySet<string> = new Set([
  'inboundLeads', 'inboundConversions', 'webLeads', 'webConversions',
  'phoneVolume', 'missedCalls', 'oldLeads', 'newCustomersPerWeek',
]);

const MONTHLY_PATTERN = /\b(a|per|each|every)\s*(month|monthly)\b/i;

/** Detect monthly unit from regex-normalized match context. Returns null if ambiguous. */
function detectFieldUnit(normalizedMatch: string): 'weekly' | 'monthly' | null {
  if (MONTHLY_PATTERN.test(normalizedMatch)) return 'monthly';
  return null;
}

// ─── Sprint 1B: Cross-channel unifiedState write ────────────────────────────

const UNIFIED_CORRECTION_WINDOW_MS = 120_000; // 2 minutes
const ACV_CORRECTION_WINDOW_MS = 120_000; // 2 minutes

/**
 * Determine whether an ACV update should be allowed.
 * First write always succeeds. Within the correction window, only values
 * within 0.5x–2.0x of the current ACV are accepted (guards against Bella's
 * ROI figures being misinterpreted as corrections while allowing genuine
 * "I meant fifty thousand not fifty" fixes).
 */
export function canUpdateAcv(
  state: ConversationState,
  newValue: number
): { allowed: boolean; reason: string } {
  const current = state.acv;
  const setAt = state.unifiedState?.avg_client_value_set_at;

  if (!current || current <= 0) {
    return { allowed: true, reason: 'Not yet set' };
  }

  // Within correction window
  if (setAt && (Date.now() - setAt) < ACV_CORRECTION_WINDOW_MS) {
    const lower = current * 0.5;
    const upper = current * 2.0;
    if (newValue >= lower && newValue <= upper) {
      return { allowed: true, reason: 'Within correction window and range' };
    }
    return { allowed: false, reason: `Within window but value too far from current (${newValue} vs ${current}, range ${lower}-${upper})` };
  }

  return { allowed: false, reason: 'Correction window closed' };
}

/**
 * Map from extraction field names to unifiedState canonical field names.
 * Multiple extraction fields can map to the same canonical field (Alex and Chris
 * both capture lead volume, for example).
 */
const UNIFIED_FIELD_MAP: Record<string, { field: keyof UnifiedLeadState; tsField: keyof UnifiedLeadState }> = {
  inboundLeads:          { field: 'inbound_volume_weekly',  tsField: 'inbound_volume_weekly_set_at' },
  webLeads:              { field: 'inbound_volume_weekly',  tsField: 'inbound_volume_weekly_set_at' },
  inboundConversionRate: { field: 'conversion_rate',        tsField: 'conversion_rate_set_at' },
  webConversionRate:     { field: 'conversion_rate',        tsField: 'conversion_rate_set_at' },
  acv:                   { field: 'avg_client_value',       tsField: 'avg_client_value_set_at' },
};

/**
 * Write a value to unifiedState with write-once + correction window semantics.
 * First write always succeeds. Subsequent writes only succeed within the correction window.
 */
function writeUnifiedField(
  state: ConversationState,
  canonicalField: keyof UnifiedLeadState,
  tsField: keyof UnifiedLeadState,
  value: number,
): void {
  if (!state.unifiedState) state.unifiedState = {};

  const existing = state.unifiedState[canonicalField] as number | undefined;
  const setAt = state.unifiedState[tsField] as number | undefined;

  if (existing == null) {
    // First write — always succeeds
    (state.unifiedState as Record<string, unknown>)[canonicalField] = value;
    (state.unifiedState as Record<string, unknown>)[tsField] = Date.now();
    console.log(`[UNIFIED_STATE] ${canonicalField}=${value} (first write)`);
  } else if (setAt && (Date.now() - setAt) < UNIFIED_CORRECTION_WINDOW_MS) {
    // Within correction window — allow update
    (state.unifiedState as Record<string, unknown>)[canonicalField] = value;
    (state.unifiedState as Record<string, unknown>)[tsField] = Date.now();
    console.log(`[UNIFIED_STATE] ${canonicalField} corrected: ${existing} → ${value}`);
  } else {
    console.log(`[UNIFIED_STATE] ${canonicalField} blocked: already ${existing}, correction window closed`);
  }
}

/**
 * After standard field application, sync relevant fields to unifiedState.
 * Called from applyExtraction after all V2 scalar fields are written.
 */
function syncToUnifiedState(state: ConversationState, appliedFields: string[]): void {
  for (const field of appliedFields) {
    const mapping = UNIFIED_FIELD_MAP[field];
    if (!mapping) continue;

    const value = (state as any)[field];
    if (typeof value !== 'number' || value <= 0) continue;

    writeUnifiedField(state, mapping.field, mapping.tsField, value);
  }
}

// ─── Apply extraction to V2 state ───────────────────────────────────────────

/** Writable V2 scalar field names on ConversationState */
const V2_SCALAR_FIELDS: ReadonlySet<string> = new Set([
  'acv', 'inboundLeads', 'inboundConversions', 'inboundConversionRate',
  'responseSpeedBand', 'webLeads', 'webConversions', 'webConversionRate',
  'phoneVolume', 'missedCalls', 'missedCallRate',
  'oldLeads', 'newCustomersPerWeek', 'currentStars', 'hasReviewSystem',
  'leadSourceDominant', 'websiteRelevant', 'phoneRelevant', 'adsConfirmed',
  'confirmedICP', 'overriddenICP', 'confirmedCTA', 'overriddenCTA',
  'userOverrideIcp', 'userOverrideCta',
]);

export function applyExtraction(
  state: ConversationState,
  result: ExtractionResult,
): string[] {
  const applied: string[] = [];

  for (const [field, value] of Object.entries(result.fields)) {
    if (value == null || field.startsWith('_')) continue;

    // Same-number guard: reject conversions that mirror leads from same extraction
    // Only applies when BOTH fields came from the SAME source (regex fallback)
    // Skip guard when Gemini provided the conversions value (Gemini understands context)
    const geminiProvided = result.fields._geminiFields as Record<string, boolean> | undefined;
    if (field === 'inboundConversions' && result.fields.inboundLeads != null && value === result.fields.inboundLeads) {
      if (!geminiProvided?.[field]) {
        console.log(`[EXTRACT_GUARD] Rejected inboundConversions=${value} — mirrors inboundLeads from same utterance`);
        continue;
      }
      console.log(`[EXTRACT_GUARD_SKIP] inboundConversions=${value} mirrors inboundLeads but Gemini provided it — trusting Gemini`);
    }
    if (field === 'webConversions' && result.fields.webLeads != null && value === result.fields.webLeads) {
      if (!geminiProvided?.[field]) {
        console.log(`[EXTRACT_GUARD] Rejected webConversions=${value} — mirrors webLeads from same utterance`);
        continue;
      }
      console.log(`[EXTRACT_GUARD_SKIP] webConversions=${value} mirrors webLeads but Gemini provided it — trusting Gemini`);
    }

    // ── maddieSkip: write-once boolean (only write true, never revert to false) ──
    if (field === 'maddieSkip') {
      if (value === true && !state.maddieSkip) {
        state.maddieSkip = true;
        applied.push('maddieSkip');
        console.log(`[MADDIE_SKIP] 24/7 coverage detected — maddieSkip set to true`);
      }
      // value===false or already true → no-op (write-once)
      continue;
    }

    if (V2_SCALAR_FIELDS.has(field)) {
      const current = (state as any)[field];

      // ── ACV correction window: allows legitimate corrections within 2 min + 0.5x–2.0x range.
      // After anchor_acv, stray dollar values (e.g., Bella's ROI figures) are rejected
      // unless they fall within the correction window AND plausible range.
      if (field === 'acv' && current != null && state.completedStages?.includes('anchor_acv')) {
        const acvCheck = canUpdateAcv(state, value as number);
        if (!acvCheck.allowed) {
          console.log(`[ACV_GUARD] Rejected acv=${value} — ${acvCheck.reason}`);
          continue;
        }
        console.log(`[ACV_GUARD] Allowed acv correction ${current} → ${value} — ${acvCheck.reason}`);
      }

      // Correction-aware: overwrite if correction detected, otherwise only write if null/undefined/false
      if (result.correctionDetected || current == null || current === false) {
        (state as any)[field] = value;

        // ── Monthly→weekly normalization for volume fields ──
        if (VOLUME_FIELDS.has(field) && typeof value === 'number') {
          const geminiUnit = result.fields[`${field}_unit`] as string | null | undefined;
          const regexNorm = result.normalized[field] ?? '';
          const detectedUnit = geminiUnit === 'monthly' ? 'monthly'
            : geminiUnit === 'weekly' ? 'weekly'
            : detectFieldUnit(regexNorm);

          if (detectedUnit === 'monthly') {
            const raw = value;
            const normalized = Math.round(raw / 4.33);
            (state as any)[field] = normalized;
            state.detectedInputUnits[field] = 'monthly';
            console.log(`[NORMALIZE_MONTHLY] field=${field} raw=${raw}/mo → ${normalized}/wk`);
          } else if (detectedUnit === 'weekly') {
            state.detectedInputUnits[field] = 'weekly';
          }
          // null detectedUnit = no metadata recorded, value passes through as-is
        }

        applied.push(field);
        if (result.correctionDetected && current != null) {
          console.log(`[EXTRACT_CORRECT] field=${field} old=${current} new=${value}`);
          // Invalidate stale calculator result when a correction overwrites a calculator-input field
          invalidateCalculatorOnCorrection(state, field);
        }
      }
    }
  }

  // Sprint 1B: sync applied fields to cross-channel unifiedState
  if (applied.length > 0) {
    syncToUnifiedState(state, applied);
  }

  // Handle _just_demo
  if (result.fields._just_demo) {
    state.proceedToROI = false;
    applied.push('proceedToROI');
  }

  // Append memory notes (cap at 100, FIFO oldest)
  if (result.memoryNotes.length > 0) {
    const now = new Date().toISOString();

    // Check for supersession: if a new note contradicts an existing one of the same category+tags
    for (const newNote of result.memoryNotes) {
      if (result.correctionDetected) {
        // Find existing active notes in same category that might be superseded
        for (const existing of state.memoryNotes) {
          if (existing.category === newNote.category
            && existing.status === 'active'
            && existing.tags?.some(t => newNote.tags?.includes(t))) {
            existing.status = 'superseded';
            existing.supersededById = newNote.id;
            existing.updatedAt = now;
            console.log(`[MEMORY_SUPERSEDE] old="${existing.text.slice(0, 50)}" by="${newNote.text.slice(0, 50)}" newId=${newNote.id}`);
          }
        }
      }
    }

    state.memoryNotes.push(...result.memoryNotes);

    // Enforce 100-entry cap (FIFO oldest, preserving active notes over superseded ones)
    if (state.memoryNotes.length > 100) {
      state.memoryNotes = state.memoryNotes.slice(-100);
    }
  }

  return applied;
}

// ─── Early-ROI prescan (transcript scan at channel entry) ────────────────────

/**
 * Scan accumulated transcriptLog for ROI-relevant numbers volunteered BEFORE
 * the channel stage begins.  Keyword-aware regexes only — no greedy/standalone.
 * Write-once: only writes to null fields.
 * Returns list of field names written.
 */
export function prescanForEarlyROI(state: ConversationState): string[] {
  const written: string[] = [];
  if (!state.transcriptLog || state.transcriptLog.length === 0) return written;

  // 1. Collect all user turns, normalize, join
  const userText = state.transcriptLog
    .filter(t => t.role === 'user')
    .map(t => normalizeSpokenNumbers(t.text))
    .join('. ');

  if (!userText || userText.trim().length === 0) return written;

  // 2. Phone volume — keyword-aware
  if (state.phoneVolume == null) {
    const m = userText.match(/(\d+)\s*(?:call|phone|ring|inbound)/i);
    if (m) {
      const val = parseInt(m[1]);
      if (val > 0) { state.phoneVolume = val; written.push('phoneVolume'); }
    }
  }

  // 3. Missed calls — keyword-aware
  if (state.missedCalls == null) {
    const m = userText.match(/(?:miss|lose|drop)(?:ing|ed)?\s+(?:about|around|roughly|maybe|probably)?\s*(\d+)/i)
      ?? userText.match(/(?:about|around|roughly|maybe|probably)?\s*(\d+)\s*(?:missed|unanswered|lost|dropped)/i);
    if (m) {
      const val = parseInt(m[1]);
      if (val > 0) { state.missedCalls = val; written.push('missedCalls'); }
    }
  }

  // 4. Response speed band — reuses existing extractor (unique keywords)
  if (state.responseSpeedBand == null) {
    const band = extractResponseSpeedBand(userText);
    if (band) { state.responseSpeedBand = band; written.push('responseSpeedBand'); }
  }

  // 5. Lead / web volume — 40-char context window for scope disambiguation
  if (state.inboundLeads == null || state.webLeads == null) {
    const leadRe = /(\d+)\s*(?:leads?|enquir|inqu)/gi;
    let lm: RegExpExecArray | null;
    while ((lm = leadRe.exec(userText)) !== null) {
      const val = parseInt(lm[1]);
      if (val <= 0) continue;
      const start = Math.max(0, lm.index - 40);
      const end = Math.min(userText.length, lm.index + lm[0].length + 40);
      const ctx = userText.slice(start, end).toLowerCase();
      const webCtx = /website|web|online|form|landing|seo|organic/.test(ctx);
      const adCtx = /ad|campaign|paid|ppc|facebook|google ads/.test(ctx);

      if (webCtx && state.webLeads == null) {
        state.webLeads = val; written.push('webLeads');
      } else if (adCtx && state.inboundLeads == null) {
        state.inboundLeads = val; written.push('inboundLeads');
      } else if (state.leadSourceDominant === 'website' && state.webLeads == null) {
        state.webLeads = val; written.push('webLeads');
      } else if (state.inboundLeads == null) {
        state.inboundLeads = val; written.push('inboundLeads');
      }
    }
  }

  // 5b. Lead volume — broader "X a week/month/day" pattern without "leads" keyword
  //     Catches: "we get about 50 a week", "handle around 30 per month"
  if (state.inboundLeads == null) {
    const weeklyRe = /(?:get|getting|have|had|do|see|seeing|receive|receiving|handle|handling|average|averaging)\s+(?:about|around|roughly|maybe|probably|say|like|approximately)?\s*(\d+)\s*(?:a\s+(?:week|month|day)|per\s+(?:week|month|day))/i;
    const wm = userText.match(weeklyRe);
    if (wm) {
      const val = parseInt(wm[1]);
      const acv = state.acv ?? 0;
      const isAcvFragment = acv > 0 && (val === acv || val === acv / 10 || val === acv / 100 || val === acv / 1000 || val * 10 === acv || val * 100 === acv || val * 1000 === acv);
      if (val > 0 && val <= 1000 && !isAcvFragment) {
        state.inboundLeads = val;
        written.push('inboundLeads');
      }
    }
  }

  // 6. Conversions — keyword-aware + same-number guard vs lead value
  if (state.inboundConversions == null || state.webConversions == null) {
    const convRe = /(\d+)\s*(?:convert|close|sale|client|customer|booking|job|patient)/gi;
    let cm: RegExpExecArray | null;
    while ((cm = convRe.exec(userText)) !== null) {
      const val = parseInt(cm[1]);
      if (val <= 0) continue;
      const start = Math.max(0, cm.index - 40);
      const end = Math.min(userText.length, cm.index + cm[0].length + 40);
      const ctx = userText.slice(start, end).toLowerCase();
      const webCtx = /website|web|online|form|landing|seo|organic/.test(ctx);
      const adCtx = /ad|campaign|paid|ppc|facebook|google ads/.test(ctx);

      if (webCtx && state.webConversions == null && val !== state.webLeads) {
        state.webConversions = val; written.push('webConversions');
      } else if (adCtx && state.inboundConversions == null && val !== state.inboundLeads) {
        state.inboundConversions = val; written.push('inboundConversions');
      } else if (state.leadSourceDominant === 'website' && state.webConversions == null && val !== state.webLeads) {
        state.webConversions = val; written.push('webConversions');
      } else if (state.inboundConversions == null && val !== state.inboundLeads) {
        state.inboundConversions = val; written.push('inboundConversions');
      }
    }
  }

  // 7. Conversion rates — only with channel-context disambiguation
  const pctMatch = userText.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)/i);
  if (pctMatch) {
    const rate = parseFloat(pctMatch[1]);
    if (rate > 0 && rate <= 100) {
      const rateVal = rate / 100;
      const pIdx = pctMatch.index ?? 0;
      const pStart = Math.max(0, pIdx - 40);
      const pEnd = Math.min(userText.length, pIdx + pctMatch[0].length + 40);
      const pCtx = userText.slice(pStart, pEnd).toLowerCase();
      const webCtx = /website|web|online/.test(pCtx);
      const adCtx = /ad|campaign|paid|inbound/.test(pCtx);

      if (webCtx && state.webConversionRate == null) {
        state.webConversionRate = rateVal; written.push('webConversionRate');
      } else if (adCtx && state.inboundConversionRate == null) {
        state.inboundConversionRate = rateVal; written.push('inboundConversionRate');
      }
      // Ambiguous: skip — don't blindly assign to both channels
    }
  }

  // Sprint 1B: sync prescan writes to unified state
  if (written.length > 0) {
    syncToUnifiedState(state, written);
  }

  return written;
}

// ─── Bella-side memory note extraction ──────────────────────────────────────

/**
 * Extract memory notes from Bella's spoken text (commitments, promises, next steps).
 * Only commitment-category patterns are evaluated — user-side patterns are excluded.
 */
export function extractBellaMemoryNotes(
  spokenText: string,
  turnIndex: number,
): MemoryNote[] {
  if (!spokenText || spokenText.trim().length < 10) return [];

  const notes: MemoryNote[] = [];
  const now = new Date().toISOString();

  for (const mp of MEMORY_PATTERNS) {
    // Only extract commitment patterns from Bella utterances
    if (mp.category !== 'commitment') continue;

    if (mp.pattern.test(spokenText)) {
      const match = spokenText.match(mp.pattern);
      if (!match) continue;

      const idx = match.index ?? 0;
      const start = Math.max(0, idx - 30);
      const end = Math.min(spokenText.length, idx + match[0].length + 60);
      let noteText = spokenText.slice(start, end).trim();
      if (start > 0) noteText = '...' + noteText;
      if (end < spokenText.length) noteText = noteText + '...';

      const noteId = generateNoteId('commitment', noteText, turnIndex, 'bella');

      // Dedup: skip if this exact ID was already created
      if (notes.some(n => n.id === noteId)) continue;

      notes.push({
        id: noteId,
        text: noteText,
        category: 'commitment',
        tags: mp.tags,
        source: 'bella',
        sourceTurnIndex: turnIndex,
        confidence: 'stated',
        createdAt: now,
        status: 'active',
        scope: 'lead',
        salience: 3,
      });
    }
  }

  return notes;
}

// ─── Transcript logging ─────────────────────────────────────────────────────

const MAX_TRANSCRIPT_ENTRIES = 200;

export function appendTranscript(
  state: ConversationState,
  entry: TranscriptEntry,
): void {
  if (!state.transcriptLog) state.transcriptLog = [];
  state.transcriptLog.push(entry);
  console.log(`[TRANSCRIPT] entries=${state.transcriptLog.length} role=${entry.role} chars=${entry.text.length}`);

  // Enforce 200-entry cap (FIFO oldest)
  if (state.transcriptLog.length > MAX_TRANSCRIPT_ENTRIES) {
    state.transcriptLog = state.transcriptLog.slice(-MAX_TRANSCRIPT_ENTRIES);
  }
}
