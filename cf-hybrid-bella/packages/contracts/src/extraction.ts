import { z } from 'zod';

export const ExtractionPayloadV1 = z.object({
  version: z.literal(1),
  callId: z.string().min(1),
  turnId: z.string().min(1),
  utterance: z.string(),
  speakerFlag: z.enum(['prospect', 'bella']),
  stage: z.string(),
  targets: z.array(z.string()),
  existingFacts: z.record(z.unknown()).default({}),
});

export type ExtractionPayload = z.infer<typeof ExtractionPayloadV1>;

export const ExtractionResultV1 = z.object({
  version: z.literal(1),
  callId: z.string(),
  turnId: z.string(),
  extracted: z.record(z.unknown()),
  confidence: z.record(z.number()).optional(),
});

export type ExtractionResult = z.infer<typeof ExtractionResultV1>;
