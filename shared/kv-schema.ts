// shared/kv-schema.ts — Single source of truth for KV keys
// Import into every TS worker. For JS workers (consultant-v9): inline as string constants.

export const kvKey = {
  // ── Primary lead data ──────────────────────────────────────────────────
  intel:          (lid: string) => `lead:${lid}:intel`,         // ONE key for all lead intel (V6 compat)

  // ── V8 Supergod layered intel keys ────────────────────────────────────
  // fast-intel writes here (Firecrawl + Gemini Consultant, ~8-12s)
  fastIntel:      (lid: string) => `lead:${lid}:fast-intel`,
  // deep-scrape writes here (5x Apify actors concurrent, ~30-60s)
  deepIntel:      (lid: string) => `lead:${lid}:deepIntel`,
  // big-scraper fallback (110-point pipeline, ~60-120s)
  stub:           (lid: string) => `lead:${lid}:stub`,
  // bella-scrape-workflow-v9 consolidates all layers → single call brief
  callBrief:      (lid: string) => `lead:${lid}:call_brief`,

  // ── Bridge session state ───────────────────────────────────────────────
  scriptState:    (lid: string) => `lead:${lid}:script_state`,
  scriptStages:   (lid: string) => `lead:${lid}:script_stages`, // consultant writes → bridge reads
  capturedInputs: (lid: string) => `lead:${lid}:captured_inputs`,
  convMemory:     (lid: string) => `lead:${lid}:conv_memory`,   // canonical memory key

  // ── Outputs ────────────────────────────────────────────────────────────
  roi:            (lid: string) => `lead:${lid}:roi`,           // bella-tools writes after calc
  outcome:        (lid: string) => `lead:${lid}:outcome`,       // ONE writer: bella-tools only
  handoff:        (lid: string) => `lead:${lid}:handoff`,
  bellaPlan:      (lid: string) => `lead:${lid}:bella:plan`,

  // ── User-collected inputs ──────────────────────────────────────────────
  userInput:      (lid: string, field: string) => `lead:${lid}:user_${field}`,

  // ── GHL / identity ────────────────────────────────────────────────────
  cid:            (contactId: string) => `cid:${contactId}`,
  pending:        (token: string) => `pending:${token}`,        // written by voice-agent on call init

  // ── Static brain content ───────────────────────────────────────────────
  brainPrompt:    () => 'brain:bella:prompt',
  brainScriptKb:  () => 'brain:bella:script_kb',
} as const;

export const kvTTL = {
  intel:      86400,    // 24h  — lead data
  fastIntel:  86400,    // 24h  — fast-intel layer
  deepIntel:  86400,    // 24h  — deep-scrape layer
  callBrief:  14400,    // 4h   — consolidated call brief (session lifetime)
  session:    14400,    // 4h   — call session keys
  outcome:    2592000,  // 30d  — outcome/handoff records
} as const;

// Type helper for KV key functions
export type KvKeyFn = typeof kvKey;
