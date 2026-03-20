# DATA ENRICHMENT MASTER PLAN — EVERY SOURCE, EVERY SIGNAL
# Source: Perplexity Deep Research + Product Bible
# Date: 18 Mar 2026
# Status: GO-LIVE BLOCKER

## ARCHITECTURE: TIERED CONDITIONAL ENRICHMENT

### TIER 1 — CORE (every lead, always fire)
- Website Firecrawl (HAVE)
- Google SERP discovery (HAVE — rename google_ads → google_search)
- Google Maps reviews + listing (HAVE)

### TIER 2 — CONDITIONAL (fire when signals detected)
- Facebook Ad Library (HAVE — fix rich data passthrough)
- Google Ads Transparency — ADD lexis-solutions/google-ads-scraper
- Instagram recent posts — ADD when IG link detected on site
- Seek.com.au — ADD for AU businesses
- Indeed — KEEP, expand from AU-only to GLOBAL

### TIER 3 — DIY FIRECRAWL (free — scrape discovered URLs)
- Ad landing pages (from Facebook + Google Ads URLs)
- Company careers/jobs page (from site nav or SERP)
- Testimonials/case studies pages (from site nav or SERP)
- Contact page + booking path analysis
- Press/newsroom/blog pages (from SERP)
- Location/franchise pages (from site nav)
- Social media profile pages (Facebook, Instagram, LinkedIn)
- YouTube channel + recent video titles
- Newsletter signup / email capture analysis

### TIER 4 — PREMIUM (add when revenue justifies)
- LinkedIn deep company + employee scraping
- Public financial data
- Patent/IP databases
- SimilarWeb-style traffic estimates

### RULES:
- ALL existing scrapers STAY. We ADD, never remove.
- LinkedIn AVOIDED as default scraper (too expensive). Use DIY Firecrawl of public page only.
- Every data point must map to a specific agent pitch. No data for data's sake.

---

## IMMEDIATE FIXES (before go-live)

### Fix 1: Rich data passthrough in write-deep-flags.ts
extract-deep.ts captures: fb_ads_sample (bodyText, CTA), reviews_sample (text, stars, 
reviewer name), jobs_sample (title, salary), linkedin data, google_rating, review_count, 
address, categories, is_running_fb_ads, is_running_google_ads, is_hiring, job_count,
linkedin_employees, linkedin_industry, linkedin_description.

write-deep-flags.ts FLATTENS all this to raw_json containing only counts.
FIX: Write ALL of extract-deep output to KV. Change value from 
`results.step_transform_13.raw_json` to `JSON.stringify(results.step_transform_13)`.

### Fix 2: Rename google_ads → google_search
This actor is apify~google-search-scraper — it searches Google for news/articles/awards.
It is NOT an ads scraper. Rename key everywhere:
fire-apify.ts, fire-apify-handler.ts, extract-deep.ts, poll-apify-deep.ts, 
build-intel.ts, types.ts. Actor stays the same, just the key name changes.

### Fix 3: Add Google Ads Transparency scraper
Actor: alkausari_mujahid/google-ads-transparency-scraper
Cost: PAY PER USAGE ONLY — no monthly fee (pennies per lead)
Optimized for batches, Playwright-based, good error handling + proxy support
Previous actors rejected: lexis-solutions ($25/mo rental), memo23 ($13/mo rental)
Key: "google_ads_transparency"
Search by business name/domain.
Returns: whether business runs Google Ads + basic metadata per domain.
For deeper creative data, can upgrade to memo23 later when revenue justifies $13/mo.

### Fix 4: Add Seek.com.au scraper
Research cheapest PPR Apify actor for seek.com.au.
Key: "seek_jobs". Fire for AU businesses only.
Runs in parallel with existing actors.

### Fix 5: Expand Indeed to global
Remove country: "AU" from Indeed config in fire-apify.ts and fire-apify-handler.ts.
Use business location from core_identity to set correct country code dynamically.

---

## EXTRACT-DEEP UPGRADE — What to capture from EVERY source

### From Facebook Ad Library (apify~facebook-ads-scraper)
Currently capturing: bodyText, callToActionType (as fb_ads_sample), count
MUST ALSO CAPTURE:
- Landing page URLs/domains (where does the ad send traffic?)
- Ad headline and description (separate from body)
- Creative type (image, video, carousel)
- Start date (how long running?)
- Platform distribution (FB only? IG too? Messenger?)
- Ad status (active/inactive)
- Number of active vs total ads
- Offer/promo language in ad copy

### From Google Ads Transparency (NEW — lexis-solutions)
CAPTURE ALL:
- Ad headlines (multiple per ad)
- Ad descriptions
- Landing page URLs (CRITICAL — feed to DIY Firecrawl)
- Date ranges (first seen, last seen)
- Ad format (text, display, video, shopping)
- Media/creative URLs
- Targeting info (regions, demographics)
- Impressions estimates if available

### From Google Maps (compass~google-maps-reviews-scraper)
Currently capturing: rating, review_count, address, categories, 5 review texts
MUST ALSO CAPTURE:
- Review recency (when was latest review?)
- Response behavior (does owner respond to reviews? How quickly?)
- Recurring praise themes (fast service, friendly staff, etc.)
- Recurring complaint themes (slow response, hard to reach, etc.)
- Operating hours
- Phone number
- Website URL listed
- Photos count
- Business attributes/amenities
- Competitor nearby businesses

### From Google Search (apify~google-search-scraper — renamed from google_ads)
Currently capturing: count only
MUST ALSO CAPTURE:
- Organic result titles and URLs (awards, press mentions, case studies)
- Knowledge panel data if present
- People Also Ask questions about the business
- Related searches
- News results about the business
- Directory listings (Yellow Pages, TrueLocal, Yelp, etc.)
- Third-party review sites mentioned
- Social media profiles discovered
- Careers page URL if found
- Blog/newsroom URL if found
- Testimonials/case studies page URL if found

### From Indeed (misceres~indeed-scraper)
Currently capturing: job titles, salary
MUST ALSO CAPTURE:
- Department/function (sales, support, marketing, tech)
- Seniority level
- Location (expansion signals)
- Job description snippets (tech stack mentions, tool mentions)
- Number of applicants (demand signal)
- Post date (urgency/growth signal)
- Remote/hybrid/onsite

### From Seek (NEW — AU businesses)
CAPTURE ALL:
- Job titles
- Salary ranges
- Locations
- Number of active listings
- Department/function
- Post dates
- Job description snippets

### From LinkedIn (DIY Firecrawl of public company page)
CAPTURE WHATEVER IS PUBLIC:
- Employee count / company size
- Industry classification
- Company description / about
- Follower count
- Headquarters location
- Founded year
- Specialties listed
- Recent posts (titles, engagement)
- Key personnel (leadership names, titles)
- Employee growth signals
- Technology mentions
- Company updates / announcements
- Office locations

### From Instagram (NEW — when IG link detected)
Use cheapest Apify actor for Instagram posts (~$1-1.60/1000 results)
CAPTURE:
- Latest 3-5 posts: text, date, likes, comments count
- Profile: follower count, following count, post count, bio
- Content themes (what are they posting about?)
- Posting frequency
- Engagement rate (likes+comments / followers)
- Promo/offer language in recent posts
- Links in bio
- Story highlights titles
- Hashtag strategy
- Whether they're cross-posting ads as organic content

---

## DIY FIRECRAWL ENRICHMENT — The free goldmine

These use Firecrawl on URLs we DISCOVER from other scrapers. Essentially FREE.

### Ad Landing Pages
TRIGGER: Facebook or Google ads return landing page URLs
ACTION: Firecrawl each unique landing page (max 3)
WHAT TO LOOK FOR:
- Hero headline / main offer
- CTA buttons (text, prominence, count)
- Form fields (how many? What info required?)
- Chat widget present? Which tool?
- Booking/scheduling tool present?
- Phone number prominent?
- Trust signals (testimonials, logos, badges, guarantees)
- Social proof (review count, star rating displayed)
- Page load speed indicators
- Mobile responsiveness signals
- Match between ad copy and landing page headline
- Video content present?
- Exit intent / popup indicators
- Pricing displayed or hidden?
WHY: "Your Facebook ad promises a free consultation but the landing page 
just has a 12-field form — Chris would start that consultation instantly"

### Company Careers Page
TRIGGER: SERP or site nav contains /careers, /jobs, /work-with-us
ACTION: Firecrawl the careers page
WHAT TO LOOK FOR:
- Number of open roles
- Departments hiring (sales=growth, support=scaling, tech=building)
- Seniority levels (junior=expanding, senior=upgrading)
- Tech stack mentions in job descriptions (CRM, tools, platforms)
- Benefits/perks (budget indicator)
- Growth language ("fast-growing", "scaling", "Series B")
- Remote/office policy
WHY: "You're hiring 3 sales roles — you know lead follow-up matters 
but you can't scale it fast enough. Alex handles that instantly."

