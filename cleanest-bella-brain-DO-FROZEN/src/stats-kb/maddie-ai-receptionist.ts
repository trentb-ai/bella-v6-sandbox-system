/**
 * MADDIE — AI Receptionist Agent
 * Stats Knowledge Base for Bella's sales conversations
 * 
 * TIER 1 = Bella-level hooks (used when pitching Maddie during discovery)
 * TIER 2 = Agent deep-dive (used when Maddie channel stage is active)
 */

export const MADDIE_STATS = {

  // ── PAIN: The missed call epidemic ────────────────────────────────
  pain: [
    {
      tier: 1,
      stat: "85% of callers who don't reach a person will NEVER call back — 62% call your competitor instead",
      source: "Aira (aggregated industry data)",
      url: "https://www.getaira.io/blog/missed-business-calls-statistics",
      use: "THE #1 headline stat — visceral, real, every owner can picture it"
    },
    {
      tier: 1,
      stat: "Only 37.8% of calls to small businesses are answered by a live person — 6 out of 10 callers get nothing",
      source: "411 Locals (2024 study, 85 businesses, 58 industries)",
      url: "https://www.getaira.io/blog/missed-business-calls-statistics",
      use: "THE #2 stat — they think they answer the phone, the data says otherwise"
    },
    {
      tier: 2,
      stat: "80% of callers who reach voicemail hang up without leaving a message",
      source: "Dialzara (aggregated research)",
      url: "https://dialzara.com/blog/missed-calls-hidden-costs-and-ai-solutions",
      use: "Voicemail is dead — nobody leaves messages anymore"
    },
    {
      tier: 2,
      stat: "67% of people ignore voicemails even from known contacts — only 18% listen to voicemails from unknown numbers",
      source: "Dialzara",
      url: "https://dialzara.com/blog/missed-calls-hidden-costs-and-ai-solutions",
      use: "Even if they DO leave a voicemail, nobody listens"
    },
    {
      tier: 2,
      stat: "Home service companies miss 62% of inbound calls. Professional services miss 54%. Retail misses 48%",
      source: "Sift Digital (call data analysis)",
      url: "https://medium.com/@jtgrahamm/the-silent-profit-killer-why-62-of-your-business-calls-go-unanswered",
      use: "Industry-specific miss rates — match to the prospect's industry"
    },
  ],

  // ── COST: What each missed call costs by industry ─────────────────
  cost: [
    {
      tier: 2,
      stat: "Home services: miss 27% of calls, each worth $275-$1,200. A contractor missing 5-10 calls/week loses $45K-$120K/year",
      source: "Invoca / Aira",
      url: "https://www.getaira.io/blog/missed-business-calls-statistics",
      use: "Tradies/home services — tie to their job values"
    },
    {
      tier: 2,
      stat: "Dental offices: miss 20-38% of calls. Each missed new-patient call = $850 in lifetime value. 10 missed/month = $100K/year lost",
      source: "Patient Prism (via Aira)",
      url: "https://www.getaira.io/blog/missed-business-calls-statistics",
      use: "Healthcare/dental — lifetime patient value is huge"
    },
    {
      tier: 2,
      stat: "Law firms: miss ~35% of calls. Time-sensitive matters — callers who don't reach a firm immediately call another",
      source: "Clio Legal Trends Report (via Aira)",
      url: "https://www.getaira.io/blog/missed-business-calls-statistics",
      use: "Legal — urgency angle, every missed call is a case to a competitor"
    },
    {
      tier: 2,
      stat: "Real estate: miss ~40% of calls. A missed buyer inquiry on a $300K home at 3% commission = $9,000 lost",
      source: "Aira",
      url: "https://www.getaira.io/blog/missed-business-calls-statistics",
      use: "Real estate — one missed call = one commission gone"
    },
    {
      tier: 2,
      stat: "A single missed call costs the average business $12.15 in direct costs. Missing just 2 calls/day = $8,800+/year",
      source: "Ambs Call Center (August 2025 report)",
      url: "https://www.ambscallcenter.com/blog/cost-of-a-missed-call",
      use: "Conservative floor — even the minimum adds up fast"
    },
  ],

  // ── AFTER HOURS: The invisible revenue leak ───────────────────────
  afterHours: [
    {
      tier: 2,
      stat: "23% of all local business leads come in after hours",
      source: "ReachLocal (data from 3,000+ small businesses, via ZenBusiness)",
      url: "https://www.zenbusiness.com/blog/after-hour-leads/",
      use: "Nearly a quarter of their leads come when nobody's at the desk"
    },
    {
      tier: 2,
      stat: "AI receptionists capture 15-20% more appointments outside business hours",
      source: "Dialzara",
      url: "https://dialzara.com/blog/missed-calls-hidden-costs-and-ai-solutions",
      use: "Maddie works nights and weekends — capturing jobs they never knew existed"
    },
    {
      tier: 2,
      stat: "67% of after-hours patient calls go unanswered in healthcare",
      source: "Dialzara",
      url: "https://dialzara.com/blog/missed-calls-hidden-costs-and-ai-solutions",
      use: "Healthcare-specific — 2 out of 3 after-hours calls lost"
    },
  ],

  // ── BEHAVIOUR: Why customers leave ────────────────────────────────
  behaviour: [
    {
      tier: 2,
      stat: "75.5% of consumers have switched businesses because of poor customer service",
      source: "Ringover (2025, via Ambs Call Center)",
      url: "https://www.ambscallcenter.com/blog/business-phone-stats",
      use: "3 out of 4 people have left a business over bad service — not price, service"
    },
    {
      tier: 2,
      stat: "87% of consumers want proactive customer service",
      source: "Jive (2024, via Ambs Call Center)",
      url: "https://www.ambscallcenter.com/blog/business-phone-stats",
      use: "Customers expect you to reach out, not wait for them to chase"
    },
    {
      tier: 2,
      stat: "71% of Gen Z reach out via a live phone call — phones aren't dead, even for young people",
      source: "McKinsey (2024, via Ambs Call Center)",
      url: "https://www.ambscallcenter.com/blog/business-phone-stats",
      use: "Counter the 'young people don't call' objection"
    },
    {
      tier: 2,
      stat: "42% of SMBs estimate they lose at least $500/month to missed calls — yet only 22% use AI",
      source: "Vida (via Entrepreneur)",
      url: "https://www.entrepreneur.com/growing-a-business/stop-losing-500-a-month-the-mistake-starts-with-a/491642",
      use: "They know they're losing money — they just haven't fixed it yet"
    },
  ],

  // ── AI IMPACT: What Maddie actually delivers ──────────────────────
  aiImpact: [
    {
      tier: 1,
      stat: "Lead-to-appointment conversion jumps from 49% to 70% with AI answering",
      source: "Eden",
      url: "https://ringeden.com/blog/ai-receptionist",
      use: "THE #3 headline stat — clean conversion lift, easy to understand"
    },
    {
      tier: 2,
      stat: "67% reduction in abandoned calls with AI receptionists",
      source: "MIT Technology Review (via Dialzara)",
      url: "https://dialzara.com/blog/missed-calls-hidden-costs-and-ai-solutions",
      use: "MIT credibility — 2 out of 3 abandoned calls saved"
    },
    {
      tier: 2,
      stat: "AI cuts call handling time by 40% and boosts first-call resolution by 35%",
      source: "Dialzara",
      url: "https://dialzara.com/blog/missed-calls-hidden-costs-and-ai-solutions",
      use: "Efficiency play — faster AND better"
    },
    {
      tier: 2,
      stat: "30% fewer missed leads and 99%+ call answer rates with AI",
      source: "Dialzara",
      url: "https://dialzara.com/blog/missed-calls-hidden-costs-and-ai-solutions",
      use: "99% answer rate vs their current 38% — night and day"
    },
    {
      tier: 2,
      stat: "80% of customers report positive experiences with AI receptionists",
      source: "Uberall (2024 study, via Resonate AI)",
      url: "https://www.resonateapp.com/resources/ai-receptionists-statistics",
      use: "Counter the 'customers hate talking to robots' objection"
    },
    {
      tier: 2,
      stat: "24/7 reception improves customer retention by 24%",
      source: "Dialzara",
      url: "https://dialzara.com/blog/missed-calls-hidden-costs-and-ai-solutions",
      use: "Not just new leads — keeps existing customers from leaving"
    },
  ],

  // ── ROI: Hard numbers ─────────────────────────────────────────────
  roi: [
    {
      tier: 2,
      stat: "300% ROI in first year — bookings up 25%",
      source: "Eden",
      url: "https://ringeden.com/blog/ai-receptionist",
      use: "3x return in year one — use in closing"
    },
    {
      tier: 2,
      stat: "Law firms: 1,775% ROI — saves ~$45,000/yr in staff costs",
      source: "Eden",
      url: "https://ringeden.com/blog/ai-receptionist",
      use: "Legal-specific — insane ROI number"
    },
    {
      tier: 2,
      stat: "40-60% lower overhead costs for call handling",
      source: "Eden",
      url: "https://ringeden.com/blog/ai-receptionist",
      use: "Cost reduction angle — works when prospect is budget-conscious"
    },
  ],

  // ── CASES: Real results ───────────────────────────────────────────
  cases: [
    {
      tier: 2,
      stat: "One three-person law firm: 34% increase in client inquiries in just 2 months with AI after-hours coverage",
      source: "Dialzara",
      url: "https://dialzara.com/blog/missed-calls-hidden-costs-and-ai-solutions",
      use: "Small firm, fast result — relatable to most prospects"
    },
    {
      tier: 2,
      stat: "Memorial Healthcare: 3x drop in call abandonment + 30% boost in service levels with AI",
      source: "Dialzara",
      url: "https://dialzara.com/blog/missed-calls-hidden-costs-and-ai-solutions",
      use: "Healthcare-scale proof — 3x improvement is massive"
    },
    {
      tier: 2,
      stat: "WaFD Bank: 95% reduction in cost per interaction without compromising service",
      source: "Dialzara",
      url: "https://dialzara.com/blog/missed-calls-hidden-costs-and-ai-solutions",
      use: "Enterprise credibility — 95% cost cut"
    },
    {
      tier: 2,
      stat: "No-show rate dropped from 23% to under 5%, plus 12 more appointments booked per month",
      source: "Voctiv (customer testimonial)",
      url: "https://voctiv.com/the-ultimate-guide-to-out-of-hours-call-handling-for-small-businesses-and-solopreneurs/",
      use: "No-shows are a universal pain point — killer stat for service businesses"
    },
    {
      tier: 2,
      stat: "Choice Signature Luxury Car Rental: 700+ qualified leads captured in 4 months with AI receptionist",
      source: "Vendasta",
      url: "https://www.vendasta.com/blog/ai-receptionist-for-small-business/",
      use: "Volume proof — 700 leads in 4 months, real brand"
    },
  ],
} as const;
