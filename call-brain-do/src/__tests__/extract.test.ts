import { describe, it, expect } from 'vitest';
import {
  parseNumber,
  normalizeSpokenNumbers,
  extractFromTranscript,
  applyExtraction,
  commitmentKey,
} from '../extract';
import { mockState } from './helpers';

// ─── parseNumber ────────────────────────────────────────────────────────────

describe('parseNumber', () => {
  it('parses dollar amounts', () => {
    expect(parseNumber('$5000')).toBe(5000);
    expect(parseNumber('$250k')).toBe(250000);
    expect(parseNumber('$1.5m')).toBe(1500000);
  });

  it('parses word-based numbers', () => {
    expect(parseNumber('five thousand')).toBe(5000);
    expect(parseNumber('twenty five thousand')).toBe(25000);
    expect(parseNumber('three hundred thousand')).toBe(300000);
  });

  it('parses colloquial amounts', () => {
    expect(parseNumber('half a mill')).toBe(500000);
    expect(parseNumber('quarter mill')).toBe(250000);
    expect(parseNumber('couple hundred')).toBe(200);
    expect(parseNumber('couple thousand')).toBe(2000);
    expect(parseNumber('a thousand')).toBe(1000);
  });

  it('parses digit+suffix combos', () => {
    expect(parseNumber('250k')).toBe(250000);
    expect(parseNumber('1.5m')).toBe(1500000);
    expect(parseNumber('500')).toBe(500);
  });

  it('returns null for empty/invalid', () => {
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('hello')).toBeNull();
  });
});

// ─── normalizeSpokenNumbers ─────────────────────────────────────────────────

describe('normalizeSpokenNumbers', () => {
  it('converts word numbers to digits', () => {
    const result = normalizeSpokenNumbers('about fifty leads a week');
    expect(result).toContain('50');
  });

  it('handles compound word numbers', () => {
    // normalizeSpokenNumbers processes "twenty" and "five thousand" separately
    // Full compound resolution happens in parseNumber
    const result = normalizeSpokenNumbers('five thousand dollars');
    expect(result).toContain('5000');
  });

  it('handles "a couple thousand"', () => {
    const result = normalizeSpokenNumbers('a couple thousand');
    expect(result).toContain('2000');
  });
});

// ─── ResponseSpeedBand extraction ───────────────────────────────────────────

describe('extractFromTranscript — responseSpeedBand mapping', () => {
  const extractBand = (text: string) => {
    const result = extractFromTranscript(text, ['responseSpeedBand'], 'ch_alex');
    return result.fields.responseSpeedBand;
  };

  it('maps "right away" → under_30_seconds', () => {
    expect(extractBand('we get back to them right away')).toBe('under_30_seconds');
  });

  it('maps "within a couple of minutes" → under_5_minutes', () => {
    expect(extractBand('usually within a couple of minutes')).toBe('under_5_minutes');
  });

  it('maps "within half an hour" → 5_to_30_minutes', () => {
    expect(extractBand('within half an hour usually')).toBe('5_to_30_minutes');
  });

  it('maps "hour or two" → 30_minutes_to_2_hours', () => {
    expect(extractBand('usually an hour or two')).toBe('30_minutes_to_2_hours');
  });

  it('maps "same day" → 2_to_24_hours', () => {
    expect(extractBand('usually same day')).toBe('2_to_24_hours');
  });

  it('maps "next day" → next_day_plus', () => {
    expect(extractBand('usually the next day')).toBe('next_day_plus');
  });
});

// ─── Field extraction by stage ──────────────────────────────────────────────

describe('extractFromTranscript — V2 field names', () => {
  it('extracts inboundLeads at ch_alex', () => {
    const result = extractFromTranscript(
      'we get about 50 leads a week',
      ['inboundLeads'], 'ch_alex',
    );
    expect(result.fields.inboundLeads).toBe(50);
  });

  it('extracts inboundConversionRate at ch_alex', () => {
    const result = extractFromTranscript(
      'we convert about 10 percent of them',
      ['inboundConversionRate'], 'ch_alex',
    );
    expect(result.fields.inboundConversionRate).toBe(0.1);
  });

  it('extracts webLeads at ch_chris', () => {
    const result = extractFromTranscript(
      'about 30 leads a week from the website',
      ['webLeads'], 'ch_chris',
    );
    expect(result.fields.webLeads).toBe(30);
  });

  it('extracts phoneVolume at ch_maddie', () => {
    const result = extractFromTranscript(
      'we get about 40 calls a week',
      ['phoneVolume'], 'ch_maddie',
    );
    expect(result.fields.phoneVolume).toBe(40);
  });

  it('extracts missedCalls at ch_maddie', () => {
    const result = extractFromTranscript(
      'we miss about 15 calls a week',
      ['missedCalls'], 'ch_maddie',
    );
    expect(result.fields.missedCalls).toBe(15);
  });

  it('extracts missedCallRate at ch_maddie', () => {
    const result = extractFromTranscript(
      'about 30 percent get missed',
      ['missedCallRate'], 'ch_maddie',
    );
    expect(result.fields.missedCallRate).toBe(0.3);
  });

  it('extracts acv at anchor_acv stage', () => {
    const result = extractFromTranscript(
      'about five thousand dollars',
      ['acv'], 'anchor_acv',
    );
    expect(result.fields.acv).toBe(5000);
  });
});

