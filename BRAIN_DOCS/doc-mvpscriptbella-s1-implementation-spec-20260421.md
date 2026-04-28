# MVPScriptBella — S1 IMPLEMENTATION SPEC
### Filed: 2026-04-21 AEST | Author: T9 Architect (Opus)
### Status: READY FOR T3 SPEC_STRESS_TEST → then T4 implementation
### Target file: ~/Desktop/MVPScriptBella/workers/bridge/src/index.ts (~3340 lines)
### Target version: v9.43.0
### Parent plan: doc-mvpscriptbella-t9-architectural-plan-final-20260421

---

## SPEC STRUCTURE

This spec has 4 sections:
1. **DELETE** — exact line ranges to remove
2. **REPLACE** — exact before/after for existing code
3. **ADD** — new code to insert
4. **VERIFY** — post-implementation grep checks

All line numbers reference the CURRENT file state. Implementer MUST read the file first and verify line numbers match — prior Sprint 1+5 partial work (T4 was 60% through) may have shifted lines.

---

## SECTION 1: DELETE

### 1A. Stage keyword mapping (lines 79-88)
DELETE the semantic search keyword mapping for old stages:
```
anchor_acv, anchor_timeframe, ch_ads, ch_website, ch_phone, ch_old_leads, ch_reviews, roi_delivery
```
KEEP `wow` and `close` keywords. Add `recommend` and `done`.

### 1B. Stage type definition (lines 368-371)
DELETE current:
```typescript
type Stage =
  | "wow" | "deep_dive" | "anchor_acv" | "anchor_timeframe"
  | "ch_ads" | "ch_website" | "ch_phone" | "ch_old_leads" | "ch_reviews"
  | "roi_delivery" | "close";
```

### 1C. Inputs interface (lines 376-396)
DELETE entire `Inputs` interface. All channel-capture fields are ROI/channel-specific.

### 1D. State interface (lines 398-423)
DELETE current State interface entirely.

### 1E. BLANK inputs initializer (lines 427-434)
DELETE.

### 1F. buildQueue function (lines 447-498)
DELETE entirely.

### 1G. rebuildFutureQueueOnLateLoad function (lines 501-515)
DELETE entirely.

### 1H. gateOpen function (lines 557-574)
DELETE entirely (will be replaced).

### 1I. advance function (lines 578-598)
DELETE entirely (will be replaced).

### 1J. runCalcs function (lines 605-665)
DELETE entirely.

### 1K. calcAgentROI function (lines 673-718)
DELETE entirely.

### 1L. buildStageDirective function (lines 1746-2209)
DELETE entirely (will be replaced with new function).

---

## SECTION 2: REPLACE (exact before/after)

### 2A. Stage type definition
INSERT at former location of 1B:
```typescript
type Stage = "wow" | "recommend" | "close" | "done";
```

### 2B. State interface
INSERT at former location of 1D:
```typescript
interface State {
  stage: Stage;
  stall: number;
  turns_in_stall: number;
  confirmed: {
    firstName: string | null;
    businessName: string | null;
    googleRating: number | null;
    googleReviews: number | null;
    deeper_requested: boolean;
    source_answer: string | null;
    funnel_answer: string | null;
  };
  conv_memory: string[];
  routing_variant: 'all3' | 'alex_chris' | 'alex_maddie' | 'alex_only';
  init: string;
  _lastTurn: number;
  _lastUttHash: string;
}
```

### 2C. BLANK state initializer
INSERT at former location of 1E:
```typescript
const BLANK_STATE: State = {
  stage: 'wow',
  stall: 1,
  turns_in_stall: 0,
  confirmed: {
    firstName: null,
    businessName: null,
    googleRating: null,
    googleReviews: null,
    deeper_requested: false,
    source_answer: null,
    funnel_answer: null,
  },
  conv_memory: [],
  routing_variant: 'alex_only',
  init: '',
  _lastTurn: 0,
  _lastUttHash: '',
};
```

### 2D. Identity line (line 1474)

BEFORE:
```
You are Bella, a live voice AI running a personalised AI Agent demonstration for a business prospect.
```

