/**
 * JAMES — Reputation Manager / Review Uplift Agent
 * Stats Knowledge Base for Bella's sales conversations
 * 
 * TIER 1 = Bella-level hooks (used when pitching James during discovery)
 * TIER 2 = Agent deep-dive (used when James channel stage is active)
 */

export const JAMES_STATS = {

  // ── PAIN: Bad reviews and low star ratings cost real money ─────────
  pain: [
    {
      tier: 1,
      stat: "A 1-star increase on Google = 5-9% revenue boost",
      source: "Harvard Business School (Michael Luca, 2016)",
      url: "https://www.textedly.com/blog/online-review-statistics-for-2025-to-know",
      use: "THE gold-standard stat — Harvard, peer-reviewed, widely cited"
    },
    {
      tier: 1,
      stat: "Businesses with 4+ stars earn 32% more revenue than those below 4 stars",
      source: "WiserNotify",
      url: "https://wisernotify.com/blog/online-review-stats/",
      use: "The 4-star threshold — below it you're losing a third of potential revenue"
    },
    {
      tier: 1,
      stat: "87% of businesses fail to respond to negative reviews — the ones that DO immediately stand out",
      source: "Shapo.io",
      url: "https://shapo.io/blog/review-statistics/",
      use: "Easy competitive advantage — just responding puts you ahead of 87%"
    },
    {
      tier: 2,
      stat: "Customers spend 49% more at businesses that reply to reviews",
      source: "WiserReview",
      url: "https://wiserreview.com/blog/online-review-statistics/",
      use: "Replying = more spend per customer. Not replying = leaving money on the table."
    },
  ],

  // ── VOLUME: More reviews = more trust = more revenue ──────────────
  reviewVolume: [
    {
      tier: 2,
      stat: "Automated review campaigns deliver 200-400% increase in review volume in 3 months",
      source: "POV Digital",
      url: "https://www.povdigital.com/automate-review-requests/",
      use: "James doesn't just get better reviews — he gets MORE reviews, fast"
    },
    {
      tier: 2,
      stat: "Solicited reviews average 4.34 stars vs unsolicited reviews at 3.89 stars",
      source: "PMC Media Group",
      url: "https://pmcmediagroup.com/3-simple-ways-to-get-more-google-reviews-more/",
      use: "When you ASK for reviews, they're almost half a star higher — happy customers will say so if prompted"
    },
    {
      tier: 2,
      stat: "Moving from 3.5 to 4.2 stars is realistic with just 15 five-star reviews in 30 days",
      source: "Review-Collect",
      url: "https://www.review-collect.com/en/blog/increase-google-rating",
      use: "It doesn't take hundreds — 15 good reviews in a month shifts the needle"
    },
  ],

  // ── BEHAVIOUR: How customers use reviews ──────────────────────────
  behaviour: [
    {
      tier: 2,
      stat: "93% of consumers say online reviews influence their purchasing decisions",
      source: "Industry consensus (multiple sources)",
      url: "https://www.textedly.com/blog/online-review-statistics-for-2025-to-know",
      use: "Nearly everyone checks reviews before buying — your rating IS your first impression"
    },
    {
      tier: 2,
      stat: "Customers spend 49% more at businesses that actively reply to reviews",
      source: "WiserReview",
      url: "https://wiserreview.com/blog/online-review-statistics/",
      use: "Engagement = revenue. Silence = lost opportunity."
    },
  ],

  // ── COMPETITOR: The star rating gap ────────────────────────────────
  competitor: [
    {
      tier: 2,
      stat: "If your competitor is at 4.5 stars and you're at 3.5, they're earning up to 32% more revenue — not because they're better, but because they look better online",
      source: "WiserNotify + Harvard Business School",
      url: "https://wisernotify.com/blog/online-review-stats/",
      use: "Tie to their actual star rating vs competitors — make it personal"
    },
  ],

  // ── STAR RATING LOGIC: The gap matters ────────────────────────────
  starRating: [
    {
      tier: 2,
      stat: "Each star increase = 5-9% revenue uplift. A business at 3.5 stars closing the gap to 4.5 could see a 5-9% boost",
      source: "Harvard Business School (Michael Luca)",
      url: "https://www.textedly.com/blog/online-review-statistics-for-2025-to-know",
      use: "THE key stat — tie directly to their current rating from Google Places intel"
    },
    {
      tier: 2,
      stat: "Businesses above 4 stars earn 32% more revenue — the 4-star line is the threshold that matters",
      source: "WiserNotify",
      url: "https://wisernotify.com/blog/online-review-stats/",
      use: "If they're below 4 stars, this is the urgency stat"
    },
    {
      tier: 2,
      stat: "If you're already at 4.5+ stars, James focuses on VOLUME and RESPONSE — maintaining dominance, not climbing",
      source: "Logical framing",
      url: "",
      use: "For high-rated businesses — don't oversell uplift, sell protection and amplification"
    },
  ],

  // ── CLOSE: ROI framing ────────────────────────────────────────────
  close: [
    {
      tier: 2,
      stat: "You're currently at [X] stars with [Y] reviews. Closing that gap to 4.5 with James could mean a 5-9% revenue lift on your current turnover",
      source: "Harvard Business School + prospect's own data",
      url: "",
      use: "Personalised close — plug in their actual rating from Google Places"
    },
  ],
} as const;
