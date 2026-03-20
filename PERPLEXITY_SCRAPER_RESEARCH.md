# PERPLEXITY RESEARCH — Bella V9 Scraper Failures & Alternatives

## CONTEXT

We run a data enrichment pipeline for an AI voice sales agent on Cloudflare Workers. We use Apify actors to scrape 7 data sources about Australian businesses. A live test revealed multiple failures. We've already fixed timeouts and retry logic. Now we need to understand WHY each source fails and find better alternatives.

Our stack: Cloudflare Workers (paid), Apify for browser scraping, Firecrawl for website scraping, Australian market only.

---

## ISSUE 1: Facebook Ad Library — Timeouts Even at 120s

We increased our timeout from 60s to 120s with a grace re-poll. But the Apify actor uses ~1GB memory and Playwright to scrape the Facebook Ad Library SPA.

**Questions:**
1. Is the Meta Ad Library API (Graph API `ads_archive` endpoint) available without a verified business account? What are the EXACT access requirements in 2026?
2. Can we call the Meta Ad Library API from a Cloudflare Worker with a simple fetch()? What headers/auth does it need?
3. What data does the Meta Ad Library API return — ad copy text, creative images, landing URLs, spend ranges, active dates?
4. Are there third-party APIs that wrap Facebook Ad Library data (e.g., AdManage, BigSpy, PowerAdSpy, Pipiads) that offer a simple REST API we could call from a Worker?
5. What's the cheapest option for <500 lookups/month that gives us: "is this business running FB ads, what do the ads say, where do they point"?

---

## ISSUE 2: Google Search — Actor Failed to Start

We added retry logic (retry once after 3s on no_id). But we're not confident the actor is reliable long-term.

**Questions:**
1. Compare these SERP APIs for our use case (business name + Australian location → top 10 organic results + knowledge panel + ads): SerpAPI, Serper.dev, ValueSERP, ScaleSerp, SerpStack, BrightData SERP. Which is cheapest at <500 queries/month?
2. Which SERP API returns the richest structured data for local business queries (knowledge panel, Google Business Profile, reviews, People Also Ask)?
3. Do any of these SERP APIs return Google Ads results (paid search) alongside organic results? That would let us detect Google Ads AND get ad copy in one call.
4. What's the typical response time for a SERP API call vs an Apify Google Search scraper?
5. Can any of these be called from a Cloudflare Worker with a simple fetch()? Any that require SDKs or client libraries?

---

## ISSUE 3: Indeed Australia — False Positives

Actor returns page metadata instead of actual job listings. 4GB actor suggesting heavy browser automation.

**Questions:**
1. What is the correct Indeed AU URL pattern for searching jobs by company name? Is it `https://au.indeed.com/cmp/{company-slug}/jobs` or `https://au.indeed.com/jobs?q={company}&l={location}`?
2. Can Indeed AU job count be fetched with a simple HTTP GET from a Worker, or does Indeed require JavaScript rendering?
3. Are there any job listing aggregator APIs that cover Indeed AU data? (e.g., Adzuna API, Jooble API, CareerJet API)
4. For our use case — just "is this business hiring? how many open roles?" — what's the minimum viable approach?
5. Does Indeed have any official API or partner program in Australia?

---

## ISSUE 4: Seek.com.au — Not Implemented Yet

We haven't added Seek to our pipeline. Perplexity previously said this is the easiest DIY replacement (256MB Apify actor = just HTML parse).

**Questions:**
1. What is the exact Seek AU URL for searching jobs by company name? `https://www.seek.com.au/{company-slug}` or `https://www.seek.com.au/jobs?keywords={company}&where={location}`?
2. Can Seek search results be fetched with a bare HTTP GET from a Cloudflare Worker? Does Seek block automated requests?
3. What HTML structure does Seek use for job listings on search results pages? What CSS selectors or data attributes identify job cards, job titles, and total count?
4. Does Seek have an API or partner program?
5. What's a minimal Worker function that fetches Seek and extracts job count + job titles? (pseudocode is fine)

---

## ISSUE 5: LinkedIn Company — All Null

Apify scraper returned nothing for every field.

**Questions:**
1. What's the state of LinkedIn company page scraping in 2026? Has LinkedIn fully locked down public company pages?
2. What are the best LinkedIn company data APIs in 2026? Compare: Apollo.io, Clearbit/HubSpot, People Data Labs, Proxycurl, RocketReach, PhantomBuster. Which works from a simple HTTP fetch?
3. For our use case — just "employee count, industry, company tagline" — what's the cheapest API?
4. Can we get employee count and industry from alternative sources? (e.g., Google Knowledge Panel, Crunchbase, ABN Lookup for Australian businesses)
5. Is the ABN Lookup API (Australian Business Register) useful for getting basic business info like entity type, location, and status?

---

## ISSUE 6: Google Ads Transparency — Only Metadata

Actor returned a link to the Transparency Center but no actual ad copy or destination URLs.

**Questions:**
1. Can SERP APIs (SerpAPI, Serper.dev, etc.) return Google Search ads (paid results) with ad copy and destination URLs? If so, this solves Google Ads detection AND ad copy in one API call.
2. What data does Google Ads Transparency Center actually expose — ad copy, destination URLs, ad formats, date ranges?
3. Is there an official Google Ads Transparency API, or is browser scraping the only option?
4. For Apify specifically — which Google Ads Transparency actor gives the richest output (actual ad copy, not just "is running ads")?
5. Could we use Google Ads API (the actual advertising API) to look up a competitor's ads, or is that restricted to your own account?

---

## ISSUE 7: Ad Landing Pages — New Capability Needed

We just added a step to scrape ad landing pages with Firecrawl. But we need to understand best practices.

**Questions:**
1. When scraping ad landing pages, what specific data points are most valuable for competitive sales intelligence? (offers, CTAs, form fields, pricing, trust signals, urgency tactics)
2. Are there specialized ad landing page analysis tools/APIs? (e.g., SpyFu, SEMrush, SimilarWeb)
3. For Firecrawl scraping of landing pages — should we use `onlyMainContent: true` or `false`? Should we extract structured data or just get markdown?
4. How do we handle landing pages behind redirects (tracking URLs, UTM wrappers, click trackers)?
5. Is there value in screenshotting landing pages for later reference? Any tools that do this from a Worker?

---

## BONUS: Australian Business Data Sources

Since we're exclusively targeting Australian SMBs:

1. What Australian-specific business data APIs exist? (ABN Lookup, ASIC, Yellow Pages API, True Local)
2. Is there an Australian business review aggregator API that combines Google, Facebook, and industry-specific reviews?
3. For Australian trades/services businesses specifically — are there industry directories with APIs? (HiPages, ServiceSeeking, OneFlare, Bark)
4. Does the Australian Government's data.gov.au have any business listing datasets we could use for enrichment?

---

Please provide specific API endpoints, pricing, and code examples where possible. We need solutions that work from a Cloudflare Worker (simple HTTP fetch, no browser, no SDKs).
