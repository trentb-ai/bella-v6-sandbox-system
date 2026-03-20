# DATA ENRICHMENT IMPLEMENTATION BRIEF — CC

## Status: GO-LIVE BLOCKER
## Date: 18 Mar 2026

## ARCHITECTURE: TIERED CONDITIONAL ENRICHMENT

Don't scrape everything on every lead. Use tiers:

### CORE (every lead, pennies):
- Website Firecrawl (HAVE)
- Google SERP discovery (HAVE — rename google_ads → google_search)
- Google Maps reviews (HAVE)

### CONDITIONAL (fire when signals detected):
- Facebook Ad Library (HAVE — fix rich data passthrough)
- Google Ads Transparency — lexis-solutions/google-ads-scraper (ADD)
- Instagram posts (ADD — when IG link detected on site)
- Seek.com.au jobs (ADD — for AU businesses, keep Indeed for global)

### DIY FREE (Firecrawl URLs we discover):
- Ad landing pages — Firecrawl destination URLs from ads data
- Company careers page — Firecrawl /careers or /jobs from the site
- Testimonials/case studies pages — found via SERP or site nav
- Contact page + booking path — Firecrawl to check conversion friction
- Press/newsroom pages — found via SERP
- Social media profiles — Firecrawl public Facebook/Instagram/LinkedIn pages

### KEEP (do NOT remove):
- Indeed scraper — KEEP, expand to global (remove country: "AU" restriction)
- Google search scraper — KEEP but RENAME from google_ads to google_search
- ALL existing scrapers stay. We are ADDING, not replacing.

---

## IMMEDIATE FIXES (before go-live)

### Fix 1: Rich data passthrough in write-deep-flags.ts

PROBLEM: extract-deep.ts captures rich data (fb_ads_sample with bodyText/CTA, 
reviews_sample with text/stars, jobs_sample with titles/salary, linkedin data)
but write-deep-flags.ts only writes raw_json which flattens to counts.

FIX: write-deep-flags.ts must write ALL of extract-deep's output to KV, not just raw_json.
Change the value from `results.step_transform_13.raw_json` to 
`JSON.stringify(results.step_transform_13)` — write the FULL extraction result.

### Fix 2: Rename google_ads → google_search
EVERYWHERE: fire-apify.ts, fire-apify-handler.ts, extract-deep.ts, 
poll-apify-deep.ts, build-intel.ts, types.ts.
The key "google_ads" → "google_search". The actor stays the same 
(apify~google-search-scraper). It's a naming fix only.

### Fix 3: Add lexis-solutions/google-ads-scraper
Add as NEW actor key: "google_ads_transparency" in fire-apify.ts and 
fire-apify-handler.ts. Search by business name. maxAds: 5.
Extract: ad headlines, descriptions, landing page URLs, date ranges, ad formats.
Add to extract-deep.ts: parse the results into structured fields.

### Fix 4: Add Seek.com.au scraper
Research cheapest Apify actor for seek.com.au. Add as NEW actor key: "seek_jobs".
Runs in parallel with existing actors. AU businesses only for now.

### Fix 5: Expand Indeed to global
In fire-apify.ts and fire-apify-handler.ts, remove country: "AU" from Indeed config.
Use the business location from core_identity to set the correct country code.

---

## PHASE 2: DIY FIRECRAWL ENRICHMENT (after immediate fixes)

### Ad Landing Page Firecrawl
TRIGGER: When fb_ads_sample or google_ads_transparency returns landing page URLs
ACTION: Firecrawl each unique landing page URL (max 3)
EXTRACT: CTAs, form fields, chat widgets, booking tools, hero text, trust signals
FEED TO: Consultant for Chris pitch — "Your ad sends traffic to X which has no live agent"

### Social Media Profile Firecrawl  
TRIGGER: When tech_stack.social_channels contains Facebook/Instagram/LinkedIn URLs
ACTION: Firecrawl the public business profile page
EXTRACT: Latest 3-5 posts text, posting frequency, engagement patterns, content themes
FEED TO: Consultant for WOW material and Alex/Sarah pitches