### Testimonials / Case Studies / Client Pages
TRIGGER: SERP or site nav contains /testimonials, /case-studies, /clients, /portfolio
ACTION: Firecrawl the page
WHAT TO LOOK FOR:
- Client names and logos (reveals ICP)
- Industry verticals served
- Results/outcomes quoted (revenue numbers, growth metrics)
- Social proof language patterns
- Client size indicators
- Geographic coverage
WHY: Reveals exactly WHO they serve — feeds ICP refinement. 
"I can see you've done great work with [client] — businesses 
like that typically see huge ROI from Chris on their landing pages"

### Contact Page / Booking Path
TRIGGER: Always — every business has a contact method
ACTION: Firecrawl /contact or the primary CTA destination
WHAT TO LOOK FOR:
- Form length and complexity (friction score)
- Phone number prominence (phone-heavy = Maddie pitch)
- Booking widget present? Which tool?
- Chat widget present? Which tool?
- Email only? (slow response risk = Alex pitch)
- Response time promise displayed?
- Office hours listed?
- Multiple locations / location selector?
- FAQ / knowledge base before contact?
WHY: "Your contact page has a 9-field form with no instant response — 
every submission sits in a queue. Alex would follow up in 60 seconds."

### Press / Newsroom / Blog
TRIGGER: SERP results or site nav contains /news, /blog, /press, /media
ACTION: Firecrawl the page (latest 3-5 articles)
WHAT TO LOOK FOR:
- Recent announcements (launches, partnerships, expansions, funding)
- New service/product lines
- Awards and certifications
- Event participation
- Industry thought leadership topics
- Content publishing frequency
- Whether blog drives traffic (linked from nav? SEO optimized?)
WHY: "Congratulations on the [award] — that kind of recognition 
drives traffic. Are you capturing those visitors when they land?"

### Location / Franchise Pages
TRIGGER: Site has /locations, /branches, /find-us, multi-location indicators
ACTION: Firecrawl location pages
WHAT TO LOOK FOR:
- Number of locations
- Geographic spread
- Individual location contact details
- Inconsistent hours/info across locations
- Per-location review handling
- Franchise vs corporate structure
WHY: Multi-location = overflow + missed calls amplified across all branches.
"With 12 locations, every missed call at any branch is a lost customer. 
Maddie covers all of them simultaneously."

### Social Media Profiles (Facebook Page, Instagram, LinkedIn)
TRIGGER: Social URLs detected on website
ACTION: Firecrawl public profile pages
WHAT TO LOOK FOR:
- Follower/fan count
- Posting frequency and recency
- Content themes and topics
- Engagement rates (likes, comments, shares per post)
- Promotional content vs organic content ratio
- Whether organic mirrors paid messaging
- Response to comments (speed, tone)
- Community management quality
- Bio/about info (may differ from website)
- Links in bio (where do they send social traffic?)
- Pinned posts (current priorities)
- Story highlights (Instagram)
- Event listings
WHY: "You're posting 3x a week on Instagram which is driving real 
engagement — but those followers aren't converting because there's 
no AI agent on your landing page to catch them."

### YouTube Channel
TRIGGER: YouTube link detected on website or in SERP
ACTION: Firecrawl public YouTube channel page
WHAT TO LOOK FOR:
- Subscriber count
- Video count and upload frequency
- Recent video titles and topics
- View counts on recent videos
- Whether they're running YouTube ads
- Content themes (educational, promotional, testimonial)
- Description/about info
WHY: "You're investing in video content — that drives high-intent traffic.
Are those viewers converting when they click through to your site?"

### Newsletter / Email Capture
TRIGGER: Detected on website (email signup forms, popup captures)
ACTION: Already captured by Firecrawl of main site
WHAT TO LOOK FOR:
- Newsletter signup present?
- Lead magnet / gated content?
- Pop-up capture on exit?
- Email marketing platform detected (Mailchimp, Klaviyo, etc.)
- Frequency of sends (if archive page exists)
WHY: Email list = massive dormant database. "You've been collecting 
emails for years — Sarah can reactivate every subscriber who 
engaged but never converted."

---

## WHAT THE BEST TEAMS EXTRACT (from Perplexity)

### Active Demand Signals
- Ads running (Facebook, Google, Instagram)
- Multiple landing pages (campaign complexity)
- Jobs in sales/support/marketing (scaling customer-facing roles)
- Strong CTA infrastructure (booking widgets, chat, forms)
- High ad spend / long campaign duration

### Conversion Friction Signals
- Weak/long forms
- Slow response risk (email-only contact)
- Heavy phone dependence with no overflow handling
- No live chat or AI agent on site
- Poor landing page alignment with ad copy
- No trust proof on conversion pages
- Mobile-unfriendly booking paths

### Social Proof Signals
- Google review themes (speed, quality, responsiveness)
- Testimonial content and client logos
- Case study results and metrics
- Star ratings across platforms (Google, Trustpilot, Facebook, Yelp)
- Awards and industry certifications
- Media mentions and press coverage

### Momentum Signals
- Posting bursts on social media
- Hiring bursts (multiple roles simultaneously)
- Campaign longevity (ads running 6+ months = committed spend)
- New service pages / product launches
- New location pages
- Franchise expansion indicators

### Tooling Signals
- CRM detected (HubSpot, Salesforce, etc.)
- Booking stack (Calendly, Acuity, etc.)
- Chat stack (Intercom, Drift, LiveChat, etc.)
- Ecommerce platform (Shopify, WooCommerce, etc.)
- Ad pixels (Facebook, Google, LinkedIn, TikTok)
- Email marketing (Mailchimp, Klaviyo, ActiveCampaign, etc.)
- Analytics (GA4, Hotjar, etc.)
- Review management tools
- Call tracking software

---

## CONSULTANT UPGRADE SPEC

The Gemini consultant must be upgraded to:

### 1. RECEIVE all enrichment data
Every field from every source listed above must flow into the consultant payload.
Structure it as:
```
{
  website: { firecrawl content, tech_stack, flags },
  ads: {
    facebook: { count, sample with full detail, landing_urls },
    google: { count, headlines, descriptions, landing_urls, formats },
  },
  social: {
    facebook_page: { followers, recent_posts, posting_freq, engagement },
    instagram: { followers, recent_posts, posting_freq, engagement, bio },
    linkedin: { employees, industry, description, recent_posts },
    youtube: { subscribers, video_count, recent_titles }
  },
  reviews: {
    google: { rating, count, recency, response_behavior, themes },
    other_platforms: { trustpilot, yelp, facebook reviews }
  },
  hiring: {
    indeed: { jobs with full detail },
    seek: { jobs with full detail },
    careers_page: { roles, departments, growth_signals }
  },
  landing_pages: [
    { url, source_ad, hero_text, ctas, chat_widget, booking_tool, form_fields }
  ],
  news_press: [ { title, date, source, summary } ],
  testimonials: [ { client, industry, result, quote } ],
  contact_analysis: { form_length, phone_prominent, chat_present, booking_present }
}
```

### 2. PRODUCE agent-specific commercial wedges
NOT generic marketing observations. Every insight tied to a specific agent:
```
{
  agentWedges: {
    Chris: { evidence: "...", pitch: "...", data_sources: [...] },
    Alex: { evidence: "...", pitch: "...", data_sources: [...] },
    Maddie: { evidence: "...", pitch: "...", data_sources: [...] },
    Sarah: { evidence: "...", pitch: "...", data_sources: [...] },
    James: { evidence: "...", pitch: "...", data_sources: [...] }
  },
  wowInsights: [
    { source: "facebook_ads + landing_page", insight: "...", agentTieIn: "Chris" },
    { source: "instagram + ad_copy", insight: "...", agentTieIn: "Alex" }
  ],
  conversionFriction: { score: 1-10, issues: [...], agentFix: "Chris/Alex/Maddie" },
  demandSignals: { score: 1-10, evidence: [...] },
  momentumSignals: { score: 1-10, evidence: [...] }
}
```

### 3. CROSS-REFERENCE sources
The killer insights come from combining data:
- Ads + landing pages → conversion friction analysis
- Social posts + ad copy → messaging consistency
- Reviews + contact page → response quality assessment
- Hiring + social activity → growth momentum score
- Ad spend + conversion path → ROI leak identification

---

## COST MODEL

Target: SINGLE DIGIT CENTS per lead TOTAL.

