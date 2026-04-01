/**
 * SARAH — Database Reactivation Agent
 * Stats Knowledge Base for Bella's sales conversations
 * 
 * TIER 1 = Bella-level hooks (used when pitching Sarah during discovery)
 * TIER 2 = Agent deep-dive (used when Sarah channel stage is active)
 */

export const SARAH_STATS = {

  // ── PAIN: Dead leads sitting in your CRM ──────────────────────────
  pain: [
    {
      tier: 1,
      stat: "Even conservatively, 5% of dormant leads convert when reactivated — AI campaigns hit 8-18%. That's sales from leads costing you nothing",
      source: "Multiple sources (industry consensus, LeadMaker Media)",
      url: "https://leadmakermedia.com/ai-database-reactivation/",
      use: "THE money stat — 5% of leads they already own, zero acquisition cost"
    },
    {
      tier: 1,
      stat: "Inactive customers have a 60-70% higher chance of converting than brand new prospects",
      source: "Sonfu Digital",
      url: "https://www.sonfudigital.com/database-reactivation",
      use: "They already know you — the trust barrier is gone"
    },
    {
      tier: 1,
      stat: "Acquiring a new customer is 5-7x more expensive than reactivating an old one",
      source: "Octavius AI",
      url: "https://octavius.ai/database-reactivation-roi/",
      use: "Flip the script — why chase new when old is 5x cheaper?"
    },
    {
      tier: 2,
      stat: "Most businesses are sitting on hundreds or thousands of old leads that never get touched again",
      source: "Industry consensus — multiple sources",
      url: "https://leadmakermedia.com/ai-database-reactivation/",
      use: "Open the wound — they've paid for those leads and forgotten them"
    },
    {
      tier: 2,
      stat: "A 5% increase in customer retention = 25-95% increase in profits",
      source: "Bain & Company (Frederick Reichheld)",
      url: "https://www.bain.com/insights/retaining-customers-is-the-real-challenge/",
      use: "Bain & Company gold standard — unimpeachable source"
    },
  ],

  // ── CONVERSION: What reactivation actually delivers ───────────────
  conversion: [
    {
      tier: 2,
      stat: "Database reactivation achieves 8-15% re-engagement rates and 5-10x higher ROI than cold leads",
      source: "DBR Labs (Australian source)",
      url: "https://www.dbrlabs.au/",
      use: "Australian data — local credibility. 5-10x ROI is massive."
    },
    {
      tier: 2,
      stat: "Reactivated leads convert at 1.5-3x the rate of new leads",
      source: "LeadMaker Media",
      url: "https://leadmakermedia.com/ai-database-reactivation/",
      use: "Direct comparison — old leads outperform new ones"
    },
    {
      tier: 2,
      stat: "AI-led reactivation adds 10-30% incremental conversion from zero-revenue leads",
      source: "MagicBlocks AI (citing Conversica + LeadHero)",
      url: "https://magicblocks.ai/blog/best-ai-sms-agent-to-reactivate-leads",
      use: "These leads are generating ZERO right now — any conversion is pure upside"
    },
  ],

  // ── SMS: Why Sarah uses text, not email ───────────────────────────
  smsAdvantage: [
    {
      tier: 2,
      stat: "SMS: 98% open rates vs email 15-25%",
      source: "LeadMaker Media",
      url: "https://leadmakermedia.com/ai-database-reactivation/",
      use: "98% vs 15% — texts actually get READ. Emails don't."
    },
    {
      tier: 2,
      stat: "AI SMS achieves 35-45% response rates vs 5-10% for email",
      source: "LeadMaker Media",
      url: "https://leadmakermedia.com/ai-database-reactivation/",
      use: "Not just opened — RESPONDED to. 7x better than email."
    },
  ],

  // ── COMPETITOR: Why they should act now ────────────────────────────
  competitor: [
    {
      tier: 2,
      stat: "Every month those leads sit untouched, they get colder — and your competitors may be reaching them first",
      source: "Industry logic",
      url: "",
      use: "Urgency play — those leads aren't getting warmer"
    },
  ],

  // ── CASES: Real results ───────────────────────────────────────────
  cases: [
    {
      tier: 2,
      stat: "Home improvement business: 5,000 dead leads reactivated → $127K revenue in 21 days",
      source: "LeadMaker Media",
      url: "https://leadmakermedia.com/ai-database-reactivation/",
      use: "THE killer case study — real numbers, real timeframe, real money"
    },
    {
      tier: 2,
      stat: "AIVA system: 18% reactivation of 12,000-person list → 240 appointments booked in 30 days",
      source: "AIVA System",
      url: "https://aivasystem.com/post/ai-powered-database-reactivation",
      use: "Volume proof — 240 appointments from a dead list in one month"
    },
  ],

  // ── CLOSE: ROI framing ────────────────────────────────────────────
  close: [
    {
      tier: 2,
      stat: "If you've got 500 old leads and even 5% convert at your average job value — that's found money from leads you've already paid for",
      source: "Calculator logic — ties to prospect's own numbers",
      url: "",
      use: "Personalised close — plug in their numbers live"
    },
    {
      tier: 2,
      stat: "These leads already know your name — the trust barrier is already broken. They just need a reason to come back",
      source: "Conversational framing",
      url: "",
      use: "Emotional close — reframe 'dead leads' as 'warm relationships on pause'"
    },
  ],
} as const;
