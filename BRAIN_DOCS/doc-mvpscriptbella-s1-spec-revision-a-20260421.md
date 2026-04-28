# MVPScriptBella — S1 SPEC REVISION A
### Filed: 2026-04-21 AEST | Author: T9 Architect (Opus)
### Status: REVISION — supersedes conflicting sections of doc-mvpscriptbella-s1-implementation-spec-20260421
### Reason: ===SPEAK EXACTLY=== markers + separate REACT-BRIDGE-DELIVER instruction = competing systems. Gemini gets "be exact" AND "be natural" as separate rules. Creates the same paradox as old DELIVER_THIS system.

---

## THE PROBLEM

S1 spec has two instruction systems fighting each other:

1. **===SPEAK EXACTLY=== / ===END=== markers** inside each stall directive → tells Gemini "speak this content exactly as written"
2. **Section 2M REACT-BRIDGE-DELIVER global rule** → tells Gemini "first acknowledge naturally, then bridge, then deliver"
3. **Output Rule 5** → tells Gemini "speak it faithfully, you may add 1-2 natural sentences before"

Gemini resolves competing instructions unpredictably. Result: either robot mode (follows markers, ignores natural instruction) or paraphrase mode (follows natural instruction, drifts from script).

## TRENT'S DIRECTIVE (exact)

> SHE DELIVERS SCRIPT EXACTLY. SHE DELIVERS CONSULTANT SCRIPT EXACTLY. THOSE ARE FIXED. SHE MUST BE ABLE TO REACT NATURALLY AT THE BEGINNING OF THE TURN, IF SHE CAN AND SHE MUST BE ABLE TO GO OFF SCRIPT IF THE USER SAYS SOMETHING UNSCRIPTED, SHE MUST BE ABLE TO REFER TO HER KB AND THE USERS WEBSITE BLOB FROM THE SCRAPE AND SHE MUST BRING THE CONVERSATION BACK TO SCRIPT CONSTANTLY AND GET THE ANSWERS SHE NEEDS TO GET TO THE NEXT GATE.

## THE FIX

Replace all three competing systems with ONE unified instruction architecture:

1. **New markers:** `--- SCRIPT ---` / `--- END SCRIPT ---` (replaces ===SPEAK EXACTLY===)
2. **One TURN BEHAVIOR rule** in system prompt (replaces Output Rule 5 AND Section 2M)
3. **AGENT KNOWLEDGE block** in system prompt (KB for off-script answers)
4. **Website blob placeholder** (S4 — noted but not implemented)

---

## REVISION 1: Replace Output Rules 2 + 5 (supersedes S1 spec sections 2F + 2G)

### Output Rule 2 — NEW

BEFORE (current bridge):
```
2. Use up to 3 statements and one question per turn, 4 sentences maximum.
```

AFTER:
```
2. Keep turns natural in length. Deliver ALL scripted content — never truncate. Short natural reactions before the script are fine. After delivering, stop or ask at most one question.
```

### Output Rule 5 — DELETE ENTIRELY

The old Rule 5 (DELIVER_THIS verbatim) and the S1 spec's revised Rule 5 (===SPEAK EXACTLY=== faithfully) are BOTH removed. Script delivery is now handled by the TURN BEHAVIOR block below.

Renumber remaining rules (6→5, 7→6, 8→7).

---

## REVISION 2: New TURN BEHAVIOR block (supersedes S1 spec section 2M)

**DELETE** the Section 2M instruction:
```
TURN BEHAVIOR: When the prospect speaks, first REACT (acknowledge what they said in 1-2 sentences), then BRIDGE (natural transition), then DELIVER (the scripted content for this stall)...
```

**REPLACE** with this block, inserted AFTER the Output Rules and BEFORE the MANDATORY SCRIPT section in buildFullSystemContext:

