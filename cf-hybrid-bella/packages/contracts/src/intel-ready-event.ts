import { z } from 'zod';

export const IntelReadyEventV1 = z.object({
  version: z.literal(1),
  lid: z.string().min(1),
  ts: z.string().datetime(),
  source: z.enum(['fast_intel', 'deep_scrape']),
  business_name: z.string(),
  core_identity: z.object({
    business_name: z.string(),
    industry: z.string(),
    location: z.string().optional(),
  }),
  consultant: z.record(z.unknown()).optional(),
  flags: z.record(z.boolean()).optional(),
  tech_stack: z.record(z.unknown()).optional(),
  deep: z.object({
    status: z.enum(['processing', 'done']),
    googleMaps: z.unknown().optional(),
    ads: z.unknown().optional(),
    hiring: z.unknown().optional(),
  }).optional(),
});

export type IntelReadyEvent = z.infer<typeof IntelReadyEventV1>;

// FastIntelV1 = type alias for IntelReadyEventV1 payload
export type FastIntelV1 = z.infer<typeof IntelReadyEventV1>;
