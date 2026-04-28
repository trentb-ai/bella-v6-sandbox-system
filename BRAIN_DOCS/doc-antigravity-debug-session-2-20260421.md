# ANTIGRAVITY IDE DEBUG SESSION 2 — 2026-04-21
## Filed: 2026-04-21 12:45 AEST | Author: T2 Code Lead (Opus)
## D1 ID: doc-antigravity-debug-session-2-20260421
## Continues from: doc-antigravity-debug-session-20260421

---

## SUMMARY

Follow-up debug session fixing remaining Antigravity MCP server errors. Four bugs fixed, one server removed. Cloudflare MCP now fully working — brain reads AND writes confirmed.

---

## BUG 1: CLOUDFLARE MCP — JSON-RPC PARSE ERROR (npx stdout pollution)

### Symptom
```
cloudflare: [DEBUG 2026-04-21T01:30:57.009Z] Config loaded: {"accountId":"✗","apiToken":"✓"}
: calling "initialize": invalid character 'S' looking for beginning of value
```

### Root Cause
npx emits text to stdout before MCP server starts (download prompts, version resolution, spinner). Antigravity's Go-based MCP client reads stdout as JSON-RPC, hits non-JSON text, parse fails.

### Investigation
- T5 unpacked @cloudflare/mcp-server-cloudflare@0.1.10, grepped dist/index.js
- Confirmed `log()` function writes to `process.stderr` (line 22) — NOT stdout. Server source is clean.
- T9 identified npx as pollution source — npx designed for interactive CLI, not stdio-transport MCP servers

### Fix Applied
Changed mcp_config.json from npx launcher to direct node execution:
```json
BEFORE: "command": "npx", "args": ["-y", "@cloudflare/mcp-server-cloudflare@0.1.10", "run"]
AFTER:  "command": "/usr/local/bin/node", "args": ["/path/to/dist/index.js", "run"]
```

### Status: FIXED (superseded by Bug 3 robust fix)

---

## BUG 2: RAILWAY MCP — TOOL LIMIT EXCEEDED

### Symptom
```
railway: adding this instance with 14 enabled tools would exceed max limit of 100
```

### Root Cause
Gemini has 100 tool max across all MCP servers. Current servers use ~87+ tools. Railway's 14 would exceed limit.

### Tool Count Audit (approximate)
| Server | Tools |
|--------|-------|
| github | 26 |
| notebooklm | 16 |
| cloudflare | 11 |
| puppeteer | 7 |
| brave-search | 2 |
| postgres | 1 |
| perplexity-ask | 1 |
| sequential-thinking | 1 |
| memory | ~5 |
| exa | ~3 |
| gmp-code-assist | ~5 |
| cloudrun | ~8 |
| **TOTAL** | **~86** |

### Fix Applied
Removed railway from mcp_config.json. Trent approved removal.

### Status: FIXED

---

## BUG 3: CLOUDFLARE MCP — GEMINI MIGRATIONS SCHEMA REJECTION (CRITICAL)

### Symptom
```
GenerateContentRequest.tools[28].function_declarations[0].parameters.properties[migrations].items: 
field predicate failed: $type == Type.ARRAY
```
Affected ALL chats — old and new. Cloudflare MCP unusable = no brain access from Antigravity.

### Root Cause
In @cloudflare/mcp-server-cloudflare v0.1.10, the `worker_put` tool's inputSchema has a `migrations` property with invalid JSON Schema:
```javascript
migrations: {
  type: "object",     // ← declares object
  items: {            // ← "items" is array-only keyword in JSON Schema
    properties: { new_tag, new_classes, new_sqlite_classes, renamed_classes, deleted_classes },
    required: ["tag"]
  }
}
```
Gemini strictly validates and rejects: `items` on `type: "object"` fails `$type == Type.ARRAY` predicate.

