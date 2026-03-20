# V1 UPGRADE BRIEF — Scoring Fix + Consultant Prompt Upgrade

## OVERVIEW

Two changes before Step 3:
1. buildQueueV2() scoring fix (already specced in previous SCORING_FIX.md — simple branching)
2. Consultant prompt upgrade — teach it to think like a sales strategist, not a box-ticker

Both changes make Bella smarter NOW. No architecture changes. No new plumbing.

---

## PART 1: buildQueueV2() — Simple Branching (already deployed as 8.14.0)

This is done. Chris + Alex when ads detected, Chris + Maddie/Alex when no ads based on CTA type.

---

## PART 2: Consultant Prompt Upgrade

File: consultant-v9/worker.js — buildPrompt() function

### What's wrong now

The consultant's routing section treats all 5 agents as equally important opportunities. It asks "which agent could help?" instead of "which revenue leak is active NOW and strongest to lead with?" Result: Sarah ranked #1 for Pitcher Partners (an accounting firm running ads across 4 social platforms) because "established firm = big database." That's technically true but terrible sales prioritisation.

### What changes

KEEP everything in the current prompt EXCEPT the routing section. The 5 lenses are good. The scriptFills, icpAnalysis, copyAnalysis, valuePropAnalysis, conversionEventAnalysis outputs are all good — the bridge uses them. We're upgrading the ROUTING section and adding new output fields.

### New routing instructions (REPLACE the current "routing" section in buildPrompt())

Replace the current routing instructions with this:

```
## AGENT ROUTING — THINK LIKE AN ELITE SALES STRATEGIST

You are NOT an analyst ticking boxes. You are an elite sales strategist choosing the best commercial wedge for a live discovery call. Your job is to identify what is costing this prospect money or conversions RIGHT NOW and recommend the agents that fix that first.

### THE AGENTS — KNOW THEIR ROLES

CORE REVENUE AGENTS (address active revenue leaks — prefer these):
- Chris: AI voice agent on the WEBSITE and LANDING PAGES. First contact. Engages visitors the moment they land. Converts them live on the page. Every website without an AI agent on it is leaking conversions.
- Alex: Speed-to-lead FOLLOW-UP. Leads that Chris didn't close — form fills, bounced visitors, enquiries — Alex follows up in under 60 seconds. Speed-to-lead is Alex's strategy.
- Maddie: AI receptionist. Missed calls, after-hours, overflow. Every call that goes to voicemail is a lost opportunity.

ENHANCEMENT AGENTS (address latent/future opportunity — valuable but never lead with these over active leaks):
- Sarah: Database reactivation. Wakes up old/dormant leads. Valuable for established businesses but this is LATENT opportunity, not active bleeding.
- James: Reputation/reviews. Automated review collection and management. Important for long-term growth but not an urgent revenue leak.

### URGENCY HIERARCHY — HARD RULES

1. Active revenue leakage FIRST: ads running, website traffic with no AI engagement, live inbound going cold, calls going to voicemail. These are costing money TODAY.
2. High-confidence friction SECOND: weak conversion path, slow follow-up, poor call handling. Evidence of lost revenue even if not from active spend.
3. Latent monetisation THIRD: old lead reactivation, reputation compounding, future nurture. Valuable but NEVER lead with these over active leaks.

NEVER rank an enhancement agent (Sarah, James) above a core revenue agent (Chris, Alex, Maddie) UNLESS:
- There is strong POSITIVE EVIDENCE the core agents are irrelevant (e.g., confirmed 24/7 AI chat already deployed = Chris less relevant)
- The active leak evidence is genuinely weak

### THE KEY INSIGHT: ADS = CHRIS AND ALEX TOGETHER

When a business is paying for traffic (ad pixels, social media campaigns, email marketing driving to landing pages), those clicks land on their website/landing pages. Chris engages them live on arrival. Alex follows up the ones Chris doesn't close. They are a PAIR. If ads or inbound traffic are detected, Chris and Alex should almost always be your #1 and #2.

### WHAT TO DO WITH MISSING DATA

Missing data does NOT mean the opportunity doesn't exist. It means Bella needs to ASK.
- No ad pixels detected → "No ad pixels found on-site — Bella should ask about their lead sources and any paid campaigns"
- No phone visible → "Phone not prominent — Bella should ask about inbound call volume"
- No CRM detected → Don't even mention this. We're selling AI agents, not auditing their tech stack.

### RANKING RUBRIC — Score each agent on these criteria (1-10):

- urgency_now: Is this costing them money TODAY? Active spend, active traffic, active calls?
- evidence_confidence: How strong is the evidence from the scrape? Confirmed vs inferred?
- speed_to_roi: How fast would this agent show obvious results? Days vs months?
- ease_of_explaining: Can Bella explain the value in 20 seconds on a live call?
- strategic_wedge_strength: Is this a compelling opener that makes the prospect say "tell me more"?

### FORCED TRADE-OFF RULES

- Active spend beats latent opportunity. ALWAYS.
- Active inbound leakage beats future nurture value. ALWAYS.
- Strong evidence beats broad inference.
- If they're running ads → Chris #1, Alex #2. Period.
- If no ads but phone-heavy business → Chris #1, Maddie #2.
- If no ads, form-based CTA → Chris #1, Alex #2.
- Sarah and James get mentioned AFTER the core agents, not before.
```