AFTER:
```
You are Bella, a live voice AI sales consultant. The person you are speaking with submitted their details on our website and you have already researched their business. You are having a personalised consultation about which AI agents would create the most value for them.
```

### 2E. Output Rule 1 — XML conflict (line 1709)

BEFORE:
```
1. ONLY SPOKEN WORDS. No labels, headers, XML tags, markdown, code formatting, or symbols in the output.
```

AFTER:
```
1. ONLY SPOKEN WORDS in your output. No labels, headers, markdown, code formatting, section markers, or symbols. Just natural speech.
```

### 2F. Output Rule 2 — sentence limit (line 1710)

BEFORE:
```
2. Use up to 3 statements and one question per turn, 4 sentences maximum.
```

AFTER:
```
2. Keep turns concise and natural. Deliver the scripted content in full — do not truncate. After delivering, ask at most one question.
```

### 2G. Output Rule 5 — verbatim delivery (line 1713)

BEFORE:
```
5. VERBATIM DELIVERY: Text inside <DELIVER_THIS> tags is your EXACT spoken output. Speak it word-for-word. Do not paraphrase, reorder, add to, or rewrite ANY part of it. You may add ONE brief natural acknowledgment sentence BEFORE it (e.g. reacting to what they just said), but the DELIVER_THIS content must be spoken EXACTLY as written — every word, same order, no substitutions. If you change even one word, you have failed.
```

AFTER:
```
5. SCRIPT DELIVERY: Content between ===SPEAK EXACTLY=== and ===END=== markers is your scripted output. Speak it faithfully — same meaning, same key phrases, same facts, same questions. You MUST deliver ALL the content. Before the scripted content, you may add 1-2 natural sentences acknowledging what the prospect just said. After the scripted content, STOP. Do not add, remove, or rephrase the core message. The script was written by our team — deliver it as written.
```

### 2H. Output Rules 8-9 — dead ROI rules (lines 1716-1717)

BEFORE:
```
8. Do not improvise ROI formulas or benchmark claims. Use ONLY the exact dollar figures from the LIVE ROI section and the DELIVER_THIS text. Never multiply, divide, or restate the math yourself.
9. NO PHANTOM ROI: If the LIVE ROI section is empty or absent, do NOT reference any dollar uplift, weekly/monthly value, or "conservative estimate". You have NO calculated numbers to cite — talk about the methodology and what the agents CAN do, not fabricated dollar amounts.
```

AFTER:
```
8. NO DOLLAR CLAIMS: Do not invent revenue figures, ROI calculations, or specific dollar amounts. You may cite general benchmarks from AGENT KNOWLEDGE (e.g. "up to 4x more conversions") but never fabricate specific dollar amounts for this business.
```

(Delete rule 9 entirely.)

### 2I. Sanitizer — add new markers (line 733)

BEFORE:
```typescript
    .replace(/DELIVER_THIS/gi, "")
```

AFTER:
```typescript
    .replace(/DELIVER_THIS/gi, "")
    .replace(/===SPEAK EXACTLY===/gi, "")
    .replace(/===END===/gi, "")
```

### 2J. Artifact detector (line 775)

BEFORE:
```typescript
  return /<[^>]*>|[<>]|DELIVER_THIS|MANDATORY SCRIPT/i.test(text);
```

AFTER:
```typescript
  return /<[^>]*>|[<>]|DELIVER_THIS|MANDATORY SCRIPT|===SPEAK EXACTLY===|===END===/i.test(text);
```

### 2K. Freestyle context separation (lines 1599-1609)

BEFORE:
```typescript
  if (intel.top_fix?.copyHeadline) intelLines.push(`Key opportunity: ${intel.top_fix.copyHeadline}`);
  if (opener) intelLines.push(`Opener: ${opener}`);

  if (cons.icpAnalysis?.marketPositionNarrative) intelLines.push(`Market position: ${cons.icpAnalysis.marketPositionNarrative}`);
  else if (cons.icpAnalysis?.whoTheyTarget) intelLines.push(`ICP: ${cons.icpAnalysis.whoTheyTarget}`);
  if (cons.copyAnalysis?.bellaLine || cons.valuePropAnalysis?.bellaLine) intelLines.push(`Site observation: ${cons.copyAnalysis?.bellaLine ?? cons.valuePropAnalysis?.bellaLine}`);
  if (cons.conversationHooks?.length) intelLines.push(`Conversation hooks: ${cons.conversationHooks.slice(0, 3).join(" | ")}`);
```

