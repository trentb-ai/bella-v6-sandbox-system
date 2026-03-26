/**
 * call-brain-do/src/gemini-extract.ts — v2.0.0
 * Primary extraction via Gemini 2.5 Flash structured output.
 * Field names match ConversationState + V2_SCALAR_FIELDS exactly.
 * Returns null on any failure — caller falls back to regex.
 */

import type { StageId, WowStepId } from './types';

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const GEMINI_TIMEOUT_MS = 8000; // 8s — Gemini cold start can take 3-5s, voice call can absorb this on collection turns

/**
 * Strip preamble text, code fences, and trailing text from Gemini's JSON response.
 * Gemini often wraps JSON in: "Here is the JSON requested:\n```json\n{...}\n```"
 * This extracts just the JSON object between the first { and last }.
 */
function cleanJsonResponse(raw: string): string {
  let s = raw.trim();
  // Strip markdown code fences first
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  // Find the first { and last } — extract the JSON object
  const firstBrace = s.indexOf('{');
  const lastBrace = s.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    s = s.slice(firstBrace, lastBrace + 1);
  }
  return s;
}

// ─── Field specs per stage — names MUST match ConversationState exactly ──────

interface FieldSpec {
  type: string;
  description: string;
  enum?: string[];
  nullable?: boolean;
}