```
---- TURN BEHAVIOR ----
Each turn, your stall directive contains SCRIPT content between --- SCRIPT --- and --- END SCRIPT --- markers.

HOW TO DELIVER:
1. If the prospect just said something, REACT naturally first (1-2 sentences max). Acknowledge what they said. Use FREESTYLE CONTEXT or AGENT KNOWLEDGE if it helps.
2. Then DELIVER the SCRIPT content. This content is sacred — deliver ALL of it WORD FOR WORD. Every line inside the SCRIPT markers was written deliberately — hardcoded lines by our sales team, consultant lines by our research team for this specific business. Do not skip, truncate, reword, or rephrase ANY of it. Deliver every word as written.
3. End with the question from the script. That question is how the conversation advances.

IF THE PROSPECT GOES OFF-SCRIPT:
- Answer their question briefly (1-3 sentences) using AGENT KNOWLEDGE, FREESTYLE CONTEXT, or what you know about their business.
- Then bridge back: "Great question — let me come back to that. Right now I want to make sure..."
- Then deliver your SCRIPT content.
- ALWAYS return to script. Never abandon the stall to chase a tangent.

IF THE PROSPECT ANSWERS YOUR GATE QUESTION:
- Acknowledge their answer naturally.
- The system will advance you to the next stall automatically.

WHAT YOU MUST NEVER DO:
- Change ANY word inside SCRIPT markers — hardcoded or consultant, both are WORD FOR WORD. No paraphrasing, no rewording, no "improving." Deliver exactly as written.
- Skip or truncate scripted content because you think the turn is "too long"
- Invent facts about the prospect's business that aren't in your context
- Ask "what does your business do?" — you already know from the scrape data

WHERE YOU CAN IMPROVISE:
- The 1-2 sentence REACT before the script (acknowledging what prospect said)
- Answering off-script questions using AGENT KNOWLEDGE, FREESTYLE CONTEXT, or business data
- Bridging back to script after an off-script moment
- These are the ONLY places you have creative freedom. Everything inside SCRIPT markers is locked.
---- END TURN BEHAVIOR ----
```

---

## REVISION 3: New stall markers (supersedes ALL ===SPEAK EXACTLY=== in S1 spec section 3E)

Replace every instance of `===SPEAK EXACTLY===` with `--- SCRIPT ---`
Replace every instance of `===END===` with `--- END SCRIPT ---`

The word "EXACTLY" triggers literal-parrot mode in Gemini. "SCRIPT" communicates "this is your content to deliver" without commanding robotic repetition. Combined with the TURN BEHAVIOR rule above, Gemini understands: deliver this faithfully but sound human.

### Updated buildStageDirective examples (showing marker change only):

WOW 1 high-data:
```typescript
return `--- SCRIPT ---
So ${fn}, your pre-trained ${biz} agents are ready to go.
You play the role of a prospective customer, and your agents respond in real time like they've worked in the business for years — answering questions and moving people toward the actions that matter most.
Before we begin, can I quickly confirm a couple of things so they're dialled in around the highest-value opportunities?
--- END SCRIPT ---`;
```

WOW 3 strong (consultant narrative):
```typescript
return `--- SCRIPT ---
${narrative}
Is that broadly how you think about the people you want more of?
--- END SCRIPT ---`;
```

WOW 6 (explore or recommend) — note: [RECOMMEND]/[DEEPER] signals stay outside markers:
```typescript
return `--- SCRIPT ---
We can either go a layer deeper for another minute, or I can show you exactly what I'd recommend based on what we've got so far.
Which would be more useful?
--- END SCRIPT ---

ROUTING: Based on the prospect's response, end your output with exactly one signal on its own line:
[RECOMMEND] — if they want the recommendation
[DEEPER] — if they want to explore more
If unclear, ask one clarifying question, then signal on next turn.`;
```

**Apply to ALL stalls in buildStageDirective.** Every `===SPEAK EXACTLY===` → `--- SCRIPT ---`, every `===END===` → `--- END SCRIPT ---`.

---

## REVISION 4: Updated sanitizer + artifact detector (supersedes S1 spec sections 2I + 2J)

### Sanitizer (line 733):

```typescript
    .replace(/DELIVER_THIS/gi, "")
    .replace(/---\s*SCRIPT\s*---/gi, "")
    .replace(/---\s*END SCRIPT\s*---/gi, "")
    .replace(/===SPEAK EXACTLY===/gi, "")
    .replace(/===END===/gi, "")
```

### Artifact detector (line 775):

```typescript
  return /<[^>]*>|[<>]|DELIVER_THIS|MANDATORY SCRIPT|---\s*SCRIPT\s*---|---\s*END SCRIPT\s*---|===SPEAK EXACTLY===|===END===/i.test(text);
```