AFTER:
```typescript
  if (cons.icpAnalysis?.marketPositionNarrative) intelLines.push(`Market position: ${cons.icpAnalysis.marketPositionNarrative}`);
  else if (cons.icpAnalysis?.whoTheyTarget) intelLines.push(`ICP: ${cons.icpAnalysis.whoTheyTarget}`);

  // ── FREESTYLE CONTEXT ──
  const freestyleLines: string[] = [];
  freestyleLines.push(`\n---- FREESTYLE CONTEXT (use ONLY when reacting to unexpected prospect input — NEVER instead of the scripted content) ----`);
  if (opener) freestyleLines.push(`- Opening insight: ${opener}`);
  if (sf.website_positive_comment) {
    const cleanWP = (sf.website_positive_comment as string)
      .replace(/^I\s+(really\s+)?like\s+(how|that|the)\s+/i, "The site ")
      .replace(/^It's\s+great\s+(how|that)\s+/i, "The site ");
    freestyleLines.push(`- Site strength: ${cleanWP}`);
  }
  if (cons.copyAnalysis?.bellaLine || cons.valuePropAnalysis?.bellaLine) freestyleLines.push(`- Site observation: ${cons.copyAnalysis?.bellaLine ?? cons.valuePropAnalysis?.bellaLine}`);
  if (cons.conversationHooks?.length) freestyleLines.push(`- Conversation hooks: ${cons.conversationHooks.slice(0, 3).join(" | ")}`);
  if (intel.top_fix?.copyHeadline) freestyleLines.push(`- Key opportunity: ${intel.top_fix.copyHeadline}`);
  freestyleLines.push(`---- END FREESTYLE CONTEXT ----`);
```

Update the return statement (line 1609):
BEFORE:
```typescript
  return `${executionBlock}\n${intelLines.join("\n")}${marker}`;
```
AFTER:
```typescript
  return `${executionBlock}\n${intelLines.join("\n")}${freestyleLines.length > 2 ? "\n" + freestyleLines.join("\n") : ""}${marker}`;
```

### 2L. Turn prompt — remove LIVE ROI section and channel references

In buildTurnPrompt (lines 1612-1738), remove any references to:
- LIVE ROI section
- Channel capture instructions
- `inputs.acv`, `inputs.ads_leads`, `inputs.web_leads`, etc.
- `top3`, `total` ROI variables
- `buildQueue` results

Replace the confirmed inputs section with:
```typescript
const confirmedSection = [
  s.confirmed.firstName ? `Name: ${s.confirmed.firstName}` : null,
  s.confirmed.businessName ? `Business: ${s.confirmed.businessName}` : null,
  s.confirmed.googleRating ? `Google: ${s.confirmed.googleRating}★ (${s.confirmed.googleReviews} reviews)` : null,
  s.confirmed.source_answer ? `Lead source: ${s.confirmed.source_answer}` : null,
  s.confirmed.funnel_answer ? `Funnel insight: ${s.confirmed.funnel_answer}` : null,
].filter(Boolean).join("\n");
```

### 2M. Turn prompt — add REACT-BRIDGE-DELIVER instruction

Add after the MANDATORY SCRIPT section in buildTurnPrompt:
```
TURN BEHAVIOR: When the prospect speaks, first REACT (acknowledge what they said in 1-2 sentences), then BRIDGE (natural transition), then DELIVER (the scripted content for this stall). If the prospect asks a question, answer briefly from FREESTYLE CONTEXT or AGENT KNOWLEDGE, then BRIDGE back to script. If the prospect goes significantly off-topic, acknowledge briefly, then redirect: "That's a great point — let me come back to that. Right now I want to make sure I give you the best recommendation."
```

