import { z } from 'zod';

export const ConsultantResponseV1 = z.object({
  businessIdentity: z.object({
    correctedName: z.string(),
    spokenName: z.string(),
    industry: z.string(),
    businessModel: z.string(),
    serviceArea: z.string().optional(),
  }),
  scriptFills: z.record(z.string().nullable()),
  routing: z.object({
    priority_agents: z.array(z.string()),
    skip_agents: z.array(z.string()).default([]),
  }),
  conversationHooks: z.array(z.object({
    topic: z.string(),
    data: z.string(),
    how: z.string(),
  })).default([]),
  error: z.string().optional(),
  _fallback: z.boolean().optional(),
});

export type ConsultantResponse = z.infer<typeof ConsultantResponseV1>;
