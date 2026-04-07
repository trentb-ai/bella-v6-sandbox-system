/**
 * fast-intel-v3/src/index.ts — Fast Intel sender
 * Chunk 8B — posts IntelReadyEventV1 to Brain DO /event/fast-intel
 */

import { type IntelReadyEvent, IntelReadyEventV1 } from '@bella/contracts';

const VERSION = '0.2.0';

interface Env {
  CONSULTANT: Fetcher;
  BRAIN: Fetcher;
  DEEP_SCRAPE: Fetcher;
  FIRECRAWL_API_KEY: string;
  GEMINI_API_KEY: string;
  VERSION: string;
}

interface ScrapeResult {
  title: string;
  description: string;
  markdown: string;
  url: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ version: env.VERSION ?? VERSION, worker: 'fast-intel-v3' });
    }

    if (url.pathname === '/fast-intel' && request.method === 'POST') {
      const body = await request.json().catch(() => null);
      if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 });

      const lid: string = (body as Record<string, unknown>).lid as string ?? '';
      const websiteUrl: string = normaliseUrl(
        ((body as Record<string, unknown>).websiteUrl ?? (body as Record<string, unknown>).website_url ?? '') as string
      );
      const firstName: string = ((body as Record<string, unknown>).firstName ?? (body as Record<string, unknown>).first_name ?? 'there') as string;
      const email: string = ((body as Record<string, unknown>).email ?? '') as string;

      if (!lid || !websiteUrl) {
        return Response.json({ error: 'lid and websiteUrl required' }, { status: 400 });
      }

      console.log(`[FAST_INTEL] lid=${lid} url=${websiteUrl} fn=${firstName}`);

      ctx.waitUntil(runPipeline(lid, websiteUrl, firstName, email, env));
      return Response.json({ ok: true, lid });
    }

    return new Response('Not found', { status: 404 });
  },
};

// ─── Pipeline ────────────────────────────────────────────────────────────────

async function runPipeline(lid: string, websiteUrl: string, firstName: string, email: string, env: Env): Promise<void> {
  try {
    const scraped = await scrapeWithFirecrawl(websiteUrl, env.FIRECRAWL_API_KEY);
    const consultantResult = await callConsultant(lid, websiteUrl, firstName, scraped, env);
    const payload = buildIntelPayload(lid, websiteUrl, firstName, scraped, consultantResult);

    await env.BRAIN.fetch(new Request('https://brain-internal/event/fast-intel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    console.log(`[FAST_INTEL] event posted to brain lid=${lid}`);

    env.DEEP_SCRAPE.fetch(new Request('https://deep-scrape/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lid, websiteUrl, firstName }),
    })).catch((e: Error) => console.log(`[FAST_INTEL] deep-scrape trigger failed: ${e.message}`));

  } catch (e) {
    const err = e as Error;
    console.log(`[FAST_INTEL] pipeline error lid=${lid}: ${err.message}`);
  }
}

// ─── Scrape ───────────────────────────────────────────────────────────────────

async function scrapeWithFirecrawl(websiteUrl: string, apiKey: string): Promise<ScrapeResult> {
  const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ url: websiteUrl, formats: ['markdown'], onlyMainContent: true }),
  });
  if (!res.ok) throw new Error(`Firecrawl ${res.status}`);
  const data = await res.json() as { data?: { markdown?: string; metadata?: { title?: string; description?: string } } };
  const meta = data.data?.metadata ?? {};
  return {
    title: meta.title ?? '',
    description: meta.description ?? '',
    markdown: (data.data?.markdown ?? '').slice(0, 8000),
    url: websiteUrl,
  };
}

// ─── Consultant ───────────────────────────────────────────────────────────────

// Exported for test: C8B-10 verifies failure returns {} without throwing
export async function callConsultant(
  lid: string,
  websiteUrl: string,
  firstName: string,
  scraped: ScrapeResult,
  env: Pick<Env, 'CONSULTANT'>,
): Promise<Record<string, unknown>> {
  try {
    const res = await env.CONSULTANT.fetch(new Request('https://consultant/analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lid, websiteUrl, firstName,
        siteContent: scraped.markdown.slice(0, 4000),
        title: scraped.title,
        description: scraped.description,
      }),
    }));
    if (!res.ok) throw new Error(`Consultant ${res.status}`);
    return await res.json() as Record<string, unknown>;
  } catch (e) {
    const err = e as Error;
    console.log(`[FAST_INTEL] consultant failed lid=${lid}: ${err.message}`);
    return {};
  }
}

// ─── Payload builder ──────────────────────────────────────────────────────────

export function buildIntelPayload(
  lid: string,
  websiteUrl: string,
  firstName: string,
  scraped: ScrapeResult,
  consultant: Record<string, unknown>,
): IntelReadyEvent {
  const bizId = consultant.businessIdentity as Record<string, string> | undefined;
  const businessName = bizId?.businessName ?? scraped.title ?? lid;

  const consultantPayload = Object.keys(consultant).length > 0 ? consultant : undefined;
  const flagsRaw = buildFlagsRaw(consultant);
  const techRaw = buildTechStackRaw(consultant);
  const flagsPayload = Object.keys(flagsRaw).length > 0 ? flagsRaw : undefined;
  const techStackPayload = Object.keys(techRaw).length > 0 ? techRaw : undefined;

  return {
    version: 1,
    lid,
    ts: new Date().toISOString(),
    source: 'fast_intel',
    business_name: businessName,
    core_identity: {
      business_name: businessName,
      industry: bizId?.industry ?? 'unknown',
      location: bizId?.location,
    },
    consultant: consultantPayload,
    flags: flagsPayload,
    tech_stack: techStackPayload,
    deep: { status: 'processing' },
  };
}

function buildFlagsRaw(consultant: Record<string, unknown>): Record<string, boolean> {
  return (consultant.flags as Record<string, boolean> | undefined) ?? {};
}

function buildTechStackRaw(consultant: Record<string, unknown>): Record<string, unknown> {
  return (consultant.techStack ?? consultant.tech_stack) as Record<string, unknown> | undefined ?? {};
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function normaliseUrl(raw: string): string {
  if (!raw) return '';
  const s = raw.trim();
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  return `https://${s}`;
}