### 2N. Turn prompt — stage label

Replace current stage/stall label with:
```typescript
const stageLabel = s.stage === 'wow'
  ? `STAGE: wow | STALL: ${s.stall} of 7 | ${STALL_NAMES[s.stall] ?? 'unknown'}`
  : `STAGE: ${s.stage}`;
```

Where `STALL_NAMES` is a constant (see Section 3).

---

## SECTION 3: ADD (new code)

### 3A. Stall name constant

Add near the top of the file (after type definitions):
```typescript
const STALL_NAMES: Record<number, string> = {
  1: 'Research Intro',
  2: 'Reputation Trial',
  3: 'ICP + Problem + Solution',
  4: 'Conversion / CTA',
  5: 'Alignment Bridge',
  6: 'Explore or Recommend',
  7: 'Source Check',
  8: 'Funnel Questions',
};
```

### 3B. New gateOpen function

Insert at former location of 1H:
```typescript
function gateOpen(s: State, utterance: string): boolean {
  if (s.stage === 'done') return false;

  if (s.stage === 'recommend') return true; // always advance after delivery

  if (s.stage === 'close') return s.turns_in_stall >= 1;

  // wow stage gating
  if (s.stage === 'wow') {
    // WOW 2 skip: no Google rating → auto-advance
    if (s.stall === 2 && s.confirmed.googleRating === null) return true;

    // WOW 6: need explicit signal
    if (s.stall === 6) {
      const lower = utterance.toLowerCase();
      const wantsRecommend = /\brecommend|let's hear|go ahead|show me|what do you suggest|your pick/i.test(lower);
      const wantsDeeper = /\bdeeper|explore|more|tell me more|dig in|keep going/i.test(lower);
      return wantsRecommend || wantsDeeper;
    }

    // Safety net: force advance after 2 turns in any stall
    if (s.turns_in_stall >= 2) return true;

    // Default: prospect responded, minimum 1 turn
    return s.turns_in_stall >= 1;
  }

  return false;
}
```

### 3C. New advance function

Insert at former location of 1I:
```typescript
function advance(s: State, utterance: string): State {
  const next = { ...s, turns_in_stall: 0 };

  if (s.stage === 'wow') {
    // WOW 6 branching
    if (s.stall === 6) {
      const lower = utterance.toLowerCase();
      const wantsDeeper = /\bdeeper|explore|more|tell me more|dig in|keep going/i.test(lower);
      if (wantsDeeper) {
        next.confirmed = { ...next.confirmed, deeper_requested: true };
        next.stall = 7;
        return next;
      }
      // Recommend path
      next.confirmed = { ...next.confirmed, deeper_requested: false };
      next.stage = 'recommend';
      return next;
    }

    // WOW 2 skip (no Google rating)
    if (s.stall === 2 && s.confirmed.googleRating === null) {
      next.stall = 3;
      return next;
    }

    // After funnel questions (stall 8) → recommend
    if (s.stall === 8) {
      next.stage = 'recommend';
      return next;
    }

    // After WOW 7 → funnel questions (stall 8)
    if (s.stall === 7) {
      next.stall = 8;
      return next;
    }

    // Normal WOW progression
    if (s.stall < 7) {
      next.stall = s.stall + 1;
      return next;
    }

    // Fallback: past WOW 7 without deeper → recommend
    next.stage = 'recommend';
    return next;
  }

  if (s.stage === 'recommend') {
    next.stage = 'close';
    return next;
  }

  if (s.stage === 'close') {
    next.stage = 'done';
    return next;
  }

  return next;
}
```

### 3D. Routing variant resolver

Add near state initialization:
```typescript
function resolveRoutingVariant(intel: Record<string, any>): State['routing_variant'] {
  const agents: string[] = intel?.consultant?.routing?.priority_agents
    ?? intel?.routing?.priority_agents
    ?? [];
  const lower = agents.map((a: string) => a.toLowerCase());
  const hasAlex = lower.includes('alex');
  const hasChris = lower.includes('chris');
  const hasMaddie = lower.includes('maddie');

  if (hasAlex && hasChris && hasMaddie) return 'all3';
  if (hasAlex && hasChris) return 'alex_chris';
  if (hasAlex && hasMaddie) return 'alex_maddie';
  return 'alex_only';
}
```

