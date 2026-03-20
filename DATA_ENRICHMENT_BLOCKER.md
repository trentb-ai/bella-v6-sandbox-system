# DATA ENRICHMENT BLOCKER — Must Fix Before Go-Live

## Status: BLOCKER
## Last Updated: 18 Mar 2026

## THE PROBLEM

Bella can't sell powerfully because she doesn't have the data she needs. Currently:
- Facebook ads are scraped but the rich data (body text, CTA, creative) gets LOST in write-deep-flags
- There is NO Google Ads scraper — what's labelled "google_ads" is actually a Google search for articles/news
- No ad landing page analysis
- No social media post scraping despite detecting 4 social channels
- LinkedIn scraper returns empty for many businesses

## WHAT WE NEED — THE FULL INTELLIGENCE PICTURE

### Tier 1: Fix what's broken (immediate)
1. **Pass rich Facebook ads data through to KV** — extract-deep.ts already captures fb_ads_sample (bodyText, callToActionType) but write-deep-flags flattens to just counts. Fix the pipeline so bridge and consultant get: ad body text, CTA type, number of active ads, ad creative descriptions
2. **Rename google_ads actor** — it's a Google search scraper for news/awards, NOT an ads scraper. Rename to google_search or google_news to avoid confusion
3. **Fix LinkedIn scraper** — returns empty for many businesses. Likely a slug matching issue.

### Tier 2: Add Google Ads Transparency scraping (go-live blocker)
4. **Add proper Google Ads scraper** — Google Ads Transparency Center (https://adstransparency.google.com). Apify has scrapers for this. Need: ad headlines, descriptions, landing page URLs, date ranges, ad format
5. **OR** — if no reliable Apify actor exists, at minimum detect Google Ads presence from fast-intel pixel detection (already done) and have Bella ask about it

### Tier 3: Add ad landing page analysis (major sales enhancement)
6. **Firecrawl the ad landing pages** — when Facebook or Google ads are found with landing page URLs, scrape those pages too. Feed to consultant. "Your Facebook ad sends people to your Contact Us page which has no AI agent on it — every click that doesn't convert is wasted money" is a KILLER Chris pitch

### Tier 4: Social media intelligence (WOW factor)
7. **Scrape latest social media posts** — we already detect social channels (Facebook, Instagram, LinkedIn, YouTube) from the website HTML. Add scrapers for latest 3-5 posts from each platform. This gives Bella incredible WOW material: "I saw your latest Instagram post about X — that's exactly the kind of content that drives engagement"
8. **Social media engagement metrics** — follower counts, post frequency, engagement rates. This feeds the Alex pitch: "You're posting regularly on social media which means you're driving traffic — are those visitors converting?"

## WHAT THE CONSULTANT SHOULD EXAMINE (FULL VISION)

After all enrichment, the consultant receives:
1. Website content (Firecrawl full page — DONE)
2. Tech stack (pixel detection — DONE)
3. Facebook ads (body text, CTA, creatives, landing domains)
4. Google ads (headlines, descriptions, landing pages)
5. Ad landing pages (Firecrawl scrape of where ads send traffic)
6. Google reviews (rating, count, sample text — DONE)
7. Social media latest posts (Facebook, Instagram, LinkedIn)
8. Hiring signals (Indeed jobs — DONE)
9. LinkedIn company data (employees, industry, description)
10. Google search results (news, awards, articles about the business)

THIS is what makes Bella sound like she spent 3 hours researching. Not "you have a website" — but "I can see your latest Facebook ad offers a free consultation and sends traffic to your Contact page which currently has no AI agent. Meanwhile your Google reviews are 5 stars but you're only getting 2-3 new reviews a month..."

## IMPLEMENTATION APPROACH

Research needed (Perplexity):
- Best Apify actors for Google Ads Transparency Center scraping
- Best approach for social media post scraping (Facebook posts, Instagram posts, LinkedIn posts)
- Cost/timing implications of adding 3-4 more Apify actors to the pipeline

Code changes needed (CC):
- write-deep-flags.ts — pass through ALL rich data, not just counts
- fire-apify.ts / fire-apify-handler.ts — add new actors
- extract-deep.ts — extract rich data from new actors
- consultant prompt — teach it to analyse ads, landing pages, social posts
- bridge — ensure loadMergedIntel surfaces the new data

## PRIORITY ORDER

For V1 go-live MINIMUM:
1. Fix Facebook ads data pipeline (rich data, not just counts) — 1 hour
2. Rename google_ads → google_search — 10 minutes
3. Add Google Ads Transparency scraper — research + implement, ~2-4 hours

For V1.1 (first week):
4. Ad landing page Firecrawl — add to pipeline after ads scraped
5. Fix LinkedIn scraper

For V2:
6. Social media post scraping
7. Social engagement metrics
8. Consultant upgrade to analyse all new data sources
