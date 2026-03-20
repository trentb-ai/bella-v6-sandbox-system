# CC PATCH v2: COMPLETE Script Alignment to Perplexity Spec
# Priority: P0 — EVERY move must match Perplexity's approved script
# File: call-brain-do/src/moves.ts
# 
# READ THESE FIRST:
# 1. This patch file (the authority)
# 2. call-brain-do/src/moves.ts (what you're fixing)
# 3. consultant-v9/worker.js (what the consultant outputs)
#
# RULE: Perplexity's script is THE authority. If moves.ts differs
# from what's listed below, moves.ts is WRONG. Fix it.

---

## COMPLETE DIFF: Every deviation found

### STALL 1 — Research intro
STATUS: ✅ MOSTLY CORRECT
MINOR FIX: Perplexity uses {industryOutcomePlural} not {ct}s.
CC has: "understand your {ct}s, your industry"
SHOULD BE: "understand your {pluralOutcome}, your industry, and how you win business"
Also Perplexity says: "Can I quickly confirm a couple of our findings"
CC has: "Can I just confirm a couple of our findings"
USE PERPLEXITY WORDING EXACTLY.

CORRECT TEXT:
"Now {firstName}, I think you'll be impressed. We've done some research
on {business}, and we use that to pre-train your agents so they
understand your {pluralOutcome}, your industry, and how you win business.
Can I quickly confirm a couple of our findings with you, just to make
sure your agents are dialled in?"

### STALL 2 — Reputation + trial
STATUS: ❌ WRONG — WAY too long, too salesy

CC added a huge trial pitch that's NOT in Perplexity's version.
Perplexity stall 2 is SHORT and simple:

CORRECT TEXT:
"Oh {firstName}, I noticed {business} has a {rating}-star reputation
from {reviewCount} reviews — that's strong. Businesses already
delivering good customer outcomes qualify for our free trial, so if
you'd like, I can get that set up for you at any point during this demo."

That's IT. No "one caveat", no "set and forget", no "count the extra
{ct}s". Keep it clean. The hard trial pitch comes at CLOSE stage.
Skip logic: skip if no rating or rating < 3. CORRECT in CC.

### STALL 3 — ICP + 2 problems + 2 solutions (COMBINED)
STATUS: ❌ WRONG — CC splits ICP from problems/solutions

CC's current code only does ICP observation. It reads icpProblems
and icpSolutions at the top but the primary path just does:
"It looks like ${cleanIcp}. Is that right?" — NO PROBLEMS OR SOLUTIONS.

PERPLEXITY SAYS THIS IS ONE COMBINED STALL:

CORRECT PRIMARY TEXT (when icpProblems[0..1] + icpSolutions[0..1] exist):
"It looks like you're primarily targeting {icpGuess}. The typical
challenges your {pluralOutcome} face are {icpProblems[0]} and
{icpProblems[1]}, and you solve those through {icpSolutions[0]}
and {icpSolutions[1]}. Does that sound right?"

NOTE: Use {pluralOutcome} from IndustryLanguagePack, not "customers".
The problems and solutions come from consultant.icpAnalysis — these
are Gemini's STRATEGIC ANALYSIS of the website, not raw copy.

CORRECT FALLBACK (data thin):
"From your website, it looks like your positioning is really centred
around {referenceOffer}, and the way you present it suggests you're
speaking to {industryAudience}. Does that sound right?"

CORRECT LAST RESORT:
Use consultant.icpAnalysis.bellaCheckLine if exists, else:
"The site does a strong job of positioning what {shortBiz} does.
Does that sound right?"

### STALL 4 — Pre-training connect
STATUS: ❌ WRONG TEXT — CC invented its own version

CC has: "feel like they've been inside {shortBiz} for years. Not
generic bots, they know your positioning, your {ct}s, your reputation."
That is NOT in the Perplexity spec. It's CC's invention.

CORRECT TEXT per Perplexity:
"That's exactly the kind of business intelligence we've used to
pre-train your AI team — so they don't sound generic. They understand
your positioning, your {pluralOutcome}, your reputation, and most
importantly how you generate revenue."

NOTE: Perplexity says "most importantly how you generate revenue" —
that's the key line. CC dropped it entirely.

OPTIONAL APPEND (only if trial not yet mentioned — this part CC got right):
"If you'd like, I can also help you activate the free trial during
this session."

ONE sentence only. Not the paragraph CC currently has.

### STALL 5 — Conversion event alignment
STATUS: ⚠️ PARTIALLY CORRECT — needs consultant pre-built lines priority