### Company Careers Page Firecrawl
TRIGGER: When SERP results or site nav contains /careers, /jobs, /work-with-us
ACTION: Firecrawl the careers page
EXTRACT: Job titles, departments hiring, growth signals, tech stack mentions
FEED TO: Consultant for Sarah pitch — "You're hiring 3 roles, growing fast = dormant database goldmine"

### Testimonials/Case Studies Firecrawl
TRIGGER: When SERP results or site nav contains /testimonials, /case-studies, /clients
ACTION: Firecrawl the page
EXTRACT: Client names, industry verticals, social proof language, results claims
FEED TO: Consultant for ICP refinement and WOW material

### Contact/Booking Path Firecrawl
TRIGGER: Always (every business has a contact page)
ACTION: Firecrawl /contact or primary CTA destination
EXTRACT: Form length, phone prominence, booking widget, chat widget, response promise
FEED TO: Consultant for Maddie/Chris pitch — conversion friction analysis

---

## CONSULTANT UPGRADE (after data pipeline fixed)

The consultant prompt must be upgraded to:
1. RECEIVE all new data fields (ads detail, social posts, landing page analysis)
2. PRODUCE agent-specific commercial wedges, NOT generic marketing observations
3. CROSS-REFERENCE sources — combine ads + landing pages + reviews into compound insights
4. OUTPUT new fields:
   - agentWedges: { Chris: "evidence + pitch", Alex: "evidence + pitch", ... }
   - wowInsights: [ { source: "facebook_ads + landing_page", insight: "...", agentTieIn: "Chris" } ]
   - conversionFriction: { score: 1-10, issues: [...], agentFix: "Chris/Alex/Maddie" }

---

## BRIDGE UPGRADE (after consultant upgraded)

loadMergedIntel() must surface all new data to buildStageDirective():
- deep.ads.facebook: { count, sample: [{ text, cta, landingUrl }] }
- deep.ads.google: { count, sample: [{ headline, description, landingUrl }] }
- deep.social.recentPosts: [{ platform, text, date, engagement }]
- deep.social.postingFrequency: "daily/weekly/monthly/inactive"
- deep.landingPages: [{ url, hasChatWidget, hasBooking, heroText, ctas }]
- deep.careers: { isHiring, jobCount, roles: [...] }

buildStageDirective() WOW stalls should use consultant's wowInsights 
and agentWedges to deliver killer personalised insights.

---

## COST MODEL

Target: SINGLE DIGIT CENTS per lead TOTAL.

Per-source estimated costs:
- Firecrawl website: ~$0.001 (already paying)
- Firecrawl discovered URLs (3-5 extra): ~$0.003-0.005 (already paying)
- Google SERP: ~$0.001
- Google Maps: ~$0.004
- Facebook Ad Library: ~$0.005 (when ads exist)
- Google Ads Transparency: ~$0.005-0.01 (when ads exist) 
- Indeed: ~$0.003
- Seek: ~$0.003 (AU only)
- Instagram: ~$0.001-0.002 (when IG active)
- Gemini consultant: ~$0.001-0.002

ESTIMATED TOTAL: ~$0.02-0.04 per lead (2-4 cents)
With conditional firing (not all sources on every lead): ~$0.01-0.03

---

## WORKING RULES

1. ALL existing scrapers STAY. We ADD, never remove.
2. Indeed stays. Seek is ADDED for AU.
3. google_ads is RENAMED to google_search. New actor google_ads_transparency is ADDED.
4. Conditional actors only fire when signals warrant (ads detected, social active, etc.)
5. DIY Firecrawl of discovered URLs is FREE and highest ROI — prioritise this.
6. LinkedIn scraping AVOIDED as default (too expensive). Use public page Firecrawl only.
7. Every data point must map to a specific agent pitch. No data for data's sake.
8. Consultant produces COMMERCIAL WEDGES, not data reports.
