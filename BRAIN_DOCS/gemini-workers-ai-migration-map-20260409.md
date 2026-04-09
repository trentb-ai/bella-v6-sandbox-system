# Gemini → Workers AI Migration Map — Full Revert Guide
**Filed:** 2026-04-09 AEST
**Doc ID:** doc-gemini-workers-ai-migration-map-20260409
**Project:** bella-v11
**Type:** architecture_decision

## Overview
Migration of all Gemini API calls to Cloudflare Workers AI (`@cf/qwen/qwen3-30b-a3b-fp8`). 4 workers affected. This doc is the canonical revert guide.

---

## WORKER 1: consultant-v10
**Source dir:** `bella-consultant/`
**Pre-migration VERSION:** 6.12.0-pass2
**Post-migration VERSION:** 6.13.0

### Functions replaced
| Old signature | New signature |
|---|---|
| `callMicro(name, prompt, apiKey)` | `callMicro(name, prompt, env)` |
| `runFastConsultant(payload, env2)` — Gemini fetch | `runFastConsultant(payload, env2)` — `env2.AI.run` |

### Old model/endpoint removed
- `const OPENAI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"` — deleted entirely
- `const MODELS = [...]` array — deleted entirely
- Model string: `gemini-2.5-flash`

### Old API key reference removed
- `const apiKey = env2.GEMINI_API_KEY` — removed from `runConsultant()` and `runPass2Consultant()`
- `apiKey` param removed from all 4 `callMicro()` callers

### How to restore Gemini
1. Re-add `const OPENAI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";`
2. Restore `callMicro(name, prompt, apiKey)` with `fetch` to `OPENAI_ENDPOINT`, `model: 'gemini-2.5-flash'`, `Authorization: Bearer ${apiKey}`
3. Restore `runFastConsultant` Gemini fetch block, parse `response?.choices?.[0]?.message?.content`
4. Restore `const apiKey = env2.GEMINI_API_KEY` in `runConsultant()` + `runPass2Consultant()`
5. Pass `apiKey` as 3rd arg to all `callMicro()` callers
6. Remove `[ai]` binding from `wrangler.toml`
7. `npx wrangler secret put GEMINI_API_KEY --name consultant-v10`

---

## WORKER 2: deepgram-bridge-v2-rescript
**Source dir:** `bridge-v2-rescript/src/`
**Pre-migration VERSION:** v6.31.0-workers-ai
**Post-migration VERSION:** v6.32.0

### Functions replaced
| Old | New |
|---|---|
| `buildScribePayload(utterance, recentTurns, currentStage, activeMemoryTitles, geminiApiKey)` | `buildScribeMessages(utterance, recentTurns, currentStage, activeMemoryTitles)` |
| `callScribeGemini(payload, currentStage, timeoutMs)` | `callScribeWorkersAI(messages, currentStage, env, timeoutMs)` |
| `runScribe(..., geminiApiKey, CALL_BRAIN)` | `runScribe(..., env, CALL_BRAIN)` |

### Old model/endpoint removed
- `const MODEL = "@cf/meta/llama-3.1-8b-instruct"` → upgraded to `@cf/qwen/qwen3-30b-a3b-fp8`
- Inline `env.AI.run("@cf/meta/llama-3.1-8b-instruct", ...)` at line 2283 → upgraded
- `scribe.ts`: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` fetch — removed
- `scribe.ts` model: `gemini-2.5-flash` — removed

### Old API key reference removed
- `env.GEMINI_API_KEY` guard in `runScribe` callers (lines ~3060, ~3404) — removed, rest of condition kept
- `'x-gemini-key': env.GEMINI_API_KEY || ''` header at line ~2640 — removed

### How to restore Gemini
1. Restore `const MODEL = "@cf/meta/llama-3.1-8b-instruct"` (or revert to Gemini model string)
2. In `scribe.ts`: restore `buildScribePayload` with `fetch` to `generativelanguage.googleapis.com`, `model: 'gemini-2.5-flash'`
3. Restore `callScribeGemini` with Gemini fetch + streaming parse
4. Restore `runScribe` `geminiApiKey` param, pass `env.GEMINI_API_KEY` from callers
5. Restore `env.GEMINI_API_KEY` guards in both `runScribe` callers
6. Restore `'x-gemini-key': env.GEMINI_API_KEY || ''` header
7. `npx wrangler secret put GEMINI_API_KEY --name deepgram-bridge-v2-rescript`

---

## WORKER 3: bella-scrape-workflow-v10-rescript
**Source dir:** `bella-scrape-workflow-v10-rescript/src/steps/gemini-deep-insights.ts`
**Pre-migration VERSION:** v1.7.0-fix-write-intel-refError
**Post-migration VERSION:** v1.8.0

### Functions replaced
| Old | New |
|---|---|
| `callGeminiMicro(source, rawData, businessName, icpGuess, apiKey)` | `callWorkersAIMicro(source, rawData, businessName, icpGuess, env2)` |

### Old model/endpoint removed
- `const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"` — deleted
- `model: 'gemini-2.5-flash'` inside fetch body — removed
- `fetch()` to `GEMINI_ENDPOINT` → `env2.AI.run('@cf/qwen/qwen3-30b-a3b-fp8', ...)`

### Old API key reference removed
- `const apiKey = env.GEMINI_API_KEY || ''` in `geminiDeepInsights()` — removed
- `if (!apiKey)` guard → replaced with `if (!env2.AI)` guard
- `apiKey` param in all `callGeminiMicro()` callers — removed

### How to restore Gemini
1. Re-add `const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";`
2. Restore `callGeminiMicro(source, rawData, businessName, icpGuess, apiKey)` with `fetch`, `model: 'gemini-2.5-flash'`
3. Restore `const apiKey = env.GEMINI_API_KEY || ''` in `geminiDeepInsights()`
4. Restore `if (!apiKey) { console.log('[DEEP_INSIGHTS] No GEMINI_API_KEY — skipping'); return; }` guard
5. Pass `apiKey` to all `callGeminiMicro()` callers
6. `npx wrangler secret put GEMINI_API_KEY --name bella-scrape-workflow-v10-rescript`

> **SCOPE GAP:** `src/deployed.js` also contains a Gemini call (~line 1987, script polishing/WOW section). NOT migrated in this session. Separate task required before running secret deletion.

---

## WORKER 4: bella-brain-v3
**Source dir:** `cf-hybrid-bella/workers/brain-v3/src/`
**Pre-migration VERSION:** 1.19.11
**Post-migration VERSION:** 1.19.12

### Functions replaced
None — `grep` of `src/` returned zero `gemini`/`GEMINI`/`llama-3.1-8b` matches. No active AI model calls in brain-v3 source.

### Old model/endpoint removed
None.

### Old API key reference removed
None. `fast-intel-v3` has `GEMINI_API_KEY` in env type definition only (not an active call) — no action taken.

### How to restore Gemini
N/A — no Gemini was present.

---

## POST-MIGRATION CLEANUP
**Run ONLY after all 4 workers confirmed healthy AND deployed.js scope gap resolved.**
```bash
npx wrangler secret delete GEMINI_API_KEY --name consultant-v10
npx wrangler secret delete GEMINI_API_KEY --name deepgram-bridge-v2-rescript
npx wrangler secret delete GEMINI_API_KEY --name bella-scrape-workflow-v10-rescript
```
