# PRODUCT BIBLE — Pillar & Post AI

## SOURCE: Extracted from codebase and demo page. NOT opinions. FACTS.

---

## THE PRODUCT

Pillar & Post AI sells a team of 5 AI agents to Australian businesses. The agents are sold as a team via a personalised demo experience. Prospects enter their website URL, the system scrapes their site, builds a custom demo, and Bella (voice AI) conducts a live discovery call on the demo page.

## THE CUSTOMER JOURNEY

1. Prospect lands on capture page → enters name, email, website URL
2. System fires simultaneously: Firecrawl scrape, Apify deep scrape, old pipeline, workflow
3. Prospect redirected to loading page (8s animation while fast-intel completes)
4. Prospect lands on personalised demo page showing all 5 agents with their website in an iframe
5. Bella widget (bottom-right) — prospect clicks to start voice call
6. Bella engages ON THE DEMO PAGE. She is NOT calling them. They came to her.
7. Bella does quick discovery, confirms/disconfirms hypotheses from scraped data, recommends 2-3 agents, calculates ROI per agent, offers free trial

## BELLA'S ROLE

- Bella is a voice AI that sits on the demo page (widget bottom-right: "Talk to Bella — Voice AI • Click to call")
- She is NOT an outbound caller. The prospect initiates the conversation.
- She has ~2-3 minutes of the prospect's attention. Not a deep discovery — quick confirmation and recommendation.
- She uses scraped intelligence to sound like she's done 3 hours of research
- She recommends 2-3 agents, calculates ROI for each, offers a 7-day free trial

---

## THE 5 AGENTS — FROM THE DEMO PAGE AND BRIDGE PERSONA