### Apify actors (pay-per-result):
- Google SERP: ~$0.001 per query
- Google Maps: ~$0.004 per listing
- Facebook Ad Library: ~$0.005 per run (when ads exist)
- Google Ads Transparency: ~$0.005-0.01 per run (when ads exist)
- Indeed: ~$0.003 per run
- Seek: ~$0.003 per run (AU only)
- Instagram posts: ~$0.001-0.002 per run (when IG active)

### DIY Firecrawl (already paying for Firecrawl — essentially free):
- Ad landing pages (1-3 URLs): ~$0.001-0.003
- Careers page: ~$0.001
- Testimonials page: ~$0.001
- Contact page: ~$0.001
- Press/blog page: ~$0.001
- Social profiles: ~$0.001 each

### Gemini consultant: ~$0.001-0.002

### ESTIMATED TOTAL PER LEAD:
- Full enrichment (all conditional sources fire): ~$0.03-0.05
- Average lead (conditional sources selective): ~$0.02-0.03
- Lean lead (core only): ~$0.01

WELL WITHIN SINGLE DIGIT CENTS TARGET.

---

## IMPLEMENTATION ORDER

### Phase 1: Go-live blockers (DONE except stagger)
1. Fix rich data passthrough in write-deep-flags.ts ✅ DONE v9.1.2
2. Rename google_ads → google_search everywhere ✅ DONE v9.1.2
3. Add Google Ads Transparency scraper (alkausari_mujahid — usage-only, no monthly) ✅ DONE v9.1.3 (actor swap pending)
4. Add Seek.com.au scraper ✅ DONE v9.1.3
5. Expand Indeed to global ✅ DONE v9.1.3
6. Upgrade extract-deep.ts to capture ALL rich fields ✅ DONE v9.1.3
7. Fix Bella's greeting script ✅ DONE v9.1.1
8. STAGGER APIFY WAVES A/B/C to fit under 8GB Free plan cap ⬜ IN PROGRESS

### Phase 2: DIY Firecrawl enrichment (next sprint)
8. Ad landing page Firecrawl (from Facebook + Google ad URLs)
9. Careers page Firecrawl
10. Testimonials/case studies page Firecrawl
11. Contact page analysis Firecrawl
12. Social media profile Firecrawl (Facebook, Instagram, LinkedIn)
13. Press/blog page Firecrawl

### Phase 3: Conditional scrapers (next sprint)
14. Instagram posts Apify actor (when IG detected)
15. YouTube channel Firecrawl (when YT detected)
16. Additional review platforms (Trustpilot, Yelp, Facebook reviews)

### Phase 4: Consultant + Bridge upgrade
17. Consultant prompt rewrite — receives ALL enrichment data
18. Consultant produces agentWedges, wowInsights, conversionFriction
19. Bridge loadMergedIntel surfaces all new data
20. buildStageDirective uses consultant's commercial wedges

### Phase 5: Premium tier (when revenue justifies)
21. LinkedIn deep scraping
22. Website traffic estimates
23. Patent/financial databases

---

## ALSO GIVE CC THE RAW PERPLEXITY RESULTS
CC should read the full Perplexity output for context on:
- Best practices from top sales intelligence platforms
- Specific Apify actor recommendations with pricing
- The tiered conditional architecture rationale
- Cross-source synthesis patterns
- What's noise vs what's commercially valuable


---

## EXECUTION ARCHITECTURE — STAGGERED APIFY WAVES (FREE PLAN 8GB CAP)

### The Constraint
Apify Free plan: 8,192MB concurrent memory cap. Our 7+ actors need ~12GB at
default memory. We CANNOT fire all actors simultaneously.

### The Solution: Sequential Apify Waves
The 8GB cap is CONCURRENT, not total. Once actors finish and release memory,
we can fire more. Run ALL actors — just stagger them in waves that fit under 8GB.
Each wave waits for previous wave to complete before firing.

### PHASE 1 (NOW): Staggered Apify waves for current 7 actors

```
APIFY WAVE A — fire at T=0 (~2.8GB concurrent):
├── google_maps:    1024MB  (reviews, rating, hours, phone)
├── google_search:  1024MB  (news, awards, articles, SERP discovery)
├── seek_jobs:       256MB  (AU job listings)
├── linkedin:        512MB  (company data — fails gracefully if trial expired)
Total: 2816MB ✅ under 8GB

APIFY WAVE B — fire AFTER Wave A completes (~5.1GB concurrent):
├── facebook_ads:            1024MB  (ad copy, CTA, landing URLs)
├── google_ads_transparency:  4096MB  (ad headlines, descriptions, landing pages)
Total: 5120MB ✅ under 8GB

APIFY WAVE C — fire AFTER Wave B completes (~5.1GB concurrent):
├── indeed:    4096MB  (global job listings — needs full memory)
├── instagram: 1024MB  (conditional — only when IG detected on site)
Total: 5120MB ✅ under 8GB
```

### Implementation:
1. /fire-apify fires ONLY Wave A actors at T=0. Stores run IDs in KV.
2. poll-apify-deep polls Wave A until complete (~15-20s)
3. Fires Wave B actors from within workflow, stores run IDs
4. Polls Wave B until complete (~15-20s)
5. Fires Wave C actors, stores run IDs
6. Polls Wave C until complete (~15-20s)
7. extract-deep reads ALL actor results from ALL waves — one deep_flags KV write

### Timing:
Wave A complete: ~T+20s
Wave B complete: ~T+40s  
Wave C complete: ~T+55s
Total: ~55s (slightly longer than parallel, but ALL actors at full default memory)

### Data storage:
ALL wave results merge into SAME workflow state. Each actor has its own key.
extract-deep reads all, merges into ONE deep_flags KV write. No overwrite risk.

### Bridge handles the timing:
- Bella has fast-intel from T+10s (consultant analysis, website data)
- Late-load rebuild fires when deep_flags appears in KV
- Each turn, loadMergedIntel reads whatever data is available
- Bella gets RICHER with each subsequent turn

### Key rule: Remove ALL memoryMbytes overrides — let every actor use DEFAULT memory.

### PHASE 2 (AFTER STAGGERED APIFY WORKING): Layer in DIY Firecrawl waves

Once staggered Apify pipeline is solid, add Firecrawl of discovered URLs.
These are NOT Apify — they run on OUR workers, no memory cap issue.
Can run IN PARALLEL with Apify waves.

FIRECRAWL WAVE 1 — after fast-intel completes (T+10s):
- /careers, /testimonials, /contact, /blog, /locations pages
- Social profile URLs (FB, IG, LI, YT)
- Results write to lead:{lid}:discovered_pages KV

FIRECRAWL WAVE 2 — after Apify Wave B returns ad landing page URLs (T+40s):
- Facebook Ad landing page URLs (max 3)
- Google Ad landing page URLs (max 3)
- Results write to lead:{lid}:landing_pages KV

---

## HOW BELLA INCORPORATES DATA — PER TURN MECHANICS

### Every single turn:
```
1. loadMergedIntel() reads ALL KV sources:
   - lead:{lid}:fast-intel      → consultant analysis, tech stack, flags, ICP
   - lead:{lid}:deep_flags      → Apify data (ads, reviews, jobs, social, LinkedIn)
   - lead:{lid}:intel           → workflow merged intel
   - lead:{lid}:deepIntel       → old pipeline data
   - lead:{lid}:landing_pages   → Wave 3 ad landing page analysis (NEW)

2. Deep merge into single MergedIntel object:
   intel = {
     core_identity, tech_stack, flags,
     consultant: { scriptFills, agentWedges, wowInsights, routing, agentScorecard },
     deep: { 
       googleMaps, ads, social, hiring, landingPages, 
       careers, testimonials, contact, press, youtube 
     }
   }

3. buildStageDirective(stage, stall, intel, inputs) builds the PROMPT:
   - WOW stalls → uses consultant.wowInsights + deep data for personalised openers
   - anchor_acv → uses industry benchmarks from core_identity
   - Channel stages → uses consultant.agentWedges[agentName] for killer pitches
   - roi_delivery → uses calculated ROI from captured inputs + agent evidence
   - close → uses trial offer + personalised summary

4. Gemini receives the stage-specific prompt and generates Bella's response
```

### Data gets RICHER as conversation progresses:
```
Turn 1 (WOW):     fast-intel + deepIntel + maybe deep_flags → personalised opener
Turn 2 (WOW):     + deep_flags definitely arrived → reviews, ads, jobs data available
Turn 3-6 (WOW):   + Wave 3 landing pages → can reference ad landing page specifics  
Turn 7+ (stages): Full intel available + prospect's own answers from extraction
```

