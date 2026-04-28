# S5-B Spec — AgentSearchProvider + Findings Context
**Date:** 2026-04-27 AEST | **Author:** T2 | **Worker:** bella-think-agent-v1-brain
**Target version:** 3.11.28-think | **Base commit:** S5-A deployed (after T3B PASS)
**T9 pre-approval:** CONDITIONAL GO (3 conditions — all addressed below)
**Blocking dep:** S5-A MUST be deployed before gating this sprint.

---

## PRE-FLIGHT CHECKLIST (T4 must verify before touching code)

- [ ] Base is S5-A deployed commit (not c9dcbc0)
- [ ] wrangler.toml `main` = `src/worker.ts`
- [ ] Run: `grep -n "CONSULTANT_SYSTEM_PROMPT" src/consultant-agent.ts` — find prompt constant location

---

## CHANGE 1 — `src/consultant-agent.ts`: Add AgentSearchProvider to import

**Location:** Line 5 (existing import from `"agents/experimental/memory/session"`)

**BEFORE:**
```typescript
import { R2SkillProvider } from "agents/experimental/memory/session";
```

**AFTER:**
```typescript
import { R2SkillProvider, AgentSearchProvider } from "agents/experimental/memory/session";
```

---

## CHANGE 2 — `src/consultant-agent.ts`: Add findings context to configureSession()

**Location:** After `.withContext("reasoning", {...})` block, before `.withCachedPrompt()` (~line 41)

**BEFORE:**
```typescript
      .withContext("reasoning", {
        description: "Your analysis reasoning — write structured observations as you work",
        maxTokens: 4000,
      })
      .withCachedPrompt()
```

**AFTER:**
```typescript
      .withContext("reasoning", {
        description: "Your analysis reasoning — write structured observations as you work",
        maxTokens: 4000,
      })
      .withContext("findings", {
        description: "Searchable index of analysis findings. Write key discoveries here so you can search them on subsequent passes. Format: [CATEGORY] finding text",
        provider: new AgentSearchProvider(this),
      })
      .withCachedPrompt()
```

---

## CHANGE 3 — `src/consultant-agent.ts`: Update CONSULTANT_SYSTEM_PROMPT

**Location:** Find `CONSULTANT_SYSTEM_PROMPT` constant via pre-flight grep. Add to the end of the prompt.

**ADD** (append to CONSULTANT_SYSTEM_PROMPT string):
```
You have access to a "findings" context block. Use set_context to index key discoveries as you work (format: [CATEGORY] finding text). Use search_context to retrieve prior findings on subsequent passes. Index findings after each tier completes.
```

---

## CHANGE 4 — `src/consultant-agent.ts`: Update onChatResponse() all-tiers message

**Location:** Inside `onChatResponse()`, the all-tiers-complete saveMessages call (added in S5-A, ~line 318).

**BEFORE:**
```typescript
        parts: [{ type: "text", text: "All tiers complete. Call writeAnalysisReport(format='full'), then call setAnalysisConfidence with your honest assessment." }],
```

**AFTER:**
```typescript
        parts: [{ type: "text", text: "All tiers complete. Index key findings via set_context to findings, call writeAnalysisReport(format='full'), then call setAnalysisConfidence with your honest assessment." }],
```

---

## CHANGE 5 — `src/worker.ts` + `package.json`: Version bump

**BEFORE:**
```typescript
const VERSION = "3.11.27-think";
```
**AFTER:**
```typescript
const VERSION = "3.11.28-think";
```

Also bump `package.json` `"version"` field to `"3.11.28-think"`.

---

## ACCEPTANCE CRITERIA

- [ ] `tsc --noEmit` exits 0
- [ ] `AgentSearchProvider` imported from `"agents/experimental/memory/session"`
- [ ] `findings` context block present in configureSession() chain
- [ ] `findings` block uses `new AgentSearchProvider(this)` as provider
- [ ] CONSULTANT_SYSTEM_PROMPT includes findings workflow instructions
- [ ] onChatResponse all-tiers message includes "Index key findings via set_context"
- [ ] VERSION = "3.11.28-think" in worker.ts AND package.json

---

## NOTES

- Import path `agents/experimental/memory/session` — NOT `@cloudflare/think`. Experimental package. Confirmed: R2SkillProvider already imported from same path (line 5).
- `AgentSearchProvider(this)` — constructor takes agent instance. Confirmed from sessions.md.
- FTS5 query sanitization: individual words auto-quoted. No FTS5 operators (OR/NOT/NEAR) — treated as literals.
- `findings` block placed before `.withCachedPrompt()` — consistent with reasoning block ordering.
- T9 condition 3 (S5-A deployed first) is enforced by base commit requirement above.
