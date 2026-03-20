# CC STARTUP PROMPT — DO Brain Migration
# Paste this into Claude Code to begin.
# Created: 2026-03-20 AEST

---

## STEP 1: READ SKILLS (before writing ANY code)

Read these skill files in order. They contain verified patterns, gotchas, and operating rules you MUST follow.

### Core Bella skills (read ALL):
```
cat ~/.claude/skills/bella-gsd/SKILL.md
cat ~/.claude/skills/bella-cloudflare/SKILL.md
cat ~/.claude/skills/bella-cloudflare/VERIFIED.md
cat ~/.claude/skills/bella-deepgram/SKILL.md
cat ~/.claude/skills/bella-deepgram/VERIFIED.md
cat ~/.claude/skills/bella-gemini/SKILL.md
cat ~/.claude/skills/bella-claude-code/SKILL.md
```

### Cloudflare infrastructure skills (read ALL — this is a DO build):
```
cat ~/.claude/skills/cloudflare/SKILL.md
cat ~/.claude/skills/cloudflare/workers-kv-do/SKILL.md
cat ~/.claude/skills/cloudflare/state-patterns.md
cat ~/.claude/skills/cloudflare/service-bindings.md
cat ~/.claude/skills/cloudflare/workflows/SKILL.md
cat ~/.claude/skills/cloudflare/wrangler-cli.md
cat ~/.claude/skills/cloudflare/troubleshooting.md
```

### Voice AI skills (read ALL — bridge touches Deepgram):
```
cat ~/.claude/skills/voice-ai-deepgram/SKILL.md
cat ~/.claude/skills/voice-ai-deepgram/deepgram-voice-agent-api.md
```

### Planning & execution skills (read ALL — this is orchestrated work):
```
cat ~/.claude/skills/orchestrator/SKILL.md
cat ~/.claude/skills/bella-gsd/SKILL.md
cat ~/.claude/skills/planning-with-files/SKILL.md
```

## STEP 2: READ PROJECT CONTEXT (after skills)

```
cat DO_BRAIN_IMPLEMENTATION_SPEC.md
cat CLAUDE.md
cat HANDOVER_SESSION_20MAR.md
cat BUG_REPORT_v9.13.2.md
```

## STEP 3: READ THE EXISTING CODE YOU'RE MODIFYING

Before writing any new code, read the actual deployed source:
```
cat deepgram-bridge-v9/src/index.ts    # The 2,680-line bridge you're extracting from
cat deepgram-bridge-v9/wrangler.toml   # Current bridge bindings
cat fast-intel-sandbox-v9/wrangler.toml # Current fast-intel bindings
cat voice-agent-v9/wrangler.toml       # Current voice agent bindings
```

## STEP 4: EXECUTE

The implementation spec (DO_BRAIN_IMPLEMENTATION_SPEC.md) IS your mandate.
Execute Phase A first (T016, T017 — bug fixes), then Phase B (T001-T009 — DO core).
One ticket at a time. Deploy → verify → next.

### Rules:
- GSD principles apply: DO, don't ask. Verify before advancing. One task per context.
- Version bump on every deploy. Tag format: v2.0.0-do-alpha.N
- Always --remote for KV operations
- Always bump VERSION string in worker code
- One change at a time → deploy → verify → next
- DO NOT touch V6 or V7 workers
- If any ticket fails 3 times, STOP and flag as blocked

### Deploy verification cycle:
1. npx wrangler deploy --dry-run
2. npx wrangler deploy
3. npx wrangler tail --format=json (watch 30s)
4. Run test if applicable
5. ONLY THEN move to next ticket
