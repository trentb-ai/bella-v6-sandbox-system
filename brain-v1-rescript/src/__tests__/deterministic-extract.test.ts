import { describe, it, expect } from 'vitest';
import {
  parseSpokenNumber,
  parseDuration,
  mapDurationToBand,
  deterministicExtract,
} from '../deterministic-extract';

// ─── parseSpokenNumber ──────────────────────────────────────────────────────

describe('parseSpokenNumber', () => {
  it('parses digit numbers', () => {
    expect(parseSpokenNumber('50')).toBe(50);
    expect(parseSpokenNumber('250')).toBe(250);
    expect(parseSpokenNumber('5000')).toBe(5000);
  });

  it('parses word numbers', () => {
    expect(parseSpokenNumber('five')).toBe(5);
    expect(parseSpokenNumber('twenty')).toBe(20);
    expect(parseSpokenNumber('fifty')).toBe(50);
    expect(parseSpokenNumber('twelve')).toBe(12);
  });

  it('parses compound word numbers', () => {
    expect(parseSpokenNumber('twenty five')).toBe(25);
    expect(parseSpokenNumber('thirty two')).toBe(32);
    expect(parseSpokenNumber('ninety nine')).toBe(99);
  });

  it('parses hundreds', () => {
    expect(parseSpokenNumber('a hundred')).toBe(100);
    expect(parseSpokenNumber('two hundred')).toBe(200);
    expect(parseSpokenNumber('three hundred fifty')).toBe(350);
  });

  it('parses thousands with word numbers', () => {
    expect(parseSpokenNumber('five thousand')).toBe(5000);
    expect(parseSpokenNumber('twenty thousand')).toBe(20000);
    expect(parseSpokenNumber('fifty thousand')).toBe(50000);
    expect(parseSpokenNumber('twenty five thousand')).toBe(25000);
  });

  it('parses with magnitude suffixes', () => {
    expect(parseSpokenNumber('50k')).toBe(50000);
    expect(parseSpokenNumber('250k')).toBe(250000);
    expect(parseSpokenNumber('1.5m')).toBe(1500000);
    expect(parseSpokenNumber('ten k')).toBe(10000);
  });

  it('parses colloquial amounts', () => {
    expect(parseSpokenNumber('couple hundred')).toBe(200);
    expect(parseSpokenNumber('couple thousand')).toBe(2000);
    expect(parseSpokenNumber('few hundred')).toBe(300);
    expect(parseSpokenNumber('few thousand')).toBe(3000);
    expect(parseSpokenNumber('half a mill')).toBe(500000);
    expect(parseSpokenNumber('quarter mill')).toBe(250000);
  });

  it('strips casual qualifiers', () => {
    expect(parseSpokenNumber('about twenty')).toBe(20);
    expect(parseSpokenNumber('maybe five')).toBe(5);
    expect(parseSpokenNumber('roughly ten')).toBe(10);
    expect(parseSpokenNumber('approximately fifty')).toBe(50);
  });

  it('returns null for non-numbers', () => {
    expect(parseSpokenNumber('')).toBeNull();
    expect(parseSpokenNumber('hello world')).toBeNull();
    expect(parseSpokenNumber('yes')).toBeNull();
  });
});

// ─── parseDuration ──────────────────────────────────────────────────────────

