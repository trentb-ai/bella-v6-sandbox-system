/**
 * CHRIS — Website Concierge / AI Chat Agent
 * Stats Knowledge Base for Bella's sales conversations
 * 
 * TIER 1 = Bella-level hooks (used when pitching Chris during discovery)
 * TIER 2 = Agent deep-dive (used when Chris channel stage is active)
 */

export const CHRIS_STATS = {

  // ── PAIN: What happens without chat on your site ──────────────────
  pain: [
    {
      tier: 1,
      stat: "50% of adults abandon an online purchase if they can't get quick answers to their questions",
      source: "LiveChat",
      url: "https://www.livechat.com/success/live-chat-conversion-rate-optimization/",
      use: "Half your visitors leave because nobody's there to help"
    },
    {
      tier: 2,
      stat: "Sites without live chat are seen as almost 2x as untrustworthy",
      source: "Tidio (research across 300,000 websites)",
      url: "https://www.tidio.com/blog/live-chat-statistics/",
      use: "Trust issue — no chat = looks like nobody's home"
    },
    {
      tier: 2,
      stat: "21% of live chat support requests go unanswered even on sites that HAVE chat",
      source: "SuperOffice (via Popupsmart)",
      url: "https://popupsmart.com/blog/live-chat-statistics",
      use: "Even businesses trying to do chat fail at it without AI"
    },
    {
      tier: 2,
      stat: "Average cart abandonment rate is 70%",
      source: "Baymard Institute (2025)",
      url: "https://www.zoho.com/salesiq/live-chat-software/statistics.html",
      use: "7 out of 10 people adding stuff to cart walk away — Chris stops that"
    },
  ],

  // ── CONVERSION: The uplift numbers ────────────────────────────────
  conversion: [
    {
      tier: 1,
      stat: "Chat users are 2.8x more likely to convert than non-chat visitors",
      source: "Invesp (via Zoho SalesIQ)",
      url: "https://www.zoho.com/salesiq/live-chat-software/statistics.html",
      use: "THE headline conversion stat for Chris"
    },
    {
      tier: 2,
      stat: "Adding live chat to a website = 20% increase in conversions",
      source: "Invesp (via Zoho SalesIQ)",
      url: "https://www.zoho.com/salesiq/live-chat-software/statistics.html",
      use: "Conservative baseline — even basic chat lifts 20%"
    },
    {
      tier: 2,
      stat: "40% uplift in conversion rates from live chat implementations",
      source: "SuperOffice (via ProProfs)",
      url: "https://www.proprofschat.com/blog/live-chat-statistics/",
      use: "Higher end — use when prospect is already warm"
    },
    {
      tier: 1,
      stat: "AI chatbot shoppers convert at 12.3% vs 3.1% without — a 4x lift",
      source: "Rep AI / EcommerceFastlane (via Neuwark)",
      url: "https://neuwark.com/blog/conversational-commerce-2026-ai-replacing-shopping-cart",
      use: "AI-specific stat — Chris isn't basic chat, he's 4x better"
    },
    {
      tier: 2,
      stat: "One reply via chat = 50% more likely to convert. Six messages = 250% more likely",
      source: "Inflow (via Social Intents)",
      url: "https://www.socialintents.com/blog/live-chat-conversions/",
      use: "Every message deepens the conversion — Chris keeps them talking"
    },
    {
      tier: 2,
      stat: "48% increase in revenue per chat hour + 40% conversion rate boost",
      source: "G2",
      url: "https://www.g2.com/articles/live-chat-statistics",
      use: "Revenue per hour stat — shows efficiency, not just volume"
    },
  ],

  // ── PROACTIVE: AI initiating the conversation ─────────────────────
  proactive: [
    {
      tier: 2,
      stat: "45% of shoppers engage when a chatbot initiates the conversation first",
      source: "Rep AI",
      url: "https://www.hellorep.ai/blog/the-future-of-ai-in-ecommerce-40-statistics-on-conversational-ai-agents-for-2025",
      use: "Chris doesn't wait — he starts the conversation. Nearly half engage."
    },
    {
      tier: 2,
      stat: "AI-driven proactive chats recover 35% of abandoned carts vs 5-15% for popups/emails",
      source: "Rep AI (data from 1M+ AI conversations, via Neuwark)",
      url: "https://neuwark.com/blog/conversational-commerce-2026-ai-replacing-shopping-cart",
      use: "Proactive AI crushes traditional retargeting"
    },
    {
      tier: 2,
      stat: "305% ROI from proactive live chat strategies",
      source: "LiveChat",
      url: "https://www.livechat.com/success/key-live-chat-statistics/",
      use: "3x return on investment — hard to argue with"
    },
  ],

  // ── REVENUE: Spend and AOV lift ───────────────────────────────────
  revenue: [
    {
      tier: 2,
      stat: "Visitors who use chat spend 60% more per purchase",
      source: "Invesp (via Zoho SalesIQ)",
      url: "https://www.zoho.com/salesiq/live-chat-software/statistics.html",
      use: "Not just more conversions — bigger tickets too"
    },
    {
      tier: 2,
      stat: "Chat widget raised average order value by 43% during checkout",
      source: "LLCBuddy (aggregated data)",
      url: "https://llcbuddy.com/data/live-chat-statistics/",
      use: "AOV lift at the most critical moment — checkout"
    },
    {
      tier: 2,
      stat: "AI shoppers complete purchases 47% faster",
      source: "Rep AI",
      url: "https://www.hellorep.ai/blog/the-future-of-ai-in-ecommerce-40-statistics-on-conversational-ai-agents-for-2025",
      use: "Faster decisions = less time to get cold feet"
    },
    {
      tier: 2,
      stat: "67% sales increase reported by companies using chatbots for proactive engagement",
      source: "Fountain City",
      url: "https://fountaincity.tech/resources/blog/ai-chatbot-sales-calculator/",
      use: "Big close stat — 67% more sales"
    },
  ],

  // ── PREFERENCE: Customers want chat ───────────────────────────────
  preference: [
    {
      tier: 2,
      stat: "Live chat: 73% satisfaction vs email 61% vs phone 44%",
      source: "Popupsmart",
      url: "https://popupsmart.com/blog/live-chat-statistics",
      use: "Chat is the #1 preferred channel — customers already want this"
    },
    {
      tier: 2,
      stat: "63% of customers more likely to purchase from websites with live chat",
      source: "LiveChat",
      url: "https://www.livechat.com/success/key-live-chat-statistics/",
      use: "Majority preference — no chat = losing to competitors who have it"
    },
    {
      tier: 2,
      stat: "41% of consumers choose live chat as their #1 support channel — ahead of phone (32%) and email (23%)",
      source: "Saufter.io (via ProProfs)",
      url: "https://www.proprofschat.com/blog/live-chat-statistics/",
      use: "Chat has overtaken phone and email — the world has moved"
    },
    {
      tier: 2,
      stat: "87% of live chat conversations receive positive customer satisfaction rating",
      source: "LiveChat",
      url: "https://www.livechat.com/success/key-live-chat-statistics/",
      use: "87% positive — customers love it when done right"
    },
  ],

  // ── CASE STUDIES ──────────────────────────────────────────────────
  cases: [
    {
      tier: 2,
      stat: "Underoutfit: 315% conversion rate boost after deploying product-fit chatbot",
      source: "Fountain City",
      url: "https://fountaincity.tech/resources/blog/ai-chatbot-sales-calculator/",
      use: "Real brand, real result — 3x conversion"
    },
    {
      tier: 2,
      stat: "KLM Royal Dutch Airlines: 40% lead base growth via chatbot-driven interactions",
      source: "Fountain City",
      url: "https://fountaincity.tech/resources/blog/ai-chatbot-sales-calculator/",
      use: "Enterprise-scale proof point"
    },
    {
      tier: 2,
      stat: "H&M: 15% sales increase after chatbot implementation",
      source: "Fountain City",
      url: "https://fountaincity.tech/resources/blog/ai-chatbot-sales-calculator/",
      use: "Household name, conservative but credible"
    },
  ],
} as const;
