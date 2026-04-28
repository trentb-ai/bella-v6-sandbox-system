REGRESSION_VERDICT: CONDITIONAL_PASS — S3-A BLOCKED
Sprint: S3-A — ConsultantAgent Tier 1 rewrite (3.11.17-think)
Judged by: T3B (Sonnet) | Codex: codex-cli 0.118.0 | CWD: bella-think-agent-v1-brain | effort: medium
Date: 2026-04-27 AEST

Layer 1 (hard gates): PASS
- Health: 3.11.17-think confirmed
- tsc: PASS
- ROIAgent: zero references to ConsultantAgent — untouched
- Worker exports all agents in health response

Layer 2 (semantic quality): CONDITIONAL
BLOCKER — BellaAgent extraction path broken (HIGH):
- bella-agent.ts:751: onEvent callback accumulates textDelta/text/content only — tool output events ignored
- bella-agent.ts:767: JSON.parse(responseText) expects JSON text from consultant
- consultant-agent.ts:226: new system prompt "Store results via tools — do not describe them in text"
- Result: LLM text is narrative → JSON.parse FAILS → catch → rawAnalysis fallback
- Impact: scriptFills, routing, hooks never reach state.intel.consultant
- Bella loses all personalization (scriptFills, icpNarrative, conversionNarrative, routing)
- Call path live: bella-agent.ts:588-593: fires on every session with starterIntel.core_identity.website
- Regression vs old ConsultantAgent (d52d184): old produced JSON text → scriptFills populated; new does not
- Confirmed by Codex source verification of both files

T2 description discrepancy: T2 claimed BellaAgent NOT wired to ConsultantAgent. Factually incorrect.
- bella-agent.ts:7: import { ConsultantAgent }
- bella-agent.ts:590: this.runConsultantAnalysis(starterIntel) — live call, not dormant

Layer 3 (drift signals): ADVISORY
- beforeTurn() Tier 3 tool names (analyzeIndustryContext, identifyQuoteInputs, assessGrowthOpportunities, prepareAgentBriefs) not in getTools(). SDK behavior for non-existent activeTools names unverified — route to T3A before Tier 2 can complete in any multi-turn session.

Conditions to upgrade to PASS:
(A) Fix BellaAgent.runConsultantAnalysis(): read child.state after chat() completes OR handle tool_result events in onEvent callback. Deploy new version. Re-gate.

Recommendation: BLOCK — sprint open until condition (A) satisfied.
