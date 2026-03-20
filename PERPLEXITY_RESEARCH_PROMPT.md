# PERPLEXITY RESEARCH PROMPT — Bella V9 Skills Sources

We're building a Claude Code skills library (`~/.claude/skills/`) for an AI voice agent system built on Cloudflare Workers. We need OFFICIAL documentation, GitHub repos, and authoritative sources for the following. For each item, give us:
1. The official docs URL
2. Any GitHub repo with reference implementations or examples
3. Key API signatures / patterns we should capture in our skill files

---

## CLOUDFLARE (Critical — our entire stack)

### 1. Cloudflare Workflows API (Durable Steps)
We need the official docs for `WorkflowEntrypoint`, `WorkflowStep`, `step.do()`, retry configuration, parallel execution within steps, workflow status checking, and `wrangler.toml` configuration for workflows. This is NOT the Agents SDK — this is the standalone Workflows API for durable multi-step background processing.
- What is the current API surface for `step.do()`?
- What retry options exist (limit, delay, backoff)?
- Can you run `Promise.allSettled()` inside a single `step.do()`?
- How do you trigger a workflow from another worker?
- How do you check workflow instance status?
- What's the wrangler.toml config for [[workflows]]?

### 2. Cloudflare Service Bindings
Official docs for worker-to-worker service bindings. The `Fetcher` type, wrangler.toml `[[services]]` config, how the URL hostname is handled (ignored?), and any gotchas around headers/body propagation.

### 3. Cloudflare Workers KV
Official API reference for KV operations in Workers runtime (`env.KV.get()`, `env.KV.put()`, `env.KV.list()`, `env.KV.delete()`). Also the wrangler CLI commands for KV (`wrangler kv:key get/put/list/delete`). Specifically: does the `--remote` flag exist and what does it do? What's the consistency model (eventual consistency window)?

### 4. Cloudflare Durable Objects (Raw, not Agents SDK)
Official docs for raw Durable Objects: `DurableObjectState`, `acceptWebSocket()`, WebSocket hibernation API, `webSocketMessage`/`webSocketClose` handlers, alarms, and `connection.request` behavior. NOT the Agents SDK wrapper — the raw DO API.

### 5. Wrangler CLI Reference
Current wrangler CLI commands for: deploy, tail (with --format options), secrets (put/list/delete), KV operations, dev mode, and deployments list/rollback.

---

## DEEPGRAM (Our voice stack)

### 6. Deepgram Voice Agent API
Official docs for the Deepgram Voice Agent API (NOT just STT/TTS). Specifically:
- BYO LLM (Bring Your Own LLM) configuration
- The `UpdateThink` message type
- Flux mode (`flux-general-en`) — what is it, how to configure per-stage
- Nova-3 STT model
- Aura-2 TTS voices (specifically Aura-2-Theia-EN)
- Turn detection / VAD settings
- WebSocket message types and flow
- Function calling / tools integration
- Any official GitHub repos with Voice Agent examples

### 7. Deepgram Duplicate Request Handling
How does the Voice Agent API handle duplicate requests when using BYO LLM? Is there built-in dedup? What happens if the bridge responds twice to the same turn?

---

## GEMINI (Our LLM)

### 8. Gemini 2.5 Flash — Instruction Following
Official docs or research on Gemini 2.5 Flash's instruction-following behavior. Specifically:
- Does it respect "SAY EXACTLY THIS" type directives?
- Known issues with paraphrasing scripted content
- Temperature effects on instruction compliance
- Any prompt engineering guides from Google for strict output control
- System prompt vs user prompt priority behavior

---

## CLAUDE CODE SKILLS

### 9. "Get Shit Done" / Execution-Focused Skills
Find repos or resources for Claude Code skills focused on aggressive autonomous execution — minimal asking, maximum doing. Sometimes called "get shit done mode", "autonomous execution", or "agentic coding" skills. Look for:
- GitHub repos with `.claude/skills/` or `.claude/commands/` directories
- Any "awesome claude code" lists or skill collections
- Skills that enforce: no unnecessary confirmation, take maximum action, deploy-and-verify patterns
- The `awesome-claude-code` repo if it exists

### 10. Claude Code Skills — Best Collections
Find the best public repositories or collections of Claude Code skills (the `~/.claude/skills/` format). We already have skills from:
- `superpowers` (systematic-debugging, executing-plans, subagent-driven-development)
- `claudekit` (backend debugging)
- `planning-with-files` (Manus-style file planning)
- `orchestrator` (PLAN.md driven orchestration)
- `project-planner` (structured plan generation)

What other high-quality skill collections exist? Specifically looking for:
- Cloudflare-specific skills
- Voice AI / real-time systems skills
- Deploy-and-verify workflow skills
- Test automation skills

---

## APIFY (Our scraping infrastructure)

### 11. Apify API — Actor Runs and Datasets
Official API docs for: starting actor runs (`POST /v2/acts/{actorId}/runs`), polling run status, fetching dataset items. We use the `startUrls` input format for Facebook ads scraper. What's the current API for starting runs, checking status, and retrieving results?

---

## FIRECRAWL (Our primary scraper)

### 12. Firecrawl REST API
Official docs for the Firecrawl scrape API. All endpoints, authentication, the `scrape` endpoint specifically, response format, and any rate limiting. Also: does ScrapingAnt work as a fallback proxy?

---

## GOOGLE PLACES API

### 13. Google Places API (New)
Official docs for the Google Places API (new version). Text Search endpoint for cross-referencing business names, getting ratings and review counts. What's the current endpoint, auth method, and response format?

---

Please provide direct URLs to official documentation pages, not just domain-level links. If GitHub repos exist with working examples, link to specific directories or files where possible.