### Late-Load Rebuild (data arrives mid-conversation):
```
IF new deep data arrives between turns:
  1. Bridge detects deepJustArrived = true
  2. rebuildFutureQueueOnLateLoad() fires
  3. Locks completed + current stages (can't change the past)
  4. Rebuilds FUTURE queue with new signals:
     - Google Ads detected? → boost ch_ads
     - High review volume? → tease James earlier
     - Lots of hiring? → mention Sarah earlier
  5. New data immediately available in next buildStageDirective()

CRITICAL: Bella doesn't need ALL data for Turn 1. She needs enough for a 
strong opener (ICP insight from consultant). Deep data enriches subsequent 
turns — she gets smarter as the conversation progresses.
```

---

## HOW DATA FEEDS THE DEMO PAGE AGENTS

The demo page (demo_v15_hybrid.html) shows all 5 agents with personalised content.
Currently the demo page reads from the old pipeline (deepIntel). It needs upgrading 
to use the new enrichment data:

### Demo page agent cards should show:
- **Chris card**: "{X} website visitors per month with no AI engagement" 
  (from Firecrawl tech_stack — no chat widget detected)
- **Alex card**: "{X} active ads running — are leads getting followed up instantly?" 
  (from Facebook + Google ads data)
- **Maddie card**: "Open {hours} — who's answering after {closing time}?" 
  (from Google Maps operating hours)
- **Sarah card**: "{X} years in business — how many past leads went cold?" 
  (from Google Maps listing age / website age)
- **James card**: "{rating} stars from {count} reviews — last review {recency}" 
  (from Google Maps)

### How: 
The demo page already reads KV data via the demo page JS. Extend it to read 
fast-intel and deep_flags for richer personalisation. The data is already in KV — 
just needs the demo page to use it.

---

## AGENT-SPECIFIC COMMERCIAL WEDGES — WHAT BELLA ACTUALLY SAYS

THIS IS THE GOLD. NOT generic digital marketing advice. Every data point tied to 
a SPECIFIC AGENT with a SPECIFIC REVENUE IMPACT.

### CHRIS (Website AI Sales Agent)
Data sources → commercial wedge:

FROM FIRECRAWL (website):
- No chat widget detected → "Every visitor to your site right now leaves without 
  a conversation. Chris engages them the moment they land."
- Weak CTAs / form-only conversion → "Your main conversion path is a contact form — 
  most people won't fill it out. Chris starts a live conversation instead."
- No booking widget → "There's no way for visitors to book instantly — Chris handles 
  that in the conversation."

FROM ADS + LANDING PAGES:
- Facebook/Google ads running + landing page has no chat → "I can see your Facebook ad 
  offers [offer from ad copy] and sends traffic to [landing page URL] — but there's no 
  one there to engage them live. Every click that bounces is money burnt. Chris would 
  engage every single visitor the moment they land."
- Ad copy promises consultation but landing page is just a form → "Your ad promises a 
  free consultation but the landing page just has a 12-field form — Chris would START 
  that consultation instantly."
- Multiple landing pages with different offers → "You're running [X] campaigns across 
  [Y] landing pages — Chris can be on ALL of them simultaneously, trained on each offer."

FROM SOCIAL:
- Active social posting driving traffic → "You're posting 3x a week which is driving 
  engagement — but when those followers click through to your site, who's engaging them? 
  Chris catches every one."

### ALEX (Speed-to-Lead Follow-Up)
Data sources → commercial wedge:

FROM ADS:
- Facebook ads active → "You're spending real money on Facebook ads. When someone clicks 
  but doesn't convert on the page, how fast are they getting a follow-up? Alex follows up 
  every single lead in under 60 seconds via SMS."
- Google Ads active → "You've got [X] Google Ads running right now — those clicks cost 
  money. If your form submissions sit in an inbox for hours, that's 391% less likely to 
  convert. Alex responds in under a minute."
- Ad spend duration → "You've been running these ads for [X] months — that's serious 
  investment. Alex makes sure every dollar of that spend gets maximum conversion."

FROM CONTACT PAGE:
- Email-only contact → "Your only contact method is email — that means leads wait hours 
  for a response. Alex follows up in under 60 seconds."
- Form submissions with no instant response → "When someone fills out that form, what 
  happens next? If it takes more than a minute, you've probably lost them. Alex is on it 
  in seconds."

FROM SOCIAL + ADS TOGETHER:
- Social content mirrors ad messaging → "Your Instagram posts are pushing the same offer 
  as your ads — that's smart. But are you catching the intent from both channels? Alex 
  follows up every form fill, DM, and comment in real-time."

FROM HIRING:
- Hiring sales/marketing roles → "You're hiring [X] sales roles on [Seek/Indeed] — 
  you know lead follow-up matters but you can't scale it fast enough. Alex handles that 
  instantly while your team focuses on closing."

### MADDIE (AI Receptionist)
Data sources → commercial wedge:

FROM GOOGLE MAPS:
- Operating hours listed → "Your Google listing says you close at [time] — who's 
  answering calls after that? Maddie never closes."
- Phone number prominent → "Phone is clearly your primary contact method — when 
  all lines are busy or it's after hours, where do those calls go? Maddie catches 
  every single one."

FROM REVIEWS:
- Reviews mention phone issues → "I noticed a review saying '[quote about waiting/
  not getting through]' — Maddie makes sure that never happens again."
- Reviews mention responsiveness → "Your reviews praise fast service — Maddie keeps 
  that standard going 24/7 without adding staff."

FROM WEBSITE:
- Click-to-call prominent → "Your site is heavily phone-oriented — that's great for 
  conversion but it means missed calls hit hard. Maddie answers in 2 rings."
- Multiple locations with different numbers → "With [X] locations each with their own 
  number, overflow and after-hours coverage gets complicated. Maddie handles all of 
  them from one system."

FROM SOCIAL:
- Posts mentioning availability/hours → "Your latest Instagram post promotes evening 
  availability but your Google listing shows you close at 5pm — Maddie makes sure 
  every caller gets through regardless of the hour."

FROM HIRING:
- Hiring receptionist/admin roles → "You're hiring for reception — Maddie can handle 
  the overflow immediately while you find the right person. And she doesn't take sick 
  days."

### SARAH (Database Reactivation)
Data sources → commercial wedge:

FROM SOCIAL MEDIA:
- Long posting history → "You've been active on social media for [X] years — that 
  means thousands of people have engaged with your content over time. How many of 
  those became customers? Sarah wakes up every one that didn't."
- Large follower base → "[X] followers across your social channels — that's a massive 
  database of people who already know your brand. Sarah reaches out to the ones who 
  went cold."

FROM REVIEWS:
- High review count → "[X] reviews means hundreds of past customers. When's the last 
  time you reached out to them for referrals or repeat business? Sarah does that 
  automatically."
- Review patterns showing churn → "Some of your reviews mention one-time purchases — 
  Sarah brings those customers back with personalised follow-up."

FROM ADS:
- Long ad history → "You've been running ads for [X] months — that's thousands of 
  leads that came through. Industry average is only 2-5% convert. Sarah works the 
  other 95%."
- Multiple campaigns over time → "You've run [X] different campaigns — each one 
  generated leads. Sarah reactivates the ones from older campaigns that went cold."

FROM HIRING:
- Growing team → "You're hiring [X] roles — the business is growing. That growth 
  means you've got an even bigger database of past enquiries that never converted. 
  Sarah can work those TODAY while you scale."
- Hiring in marketing/sales → "You're investing in new sales and marketing hires — 
  while they ramp up, Sarah can start generating revenue from your existing database 
  immediately."

FROM EMAIL CAPTURE:
- Newsletter/lead magnet detected → "You've got a lead magnet on your site which 
  means you've been collecting emails for years. Sarah can reactivate that entire 
  list with personalised SMS outreach."

### JAMES (Reputation Manager)
Data sources → commercial wedge:

FROM GOOGLE MAPS:
- Good rating but stale reviews → "[rating] stars from [count] reviews is strong — 
  but your last review was [X] months ago. James keeps the momentum going by 
  automatically asking every happy client for a review."
- Low review count for business age → "You've been around for [years] but only have 
  [X] reviews — James would have 10x that number by now."
- Unanswered negative reviews → "I noticed a [X]-star review from [date] that hasn't 
  been responded to. James responds to every review within minutes — negative reviews 
  get addressed before they damage your reputation."
- Owner response pattern → "You're responding to reviews but it takes [X] days — 
  James responds within minutes and personalises every reply."
- Competitor reviews higher → "Your nearest competitor has [X] stars from [Y] reviews 
  — James closes that gap by building review momentum."

FROM SOCIAL:
- Active social but weak reviews → "You're crushing it on social media with [X] 
  followers but your Google reviews don't reflect that energy. James turns your happy 
  customers into 5-star advocates."

