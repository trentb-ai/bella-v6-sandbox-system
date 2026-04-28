# BELLA — Natural Response Architecture (REACT-BRIDGE-DELIVER)
### Filed: 2026-04-20 | Authority: T9 Architect + Trent Belasco
### Status: APPROVED DIRECTION — implement after verbatim compliance fix tested

---

## THE PROBLEM

Bella has two broken modes:
1. **Robot mode** — DELIVER_THIS verbatim, ignores what prospect said
2. **Improv mode** — Gemini freestyles from system prompt identity, loses the script

Neither produces natural conversation. A real salesperson LISTENS, ACKNOWLEDGES, then BRIDGES BACK to their point.

---

## THE FIX: Three-Part Turn Structure (REACT-BRIDGE-DELIVER)

Every stage directive changes from:

```
<DELIVER_THIS>exact text</DELIVER_THIS>
Then STOP.
```

To:

```
<TURN_DIRECTIVE>
REACT: Acknowledge what they just said (1-2 sentences max). Show you heard them. 
       If what they said connects to your next point, use that connection.
       If off-topic, acknowledge briefly ("Got it" / "Interesting" / "Makes sense").
BRIDGE: Transition naturally to your script point. Use phrases like:
       - "That actually connects to something I noticed..."
       - "And that's exactly why..."  
       - "Now on that note..."
       - "Which brings me to..."
DELIVER: [script content — the KEY MEANING must land, anchored to these facts/offers]
</TURN_DIRECTIVE>
```

---

## EXAMPLES

### Stall 3 (ICP) — Prospect says "Yeah that's pretty much right"

❌ Robot: "[next script line with no acknowledgment]"
❌ Improv: "Great! So tell me more about your ideal customers and what challenges they face..."
✅ Natural: "Good — so we're on the same page there. And that's exactly the profile your agents are trained against, which means when someone fitting that description lands on your site, Chris already knows how to engage them. Now the main action your site seems to be driving is..."

### Stall 7 (Lead Source) — Prospect says "Honestly most of it comes from word of mouth"

❌ Robot: "Apart from referrals, what would you say is your main source..."
❌ Improv: "Word of mouth is great! Let me tell you about how we can amplify that..."
✅ Natural: "Word of mouth — that's a strong foundation. The question then is what's the next biggest channel after that? Because that's where the agents create the most leverage. Are you seeing much from your website, ads, or inbound calls?"

### Objection — "Can you just send me some info?"

❌ Robot: "[delivers objection script robotically]"
❌ Improv: "Sure! What's your email? I'll send everything over..."
✅ Natural: "Of course — I can do that. But honestly this only really clicks when you see it running against your own business context. How about we lock in a quick 20-minute session — I'll walk you through it properly, and send everything after so it actually makes sense. What's a good time?"

---

## IMPLEMENTATION SPEC

### 1. Change directive structure in buildStageDirective()

Every stall return changes from:
```typescript
return `WOW — [STAGE NAME]
<DELIVER_THIS>${scriptLine}</DELIVER_THIS>
Then STOP and wait for their response.`;
```

To:
```typescript
return `WOW — [STAGE NAME]
REACT: Acknowledge what they just said naturally (1-2 sentences). Connect to your point if possible.
DELIVER: ${scriptLine}
QUESTION: [if applicable — the question that ends this turn]
Then STOP and wait.`;
```

### 2. Update Output Rule 5 (line 1713)

Replace:
```
5. SCRIPT COMPLIANCE: Deliver the scripted instruction from the MANDATORY SCRIPT section exactly as written. You may add ONE brief natural sentence before it, but the scripted line must remain WORD-FOR-WORD unchanged.
```

With:
```
5. NATURAL DELIVERY: Every turn has three parts:
   a) REACT — acknowledge what the prospect just said (1-2 sentences, natural, shows you listened)
   b) BRIDGE — transition naturally to your script point (one short phrase)
   c) DELIVER — speak the script content faithfully. Key facts, offers, and questions must land exactly. You may adjust minor phrasing for conversational flow but NEVER drop, change, or skip the core content.
   If the prospect asks a direct question, answer it concisely from AGENT KNOWLEDGE first, then deliver your script point.
   NEVER ignore what they said. NEVER follow them off-topic for more than one sentence.
```

### 3. Inject conversationHooks from consultant

The consultant already generates `conversationHooks` (confirmed in KV). Currently unused in stage directives.

Add to the turnPrompt context:
```typescript
const hooks = intel.consultant?.conversationHooks ?? [];
const hooksSection = hooks.length 
  ? `\nCONVERSATION HOOKS (use to react naturally):\n${hooks.map(h => `- ${h}`).join('\n')}`
  : "";
```

These give Bella pre-built reactions to common prospect responses.

### 4. Add REDIRECT rule to output rules

```
REDIRECT RULE: If the prospect goes off-topic, acknowledge in ONE sentence, then bridge back:
- "Got it. Now [script point]..."
- "Makes sense. And actually [script point]..."
- "Interesting — and that connects to [script point]..."
Never follow them off-script for more than one sentence. Never say "I'll get to that later."
If they ask about pricing/agents/how-it-works, answer from AGENT KNOWLEDGE (2 sentences max), then return to directive.
```

### 5. Stall safety net

If Bella hasn't delivered the script content after 2 turns on the same stall (prospect keeps going off-topic), the stage controller forces delivery:

```typescript
if (s.stall_turns >= 2) {
  return `FORCE DELIVER — you've been on this point for 2 turns. 
  Acknowledge briefly, then deliver this NOW: ${scriptLine}
  Do not ask another question. Deliver and advance.`;
}
```

---

## WHAT DOESN'T CHANGE

- Stage machine still controls progression
- Consultant still generates the script content (icpNarrative, convNarrative, etc.)
- DELIVER content still comes from consultant scriptFills / narratives
- Bridge still builds the full system prompt
- Stall count still gates advancement

---

## RISK MITIGATION

| Risk | Guard |
|------|-------|
| Gemini drifts, never delivers script | stall_turns >= 2 forces delivery |
| Gemini over-reacts, turn too long | "1-2 sentences max" + 4-sentence output rule |
| Gemini answers questions forever | "2 sentences max from AGENT KNOWLEDGE, then return" |
| Prospect hijacks to objection | Objection handlers already scripted — stage machine routes there |

---

## IMPLEMENTATION ORDER

1. **Fix verbatim first** — strengthen output rule 5 to test if Gemini CAN follow DELIVER_THIS
2. **If still paraphrasing** — implement REACT-BRIDGE-DELIVER (this spec)
3. **Add conversationHooks injection** — low-effort, high-value
4. **Add stall_turns safety net** — prevents infinite loops

Step 1 is already specced and sent to T2. This doc is the full architecture for steps 2-4.
