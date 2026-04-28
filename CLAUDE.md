# BELLA — CLAUDE CODE MASTER BRIEF
### Last updated: 2026-04-27 AEST | Authority: Trent Belasco
### Active stack: Think Agent V1 (bella-think-agent-v1-brain) + V2-rescript voice layer

---

> ## 🟢 BELLA GOLDEN v1 — KNOWN-GOOD RESTORE POINT
>
> **Git tag:** `bella-golden-v1` | **Commit:** `8e23c66` | **Date:** 2026-04-03
>
> | Worker | Version | Folder | Deploys As |
> |--------|---------|--------|------------|
> | Brain | v6.16.1 | `brain-v2-rescript/` | `call-brain-do-v2-rescript` |
> | Bridge | v9.40.0 | `bridge-v2-rescript/` | `deepgram-bridge-v2-rescript` |
> | Fast-intel | v1.18.0 | `fast-intel-v9-rescript/` | `fast-intel-v9-rescript` |
> | Scrape | v1.7.0 | `bella-scrape-workflow-v10-rescript/` | `bella-scrape-workflow-v10-rescript` |
>
> **Restore:**
> ```bash
> git checkout bella-golden-v1
> cd brain-v2-rescript && npx wrangler deploy
> cd ../bridge-v2-rescript && npx wrangler deploy
> cd ../fast-intel-v9-rescript && npx wrangler deploy
> cd ../bella-scrape-workflow-v10-rescript && npx wrangler deploy
> ```
>
> **Live test result:** 10/10 stages (WOW1-8 + recommendation + close), all compliance 1.00, zero errors.

---

> **V2-RESCRIPT — LIVE WORKERS (frontend: `cleanestbellav2rescripted.netlify.app`)**
>
> | Folder | Deploys As |
> |--------|-----------|
> | `brain-v2-rescript/` | `call-brain-do-v2-rescript` |
> | `bridge-v2-rescript/` | `deepgram-bridge-v2-rescript` |
> | `bella-voice-agent-v2-rescript/` | `bella-voice-agent-v2-rescript` |
> | `fast-intel-v9-rescript/` | `fast-intel-v9-rescript` |
> | `bella-scrape-workflow-v10-rescript/` | `bella-scrape-workflow-v10-rescript` |
>
> **⚠️ THINK AGENT V1 — Active brain build**
> Dir: `/Users/trentbelasco/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/`
> Voice: `frozen-bella-natural-voice` → Think router (`bella-think-agent-v1-bridge`) → Think brain
> Frontend: `dapper-lily-66c68a.netlify.app`

---

## CRITICAL RULES — READ FIRST

1. **One problem at a time.** Pick ONE layer. Deploy → verify → next.
2. **Bridge is READ-ONLY from `lead:{lid}:fast-intel`.** Bridge writes ONLY: `script_state`, `conv_memory`, `captured_inputs`, `bridge_system`.
3. **No unsolicited tests or browser opens.** Wait for Trent.
4. **Always bump VERSION string** on every deploy.
5. **Always pipe wrangler tail through `tee`** to `/logs/` folder.
6. **Use fresh browser tab + fresh LID** between tests.
7. **Read actual source files before acting.** This doc may lag deploys.

**KV namespace:** `leads-kv` ID `0fec6982d8644118aba1830afd4a58cb`
**Shared brain D1:** `2001aba8-d651-41c0-9bd0-8d98866b057c`
**CF Account:** `9488d0601315a70cac36f9bd87aa4e82`

---

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **bella-v6-sandbox-system** (24257 symbols, 30650 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/bella-v6-sandbox-system/context` | Codebase overview, check index freshness |
| `gitnexus://repo/bella-v6-sandbox-system/clusters` | All functional areas |
| `gitnexus://repo/bella-v6-sandbox-system/processes` | All execution flows |
| `gitnexus://repo/bella-v6-sandbox-system/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
