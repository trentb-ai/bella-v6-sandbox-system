# CC LIVE TEST FIXES — Walker Lane anon_jywk4s9e
# From real-time log analysis. Apply ALL fixes, deploy, no testing mid-way.

---

## FIX 1: Industry resolving as "legal" instead of "financial planning"

File: call-brain-do/src/intel.ts

The log shows: `[INDUSTRY] resolved="legal" source="exact" raw="legal"`

The consultant or fast-intel is passing industry="legal" for Walker Lane
(a wealth management firm). This means either:
a) The consultant is misclassifying wealth management as legal
b) The keyword map is matching something wrong

FIX A: Add explicit wealth management keywords ABOVE legal in KEYWORD_MAP:
```
'wealth': 'financial planning',
'financial advice': 'financial planning',
'financial planning': 'financial planning',
'financial adviser': 'financial planning',
'financial advisor': 'financial planning',
```

FIX B: In buildIndustryLanguagePack(), add a GUARD:
If the raw industry string contains "wealth", "financial", "planning",
"superannuation", "retirement", "investment" — FORCE financial planning
pack regardless of what the keyword map says. This prevents "legal"
from winning when the business is clearly financial.

```typescript
// BEFORE keyword matching, add explicit override:
const financeKeywords = ['wealth', 'financial', 'planning', 'superannuation',
  'retirement', 'investment', 'adviser', 'advisor'];
const allIndustryText = `${consultantIndustry} ${coreIndustry}`.toLowerCase();
if (financeKeywords.some(k => allIndustryText.includes(k))) {
  const fp = INDUSTRY_PACKS['financial planning'];
  if (fp) return { ...fp, industryLabel: consultantIndustry || coreIndustry };
}
```

Also investigate: WHY is the consultant saying "legal" for Walker Lane?
Check the consultant output for this LID:
```
wrangler kv:key get "lead:anon_jywk4s9e:consultant" --binding LEADS_KV --remote
```
Look at businessIdentity.industry. If it says "legal", the consultant
prompt needs fixing (separate issue). For now, the guard above protects.

---

## FIX 2: Stall 3 stuck in STALL_HOLD loop (3 times)

File: call-brain-do/src/index.ts or moves.ts

Logs show stall 3 fired 3 times with `[STALL_HOLD] stall=3 — filler
response to question, not advancing`. The prospect IS responding but
the DO isn't advancing the stall.

This is the STALL_HOLD feature that CC added — it holds the stall when
the prospect asks a question instead of answering. But it's too
aggressive. The prospect answered "yeah" or similar and it still held.

FIX: Find the STALL_HOLD logic. It should ONLY hold if:
- The prospect's response is clearly a question (ends with ?)
- The prospect asks something unrelated
- NOT when they give a short affirmative ("yeah", "yep", "sure", "sounds good")

Short affirmatives should ADVANCE the stall, not hold it.
If STALL_HOLD has fired 2+ times on the same stall, force advance.

---

## FIX 3: "Walker Lane Pty Ltd" — strip "Pty Ltd"

File: call-brain-do/src/moves.ts — shortBiz() function

shortBiz() strips common stop words but "pty" and "ltd" are already in
the stop list. Check if it's using bizName() instead of shortBiz() in
the prompt. The bridge may be using intel.business_name directly.

Also check: deepgram-bridge-v11/src/index.ts — where bizName is resolved
for the prompt. It should use shortBiz logic or strip "Pty Ltd" variants:
```typescript
const biz = bizName
  .replace(/\b(pty|ltd|inc|llc|co|corp|limited|proprietary)\b\.?/gi, '')
  .replace(/\s+/g, ' ')
  .trim();
```

---

## FIX 4: WOW takes too long — compress to reach ROI faster

File: call-brain-do/src/moves.ts + gate.ts

The call spent 10 stalls in WOW before reaching anchor_acv. That's
~3 minutes of WOW before even asking what a client is worth. Too slow.