describe('parseDuration', () => {
  it('parses digit hours', () => {
    expect(parseDuration('8 hours')).toEqual({ value: 8, unit: 'hours' });
    expect(parseDuration('48 hours')).toEqual({ value: 48, unit: 'hours' });
    expect(parseDuration('24 hours')).toEqual({ value: 24, unit: 'hours' });
  });

  it('parses word hours', () => {
    expect(parseDuration('eight hours')).toEqual({ value: 8, unit: 'hours' });
    expect(parseDuration('two hours')).toEqual({ value: 2, unit: 'hours' });
    expect(parseDuration('twelve hours')).toEqual({ value: 12, unit: 'hours' });
  });

  it('parses compound word hours', () => {
    expect(parseDuration('twenty four hours')).toEqual({ value: 24, unit: 'hours' });
  });

  it('parses casual hour expressions', () => {
    expect(parseDuration('about 8 hours')).toEqual({ value: 8, unit: 'hours' });
    expect(parseDuration('couple of hours')).toEqual({ value: 2, unit: 'hours' });
    expect(parseDuration('few hours')).toEqual({ value: 3, unit: 'hours' });
    expect(parseDuration('an hour')).toEqual({ value: 1, unit: 'hours' });
    expect(parseDuration('within the hour')).toEqual({ value: 1, unit: 'hours' });
    expect(parseDuration('hour or two')).toEqual({ value: 2, unit: 'hours' });
  });

  it('parses day expressions', () => {
    expect(parseDuration('next day')).toEqual({ value: 1, unit: 'days' });
    expect(parseDuration('tomorrow')).toEqual({ value: 1, unit: 'days' });
    expect(parseDuration('couple of days')).toEqual({ value: 2, unit: 'days' });
    expect(parseDuration('few days')).toEqual({ value: 3, unit: 'days' });
    expect(parseDuration('2 days')).toEqual({ value: 2, unit: 'days' });
    expect(parseDuration('next morning')).toEqual({ value: 1, unit: 'days' });
    expect(parseDuration('day or two')).toEqual({ value: 2, unit: 'days' });
  });

  it('parses "same day" / "end of day"', () => {
    expect(parseDuration('same day')).toEqual({ value: 8, unit: 'hours' });
    expect(parseDuration('end of day')).toEqual({ value: 8, unit: 'hours' });
    expect(parseDuration('later that day')).toEqual({ value: 8, unit: 'hours' });
  });

  it('parses minute expressions', () => {
    expect(parseDuration('few minutes')).toEqual({ value: 3, unit: 'minutes' });
    expect(parseDuration('15 minutes')).toEqual({ value: 15, unit: 'minutes' });
    expect(parseDuration('fifteen minutes')).toEqual({ value: 15, unit: 'minutes' });
    expect(parseDuration('couple of minutes')).toEqual({ value: 2, unit: 'minutes' });
    expect(parseDuration('half an hour')).toEqual({ value: 30, unit: 'minutes' });
    expect(parseDuration('twenty five minutes')).toEqual({ value: 25, unit: 'minutes' });
  });

  it('parses instant expressions', () => {
    expect(parseDuration('instantly')).toEqual({ value: 0, unit: 'seconds' });
    expect(parseDuration('straight away')).toEqual({ value: 0, unit: 'seconds' });
    expect(parseDuration('right away')).toEqual({ value: 0, unit: 'seconds' });
    expect(parseDuration('immediately')).toEqual({ value: 0, unit: 'seconds' });
  });

  it('parses week expressions', () => {
    expect(parseDuration('a week')).toEqual({ value: 1, unit: 'weeks' });
    expect(parseDuration('couple of weeks')).toEqual({ value: 2, unit: 'weeks' });
    expect(parseDuration('3 weeks')).toEqual({ value: 3, unit: 'weeks' });
  });

  it('parses half a day', () => {
    expect(parseDuration('half a day')).toEqual({ value: 12, unit: 'hours' });
  });

  it('returns null for non-duration text', () => {
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('yes sounds good')).toBeNull();
    expect(parseDuration('fifty thousand')).toBeNull();
  });
});

// ─── mapDurationToBand ──────────────────────────────────────────────────────