CC correctly uses conversionNarrative as first priority. GOOD.
But the fallback text needs fixing.

CORRECT per Perplexity when using primaryCTA:
"So looking at your website, it seems your main conversion event is
{primaryCTA}. That's how you turn interest into new {pluralOutcome},
and it's exactly the kind of action we train your AI agents to drive
more of, automatically. Would that be helpful?"

CC has: "that's how you win new {ct}s" — should use {pluralOutcome}
and Perplexity's "turn interest into" framing.

### STALL 6 — Audit setup
STATUS: ❌ COMPLETELY WRONG — This is the biggest error

CC made stall 6 a FOLLOW-UP SPEED question:
"how quickly is your team following up with those leads"

This VIOLATES Perplexity's core rule:
"Channel speed rule: ask follow-up speed inside the relevant
channel stage, not in WOW."

CORRECT TEXT per Perplexity — stall 6 is PURELY a transition:
"Perfect — so that confirms your agents are trained to bring in the
right kind of {pluralOutcome} and move them toward your key conversion
points. I've just got a couple of quick opportunity-audit questions
so I can work out which agent mix would be most valuable for {business}."

Move kind: 'bridge' (NOT 'question')
No extraction. No follow-up speed. Just transition.

### STALL 7 — Main controllable source (merged 7+8)
STATUS: ⚠️ PARTIALLY CORRECT — missing third variant

CC has 2 variants (ads detected, no ads). Perplexity specifies 3:

VARIANT 1 — ads detected:
"Now {firstName}, I can see you're already running ads, which is
interesting. Apart from referrals, would you say that's your main
source of new {leadNoun}s, or is another channel doing most of the
heavy lifting?"

VARIANT 2 — no ads detected:
"Apart from referrals, what would you say is your main source of new
{leadNoun}s right now — your website, phone calls, organic, paid ads,
or something else?"

VARIANT 3 — source already mostly clear (MISSING from CC):
"Now {firstName}, apart from referrals, it looks like {detectedChannel}
is a meaningful source of new {leadNoun}s for you — is that fair to say?"

ADD variant 3. Determine "source already clear" from:
- routing.priority_agents strongly pointing to one channel
- strong ads/phone/website signals in intel flags
- detectedChannel = "your website" | "paid ads" | "phone" based on signals

Also CC's ads variant wording is slightly off. Use Perplexity's exact
phrasing above — note "which is interesting" and "most of the heavy
lifting" vs CC's "doing the heavy lifting".

### STALL 8 — Hiring / capacity wedge
STATUS: ⚠️ MOSTLY CORRECT — minor text fixes

When hiring is unknown, Perplexity says:
"And are you doing any hiring at the moment?"

CC has a long version: "Now {fn}, I have an idea of which agents will
deliver you the highest ROI — but can I just check, are you doing any
hiring at the moment?"

Use Perplexity's SHORT version. The "I have an idea which agents"
framing belongs in stall 9 (recommendation), not stall 8.

When hiring IS known, Perplexity says:
"I also noticed you're hiring for {role}, which is interesting because
that's exactly the kind of workload one of our agents can often absorb."

CC's version is close but should also try consultant.hiringAnalysis
.topHiringWedge as primary (pre-written by Gemini).

Skip logic: correct — skip if no wedge + budget tight. ✅

### STALL 9 — Provisional recommendation + bridge
STATUS: ❌ BLOATED — Two jobs crammed into one

CC jams the recommendation AND bridge-to-numbers into one huge blob.
Perplexity has this as TWO distinct beats in one stall:

BEAT 1 — Recommendation:
"Based on what I've found so far, the likely standouts for {business}
look like {agent1} and {agent2}. {agent1} would help with
{agent1ContextNative}, and {agent2} would help with {agent2ContextNative}."

