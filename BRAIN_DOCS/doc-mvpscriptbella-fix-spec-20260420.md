# MVPScriptBella — FIX SPEC (Bridge Prompt Overhaul)
### Filed: 2026-04-20 ~19:45 AEST | Author: T9 Architect
### Status: SPEC READY FOR IMPLEMENTATION
### Deploy order: Sprint 1 (conflicts) → Sprint 2 (REACT-BRIDGE-DELIVER) → Sprint 3 (site content)

---

## SPRINT 1: Fix Prompt Conflicts (Deploy as single version bump)

### Fix 1A: Replace XML tags with plain text marker

**Why:** Output Rule 1 says "no XML tags." DELIVER_THIS uses XML tags. Sanitizer strips XML. Gemini confused.

**File:** `bridge/src/index.ts`

**Change 1a-i: All stall directives using `<DELIVER_THIS>`**

BEFORE (multiple locations — stalls 1, 2, 3, 4, 5, 6, 9, channel stages):
```
<DELIVER_THIS>script content here</DELIVER_THIS>
```

AFTER:
```
===SPEAK EXACTLY===
script content here
===END===
```

Locations to change:
- Line 1846 (stall 1)
- Line 1856 (stall 2)
- Line 1893 (stall 3)
- Line 1906 (stall 4)
- Line 1922 (stall 5)
- Line 1929 (stall 6)
- Line 1988 (stall 9)
- Line 2034 (ch_ads value)
- Line 2040 (ch_ads ROI — unreachable but clean up)
- All other channel DELIVER_THIS instances

**Change 1a-ii: Stalls using SAY: / SAY THIS:**

BEFORE (lines 1948, 1966, 1999, 2007, 2011, 2047, 2081, 2117, 2138, 2165, 2182, 2198):
```
SAY: "text here"
```
or
```
SAY THIS:
text here
```

AFTER:
```
===SPEAK EXACTLY===
text here
===END===
```

**Change 1a-iii: Update sanitizer**

BEFORE (line 733):
```typescript
    .replace(/DELIVER_THIS/gi, "")
```

AFTER:
```typescript
    .replace(/DELIVER_THIS/gi, "")
    .replace(/===SPEAK EXACTLY===/gi, "")
    .replace(/===END===/gi, "")
```

**Change 1a-iv: Update artifact detector**

BEFORE (line 775):
```typescript
  return /<[^>]*>|[<>]|DELIVER_THIS|MANDATORY SCRIPT/i.test(text);
```

AFTER:
```typescript
  return /<[^>]*>|[<>]|DELIVER_THIS|MANDATORY SCRIPT|===SPEAK EXACTLY===|===END===/i.test(text);
```

---

### Fix 1B: Reframe identity line

**Why:** "demonstration for a business prospect" triggers Gemini to explain demo mechanics. Reframe to consultation.

**File:** `bridge/src/index.ts` line 1474

BEFORE:
```
You are Bella, a live voice AI running a personalised AI Agent demonstration for a business prospect.
```

AFTER:
```
You are Bella, a live voice AI sales consultant. The person you are speaking with submitted their details on our website and you have already researched their business. You are having a personalised consultation about which AI agents would create the most value for them.
```

---

### Fix 1C: Remove "4 sentences maximum" rule

**Why:** Canonical script regularly exceeds 4 sentences (WOW 1 = 3 sentences, Recommendation ALL 3 = 6 sentences). Rule causes Gemini to truncate or paraphrase.

**File:** `bridge/src/index.ts` line 1710

BEFORE:
```
2. Use up to 3 statements and one question per turn, 4 sentences maximum.
```

AFTER:
```
2. Keep turns concise and natural. Deliver the scripted content in full — do not truncate. After delivering, ask at most one question.
```

---

### Fix 1D: Rewrite Output Rule 5 (the verbatim rule)

**Why:** Current rule self-contradicts ("EXACTLY as written" + "may add ONE sentence"). New version is clear.

**File:** `bridge/src/index.ts` line 1713