describe('mapDurationToBand', () => {
  it('maps instant to under_30_seconds', () => {
    expect(mapDurationToBand({ value: 0, unit: 'seconds' })).toBe('under_30_seconds');
    expect(mapDurationToBand({ value: 10, unit: 'seconds' })).toBe('under_30_seconds');
    expect(mapDurationToBand({ value: 30, unit: 'seconds' })).toBe('under_30_seconds');
  });

  it('maps few minutes to under_5_minutes', () => {
    expect(mapDurationToBand({ value: 2, unit: 'minutes' })).toBe('under_5_minutes');
    expect(mapDurationToBand({ value: 3, unit: 'minutes' })).toBe('under_5_minutes');
    expect(mapDurationToBand({ value: 5, unit: 'minutes' })).toBe('under_5_minutes');
  });

  it('maps 15-30 min to 5_to_30_minutes', () => {
    expect(mapDurationToBand({ value: 15, unit: 'minutes' })).toBe('5_to_30_minutes');
    expect(mapDurationToBand({ value: 30, unit: 'minutes' })).toBe('5_to_30_minutes');
  });

  it('maps 1-2 hours to 30_minutes_to_2_hours', () => {
    expect(mapDurationToBand({ value: 1, unit: 'hours' })).toBe('30_minutes_to_2_hours');
    expect(mapDurationToBand({ value: 2, unit: 'hours' })).toBe('30_minutes_to_2_hours');
  });

  it('maps 3-24 hours to 2_to_24_hours', () => {
    expect(mapDurationToBand({ value: 3, unit: 'hours' })).toBe('2_to_24_hours');
    expect(mapDurationToBand({ value: 8, unit: 'hours' })).toBe('2_to_24_hours');
    expect(mapDurationToBand({ value: 24, unit: 'hours' })).toBe('2_to_24_hours');
  });

  it('maps days/weeks to next_day_plus', () => {
    expect(mapDurationToBand({ value: 1, unit: 'days' })).toBe('next_day_plus');
    expect(mapDurationToBand({ value: 2, unit: 'days' })).toBe('next_day_plus');
    expect(mapDurationToBand({ value: 1, unit: 'weeks' })).toBe('next_day_plus');
    expect(mapDurationToBand({ value: 48, unit: 'hours' })).toBe('next_day_plus');
  });

  it('maps "same day" (8h) to 2_to_24_hours', () => {
    // "same day" → parseDuration returns { value: 8, unit: 'hours' }
    expect(mapDurationToBand({ value: 8, unit: 'hours' })).toBe('2_to_24_hours');
  });
});

// ─── deterministicExtract — responseSpeedBand ───────────────────────────────

describe('deterministicExtract — responseSpeedBand', () => {
  it('"about 8 hours" → 2_to_24_hours', () => {
    const r = deterministicExtract('about 8 hours', 'ch_alex');
    expect(r.responseSpeedBand).toBe('2_to_24_hours');
  });

  it('"eight hours" → 2_to_24_hours (word number)', () => {
    const r = deterministicExtract('eight hours', 'ch_alex');
    expect(r.responseSpeedBand).toBe('2_to_24_hours');
  });

  it('"same day" → 2_to_24_hours', () => {
    const r = deterministicExtract('same day', 'ch_alex');
    expect(r.responseSpeedBand).toBe('2_to_24_hours');
  });

  it('"instantly" → under_30_seconds', () => {
    const r = deterministicExtract('instantly', 'ch_alex');
    expect(r.responseSpeedBand).toBe('under_30_seconds');
  });

  it('"straight away" → under_30_seconds', () => {
    const r = deterministicExtract('straight away', 'ch_alex');
    expect(r.responseSpeedBand).toBe('under_30_seconds');
  });

  it('"few minutes" → under_5_minutes', () => {
    const r = deterministicExtract('few minutes', 'ch_alex');
    expect(r.responseSpeedBand).toBe('under_5_minutes');
  });

  it('"within the hour" → 30_minutes_to_2_hours', () => {
    const r = deterministicExtract('within the hour', 'ch_alex');
    expect(r.responseSpeedBand).toBe('30_minutes_to_2_hours');
  });

  it('"about an hour" → 30_minutes_to_2_hours', () => {
    const r = deterministicExtract('about an hour', 'ch_alex');
    expect(r.responseSpeedBand).toBe('30_minutes_to_2_hours');
  });

  it('"next day" → next_day_plus', () => {
    const r = deterministicExtract('next day', 'ch_alex');
    expect(r.responseSpeedBand).toBe('next_day_plus');
  });

  it('"couple of days" → next_day_plus', () => {
    const r = deterministicExtract('couple of days', 'ch_alex');
    expect(r.responseSpeedBand).toBe('next_day_plus');
  });

  it('"fifteen minutes" → 5_to_30_minutes', () => {
    const r = deterministicExtract('fifteen minutes', 'ch_alex');
    expect(r.responseSpeedBand).toBe('5_to_30_minutes');
  });

  it('"half an hour" → 5_to_30_minutes', () => {
    const r = deterministicExtract('half an hour', 'ch_alex');
    expect(r.responseSpeedBand).toBe('5_to_30_minutes');
  });

  it('"tomorrow" → next_day_plus', () => {
    const r = deterministicExtract('tomorrow', 'ch_alex');
    expect(r.responseSpeedBand).toBe('next_day_plus');
  });

  it('"a week" → next_day_plus', () => {
    const r = deterministicExtract('a week', 'ch_alex');
    expect(r.responseSpeedBand).toBe('next_day_plus');
  });

  it('"end of day" → 2_to_24_hours', () => {
    const r = deterministicExtract('end of day', 'ch_alex');
    expect(r.responseSpeedBand).toBe('2_to_24_hours');
  });
});