Use consultant.conversionEventAnalysis.ctaAgentMapping as PRIMARY
source for the recommendation line (it's pre-written by Gemini).
Fall back to CC's current routing logic only if ctaAgentMapping is null.

BEAT 2 — Bridge (SHORT):
"If you want, I can now work out which of those would likely generate
the most extra revenue for you."

Then STOP. Wait for agreement. DO NOT add:
- "back of the napkin math" (CC's invention, not in spec)
- "so you can demo only the highest earners" (not in spec)
- Annual projections (not here — that's ROI delivery)

---

### ANCHOR_ACV
STATUS: ❌ WRONG FRAMING

CC uses the old "Annual Client Value" / "ACV" framing:
"what's the annual value of a new {ct}?"

PERPLEXITY CHANGED THIS. New framing is simpler:
"Perfect. What's a new {singularOutcome} worth to {business} on
average? A ballpark is totally fine."

No mention of "ACV", no mention of "annual". Just "what's a new
{singularOutcome} worth" — natural, conversational.

After capture, just: "Got it, thanks."
Then immediately: "And when you think about lead flow, do you usually
measure it weekly or monthly?"

The industry benchmark preamble ("we've got the average ACV for {ind}
as {benchmark}") should ONLY be used as a fallback if the prospect
seems confused or doesn't answer. NOT as the primary ask.

### ANCHOR_TIMEFRAME
STATUS: ⚠️ MOSTLY CORRECT
Perplexity: "And when you think about lead flow, do you usually measure
it weekly or monthly?"
CC has this right. ✅
CC's confirmed acknowledgement ("Great, weekly it is") is fine.

---

### CH_WEBSITE
STATUS: ❌ MISSING Q3 (follow-up speed) + wrong ROI text

Perplexity's 3 questions:
Q1: "How many enquiries or leads is your website generating {timeframe}?"
Q2: "And roughly how many of those convert into paying {pluralOutcome}?"
Q3: "And when a website enquiry comes in, how quickly is your team
usually getting back to them?"

CC is MISSING Q3 entirely. No web_followup_speed extraction.
Add it. Add web_followup_speed to extractTargetsForStage.

ROI delivery text per Perplexity:
"So you're getting around {webLeads} website leads {timeframe}, and
converting about {webConversions} of them into paying {pluralOutcome}.
Chris, our Website Concierge, typically lifts conversion by engaging
visitors in real time, and at your ACV of {acv} dollars that could
mean roughly {chrisWeekly} dollars per week in additional revenue.
Does that sound reasonable?"

CC's version adds "23% by engaging visitors in real-time before they
bounce" — the 23% figure is fine (it's in the calc engine) but the
phrasing should match Perplexity: "lifts conversion by engaging
visitors in real time" not "lifts conversion by around 23%".

### CH_ADS
STATUS: ⚠️ MOSTLY CORRECT — minor text alignment

Perplexity's 3 questions:
Q1: "How many leads are your ads generating {timeframe}?"
Q2: "And roughly how many of those are converting into paying
{pluralOutcome}?"
Q3: "And when those ad leads come in, how quickly is your team
following up — under 30 minutes, 30 minutes to 3 hours, 3 to 24
hours, or more than 24 hours?"

CC has these ✅ but Q3 wording is slightly different. Use Perplexity's
exact framing with the explicit time buckets.

ROI delivery per Perplexity:
"So your average {singularOutcome} is worth {acv} dollars, and you're
currently converting {conversions} from {leads} ad leads {timeframe}.
Based on the follow-up speed you mentioned, Alex could conservatively
add around {alexWeekly} dollars per week just by improving
speed-to-lead. Does that make sense?"

CC's version adds uplift percentages ("up to 391%") — that's fine
as a criticalFact but shouldn't be in the spoken text per Perplexity.

### CH_PHONE
STATUS: ❌ MISSING Q3 + wrong framing

Perplexity's 3 questions:
Q1: "Roughly how many inbound calls does {business} get {timeframe}?"
Q2: "And when calls are missed — whether that's after hours or during
busy periods — what usually happens?"
Q3: "And how quickly are missed calls usually called back?"

CC is MISSING Q3 entirely. No missed_call_callback_speed extraction.
Add it. Add missed_call_callback_speed to extractTargetsForStage.

Also CC's Q1 is too generic: "How many phone calls would you say you
get per {period}?" — should be: "Roughly how many inbound calls does
{business} get {timeframe}?" (more specific, uses business name).

CC's Q2 is close but Perplexity says "whether that's after hours or
during busy periods" — the "busy periods" part is key (Phone Rule:
phone opportunity includes busy hours, not just after-hours).

ROI per Perplexity:
"So you're getting around {phoneVolume} inbound calls {timeframe},
and when calls are missed they're currently handled by
{missedCallProcess}. Even a small percentage of missed opportunities
there adds up fast, so conservatively Maddie could recover around
{maddieWeekly} dollars per week in extra revenue by answering and
qualifying more of those calls consistently. Does that track?"

CC's version says "Maddie answers every call 24/7, qualifies the
caller, and books them straight in" — too feature-focused. Perplexity
frames it as "answering and qualifying more of those calls
consistently" which is outcome-focused.

### CH_OLD_LEADS
STATUS: ⚠️ MINOR TEXT FIX

Perplexity Q1:
"How many past customers or older leads would you say are sitting in
your database that haven't been contacted in a while?"

CC has: "Do you have a database of past {pluralOutcome} or leads that
you haven't contacted in a while? Roughly how many would be in there?"
— Close but should be one question not two.

ROI per Perplexity:
"If even a small percentage of those older leads re-engage, Sarah
could turn that dormant database into a real revenue channel. Based
on the number you gave me, that could look like around {sarahWeekly}
dollars per week in recovered opportunity. Sound fair?"

CC's version is different framing but acceptable. Align to Perplexity.

### CH_REVIEWS
STATUS: ⚠️ MINOR TEXT FIXES

Perplexity's questions:
Q1: "Roughly how many new customers do you serve {timeframe}?"
Q2: "Do you currently have any consistent system for asking happy
customers for reviews?"
Q3 (only if needed): "Is review generation something your team is
actively managing, or is it more ad hoc at the moment?"

CC has Q1 and Q2 ✅. Missing optional Q3.

ROI per Perplexity:
"With your current customer flow, even a modest lift in review volume
and response consistency can materially improve trust and conversion.
Conservatively, James could create around {jamesWeekly} dollars per
week in additional value by increasing review momentum and protecting
your reputation. Does that seem realistic?"

CC's version cites "research shows a 1-star improvement drives 9%
more revenue" — not in Perplexity's script. Remove the statistic
from spoken text (keep in criticalFacts if you want).

### ROI_DELIVERY
STATUS: ❌ WRONG — adds annual figure + trial re-pitch

CC's version:
"Adding up... that's {breakdown}... {total} dollars per week... That's
{total*52} dollars a year. And remember, the free trial is available
right now — no credit card, takes ten minutes..."

WRONG. Annual projection and trial pitch belong in CLOSE, not here.

CORRECT per Perplexity — stall 0:
"So {firstName}, let me add that up for you. We've got {agent1} at
{weekly1} dollars per week, and {agent2} at {weekly2} dollars per week.
That's a combined total of approximately {total} dollars per week in
additional revenue across your selected agents — and those are
conservative numbers. Does that all make sense?"

Stall 1: Respond briefly to their reaction, confirm the numbers, then
move forward. NO trial pitch here.

### CLOSE
STATUS: ⚠️ MINOR TEXT FIX

CORRECT per Perplexity:
"Perfect. Would you like to go ahead and activate your free trial? It
takes about ten minutes to set up, there's no credit card required,
and you could start seeing results this week."

CC has: "Let me get your free trial set up right now — it takes about
ten minutes and your AI team will be live today."
Too assumptive. Perplexity ASKS "would you like to go ahead" — gives
them the choice. Fix to match.

---

## GLOBAL RULES (apply across ALL stalls)

### Use IndustryLanguagePack EVERYWHERE
NEVER use bare "client" or "clients" or {ct}.
ALWAYS use {singularOutcome} and {pluralOutcome} from the pack.
Also use {leadNoun}, {revenueEvent}, {missedOpportunity} where relevant.

### Use consultant pre-built spoken lines as PRIMARY
The consultant generates these ready-to-speak fields:
- icpAnalysis.bellaCheckLine → stall 3 fallback
- copyAnalysis.bellaLine → stall 4 optional
- valuePropAnalysis.bellaLine → stall 5 optional
- conversionEventAnalysis.conversionNarrative → stall 5 PRIMARY
- conversionEventAnalysis.agentTrainingLine → stall 5 secondary
- conversionEventAnalysis.ctaAgentMapping → stall 9 PRIMARY
- hiringAnalysis.topHiringWedge → stall 8 PRIMARY

These are Gemini's STRATEGIC ANALYSIS. Use them first. Fall back to
building from raw fields ONLY when they're null.

### Perplexity's implementation notes (non-negotiable)
- Skip any WOW stall that lacks credible data
- Don't over-explain the free trial twice
- Treat Stall 9 as PROVISIONAL recommendation
- Keep every question to one job: confirm, route, quantify, or close
- Follow-up speed belongs INSIDE channel stages, never WOW

## EXECUTION

1. Read this entire file
2. Read moves.ts
3. Read consultant-v9/worker.js (understand icpAnalysis, conversionEventAnalysis output shapes)
4. Apply ALL fixes — every stall, every channel, every stage
5. tsc --noEmit
6. wrangler deploy --dry-run
7. Deploy call-brain-do
8. Report: list each stall and what changed
