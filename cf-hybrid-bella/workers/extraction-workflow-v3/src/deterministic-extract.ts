/**
 * call-brain-do/src/deterministic-extract.ts — Sprint E1
 * Deterministic extraction layer: runs BEFORE Gemini, <1ms, no LLM.
 *
 * Three-layer architecture:
 *   Layer 1 (this): Deterministic JS parser — catches numbers and durations without LLM
 *   Layer 2: Gemini extraction — demoted to fallback for fields Layer 1 missed
 *   Layer 3: Rolling transcript buffer — deterministic + Gemini re-scan
 *
 * Exports:
 *   parseSpokenNumber    — spoken word/digit numbers → integer
 *   parseDuration        — spoken time expressions → { value, unit }
 *   mapDurationToBand    — duration → ResponseSpeedBand enum
 *   deterministicExtract — main entry point: transcript + stage → extracted fields
 *
 * VERBATIM PORT from cleanest-bella-brain-DO-FROZEN/src/deterministic-extract.ts
 * Only change: import path adjusted to local ./types
 */

import type { StageId, ResponseSpeedBand } from './types';

// ─── Word → number map ──────────────────────────────────────────────────────

const WORD_ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};

const WORD_TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};

const CASUAL_STRIP = /^(?:about|around|roughly|maybe|probably|say|like|approximately|oh|um|uh|yeah|well|so)\s+/gi;

// ─── parseSpokenNumber ──────────────────────────────────────────────────────

/**
 * Convert spoken numbers to digits. Handles word numbers, mixed forms,
 * casual qualifiers, and magnitude suffixes.
 * Returns null if no number detected.
 */
export function parseSpokenNumber(text: string): number | null {
  if (!text || text.trim().length === 0) return null;
  let s = text.toLowerCase().replace(/,/g, '').replace(/\s+/g, ' ').trim();

  // Strip casual qualifiers
  s = s.replace(CASUAL_STRIP, '').trim();
  // Another pass for stacked qualifiers ("yeah about")
  s = s.replace(CASUAL_STRIP, '').trim();

  // ── Compound phrases ──
  if (/quarter\s*(?:of\s*a\s*)?mill/i.test(s)) return 250000;
  if (/half\s*(?:a\s*)?mill/i.test(s)) return 500000;
  if (/(?:a|one)\s*mill/i.test(s)) return 1000000;
  if (/(?:a|one)\s*hundred\s*(?:thousand|k|grand)/i.test(s)) return 100000;
  if (/(?:a|one)\s*(?:thousand|grand)/i.test(s)) return 1000;
  if (/couple\s*(?:of\s*)?(?:thousand|grand)/i.test(s)) return 2000;
  if (/couple\s*(?:of\s*)?hundred/i.test(s)) return 200;
  if (/few\s*(?:thousand|grand)/i.test(s)) return 3000;
  if (/few\s*hundred/i.test(s)) return 300;

  // ── "[unit] hundred [and] [tens] thousand" ──
  const htkMatch = s.match(
    /\b(one|two|three|four|five|six|seven|eight|nine)\s*hundred\s*(?:and\s*)?(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)?\s*(?:thousand|k|grand)\b/
  );
  if (htkMatch) {
    const h = WORD_ONES[htkMatch[1]] ?? 0;
    const t = htkMatch[2] ? (WORD_TENS[htkMatch[2]] ?? 0) : 0;
    return (h * 100 + t) * 1000;
  }

  // ── "[tens] [ones] thousand/k" ──
  const tkMatch = s.match(
    /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-]*(one|two|three|four|five|six|seven|eight|nine)?\s*(?:thousand|grand|k)\b/
  );
  if (tkMatch) {
    const t = WORD_TENS[tkMatch[1]] ?? 0;
    const o = tkMatch[2] ? (WORD_ONES[tkMatch[2]] ?? 0) : 0;
    return (t + o) * 1000;
  }

  // ── Single word × thousand ──
  const allWords = { ...WORD_ONES, ...WORD_TENS };
  for (const [word, val] of Object.entries(allWords)) {
    if (new RegExp(`^${word}\\s*(?:thousand|grand|k)\\b`).test(s)) return val * 1000;
  }

  // ── Digit with suffix: "$250k", "1.5m", "50k", "500" ──
  const digitMatch = s.match(/\$?\s*(\d+(?:\.\d+)?)\s*(k|m|mil|million|thousand|grand|hundred)?/);
  if (digitMatch) {
    let num = parseFloat(digitMatch[1]);
    const suffix = digitMatch[2]?.toLowerCase() ?? '';
    if (suffix === 'k' || suffix === 'thousand' || suffix === 'grand') num *= 1000;
    else if (suffix === 'm' || suffix === 'mil' || suffix === 'million') num *= 1000000;
    else if (suffix === 'hundred') num *= 100;
    if (num > 0) return Math.round(num);
  }

  // ── Compound word: "twenty five" → 25, "thirty" → 30 ──
  const tensOnesMatch = s.match(
    /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-]+(one|two|three|four|five|six|seven|eight|nine)\b/
  );
  if (tensOnesMatch) {
    return (WORD_TENS[tensOnesMatch[1]] ?? 0) + (WORD_ONES[tensOnesMatch[2]] ?? 0);
  }

  // ── "[unit] hundred [and] [tens/ones]" ──
  const hundredMatch = s.match(
    /\b(one|two|three|four|five|six|seven|eight|nine)\s+hundred\s*(?:and\s*)?(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)?[\s-]*(one|two|three|four|five|six|seven|eight|nine)?\b/
  );
  if (hundredMatch) {
    const h = WORD_ONES[hundredMatch[1]] ?? 0;
    const t = hundredMatch[2] ? (WORD_TENS[hundredMatch[2]] ?? 0) : 0;
    const o = hundredMatch[3] ? (WORD_ONES[hundredMatch[3]] ?? 0) : 0;
    return h * 100 + t + o;
  }

  // ── "a hundred" ──
  if (/^a\s+hundred\b/.test(s)) return 100;

  // ── Standalone tens ──
  for (const [word, val] of Object.entries(WORD_TENS)) {
    if (s === word || s.startsWith(word + ' ') || s.endsWith(' ' + word)) return val;
  }

  // ── Standalone ones (2-19) ──
  for (const [word, val] of Object.entries(WORD_ONES)) {
    if (val < 1) continue;
    if (s === word) return val;
  }

  // ── Bare digits ──
  const bareDigit = s.match(/^(\d+(?:\.\d+)?)$/);
  if (bareDigit) {
    const v = parseFloat(bareDigit[1]);
    if (v > 0) return Math.round(v);
  }

  return null;
}