const STAGE_SCHEMAS: Record<string, Record<string, FieldSpec>> = {

  // ── anchor_acv stage ──
  anchor_acv: {
    acv: {
      type: 'NUMBER', nullable: true,
      description: 'Average client/customer value in dollars. Convert spoken: "five thousand"=5000, "ten k"=10000, "a grand"=1000, "quarter mil"=250000, "two fifty"=250, "about 500"=500. Return null if not stated.',
    },
  },

  // ── ch_alex stage — Alex speed-to-lead inputs ──
  ch_alex: {
    inboundLeads: {
      type: 'NUMBER', nullable: true,
      description: 'Inbound leads or enquiries per week. ANY number the prospect gives when asked about leads/enquiries counts: "fifty"=50, "about twenty"=20, "couple hundred"=200, "ten or so"=10, bare "50"=50. If they gave a number in response to a question about leads, ALWAYS return it. Return null ONLY if they refused or did not mention any number.',
    },
    inboundConversions: {
      type: 'NUMBER', nullable: true,
      description: 'How many leads convert to paying clients per week. "about five become clients"=5, "maybe three"=3, "two or three"=2. Return null if not stated.',
    },
    inboundConversionRate: {
      type: 'NUMBER', nullable: true,
      description: 'Conversion rate as decimal ONLY if they state a percentage. "25 percent"=0.25, "ten percent"=0.1. Return null if they give a count instead of a rate.',
    },
    responseSpeedBand: {
      type: 'STRING', nullable: true,
      enum: ['under_30_seconds', 'under_5_minutes', '5_to_30_minutes', '30_minutes_to_2_hours', '2_to_24_hours', 'next_day_plus'],
      description: 'How fast they follow up leads. Map: "instantly/straight away"→under_30_seconds, "few minutes/pretty quick"→under_5_minutes, "within half hour/15-20 min"→5_to_30_minutes, "hour or two/within the hour"→30_minutes_to_2_hours, "same day/few hours/end of day"→2_to_24_hours, "next day/tomorrow/day or two"→next_day_plus. Return null if not stated.',
    },
  },

  // ── ch_chris stage — Chris website conversion inputs ──
  ch_chris: {
    webLeads: {
      type: 'NUMBER', nullable: true,
      description: 'Website leads or enquiries per week. Return null if not stated.',
    },
    webConversions: {
      type: 'NUMBER', nullable: true,
      description: 'Website leads converting to paying clients per week. Return null if not stated.',
    },
    webConversionRate: {
      type: 'NUMBER', nullable: true,
      description: 'Website conversion rate as decimal ONLY if percentage stated. Return null if count given instead.',
    },
  },

  // ── ch_maddie stage — Maddie missed call recovery inputs ──
  ch_maddie: {
    phoneVolume: {
      type: 'NUMBER', nullable: true,
      description: 'Inbound phone calls per week. Return null if not stated.',
    },
    missedCalls: {
      type: 'NUMBER', nullable: true,
      description: 'Missed or unanswered calls per week. Return null if not stated.',
    },
    missedCallRate: {
      type: 'NUMBER', nullable: true,
      description: 'Missed call rate as decimal ONLY if percentage stated. "30 percent"=0.3. Return null if count given instead.',
    },
  },

  // ── ch_sarah stage — Sarah database reactivation inputs ──
  ch_sarah: {
    oldLeads: {
      type: 'NUMBER', nullable: true,
      description: 'Number of old/dormant/past leads or contacts in their database. "a few hundred"=300, "about a thousand"=1000, "maybe 500"=500, "couple thousand"=2000. Return null if not stated.',
    },
  },

  // ── ch_james stage — James reputation manager inputs ──
  ch_james: {
    newCustomersPerWeek: {
      type: 'NUMBER', nullable: true,
      description: 'New customers or clients gained per week. "about ten"=10, "five or six"=5, "a couple"=2. Return null if not stated.',
    },
    currentStars: {
      type: 'NUMBER', nullable: true,
      description: 'Current Google star rating. "we are at 3.5"=3.5, "four point two"=4.2, "about four stars"=4.0. Return null if not stated.',
    },
    hasReviewSystem: {
      type: 'BOOLEAN', nullable: true,
      description: 'Whether they currently have a system for collecting/managing reviews. "yes we use Google reviews"=true, "no not really"=false, "we send follow-up emails asking for reviews"=true. Return null if not mentioned.',
    },
  },

  // ── wow_8_source_check — lead source routing ──
  wow_source: {
    leadSourceDominant: {
      type: 'STRING', nullable: true,
      enum: ['website', 'ads', 'phone', 'organic', 'other'],
      description: 'Primary source of new business. "website/online/forms"→website, "Google/Facebook ads/paid"→ads, "phone calls/ring"→phone, "SEO/organic/Google search"→organic, anything else→other. Return null if unclear.',
    },
    websiteRelevant: {
      type: 'BOOLEAN', nullable: true,
      description: 'Did they mention website/online/forms as a lead source? true if yes, null if not mentioned.',
    },
    phoneRelevant: {
      type: 'BOOLEAN', nullable: true,
      description: 'Did they mention phone/calls as a lead source? true if yes, null if not mentioned.',
    },
    adsConfirmed: {
      type: 'BOOLEAN', nullable: true,
      description: 'Did they mention paid ads (Google Ads, Facebook Ads, Meta, PPC, campaigns) as a lead source? true if yes, null if not mentioned.',
    },
  },
};

// ─── Schema resolution ──────────────────────────────────────────────────────

function getSchemaKey(stage: StageId, wowStep?: WowStepId | null): string | null {
  if (stage === 'anchor_acv') return 'anchor_acv';
  if (stage === 'ch_alex') return 'ch_alex';
  if (stage === 'ch_chris') return 'ch_chris';
  if (stage === 'ch_maddie') return 'ch_maddie';
  if (stage === 'ch_sarah') return 'ch_sarah';
  if (stage === 'ch_james') return 'ch_james';
  if (stage === 'wow' && wowStep === 'wow_8_source_check') return 'wow_source';
  return null;
}

function buildGeminiSchema(fields: Record<string, FieldSpec>): Record<string, any> {
  const properties: Record<string, any> = {};
  for (const [name, spec] of Object.entries(fields)) {
    const prop: any = { type: spec.type, description: spec.description };
    if (spec.enum) prop.enum = spec.enum;
    if (spec.nullable) prop.nullable = true;
    properties[name] = prop;
  }
  return { type: 'OBJECT', properties, propertyOrdering: Object.keys(fields) };
}

// ─── Combined history schema — merges ALL stage schemas for post-advance extraction ──

