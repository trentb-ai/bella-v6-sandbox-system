/**
 * call-brain-do/src/extract.ts — v2.0.0-do-alpha.1
 * Deterministic regex extraction + normalization.
 * Ported from bridge parseNumber/normalizeSpokenNumbers/regexExtract.
 */

import type { ExtractionResult, CallBrainState, Stage } from './types';

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

// ─── extractFromTranscript ───────────────────────────────────────────────────

type ExtractedFields = CallBrainState['extracted'];
type FieldKey = keyof ExtractedFields;

export function extractFromTranscript(
  transcript: string,
  targets: string[],
  stage: Stage,
  industry?: string,
  currentExtracted?: Partial<ExtractedFields>,
): ExtractionResult {
  const s = normalizeSpokenNumbers(transcript.toLowerCase());
  const fields: Record<string, number | string | boolean | null> = {};
  const normalized: Record<string, string> = {};

  if (s !== transcript.toLowerCase()) {
    normalized['_spoken'] = transcript;
    normalized['_normalized'] = s;
  }

  // ── ACV ──
  if (targets.includes('acv') && (stage === 'anchor_acv' || stage === 'wow')) {
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

  // ── Timeframe ──
  if (targets.includes('timeframe') && (stage === 'anchor_timeframe' || stage === 'anchor_acv')) {
    if (/\bweek/i.test(s)) { fields.timeframe = 'weekly'; normalized.timeframe = 'weekly'; }
    else if (/\bmonth/i.test(s)) { fields.timeframe = 'monthly'; normalized.timeframe = 'monthly'; }
  }

  // ── Ads leads + conversions ──
  if (targets.includes('ads_leads') && stage === 'ch_ads') {
    const leadMatch = s.match(/(?:about|around|roughly|maybe|probably|say|like|get|getting)?\s*(\$?[\d,.]+\s*(?:k|thousand)?)\s*(?:leads?|enquir|inqu|a\s+week|a\s+month)/i);
    if (leadMatch) {
      const val = parseNumber(leadMatch[1]);
      if (val && val > 0) { fields.ads_leads = val; normalized.ads_leads = leadMatch[0]; }
    }
    if (!fields.ads_leads) {
      const standaloneMatch = s.match(/(?:about|around|roughly|maybe|probably|say|like|get|getting)?\s*(?:a\s+)?(thousand|hundred|[\d,.]+\s*(?:k|thousand)?|couple\s+hundred|few\s+hundred)/i);
      if (standaloneMatch) {
        const val = parseNumber(standaloneMatch[0]);
        if (val && val > 0) { fields.ads_leads = val; normalized.ads_leads = standaloneMatch[0]; }
      }
    }
  }
  if (targets.includes('ads_conversions') && stage === 'ch_ads') {
    const convMatch = s.match(/(?:about|around|roughly|maybe|probably|say|like|convert|converting|become|turn into)?\s*(\d+(?:\.\d+)?)\s*(?:convert|become|turn|close|sale|client|customer|booking|job|patient)/i);
    if (convMatch) {
      const val = parseInt(convMatch[1]);
      if (val > 0) { fields.ads_conversions = val; normalized.ads_conversions = convMatch[0]; }
    }
    if (!fields.ads_conversions) {
      const standaloneConv = s.match(/(?:about|around|roughly|maybe|probably|say|like)?\s*(ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|\d{1,3})\b/i);
      if (standaloneConv) {
        const val = parseNumber(standaloneConv[1]);
        if (val && val > 0 && val <= 500) { fields.ads_conversions = val; normalized.ads_conversions = standaloneConv[0]; }
      }
    }
  }
  if (targets.includes('ads_followup_speed') && stage === 'ch_ads') {
    if (/(?:instant|immediate|right away|straight away|within.*minute|under.*minute|asap)/i.test(s)) fields.ads_followup_speed = '<30m';
    else if (/(?:within.*hour|couple.*hour|an hour|hour or two|pretty quick|quickly)/i.test(s)) fields.ads_followup_speed = '30m_to_3h';
    else if (/(?:same day|few hours|later that day|end of day|half a day)/i.test(s)) fields.ads_followup_speed = '3h_to_24h';
    else if (/(?:next day|day or two|couple.*day|next business|24 hour|48 hour|few days|tomorrow)/i.test(s)) fields.ads_followup_speed = '>24h';
    else if (/(?:depends|varies|usually|generally|try to|we try)/i.test(s)) fields.ads_followup_speed = '3h_to_24h';
  }

  // ── Website leads + conversions ──
  if (targets.includes('web_leads') && stage === 'ch_website') {
    const numMatches = s.match(/\b(\d+)\b/g);
    if (numMatches) {
      const nums = numMatches.map(n => parseInt(n)).filter(n => n > 0 && n < 100000);
      if (nums.length >= 2) {
        fields.web_leads = nums[0];
        fields.web_conversions = nums[1];
        normalized.web_leads = String(nums[0]);
        normalized.web_conversions = String(nums[1]);
      } else if (nums.length === 1) {
        fields.web_leads = nums[0];
        normalized.web_leads = String(nums[0]);
      }
    }
    const leadMatch = s.match(/(?:get|getting|about|around|roughly|maybe)\s*(\d+)\s*(?:lead|enquir|inqu|a week|a month)/i);
    if (leadMatch) { fields.web_leads = parseInt(leadMatch[1]); normalized.web_leads = leadMatch[0]; }
  }
  if (targets.includes('web_conversions') && stage === 'ch_website' && !fields.web_conversions) {
    const convMatch = s.match(/(\d+)\s*(?:convert|become|turn|close|sale|client|customer)/i);
    if (convMatch) { fields.web_conversions = parseInt(convMatch[1]); normalized.web_conversions = convMatch[0]; }
  }

  // ── Phone ──
  if (targets.includes('phone_volume') && stage === 'ch_phone') {
    const phoneMatch = s.match(/(?:about|around|roughly|maybe|probably|get|getting)?\s*(\d+)\s*(?:call|phone|ring|inbound)/i);
    if (phoneMatch) { fields.phone_volume = parseInt(phoneMatch[1]); normalized.phone_volume = phoneMatch[0]; }
  }
  if (targets.includes('missed_call_handling') && stage === 'ch_phone') {
    if (/(?:voicemail|answering machine|goes to message|no.?one answers|ring.?out|don'?t answer|nobody|nothing|miss)/i.test(s)) {
      fields.missed_call_handling = 'voicemail/unanswered';
    } else if (/(?:24.?7|24.?hour|always.?(?:someone|covered|answer)|call cent|after.?hours.?(?:service|team|staff))/i.test(s)) {
      fields.missed_call_handling = '24/7 coverage';
    } else if (/(?:close|shut|finish|knock off|go home|stop.*answer)/i.test(s)) {
      fields.missed_call_handling = 'close at business hours';
    }
  }

  // ── Old leads ──
  if (targets.includes('old_leads') && stage === 'ch_old_leads') {
    const oldMatch = s.match(/(?:about|around|roughly|maybe|probably|say|like)?\s*(\d[\d,.]*\s*(?:k|thousand|hundred)?)/i);
    if (oldMatch) {
      const val = parseNumber(oldMatch[1]);
      if (val && val > 0) { fields.old_leads = val; normalized.old_leads = oldMatch[0]; }
    }
  }

  // ── Reviews ──
  if (targets.includes('new_customers') && stage === 'ch_reviews') {
    const newCustMatch = s.match(/(?:about|around|roughly|maybe|probably|say|like|get|getting)?\s*(\d+)\s*(?:new|client|customer|patient|job|booking|deal|sale|matter|listing)/i);
    if (newCustMatch) { fields.new_customers = parseInt(newCustMatch[1]); normalized.new_customers = newCustMatch[0]; }
  }
  if (targets.includes('has_review_system') && stage === 'ch_reviews') {
    if (/\b(no|nah|not really|don'?t|haven'?t|nothing|no system|no process)\b/i.test(s) && /\b(review|ask|system|process)\b/i.test(s)) {
      fields.has_review_system = false;
    } else if (/\b(yes|yeah|yep|we do|we use|send|auto|email|sms|text|follow.?up)\b/i.test(s) && /\b(review|ask|system|process)\b/i.test(s)) {
      fields.has_review_system = true;
    }
  }

  // ── Cross-stage standalone number ──
  if (Object.keys(fields).length === 0 && !['wow', 'roi_delivery', 'close'].includes(stage)) {
    // Loosened regex: allows surrounding filler words (yeah, um, so, well) — no strict ^ $ anchors
    const standaloneNum = s.match(
      /(?:^|(?:yeah|yep|yes|yup|um|uh|so|oh|like|well|hmm|about|around|roughly|maybe|probably|say|i'?d say)\s+)(\d+(?:\.\d+)?)\s*(?:ish|or so|maybe|i think|i guess|i reckon)?/i
    );
    if (standaloneNum) {
      const val = parseFloat(standaloneNum[1]);
      if (val > 0) {
        let mappedTo = '';
        if (stage === 'anchor_acv' && val >= 100) { fields.acv = val; mappedTo = 'acv'; }
        else if (stage === 'ch_ads') {
          if (targets.includes('ads_conversions') && currentExtracted?.ads_leads != null && currentExtracted?.ads_conversions == null) {
            fields.ads_conversions = val; mappedTo = 'ads_conversions';
          } else if (targets.includes('ads_leads')) {
            fields.ads_leads = val; mappedTo = 'ads_leads';
          }
        }
        else if (stage === 'ch_website') {
          if (targets.includes('web_conversions') && currentExtracted?.web_leads != null && currentExtracted?.web_conversions == null) {
            fields.web_conversions = val; mappedTo = 'web_conversions';
          } else if (targets.includes('web_leads') && currentExtracted?.web_leads == null) {
            fields.web_leads = val; mappedTo = 'web_leads';
          }
        }
        else if (stage === 'ch_phone' && targets.includes('phone_volume')) { fields.phone_volume = val; mappedTo = 'phone_volume'; }
        else if (stage === 'ch_old_leads') { fields.old_leads = val; mappedTo = 'old_leads'; }
        if (mappedTo) console.log(`[EXTRACT_STANDALONE] stage=${stage} val=${val} targets=[${targets}] mapped_to=${mappedTo}`);
      }
    }
  }

  // ── Just Demo detection (wow only) ──
  if (stage === 'wow') {
    if (/\b(just show me|skip .{0,15}number|no numbers|just demo|just see it|don'?t need.{0,15}number|skip.{0,15}math|just.{0,10}overview)\b/.test(s)) {
      fields._just_demo = true;
    }
  }

  const realFields = Object.keys(fields).filter(k => !k.startsWith('_'));
  const confidence = realFields.length > 0 ? 0.8 : 0;

  if (realFields.length === 0 && targets.length > 0 && !['wow', 'roi_delivery', 'close'].includes(stage)) {
    console.log(`[EXTRACT_MISS] stage=${stage} targets=[${targets}] transcript="${transcript.slice(0, 80)}"`);
  }

  return {
    fields,
    confidence,
    raw: transcript,
    normalized,
  };
}

// ─── Apply extraction to state ───────────────────────────────────────────────

export function applyExtraction(state: CallBrainState, result: ExtractionResult): string[] {
  const applied: string[] = [];

  for (const [field, value] of Object.entries(result.fields)) {
    if (value == null || field.startsWith('_')) continue;

    if (field in state.extracted) {
      (state.extracted as any)[field] = value;
      applied.push(field);
    }
  }

  if (result.fields._just_demo) {
    state.flags.justDemo = true;
    applied.push('justDemo');
  }

  return applied;
}
