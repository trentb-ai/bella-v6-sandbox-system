/**
 * packages/telemetry/src/bug-packet.ts
 * BugPacket builder. Assembles BugPacketV1 for R2 anomaly artifacts.
 * Callers write the packet to R2 — this module only builds it.
 */
/**
 * Build a BugPacketV1 for R2 write.
 * R2 key convention: bug-packets/{callId}/{turnId}.json
 */
export function buildBugPacket(ctx) {
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
export function bugPacketR2Key(callId, turnId) {
    return `bug-packets/${callId}/${turnId}.json`;
}