### 3E. New buildStageDirective function

INSERT at former location of 1L. This is the core replacement — canonical script content.

```typescript
function buildStageDirective(
  s: State,
  fn: string,
  biz: string,
  ct: string,
  intel: Record<string, any>,
): string {
  const cons = intel?.consultant ?? {};
  const icp = cons?.icpAnalysis ?? {};
  const conv = cons?.conversionEventAnalysis ?? {};
  const sf = cons?.scriptFills ?? {};
  const techStack = intel?.tech_stack ?? {};

  // ── WOW STALLS ──
  if (s.stage === 'wow') {
    switch (s.stall) {

      // ── WOW 1: Research Intro ──
      case 1: {
        const hasBiz = biz && biz !== 'your business';
        const hasCT = ct && ct !== 'customer';
        if (hasBiz && hasCT) {
          return `===SPEAK EXACTLY===
So ${fn}, your pre-trained ${biz} agents are ready to go.
You play the role of a prospective customer, and your agents respond in real time like they've worked in the business for years — answering questions and moving people toward the actions that matter most.
Before we begin, can I quickly confirm a couple of things so they're dialled in around the highest-value opportunities?
===END===`;
        }
        return `===SPEAK EXACTLY===
So ${fn}, your pre-trained ${biz || 'AI'} agents are ready to go.
You play the prospect, and your agents respond in real time like they already know the business — guiding conversations and moving people toward the right next step.
Before we begin, can I quickly confirm a couple of things so they're dialled in properly?
===END===`;
      }

      // ── WOW 2: Reputation Trial ──
      case 2: {
        const rating = s.confirmed.googleRating;
        const reviews = s.confirmed.googleReviews;
        if (!rating || rating < 3) {
          return '[SKIP — no Google rating data. Advance to next stall.]';
        }
        if (rating >= 4.0 && reviews && reviews > 20) {
          return `===SPEAK EXACTLY===
And just before we get into it, I noticed ${biz} is sitting on ${rating} stars from ${reviews} reviews.
That's a strong trust signal — and when the experience behind the scenes matches that, results tend to move quickly.
We offer a small number of free trials to businesses in that position — so if this feels like a fit, we can activate that today.
===END===`;
        }
        return `===SPEAK EXACTLY===
I can see ${biz} has established a presence on Google — that's a good foundation to build from.
We offer a small number of free trials to businesses in your position — so if this feels like a fit, we can activate that today.
===END===`;
      }

      // ── WOW 3: ICP + Problem + Solution ──
      case 3: {
        const narrative = icp.icpNarrative;
        if (narrative && narrative.length > 20) {
          return `===SPEAK EXACTLY===
${narrative}
Is that broadly how you think about the people you want more of?
===END===`;
        }
        const problems = icp.icpProblems;
        const solutions = icp.icpSolutions;
        if (problems?.length && solutions?.length) {
          return `===SPEAK EXACTLY===
From what I can see, it looks like you mainly serve ${sf.icp_guess || ct + 's'}.
They tend to come in with things like ${problems[0]}${problems[1] ? ' and ' + problems[1] : ''}, and you solve those through ${solutions[0]}${solutions[1] ? ' and ' + solutions[1] : ''}.
Is that a fair read, or would you frame it differently?
===END===`;
        }
        const fallback = icp.bellaCheckLine || `From what I can see, it looks like you're helping people with ${sf.reference_offer || 'your core services'}. Would you say that's a fair starting point, or would you frame it differently?`;
        return `===SPEAK EXACTLY===
${fallback}
===END===`;
      }

      // ── WOW 4: Conversion / CTA ──
      case 4: {
        const narrative = conv.conversionNarrative;
        if (narrative && narrative.length > 20) {
          return `===SPEAK EXACTLY===
