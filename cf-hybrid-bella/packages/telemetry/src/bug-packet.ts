/**
 * packages/telemetry/src/bug-packet.ts
 * BugPacket builder. Assembles BugPacketV1 for R2 anomaly artifacts.
 * Callers write the packet to R2 — this module only builds it.
 */

import type { BugPacketV1, TurnPlanV1 } from '@bella/contracts';

export interface BugPacketContext {
  callId: string;
  turnId: string;
  stage: string;
  transcriptEntry: { speaker: 'prospect' | 'bella'; text: string; ts: string };
  turnPlan?: TurnPlanV1;
  promptSnapshot?: string;
  modelResponseRaw?: string;
  errorMessage?: string;
  timings: Record<string, number>;
}

/**
 * Build a BugPacketV1 for R2 write.
 * R2 key convention: bug-packets/{callId}/{turnId}.json
 */
export function buildBugPacket(ctx: BugPacketContext): BugPacketV1 {
  return {
    version: 1,
    callId: ctx.callId,
    turnId: ctx.turnId,
    stage: ctx.stage,
    ts: new Date().toISOString(),
    transcriptEntry: ctx.transcriptEntry,
    turnPlan: ctx.turnPlan,
    promptSnapshot: ctx.promptSnapshot,
    modelResponseRaw: ctx.modelResponseRaw,
    errorMessage: ctx.errorMessage,
    timings: ctx.timings,
  };
}

/** R2 key for a bug packet */
export function bugPacketR2Key(callId: string, turnId: string): string {
  return `bug-packets/${callId}/${turnId}.json`;
}
