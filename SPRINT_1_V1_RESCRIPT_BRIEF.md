# SPRINT 1 — BELLA V1 RESCRIPT BRIEF
## Complete implementation spec for moves.ts and flow.ts changes
## Filed: 31 March 2026

---

## OVERVIEW

Remove all ROI stages from Bella's flow. Rewrite Recommendation and Close.
New flow: `greeting → wow (8 steps) → recommendation → close`

Stages to REMOVE from flow.ts and moves.ts:
- `anchor_acv`
- `ch_alex`
- `ch_chris`
- `ch_maddie`
- `ch_sarah`
- `ch_james`
- `roi_delivery`
- `optional_side_agents`

Stages to KEEP and REWRITE:
- `recommendation` — rewrite with agent benefit explanations + full lead source + CTA personalisation
- `close` — rewrite as two-path mechanic (free trial vs agent demo)

Stages to KEEP and MODIFY:
- `wow` — WOW step 5 bridge line needs rewriting only
- `greeting` — no changes

---

## CHANGE 1 — WOW STEP 5 BRIDGE LINE (moves.ts)

### Current line:
"Great — that helps confirm your agents are dialled in around the highest-value opportunities. I've just got a few quick questions so I can size which combination would create the most value for {shortBiz}."

### Problem:
References "few quick questions" and "sizing" — both belong to the ROI flow we're removing.

### New line (normal path — steps 3+4 confirmed):
"Great — that helps confirm your agents are dialled in around the right opportunities. Let me put together a recommendation for {shortBiz} based on what I can see."

### New line (rejection recovery path — step 3 or 4 was pushed back on):
"Got it — appreciate the correction, that detail makes the recommendation much sharper. Let me put together the right combination for {shortBiz} based on what you've told me."

### Free trial re-offer append (if trialMentioned is false):
" And by the way, if you'd like to activate a free trial at any point during the demo, just let me know."

### Implementation:
In `buildWowDirective` case `wow_5_alignment_bridge`, replace the speak strings only. Logic unchanged.

---

## CHANGE 2 — RECOMMENDATION STAGE (moves.ts)

### Purpose:
Name the relevant agents. Explain each agent's specific benefit using the prospect's actual lead sources and CTAs. Bridge to the close offer.

### Data available (always reliable, no consultant needed):
- `state.leadSourceDominant` — what prospect said in WOW step 8 (ads / website / phone / organic / referral / other)
- `state.leadSourceSecondary` — second lead source if mentioned
- `state.adsConfirmed` — boolean, prospect explicitly confirmed ads
- `state.websiteRelevant` — boolean
- `state.phoneRelevant` — boolean
- `state.flags.is_running_ads` — deterministic pixel detection
- `state.flags.has_fb_pixel` — Facebook ads detected
- `state.flags.has_google_ads` — Google ads detected
- `state.alexEligible`, `state.chrisEligible`, `state.maddieEligible` — agent eligibility
- `consultant.conversionEventAnalysis.primaryCTA` — their main CTA text
- `consultant.conversionEventAnalysis.ctaType` — booking / form / call / quote / purchase
- `consultant.conversionEventAnalysis.allConversionEvents[]` — all CTAs found
- `consultant.conversionEventAnalysis.ctaAgentMapping` — consultant-written mapping sentence
- `consultant.routing.reasoning[agent]` — consultant reasoning per agent (first sentence)

### Agent benefit lines (LOCKED — use verbatim):

**Alex:**
"Alex responds to every lead within 30 seconds — and the research is clear: businesses that respond within 30 seconds convert up to four times more than those who wait even five minutes. Most leads make a decision in under five minutes, and if you're not first, you're usually not getting that business. Alex makes sure {business} is always first, every time, 24/7."

**Chris:**
"Chris engages every website visitor the moment they land — running a live sales conversation, qualifying their needs, handling objections, and driving them toward {primaryCTA}. Basic chat widgets add around 24% more website conversions — but Chris isn't a chatbot, he's a fully trained {business} sales agent. Nobody has conversion stats on this yet because nobody has actually done it — you'd be the first in your market."

**Maddie:**
"Maddie answers every call that comes in — qualifying the opportunity and booking it straight into your calendar. Every call that goes unanswered is a sale that walks out the door, and Maddie makes sure {business} never misses one."