### New output fields (ADD to the existing JSON schema, don't remove existing fields)

Add these fields to the output JSON schema in buildPrompt(). Keep ALL existing fields (scriptFills, icpAnalysis, copyAnalysis, etc.) — they're used by the bridge.

```
"leadRecommendation": {
  "agent": "The #1 agent to lead with — usually Chris or Alex",
  "whyNow": "One sentence: what is costing them money RIGHT NOW that this agent fixes. Evidence-backed, urgent, specific.",
  "urgency": "high / medium / low",
  "proofPoints": ["Up to 3 specific evidence points from the scrape that support this recommendation"]
},

"secondaryRecommendations": [
  {
    "agent": "The #2 agent",
    "whySecond": "One sentence: why this agent complements the lead, and why it's #2 not #1"
  },
  {
    "agent": "The #3 agent (or enhancement agent)",
    "whyNotFirst": "One sentence: why this is valuable but not the lead — explicitly state what makes it less urgent"
  }
],

"agentScorecard": {
  "Chris":  { "urgency_now": 0, "evidence_confidence": 0, "speed_to_roi": 0, "ease_of_explaining": 0, "wedge_strength": 0 },
  "Alex":   { "urgency_now": 0, "evidence_confidence": 0, "speed_to_roi": 0, "ease_of_explaining": 0, "wedge_strength": 0 },
  "Maddie": { "urgency_now": 0, "evidence_confidence": 0, "speed_to_roi": 0, "ease_of_explaining": 0, "wedge_strength": 0 },
  "Sarah":  { "urgency_now": 0, "evidence_confidence": 0, "speed_to_roi": 0, "ease_of_explaining": 0, "wedge_strength": 0 },
  "James":  { "urgency_now": 0, "evidence_confidence": 0, "speed_to_roi": 0, "ease_of_explaining": 0, "wedge_strength": 0 }
}
```


### Update the existing routing output (MODIFY, don't remove)

The existing routing.priority_agents should now reflect the urgency hierarchy, not box-ticking. Update the routing output instructions:

```
"routing": {
  "priority_agents": ["Rank agents by URGENCY and ACTIVE REVENUE LEAK, not theoretical opportunity. Core revenue agents (Chris, Alex, Maddie) should almost always be top 3 unless strong evidence says otherwise. Format: ordered array of agent names."],
  "lower_priority_agents": ["Enhancement agents or agents where the evidence is genuinely weak for THIS specific business"],
  "skip_agents": ["Only agents with strong POSITIVE evidence they're irrelevant — e.g., confirmed 24/7 AI chat for Chris, confirmed call centre for Maddie"],
  "reasoning": {
    "chris": "COMMERCIAL ASSESSMENT — not feature-checking. What's the active revenue leak Chris fixes? Evidence from scrape. Why now?",
    "alex": "COMMERCIAL ASSESSMENT — what leads are going cold? What's the follow-up gap? Evidence. Why now?",
    "maddie": "COMMERCIAL ASSESSMENT — are calls being missed? Evidence of phone reliance. Why now?",
    "sarah": "HONEST ASSESSMENT — is there real database opportunity or are we just assuming? If latent, say so. Don't inflate.",
    "james": "HONEST ASSESSMENT — is review management a real wedge or a nice-to-have? If latent, say so."
  },
  "questions_to_prioritise": ["Which 2-3 questions Bella should ask to CONFIRM the lead recommendation — not generic discovery, targeted confirmation"],
  "questions_to_brush_over": ["Which topics to mention briefly — usually Sarah and James value-adds"]
}
```

### EXAMPLE: Pitcher Partners (the test case that should now work correctly)

Bad output (current):
- priority_agents: ["Sarah", "James", "Chris", "Alex", "Maddie"]
- reasoning.sarah: "Established accounting firm, likely large dormant database"