BEFORE:
```
5. VERBATIM DELIVERY: Text inside <DELIVER_THIS> tags is your EXACT spoken output. Speak it word-for-word. Do not paraphrase, reorder, add to, or rewrite ANY part of it. You may add ONE brief natural acknowledgment sentence BEFORE it (e.g. reacting to what they just said), but the DELIVER_THIS content must be spoken EXACTLY as written — every word, same order, no substitutions. If you change even one word, you have failed.
```

AFTER:
```
5. SCRIPT DELIVERY: Content between ===SPEAK EXACTLY=== and ===END=== markers is your scripted output. Speak it faithfully — same meaning, same key phrases, same facts, same questions. You MUST deliver ALL the content. Before the scripted content, you may add 1-2 natural sentences acknowledging what the prospect just said. After the scripted content, STOP. Do not add, remove, or rephrase the core message. Do not substitute your own version. The script was written by our team — deliver it as written.
```

---

### Fix 1E: Separate reference data into CONTEXT vs SCRIPT sections

**Why:** Gemini sees `Opener:` and `Website strength:` in flat reference list and treats them as competing scripts. Clear separation tells Gemini what's for speaking vs what's for context only.

**File:** `bridge/src/index.ts` lines 1537-1609 (buildFullSystemContext return)

BEFORE (lines 1599-1605 — flat list):
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

  // ── FREESTYLE CONTEXT (for natural reactions BETWEEN scripted beats — NEVER replace the script) ──
  const freestyleLines: string[] = [];
  freestyleLines.push(`\nFREESTYLE CONTEXT (use ONLY when reacting to unexpected prospect input — NEVER instead of the scripted content above):`);
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
```

And update the return (line 1609):

BEFORE:
```typescript
  return `${executionBlock}\n${intelLines.join("\n")}${marker}`;
```

AFTER:
```typescript
  return `${executionBlock}\n${intelLines.join("\n")}${freestyleLines.length > 1 ? "\n" + freestyleLines.join("\n") : ""}${marker}`;
```

---

### Fix 1F: Remove dead ROI references from output rules

**Why:** ROI disabled but rules 8 and 9 still reference it. Confuses Gemini with instructions about nonexistent content.

**File:** `bridge/src/index.ts` lines 1716-1717

BEFORE:
```
8. Do not improvise ROI formulas or benchmark claims. Use ONLY the exact dollar figures from the LIVE ROI section and the DELIVER_THIS text. Never multiply, divide, or restate the math yourself.
9. NO PHANTOM ROI: If the LIVE ROI section is empty or absent, do NOT reference any dollar uplift, weekly/monthly value, or "conservative estimate". You have NO calculated numbers to cite — talk about the methodology and what the agents CAN do, not fabricated dollar amounts.
```

AFTER:
```
8. NO DOLLAR CLAIMS: Do not invent revenue figures, ROI calculations, or specific dollar amounts. You may cite general benchmarks from AGENT KNOWLEDGE (e.g. "up to 4x more conversions") but never fabricate specific dollar amounts for this business.
```

(Merge into single clear rule. Delete rule 9 entirely.)

---

### Fix 1G: Fix "audit" language contradiction

**Why:** Execution rules say "do not turn into an audit" but stall 6 says "opportunity-audit questions."

**File:** `bridge/src/index.ts` line 1929

BEFORE:
```
<DELIVER_THIS>Perfect — so that confirms your agents are trained to bring in the right kind of ${ct}s and move them toward your key conversion points. I've just got a couple of quick opportunity-audit questions so I can work out which agent mix would be most valuable for ${biz}.</DELIVER_THIS>
```

AFTER (using new markers):
```
===SPEAK EXACTLY===
Perfect — so that confirms your agents are trained to bring in the right kind of ${ct}s and move them toward your key conversion points. I've just got a couple of quick questions so I can work out which agent mix would be most valuable for ${biz}.
===END===
```

(Remove "opportunity-audit" — just "quick questions")

---

### Fix 1H: Remove Rule 1 XML conflict

**Why:** Rule 1 says "No XML tags" which conflicts with any XML-style markers. Since we're moving to `===SPEAK EXACTLY===`, update Rule 1 to remove XML mention.

**File:** `bridge/src/index.ts` line 1709

BEFORE:
```
1. ONLY SPOKEN WORDS. No labels, headers, XML tags, markdown, code formatting, or symbols in the output.
```

AFTER:
```
1. ONLY SPOKEN WORDS in your output. No labels, headers, markdown, code formatting, section markers, or symbols. Just natural speech.
```

---

## SPRINT 2: REACT-BRIDGE-DELIVER Architecture

### Fix 2A: Update stall directive format

Every stall return changes structure. Example for stall 3:

BEFORE:
```typescript
return `WOW — ICP + PROBLEMS + SOLUTIONS
<DELIVER_THIS>${insightText}</DELIVER_THIS>
Then STOP and wait for their response.`;
```

AFTER:
```typescript
return `WOW — ICP + PROBLEMS + SOLUTIONS
REACT: Acknowledge what they just said naturally (1-2 sentences). Connect to your next point if possible.
===SPEAK EXACTLY===
${insightText}
===END===
Then STOP and wait for their response.`;
```

Apply same pattern to ALL stalls. The REACT line gives Gemini permission to acknowledge prospect input BEFORE delivering the script.

---

### Fix 2B: Add REDIRECT rule to output rules

Add after rule 8:

```
9. REDIRECT RULE: If the prospect asks an unexpected question, answer it concisely (1-2 sentences from AGENT KNOWLEDGE or FREESTYLE CONTEXT), then deliver your scripted content. Never follow them off-topic for more than 2 sentences. Never say "I'll get to that later." Answer briefly, then continue.
```

---

### Fix 2C: Add stall_turns safety net

**File:** `bridge/src/index.ts` — in the state management section

Add counter:
```typescript
// In state interface
stall_turns: number;  // tracks turns on current stall