FIX A: Make stalls 4-5 skippable when data is thin.
- Stall 4 (pre-training): Skip if stall 3 got a positive response.
  The prospect already confirmed — don't belabour the point.
- Stall 5 (conversion): Skip if no conversionNarrative AND no primaryCTA.
  Don't deliver a generic conversion line.

FIX B: Auto-advance on short affirmatives in WOW.
When the prospect says "yeah", "yep", "sure", "sounds good", "that's right",
"correct", "absolutely" — advance to the next stall immediately.
Don't wait for STALL_HOLD to burn a turn.

FIX C: Reduce WOW gate from 10 to 8 max.
In gate.ts, change: `case 'wow': return wowStall >= 10;`
To: `case 'wow': return wowStall >= 8;`
This means if we've done 7 stalls, the 8th triggers the gate.
Stalls 8 (hiring) and 9 (rec) can be folded if budget is tight.

FIX D: Add questionBudgetTight flag earlier.
After stall 6, if we've used 6+ turns in WOW, set questionBudgetTight.
This triggers hiring skip (stall 8) and shorter rec (stall 9).

---

## FIX 5: "Thanks for clarifying" STILL appearing

File: deepgram-bridge-v11/src/index.ts — apology filter

Log shows: "Thanks for clarifying that your website..."
The apology filter strips "sorry" etc but "Thanks for clarifying" is
NOT in the filter list.

FIX: Add to the apology filter regex:
```
/thanks for clarifying|thanks for that clarification|thanks for explaining/gi
```

Also add to OUTPUT RULES in the prompt:
"Do not say 'thanks for clarifying' or similar filler phrases."

---

## EXECUTION ORDER

1. Fix industry guard in intel.ts (financial keywords override)
2. Fix STALL_HOLD to allow short affirmatives through
3. Fix shortBiz / bizName to strip "Pty Ltd"
4. Compress WOW: skip stalls 4-5 when thin, gate at 8, budget tight after 6
5. Add "thanks for clarifying" to apology filter
6. tsc --noEmit call-brain-do
7. Deploy call-brain-do
8. Deploy deepgram-bridge-v11
9. Git commit + push

## DO NOT TOUCH
- deepgram-bridge-v9/ (V1.0 frozen)
- fast-intel-sandbox-v9/ (just deployed)
- voice agents / netlify


---

## FIX 6: GET TO ROI FASTER — THIS IS THE MOST CRITICAL FIX

The call took 3 MINUTES in WOW (10 stalls) before even asking ACV.
Then it still needs: ACV → timeframe → 2-3 channels → ROI → close.
At current pace, ROI delivery would be 7-8 minutes in. WAY too slow.

### A. Cut WOW from 9 stalls to 6 max

File: call-brain-do/src/moves.ts + gate.ts

MANDATORY stalls (never skip): 1 (research), 6 (audit bridge), 9 (rec)
CONDITIONAL stalls: 2 (trial), 3 (ICP), 7 (source)
SKIP-IF-THIN stalls: 4 (pretrain), 5 (conversion), 8 (hiring)

New logic in buildWowPacket():
- Stall 4 (pretrain): SKIP if stall 3 got ANY response. Advance to 5.
- Stall 5 (conversion): SKIP if no conversionNarrative AND no primaryCTA.
- Stall 8 (hiring): SKIP unless consultant.hiringAnalysis.topHiringWedge exists.

In gate.ts change WOW gate:
```typescript
case 'wow': return wowStall >= 8; // was 10, now exits faster
```

### B. Auto-advance WOW on ANY affirmative response

File: call-brain-do/src/index.ts handleTurn()

When the prospect says short affirmatives during WOW ("yeah", "yep",
"sure", "sounds good", "that's right", "correct", "absolutely",
"mm-hmm", "definitely", "of course"), advance the stall IMMEDIATELY.
Don't hold for STALL_HOLD. Don't wait for next turn.