### Investigation
- Initially assumed v0.1.10 was pre-migrations (wrong — both v0.1.10 and v0.2.0 have it)
- T5 grepped source: `migrations` at line 1393 in worker_put inputSchema
- T9 recommended removing entire migrations property (Trent doesn't deploy workers from Antigravity)

### Fix Applied (ROBUST)
1. Created dedicated local npm install:
   ```bash
   mkdir -p ~/Google\ AntiGravity/.local/cloudflare-mcp
   cd ~/Google\ AntiGravity/.local/cloudflare-mcp
   npm init -y && npm install @cloudflare/mcp-server-cloudflare@0.1.10
   ```
2. Patched dist/index.js — removed migrations property block (lines 1393-1432)
3. Updated mcp_config.json to point to local install:
   ```json
   "command": "/usr/local/bin/node",
   "args": ["/Users/trentbelasco/Google AntiGravity/.local/cloudflare-mcp/node_modules/@cloudflare/mcp-server-cloudflare/dist/index.js", "run"]
   ```
4. README at ~/Google AntiGravity/.local/cloudflare-mcp/PATCHED.md documents the patch

### Why Robust
- Own node_modules tree — all dependencies resolve (xdg-app-paths, undici, chalk, @modelcontextprotocol/sdk)
- Independent of npx cache — survives `npm cache clean`
- Version pinned in package.json
- Patch documented in PATCHED.md for re-application after any reinstall

### Failed Approaches (for posterity)
1. Copying index.js to standalone location → ERR_MODULE_NOT_FOUND (no node_modules)
2. Patching npx cache in-place → fragile, cache can be cleared anytime

### Status: FIXED — brain reads AND writes confirmed from Antigravity

---

## BUG 4: SEQUENTIAL-THINKING MCP — CONTEXT DEADLINE EXCEEDED

### Symptom
```
sequential-thinking: Sequential Thinking MCP Server running on stdio : context deadline exceeded
```

### Root Cause
Same npx stdout pollution as Bug 1 — npx text output corrupts JSON-RPC handshake, Antigravity times out.

### Fix Applied
Switched from npx to direct node execution:
```json
BEFORE: "command": "npx", "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]
AFTER:  "command": "/usr/local/bin/node", "args": ["/Users/trentbelasco/.npm/_npx/de2bd410102f5eda/node_modules/@modelcontextprotocol/server-sequential-thinking/dist/index.js"]
```

### Note
This still points to npx cache — less robust than Bug 3 fix. If cache is cleared, sequential-thinking will break. Consider local npm install if it happens.

### Status: FIXED (fragile — npx cache dependent)

---

## REMAINING ISSUES (from Session 1 + 2)

- [ ] **Puppeteer MCP timeout** — same npx pollution issue, not yet fixed
- [ ] **cloudrun MCP tool limit** — 8 tools, near limit boundary
- [ ] **exa MCP tool limit** — 3 tools, near limit boundary  
- [ ] **Chat persistence** — new chats not showing in sidebar after restart. Trajectory data exists in state.vscdb (802KB protobuf) but not rendered. Likely Antigravity bug, not config issue.
- [ ] **Old chat 400 errors** — old chats cached broken tool schemas in trajectory state. No fix — start new chats.
- [ ] **Sequential-thinking fix fragility** — needs local npm install like cloudflare for durability

---

## FINAL MCP CONFIG STATE (12 servers)

| Server | Launch | Status |
|--------|--------|--------|
| notebooklm | npx | Working |
| memory | npx | Working |
| github | npx | Working |
| brave-search | npx | Working |
| puppeteer | npx | TIMEOUT (unfixed) |
| postgres | npx | Working |
| cloudflare | node (local install, patched) | WORKING ✓ |
| exa | npx | Tool limit warning |
| perplexity-ask | npx | Working |
| gmp-code-assist | npx | Working |
| sequential-thinking | node (npx cache) | FIXED (fragile) |
| cloudrun | npx | Tool limit warning |

### Removed servers (this session)
- railway (tool limit exceeded)

### Removed servers (session 1)
- stripe, slack, google-maps, render, github-mcp-server, supabase-mcp-server, supabase, firecrawl, apify

---

## KEY REFERENCE — CONFIG LOCATIONS

| Config | Path |
|--------|------|
| MCP servers (global) | `~/.gemini/antigravity/mcp_config.json` |
| Cloudflare MCP (patched) | `~/Google AntiGravity/.local/cloudflare-mcp/` |
| Patch docs | `~/Google AntiGravity/.local/cloudflare-mcp/PATCHED.md` |
| IDE state DB | `~/Library/Application Support/Antigravity/User/globalStorage/state.vscdb` |
| Workspace storage | `~/Library/Application Support/Antigravity/User/workspaceStorage/` |
| Google AntiGravity workspace hash | `bc7586081af2b097a292dca78f28121f` |

---

## LESSONS LEARNED (addendum to Session 1)

10. **npx + stdio MCP = fundamentally fragile** — npx writes to stdout before server starts, corrupting JSON-RPC transport. Always use direct node execution for MCP servers.
11. **Gemini strictly validates JSON Schema** — `items` on `type: "object"` is rejected. Claude/Anthropic is more lenient. Test tool schemas against Gemini's validator.
12. **Local npm install is the robust pattern for patched MCP servers** — own dependency tree, version pinned, patch documented, independent of cache.
13. **Cloudflare MCP v0.1.10 AND v0.2.0 both have the migrations schema bug** — pinning version alone doesn't fix it, must patch.
14. **Account ID ✗ display** — was misleading. API token worked fine, account ID resolved at runtime despite showing ✗ in debug output.