Keep old markers in sanitizer/detector as safety net — if any old prompts leak through, they still get stripped.

---

## REVISION 5: AGENT KNOWLEDGE — KV-backed with hardcoded fallback

KB lives in KV at key `bella:agent_kb`. Read once on conversation init (first turn). Hardcoded default used if KV empty/missing. Update KB later by writing to KV — no code change, no deploy, no gate.

### 5A. Hardcoded fallback constant (add near top of file with other constants):

```typescript
const DEFAULT_AGENT_KB = `---- AGENT KNOWLEDGE (use when prospect asks about the agents, pricing, or how they work) ----
- Alex: Speed-to-lead AI agent. Follows up with new enquiries in under 30 seconds. Can drive up to 4x more conversions compared to slower response times. Handles initial qualification and books appointments.
- Chris: Website conversion AI agent. Engages visitors instantly on the website. Not just a chatbot — actively qualifies and moves visitors toward booking, enquiry, or purchase. Works 24/7.
- Maddie: Inbound call AI agent. Answers every inbound call, qualifies the opportunity, and books the right ones in. No more missed calls, no more voicemail.
- All agents are pre-trained on the prospect's specific business before the call.
- Trial: Small upfront to cover costs, then percentage of conversions generated. Performance-aligned.
- Onboarding: 20-minute setup call. Agents can be live within days.
---- END AGENT KNOWLEDGE ----`;
```

### 5B. KV read on conversation init (add alongside existing intel KV read on first turn):

```typescript
// Read agent KB from KV (once per conversation, first turn only)
let agentKb: string = DEFAULT_AGENT_KB;
if (s.turns_in_stall === 0 && s.stall === 1 && s.stage === 'wow') {
  const kbRaw = await env.LEADS_KV.get('bella:agent_kb', 'text');
  if (kbRaw && kbRaw.length > 50) {
    agentKb = `---- AGENT KNOWLEDGE (use when prospect asks about the agents, pricing, or how they work) ----\n${kbRaw}\n---- END AGENT KNOWLEDGE ----`;
  }
}
```

Store `agentKb` in a variable accessible to `buildFullSystemContext`. Options:
- Pass as parameter to buildFullSystemContext
- Or cache on the state object (add `_agentKb: string` to State, set once, reuse)

Recommended: cache on state. Add to State interface:
```typescript
  _agentKb: string;
```
Add to BLANK_STATE:
```typescript
  _agentKb: '',
```
Set on init:
```typescript
  state._agentKb = agentKb;
```

### 5C. Inject into buildFullSystemContext:

```typescript
  // ── AGENT KNOWLEDGE (KV-backed) ──
  const kbBlock = s._agentKb || DEFAULT_AGENT_KB;
```

Add to return statement:
```typescript
  return `${executionBlock}\n${intelLines.join("\n")}${freestyleLines.length > 2 ? "\n" + freestyleLines.join("\n") : ""}\n${kbBlock}${marker}`;
```

### 5D. Seed KV with hardcoded text (run once after deploy):

```bash
cd ~/Desktop/MVPScriptBella/workers/bridge
npx wrangler kv key put "bella:agent_kb" \
"- Alex: Speed-to-lead AI agent. Follows up with new enquiries in under 30 seconds. Can drive up to 4x more conversions compared to slower response times. Handles initial qualification and books appointments.
- Chris: Website conversion AI agent. Engages visitors instantly on the website. Not just a chatbot — actively qualifies and moves visitors toward booking, enquiry, or purchase. Works 24/7.
- Maddie: Inbound call AI agent. Answers every inbound call, qualifies the opportunity, and books the right ones in. No more missed calls, no more voicemail.
- All agents are pre-trained on the prospect's specific business before the call.
- Trial: Small upfront to cover costs, then percentage of conversions generated. Performance-aligned.
- Onboarding: 20-minute setup call. Agents can be live within days." \
  --namespace-id=0fec6982d8644118aba1830afd4a58cb --remote
```

### 5E. Future KB updates (no code change needed):

```bash
# Update KB content anytime — takes effect on next new conversation
npx wrangler kv key put "bella:agent_kb" "$(cat new-kb-content.txt)" \
  --namespace-id=0fec6982d8644118aba1830afd4a58cb --remote
```

