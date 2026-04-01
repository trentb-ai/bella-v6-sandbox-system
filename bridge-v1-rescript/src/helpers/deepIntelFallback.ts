export interface DeepIntelData {
  status: 'running' | 'done' | 'error';
  ts_done?: number;
  googleMaps?: {
    rating?: number;
    review_count?: number;
    address?: string;
  };
  hiring?: {
    is_hiring: boolean;
    count: number;
    roles?: Array<{ title: string }>;
  };
  ads?: {
    google?: { running: boolean };
    fb?: { running: boolean };
  };
}

// Returns a WOW_6 speech string drawn from real business data, or null if no data available.
// Tier priority: Google Maps rating -> Active hiring -> Active advertising -> null (generic fallback)
// CRITICAL: Returns null if deep intel is not yet complete (status !== 'done')
// The caller (buildWow6Directive) must handle null by continuing to generic fallback tier.
export function getDeepIntelFallbackWow(
  deep: DeepIntelData | undefined | null,
  businessName: string
): string | null {
  // Guard: deep intel must have completed before we use it
  if (!deep || deep.status !== 'done') return null;

  // Tier 5.5: Google Maps — strong social proof signal
  if (
    deep.googleMaps?.rating != null &&
    deep.googleMaps.rating >= 3.5 &&
    (deep.googleMaps.review_count ?? 0) >= 10
  ) {
    const r = deep.googleMaps.rating.toFixed(1);
    const n = deep.googleMaps.review_count;
    return `I can see ${businessName} has a ${r}-star Google rating with ${n} reviews — that kind of reputation signals you're doing something right with client satisfaction, which is exactly the kind of business our agents perform best for.`;
  }

  // Tier 6: Active hiring — growth signal
  if (deep.hiring?.is_hiring && (deep.hiring.count ?? 0) >= 1) {
    const n = deep.hiring.count;
    return `I noticed you're actively hiring — you have ${n} open ${n > 1 ? 'positions' : 'position'} right now. That tells me growth is happening, which means your pipeline needs to keep up with your team's capacity.`;
  }

  // Tier 7: Active ads — lead gen investment signal
  const googleAds = deep.ads?.google?.running === true;
  const fbAds = deep.ads?.fb?.running === true;
  if (googleAds || fbAds) {
    const channels = [googleAds ? 'Google' : null, fbAds ? 'Facebook' : null]
      .filter(Boolean)
      .join(' and ');
    return `From what I can see, you're actively running ads on ${channels} — which means you're already investing in lead generation. That's exactly the kind of inbound flow our agents are built to capture and convert at scale.`;
  }

  return null;
}
