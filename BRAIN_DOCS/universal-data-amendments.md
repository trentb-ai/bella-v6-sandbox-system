# BELLA V3 — Universal Data Visibility + Source Priority Amendments
**D1 ID:** doc-bella-v3-universal-data-amendments-20260407

BELLA V3 — UNIVERSAL DATA VISIBILITY + SOURCE PRIORITY
AMENDMENTS TO CHUNKS 0, 1, AND 5
Filed: 7 April 2026 AEST

Purpose: Ensure all data captured from the prospect is universally available across all channel contexts, and prospect-stated data always takes priority over scraped/consultant data.

CONTEXT:
Bella is one voice. She operates in different channel contexts (Alex-mode, Chris-mode, Maddie-mode) but the prospect is talking to ONE agent. When the prospect tells Bella "we get 50 leads a week" during Alex-mode, that fact MUST be available when Bella is in Chris-mode, Maddie-mode, recommendation, close — everywhere.

Historical bug: The V1/V2 brain tracked separate field names per channel context (inboundLeads for Alex, webLeads for Chris). When Bella switched from Alex-mode to Chris-mode, she did not check if the prospect had already answered an equivalent question. Result: Bella asked the same question twice, prospect said "you already asked me that." This was descoped as a known gap in Cleanest Bella (Q3 CRITICAL) and never fixed.

Old workaround: geminiExtractHistory() ran a full LLM call after every stage advance to retroactively cross-fill fields. This was duct tape — an entire Gemini call just to move data between state silos. V3 must solve this architecturally, not with duct tape.

DESIGN PRINCIPLES:
- DO NOT rename existing field names — they represent genuinely different business metrics
- DO NOT merge data — merging is where bugs live
- DO NOT destroy or rewrite existing extraction logic
- DO add source tagging at write time (additive, zero risk)
- DO add a read-time priority waterfall (no overwrites, all data preserved)
- DO add an equivalence check before Bella asks any question (read-only check)

═══════════════════════════════════════════════════════════
AMENDMENT 1 — CHUNK 0: D1 SCHEMA (packages/db/migrations/)
═══════════════════════════════════════════════════════════

Add data_source column to lead_facts table. This is the ONLY schema change.

In migration 0002_lead_memory.sql, the lead_facts CREATE TABLE becomes:

CREATE TABLE lead_facts (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  fact_value TEXT NOT NULL,
  data_source TEXT NOT NULL DEFAULT 'extraction',  -- 'prospect' | 'consultant' | 'scrape' | 'industry_default'
  confidence REAL DEFAULT 1.0,
  captured_at TEXT NOT NULL,
  captured_during TEXT,          -- channel context when captured (e.g. 'ch_alex'), for audit trail only
  UNIQUE(lead_id, fact_key, data_source)  -- keep one value per fact per source, not one value total
);

WHY UNIQUE(lead_id, fact_key, data_source): We keep ALL values — the prospect said 50 leads, the consultant estimated 75, the scrape found 200. All three rows exist. The Brain reads with source priority to decide which to use. Nothing is overwritten. Nothing is destroyed.

Add assertion to Chunk 0:
C0-07: lead_facts table has data_source column with NOT NULL constraint
C0-08: UNIQUE constraint allows same fact_key from different sources for same lead

═══════════════════════════════════════════════════════════
AMENDMENT 2 — CHUNK 1: BRAIN DO (bella-brain-v3)
═══════════════════════════════════════════════════════════

TWO additions to the Brain DO. Both are read-only functions. No changes to state writes, stage machine, or TurnPlan generation logic.

ADDITION 2A: getFact() — Source Priority Waterfall

```typescript
function getFact(key: string, hotMemory: HotMemory, warmFacts: WarmFact[]): string | null {
  if (hotMemory[key] != null) return hotMemory[key];
  const matching = warmFacts.filter(f => f.fact_key === key);
  return matching.find(f => f.data_source === 'prospect')?.fact_value
      ?? matching.find(f => f.data_source === 'consultant')?.fact_value
      ?? matching.find(f => f.data_source === 'scrape')?.fact_value
      ?? matching.find(f => f.data_source === 'industry_default')?.fact_value
      ?? null;
}
```

ADDITION 2B: shouldAskQuestion() — Equivalence Check

```typescript
const FIELD_EQUIVALENTS: Record<string, string[]> = {
  webLeads:        ['webLeads', 'inboundLeads'],
  inboundLeads:    ['inboundLeads', 'webLeads'],
  webConversions:  ['webConversions', 'inboundConversions'],
  inboundConversions: ['inboundConversions', 'webConversions'],
  webConversionRate:  ['webConversionRate', 'inboundConversionRate'],
  inboundConversionRate: ['inboundConversionRate', 'webConversionRate'],
};

function shouldAskQuestion(fieldKey: string, hotMemory: HotMemory, warmFacts: WarmFact[]): boolean {
  const equivalents = FIELD_EQUIVALENTS[fieldKey] ?? [fieldKey];
  return !equivalents.some(f => getFact(f, hotMemory, warmFacts) != null);
}
```

CRITICAL RULE — UNIVERSAL DATA LAW:
When generating a TurnPlan for ANY channel context, the Brain reads ALL lead_facts for this leadId. No channel filtering.

New assertions C1-24 through C1-30 (see full doc in D1).

═══════════════════════════════════════════════════════════
AMENDMENT 3 — CHUNK 5: EXTRACTION WORKFLOW
═══════════════════════════════════════════════════════════

- Source tag every extracted fact: data_source = 'prospect'
- Source-aware upsert: ON CONFLICT (lead_id, fact_key, data_source) — never touches other source rows
- Number normalisation: words-to-numbers before Gemini extraction

New assertions C5-11 through C5-15 (see full doc in D1).

═══════════════════════════════════════════════════════════
AMENDMENT 4 — CHUNK 8: INTEL HYDRATION SOURCE TAGGING
═══════════════════════════════════════════════════════════

- Fast-intel data → data_source = 'scrape'
- Consultant analysis → data_source = 'consultant'
- Deep scrape (Apify) → data_source = 'scrape'
- Industry defaults → data_source = 'industry_default'