FROM TESTIMONIALS PAGE:
- Strong testimonials on site but not on Google → "You've got amazing testimonials on 
  your website — James gets those same happy clients to put it on Google where 72% of 
  buyers check before making a decision."

### BELLA (Cross-Source Synthesis — The 6th Agent)
Bella's power is COMBINING data from multiple sources into compound insights 
that no single data point could produce:

ADS + LANDING PAGE + WEBSITE:
"I can see you're running a Facebook ad offering [offer from ad copy] that sends 
traffic to [landing page]. That page has [X-field form] but no live chat and no 
booking widget. So every click that doesn't fill out the form is wasted spend. 
Chris would engage every visitor the moment they land and Alex would follow up 
the ones who bounce in under 60 seconds."

REVIEWS + CONTACT PAGE + SOCIAL:
"Your reviews consistently praise your fast service — [quote from review]. But 
your contact page has a [X]-field form with no instant response. There's a gap 
between your reputation and your conversion path. Chris closes that gap."

SOCIAL POSTING + AD CAMPAIGNS + CONVERSION PATH:
"You're posting regularly on Instagram, running Facebook ads, and your Google Ads 
have been active for [X] months — that's serious investment in driving traffic. 
But when I look at where all that traffic lands, there's no AI agent engaging them. 
That's like hiring 10 sales people to do cold outreach and then having nobody at 
the desk when people walk in."

HIRING + ADS + DATABASE:
"You're hiring [X] new sales roles and running active ad campaigns — you're in 
growth mode. But every month you've been running ads, leads that didn't convert 
went into a black hole. That's potentially thousands of warm leads. Sarah reactivates 
those while your new hires focus on fresh pipeline."

REVIEWS + SOCIAL + COMPETITOR:
"You've got [rating] stars but your competitor down the road has [competitor rating] 
with [competitor reviews] reviews. Meanwhile your Instagram engagement shows your 
customers love you — they just aren't putting it on Google. James fixes that and 
turns your social fans into review advocates."

LOCATION + HOURS + PHONE + REVIEWS:
"With [X] locations, you're open [hours] but I can see from reviews that people 
try to reach you after hours and on weekends. That's [X] potential customers per 
week going to voicemail across all branches. Maddie covers every location 24/7 
from one system."

---

## HOW THE CONSULTANT PRODUCES THESE WEDGES

The consultant receives ALL enrichment data and its prompt instructs it to:

1. SCAN every data source for agent-relevant signals
2. CROSS-REFERENCE sources to find compound insights
3. RANK wedges by commercial impact (active revenue leaks > latent opportunity)
4. OUTPUT structured agentWedges with:
   - evidence: the specific data points (with citations to sources)
   - pitch: the exact line Bella should say (conversational, specific, commercial)
   - impact: estimated revenue impact if available
   - data_sources: which sources contributed to this wedge

The consultant does NOT produce generic observations like "your website could be 
improved" — it produces weaponised sales ammunition like "your Facebook ad sends 
traffic to a 12-field form with no live agent — Chris would convert 23% more of 
those clicks."

---

## KV STORAGE — WHERE EACH WAVE WRITES

```
lead:{lid}:stub              ← T=0, capture.html (basic lead info)
lead:{lid}:fast-intel        ← T+10s, fast-intel worker (Firecrawl + Consultant)
lead:{lid}:stage_plan        ← T+10s, consultant (routing + priorities)
lead:{lid}:discovered_pages  ← T+16-22s, Wave 2 (careers, testimonials, contact, etc.) NEW
lead:{lid}:deepIntel         ← T+3-5s, old pipeline
lead:{lid}:apify_runs        ← T+0s, pre-fired run IDs
lead:{lid}:deep_flags        ← T+35-40s, workflow (Apify extracted data)
lead:{lid}:landing_pages     ← T+40-48s, Wave 3 (ad landing page analysis) NEW
lead:{lid}:intel             ← T+37s, workflow (merged intel)
lead:{lid}:script_state      ← permanent, bridge (conversation state)
lead:{lid}:captured_inputs   ← during call, bridge (prospect's answers)
lead:{lid}:roi               ← during call, bridge (calculated ROI per agent)
lead:{lid}:conv_memory        ← during call, bridge (distilled conversation history)
```

Bridge's loadMergedIntel() reads ALL of these and deep-merges into one object.
New KV keys (discovered_pages, landing_pages) just need adding to the merge logic.

---

## PERPLEXITY RECOMMENDED SCRAPERS — FULL CAPTURE

### Cheapest Apify actors (from Perplexity research):

| Source | Actor | Cost | Notes |
|--------|-------|------|-------|
| Facebook Ad Library | apify~facebook-ads-scraper | $3.40-5.80/1000 ads | HAVE — fix data passthrough |
| Google Ads Transparency | alkausari_mujahid/google-ads-transparency-scraper | Pay per usage only (no monthly fee) | SWAPPED — lexis-solutions needed $25/mo rental, memo23 needed $13/mo. This is usage-only. |
| Google Maps | compass~google-maps-reviews-scraper | ~$4/1000 listings | HAVE — extract more fields |
| Google SERP | apify~google-search-scraper | ~$0.001/query | HAVE — rename from google_ads |
| Indeed | misceres~indeed-scraper | ~$3/1000 listings | HAVE — expand to global |
| Seek | TBD — research cheapest | TBD | ADD — AU businesses |
| Instagram posts | apify~instagram-post-scraper | ~$1-1.60/1000 | ADD — when IG detected |
| LinkedIn company | TBD — cheapest no-auth | TBD | REPLACE — trial expired |

### DIY Firecrawl targets (essentially free):
- Ad landing pages (from ad URLs) — Firecrawl
- Careers/jobs page — Firecrawl
- Testimonials/case studies — Firecrawl
- Contact page — Firecrawl
- Press/blog/news — Firecrawl
- Social profiles (FB, IG, LI, YT) — Firecrawl
- Location/franchise pages — Firecrawl

### Perplexity's key insight: 
"The highest-value data for Bella is not the broadest data; it is the data that 
creates a sharp, conversational, commercial wedge. A live 5-minute sales call 
benefits more from three strong, current, commercial signals than from 50 loosely 
related facts."

"The gold is not more databases — it's cross-source synthesis."

"The right architecture is: Core on every lead (website + SERP + Google Maps), 
Conditional tier (Meta ads, Instagram, jobs, Google Ads), Premium tier later 
(LinkedIn deep, financial, traffic estimates)."

---

## CC IMPLEMENTATION SUMMARY

Give CC this document AND the raw Perplexity results. CC's mission:

### IMMEDIATE (Phase 1 — go-live blockers):
1. Fix write-deep-flags.ts — pass through ALL rich data, not just counts
2. Rename google_ads → google_search everywhere
3. Add alkausari_mujahid/google-ads-transparency-scraper (usage-only, no monthly fee)
4. Research + add cheapest Seek.com.au scraper
5. Expand Indeed from AU-only to global (dynamic country code)
6. Upgrade extract-deep.ts to capture ALL fields from ALL sources
7. Fix Bella greeting script (Deepgram welcome vs bridge WOW stall=1)
8. Fix Bella WOW language ("It looks like" not "It's clear")

### NEXT (Phase 2 — Wave 2 DIY enrichment):
9. Add Wave 2 Firecrawl of discovered pages after fast-intel completes
10. Implement ad landing page Firecrawl (Wave 3) after Apify returns
11. Add new KV keys (discovered_pages, landing_pages) to bridge loadMergedIntel
12. Research + add Instagram posts scraper (conditional)
13. Research + replace LinkedIn company scraper (cheapest no-auth)

### THEN (Phase 3 — Consultant + Bridge upgrade):
14. Consultant prompt rewrite to produce agentWedges, wowInsights, cross-source synthesis
15. Bridge loadMergedIntel upgrade to surface all new data
16. buildStageDirective upgrade to use commercial wedges in channel stages
17. Demo page upgrade to show enriched agent card data

### WORKING RULES:
- ALL existing scrapers STAY. We ADD, never remove.
- Every data point must map to a specific agent pitch
- Cost target: SINGLE DIGIT CENTS per lead total
- Timing target: All data available before Bella's first turn (~T+45s max)
- Three-wave async execution — no blocking, no serial dependencies
- Late-load rebuild handles data arriving mid-conversation

---

## PROGRESSIVE ENRICHMENT POLICY (from Perplexity deep research)

### The Reality: WOW Stalls ARE the Data Collection Window
The WOW stall period (stalls 1-8, ~60-90 seconds) IS DESIGNED for data to arrive 
during it. Bella WILL be updating her script with new data DURING the stall period. 
Each turn, loadMergedIntel() reads ALL KV — so as each Apify wave completes and 
writes to KV, the NEXT WOW stall gets richer data than the previous one.

