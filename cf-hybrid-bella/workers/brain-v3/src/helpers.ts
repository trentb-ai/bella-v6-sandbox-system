/**
 * brain-v3/src/helpers.ts — Utility functions
 * Chunk 1 — V3
 */

import type { ResponseSpeedBand } from './types';

/**
 * Derive a conversion rate from whichever data is available.
 * Priority: explicit rate → computed from conversions/leads → 0.
 */
export function normalizeConversionRate(
  leads: number,
  conversions?: number | null,
  rate?: number | null,
): number {
  if (rate != null) return rate;
  if (conversions != null && leads > 0) return conversions / leads;
  return 0;
}

/**
 * Alex gap-factor lookup — measures how much speed-to-lead improvement is possible.
 * 0.0 = already fast (no gap), 1.0 = very slow (maximum gap to close).
 */
export function alexGapFactor(band: ResponseSpeedBand): number {
  switch (band) {
    case 'under_30_seconds':      return 0.0;
    case 'under_5_minutes':       return 0.05;
    case '5_to_30_minutes':       return 0.35;
    case '30_minutes_to_2_hours': return 0.6;
    case '2_to_24_hours':         return 0.85;
    case 'next_day_plus':         return 1.0;
    case 'unknown':               return 0.35;
  }
}

/**
 * Convert ResponseSpeedBand to spoken label for TTS.
 */
export function bandToSpokenLabel(band?: ResponseSpeedBand | string | null): string {
  switch (band) {
    case 'under_30_seconds':      return 'under thirty seconds';
    case 'under_5_minutes':       return 'under five minutes';
    case '5_to_30_minutes':       return 'five to thirty minutes';
    case '30_minutes_to_2_hours': return 'thirty minutes to two hours';
    case '2_to_24_hours':         return 'two to twenty-four hours';
    case 'next_day_plus':         return 'next day or longer';
    default:                      return 'an unknown timeframe';
  }
}
