# Perplexity Research — Data Enrichment for AI Sales Intelligence Platform

## Context

We're building an AI sales intelligence platform. A voice AI agent (Bella) analyses a prospect's business from multiple data sources before conducting a live personalised sales conversation. The richer and more creative the intelligence, the more Bella sounds like she's spent hours researching the business — and the better she sells.

We currently scrape: website content (Firecrawl), Google Maps reviews, Facebook Ad Library, Indeed jobs, LinkedIn company data, and Google search results. We use Apify for scraping and Firecrawl for website content. We also have the ability to Firecrawl ANY URL we discover during the pipeline (landing pages, social profiles, etc).

We target businesses GLOBALLY. Budget: PENNIES per lead at scale.

## The Big Question

What are the most creative and effective AI sales intelligence platforms, scrapers, and data enrichment tools doing to build comprehensive prospect intelligence? We want to know what's possible, what's being done by the best, and how to do it cheaply at scale.

## Specific Data Sources We Want to Explore

For EACH of the following, tell us:
- **Option A**: Best/cheapest Apify actor with pricing
- **Option B**: DIY approach (Firecrawl the URL, direct HTTP fetch, scrape ourselves in a Cloudflare Worker)
- **What the best platforms are extracting** — don't limit to what we ask for, tell us what's POSSIBLE and valuable
- **Recommendation** for a budget startup at scale

### 1. Job Listings (GLOBAL)
We need job data from multiple boards worldwide — Seek (Australia), Indeed (global), LinkedIn Jobs, Glassdoor, and any other relevant platforms. What are the best scrapers doing here? What data beyond job titles and salary is valuable for sales intelligence? (Growth signals, department expansion, technology adoption, budget indicators...)

### 2. Google Ads Transparency Center
We have NO Google Ads scraping. What's the best way to get ad data from adstransparency.google.com? What data is available? Ad headlines, descriptions, landing pages, date ranges, formats — and what else? What are competitor intelligence platforms extracting from here?

### 3. LinkedIn Company Intelligence
Our current scraper's trial expired. What's the cheapest replacement? But more importantly — what LinkedIn data is most valuable for sales intelligence? Employee count, industry, description, follower count — sure, but what about: recent posts, employee growth trends, technology mentions, company updates, key personnel? What are platforms like Apollo, Clay, ZoomInfo extracting from LinkedIn?

### 4. Facebook & Instagram Intelligence
We detect social channels from the website. Currently we only scrape the Facebook Ad Library. What ELSE should we be scraping? Business page posts, Instagram feed, stories highlights, engagement metrics, follower growth, content themes, posting frequency, audience demographics? What are the best social intelligence tools doing here?

### 5. Ad Landing Page Analysis
When we find ads (Facebook or Google), we want to analyse where the traffic goes. We can Firecrawl any URL. What should we be looking for on landing pages? Conversion paths, form fields, chat widgets, offers, CTAs, page speed, trust signals, social proof? What do the best conversion rate optimisation tools analyse?

### 6. Enhanced Facebook/Meta Ads Data
Our current scraper gets body text and CTA type. What else is available from the Facebook Ad Library? Landing page URLs, ad creative analysis, spend estimates, audience targeting, A/B test variations, campaign duration, platform distribution? What's the richest data available and what's the cheapest way to get it?

### 7. What Else Are We Missing?
What OTHER data sources do the best sales intelligence and pre-call research platforms use that we haven't thought of? Consider:
- Company news and press releases
- Patent filings
- Technology stack analysis (BuiltWith, Wappalyzer)
- Domain authority and SEO metrics
- Trustpilot/other review platforms beyond Google
- Company financial data (for publicly listed)
- Social proof signals (case studies, testimonials, awards)
- Website traffic estimates (SimilarWeb-style)
- Email marketing presence (newsletter analysis)
- Podcast appearances
- YouTube channel analysis
- App store presence
- Government contract databases
- Industry awards and certifications

What's ACTUALLY valuable for a live sales conversation (not just data for data's sake) and what's the cheapest way to get it?

## How We Use This Data

This feeds a Gemini consultant that produces sales intelligence, which a voice AI uses in a live 5-minute conversation. The intelligence needs to be:
- **Specific** — cite real data, not generic observations
- **Commercial** — tied to revenue impact, not just interesting facts
- **Conversational** — "I noticed your latest Instagram post got 3x the engagement of your usual posts — looks like your audience really responds to X" is gold
- **Actionable** — leads to recommending specific AI agents that solve specific problems

## Cost & Timing Constraints

- Current pipeline: ~34s for 5 Apify actors in parallel + ~6s Firecrawl
- Need to stay under ~45s total (prospect is on a loading page)
- **COST: PENNIES per lead — single digit cents TOTAL, not per source.** We're scaling to tens of thousands of leads. We need the full pipeline (all sources combined) to cost cents, not dollars. DIY Firecrawl of URLs we discover = essentially free (already paying for Firecrawl). Apify pay-per-result at $0.001-0.005 per result is ideal. If a source costs more than a cent per lead, we need the DIY alternative.
- What's the realistic cost per lead for a comprehensive 8-10 source pipeline at scale?

## What We Want Back

- The most creative and comprehensive data enrichment approaches used by top sales intelligence platforms
- Specific Apify actors with pricing for each data source
- DIY approaches where Firecrawl or direct HTTP can replace paid scrapers
- What data is MOST valuable for a live sales conversation vs what's just noise
- Cost per lead estimates for the full pipeline
- Any data sources we haven't considered that would give us a competitive edge