```typescript
// After extraction, before gate check, in WOW stage:
if (brain.stage === 'wow') {
  const affirmatives = /^(yeah|yep|yup|yes|sure|ok|okay|sounds good|that's right|correct|absolutely|mm-?hmm|definitely|of course|for sure|right|exactly|spot on|that's correct|sounds right|you got it|100 percent|hundred percent)[\s.,!?]*$/i;
  const isAffirmative = affirmatives.test(cleanTranscript);
  if (isAffirmative) {
    // Don't hold — advance stall
    // (skip STALL_HOLD logic for this turn)
  }
}
```

### C. Combine anchor_acv + anchor_timeframe into ONE turn

File: call-brain-do/src/moves.ts

When ACV is captured, immediately ask timeframe in the SAME response.
Don't burn a separate turn on timeframe.

In buildAnchorAcvPacket(), when e.acv is captured:
```typescript
// BEFORE (two separate turns):
// Turn 1: "What's a new client worth?" → captures acv
// Turn 2: "Weekly or monthly?" → captures timeframe
// Turn 3: advance to channels

// AFTER (one combined response):
if (e.acv && !e.timeframe) {
  return {
    stage: 'anchor_acv', wowStall: null,
    objective: 'Confirm value AND ask timeframe in one turn',
    chosenMove: {
      id: 'acv_and_tf',
      kind: 'question',
      text: `Got it, ${e.acv.toLocaleString()} dollars — thanks. And when you think about lead flow, do you usually measure it weekly or monthly?`,
    },
    ...
  };
}
```

### D. Channel stages: deliver ROI inline, don't wait

The channel stages already compute ROI inline (ch_ads_roi, ch_web_roi,
etc). But they require ALL inputs before delivering ROI. 

Add a FAST PATH: if we have ACV + at least one channel's data,
compute partial ROI and offer to deliver it. Don't wait for all channels.

In buildNextTurnPacket, after 2 channel stages are complete:
- Check if roiDeliveryCheck returns 'partial' or 'ready'
- If yes, skip remaining channels and go to roi_delivery

### E. ROI delivery MUST happen by turn 15 max

File: call-brain-do/src/index.ts handleTurn()

Add a hard ceiling: if turn count > 15 and stage is still a channel,
force advance to roi_delivery with whatever data we have.

```typescript
const turnNum = parseInt(turnId);
if (turnNum > 15 && brain.stage.startsWith('ch_') && !brain.flags.roiComputed) {
  computeROI(brain);
  if (brain.roi.totalValue && brain.roi.totalValue > 0) {
    brain.stage = 'roi_delivery';
    console.log(`[TURNCAP] Forcing ROI delivery at turn ${turnNum}`);
  }
}
```

### F. Reduce channel queue to 2 max

File: call-brain-do/src/gate.ts — buildQueue()

Currently the queue can have 3 channel stages. Cut to 2 MAX.
Pick the top 2 by consultant routing priority. Skip the rest.

```typescript
// In buildQueue(), after building the queue:
queue = queue.slice(0, 2); // Max 2 channels
```

This means: website + ads, OR website + phone, OR ads + phone.
Never 3 channels. Gets to ROI faster.

---

## UPDATED EXECUTION ORDER

1. Fix industry guard in intel.ts (financial keywords override)
2. Fix STALL_HOLD to allow short affirmatives through
3. Fix shortBiz / bizName to strip "Pty Ltd"
4. CUT WOW: skip stalls 4/5/8 when thin, gate at 8
5. Auto-advance WOW on affirmatives
6. Combine ACV + timeframe into one turn
7. Max 2 channel stages in queue
8. Add turn 15 hard ceiling for ROI
9. Add "thanks for clarifying" to apology filter
10. tsc --noEmit call-brain-do
11. Deploy call-brain-do
12. Deploy deepgram-bridge-v11
13. Git commit + push

TARGET: Bella reaches ROI delivery by turn 12-15, not turn 25+.