// ─── parseDuration ──────────────────────────────────────────────────────────

export interface ParsedDuration {
  value: number;
  unit: 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks';
}

/**
 * Parse time expressions from spoken text.
 * Returns null if no duration detected.
 */
export function parseDuration(text: string): ParsedDuration | null {
  if (!text || text.trim().length === 0) return null;
  const s = text.toLowerCase().replace(/\s+/g, ' ').trim();

  // ── Instant responses ──
  if (/\b(instantly?|immediate(?:ly)?|right away|straight away|right then)\b/.test(s)) {
    return { value: 0, unit: 'seconds' };
  }

  // ── Week patterns ──
  if (/\b(?:a|one)\s+week\b/.test(s)) return { value: 1, unit: 'weeks' };
  if (/\bcouple\s+(?:of\s+)?weeks?\b/.test(s)) return { value: 2, unit: 'weeks' };
  if (/\bfew\s+weeks?\b/.test(s)) return { value: 3, unit: 'weeks' };
  const weekNum = s.match(/\b(\d+)\s*weeks?\b/);
  if (weekNum) return { value: parseInt(weekNum[1]), unit: 'weeks' };

  // ── Day patterns (before hour patterns, since "same day" contains no hour keyword) ──
  if (/\b(?:next day|next morning|next business day)\b/.test(s)) return { value: 1, unit: 'days' };
  if (/\btomorrow\b/.test(s)) return { value: 1, unit: 'days' };
  if (/\bcouple\s+(?:of\s+)?days?\b/.test(s)) return { value: 2, unit: 'days' };
  if (/\bfew\s+days?\b/.test(s)) return { value: 3, unit: 'days' };
  if (/\bday\s+or\s+two\b/.test(s)) return { value: 2, unit: 'days' };
  const dayNum = s.match(/\b(\d+)\s*days?\b/);
  if (dayNum) return { value: parseInt(dayNum[1]), unit: 'days' };

  // ── "same day" / "end of day" / "half a day" — treat as 8-24h ──
  if (/\b(?:same day|end of (?:the )?day|later that day|by (?:end of )?day)\b/.test(s)) {
    return { value: 8, unit: 'hours' };
  }
  if (/\bhalf\s+(?:a\s+)?day\b/.test(s)) return { value: 12, unit: 'hours' };

  // ── Hour patterns ──
  // "half an hour" / "half hour" MUST come before "an hour" to avoid false match
  if (/\bhalf\s+(?:an?\s+)?hour\b/.test(s)) return { value: 30, unit: 'minutes' };
  if (/\bwithin\s+(?:the\s+)?hour\b/.test(s)) return { value: 1, unit: 'hours' };
  if (/\b(?:an|one)\s+hour\b/.test(s)) return { value: 1, unit: 'hours' };
  if (/\bhour\s+or\s+two\b/.test(s)) return { value: 2, unit: 'hours' };
  if (/\bcouple\s+(?:of\s+)?hours?\b/.test(s)) return { value: 2, unit: 'hours' };
  if (/\bfew\s+hours?\b/.test(s)) return { value: 3, unit: 'hours' };

  // Numeric hours: "8 hours", "48 hours"
  // Compound word hours FIRST: "twenty four hours" (before standalone to avoid false match)
  const compoundHourMatch = s.match(
    /\b(twenty|thirty|forty|fifty)[\s-]+(one|two|three|four|five|six|seven|eight|nine)\s*hours?\b/
  );
  if (compoundHourMatch) {
    const t = WORD_TENS[compoundHourMatch[1]] ?? 0;
    const o = WORD_ONES[compoundHourMatch[2]] ?? 0;
    return { value: t + o, unit: 'hours' };
  }
  // Standalone word-number hours: "eight hours"
  const wordHourMatch = s.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty)\s*hours?\b/
  );
  if (wordHourMatch) {
    const val = WORD_ONES[wordHourMatch[1]] ?? WORD_TENS[wordHourMatch[1]] ?? null;
    if (val !== null) return { value: val, unit: 'hours' };
  }
  // Digit hours: "8 hours"
  const digitHour = s.match(/\b(\d+)\s*hours?\b/);
  if (digitHour) return { value: parseInt(digitHour[1]), unit: 'hours' };

  // ── Minute patterns ──
  if (/\bfew\s+minutes?\b/.test(s)) return { value: 3, unit: 'minutes' };
  if (/\bcouple\s+(?:of\s+)?minutes?\b/.test(s)) return { value: 2, unit: 'minutes' };
  if (/\bminute\s+or\s+two\b/.test(s)) return { value: 2, unit: 'minutes' };

  // Compound word minutes FIRST: "twenty five minutes" (before standalone to avoid false match)
  const compoundMinMatch = s.match(
    /\b(twenty|thirty|forty|fifty)[\s-]+(one|two|three|four|five|six|seven|eight|nine)\s*minutes?\b/
  );
  if (compoundMinMatch) {
    const t = WORD_TENS[compoundMinMatch[1]] ?? 0;
    const o = WORD_ONES[compoundMinMatch[2]] ?? 0;
    return { value: t + o, unit: 'minutes' };
  }
  // Standalone word-number minutes: "fifteen minutes"
  const wordMinMatch = s.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty)\s*minutes?\b/
  );
  if (wordMinMatch) {
    const val = WORD_ONES[wordMinMatch[1]] ?? WORD_TENS[wordMinMatch[1]] ?? null;
    if (val !== null) return { value: val, unit: 'minutes' };
  }
  // Digit minutes: "15 minutes"
  const digitMin = s.match(/\b(\d+)\s*min(?:utes?)?\b/);
  if (digitMin) return { value: parseInt(digitMin[1]), unit: 'minutes' };

  // ── Second patterns ──
  if (/\bwithin\s+(?:a\s+few\s+)?seconds?\b/.test(s)) return { value: 10, unit: 'seconds' };
  if (/\bunder\s+(?:a\s+)?(?:thirty|30)\s*seconds?\b/.test(s)) return { value: 30, unit: 'seconds' };
  const digitSec = s.match(/\b(\d+)\s*seconds?\b/);
  if (digitSec) return { value: parseInt(digitSec[1]), unit: 'seconds' };

  return null;
}

