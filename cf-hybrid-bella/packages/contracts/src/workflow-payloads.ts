// ─── BugPacketV1 ─────────────────────────────────────────────────────────────

export interface BugPacketV1 {
  version: 1;
  callId: string;
  turnId: string;
  stage: string;
  ts: string;
  transcriptEntry: { speaker: 'prospect' | 'bella'; text: string; ts: string };
  turnPlan?: unknown;         // TurnPlanV1 — kept unknown to avoid circular dep
  promptSnapshot?: string;
  modelResponseRaw?: string;
  errorMessage?: string;
  timings: Record<string, number>;
}