const HISTORY_SCHEMA: Record<string, FieldSpec> = Object.assign(
  {},
  ...Object.values(STAGE_SCHEMAS),
);

// ─── System prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You extract structured data from a voice sales call transcript. Rules:
- Convert ALL spoken numbers to digits: "five"=5, "twenty"=20, "five thousand"=5000, "ten k"=10000, "couple hundred"=200, "a grand"=1000
- Dollar amounts: number only, no $ symbol
- Percentages: decimal form. "25 percent"=0.25, "ten percent"=0.1
- Response speed: map to closest enum value
- Lead sources: identify channel(s) mentioned
- Return null for ANY field not clearly stated
- Filler ("yeah", "sure", "ok", "sounds good", "go ahead") = null for ALL fields
- "about"/"roughly"/"around"/"maybe" qualifiers = still extract the number
- If TWO numbers in one answer ("20 leads and 5 become clients"), extract BOTH to their respective fields
- Do NOT assign the same number to multiple fields`;

const HISTORY_SYSTEM_PROMPT = `You extract structured data from a voice sales call CONVERSATION HISTORY.
This contains multiple user statements from different points in the call.
Rules:
- Convert ALL spoken numbers to digits: "five"=5, "twenty"=20, "five thousand"=5000, "ten k"=10000, "couple hundred"=200, "a grand"=1000
- Dollar amounts: number only, no $ symbol
- Percentages: decimal form. "25 percent"=0.25, "ten percent"=0.1
- CRITICAL: Numbers appear in different conversational contexts. A dollar value (e.g., "twenty thousand", "$5,000", "ten k" when discussing client value) is an ACV/deal value — do NOT extract it as lead volume, phone volume, or any count field. Only the "acv" field should hold dollar values.
- Only extract a field if the user CLEARLY stated that specific data point.
- Return null for any field not clearly stated.
- Filler ("yeah", "sure", "ok", "sounds good", "go ahead") = null for ALL fields.
- "about"/"roughly"/"around"/"maybe" qualifiers = still extract the number.
- If TWO numbers in one answer ("20 leads and 5 become clients"), extract BOTH to their respective fields.
- Do NOT assign the same number to multiple fields.`;

// ─── Result type ────────────────────────────────────────────────────────────

export interface GeminiExtractionResult {
  fields: Record<string, number | string | boolean | null>;
  correctionDetected: boolean;
  source: 'gemini';
  latencyMs: number;
}

// ─── Main export ────────────────────────────────────────────────────────────

export async function geminiExtract(
  transcript: string,
  stage: StageId,
  wowStep: WowStepId | null | undefined,
  geminiApiKey: string,
): Promise<GeminiExtractionResult | null> {
  const schemaKey = getSchemaKey(stage, wowStep);
  if (!schemaKey) return null;

  const fieldSpecs = STAGE_SCHEMAS[schemaKey];
  if (!fieldSpecs) return null;

  const correctionDetected = /\b(actually|sorry|wait|I mean|not quite|correction|that's wrong|no[,\s]+it's|no[,\s]+we)\b/i.test(transcript);

  // On correction, use ALL schemas to catch corrected values for any field
  let effectiveSpecs = fieldSpecs;
  if (correctionDetected) {
    effectiveSpecs = {};
    for (const schema of Object.values(STAGE_SCHEMAS)) Object.assign(effectiveSpecs, schema);
  }

  const body = {
    contents: [{ role: 'user', parts: [{ text: `Prospect said: "${transcript}"` }] }],
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: buildGeminiSchema(effectiveSpecs),
      maxOutputTokens: 256,
      temperature: 0,
    },
  };

  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), GEMINI_TIMEOUT_MS);

    const res = await fetch(`${GEMINI_URL}?key=${geminiApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const ms = Date.now() - t0;

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.error(`[GEMINI_EXTRACT_ERR] status=${res.status} body=${err.slice(0, 200)} ms=${ms}`);
      return null;
    }

    const data = await res.json() as any;
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) {
      console.error(`[GEMINI_EXTRACT_ERR] no text in response ms=${ms}`);
      return null;
    }

    let parsed: Record<string, any>;
    try { parsed = JSON.parse(cleanJsonResponse(raw)); } catch {
      console.error(`[GEMINI_EXTRACT_ERR] bad JSON: ${raw.slice(0, 200)} ms=${ms}`);
      return null;
    }

    // Validate types strictly against schema
    const fields: Record<string, number | string | boolean | null> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value === null || value === undefined) continue;
      const spec = effectiveSpecs[key];
      if (!spec) continue;
      if (spec.type === 'NUMBER' && typeof value === 'number' && value > 0) fields[key] = value;
      else if (spec.type === 'STRING' && typeof value === 'string' && value.length > 0) fields[key] = value;
      else if (spec.type === 'BOOLEAN' && typeof value === 'boolean') fields[key] = value;
    }

    console.log(`[GEMINI_EXTRACT] stage=${stage} schema=${schemaKey} fields=${Object.keys(fields).length} keys=[${Object.keys(fields).join(',')}] correction=${correctionDetected} ms=${ms}`);
    return { fields, correctionDetected, source: 'gemini', latencyMs: ms };

  } catch (err: any) {
    const ms = Date.now() - t0;
    if (err.name === 'AbortError') console.warn(`[GEMINI_EXTRACT_TIMEOUT] stage=${stage} ms=${GEMINI_TIMEOUT_MS}`);
    else console.error(`[GEMINI_EXTRACT_ERR] stage=${stage} ${err.message} ms=${ms}`);
    return null;
  }
}