// In turn processing (before buildStageDirective call)
if (s.stage === prevStage && s.stall === prevStall) {
  s.stall_turns = (s.stall_turns ?? 0) + 1;
} else {
  s.stall_turns = 0;
}
```

In buildStageDirective, check before each stall:
```typescript
if (s.stall_turns >= 2) {
  return `FORCE DELIVERY — you have been on this point for 2 turns without delivering the script.
Acknowledge briefly (one sentence), then deliver the following NOW:
===SPEAK EXACTLY===
${scriptContent}
===END===
Do not ask another question. Deliver and advance.`;
}
```

---

## SPRINT 3: Site Content Injection

### Fix 3A: Write condensed site summary in fast-intel

**File:** `fast-intel/src/index.ts` — after consultant call completes

Add a Gemini call to generate site knowledge summary:
```typescript
// After consultant returns, generate condensed site knowledge
const siteKnowledge = await generateSiteKnowledge(fc, consultant, env);

// In full envelope write:
site_knowledge: siteKnowledge,  // 2-3KB condensed site summary for Bella
```

The `generateSiteKnowledge` function:
```typescript
async function generateSiteKnowledge(fc: any, consultant: any, env: Env): Promise<string> {
  const markdown = fc?.markdown ?? fc?.raw_text ?? "";
  if (!markdown || markdown.length < 100) return "";
  
  const prompt = `Summarize this website content into a concise knowledge brief (max 2000 chars) for a voice AI sales agent. Include:
- Key services/products offered
- Notable pages (FAQ, pricing, case studies, team, resources)
- Unique selling points or differentiators
- Any specific claims, statistics, or social proof on the site
- Notable content or downloads available
Format as short bullet points. This is for SPEAKING reference, not reading aloud.

WEBSITE CONTENT:
${markdown.slice(0, 12000)}`;

  // Use Gemini Flash for speed
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 600 }
    })
  });
  
  if (!res.ok) return "";
  const data: any = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}
