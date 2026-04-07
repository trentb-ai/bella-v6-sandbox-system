import { z } from 'zod';

export const TurnRequestV1 = z.object({
  version: z.literal(1),
  callId: z.string().min(1),
  turnId: z.string().min(1),
  utterance: z.string(),
  speakerFlag: z.enum(['prospect', 'bella', 'unknown']),
  turnIndex: z.number().int().nonnegative(),
});

export type TurnRequest = z.infer<typeof TurnRequestV1>;

export const TurnPlanV1 = z.object({
  version: z.literal(1),
  callId: z.string().min(1),
  turnId: z.string().min(1),
  stage: z.string(),
  moveId: z.string(),
  directive: z.string(),
  speakText: z.string().optional(),
  mandatory: z.boolean().default(false),
  maxTokens: z.number().int().default(150),
  confirmedFacts: z.array(z.string()).default([]),
  activeMemory: z.array(z.string()).default([]),
  contextNotes: z.array(z.string()).default([]),
  extractionTargets: z.array(z.string()).default([]),
  allowFreestyle: z.boolean().default(true),
  improvisationBand: z.enum(['strict', 'wide', 'narrow']).default('wide'),
  intent: z.enum(['interested', 'objecting', 'confused', 'ready_to_buy', 'off_topic', 'neutral']).optional(),
  consultantReady: z.boolean().default(false),
});

export type TurnPlan = z.infer<typeof TurnPlanV1>;
