# SCORING FIX — Review before giving to CC

Before Step 3, rewrite scoring logic in buildQueueV2().

## The agents — GET THIS RIGHT

- Chris: AI voice agent on the WEBSITE and LANDING PAGES. First contact. Engages visitors the moment they land. Converts them live on the page.
- Alex: Speed-to-lead FOLLOW-UP. Leads that Chris didn't close — form fills, bounced visitors, enquiries — Alex follows up in under 60 seconds. Speed-to-lead is Alex's strategy.
- Maddie: AI receptionist. Missed calls, after-hours, overflow.
- Sarah: Database reactivation. Old leads.
- James: Reputation/reviews. Automated review collection.

## CRITICAL: Data is a starting signal, NOT the full picture

Scraped data tells us what we CAN see. It does NOT tell us what's actually happening.
- No ad pixels detected does NOT mean they're not running ads (could be off-platform, could be poorly tagged)
- No phone number visible does NOT mean they don't get calls
- Missing data = Bella needs to ASK AND CONFIRM, not assume

The queue builder picks the MOST LIKELY top 2 based on available signals. But Bella's scripting must CONFIRM before recommending. The WOW and discovery stages already handle this — Bella asks about their lead sources, their inbound channels, their phone situation. Her questions validate or change the path.

## The logic is SIMPLE BRANCHING based on what we detect

### Scenario 1: Ads detected / inbound lead funnel visible
- Slot 1: Chris (on the landing pages where ad traffic arrives — first contact)
- Slot 2: Alex (speed-to-lead follow-up on leads Chris didn't close)
- Tease: Maddie (unless 24/7 phone coverage indicated)

### Scenario 2: No ads detected, no visible inbound funnel
- Slot 1: Chris (everyone needs an AI agent on their site)
- Slot 2: Depends on CTA type from consultant analysis:
  - Phone-dominant CTA ("call now", phone number prominent) → Maddie
  - Form/booking CTA ("submit form", "book online", lead magnet) → Alex (follow up submissions)
- Tease: Whichever of Maddie/Alex didn't get slot 2

BUT — Bella must CONFIRM during WOW/discovery:
- "It looks like you're not running any ads at the moment — is that right?"
- If they say "actually we run Facebook ads" or "we get leads from social media posts" → Bella pivots to Scenario 1 (Chris + Alex)
- "Where are most of your new enquiries coming from right now?"
- Their answer may completely change which agents are most relevant

### After top 2 channels are done:
- Bella teases 3rd agent, offers to crunch those numbers too
- Sarah quick mention: Bella asks "how many old leads from this year?" → ACV x count x 5% reactivation rate → tells prospect the value
- James quick calc: Current reviews + 1-star uplift = 9% revenue increase → tells prospect the value
- Sarah and James are NOT full channel stages — quick value drops during or after roi_delivery

## Implementation

This is NOT a weighted scoring algorithm. It's simple branching:

```
if (ads_or_inbound_detected) {
  queue = ["ch_website", "ch_ads"]  // Chris first, Alex second
  tease = has_24_7_phone ? "ch_old_leads" : "ch_phone"  // Maddie unless exempt
} else {
  queue = ["ch_website"]  // Chris always first
  if (phone_dominant_cta) {
    queue.push("ch_phone")   // Maddie second
    tease = "ch_ads"         // Alex tease
  } else {
    queue.push("ch_ads")     // Alex second (follow up form submissions)
    tease = "ch_phone"       // Maddie tease
  }
}
// roi_delivery and close always appended after channels
```

Consultant routing.priority_agents can ADJUST within this framework (swap slot 1 and 2 if consultant has strong reason) but the framework itself is deterministic.

## What changes in buildQueueV2()

Replace the entire scoring system with this branching logic. The function should:
1. Check ads_or_inbound_detected (any ad pixel, is_running_ads, social traffic, email marketing)
2. Check phone_dominant_cta (from consultant conversionEventAnalysis.ctaType or phone prominent on site)
3. Check has_24_7_phone (from deep data or flags)
4. Return queue + tease based on the branching above
5. Log the decision path clearly

## IMPORTANT: This is the INITIAL queue only

The queue is Bella's starting plan based on scraped data. During the call, Bella's WOW and discovery questions may reveal new information that changes which agents are most relevant. That dynamic re-ranking based on conversation signals is a Chunk 2 enhancement. For now, the initial queue just needs to be sensible based on available data.