```

### Fix 3B: Bridge reads site_knowledge

**File:** `bridge/src/index.ts` — in buildFullSystemContext

Add after freestyleLines:
```typescript
// Site knowledge — condensed summary of actual website content
const siteKnowledge = intel.site_knowledge ?? intel.fast_intel?.site_knowledge ?? "";
if (siteKnowledge) {
  freestyleLines.push(`\nSITE KNOWLEDGE (reference when prospect asks about their website):\n${siteKnowledge}`);
}
```

---

## SPRINT 4: ~~Voice-Agent Service Binding~~ — DESCOPED

**DESCOPED 2026-04-21 by T9 Architect after CF docs audit.**

**Reason:** `voice-agent/src/index.ts` line 710 passes `BRIDGE_URL` to Deepgram's external agent API as the LLM endpoint configuration. Deepgram's servers call this URL from OUTSIDE Cloudflare — this is NOT a same-zone worker-to-worker fetch. Service binding cannot replace an external caller's endpoint.

**CF Docs Verified:**
- Error 1042 = same-zone worker fetch without `global_fetch_strictly_public` flag — does NOT apply here
- Service bindings only work for CF worker → CF worker calls within the account
- `[[services]]` syntax confirmed correct but irrelevant for this use case

**Public URL is architecturally correct for this pattern.**

---

## SPRINT 5: Stall 1 Text Update

### Fix 5A: Match canonical script

**File:** `bridge/src/index.ts` lines 1843-1847

BEFORE:
```typescript
if (s.stall === 1) {
  return `WOW — RESEARCH INTRO
<DELIVER_THIS>Now ${fn}, I think you'll be impressed. We've done some research on ${biz}, and we use that to pre-train your agents so they understand your ${ct}s, your industry, and how you win business. Can I quickly confirm a couple of our findings with you, just to make sure your agents are dialled in?</DELIVER_THIS>
Then STOP and wait for their response.`;
}
```

AFTER:
```typescript
if (s.stall === 1) {
  return `WOW — RESEARCH INTRO
REACT: This is the opening turn. No prior prospect input to acknowledge.
===SPEAK EXACTLY===
So ${fn}, your pre-trained ${biz} agents are ready to go. You play the role of a prospective customer, and your agents respond in real time like they've worked in the business for years — answering questions and moving people toward the actions that matter most. Before we begin, can I quickly confirm a couple of things so they're dialled in around the highest-value opportunities?
===END===
Then STOP and wait for their response.`;
}
```

### Fix 5B: Stall 2 text update

**File:** `bridge/src/index.ts` line 1856

BEFORE:
```
Oh ${fn}, I noticed ${biz} has a ${googleRating}-star reputation from ${googleReviews} reviews — that's strong. Businesses already delivering good ${ct} outcomes qualify for our free trial, so if you'd like, I can get that set up for you at any point during this demo.
```

AFTER:
```
And just before we get into it, I noticed ${biz} is sitting on ${googleRating} stars from ${googleReviews} reviews. That's a strong trust signal — and when the experience behind the scenes matches that, results tend to move quickly. We offer a small number of free trials to businesses in that position — so if this feels like a fit, we can activate that today.
```

---

## IMPLEMENTATION ORDER

| Sprint | Changes | Risk | Deploy as |
|--------|---------|------|-----------|
| 1 | Fix prompt conflicts (1A-1H) | Medium — prompt restructure | v9.43.0 |
| 2 | REACT-BRIDGE-DELIVER (2A-2C) | Medium — behavioral change | v9.44.0 |
| 5 | Update stall text to canonical script | Low — just text changes | Include in Sprint 1 or 2 |
| 3 | Site content injection | Low — additive | v9.45.0 (fast-intel) + v9.46.0 (bridge) |
| 4 | ~~Voice-agent service binding~~ | DESCOPED | N/A — Deepgram needs public URL |

**Canary after each sprint.** Multi-turn test confirming:
- Turn 1: Bella speaks stall 1 text matching canonical script
- Turn 3+: Bella speaks consultant icpNarrative verbatim
- If prospect asks question: Bella answers briefly then returns to script
- Recommendation: Bella delivers correct variant based on routing

---

## VERSION TRACKING

Current: bridge v9.41.0 (ROI descoped) → v9.42.0 (verbatim rule added by T4)
Next: v9.43.0 (Sprint 1 — full conflict resolution)