// ─── Correction detection ───────────────────────────────────────────────────

describe('correction detection', () => {
  it('detects "actually" as correction signal', () => {
    const result = extractFromTranscript(
      'actually it is more like 40 leads a week',
      ['inboundLeads'], 'ch_alex',
    );
    expect(result.correctionDetected).toBe(true);
    expect(result.fields.inboundLeads).toBe(40);
  });

  it('detects "sorry I meant" as correction signal', () => {
    const result = extractFromTranscript(
      'sorry I meant 3000 dollars',
      ['acv'], 'anchor_acv',
    );
    expect(result.correctionDetected).toBe(true);
    expect(result.fields.acv).toBe(3000);
  });

  it('does not flag normal utterances as corrections', () => {
    const result = extractFromTranscript(
      'we get about 50 leads a week',
      ['inboundLeads'], 'ch_alex',
    );
    expect(result.correctionDetected).toBe(false);
  });
});

// ─── applyExtraction — overwrite behavior ────────────────────────────────────

describe('applyExtraction', () => {
  it('writes fields to state when null', () => {
    const state = mockState();
    const result = {
      fields: { acv: 5000, inboundLeads: 50 },
      confidence: 0.8, raw: '', normalized: {},
      correctionDetected: false, memoryNotes: [],
    };
    const applied = applyExtraction(state, result);
    expect(state.acv).toBe(5000);
    expect(state.inboundLeads).toBe(50);
    expect(applied).toContain('acv');
    expect(applied).toContain('inboundLeads');
  });

  it('does NOT overwrite existing value without correction', () => {
    const state = mockState({ acv: 3000 });
    const result = {
      fields: { acv: 5000 },
      confidence: 0.8, raw: '', normalized: {},
      correctionDetected: false, memoryNotes: [],
    };
    applyExtraction(state, result);
    expect(state.acv).toBe(3000); // unchanged
  });

  it('overwrites existing value WITH correction', () => {
    const state = mockState({ acv: 3000 });
    const result = {
      fields: { acv: 5000 },
      confidence: 0.8, raw: '', normalized: {},
      correctionDetected: true, memoryNotes: [],
    };
    applyExtraction(state, result);
    expect(state.acv).toBe(5000); // overwritten
  });
});

// ─── Memory note detection ──────────────────────────────────────────────────