This is BY DESIGN:
- stall 1: Has fast-intel only → free trial pitch (scripted, no data needed)
- stall 2: Has fast-intel → ICP insight from consultant
- stall 3: Wave A just landed → NOW has reviews, Google SERP, Seek data → richer insight
- stall 4: Wave A data available → ICP + problems with real evidence
- stall 5: Wave B landing → NOW has Facebook ads, Google Ads data → can reference ads
- stall 6: All Apify waves complete → full intel for confirmation
- stall 7-8: EVERYTHING available → bridge to ACV with maximum ammunition

Each WOW stall that completes RELEASES Apify memory for the next wave to fire.
The stall period is literally buying time for data while keeping the prospect engaged.

### Three Signal Classes (when new data lands mid-conversation)

1. **CONTINUE** (default): Low-importance or weak-confidence signals stay in 
   background until their natural stage. Example: Indeed jobs data → save for 
   Sarah pitch during roi_delivery, don't mention during WOW.

2. **PREEMPT NEXT STAGE**: High-value, high-confidence signals reorder FUTURE 
   stages. Example: Google Ads data arrives showing heavy ad spend → boost 
   ch_ads ahead in the queue, Alex gets pitched before Chris.
   Implementation: rebuildFutureQueueOnLateLoad() already does this.

3. **INTERRUPT NOW**: ONLY when signal prevents Bella saying something wrong 
   OR creates immediate economic leverage. Example: Bella was about to say 
   "you're not running ads" but Google Ads data just landed showing 5 active 
   campaigns. Interrupt to avoid looking stupid.
   Should be EXTREMELY rare — almost never needed if WOW stalls are doing 
   their job buying time.

### Signal Scoring (for rebuildFutureQueueOnLateLoad)
When new data arrives, score each signal:
  score = commercial_impact × confidence × stage_fit × recency
  
- commercial_impact: How much does this change the ROI story? (1-10)
- confidence: How reliable is this data? (1-10)  
- stage_fit: Does this data have a natural stage to live in? (1-10)
- recency: Is this timely / current? (1-10)

If score > threshold → reorder future queue
If score > high_threshold AND current stage = WOW → eligible for interrupt

### Natural Transition Language
NEVER say: "Oh, I just noticed..." or "Our system just loaded..."
INSTEAD use:
- "By the way, one thing that really stands out is..."
- "That actually connects to something important I'm seeing..."
- "A lot of businesses in your position are also leaning on..."
- "Now here's where it gets interesting..."

### Contradiction Repair
If later data weakens an earlier claim, DO NOT hard-correct.
INSTEAD soften:
- "That may actually be less of the bottleneck than I first thought"
- "What seems more relevant here is..."
- "The bigger opportunity might actually be..."
NEVER admit system error or say "I was wrong about that."

### Thresholded Synthesis
Don't generate compound insights (cross-source) until:
- 2+ corroborating sources, OR
- 1 high-confidence source + 1 user-confirmed statement

Example: Don't say "your ads send traffic to a page with no chat widget" 
until you have BOTH the ads data (from Apify) AND the landing page analysis 
(from Firecrawl or fast-intel tech_stack).

### Per-Wave Synthesis Policy
- T+10s fast-intel: Enough for WOW stalls 2-5 with provisional framing
- T+20s Wave A: Personalise social proof, reviews, hiring/growth
- T+40s Wave B: High commercial weight — eligible to reorder queue (ads data)
- T+55s Wave C: Lower interruption value unless confirms urgency or expansion

