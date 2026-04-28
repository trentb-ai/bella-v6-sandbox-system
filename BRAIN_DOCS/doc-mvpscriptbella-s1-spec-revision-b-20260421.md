# MVPScriptBella — S1 SPEC REVISION B
### Filed: 2026-04-21 AEST | Author: T9 Architect (Opus)
### Status: REVISION — fixes T3 SPEC_STRESS_TEST failures (P0-1, P0-2, P1-1, P1-2/P1-3, P2-2)
### Supersedes: S1 spec sections 4B, 4D + Revision A section 5B

---

## T3 FINDINGS ADDRESSED

| ID | Severity | Issue | Fix |
|----|----------|-------|-----|
| P0-1 | BLOCKER | 4D capture checks s.stall AFTER advance() already moved it | Save prevStall before advance, use prevStall in capture |
| P0-2 | BLOCKER | KB read ordering ambiguous — T4 will place wrong | Explicit ordering: KB read BEFORE turns_in_stall increment |
| P1-1 | FIX | [SKIP] marker + handler is dead code (gateOpen already handles) | Delete [SKIP] return from case 2, delete handler from 4B |
| P1-2/3 | FIX | Stall 6 hold behavior undocumented | Add explicit policy statement |
| P2-2 | ADVISORY | "STALL: 8 of 7" label wrong | Fix label |

---

## FIX 1: Complete turn handler rewrite (supersedes S1 spec section 4B + 4D)

The turn handler is the most critical ordering section. This replaces 4B and 4D with ONE unified block showing exact execution order.

```typescript
// ═══════════════════════════════════════════════
// TURN HANDLER — execution order is CRITICAL
// ═══════════════════════════════════════════════

// STEP 0: KB init (first turn of conversation only)
if (s.stage === 'wow' && s.stall === 1 && s.turns_in_stall === 0) {
  const kbRaw = await env.LEADS_KV.get('bella:agent_kb', 'text');
  if (kbRaw && kbRaw.length > 50) {
    s._agentKb = `---- AGENT KNOWLEDGE (use when prospect asks about the agents, pricing, or how they work) ----\n${kbRaw}\n---- END AGENT KNOWLEDGE ----`;
  } else {
    s._agentKb = DEFAULT_AGENT_KB;
  }
}

// STEP 1: Capture answers BEFORE advance (uses current stall, not next)
const prevStall = s.stall;
const prevStage = s.stage;

if (prevStage === 'wow' && prevStall === 7 && s.turns_in_stall >= 1) {
  s.confirmed.source_answer = utterance.substring(0, 200);
}
if (prevStage === 'wow' && prevStall === 8 && s.turns_in_stall >= 1) {
  s.confirmed.funnel_answer = utterance.substring(0, 200);
}

// STEP 2: Increment turns_in_stall (AFTER KB init, AFTER capture)
s.turns_in_stall += 1;

// STEP 3: Gate check + advance
if (gateOpen(s, utterance)) {
  s = advance(s, utterance);
}

// STEP 4: Build directive for CURRENT stall (post-advance)
const directive = buildStageDirective(s, fn, biz, ct, intel);

// ═══════════════════════════════════════════════
// END TURN HANDLER
// ═══════════════════════════════════════════════
```

### What changed from original 4B + 4D:
- **prevStall/prevStage** saved BEFORE advance — captures use these, not post-advance values
- **KB read** is STEP 0, explicitly before turns_in_stall increment
- **Capture** (source_answer, funnel_answer) is STEP 1, before advance
- **[SKIP] handler deleted** — gateOpen already returns true for stall 2 with no rating, advance moves past it
- **4D section deleted entirely** — capture logic folded into STEP 1 of unified handler

---

## FIX 2: Delete [SKIP] from buildStageDirective case 2 (supersedes S1 spec section 3E, WOW 2)

S1 spec section 3E, WOW 2 case, currently returns:
```typescript
if (!rating || rating < 3) {
  return '[SKIP — no Google rating data. Advance to next stall.]';
}
```

DELETE that entire if-block. gateOpen already handles this:
```typescript
// WOW 2 skip: no Google rating → auto-advance
if (s.stall === 2 && s.confirmed.googleRating === null) return true;
```

And advance already handles it:
```typescript
// WOW 2 skip (no Google rating)
if (s.stall === 2 && s.confirmed.googleRating === null) {
  next.stall = 3;
  return next;
}
```

The buildStageDirective case 2 should ONLY have the two delivery variants (strong + medium). If case 2 is ever reached, it means we have rating data:

```typescript
// ── WOW 2: Reputation Trial ──
case 2: {
  const rating = s.confirmed.googleRating!;
  const reviews = s.confirmed.googleReviews;
  if (rating >= 4.0 && reviews && reviews > 20) {
    return `--- SCRIPT ---
And just before we get into it, I noticed ${biz} is sitting on ${rating} stars from ${reviews} reviews.
That's a strong trust signal — and when the experience behind the scenes matches that, results tend to move quickly.
We offer a small number of free trials to businesses in that position — so if this feels like a fit, we can activate that today.
--- END SCRIPT ---`;
  }
  return `--- SCRIPT ---
I can see ${biz} has established a presence on Google — that's a good foundation to build from.
We offer a small number of free trials to businesses in your position — so if this feels like a fit, we can activate that today.
--- END SCRIPT ---`;
}
```

---

## FIX 3: Stall 6 hold policy (NEW — add to spec as explicit policy statement)

Add this policy note in S1 spec section 3B (gateOpen), after the WOW 6 block:

```
STALL 6 HOLD POLICY:
- Stall 6 holds until prospect utterance matches recommend or deeper regex
- Safety net: turns_in_stall >= 2 forces advance (existing safety net in gateOpen)
- When safety net fires, advance() receives the raw utterance — wantsDeeper regex runs again
- If utterance is ambiguous (okay/sure/I see/hmm) → wantsDeeper = false → recommend path
- This is INTENDED PRODUCT BEHAVIOR: ambiguous = recommend. Prospect must explicitly say "deeper/explore/more/tell me more" to go deeper. Default path is recommend.
```

Also update gateOpen stall 6 block to make safety net behavior explicit:

```typescript
// WOW 6: need explicit signal OR safety net
if (s.stall === 6) {
  const lower = utterance.toLowerCase();
  const wantsRecommend = /\brecommend|let's hear|go ahead|show me|what do you suggest|your pick/i.test(lower);
  const wantsDeeper = /\bdeeper|explore|more|tell me more|dig in|keep going/i.test(lower);
  if (wantsRecommend || wantsDeeper) return true;
  // Safety net: force advance after 2 turns (will default to recommend in advance())
  if (s.turns_in_stall >= 2) return true;
  return false;
}
```

---

## FIX 4: Stall label (supersedes S1 spec section 2N)

P2-2: "STALL: 8 of 7" is wrong when on funnel questions (stall 8).

Replace:
```typescript
const stageLabel = s.stage === 'wow'
  ? `STAGE: wow | STALL: ${s.stall} of 7 | ${STALL_NAMES[s.stall] ?? 'unknown'}`
  : `STAGE: ${s.stage}`;
```

With:
```typescript
const stallTotal = s.stall <= 7 ? 7 : s.stall; // funnel Qs = stall 8, show "8 of 8"
const stageLabel = s.stage === 'wow'
  ? `STAGE: wow | STALL: ${s.stall} of ${stallTotal} | ${STALL_NAMES[s.stall] ?? 'unknown'}`
  : `STAGE: ${s.stage}`;
```

---

## FIX 5: KB read wrapper in Revision A (supersedes Revision A section 5B)

Revision A section 5B had ambiguous placement. Replaced by STEP 0 in Fix 1 above. The rest of Revision A section 5 (5A constant, 5C injection, 5D seed, 5E future updates) remains unchanged.

---

## VERIFY ADDITIONS (add to S1 spec section 5)

```bash
# New checks after Revision B:
rg 'prevStall|prevStage' index.ts    # should find in turn handler
rg 'DEFAULT_AGENT_KB' index.ts       # should find constant + fallback
rg 'bella:agent_kb' index.ts         # should find 1 KV read
rg '\[SKIP' index.ts                 # should find 0 (dead code removed)
```

---

## T4 INSTRUCTION NOTE (P2-3)

T3 advisory P2-3: All line numbers in S1 spec section 1 (DELETE) reference the file state at time of spec writing. T4 MUST read the current file and verify line numbers match before deleting. The spec itself already has this caveat (line 18: "Implementer MUST read the file first and verify line numbers match") but T4 must actually do it.

---

## DOCUMENTS REFERENCED

| Doc | Purpose |
|-----|---------|
| doc-mvpscriptbella-s1-implementation-spec-20260421 | Base S1 spec |
| doc-mvpscriptbella-s1-spec-revision-a-20260421 | Revision A (markers, TURN BEHAVIOR, KB) |
| T3 SPEC_STRESS_TEST results via T2 | P0/P1/P2 findings |