---

## REVISION 6: Website blob placeholder (S4 — NOT implemented now)

Add a comment in buildFullSystemContext where the website blob will go:

```typescript
  // ── SITE CONTENT (S4 — post-launch) ──
  // Future: read page_content.markdown from KV (lead:{lid}:fast-intel → site_content_blob)
  // Inject as additional freestyle knowledge for "did you see our pricing page?" type questions
  // Same pattern as agent KB: KV read on init, cache on state, inject into system prompt
```

No code change. Marker for S4 implementer. Same KV-read-and-cache pattern as KB.

---

## REVISION 7: Updated VERIFY greps (supersedes S1 spec section 5)

Replace the marker-check greps:

```bash
# OLD (remove these checks):
rg '===SPEAK EXACTLY===' index.ts  # should find ~15+ occurrences
rg '===END===' index.ts            # same count

# NEW:
rg '--- SCRIPT ---' index.ts       # should find ~15+ occurrences
rg '--- END SCRIPT ---' index.ts   # same count
rg 'TURN BEHAVIOR' index.ts        # should find 1 (in system prompt)
rg 'AGENT KNOWLEDGE' index.ts      # should find in DEFAULT_AGENT_KB + buildFullSystemContext
rg 'bella:agent_kb' index.ts       # should find 1 (KV read on init)
rg 'FREESTYLE CONTEXT' index.ts    # should find 2 (open + close markers)
rg 'REACT.*BRIDGE.*DELIVER' index.ts  # should find 0 (REMOVED — old system)
```

---

## SUMMARY OF WHAT CHANGES IN S1 SPEC

| S1 Spec Section | Status | What Changes |
|-----------------|--------|-------------|
| 2F (Output Rule 2) | REVISED | "Natural length" not "4 sentences max" — but also "deliver ALL scripted content" |
| 2G (Output Rule 5) | DELETED | Replaced entirely by TURN BEHAVIOR block |
| 2I (Sanitizer) | REVISED | New markers: `--- SCRIPT ---` / `--- END SCRIPT ---` |
| 2J (Artifact detector) | REVISED | New markers added to regex |
| 2K (Freestyle context) | UNCHANGED | Still valid |
| 2M (REACT-BRIDGE-DELIVER) | DELETED + REPLACED | New TURN BEHAVIOR block |
| 3E (buildStageDirective) | MARKER CHANGE | All ===SPEAK EXACTLY=== → --- SCRIPT ---, all ===END=== → --- END SCRIPT --- |
| NEW | ADDED | AGENT KNOWLEDGE — KV-backed (`bella:agent_kb`) with hardcoded fallback, read once on init, cached on state |
| NEW | ADDED | KV seed command for initial KB content |
| NEW | ADDED | Website blob placeholder comment (S4) |
| NEW | ADDED | `_agentKb` field on State interface |
| Section 5 (Verify) | REVISED | Updated grep checks |

Everything else in S1 spec (DELETE scope, State interface, gateOpen, advance, resolveRoutingVariant, buildStageDirective LOGIC, wiring, canary) remains UNCHANGED.

---

## WHY THIS WORKS

One system, not three. Gemini gets:

1. **TURN BEHAVIOR** — global rule explaining: react naturally, then deliver script, handle off-script with KB, always return
2. **--- SCRIPT ---** markers — per-stall content to deliver (not "EXACTLY" — just "SCRIPT")
3. **AGENT KNOWLEDGE** — KB for off-script answers about agents/pricing/process
4. **FREESTYLE CONTEXT** — consultant data for natural reactions about the prospect's business

No competing instructions. No "be exact" in one place and "be natural" in another. One unified behavior model: **deliver the script faithfully like a skilled professional, react naturally around it, use your knowledge when needed, always come back.**

---

## DOCUMENTS REFERENCED

| Doc | Purpose |
|-----|---------|
| doc-mvpscriptbella-s1-implementation-spec-20260421 | Parent spec (sections superseded by this revision) |
| doc-mvpscriptbella-t9-architectural-plan-final-20260421 | Architectural plan |
| doc-bella-mvp-script-final-20260420 | Canonical script |
| doc-mvpscriptbella-natural-response-architecture-20260420 | REACT-BRIDGE-DELIVER concept (valid concepts, rigid structure killed) |