// ─── mapDurationToBand ──────────────────────────────────────────────────────

/**
 * Convert a parsed duration to a ResponseSpeedBand enum value.
 * Normalizes everything to minutes internally, then maps to bands.
 * Unit-aware: "days" and "weeks" always map to next_day_plus regardless of value.
 */
export function mapDurationToBand(duration: ParsedDuration): ResponseSpeedBand {
  // Days and weeks are semantically "next day or later" — always next_day_plus
  if (duration.unit === 'days' || duration.unit === 'weeks') return 'next_day_plus';

  // Convert to minutes
  let minutes: number;
  switch (duration.unit) {
    case 'seconds': minutes = duration.value / 60; break;
    case 'minutes': minutes = duration.value; break;
    case 'hours':   minutes = duration.value * 60; break;
    default:        minutes = duration.value; break;
  }

  // Map to bands
  if (minutes <= 0.5) return 'under_30_seconds';  // 0-30 seconds
  if (minutes <= 5)   return 'under_5_minutes';    // 30s-5min
  if (minutes <= 30)  return '5_to_30_minutes';    // 5-30min
  if (minutes <= 120) return '30_minutes_to_2_hours'; // 30min-2h
  if (minutes <= 1440) return '2_to_24_hours';     // 2-24h (24 hours exactly = same day)
  return 'next_day_plus';                          // >24h
}

