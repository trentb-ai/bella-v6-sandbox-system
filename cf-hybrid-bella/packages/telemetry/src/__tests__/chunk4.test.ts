/**
 * packages/telemetry Chunk 4 Assertions
 * C4-01 through C4-10
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { emit, type TelemetryEvent } from '../emitter';
import { checkSLO } from '../slo';
import { buildBugPacket, bugPacketR2Key } from '../bug-packet';
import { SLO_LIMITS } from '@bella/contracts';

// ─── C4-01: emit() logs correct family tag ───────────────────────────────────

describe('C4-01: emit logs correct family tag', () => {
  test('brain.turnplan emits [TEL:BRAIN] tag', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    emit({ family: 'brain.turnplan', callId: 'call-1', ts: Date.now() });
    expect(spy.mock.calls[0][0]).toContain('[TEL:BRAIN]');
    spy.mockRestore();
  });

  test('compliance.gate emits [TEL:COMPLIANCE] tag', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    emit({ family: 'compliance.gate', callId: 'call-1', ts: Date.now() });
    expect(spy.mock.calls[0][0]).toContain('[TEL:COMPLIANCE]');
    spy.mockRestore();
  });
});

// ─── C4-02: emit() includes callId and ts in log output ──────────────────────

describe('C4-02: emit includes callId and ts', () => {
  test('log line contains callId and ts', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const ts = Date.now();
    emit({ family: 'prompt.execution', callId: 'call-abc', ts });
    const logLine = spy.mock.calls[0][0] as string;
    expect(logLine).toContain('callId=call-abc');
    expect(logLine).toContain(`ts=${ts}`);
    spy.mockRestore();
  });
});

// ─── C4-03: checkSLO() returns null when duration <= limit ───────────────────

describe('C4-03: checkSLO within limit returns null', () => {
  test('returns null when durationMs <= limitMs', () => {
    const result = checkSLO('transcriptToTurnPlan', 100, { callId: 'call-1' });
    expect(result).toBeNull();
  });

  test('returns null when durationMs equals limitMs exactly', () => {
    const result = checkSLO('transcriptToTurnPlan', 150, { callId: 'call-1' });
    expect(result).toBeNull();
  });
});

// ─── C4-04: checkSLO() returns SLOViolationV1 when duration > limit ──────────

describe('C4-04: checkSLO exceeded returns SLOViolationV1', () => {
  test('returns violation object with correct fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = checkSLO('transcriptToTurnPlan', 200, { callId: 'call-2', turnId: 'turn-1' });
    expect(result).not.toBeNull();
    expect(result?.version).toBe(1);
    expect(result?.metric).toBe('transcriptToTurnPlan');
    expect(result?.limitMs).toBe(150);
    expect(result?.actualMs).toBe(200);
    expect(result?.callId).toBe('call-2');
    expect(result?.turnId).toBe('turn-1');
    spy.mockRestore();
  });
});

// ─── C4-05: checkSLO() logs [SLO_VIOLATION] when exceeded ───────────────────

describe('C4-05: checkSLO logs [SLO_VIOLATION] when exceeded', () => {
  test('console.log contains [SLO_VIOLATION]', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    checkSLO('promptToFirstToken', 1000, { callId: 'call-3' });
    expect(spy.mock.calls[0][0]).toContain('[SLO_VIOLATION]');
    spy.mockRestore();
  });
});

// ─── C4-06: buildBugPacket() includes all required fields ────────────────────

describe('C4-06: buildBugPacket includes all required fields', () => {
  test('returns BugPacketV1 with all mandatory fields', () => {
    const packet = buildBugPacket({
      callId: 'call-1',
      turnId: 'turn-1',
      stage: 'ch_alex',
      transcriptEntry: { speaker: 'prospect', text: 'hello', ts: new Date().toISOString() },
      timings: { turnPlan: 42 },
    });
    expect(packet.version).toBe(1);
    expect(packet.callId).toBe('call-1');
    expect(packet.turnId).toBe('turn-1');
    expect(packet.stage).toBe('ch_alex');
    expect(packet.transcriptEntry.speaker).toBe('prospect');
    expect(packet.timings.turnPlan).toBe(42);
    expect(typeof packet.ts).toBe('string');
  });
});

// ─── C4-07: bugPacketR2Key() returns correct path format ────────────────────

describe('C4-07: bugPacketR2Key correct path', () => {
  test('returns bug-packets/{callId}/{turnId}.json', () => {
    expect(bugPacketR2Key('call-1', 'turn-2')).toBe('bug-packets/call-1/turn-2.json');
  });
});

// ─── C4-08: emit() does not throw on unknown callId ─────────────────────────

describe('C4-08: emit does not throw', () => {
  test('no throw on empty callId', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(() => emit({ family: 'call.lifecycle', callId: '', ts: 0 })).not.toThrow();
    spy.mockRestore();
  });

  test('no throw on unusual event shape', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(() => emit({ family: 'memory.merge', callId: 'x', ts: Date.now(), nested: { a: 1 } })).not.toThrow();
    spy.mockRestore();
  });
});

// ─── C4-09: checkSLO() does not throw ───────────────────────────────────────

describe('C4-09: checkSLO does not throw', () => {
  test('no throw on valid inputs', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(() => checkSLO('endToEnd', 9999, { callId: 'call-x' })).not.toThrow();
    spy.mockRestore();
  });
});

// ─── C4-10: SLO_LIMITS from contracts are source of truth ───────────────────

describe('C4-10: SLO_LIMITS from contracts, no hardcoded values', () => {
  test('SLO_LIMITS.transcriptToTurnPlan is 150', () => {
    expect(SLO_LIMITS.transcriptToTurnPlan).toBe(150);
  });
  test('SLO_LIMITS.promptToFirstToken is 500', () => {
    expect(SLO_LIMITS.promptToFirstToken).toBe(500);
  });
  test('SLO_LIMITS.endToEnd is 1200', () => {
    expect(SLO_LIMITS.endToEnd).toBe(1200);
  });
  test('SLO_LIMITS.bargeInClear is 100', () => {
    expect(SLO_LIMITS.bargeInClear).toBe(100);
  });
  test('checkSLO uses SLO_LIMITS — 150ms limit for transcriptToTurnPlan', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const violation = checkSLO('transcriptToTurnPlan', 151, { callId: 'c' });
    expect(violation?.limitMs).toBe(SLO_LIMITS.transcriptToTurnPlan);
    spy.mockRestore();
  });
});
