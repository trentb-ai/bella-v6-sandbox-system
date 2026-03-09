# LOG REPORT: V3 Pipeline Enrichment Analysis & Persistence Gap

## 1. Executive Summary
The V3 Scraper (`sandbox_personalisedaidemofinal.js`) is an all-in-one orchestrator that has absorbed the logic of several legacy workers (Supreme Court, Lead Pipeline). While it generates a brilliant 110-point data payload, it suffers from a **Persistence Gap** in the sandbox environment.

## 2. The "Double-Blind" KV Race Condition
I have identified a structural conflict in the `fetch` handler:
- **Phase A (Fast Response):** Returns a "stub" to the frontend immediately.
- **Phase B (Background Enrichment):** Uses `ctx.waitUntil()` to perform massive API calls (Gemini, Apify, BuiltWith, etc.) and then writes the result to KV.
- **The Conflict:** Line **6118-6123** explicitly blocks the main handler from writing the Phase A stub to KV. The code comments say: *"Phase B... writes the full 110-point payload... Writing the 15-field stub here would overwrite... incomplete data."*
- **The Failure:** If Phase B (background) crashes, hangs, or exceeds Cloudflare's CPU/Time limits (very likely with 3+ Gemini calls and Apify polling), **nothing is ever written to KV**.

## 3. Critical Failure Points Identified
1. **Background CPU Exhaustion:** The `ctx.waitUntil` block contains 4,000+ lines of regex-heavy auditing and multiple async `fetch` calls. In a sandbox worker, this often exceeds the free/standard tier limits.
2. **Missing Redundancy:** If the "Deep Trace" (Apify) fails at line **151**, the subsequent "Supreme Court" normalization (line **1700+**) might still run, but the final KV write at **5945** relies on `leadIdFromRequest` which might be lost in some branches.
3. **Logic Gate Mismatch:** The code assumes a `body._v3_leadId` exists (line **6061**) to trigger the V3 merge, but doesn't have a fallback "Minimum Viable KV Write" if the background task is still "Processing".

## 4. Proposed Fix Strategy
1. **Immediate Traceability:** Add `console.log` markers for the START and END of Phase B to verify execution in logs.
2. **Safety Net KV Write:** Allow the main handler to write a "Processing" stub to KV *if* no data exists yet, ensuring Bella doesn't hit a 404.
3. **Chunking/Timeouts:** Implement the guardrails discussed in earlier sessions (timeout on `fetchWithRetry`, reduced Apify polling) to ensure the background task completes within Cloudflare's limits.

---
**Status:** Analysis Complete. Transitioning to Implementation Plan.
