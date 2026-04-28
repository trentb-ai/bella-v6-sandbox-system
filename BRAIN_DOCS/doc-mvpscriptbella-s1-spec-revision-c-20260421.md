# MVPScriptBella — S1 SPEC REVISION C
### Filed: 2026-04-21 AEST | Author: T9 Architect (Opus)
### Status: REVISION — fixes remaining P0-1 (capture guard prevents capture)
### Supersedes: Revision B STEP 1 capture block only

---

## THE BUG

Revision B STEP 1 has `s.turns_in_stall >= 1` guard on capture. But advance() resets turns_in_stall to 0 when entering stall 7/8. Sequence:

1. Prospect answers WOW 7 question
2. Turn handler fires. s.stall=7, turns_in_stall=0 (reset by advance on entry)
3. STEP 1: `turns_in_stall >= 1` → FALSE → no capture
4. STEP 2: increment to 1
5. STEP 3: gateOpen (turns_in_stall >= 1 = true) → advance → stall 8, reset to 0
6. source_answer = null. Bug.

## THE FIX

Remove `&& s.turns_in_stall >= 1` from both capture conditions. Capture fires every turn at stall 7/8. Last write before advance wins — correct behavior.

Replace Revision B STEP 1 with:

```typescript
// STEP 1: Capture answers BEFORE advance (uses current stall, not next)
const prevStall = s.stall;
const prevStage = s.stage;

if (prevStage === 'wow' && prevStall === 7) {
  s.confirmed.source_answer = utterance.substring(0, 200);
}
if (prevStage === 'wow' && prevStall === 8) {
  s.confirmed.funnel_answer = utterance.substring(0, 200);
}
```

No other changes. All other Revision B fixes verified PASS by T3.