### Lead source personalisation wrappers:

These wrappers PREFIX each agent line to connect it specifically to their lead source and CTA.
Build from `leadSourceDominant`, `leadSourceSecondary`, `adsConfirmed`, `primaryCTA`, `ctaType`.

**Alex wrapper variants:**
- Ads confirmed: "Every lead clicking your {ads type} ads is making a buying decision right now. {Alex benefit line}"
- Website dominant: "Every enquiry coming through your website is a warm lead. {Alex benefit line}"
- Phone dominant: (Alex still relevant — wrap as) "Even beyond calls, every online enquiry needs instant follow-up. {Alex benefit line}"
- Generic: "Speed to lead is everything. {Alex benefit line}"

Ads type resolution: if `has_fb_pixel` = "Facebook ads", if `has_google_ads` = "Google Ads", if both = "paid ads", if `adsConfirmed` but no pixel data = "your ads".

**Chris wrapper variants:**
- Ads + website: "Your ads are driving traffic to your website — and most of those visitors leave without {primaryCTA}. {Chris benefit line}"
- Website only: "Your website is your main lead channel — and most visitors leave without {primaryCTA}. {Chris benefit line}"
- Ads no website signal: "Every ad click lands on a page — and most visitors leave without converting. {Chris benefit line}"
- Generic: "Most website visitors leave without taking action. {Chris benefit line}"

CTA resolution: use `primaryCTA` text if available, else use ctaType label ("booking" → "booking an appointment", "form" → "filling in your form", "call" → "calling you", "quote" → "requesting a quote"), else "converting".

**Maddie wrapper variants:**
- Phone confirmed by prospect: "You mentioned phone is a major channel — {Maddie benefit line}"
- Phone visible on site (flags): "You've got a phone number right there on your site — {Maddie benefit line}"
- Generic: "{Maddie benefit line}"

### Multi-CTA enhancement:
If `allConversionEvents[]` has 2+ items, append after all agent lines:
"Between {primaryCTA} and {secondaryCTA}, those are exactly the kind of conversion events your agents are trained to drive — on autopilot."

If only one CTA: omit this line.

### Consultant colour (optional append when available):
If `consultant.routing.reasoning[agent]` exists for any eligible agent, take the first sentence only and append to that agent's lines. Guard: only append if it adds something different from the wrapper and benefit line. Max 1 reasoning line per agent.

### Hiring wedge (optional append when available):
If `consultant.hiringAnalysis.topHiringWedge` exists, append as a final line after all agent descriptions:
"{topHiringWedge}"

### Close bridge:
Always append as final line of recommendation:
"Want me to set up your free trial now, or shall I bring one of them on the call so you can hear exactly how they'd handle your prospects?"

### FULL RECOMMENDATION VARIANTS:

**Variant 1: Alex + Chris + Maddie (most common)**
```
[Alex wrapper]. [Alex benefit]. [Chris wrapper]. [Chris benefit]. [Maddie wrapper]. [Maddie benefit].
[Multi-CTA line if applicable].
[Hiring wedge if available].
Want me to set up your free trial now, or shall I bring one of them on the call so you can hear exactly how they'd handle your prospects?
```

**Variant 2: Alex + Chris (no phone signals)**
```
[Alex wrapper]. [Alex benefit]. [Chris wrapper]. [Chris benefit].
[Multi-CTA line if applicable].
[Hiring wedge if available].
Want me to set up your free trial now, or shall I bring one of them on the call so you can hear exactly how they'd handle your prospects?
```

**Variant 3: Alex + Maddie (phone dominant, no web signals)**
```
[Alex wrapper]. [Alex benefit]. [Maddie wrapper]. [Maddie benefit].
[Hiring wedge if available].
Want me to set up your free trial now, or shall I bring one of them on the call so you can hear exactly how they'd handle your prospects?
```

**Variant 4: Alex only**
```
[Alex wrapper]. [Alex benefit].
Want me to set up your free trial now, or shall I bring Alex on the call so you can hear exactly how he'd handle your prospects?
```