// ─── deterministicExtract — ACV ─────────────────────────────────────────────

describe('deterministicExtract — ACV', () => {
  it('"fifty thousand" → 50000', () => {
    const r = deterministicExtract('fifty thousand', 'anchor_acv');
    expect(r.acv).toBe(50000);
  });

  it('"$5000" → 5000', () => {
    const r = deterministicExtract('$5000', 'anchor_acv');
    expect(r.acv).toBe(5000);
  });

  it('"250k" → 250000', () => {
    const r = deterministicExtract('250k', 'anchor_acv');
    expect(r.acv).toBe(250000);
  });

  it('"ten thousand" → 10000', () => {
    const r = deterministicExtract('ten thousand', 'anchor_acv');
    expect(r.acv).toBe(10000);
  });

  it('"twenty k" → 20000', () => {
    const r = deterministicExtract('twenty k', 'anchor_acv');
    expect(r.acv).toBe(20000);
  });
});

// ─── deterministicExtract — ch_alex numbers ─────────────────────────────────

describe('deterministicExtract — ch_alex numbers', () => {
  it('extracts inbound leads with keyword', () => {
    const r = deterministicExtract('we get about 20 leads a week', 'ch_alex');
    expect(r.inboundLeads).toBe(20);
  });

  it('extracts conversion rate from percentage', () => {
    const r = deterministicExtract('25 percent', 'ch_alex');
    expect(r.inboundConversionRate).toBe(0.25);
  });

  it('extracts ten percent', () => {
    const r = deterministicExtract('ten percent', 'ch_alex');
    expect(r.inboundConversionRate).toBe(0.10);
  });

  it('detects monthly unit', () => {
    const r = deterministicExtract('about 100 leads per month', 'ch_alex');
    expect(r.inboundLeads_unit).toBe('monthly');
  });

  it('detects weekly unit', () => {
    const r = deterministicExtract('get about 20 leads per week', 'ch_alex');
    expect(r.inboundLeads_unit).toBe('weekly');
  });

  it('extracts conversions with keyword', () => {
    const r = deterministicExtract('maybe five become clients', 'ch_alex');
    expect(r.inboundConversions).toBe(5);
  });
});

// ─── deterministicExtract — rolling buffer scenario ──────────────────────────

describe('deterministicExtract — rolling buffer', () => {
  it('finds responseSpeedBand in joined buffer text', () => {
    const buffer = ['how are you', 'about 8 hours', 'sounds good'];
    const joined = buffer.join('. ');
    const r = deterministicExtract(joined, 'ch_alex');
    expect(r.responseSpeedBand).toBe('2_to_24_hours');
  });

  it('finds responseSpeedBand with word number in buffer', () => {
    const buffer = ['yeah we try', 'usually eight hours or so', 'ok'];
    const joined = buffer.join('. ');
    const r = deterministicExtract(joined, 'ch_alex');
    expect(r.responseSpeedBand).toBe('2_to_24_hours');
  });

  it('returns empty for filler-only buffer', () => {
    const buffer = ['yeah', 'ok', 'sounds good'];
    const joined = buffer.join('. ');
    const r = deterministicExtract(joined, 'ch_alex');
    expect(r.responseSpeedBand).toBeUndefined();
  });
});

// ─── deterministicExtract — non-extraction stages return empty ───────────────

describe('deterministicExtract — non-extraction stages', () => {
  it('returns empty for greeting stage', () => {
    const r = deterministicExtract('fifty thousand dollars', 'greeting');
    // greeting has no ACV extraction (only ch_alex duration extraction)
    expect(r.acv).toBeUndefined();
  });

  it('returns empty for close stage', () => {
    const r = deterministicExtract('twenty leads a week', 'close');
    expect(r.inboundLeads).toBeUndefined();
  });

  it('returns empty for empty text', () => {
    const r = deterministicExtract('', 'ch_alex');
    expect(Object.keys(r)).toHaveLength(0);
  });
});
