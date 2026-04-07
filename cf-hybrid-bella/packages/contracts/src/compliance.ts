import { z } from 'zod';

export const CompliancePayloadV1 = z.object({
  version: z.literal(1),
  callId: z.string().min(1),
  turnId: z.string().min(1),
  stage: z.string(),
  directive: z.string(),
  bellaResponse: z.string(),
  prospectUtterance: z.string(),
});

export type CompliancePayload = z.infer<typeof CompliancePayloadV1>;

export const ComplianceResultV1 = z.object({
  version: z.literal(1),
  callId: z.string(),
  turnId: z.string(),
  score: z.number().min(0).max(1),
  driftType: z.enum(['none', 'omission', 'substitution', 'hallucination', 'false_claim']).default('none'),
  details: z.string().optional(),
});

export type ComplianceResult = z.infer<typeof ComplianceResultV1>;