// ─── Percentage extraction ──────────────────────────────────────────────────

function extractPercentageDet(text: string): number | null {
  const s = text.toLowerCase();

  // "25 percent", "ten percent"
  // First try digit percent
  const digitPct = s.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)/);
  if (digitPct) {
    const val = parseFloat(digitPct[1]);
    if (val > 0 && val <= 100) return val / 100;
  }

  // Word percent: "ten percent", "twenty five percent"
  const wordPct = s.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\s*(?:[\s-]+(one|two|three|four|five|six|seven|eight|nine))?\s*(?:percent|%)/
  );
  if (wordPct) {
    const t = WORD_ONES[wordPct[1]] ?? WORD_TENS[wordPct[1]] ?? 0;
    const o = wordPct[2] ? (WORD_ONES[wordPct[2]] ?? 0) : 0;
    const val = t + o;
    if (val > 0 && val <= 100) return val / 100;
  }

  return null;
}

// ─── Unit detection ─────────────────────────────────────────────────────────

function detectUnit(text: string): 'weekly' | 'monthly' | null {
  const s = text.toLowerCase();
  if (/\b(?:per|a|each|every)\s*month(?:ly)?\b/.test(s) || /\bmonthly\b/.test(s)) return 'monthly';
  if (/\b(?:per|a|each|every)\s*week(?:ly)?\b/.test(s) || /\bweekly\b/.test(s)) return 'weekly';
  return null;
}

// ─── deterministicExtract ───────────────────────────────────────────────────

/**
 * Main entry point. Given a transcript and current stage, extract what we can
 * deterministically — no LLM needed.
 *
 * Returns ONLY fields where parsing produced a high-confidence result.
 * Returns {} for anything ambiguous — let Gemini handle it.
 */
