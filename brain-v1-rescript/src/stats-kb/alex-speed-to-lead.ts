/**
 * ALEX — Speed-to-Lead SMS Agent
 * Stats Knowledge Base for Bella's sales conversations
 * Each stat tagged by USE CASE and TIER.
 * 
 * TIER 1 = Bella-level hooks (used when pitching Alex during discovery)
 * TIER 2 = Agent deep-dive (used when Alex channel stage is active)
 */

export const ALEX_STATS = {

  // ── PAIN: Make the prospect feel the problem ──────────────────────
  pain: [
    {
      tier: 1,
      stat: "The average business takes 42 hours to respond to a new lead",
      source: "Harvard Business Review — Oldroyd, McElheran & Elkington (2011), study of 2,241 US companies",
      url: "https://hbr.org/2011/03/the-short-life-of-online-sales-leads",
      use: "Open the wound — most business owners have no idea how slow they are"
    },
    {
      tier: 2,
      stat: "63% of businesses don't respond to inbound leads at all",
      source: "RevenueHero (2024 study, 1,000+ companies)",
      url: "https://verse.ai/blog/speed-to-lead-statistics",
      use: "Shock stat — majority of leads get zero follow-up"
    },
    {
      tier: 2,
      stat: "73% of leads are never contacted — if you spend $100K on lead gen, $70K is wasted",
      source: "Kixie (aggregated industry data)",
      url: "https://www.kixie.com/sales-blog/speed-to-lead-response-time-statistics-that-drive-conversions/",
      use: "Tie to their marketing spend — make it about money they're already burning"
    },
    {
      tier: 2,
      stat: "Average B2B lead response time is 42-47 hours — 55% of companies take 5+ days",
      source: "Kixie / Forbes",
      url: "https://www.kixie.com/sales-blog/speed-to-lead-response-time-statistics-that-drive-conversions/",
      use: "Industry benchmark — show them they're probably in the slow majority"
    },
    {
      tier: 2,
      stat: "In a 2024 audit, ZERO out of 114 B2B companies called a lead within 5 minutes",
      source: "Workato (2024 study)",
      url: "https://prospeo.io/s/average-lead-response-time",
      use: "Nobody is doing this well — massive competitive advantage"
    },
  ],

  // ── URGENCY: The decay curve — every minute matters ───────────────
  urgency: [
    {
      tier: 1,
      stat: "Responding within 1 minute = 391% higher conversion rate",
      source: "Velocify (2016, millions of lead records across hundreds of client databases)",
      url: "https://www.leadangel.com/blog/operations/speed-to-lead-statistics/",
      use: "THE headline stat — most cited in all of lead management research"
    },
    {
      tier: 2,
      stat: "At 2 minutes, the improvement drops to only 160% — less than half of the 1-minute lift",
      source: "Velocify (via Rep.ai)",
      url: "https://rep.ai/blog/lead-response",
      use: "Show the decay is instant — even 1 extra minute costs half the upside"
    },
    {
      tier: 2,
      stat: "After 5 minutes, odds of qualifying a lead drop by 80%",
      source: "InsideSales.com (Lead Response Management Study)",
      url: "https://www.kixie.com/sales-blog/speed-to-lead-response-time-statistics-that-drive-conversions/",
      use: "The cliff edge — 5 minutes is the absolute max, not the target"
    },
    {
      tier: 2,
      stat: "Leads contacted within 5 minutes are 21x more likely to qualify than at 30 minutes, and 100x more likely to even connect",
      source: "Lead Response Management Study (InsideSales.com/MIT)",
      url: "https://www.kixie.com/sales-blog/speed-to-lead-response-time-statistics-that-drive-conversions/",
      use: "Double stat — qualification AND connection both collapse"
    },
    {
      tier: 2,
      stat: "Leads contacted within 1 hour are 60x more likely to qualify than after 24 hours",
      source: "Oldroyd, McElheran & Elkington (2011) — Harvard Business Review",
      url: "https://hbr.org/2011/03/the-short-life-of-online-sales-leads",
      use: "The HBR gold standard — 1.25 million leads studied"
    },
    {
      tier: 2,
      stat: "Firms responding within 1 hour are 7x more likely to qualify the lead — yet only 37% of businesses respond within an hour",
      source: "Harvard Business Review (2011, audit of 2,241 US companies)",
      url: "https://hbr.org/2011/03/the-short-life-of-online-sales-leads",
      use: "Show both the opportunity AND the gap"
    },
  ],

  // ── COMPETITOR: First responder wins ───────────────────────────────
  competitor: [
    {
      tier: 1,
      stat: "78% of customers buy from the first company to respond — not the best, not the cheapest, the FIRST",
      source: "Lead Connect Survey",
      url: "https://www.leadgen-economy.com/blog/speed-to-lead-response-workflow-optimization/",
      use: "THE objection killer when prospect says 'we already have a good team'"
    },
    {
      tier: 2,
      stat: "First vendor to respond wins 35-50% of all sales",
      source: "Vendasta / Ricochet360",
      url: "https://rep.ai/blog/lead-response",
      use: "Even conservative end is massive — first = winner"
    },
    {
      tier: 2,
      stat: "50% of sales go to the vendor that responds first",
      source: "InsideSales.com",
      url: "https://www.copy.ai/blog/inbound-lead-response-time",
      use: "Simple, clean, from a credible source"
    },
  ],

  // ── CLOSE: ROI and conversion lift ────────────────────────────────
  close: [
    {
      tier: 2,
      stat: "Responding within 5 minutes = 100x more likely to convert than a 30-minute delay",
      source: "Voiso (citing Lead Response Management Study)",
      url: "https://voiso.com/articles/lead-response-time-metrics/",
      use: "100x is an insane number — use when closing on the value"
    },
    {
      tier: 2,
      stat: "Best-in-class teams now target sub-1-minute response using AI and automated workflows",
      source: "Martal",
      url: "https://martal.ca/speed-to-lead-lb/",
      use: "Position Alex as best-in-class, not experimental"
    },
    {
      tier: 2,
      stat: "Optimal follow-up cadence: call within 5 min, email within 15 min, second call at 1 hr, email at 4 hrs, call at 24 hrs",
      source: "Velocify",
      url: "https://prospeo.io/s/average-lead-response-time",
      use: "Show Alex handles the full cadence automatically"
    },
  ],

  // ── EXPECTATION: What customers demand ────────────────────────────
  expectation: [
    {
      tier: 2,
      stat: "82% of consumers expect responses within 10 minutes",
      source: "Velocify (via Rep.ai)",
      url: "https://rep.ai/blog/lead-response",
      use: "Consumer expectation is already set — you're behind if you're not meeting it"
    },
    {
      tier: 2,
      stat: "88% expect an email reply within 1 hour — the average takes nearly 12 hours",
      source: "Workato",
      url: "https://prospeo.io/s/average-lead-response-time",
      use: "The gap between expectation and reality is a canyon"
    },
    {
      tier: 2,
      stat: "15% churn increase from slow lead response time",
      source: "Rep.ai",
      url: "https://rep.ai/blog/lead-response",
      use: "Not just lost leads — slow response causes active customer churn"
    },
  ],
} as const;
