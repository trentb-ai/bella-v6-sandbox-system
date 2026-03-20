# CC STARTUP — DO Brain V1.1 Stage 1 Hardening
# Paste this into Claude Code. Follow EXACTLY.

## STEP 1: LOAD SKILLS (read ALL before writing ANY code)

### Core operating principles:
cat ~/.claude/skills/bella-gsd/SKILL.md

### Cloudflare infrastructure (this is a DO + service binding job):
cat ~/.claude/skills/bella-cloudflare/SKILL.md
cat ~/.claude/skills/bella-cloudflare/VERIFIED.md
cat ~/.claude/skills/cloudflare/workers-kv-do/SKILL.md
cat ~/.claude/skills/cloudflare/service-bindings.md
cat ~/.claude/skills/cloudflare/state-patterns.md
cat ~/.claude/skills/cloudflare/wrangler-cli.md

### Voice stack (bridge touches Deepgram):
cat ~/.claude/skills/bella-deepgram/SKILL.md
cat ~/.claude/skills/voice-ai-deepgram/deepgram-voice-agent-api.md

### Gemini prompting (prompt changes):
cat ~/.claude/skills/bella-gemini/SKILL.md

## STEP 2: READ PROJECT CONTEXT
cat CLAUDE.md
cat HANDOVER_SESSION_20MAR.md

## STEP 3: READ THE IMPLEMENTATION PACKET (this is your mandate)
cat DO_BRAIN_HARDENING_PACKET.md

## STEP 4: READ THE CODE YOU'RE MODIFYING
cat call-brain-do/src/index.ts
cat call-brain-do/src/types.ts
cat call-brain-do/src/state.ts
cat fast-intel-sandbox-v9/src/index.ts | head -1400
cat fast-intel-sandbox-v9/src/index.ts | tail -200

# Read the bridge V1.1 DO path section (the part you're changing):
grep -n "DO BRAIN PATH\|buildDOTurnPrompt\|buildTinyPrompt\|callDOTurn\|callDOSessionInit\|USE_DO_BRAIN" deepgram-bridge-v11/src/index.ts | head -30

## STEP 5: EXECUTE

The implementation packet (DO_BRAIN_HARDENING_PACKET.md) IS your mandate.
Execute in the order specified. One change at a time. Verify each compiles.

### Rules:
- GSD principles: DO, don't ask. Verify before advancing.
- One change → compile check → next change
- NEVER modify V1.0 files (deepgram-bridge-v9/, voice-agent-v9/, netlify-funnel-sandbox-v9/)
- Version bump on every deploy
- Deploy order: call-brain-do FIRST, then fast-intel, then bridge-v11
- If anything fails 3 times, STOP and report

### After all changes:
1. tsc --noEmit in call-brain-do/
2. wrangler deploy call-brain-do
3. wrangler deploy fast-intel (cd fast-intel-sandbox-v9 && npx wrangler deploy)
4. wrangler deploy bridge v11 (cd deepgram-bridge-v11 && npx wrangler deploy)
5. Verify secrets intact on all workers
6. Tail all 3 workers
7. Report what changed, file by file

If any existing code conflicts with DO_BRAIN_HARDENING_PACKET.md,
prioritize idempotency, single-state-authority, and prompt-budget
safety over backwards compatibility.
