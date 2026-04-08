/**
 * packages/telemetry/src/slo.ts
 * SLO checker. Reads SLO_LIMITS from contracts, emits violation log if exceeded.
 * NEVER throws.
 */
import { SLO_LIMITS } from '@bella/contracts';
/**
 * Check a timing against its SLO limit.
 * Logs [SLO_VIOLATION] if exceeded. Returns null if within limit.
 * Safe — no throws.
 */
export function checkSLO(metric, durationMs, context) {
    try {
        const limitMs = SLO_LIMITS[metric];
        if (durationMs <= limitMs)
            return null;
        const violation = {
            version: 1,
            metric,
            limitMs,
            actualMs: durationMs,
            callId: context.callId,
            turnId: context.turnId,
            ts: new Date().toISOString(),
        };
        console.log(`[SLO_VIOLATION] metric=${metric} actual=${durationMs}ms limit=${limitMs}ms callId=${context.callId}`);
        return violation;
    }
    catch {
        // Never throw from telemetry
        return null;
    }
}
