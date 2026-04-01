/**
 * helpers/deepIntelFallback.ts — Sprint 2 (Issue 3/4)
 *
 * Tiered deep intel fallback for wow_6.
 * Accesses direct deep intel fields (googleMaps, hiring, ads) that the
 * consultant may not have surfaced. Fills the gap between consultant tiers
 * and the GENERIC fallback.
 */

import type { ConversationState } from '../types';

export interface DeepIntelFallbackResult {
  line: string;
  source: string;
}

/**
 * getDeepIntelFallbackWow — returns a deep-intel-derived observation line
 * for wow_6 when all consultant tiers have missed.
 *
 * Priority:
 *   1. Google Maps rating + review count (strong reputation signal)
 *   2. Hiring presence with count (growth signal)
 *   3. Ad activity (spend signal)
 *
 * Returns null if no deep intel signals are available.
 */
export function getDeepIntelFallbackWow(
  state: ConversationState,
  name: string,
  business: string,
): DeepIntelFallbackResult | null {
  const d = (state.intel.deep as any) ?? {};

  // ── Tier 1: Google Maps rating ──
  const rating = d.googleMaps?.rating;
  const reviews = d.googleMaps?.review_count ?? 0;
  if (rating && rating >= 3.5 && reviews > 0) {
    return {
      line: `Also ${name}, I noticed ${business} has a ${rating}-star rating from ${reviews} reviews — that's the kind of credibility that amplifies what automation can do, because people already trust you.`,
      source: 'DEEP_GOOGLE_RATING',
    };
  }

  // ── Tier 2: Hiring presence ──
  const isHiring = d.hiring?.is_hiring;
  const hiringCount = d.hiring?.count ?? 0;
  if (isHiring && hiringCount > 0) {
    return {
      line: `Also ${name}, I can see ${business} is actively hiring — ${hiringCount > 1 ? `${hiringCount} roles open` : 'a role open'} right now. That's exactly the kind of growth phase where automation creates the biggest leverage.`,
      source: 'DEEP_HIRING_COUNT',
    };
  }

  // ── Tier 3: Ad activity ──
  const googleAds = d.ads?.google_ads_count ?? 0;
  const fbAds = d.ads?.fb_ads_count ?? 0;
  const isRunningAds = d.ads?.is_running_google_ads || googleAds > 0 || fbAds > 0;
  if (isRunningAds) {
    const adDesc = googleAds > 0 && fbAds > 0
      ? `running ads across Google and Facebook`
      : googleAds > 0
        ? `running Google Ads`
        : `running Facebook Ads`;
    return {
      line: `Also ${name}, I can see ${business} is ${adDesc}, which means you're already investing in demand generation. That's where automation has the biggest impact — making sure every dollar of ad spend converts more effectively.`,
      source: 'DEEP_ADS_ACTIVE',
    };
  }

  return null;
}