${narrative}
Does that sound right?
===END===`;
        }
        const atl = conv.agentTrainingLine;
        if (atl && atl.length > 20) {
          return `===SPEAK EXACTLY===
${atl}
Does that sound right?
===END===`;
        }
        const cta = conv.primaryCTA || sf.top_2_website_ctas;
        if (cta) {
          return `===SPEAK EXACTLY===
And the main action your site seems to be pushing people toward is ${cta}.
That's the first thing I want the agents lined up against.
Does that sound right?
===END===`;
        }
        return `===SPEAK EXACTLY===
Based on what I've seen, there are some clear opportunities to capture more conversions from your website traffic.
Does that sound right?
===END===`;
      }

      // ── WOW 5: Alignment Bridge ──
      case 5: {
        return `===SPEAK EXACTLY===
Perfect — that's exactly what your agent team runs against.
Everything I've just walked you through — your ideal client profile, your conversion events, your online presence — that's all pre-loaded into your agents from day one.
===END===`;
      }

      // ── WOW 6: Explore or Recommend ──
      case 6: {
        return `===SPEAK EXACTLY===
We can either go a layer deeper for another minute, or I can show you exactly what I'd recommend based on what we've got so far.
Which would be more useful?
===END===

IMPORTANT: Based on the prospect's response, end your output with exactly one of these signals on its own line:
[RECOMMEND] — if they want the recommendation
[DEEPER] — if they want to explore more
If unclear, ask one clarifying question, then signal on next turn.`;
      }

      // ── WOW 7: Source Check (deeper path only) ──
      case 7: {
        return `===SPEAK EXACTLY===
Apart from referrals, where is most new business coming from right now — your website, paid ads, calls, organic, or something else?
Whatever's doing the heavy lifting today is what I want the agents aligned to first.
===END===`;
      }

      // ── Funnel Questions (deeper path, after WOW 7) ──
      case 8: {
        const isAds = techStack.is_running_ads;
        const hasPhone = techStack.has_phone;
        const cta = conv.primaryCTA;

        if (isAds) {
          return `===SPEAK EXACTLY===
And when someone clicks through from one of your ads, what does that journey look like — do they hit a landing page, fill out a form, or call directly?
===END===`;
        }
        if (cta && /book|form|enquir|contact|schedul/i.test(cta)) {
          return `===SPEAK EXACTLY===
When someone fills out that ${cta} on your site, what happens next — does someone call them back, or is it automated?
===END===`;
        }
        if (hasPhone) {
          return `===SPEAK EXACTLY===
For the calls that come in, roughly how quickly does someone pick up or call back?
===END===`;
        }
        return `===SPEAK EXACTLY===
What's the main way a new prospect actually becomes a paying ${ct} for you right now?
===END===`;
      }

      default:
        return `Continue the conversation naturally. Transition toward the recommendation.`;
    }
  }

  // ── RECOMMENDATION ──
  if (s.stage === 'recommend') {
    switch (s.routing_variant) {
      case 'all3':
        return `===SPEAK EXACTLY===
Based on what we've seen, the strongest setup for ${biz} is Alex, Chris, and Maddie — covering speed to lead, website conversion, and inbound calls.
Alex follows up in under 30 seconds — which can drive up to 4x more conversions compared to slower response times.
Chris engages visitors instantly and moves them toward action — not just chatting, but actually converting.
And Maddie handles every inbound call and books the right opportunities in, so you're not losing revenue through missed calls.
That combination gives you full coverage across the key revenue points.
So ${fn}, would you like to experience a couple of these agents live first, or should we lock in your 20-minute onboarding call and get your trial activated?
===END===`;

      case 'alex_chris':
        return `===SPEAK EXACTLY===
Based on what we've seen, the biggest upside for ${biz} sits in response speed and website conversion — so Alex and Chris are the strongest setup.
Alex follows up in under 30 seconds, driving up to 4x more conversions.
Chris engages visitors instantly and moves them toward action.
So ${fn}, would you like to demo them live first, or lock in your 20-minute onboarding and get your trial running?
===END===`;

      case 'alex_maddie':
        return `===SPEAK EXACTLY===
