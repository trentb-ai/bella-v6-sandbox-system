import { z } from 'zod';

// ─── BugPacketV1 ─────────────────────────────────────────────────────────────

export const BugPacketV1 = z.object({
  version: z.literal(1),
  callId: z.string(),
  turnId: z.string(),
  stage: z.string(),
  ts: z.string(),
  transcriptEntry: z.object({ speaker: z.enum(['prospect', 'bella']), text: z.string(), ts: z.string() }),
  turnPlan: z.unknown().optional(),
  promptSnapshot: z.string().optional(),
  modelResponseRaw: z.string().optional(),
  errorMessage: z.string().optional(),
  timings: z.record(z.number()),
});
export type BugPacketV1 = z.infer<typeof BugPacketV1>;
