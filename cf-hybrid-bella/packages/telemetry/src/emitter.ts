/**
 * packages/telemetry/src/emitter.ts
 * Structured telemetry emitter. CF Workers structured logging via console.log tags.
 * OTel export is a no-op stub in Chunk 4 — activated in Chunk 10.
 */

export type TelemetryFamily =
  | 'call.lifecycle'
  | 'audio.pipeline'
  | 'brain.turnplan'
  | 'prompt.execution'
  | 'compliance.gate'
  | 'memory.merge'
  | 'intel.hydration'
  | 'quality.outcome';

const FAMILY_TAG: Record<TelemetryFamily, string> = {
  'call.lifecycle':   '[TEL:CALL]',
  'audio.pipeline':   '[TEL:AUDIO]',
  'brain.turnplan':   '[TEL:BRAIN]',
  'prompt.execution': '[TEL:PROMPT]',
  'compliance.gate':  '[TEL:COMPLIANCE]',
  'memory.merge':     '[TEL:MEMORY]',
  'intel.hydration':  '[TEL:INTEL]',
  'quality.outcome':  '[TEL:QUALITY]',
};

export interface TelemetryEvent {
  family: TelemetryFamily;
  callId: string;
  ts: number;            // Date.now()
  durationMs?: number;   // elapsed since turn start, if known
  [key: string]: unknown;
}

/**
 * Emit a telemetry event. Structured log + no-op OTel stub.
 * Safe to call from any Worker — no async, no I/O.
 * NEVER throws.
 */
export function emit(event: TelemetryEvent): void {
  try {
    const tag = FAMILY_TAG[event.family];
    // Structured log — CF Workers picks these up as structured fields
    console.log(`${tag} callId=${event.callId} ts=${event.ts}${event.durationMs != null ? ` durationMs=${event.durationMs}` : ''} ${JSON.stringify(event)}`);
    // OTel stub — no-op in Chunk 4, activated in Chunk 10
    // otelExport(event);
  } catch {
    // Never throw from telemetry
  }
}