Based on what we've seen, the biggest upside sits in response speed and inbound call handling — so Alex and Maddie are the strongest setup.
Alex handles speed to lead, and Maddie makes sure no inbound opportunity gets missed.
So ${fn}, would you like to experience them live first, or lock in your onboarding and get started?
===END===`;

      case 'alex_only':
      default:
        return `===SPEAK EXACTLY===
Based on what we've seen, Alex is the clearest starting point for ${biz}.
He follows up in under 30 seconds, which can drive up to 4x more conversions.
So if the goal is tightening the front end quickly, that's the strongest move.
Would you like to see Alex in action first, or lock in your onboarding call and get the trial live?
===END===`;
    }
  }

  // ── CLOSE ──
  if (s.stage === 'close') {
    return `===SPEAK EXACTLY===
Perfect — let's get your trial activated properly.
I'll lock in your 20-minute onboarding call now so we can set everything up around what we've covered.
What's the best day and time for you?
===END===`;
  }

  // ── DONE ──
  if (s.stage === 'done') {
    return `The consultation is complete. Thank ${fn} warmly and wrap up naturally.`;
  }

  return '';
}
```

---

## SECTION 4: WIRING CHANGES

### 4A. State initialization

Where the bridge initializes state for a new conversation (currently creates State with queue, inputs, etc.), replace with:
```typescript
const state: State = { ...BLANK_STATE };
state.confirmed.firstName = fn || null;
state.confirmed.businessName = biz || null;
state.routing_variant = resolveRoutingVariant(intel);

// Google rating from fast-intel (Places API) or deep intel
const googleRating = intel?.places?.rating
  ?? intel?.deep?.googleMaps?.rating
  ?? (intel?.star_rating != null ? parseFloat(String(intel.star_rating)) || null : null);
const googleReviews = intel?.places?.reviewCount
  ?? intel?.deep?.googleMaps?.review_count
  ?? intel?.review_count
  ?? null;
state.confirmed.googleRating = googleRating;
state.confirmed.googleReviews = googleReviews;
```

### 4B. Turn processing — stall increment + gate check

In the main turn handler, the current logic increments stall and calls gateOpen/advance. Replace with:
```typescript
// Increment turns_in_stall for current stall
s.turns_in_stall += 1;

// Check if gate opens (prospect responded, stall conditions met)
if (gateOpen(s, utterance)) {
  s = advance(s, utterance);
}

// Build directive for current stall
const directive = buildStageDirective(s, fn, biz, ct, intel);

// Handle WOW 2 skip (returns [SKIP...] marker)
if (directive.startsWith('[SKIP')) {
  s = advance(s, utterance);
  const nextDirective = buildStageDirective(s, fn, biz, ct, intel);
  // Use nextDirective instead
}
```

### 4C. WOW 6 signal parsing

After Gemini response, parse for branching signal:
```typescript
// Parse WOW 6 branching signal from Gemini output
if (s.stage === 'wow' && s.stall === 6) {
  const output = geminiResponse; // whatever variable holds the raw response
  if (/\[RECOMMEND\]/i.test(output)) {
    // Strip signal from spoken output
    spokenOutput = output.replace(/\[RECOMMEND\]/gi, '').trim();
    s = advance(s, 'recommend');
  } else if (/\[DEEPER\]/i.test(output)) {
    spokenOutput = output.replace(/\[DEEPER\]/gi, '').trim();
    s = advance(s, 'deeper');
  }
  // If no signal, keep at stall 6 for next turn
}
```

### 4D. Capture source_answer and funnel_answer

After WOW 7 and funnel questions (stall 8), capture prospect's answer:
```typescript
if (s.stage === 'wow' && s.stall === 7 && gateOpen(s, utterance)) {
  s.confirmed.source_answer = utterance.substring(0, 200); // cap length
}
if (s.stage === 'wow' && s.stall === 8 && gateOpen(s, utterance)) {
  s.confirmed.funnel_answer = utterance.substring(0, 200);
}
```

### 4E. buildStageDirective call signature

