/**
 * fast-intel-v3 Chunk 8B Assertions
 * C8B-01 through C8B-11 — Fast Intel sender
 */

import { describe, test, expect } from 'vitest';
import handler, { normaliseUrl, buildIntelPayload, callConsultant } from '../index';
import { IntelReadyEventV1 } from '@bella/contracts';

// ─── Mock helpers ────────────────────────────────────────────────────────────

const noop = () => Promise.resolve(new Response('{}', { status: 200 }));

function mockEnv(overrides: Record<string, unknown> = {}) {
  return {
    CONSULTANT: { fetch: noop },
    BRAIN: { fetch: noop },
    DEEP_SCRAPE: { fetch: noop },
    FIRECRAWL_API_KEY: 'test-key',
    GEMINI_API_KEY: 'test-key',
    VERSION: '0.2.0',
    ...overrides,
  };
}

const mockCtx = {
  waitUntil: (_p: Promise<unknown>) => { /* fire and forget in tests */ },
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

function makeRequest(path: string, body?: unknown): Request {
  return new Request(`https://test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  });
}

const mockScraped = {
  title: 'KPMG Australia',
  description: 'Professional services',
  markdown: 'KPMG is a global firm.',
  url: 'https://kpmg.com.au',
};

// ─── C8B-01: POST /fast-intel without lid → 400 ──────────────────────────────

describe('C8B-01', () => {
  test('POST /fast-intel without lid → 400', async () => {
    const res = await handler.fetch(
      makeRequest('/fast-intel', { websiteUrl: 'https://kpmg.com.au' }),
      mockEnv() as unknown as Parameters<typeof handler.fetch>[1],
      mockCtx,
    );
    expect(res.status).toBe(400);
  });
});

// ─── C8B-02: POST /fast-intel without websiteUrl → 400 ───────────────────────

describe('C8B-02', () => {
  test('POST /fast-intel without websiteUrl → 400', async () => {
    const res = await handler.fetch(
      makeRequest('/fast-intel', { lid: 'test-lid' }),
      mockEnv() as unknown as Parameters<typeof handler.fetch>[1],
      mockCtx,
    );
    expect(res.status).toBe(400);
  });
});

// ─── C8B-03: POST /fast-intel with valid inputs → 200 { ok, lid } ────────────

describe('C8B-03', () => {
  test('POST /fast-intel with valid inputs → 200 { ok: true, lid }', async () => {
    const res = await handler.fetch(
      makeRequest('/fast-intel', { lid: 'test-lid-123', websiteUrl: 'https://kpmg.com.au' }),
      mockEnv() as unknown as Parameters<typeof handler.fetch>[1],
      mockCtx,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; lid: string };
    expect(json.ok).toBe(true);
    expect(json.lid).toBe('test-lid-123');
  });
});

// ─── C8B-04: normaliseUrl adds https:// ──────────────────────────────────────

describe('C8B-04', () => {
  test("normaliseUrl('example.com') → 'https://example.com'", () => {
    expect(normaliseUrl('example.com')).toBe('https://example.com');
  });
});

// ─── C8B-05: normaliseUrl does not double-add https:// ───────────────────────

describe('C8B-05', () => {
  test("normaliseUrl('https://example.com') → 'https://example.com'", () => {
    expect(normaliseUrl('https://example.com')).toBe('https://example.com');
  });
});

// ─── C8B-06: buildIntelPayload sets lid correctly ────────────────────────────

describe('C8B-06', () => {
  test('buildIntelPayload sets lid correctly', () => {
    const payload = buildIntelPayload('my-lid', 'https://kpmg.com.au', 'Trent', mockScraped, {});
    expect(payload.lid).toBe('my-lid');
  });
});

// ─── C8B-07: buildIntelPayload sets source='fast_intel' ──────────────────────

describe('C8B-07', () => {
  test("buildIntelPayload sets source='fast_intel'", () => {
    const payload = buildIntelPayload('lid', 'https://kpmg.com.au', 'Trent', mockScraped, {});
    expect(payload.source).toBe('fast_intel');
  });
});

// ─── C8B-08: buildIntelPayload sets deep.status='processing' ─────────────────

describe('C8B-08', () => {
  test("buildIntelPayload sets deep.status='processing'", () => {
    const payload = buildIntelPayload('lid', 'https://kpmg.com.au', 'Trent', mockScraped, {});
    expect(payload.deep?.status).toBe('processing');
  });
});

// ─── C8B-09: buildIntelPayload uses scraped.title fallback ───────────────────

describe('C8B-09', () => {
  test('buildIntelPayload uses scraped.title as businessName when consultant has no businessIdentity', () => {
    const payload = buildIntelPayload('lid', 'https://kpmg.com.au', 'Trent', mockScraped, {});
    expect(payload.business_name).toBe('KPMG Australia');
    expect(payload.core_identity.business_name).toBe('KPMG Australia');
  });
});

// ─── C8B-10: callConsultant failure → returns {} without throwing ─────────────

describe('C8B-10', () => {
  test('callConsultant failure (mock throws) → returns {} without throwing', async () => {
    const throwingEnv = {
      CONSULTANT: {
        fetch: () => Promise.reject(new Error('Network error')),
      },
    };
    const result = await callConsultant('lid', 'https://kpmg.com.au', 'Trent', mockScraped, throwingEnv as unknown as Parameters<typeof callConsultant>[4]);
    expect(result).toEqual({});
  });
});

// ─── C8B-11: buildIntelPayload output is valid IntelReadyEventV1 ──────────────

describe('C8B-11', () => {
  test('IntelReadyEventV1.safeParse(buildIntelPayload(...)).success === true', () => {
    const payload = buildIntelPayload(
      'test-lid',
      'https://kpmg.com.au',
      'Trent',
      mockScraped,
      {
        businessIdentity: { businessName: 'KPMG Australia', industry: 'Professional Services' },
      },
    );
    const result = IntelReadyEventV1.safeParse(payload);
    expect(result.success).toBe(true);
  });
});