### What buildStageDirective Should Evolve Into (Chunk 2+)
Currently: static script generator picking from available data
Future: policy-constrained orchestrator
- Fixed stage objective (what this stage MUST achieve)
- Dynamic signal scoring (which insights are highest value RIGHT NOW)
- Strict interruption thresholds (almost never interrupt)
- Thresholded synthesis (don't combine until confident)
- Natural language repair rules (soften, don't correct)

This preserves the sales structure while making Bella feel like she 
continuously gets smarter, not randomly changes topics.

### WOW Stall Data Readiness Map — DATA ARRIVES DURING STALLS
```
stall 1 (~T+65s): fast-intel ✅ → Free trial pitch (scripted)
stall 2 (~T+70s): fast-intel ✅ → ICP insight from consultant
stall 3 (~T+75s): fast-intel ✅ + Wave A LANDING → reviews, SERP, Seek
                   NEW DATA INCORPORATED: Google Maps reviews, business news
stall 4 (~T+80s): + Wave A ✅ → ICP + problems backed by review evidence
stall 5 (~T+85s): + Wave B LANDING → Facebook ads, Google Ads data
                   NEW DATA INCORPORATED: ad copy, landing URLs, ad spend signals
stall 6 (~T+90s): + Wave B ✅ → Confirmation with ads/social proof ammunition
stall 7 (~T+95s): + Wave C LANDING → Indeed jobs, Instagram posts
                   NEW DATA INCORPORATED: hiring signals, social content
stall 8 (~T+100s): ALL WAVES COMPLETE → Bridge to ACV with FULL intel

EACH STALL = loadMergedIntel() reads ALL current KV data
EACH STALL = buildStageDirective() uses whatever is available NOW
EACH STALL = Bella sounds SMARTER than the previous turn

By stall 8, Bella has EVERYTHING. Channel stages have FULL intel.
```

---

## MODULAR SCRIPT ARCHITECTURE — Data Segments × Agent Scenarios

### The Problem With Current Approach
buildStageDirective() is a monolithic switch statement. Each WOW stall has 
hardcoded logic picking from available data. When new data sources arrive, 
we have to manually wire them into specific stalls. It's brittle and doesn't 
scale with the enrichment pipeline.

### The Solution: Partial Script Segments
Each DATA SOURCE produces one or more SCRIPT SEGMENTS — small, self-contained 
conversation snippets tied to a specific agent and commercial wedge. The 
directive assembler picks the best combination for the current stage.

### Script Segment Schema
```
{
  id: "fb_ads_no_landing_agent",
  source: "facebook_ads + landing_page_firecrawl",
  requires: ["fb_ads_sample.length > 0", "landing_page.has_chat === false"],
  agent: "Chris",
  stage_fit: ["wow", "ch_website"],
  priority: 9,                    // commercial impact
  confidence: 8,                  // how reliable is this data
  type: "wedge",                  // wedge | insight | proof | question | transition
  spoken: false,                  // has Bella already said this?
  
  // The actual script variations
  wow_version: "I can see you're running a Facebook ad offering {fb_ad_headline} 
    that sends traffic to {landing_url} — but there's no one there to engage 
    visitors live. That's traffic you're paying for that bounces without a 
    conversation.",
  
  channel_version: "Now {fn}, your Facebook ad is sending traffic to {landing_url}. 
    Chris would sit on that page and engage every single visitor the moment they 
    land — no more paying for clicks that bounce.",
  
  roi_version: "Remember that Facebook ad sending traffic to {landing_url}? 
    Chris would convert {uplift}% more of those clicks.",
    
  follow_up_question: "How many clicks are you getting on that Facebook ad 
    each week?"
}
```

### Data Segment → Script Segment Mappings

#### FROM FACEBOOK ADS DATA

| Data Condition | Agent | Segment Type | Script |
|---|---|---|---|
| fb_ads running + no chat on landing page | Chris | wedge | "Your Facebook ad offers {offer} and sends traffic to {url} — but there's no one engaging visitors live. Every click that bounces is wasted spend." |
| fb_ads running + form-only landing | Alex | wedge | "Your Facebook ad drives traffic to a form — when someone fills it out, how fast are they getting a response? Alex follows up in under 60 seconds." |
| fb_ads running + multiple campaigns | Chris+Alex | insight | "You're running {count} Facebook campaigns — that's serious investment. Chris engages on every landing page, Alex follows up every lead that doesn't convert on the spot." |
| fb_ads running + offer language detected | Chris | proof | "Your ad is pushing {offer_text} — Chris can open with that exact offer the moment a visitor lands." |
| fb_ads CTA = "Call Now" | Maddie | wedge | "Your Facebook ad has a Call Now button — when those calls come in after hours or when lines are busy, where do they go? Maddie catches every one." |
| fb_ads long duration (6+ months) | Sarah | insight | "You've been running Facebook ads for {duration} — that's potentially thousands of leads that came through but didn't convert. Sarah works the ones that went cold." |

#### FROM GOOGLE ADS TRANSPARENCY DATA

| Data Condition | Agent | Segment Type | Script |
|---|---|---|---|
| google_ads active + landing URL | Chris | wedge | "I can see {count} Google Ads running right now sending traffic to {url}. Those clicks cost money — Chris makes sure every visitor gets engaged." |
| google_ads active + text ad headlines | Alex | wedge | "Your Google Ad says '{headline}' — when someone clicks and fills out the form, Alex follows up in under 60 seconds while they're still hot." |
| google_ads multiple formats | Chris | insight | "You're running text, display, and video ads on Google — that's a multi-channel investment. Chris covers every landing page across all campaigns." |
| google_ads + fb_ads both active | Chris+Alex | compound | "You're investing in BOTH Google and Facebook ads — that's serious acquisition spend. Chris and Alex together make sure every click converts." |

#### FROM GOOGLE MAPS / REVIEWS DATA

| Data Condition | Agent | Segment Type | Script |
|---|---|---|---|
| rating 4.5+ but reviews stale (3+ months) | James | wedge | "{rating} stars from {count} reviews is strong — but your last review was {months} months ago. James keeps that momentum going automatically." |
| rating < 4.0 | James | wedge | "{rating} stars puts you below the trust threshold for most buyers. James can turn that around by getting your happy clients to post." |
| unanswered negative review | James | wedge | "I noticed a {stars}-star review that hasn't been responded to. James responds to every review within minutes." |
| reviews mention phone/wait/response | Maddie | proof | "One of your reviews mentions {issue_quote} — Maddie makes sure that never happens." |
| reviews praise speed/service | Maddie | proof | "Your reviews praise fast service — Maddie keeps that standard going 24/7." |
| high review count (100+) | Sarah | insight | "{count} reviews means hundreds of past customers. Sarah can reactivate them for repeat business." |
| opening hours listed + after hours gap | Maddie | wedge | "You close at {time} — who's answering calls after that? Maddie never closes." |
| phone number prominent | Maddie | insight | "Phone is clearly your primary channel — missed calls hit hard. Maddie answers in 2 rings." |

#### FROM HIRING DATA (Indeed / Seek / Careers Page)

| Data Condition | Agent | Segment Type | Script |
|---|---|---|---|
| hiring sales roles | Alex | wedge | "You're hiring {count} sales roles — you know follow-up matters but can't scale it. Alex handles that instantly." |
| hiring support/reception | Maddie | wedge | "You're hiring for reception — Maddie handles overflow immediately while you find the right person." |
| hiring marketing roles | Chris+Alex | insight | "Hiring marketing people tells me you're investing in traffic. Chris and Alex make sure that traffic converts." |
| many open roles (5+) | Sarah | insight | "You're growing fast with {count} open roles — that means a big database of past leads. Sarah reactivates them." |
| tech stack in job descriptions | Chris | proof | "I can see you use {CRM} — Chris integrates directly and books into your existing calendar." |

#### FROM SOCIAL MEDIA DATA (Instagram / Facebook Posts)

| Data Condition | Agent | Segment Type | Script |
|---|---|---|---|
| posting frequently (3+/week) | Chris+Alex | wedge | "You're posting {freq} times a week — that's driving real engagement. But when followers click through, who's engaging them?" |
| high engagement recent post | all | wow_material | "I saw your latest post about {topic} got great engagement — your audience clearly responds to that." |
| promo/offer in recent posts | Alex | wedge | "Your latest post is pushing {offer} — are people who engage with that getting followed up?" |
| posting but low engagement | James | insight | "You're posting regularly but engagement is low — stronger reviews would build the social proof that drives engagement." |
| social longevity (years active) | Sarah | wedge | "You've been active on social for {years} years — thousands of people have engaged. Sarah wakes up the ones who didn't convert." |
| cross-posting ads as organic | Alex | proof | "Your organic posts mirror your ad messaging — that's smart. Alex catches intent from both channels." |

#### FROM WEBSITE / FIRECRAWL DATA

| Data Condition | Agent | Segment Type | Script |
|---|---|---|---|
| no chat widget | Chris | wedge | "Every visitor leaves without a conversation. Chris engages them the moment they land." |
| form-only conversion | Chris+Alex | wedge | "Your main conversion path is a contact form — Chris starts conversations, Alex follows up the fills." |
| no booking widget | Chris | wedge | "No way for visitors to book instantly — Chris handles that in conversation." |
| phone prominent on site | Maddie | insight | "Phone is front and centre on your site — missed calls cost you." |
| multiple locations detected | Maddie | wedge | "With {count} locations, missed calls multiply. Maddie covers all of them." |
| email capture / lead magnet | Sarah | insight | "You've been collecting emails for years — Sarah reactivates that entire database." |
| blog/content active | Chris | insight | "Your blog is driving organic traffic — Chris converts those readers into conversations." |
| testimonials page exists | James+Chris | proof | "You've got great testimonials — James gets those onto Google where 72% of buyers check first." |

#### FROM LANDING PAGE ANALYSIS (DIY Firecrawl of ad destinations)

| Data Condition | Agent | Segment Type | Script |
|---|---|---|---|
| landing page has no chat | Chris | wedge | "Your ad sends traffic to {url} which has no live agent — Chris sits right there." |
| landing page has long form (7+ fields) | Alex | wedge | "That landing page has a {count}-field form — most won't fill it out. Alex follows up the ones who start but don't finish." |
| landing page hero doesn't match ad copy | Chris | insight | "Your ad says '{ad_headline}' but the landing page leads with '{page_hero}' — that disconnect loses visitors. Chris bridges the gap." |
| landing page has booking widget | Chris | proof | "You've already got booking on the landing page — Chris qualifies visitors and pushes them to book." |
| landing page has no trust signals | James | insight | "Your landing page has no reviews or testimonials visible — James builds that social proof." |

#### COMPOUND SEGMENTS (cross-source synthesis — require 2+ sources)

| Data Condition | Agents | Script |
|---|---|---|
| fb_ads + landing page no chat + website no chat | Chris+Alex | "Your Facebook ad sends traffic to {url} which has no live agent, and your main site doesn't have one either. Every click and every organic visitor leaves without a conversation. Chris covers both." |
| ads active + slow follow-up evidence (form only, no chat, no booking) | Alex | "You're spending on ads but your follow-up path is a contact form with no instant response — that's a 391% conversion gap. Alex closes it in under 60 seconds." |
| good reviews + poor landing page trust | James+Chris | "Your customers love you — {rating} stars. But your landing page doesn't show that proof. James builds review momentum, Chris surfaces it to visitors." |
| hiring sales + ads running + stale database | Sarah+Alex | "You're hiring sales, running ads, and you've been at this for years — that's thousands of leads that went cold. Sarah reactivates them while your new hires focus on fresh pipeline." |
| social active + ads active + no site engagement | Chris | "You're posting regularly AND running ads — serious traffic investment. But when people land on your site, there's nobody home. Chris fixes that." |
| multiple locations + reviews mention phone issues + no after-hours coverage | Maddie | "With {count} locations, reviewers mentioning phone issues, and no after-hours coverage — every missed call across every branch is a lost customer. Maddie covers all of them 24/7." |
| high review count + stale reviews + active social | James | "You've got {count} reviews proving customers love you, but momentum has stalled while your social media is thriving. James turns that social energy into review momentum." |

---

### HOW THE DIRECTIVE ASSEMBLER WORKS

```
buildStageDirective(stage, stall, intel, inputs):

1. GENERATE all eligible script segments from available data
   - Check each segment's `requires` conditions against current intel
   - Score each: priority × confidence × stage_fit
   - Mark segments already spoken as unavailable

2. FOR WOW STALLS:
   - stall 1: Fixed (free trial pitch)
   - stall 2: Pick highest-scored segment with stage_fit=["wow"]
   - stall 3: Pick next highest unspoken segment
   - stall 4-5: ICP/solutions (existing logic, enhanced with new data)
   - stall 6-7: Pick from remaining high-value segments
   - stall 8: Bridge to ACV using best remaining commercial signal
   
   GUARD: If no segments available for a stall (data hasn't arrived),
   ask a discovery question that earns information AND buys time.

3. FOR CHANNEL STAGES (ch_website, ch_ads, ch_phone):
   - Pull ALL segments matching this agent
   - Lead with highest-priority wedge
   - Use proof segments as supporting evidence
   - Use compound segments for maximum impact
   - Weave into discovery questions + ROI calculation

4. FOR ROI_DELIVERY:
   - Pull roi_version from each spoken segment
   - Assemble into narrative summary with per-agent $ values

5. FOR CLOSE:
   - Use strongest compound segment as final hook
   - Connect to free trial offer
```

### SEGMENT LIFECYCLE
```
1. CREATED: When data source lands and conditions are met
2. AVAILABLE: Eligible for use in directives
3. SPOKEN: Used in a turn — marked so it's not repeated
4. REFERENCED: Called back in roi_delivery or close
5. SUPERSEDED: Later data made this segment weaker (contradiction repair)
```

### WHY THIS IS BETTER THAN CURRENT APPROACH
- **Modular**: New data sources automatically produce new segments without 
  rewriting buildStageDirective
- **Priority-driven**: Best insights surface first regardless of source
- **No repetition**: Spoken segments are tracked and excluded
- **Cross-source**: Compound segments only fire when multiple sources confirm
- **Progressive**: As data waves arrive, new segments become available
- **Testable**: Each segment can be tested independently
- **Scalable**: Adding 5 new data sources means adding 5 new segment maps, 
  not rewriting 500 lines of switch statements


---

## APIFY QUOTA MANAGEMENT — HARD RULES

### The Constraint
Free plan: 8,192MB concurrent memory cap.
Memory is CONCURRENT — once actors finish and release, memory frees up.
Apify takes ~5 seconds to deallocate after a run completes.
Apify API: GET /v2/users/me/limits returns account limits.
Apify API: GET /v2/acts/{actorId}/runs?status=RUNNING shows current memory in use.

### HARD RULE: Never fire actors that would exceed 8,192MB concurrent

Before EVERY actor fire, the pipeline MUST:
1. Calculate total memory of actors about to fire
2. If total > 8,192MB, split into waves with 5s delay between
3. If a single actor needs > 8,192MB alone, it cannot run (shouldn't happen)

### ACTOR PRIORITY TABLE (what to run, in what order)

| Priority | Actor | Memory | Why |
|----------|-------|--------|-----|
| 1 (CRITICAL) | google_maps | 1024MB | Reviews, rating, hours = James + Maddie pitch |
| 2 (CRITICAL) | facebook_ads | 1024MB | Ad copy, CTA, landing URLs = Chris + Alex pitch |
| 3 (CRITICAL) | google_ads_transparency | 4096MB | Ad headlines, landing pages = Chris + Alex pitch |
| 4 (HIGH) | google_search | 1024MB | News, awards, SERP discovery |
| 5 (MEDIUM) | indeed | 4096MB | Hiring signals = Sarah + growth |
| 6 (MEDIUM) | seek_jobs | 256MB | AU hiring signals |
| 7 (MEDIUM) | instagram | 1024MB | Social posts, engagement |
| 8 (LOW) | linkedin | 512MB | Company data (when free actor available) |

### SMART WAVE SCHEDULING

The pipeline checks available memory budget (8192MB) and packs actors 
greedily by priority until the budget is full, then starts a new wave.

```
ALGORITHM:
budget = 8192
current_wave = []
waves = []

for actor in sorted_by_priority:
    if actor.memory <= budget:
        current_wave.push(actor)
        budget -= actor.memory
    else:
        waves.push(current_wave)
        current_wave = [actor]
        budget = 8192 - actor.memory

waves.push(current_wave)

// Execute waves sequentially with 5s delay between each
for wave in waves:
    fire_all(wave)
    poll_until_complete(wave)
    await sleep(5000)  // let Apify deallocate
```

### WITH CURRENT ACTORS, THIS PRODUCES:

Wave 1 (priority 1-4, 7168MB):
  google_maps(1024) + facebook_ads(1024) + google_ads_transparency(4096) + google_search(1024)
  = 7168MB ✅

Wave 2 (priority 5-6, 4352MB):
  indeed(4096) + seek_jobs(256)
  = 4352MB ✅

Wave 3 (priority 7-8, 1536MB):
  instagram(1024) + linkedin(512)
  = 1536MB ✅

### CONDITIONAL DROPPING — If signals say we don't need an actor, skip it

| Signal | Skip Actor | Reason |
|--------|-----------|--------|
| No social channels detected on site | instagram | Nothing to scrape |
| linkedin trial expired | linkedin | Will fail anyway |
| Not AU business | seek_jobs | AU-only scraper |
| No ad pixels detected on site | google_ads_transparency | Less likely to find ads |
| fast-intel already found rich ads data | google_ads_transparency | Already have what we need |

When actors are skipped, remaining actors may all fit in fewer waves.
Example: Non-AU business, no social → skip seek, instagram, linkedin
= google_maps(1024) + facebook_ads(1024) + google_ads_transparency(4096) + google_search(1024) + indeed(4096)
= 11,264MB → needs 2 waves

### DEFERRED SCRAPING — Run lower priority actors AFTER quota resets

If the first lead's actors are still running when a second lead arrives:
- The second lead's actors compete for the SAME 8GB cap
- Solution: Queue the second lead's scraping, fire after first lead's actors finish
- The workflow already handles this — each lead has its own workflow instance
- Apify deallocation happens naturally between leads

### IMPLEMENTATION IN CODE

```typescript
interface ApifyActor {
  key: string;
  actor: string;
  payload: any;
  memory: number;  // MB
  priority: number;  // 1 = highest
  condition?: (intel: any) => boolean;  // skip if returns false
}

function buildWaves(actors: ApifyActor[]): ApifyActor[][] {
  const eligible = actors
    .filter(a => !a.condition || a.condition(intel))
    .sort((a, b) => a.priority - b.priority);
  
  const waves: ApifyActor[][] = [];
  let budget = 8192;
  let wave: ApifyActor[] = [];
  
  for (const actor of eligible) {
    if (actor.memory <= budget) {
      wave.push(actor);
      budget -= actor.memory;
    } else {
      if (wave.length) waves.push(wave);
      wave = [actor];
      budget = 8192 - actor.memory;
    }
  }
  if (wave.length) waves.push(wave);
  return waves;
}

// Execute
for (const wave of waves) {
  const runs = await fireAll(wave, apifyToken);
  await pollUntilComplete(runs);
  await sleep(5000); // deallocation buffer
}
```

### MONITORING
Before each wave, optionally check current usage:
GET https://api.apify.com/v2/users/me/limits?token={tk}
This returns current memory usage so we can dynamically adjust if other
runs from previous leads are still consuming memory.


---

## HIRING SIGNAL SCRIPT SEGMENTS — THE ULTIMATE WEDGE

When a prospect is hiring for a role our agents replace, this is the STRONGEST 
possible sales signal. They're literally paying $60-80K to solve a problem our 
agents solve instantly for pennies.

### New Script Segments from Hiring Data

| Data Condition | Agent | Type | Script |
|---|---|---|---|
| Hiring receptionist/admin/front desk | Maddie | wedge | "You're hiring a receptionist right now — Maddie covers you TODAY while you find the right person. And she never calls in sick." |
| Hiring SDR/BDR/sales development | Alex | wedge | "You're hiring an SDR — lead follow-up is clearly a priority for you. Alex does that job in under 60 seconds, 24/7, fraction of the cost." |
| Hiring customer service/support | Chris+Maddie | wedge | "You're hiring customer support — Chris handles website enquiries, Maddie handles calls. Together they cover what 3 support hires would do." |
| Hiring marketing/digital marketing | Chris+Alex | wedge | "You're hiring in marketing — more traffic coming. Chris and Alex make sure every visitor and lead that traffic generates converts." |
| Hiring sales/account exec/closer | Alex+Sarah | wedge | "You're scaling sales — Alex handles top of funnel instantly so your new hires focus on closing. Sarah fills their pipeline from day one with dormant leads." |
| Hiring social media manager | Alex+James | wedge | "Hiring for social — more traffic and engagement coming. Alex follows up every social lead, James turns engagement into reviews." |
| Hiring office manager/operations | Maddie | wedge | "Hiring an office manager — Maddie handles all phone traffic so your new hire focuses on ops, not answering calls." |
| Multiple roles (3+) simultaneously | All | compound | "You're hiring {count} roles right now — you're in serious growth mode. Our agents can handle {specific roles} immediately while your new team ramps up." |
| Hiring + ads running | Chris+Alex | compound | "You're hiring sales people AND running ads — you know traffic and follow-up matter. Chris and Alex do both instantly while your new hires get up to speed." |
| Hiring + high review count | Maddie+James | compound | "You're hiring support AND you've got {count} reviews to manage — Maddie handles overflow calls, James handles every review. Your new hire walks into a clean operation." |

### ROI Framing Against Hiring Cost
When hiring data includes salary:
"That {role} you're hiring costs {salary} a year plus super plus training plus ramp-up time. {Agent} delivers the same outcome starting today for a fraction of that — and the free trial is zero risk."

When no salary but role detected:
"A {role} typically costs $60-80K plus on-costs. {Agent} does the same job 24/7 for pennies per interaction. And it starts in 10 minutes, not 3 months."

### Priority: HIGHEST when detected
Hiring signals that map to our agents should be priority 1 in the script segment 
scoring. Nothing is more commercially powerful than "you're literally about to 
pay $70K to solve this problem and we solve it for pennies."