export function deterministicExtract(
  transcript: string,
  stage: StageId,
): Record<string, any> {
  if (!transcript || transcript.trim().length < 2) return {};

  const s = transcript.toLowerCase().trim();
  const fields: Record<string, any> = {};

  // ── ResponseSpeedBand — ch_alex (and buffer scans) ──
  if (stage === 'ch_alex' || stage === 'wow' as any || stage === 'greeting' || stage === 'recommendation') {
    const duration = parseDuration(s);
    if (duration) {
      fields.responseSpeedBand = mapDurationToBand(duration);
    }
  }

  // ── ACV — anchor_acv stage ──
  if (stage === 'anchor_acv') {
    // Dollar amount patterns
    const dollarMatch = s.match(/\$\s*([\d,.]+\s*(?:k|m|mil|million|thousand|grand|hundred)?)/);
    if (dollarMatch) {
      const val = parseSpokenNumber(dollarMatch[1]);
      if (val && val >= 100) fields.acv = val;
    }
    // Word amounts with magnitude: "fifty thousand", "ten k"
    if (!fields.acv) {
      const wordAmount = s.match(
        /\b((?:one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|a)\s+(?:thousand|grand|k|hundred\s+thousand|million|mil|hundred))/
      );
      if (wordAmount) {
        const val = parseSpokenNumber(wordAmount[1]);
        if (val && val >= 100) fields.acv = val;
      }
    }
    // Bare digits with magnitude suffix in context
    if (!fields.acv) {
      const bareAmount = s.match(/(\d+(?:\.\d+)?)\s*(k|m|thousand|grand)/);
      if (bareAmount) {
        const val = parseSpokenNumber(bareAmount[0]);
        if (val && val >= 100) fields.acv = val;
      }
    }
  }

  // ── ch_alex: inbound leads, conversions, conversion rate ──
  if (stage === 'ch_alex') {
    // Leads — keyword-aware
    const leadMatch = s.match(/(?:get(?:ting)?|have|receive|see|about|around)\s+(?:about\s+)?(\d+|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[\s-]+(?:one|two|three|four|five|six|seven|eight|nine))?)\s*(?:leads?|enquir|inqu|a\s+(?:week|month|day))/);
    if (leadMatch) {
      const val = parseSpokenNumber(leadMatch[1]);
      if (val && val > 0 && val <= 10000) fields.inboundLeads = val;
    }

    // Conversions — keyword-aware
    const convMatch = s.match(/(\d+|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty))\s*(?:convert|become|turn\s+into|close|sale|client|customer|booking)/);
    if (convMatch) {
      const val = parseSpokenNumber(convMatch[1]);
      if (val && val > 0 && val <= 500) fields.inboundConversions = val;
    }

    // Conversion rate
    const rate = extractPercentageDet(s);
    if (rate !== null) fields.inboundConversionRate = rate;

    // Unit detection
    const unit = detectUnit(s);
    if (unit) fields.inboundLeads_unit = unit;

    // ResponseSpeedBand
    if (!fields.responseSpeedBand) {
      const duration = parseDuration(s);
      if (duration) fields.responseSpeedBand = mapDurationToBand(duration);
    }
  }

  // ── ch_chris: web leads, conversions ──
  if (stage === 'ch_chris') {
    const leadMatch = s.match(/(?:get(?:ting)?|have|receive|see|about|around)\s+(?:about\s+)?(\d+|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty)(?:[\s-]+(?:one|two|three|four|five|six|seven|eight|nine))?)\s*(?:leads?|enquir|inqu|a\s+(?:week|month|day))/);
    if (leadMatch) {
      const val = parseSpokenNumber(leadMatch[1]);
      if (val && val > 0 && val <= 10000) fields.webLeads = val;
    }

    const convMatch = s.match(/(\d+|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty))\s*(?:convert|become|turn\s+into|close|sale|client|customer)/);
    if (convMatch) {
      const val = parseSpokenNumber(convMatch[1]);
      if (val && val > 0 && val <= 500) fields.webConversions = val;
    }

    const rate = extractPercentageDet(s);
    if (rate !== null) fields.webConversionRate = rate;

    const unit = detectUnit(s);
    if (unit) fields.webLeads_unit = unit;
  }

  // ── ch_maddie: phone volume, missed calls ──
  if (stage === 'ch_maddie') {
    const phoneMatch = s.match(/(?:get(?:ting)?|have|receive|about|around)\s+(?:about\s+)?(\d+|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty)(?:[\s-]+(?:one|two|three|four|five|six|seven|eight|nine))?)\s*(?:calls?|phone|ring|inbound)/);
    if (phoneMatch) {
      const val = parseSpokenNumber(phoneMatch[1]);
      if (val && val > 0 && val <= 10000) fields.phoneVolume = val;
    }

    const missedMatch = s.match(/(?:miss(?:ing|ed)?|lose|drop(?:ped)?)\s+(?:about\s+)?(\d+|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty))/);
    if (missedMatch) {
      const val = parseSpokenNumber(missedMatch[1]);
      if (val && val > 0 && val <= 500) fields.missedCalls = val;
    }
    if (!fields.missedCalls) {
      const missedMatch2 = s.match(/(\d+|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty))\s*(?:missed|unanswered|lost|dropped)/);
      if (missedMatch2) {
        const val = parseSpokenNumber(missedMatch2[1]);
        if (val && val > 0 && val <= 500) fields.missedCalls = val;
      }
    }

    const rate = extractPercentageDet(s);
    if (rate !== null) fields.missedCallRate = rate;

    const unit = detectUnit(s);
    if (unit) fields.phoneVolume_unit = unit;
  }

  // ── ch_sarah: old leads ──
  if (stage === 'ch_sarah') {
    const match = s.match(/(\d+|(?:one|two|three|four|five|six|seven|eight|nine|ten|hundred|couple|few)\s*(?:hundred|thousand)?)\s*(?:old|dormant|past|previous|inactive|dead|stale|database|leads?\s+(?:in|on|sitting))/);
    if (match) {
      const val = parseSpokenNumber(match[1]);
      if (val && val > 0) fields.oldLeads = val;
    }
  }

  // ── ch_james: new customers, stars, review system ──
  if (stage === 'ch_james') {
    const custMatch = s.match(/(\d+|(?:one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty))\s*(?:new\s+)?(?:customer|client|patient|job|booking)s?\s*(?:a|per|each|every)\s*(?:week|wk)/);
    if (custMatch) {
      const val = parseSpokenNumber(custMatch[1]);
      if (val && val > 0) fields.newCustomersPerWeek = val;
    }

    const starsMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:star|rating)/);
    if (starsMatch) {
      const val = parseFloat(starsMatch[1]);
      if (val >= 1 && val <= 5) fields.currentStars = val;
    }
  }

  return fields;
}
