import { z } from 'zod';

export const TelemetryEventV1 = z.object({
  version: z.literal(1),
  callId: z.string(),
  turnId: z.string().optional(),
  worker: z.string(),
  event: z.string(),
  ts: z.string().datetime(),
  data: z.record(z.unknown()).default({}),
});

export type TelemetryEvent = z.infer<typeof TelemetryEventV1>;

// ─── SLO ─────────────────────────────────────────────────────────────────────

export const SLO_LIMITS = {
  transcriptToTurnPlan: 150,   // ms
  promptToFirstToken: 500,     // ms
  endToEnd: 1200,              // ms
  bargeInClear: 100,           // ms
} as const;

export type SLOMetric = keyof typeof SLO_LIMITS;

export interface SLOViolationV1 {
  version: 1;
  metric: SLOMetric;
  limitMs: number;
  actualMs: number;
  callId: string;
  turnId?: string;
  ts: string;
}