### Chris — Website & Landing Page AI Sales Agent
- **Role**: Chat & Voice AI on the WEBSITE and LANDING PAGES — first contact, qualifies, sells, closes
- **Title on demo**: "Meet Chris, Your Website Concierge" (NOTE: "Concierge" undersells him — he's an AI sales agent, not just a greeter)
- **Bridge persona**: "website and inbound conversion. The voice on the landing page."
- **What he actually does**: Chris is an AI SALES AGENT that sits on the website and every landing page. The moment a visitor arrives, Chris engages them — answers questions, qualifies, handles objections, sells, and books appointments. He's trained on the business's services, pricing, and sales process. He doesn't just capture leads — he CLOSES on the page. Think of him as the best sales rep who never sleeps, never takes a break, and engages every single visitor instantly.
- **The competitive landscape**: Qualified/Piper, Docket, IrisAgent, Concierge.ai all do variations of this. Most charge enterprise B2B SaaS prices. Chris does it for SMBs and mid-market.
- **Key stat**: "Websites with AI chatbots see 23% higher conversion rates — and engaged visitors convert 4x more often than those who don't chat." (Amra & Elma)
- **Demo page benefits**: Responds in under 30 seconds, qualifies leads with smart questions, books directly into calendar, trained on services & pricing, never misses a lead
- **Tagline candidate**: "Turn every website visitor into an instant sales conversation"
- **Channel stage**: ch_website
- **ROI formula**: incremental = web_conversions × 0.23. Revenue = incremental × ACV / 52 weekly.

### Alex — Speed-to-Lead Follow-Up Agent
- **Role**: Speed-to-Lead AI — the off-site follow-up arm. Catches every lead Chris didn't close.
- **Title on demo**: "Meet Alex, Your Ads ROI Maximizer"
- **Bridge persona**: "speed-to-lead. Jumps on paid and inbound leads in under a minute."
- **What he actually does**: Alex is the FOLLOW-UP engine. When a visitor leaves the site without converting — bounced, submitted a form, started a chat but didn't book — Alex hits them via SMS, Messenger, or Instagram within 60 seconds. He's not a separate product from Chris — they're two stages of the same inbound conversion system. Chris = on-page, Alex = off-page. Together they close the entire funnel.
- **Why "Ads ROI Maximizer"**: When businesses run ads, every click costs money. Chris engages on arrival, Alex follows up after departure. The pair ensures ad spend converts at maximum rate.
- **Key stat**: "Leads contacted in under 1 minute see a 391% increase in conversions. The average business takes 47 hours." (Rep.ai)
- **Demo page benefits**: Responds in under 60 seconds, works across SMS/Messenger/Instagram, qualifies leads, sends videos/links/booking calendars, follows up automatically
- **Channel stage**: ch_ads
- **ROI formula**: Uplift tiers based on current follow-up speed: >24h=391%, 3-24h=200%, 30m-3h=100%, <30m=50%. Revenue = conversions × uplift_rate × ACV / 52 weekly.

### Maddie — AI Receptionist
- **Role**: Missed calls, after-hours, overflow
- **Title on demo**: "Meet Maddie, Your AI Receptionist"
- **Bridge persona**: "missed calls, after-hours, first response."
- **What she does**: Answers every inbound call professionally — never on hold, never a sick day, always qualifies before transferring
- **Key stat**: "78% of customers buy from the first business that responds. Miss a call? You've probably already lost them." (InsideSales.com)
- **Demo page benefits**: Answers calls in 2 rings or less, professional greeting every time, qualifies callers before transferring, takes messages & schedules callbacks, works 24/7
- **Channel stage**: ch_phone
- **ROI formula**: Revenue = missed_calls × conversion_rate × ACV / 52 weekly. (78% of customers go with first responder)

### Sarah — Database Reactivator
- **Role**: Sleeping Giant AI — wakes up dormant leads
- **Title on demo**: "Meet Sarah, Your Database Reactivator"
- **Bridge persona**: "dormant database reactivation."
- **What she does**: Re-engages cold leads and past customers with personalized SMS campaigns that feel genuinely human
- **Key stat**: "Database reactivation campaigns see a 5% conversion rate from dormant leads to active deals." (HubSpot)
- **Demo page benefits**: Reactivates leads you've already paid for, personalized outreach at scale, handles replies & objections naturally, books appointments automatically
- **Channel stage**: ch_old_leads
- **ROI formula**: reactivated = old_leads × 0.05. Revenue = reactivated × ACV / 52 weekly.

### James — Reputation Manager
- **Role**: Review AI
- **Title on demo**: "Meet James, Your Reputation Manager"
- **Bridge persona**: "reviews and reputation."
- **What he does**: Monitors reviews, responds instantly, turns happy customers into 5-star advocates, sends review request texts to satisfied customers
- **Key stat**: "1-star rating increase = 9% revenue boost. 88% of consumers trust reviews like personal recommendations. 72% won't act until they check your reviews." (Harvard Business School / BrightLocal)
- **Demo page benefits**: Monitors Google/Facebook/Yelp, responds to reviews in minutes, asks happy customers for reviews, alerts to negative feedback
- **Channel stage**: ch_reviews
- **ROI formula**: Revenue base = new_customers_per_period × periods_per_year × ACV. Revenue uplift = revenue_base × 0.09 / 52 weekly.

### Bella — AI Sales Consultant (The 6th Agent)
- **Role**: Voice AI on the demo page — conducts personalised research-driven discovery calls
- **What she does**: Bella is a CONSULTATIVE AI sales agent. She's done the homework — scraped the prospect's website, analysed their ICP, mapped their tech stack, checked their reputation. She doesn't cold-pitch; she demonstrates deep understanding of the business and recommends specific agents with calculated ROI.
- **How she's different from Chris**: Chris is high-volume, always-on, every visitor. Bella is high-touch, personalised, research-driven. Chris is the sales rep on the floor. Bella is the senior consultant who's prepared a custom brief.
- **B2B positioning**: For B2B/professional services, the team is Chris + Alex + Maddie + Bella. All four. Bella adds a consultative research-driven layer on top of the core three. She sounds like she's spent 3 hours researching the prospect. This is what Piper (Qualified), AiSDR, and Artisan's Ava are trying to do but with email/chat. Bella does it with VOICE, which is 10x more persuasive.
- **SMB positioning**: For SMBs (trades, dental, local services), the core team is Chris + Alex + Maddie. Bella sells them the team via the demo experience.
- **Future potential**: Bella could become a standalone B2B AI SDR product — doing research-driven personalised outbound discovery calls. The demo page is just her first deployment.
- **Tagline candidate**: "Turn every website visitor into an instant sales call" OR "Your AI sales consultant who's already done the homework"
- **NOTE**: Chris and Bella serve different market segments and buyer journeys. Chris = volume inbound conversion. Bella = consultative personalised selling. Both are needed.

### The Chris + Alex Inbound Conversion System
Chris and Alex are NOT two separate products. They're a SYSTEM:
1. Visitor arrives on website/landing page → Chris engages instantly (on-page)
2. Visitor doesn't convert → Alex follows up in under 60 seconds (off-page via SMS/Messenger)
3. Together they close the entire inbound funnel — on-page AND off-page
4. When ads are running, this system is CRITICAL because every click costs money
5. The combined value prop: "No visitor leaves without a conversation. No lead goes cold."

---

## AGENT SALES PRIORITY — THE COMMERCIAL LOGIC

### The hierarchy
- **CORE REVENUE AGENTS** (Chris, Alex, Maddie): Address ACTIVE revenue leaks — traffic bouncing, leads going cold, calls going to voicemail. These are costing money TODAY.
- **ENHANCEMENT AGENTS** (Sarah, James): Address latent/future opportunity — dormant leads, reputation growth. Valuable but not urgent.

### The pairing logic
- **Ads/inbound detected** → Chris + Alex. ALWAYS a pair. Chris engages on the landing page (first contact), Alex follows up leads Chris didn't close (speed-to-lead). Tease Maddie.
- **No ads, phone-heavy CTA** → Chris + Maddie. Chris on site, Maddie catches calls. Tease Alex.
- **No ads, form-based CTA** → Chris + Alex. Chris on site, Alex follows up form submissions. Tease Maddie.
- Sarah and James are mentioned as bonus value during or after ROI delivery — never lead with them.

### Why Chris + Alex pair when ads run
Ad click → visitor lands on website/landing page → Chris engages them live on the page → if Chris doesn't close them (they bounce, submit form, leave) → Alex follows up in under 60 seconds via SMS/Messenger. They are two stages of the same conversion funnel.

### Bella's flow
1. WOW — personalised insights from scraped data (8 stall levels)
2. anchor_acv — "What's a typical customer worth?"
3. anchor_timeframe — "Do you think weekly or monthly?"
4. Channel 1 — discovery questions + ROI calculation + delivery (in-stage)
5. Channel 2 — discovery questions + ROI calculation + delivery (in-stage)
6. Tease channel 3 — "I could crunch numbers on X too if you'd like"
7. roi_delivery — summary of all agent values
8. close — 7-day free trial offer

---

## DATA → AGENT PITCH MAPPING — How scraped data becomes sales ammunition

Every data source feeds specific agent recommendations. The consultant's job is NOT to report data — it's to produce COMMERCIAL WEDGES that tie evidence to a specific agent.

### CHRIS (Website AI Sales Agent) — fed by:
- **Firecrawl website**: No chat widget, weak CTAs, form-only conversion path, no live engagement
- **Facebook/Google Ads landing pages**: "Your ad sends traffic to a page with no AI agent — every click that bounces is money burnt. Chris would engage every visitor the moment they land."
- **Tech stack detection**: No chat tool, no booking widget, CRM but no live engagement layer
- **Ad creative + landing page mismatch**: "Your ad promises a free consultation but the landing page just has a Contact Us form — Chris would start that consultation instantly"

### ALEX (Speed-to-Lead) — fed by:
- **Facebook Ad Library**: Active campaigns = active ad spend = leads coming in that need instant follow-up
- **Google Ads Transparency**: Running search ads = paying per click = every slow follow-up is wasted money
- **Social media posts**: Regular posting = driving traffic = are those visitors converting? Are form fills getting followed up?
- **Ad landing page forms**: "Your ad leads to a form — how quickly are those submissions getting a response? Alex follows up in under 60 seconds"
- **Indeed/Seek jobs**: Hiring salespeople = they know follow-up matters but can't scale it

### MADDIE (AI Receptionist) — fed by:
- **Google Maps**: Business hours listed = after-hours calls going to voicemail
- **Website phone number prominent**: Phone-heavy business = missed calls = lost revenue
- **Social media posts mentioning availability**: "Your Instagram says you're available evenings but your Google listing shows you close at 5pm — Maddie catches every call"
- **Reviews mentioning phone issues**: "I saw a review saying they couldn't get through — Maddie makes sure that never happens"

### SARAH (Database Reactivation) — fed by:
- **Social media longevity**: "You've been posting for 3 years — thousands of people have engaged but never converted. Sarah wakes up that dormant database"
- **Indeed/Seek hiring**: Growing team = growing database of past leads that went cold
- **Google Maps review volume**: High review count = lots of past customers = reactivation goldmine
- **Ad history duration**: "You've been running ads for 18 months — that's thousands of leads. How many actually converted? Sarah works the ones that didn't"

### JAMES (Reputation Manager) — fed by:
- **Google Maps reviews**: Star rating, review count, recency, response behaviour
- **Review content**: Recurring praise themes, complaint patterns, unanswered negative reviews
- **Social media engagement**: Active social presence but reviews going stale
- **Competitor comparison**: "You're at 4.2 stars but competitors are at 4.8 — James closes that gap"

### BELLA (6th Agent — Consultative Sales) — fed by:
- **ALL data sources combined**: Bella IS the cross-source synthesis. She doesn't pitch one agent — she uses all intelligence to recommend the right TEAM.
- **The commercial wedge examples**:
  - "I can see your Facebook ad offers a free consultation and sends traffic to your Contact page which has no AI agent on it — every click that doesn't convert is wasted spend"
  - "5 stars from 29 reviews but the last one was 3 months ago — your reputation is strong but the momentum has stalled"
  - "You're hiring 3 new roles on Seek right now — that tells me you're growing fast, which means your database of past enquiries is probably massive. Have you thought about reactivating those old leads?"
  - "Your latest Instagram post got great engagement but the link goes to your homepage — Alex could follow up every single person who clicked"


---

## HIRING SIGNALS → AGENT REPLACEMENT WEDGE — THE KILLER PITCH

When we detect the prospect is hiring for roles our agents can replace or augment,
this is the STRONGEST possible sales wedge. They're literally paying to solve a 
problem our agents solve instantly.

### Role → Agent Mapping

| Hiring For | Agent(s) | Bella Says |
|---|---|---|
| Receptionist / Admin / Front desk | **Maddie** | "You're hiring a receptionist right now — Maddie can cover you TODAY while you find the right person. And she never takes a sick day." |
| SDR / BDR / Sales Development Rep | **Alex** | "You're hiring an SDR — that tells me lead follow-up is a priority. Alex does that job in under 60 seconds, 24/7, for a fraction of the cost." |
| Customer Service / Support | **Chris + Maddie** | "You're hiring customer support — Chris handles website enquiries and Maddie handles phone calls. Together they cover what 3 support hires would do." |
| Marketing / Digital Marketing | **Chris + Alex** | "You're hiring in marketing — you're about to drive more traffic. Chris and Alex make sure every visitor and lead that traffic generates actually converts." |
| Sales / Account Executive / Closer | **Alex + Sarah** | "You're scaling your sales team — Alex handles top of funnel so your new hires focus on closing. Sarah reactivates your dormant leads to fill their pipeline day one." |
| Social Media Manager | **Alex + James** | "You're hiring for social media — that means more traffic and engagement coming. Alex follows up every lead from social, James turns that engagement into reviews." |
| Office Manager / Operations | **Maddie** | "You're hiring an office manager — Maddie handles all the phone traffic so your new hire can focus on operations, not answering calls all day." |
| IT / Developer / Tech | **Chris** | "You're hiring tech — while your dev team builds, Chris is already live on your site converting visitors today. No development needed." |
| Content Writer / Copywriter | **Chris + James** | "You're hiring a content writer — Chris can use that content to engage visitors in real-time conversations. James uses it to build review responses that sound on-brand." |

### How This Feeds Into The Conversation

1. **WOW stall 7-8**: If hiring data is available, use it as the bridge to ACV:
   "I also noticed you're hiring [role] on [Seek/Indeed] — that tells me [insight]. 
   That's actually perfect context for what I want to show you..."

2. **Channel stages**: Reference the hire during the relevant agent's pitch:
   "You're literally hiring for this role right now — [agent] does it instantly."

3. **ROI delivery**: Frame ROI against the hiring cost:
   "The [role] you're hiring for costs what, $60-70K? [Agent] delivers the same 
   outcome for a fraction of that, starting today."

4. **Close**: Ultimate closer:
   "You're about to spend $70K on a [role] who takes 3 months to ramp up. 
   [Agent] starts in 10 minutes with a free trial. No brainer."

### Data Source
- Indeed scraper: job titles, salary, location, date, description
- Seek scraper: job titles, salary, location, company, date
- Careers page Firecrawl (Phase 2): roles, departments, tech stack mentions
- The consultant should classify each role into the agent mapping above