Good output (expected after upgrade):
- priority_agents: ["Chris", "Alex", "Maddie", "Sarah", "James"]
- leadRecommendation.agent: "Chris"
- leadRecommendation.whyNow: "They are actively driving traffic from 4 social platforms — every visitor landing on their site without an AI agent engaging them is a wasted click."
- secondaryRecommendations[0]: { agent: "Alex", whySecond: "Fast follow-up compounds Chris's conversions — form fills and bounced visitors get engaged in under 60 seconds." }
- secondaryRecommendations[1]: { agent: "Sarah", whyNotFirst: "Established firm likely has a sizeable database, but reactivating old leads is less urgent than converting the active traffic they're already paying for." }
- agentScorecard.Chris: { urgency_now: 9, evidence_confidence: 8, speed_to_roi: 9, ease_of_explaining: 9, wedge_strength: 9 }
- agentScorecard.Sarah: { urgency_now: 4, evidence_confidence: 6, speed_to_roi: 5, ease_of_explaining: 7, wedge_strength: 4 }


---

## IMPLEMENTATION INSTRUCTIONS FOR CC

### Change 1: consultant-v9/worker.js — buildPrompt()

1. Find the routing section in the prompt (starts with `"routing": {` in the output JSON instructions)
2. Replace the routing INSTRUCTIONS (the text that tells Gemini how to think about routing) with the new instructions above
3. Replace the routing OUTPUT SCHEMA with the updated schema above
4. ADD the new output fields (leadRecommendation, secondaryRecommendations, agentScorecard) to the JSON output schema
5. KEEP all existing output fields (scriptFills, icpAnalysis, copyAnalysis, valuePropAnalysis, conversionEventAnalysis, websiteCompliments, mostImpressive, googlePresence, conversationHooks, redFlags, landingPageVerdict, businessIdentity)
6. DO NOT change the 5 lenses (copy quality, market/ICP, surfaced benefits, conversion events, business identity)
7. DO NOT change the HANDLING MISSING OR NULL DATA section (it's good)
8. DO NOT change the model config or retry logic

### Change 2: consultant-v9/worker.js — buildFallback()

Update the fallback routing to reflect the new hierarchy:
```js
routing: {
  priority_agents: ["Chris", "Alex", "Maddie", "Sarah", "James"],  // was all 5 in random order
  lower_priority_agents: [],
  skip_agents: [],
  reasoning: {}
}
```

Add empty leadRecommendation and agentScorecard to fallback:
```js
leadRecommendation: { agent: "Chris", whyNow: "Default — every website needs an AI agent", urgency: "medium", proofPoints: [] },
secondaryRecommendations: [
  { agent: "Alex", whySecond: "Default follow-up agent" },
  { agent: "Maddie", whyNotFirst: "Default — assess phone needs on call" }
],
agentScorecard: {
  Chris: { urgency_now: 7, evidence_confidence: 3, speed_to_roi: 7, ease_of_explaining: 9, wedge_strength: 7 },
  Alex: { urgency_now: 5, evidence_confidence: 3, speed_to_roi: 6, ease_of_explaining: 8, wedge_strength: 5 },
  Maddie: { urgency_now: 5, evidence_confidence: 3, speed_to_roi: 6, ease_of_explaining: 8, wedge_strength: 5 },
  Sarah: { urgency_now: 3, evidence_confidence: 2, speed_to_roi: 4, ease_of_explaining: 7, wedge_strength: 3 },
  James: { urgency_now: 3, evidence_confidence: 2, speed_to_roi: 4, ease_of_explaining: 7, wedge_strength: 3 }
}
```

### Verification

1. Deploy consultant-v8
2. Fire a test lead for Pitcher Partners (or any business running ads)
3. Check the fast-intel output in KV — read lead:{lid}:fast-intel
4. Verify:
   - leadRecommendation.agent should be "Chris" (not Sarah)
   - priority_agents should have Chris, Alex, Maddie in top 3
   - agentScorecard should show Chris/Alex with high urgency_now, Sarah/James with low
   - reasoning.chris should reference active traffic/social spend, not generic "website needs chat"
5. Fire a test for a business with NO ads — verify Chris still leads but Alex/Maddie positioning adjusts

### After verification, proceed with Step 3: Consultant writer (writeStagePlan)

---

## WORKING RULES — SAME AS ALWAYS

1. One change at a time — deploy, verify, confirm
2. Read the current consultant-v9/worker.js buildPrompt() FULLY before editing
3. DO NOT touch the 5 lenses, the model config, or the Firecrawl/scraping logic
4. DO NOT touch any other worker
5. All KV ops need --remote flag
6. wrangler tail for verification