describe('memory note detection via extractFromTranscript', () => {
  it('creates relationship note for family-staff mention', () => {
    const result = extractFromTranscript(
      'my daughter handles reception on Tuesdays',
      [], 'wow',
    );
    expect(result.memoryNotes.length).toBeGreaterThanOrEqual(1);
    const note = result.memoryNotes.find(n => n.category === 'relationship');
    expect(note).toBeDefined();
    expect(note!.status).toBe('active');
    expect(note!.confidence).toBe('stated');
  });

  it('creates objection note for past failure mention', () => {
    const result = extractFromTranscript(
      'we tried agencies before and it did not work',
      [], 'wow',
    );
    const notes = result.memoryNotes.filter(n => n.category === 'objection');
    expect(notes.length).toBeGreaterThanOrEqual(1);
  });

  it('creates no notes from pure filler', () => {
    const result = extractFromTranscript('yeah sure ok', [], 'wow');
    expect(result.memoryNotes).toHaveLength(0);
  });

  it('creates business_context note for scope mention', () => {
    const result = extractFromTranscript(
      'we only do residential plumbing, no commercial',
      [], 'wow',
    );
    const notes = result.memoryNotes.filter(n => n.category === 'business_context');
    expect(notes.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── commitmentKey normalization ─────────────────────────────────────────────

describe('commitmentKey', () => {
  it('normalizes contractions', () => {
    expect(commitmentKey("I'll send that over")).toBe(commitmentKey('i will send that over'));
  });

  it('strips ellipsis and punctuation', () => {
    expect(commitmentKey('...send that over...')).toBe(commitmentKey('send that over'));
  });

  it('is case-insensitive', () => {
    expect(commitmentKey('Send It Over')).toBe(commitmentKey('send it over'));
  });
});

// ─── Canary: conversational numeric answers (Gemini-primary, regex-fallback) ──

describe('contextual regex fallback — conversational answers', () => {
  it('captures "about five" as inboundConversions when in ch_alex with leads populated', () => {
    const state = mockState({ inboundLeads: 50, currentStage: 'ch_alex' });
    const result = extractFromTranscript('about five', ['inboundConversions', 'inboundConversionRate'], 'ch_alex', 'accounting', state);
    expect(result.fields.inboundConversions).toBe(5);
  });

  it('captures "maybe three or four" — takes first number', () => {
    const state = mockState({ inboundLeads: 50, currentStage: 'ch_alex' });
    const result = extractFromTranscript('maybe three or four', ['inboundConversions', 'inboundConversionRate'], 'ch_alex', 'accounting', state);
    expect(result.fields.inboundConversions).toBe(3);
  });

  it('captures "probably around six" as inboundConversions', () => {
    const state = mockState({ inboundLeads: 50, currentStage: 'ch_alex' });
    const result = extractFromTranscript('probably around six', ['inboundConversions', 'inboundConversionRate'], 'ch_alex', 'accounting', state);
    expect(result.fields.inboundConversions).toBe(6);
  });

  it('captures "yeah maybe two" as inboundConversions', () => {
    const state = mockState({ inboundLeads: 50, currentStage: 'ch_alex' });
    const result = extractFromTranscript('yeah maybe two', ['inboundConversions', 'inboundConversionRate'], 'ch_alex', 'accounting', state);
    expect(result.fields.inboundConversions).toBe(2);
  });

  it('captures "not sure maybe around five" as inboundConversions', () => {
    const state = mockState({ inboundLeads: 50, currentStage: 'ch_alex' });
    const result = extractFromTranscript('not sure maybe around five', ['inboundConversions', 'inboundConversionRate'], 'ch_alex', 'accounting', state);
    expect(result.fields.inboundConversions).toBe(5);
  });

  it('captures "roughly twenty percent" as inboundConversionRate', () => {
    const state = mockState({ inboundLeads: 50, currentStage: 'ch_alex' });
    const result = extractFromTranscript('roughly twenty percent', ['inboundConversions', 'inboundConversionRate'], 'ch_alex', 'accounting', state);
    expect(result.fields.inboundConversionRate).toBe(0.2);
  });

  it('captures webConversions "about five" when in ch_chris', () => {
    const state = mockState({ webLeads: 30, currentStage: 'ch_chris' });
    const result = extractFromTranscript('about five', ['webConversions', 'webConversionRate'], 'ch_chris', 'accounting', state);
    expect(result.fields.webConversions).toBe(5);
  });

  it('captures missedCalls "maybe ten" when in ch_maddie', () => {
    const state = mockState({ phoneVolume: 50, currentStage: 'ch_maddie' });
    const result = extractFromTranscript('maybe ten', ['missedCalls', 'missedCallRate'], 'ch_maddie', 'accounting', state);
    expect(result.fields.missedCalls).toBe(10);
  });
});

// ─── Negative guards: false-positive avoidance ──────────────────────────────

describe('contextual regex fallback — negative guards', () => {
  it('does NOT capture staff counts as inboundConversions', () => {
    const state = mockState({ inboundLeads: 50, currentStage: 'ch_alex' });
    const result = extractFromTranscript("we've got five staff", ['inboundConversions'], 'ch_alex', 'accounting', state);
    expect(result.fields.inboundConversions).toBeUndefined();
  });

  it('does NOT capture ACV as inboundConversions', () => {
    const state = mockState({ inboundLeads: 50, acv: 5000, currentStage: 'ch_alex' });
    const result = extractFromTranscript('our ACV is five grand', ['inboundConversions'], 'ch_alex', 'accounting', state);
    expect(result.fields.inboundConversions).toBeUndefined();
  });

  it('does NOT capture leads count as inboundConversions (same utterance)', () => {
    const state = mockState({ inboundLeads: 50, currentStage: 'ch_alex' });
    const result = extractFromTranscript('we get fifty leads a month', ['inboundConversions', 'inboundLeads'], 'ch_alex', 'accounting', state);
    // fifty = 50 = same as inboundLeads → should NOT be captured as conversions
    expect(result.fields.inboundConversions).toBeUndefined();
  });

  it('does NOT capture team/office count as inboundConversions', () => {
    const state = mockState({ inboundLeads: 50, currentStage: 'ch_alex' });
    const result = extractFromTranscript('there are five people in the office', ['inboundConversions'], 'ch_alex', 'accounting', state);
    expect(result.fields.inboundConversions).toBeUndefined();
  });

  it('does NOT capture number >= inboundLeads as conversions (parent-child bound)', () => {
    const state = mockState({ inboundLeads: 10, currentStage: 'ch_alex' });
    const result = extractFromTranscript('about fifteen', ['inboundConversions'], 'ch_alex', 'accounting', state);
    expect(result.fields.inboundConversions).toBeUndefined();
  });

  it('does NOT capture missedCalls > phoneVolume (parent-child bound)', () => {
    const state = mockState({ phoneVolume: 20, currentStage: 'ch_maddie' });
    const result = extractFromTranscript('about thirty', ['missedCalls'], 'ch_maddie', 'accounting', state);
    expect(result.fields.missedCalls).toBeUndefined();
  });

  it('does NOT capture webConversions > webLeads (parent-child bound)', () => {
    const state = mockState({ webLeads: 10, currentStage: 'ch_chris' });
    const result = extractFromTranscript('about fifteen', ['webConversions'], 'ch_chris', 'accounting', state);
    expect(result.fields.webConversions).toBeUndefined();
  });
});