Update all call sites from:
```typescript
buildStageDirective(s, fn, biz, ind, ct, tf, top3, total, opener, intel)
```
To:
```typescript
buildStageDirective(s, fn, biz, ct, intel)
```

The old function took 10 params (including ROI arrays, timeframe, industry). New function takes 5. Grep for all call sites.

### 4F. Remove all references to deleted types/functions

Grep and remove all references to:
- `Inputs` type
- `inputs` field on state
- `queue` field on state
- `done` array on state (stage completion tracking — not the 'done' stage)
- `maddie_skip`
- `wants_numbers`
- `apify_done`
- `calc_ready`
- `trial_reviews_done`
- `just_demo`
- `buildQueue(`
- `rebuildFutureQueueOnLateLoad(`
- `calcAgentROI(`
- `runCalcs(`
- `selectWow8Branch` (if exists)
- `deep_dive` stage
- `anchor_acv` stage
- `anchor_timeframe` stage
- `ch_ads`, `ch_website`, `ch_phone`, `ch_old_leads`, `ch_reviews` stages
- `roi_delivery` stage

---

## SECTION 5: VERIFY (post-implementation checks)

After implementation, run these greps. ALL must return 0 matches:

```bash
cd ~/Desktop/MVPScriptBella/workers/bridge/src
rg 'anchor_acv|anchor_timeframe' index.ts
rg 'ch_ads|ch_website|ch_phone|ch_old_leads|ch_reviews' index.ts
rg 'roi_delivery|calcAgentROI|runCalcs' index.ts
rg 'buildQueue|rebuildFutureQueue' index.ts
rg 'DELIVER_THIS' index.ts  # should be gone from stage directives; sanitizer reference OK
rg 'ads_leads|web_leads|phone_volume|old_leads.*number' index.ts
rg 'conservative estimate|dollar uplift' index.ts
rg 'deep_dive' index.ts
```

These greps must return matches:
```bash
rg '===SPEAK EXACTLY===' index.ts  # should find ~15+ occurrences
rg '===END===' index.ts            # same count
rg 'FREESTYLE CONTEXT' index.ts    # should find 2 (open + close)
rg 'routing_variant' index.ts      # should find in State + resolveRoutingVariant + buildStageDirective
rg 'turns_in_stall' index.ts       # should find in State + gateOpen + turn handler
rg 'REACT.*BRIDGE.*DELIVER' index.ts  # should find in turn prompt
```

---

## SECTION 6: CANARY CRITERIA

After deploy, full voice test with known business (e.g. KPMG canary LID):

| Check | Expected | FAIL if |
|-------|----------|---------|
| BELLA_SAID every turn | Non-empty spoken text | Any silent turn |
| WOW 3 content | consultant icpNarrative verbatim | Generic/paraphrased |
| WOW 4 content | consultant conversionNarrative verbatim | Generic/paraphrased |
| WOW 2 skip | Clean skip when no Google rating | Error or stall |
| WOW 6 branching | Responds to "recommend" and "go deeper" | Stuck or wrong path |
| Recommendation variant | Matches routing.priority_agents | Wrong agents named |
| Close | Asks for day/time | Asks for email |
| ROI absence | Zero dollar figures, zero ROI | Any $ amount or "conservative estimate" |
| Business knowledge | Uses businessName, customerType | "What does your business do?" |
| prompt_tokens | 2000-3500 range | >5000 (old bloat) or <1000 (data not reaching) |
| Gemini TTFB | 3-5s stable | >8s regression |

---

## DOCUMENTS REFERENCED

| Doc | Purpose |
|-----|---------|
| doc-mvpscriptbella-t9-architectural-plan-final-20260421 | Parent architectural plan |
| doc-bella-mvp-script-final-20260420 | Canonical script (source of all spoken text) |
| doc-mvpscriptbella-make-her-sing-diagnostic-20260420 | 18 prompt conflicts |
| doc-mvpscriptbella-fix-spec-20260420 | Sprint 1 before/after prompt fixes |
| doc-bella-architecture-how-it-works-20260420 | Pipeline architecture |
