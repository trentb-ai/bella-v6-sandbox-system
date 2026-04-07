/**
 * brain-v3/src/facts.ts — Universal Data Law implementation
 * Chunk 1 — V3
 *
 * getFact() source priority waterfall: hotMemory > prospect > consultant > scrape > industry_default
 * shouldAskQuestion() with FIELD_EQUIVALENTS prevents re-asking equivalent fields
 */

import type { WarmFact, DataSource } from './types';
import { SOURCE_PRIORITY } from './types';

// ─── FIELD EQUIVALENTS ──────────────────────────────────────────────────────

export const FIELD_EQUIVALENTS: Record<string, string[]> = {
  webLeads:              ['webLeads', 'inboundLeads'],
  inboundLeads:          ['inboundLeads', 'webLeads'],
  webConversions:        ['webConversions', 'inboundConversions'],
  inboundConversions:    ['inboundConversions', 'webConversions'],
  webConversionRate:     ['webConversionRate', 'inboundConversionRate'],
  inboundConversionRate: ['inboundConversionRate', 'webConversionRate'],
};

// ─── getFact() ──────────────────────────────────────────────────────────────

/**
 * Resolve a fact value using the source priority waterfall.
 * HotMemory (in-call extracted values) wins over all D1 rows.
 */
export function getFact(
  key: string,
  hotMemory: Record<string, string | number | null>,
  warmFacts: WarmFact[],
): string | number | null {
  // 1. HotMemory (current call extractions) wins
  if (hotMemory[key] != null) return hotMemory[key];

  // 2. D1 warm facts — priority waterfall
  const matching = warmFacts.filter(f => f.fact_key === key);
  for (const source of SOURCE_PRIORITY) {
    const found = matching.find(f => f.data_source === source);
    if (found) return found.fact_value;
  }

  return null;
}

// ─── shouldAskQuestion() ────────────────────────────────────────────────────

/**
 * Returns true if the field (or any equivalent) has NO value anywhere.
 * Returns false if the field or an equivalent already has a value — do not ask.
 */
export function shouldAskQuestion(
  fieldKey: string,
  hotMemory: Record<string, string | number | null>,
  warmFacts: WarmFact[],
): boolean {
  const equivalents = FIELD_EQUIVALENTS[fieldKey] ?? [fieldKey];
  return !equivalents.some(f => getFact(f, hotMemory, warmFacts) != null);
}

// ─── resolveBusinessName() ──────────────────────────────────────────────────

/**
 * NB2: Authoritative business name resolution.
 * consultant.correctedName > core_identity > scrape > fallback
 */
export function resolveBusinessName(
  hotMemory: Record<string, string | number | null>,
  warmFacts: WarmFact[],
): string {
  // 1. Consultant-corrected name (highest authority)
  const consultantName = getFact('business_name', hotMemory,
    warmFacts.filter(f => f.data_source === 'consultant'));
  if (consultantName) return String(consultantName);

  // 2. Any warm fact for business_name (full waterfall)
  const anyName = getFact('business_name', hotMemory, warmFacts);
  if (anyName) return String(anyName);

  // 3. Fallback
  return 'your business';
}

// ─── D1 Hydration ───────────────────────────────────────────────────────────

/**
 * Load all warm facts for a lead from D1 at call start.
 */
export async function hydrateFacts(db: D1Database, leadId: string): Promise<WarmFact[]> {
  const result = await db.prepare(
    'SELECT fact_key, fact_value, data_source, confidence FROM lead_facts WHERE lead_id = ? ORDER BY data_source ASC'
  ).bind(leadId).all<WarmFact>();
  return result.results ?? [];
}

// ─── D1 Persistence ─────────────────────────────────────────────────────────

/**
 * Persist extracted facts to D1 with source-aware upsert.
 * Only writes prospect-sourced facts from in-call extraction.
 */
export async function persistFacts(
  db: D1Database,
  leadId: string,
  facts: Record<string, string | number | null>,
  stage: string,
): Promise<void> {
  const entries = Object.entries(facts).filter(([, v]) => v != null);
  if (entries.length === 0) return;

  const stmts = entries.map(([key, value]) =>
    db.prepare(
      `INSERT INTO lead_facts (id, lead_id, fact_key, fact_value, data_source, confidence, captured_at, captured_during)
       VALUES (?, ?, ?, ?, 'prospect', 1.0, datetime('now'), ?)
       ON CONFLICT (lead_id, fact_key, data_source) DO UPDATE SET
         fact_value = excluded.fact_value,
         confidence = excluded.confidence,
         captured_at = excluded.captured_at`
    ).bind(`${leadId}_${key}_prospect`, leadId, key, String(value), stage)
  );

  await db.batch(stmts);
}