// ─── History extraction — all-fields schema for post-advance historical scan ─

export async function geminiExtractHistory(
  historicalText: string,
  geminiApiKey: string,
): Promise<GeminiExtractionResult | null> {
  if (!historicalText || historicalText.trim().length < 5) return null;

  const body = {
    contents: [{ role: 'user', parts: [{ text: `Conversation history: "${historicalText}"` }] }],
    systemInstruction: { parts: [{ text: HISTORY_SYSTEM_PROMPT }] },
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: buildGeminiSchema(HISTORY_SCHEMA),
      maxOutputTokens: 256,
      temperature: 0,
    },
  };

  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), GEMINI_TIMEOUT_MS);

    const res = await fetch(`${GEMINI_URL}?key=${geminiApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const ms = Date.now() - t0;

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.error(`[GEMINI_HISTORY_ERR] status=${res.status} body=${err.slice(0, 200)} ms=${ms}`);
      return null;
    }

    const data = await res.json() as any;
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) {
      console.error(`[GEMINI_HISTORY_ERR] no text in response ms=${ms}`);
      return null;
    }

    let parsed: Record<string, any>;
    try { parsed = JSON.parse(cleanJsonResponse(raw)); } catch {
      console.error(`[GEMINI_HISTORY_ERR] bad JSON: ${raw.slice(0, 200)} ms=${ms}`);
      return null;
    }

    // Validate types strictly against schema
    const fields: Record<string, number | string | boolean | null> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value === null || value === undefined) continue;
      const spec = HISTORY_SCHEMA[key];
      if (!spec) continue;
      if (spec.type === 'NUMBER' && typeof value === 'number' && value > 0) fields[key] = value;
      else if (spec.type === 'STRING' && typeof value === 'string' && value.length > 0) fields[key] = value;
      else if (spec.type === 'BOOLEAN' && typeof value === 'boolean') fields[key] = value;
    }

    console.log(`[GEMINI_HISTORY] fields=${Object.keys(fields).length} keys=[${Object.keys(fields).join(',')}] ms=${ms}`);
    return { fields, correctionDetected: false, source: 'gemini', latencyMs: ms };

  } catch (err: any) {
    const ms = Date.now() - t0;
    if (err.name === 'AbortError') console.warn(`[GEMINI_HISTORY_TIMEOUT] ms=${GEMINI_TIMEOUT_MS}`);
    else console.error(`[GEMINI_HISTORY_ERR] ${err.message} ms=${ms}`);
    return null;
  }
}