### flow.ts change:
In the `recommendation` case, after user responds, advance to `close` directly.
REMOVE the line: `state.currentStage = 'anchor_acv'`
REPLACE with: `state.currentStage = 'close'`
Remove the `proceedToROI` check — it no longer applies.

---

## CHANGE 3 — CLOSE STAGE (moves.ts)

### Purpose:
Two-path mechanic. Free trial OR bring an agent on the call live.

### The close is already handled by the recommendation's final line.
The close STAGE activates when the prospect responds to that offer.

### Path A — Prospect says YES to free trial:
Bella says:
"Perfect — I'll get that set up for you now. Can I grab your best email address so I can send through the trial details?"

Wait for email. Capture to `state.trialEmail`.

Then Bella says:
"Got it. You'll receive an email from us shortly with everything you need to activate your trial — your agents will be ready to go. Is there anything else you'd like to know before we wrap up?"

### Path B — Prospect wants to hear an agent:
Prospect says something like "bring Chris on" or "I want to hear one" or "show me".

Bella says (for Chris):
"Great — I'll bring Chris on now. Hi Chris, I have {first_name} on the line from {business_name}, ready to be blown away."

Then Chris responds (injected via UpdateSpeak + UpdatePrompt):
"Bella you know I'm always ready! Hi {first_name}, great to meet you — I'm Chris, {business_name}'s AI website concierge. I've already been through your site so ask me anything, or just pretend you're a prospect walking in — I'll show you exactly how I'd handle it."

For Alex:
Bella: "Great — I'll bring Alex on now. Hi Alex, I have {first_name} from {business_name} on the line, ready to see you in action."
Alex: "Always ready Bella! Hi {first_name} — I'm Alex. My job is to make sure {business_name} is always first to respond to every inbound lead. Want to test me? Send a test enquiry through your website right now and watch what happens."

For Maddie:
Bella: "Great — I'll bring Maddie on now. Hi Maddie, {first_name} from {business_name} is on the line."
Maddie: "Hi {first_name}! I'm Maddie — I handle every call that comes into {business_name} so nothing ever gets missed. Give me a ring on your business number and I'll show you exactly how I answer."

### Agent selection logic:
If prospect names a specific agent → use that agent.
If prospect says "show me one" or similar → use topAgents[0] (highest priority eligible agent).

### Implementation note on voice swap:
Voice swap (UpdateSpeak) and persona swap (UpdatePrompt) are the mechanism. This is a future sprint implementation — for V1, Bella can deliver the agent's opening line in her own voice as a script injection. Mark as `TODO: voice_swap_sprint` in code comments.

For V1 ship: Bella says the handoff line AND the agent's opening line herself, making clear it's a demonstration of what the agent would say. Example:
"Great — let me show you how Chris would introduce himself: 'Hi {first_name}, I'm Chris, {business_name}'s AI website concierge...'"

### Path C — Prospect has questions or objects:
Bella handles naturally via Gemini. No specific scripting needed — this is conversational territory.

### flow.ts close case:
Close is terminal — no advancement. Bella stays in close stage until call ends.

---

## CHANGE 4 — FLOW.TS STAGE REMOVAL

Remove these cases entirely from the switch statement in processFlow():
- `anchor_acv`
- `ch_alex`
- `ch_chris`
- `ch_maddie`
- `ch_sarah`
- `ch_james`
- `roi_delivery`
- `optional_side_agents`

Remove from buildStageDirective() in moves.ts:
- `buildAlexDirective()`
- `buildChrisDirective()`
- All ROI delivery builders
- `anchor_acv` builder
- `optional_side_agents` builder

Keep but do not call (leave dead code, comment out):
- All calculator functions in roi.ts (keep for future re-enable)
- tryRunCalculator() in flow.ts

### nextChannelFromQueue() change:
Currently returns `roi_delivery` when queue exhausted. Change to return `close`.

---

## WORKING DIRS
All changes go in:
- `brain-v1-rescript/` (copy of cleanest-bella-brain-DO-FROZEN, already exists or create now)

DO NOT touch:
- `cleanest-bella-brain-DO-FROZEN/` (sacred)
- Any live production workers

## DEPLOY TARGET
When ready to test: deploy as `call-brain-do-v1-rescript` (new worker name, does not overwrite production).
Production workers remain untouched until full canary pass.
