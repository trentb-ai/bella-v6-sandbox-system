# ANTIGRAVITY IDE DEBUG SESSION — 2026-04-21
## Filed: 2026-04-21 AEST | Author: T2 Code Lead (Opus)
## D1 ID: doc-antigravity-debug-session-20260421

---

## SUMMARY

Full debug session fixing Trent's Antigravity IDE (Google VS Code fork). Three major issues resolved: missing workspace folders, MCP server errors, workspace registration persistence.

---

## ISSUE 1: MISSING WORKSPACE FOLDERS + PATH ERROR

### Symptom
Antigravity throwing "path not found" error on launch. Two project folders missing: "Google AntiGravity" (parent) and "Test Workspace 1" (child).

### Root Cause
Prior Sonnet session renamed parent folder — added trailing space to name ("Google AntiGravity " instead of "Google AntiGravity"). Trent moved both folders to external hard drive during cleanup. Folders then placed on Desktop but not in correct location for IDE.

### Investigation Steps
1. T5 searched: ~/Library/Application Support/, ~/.config/, ~/Library/Preferences/, ~/Library/Containers/ for antigravity configs
2. T5 searched: home dir, backup drives, Trash, Spotlight index for missing folders
3. T5 found shell history showing prior rm -rf and mv commands on workspace contents
4. T5 found `~/Google` — 0-byte empty file artifact (not a folder)
5. T5 found IDE config in `~/Library/Application Support/Antigravity/User/globalStorage/storage.json` — profileAssociations pointing to `file:///Users/trentbelasco/Google%20AntiGravity` and `file:///Users/trentbelasco/Google%20AntiGravity/Test%20Workspace%201`
6. T5 confirmed trailing space in folder name via `ls -1b` output
7. T9 Architect independently verified analysis — green light on fix

### Fix Applied
```bash
rm ~/Google                                                    # 0-byte junk file
mv ~/Desktop/Google\ AntiGravity\  ~/Google\ AntiGravity       # fix trailing space + move to home root
mv ~/Desktop/Test\ Workspace\ 1 ~/Google\ AntiGravity/Test\ Workspace\ 1  # nest inside parent
```

### Result
Path error gone. Folders at correct locations matching IDE config.

### Key Files
- IDE config: `~/Library/Application Support/Antigravity/User/globalStorage/storage.json`
- Parent folder: `~/Google AntiGravity/` (66 items, .git, .env, .secrets, 60+ project subdirs)
- Child folder: `~/Google AntiGravity/Test Workspace 1/` (194 items)

---

## ISSUE 2: MCP SERVER ERRORS (11 broken servers)

### Symptom
MCP Error badge in IDE chat. 11 servers failing on initialization.

### Config Location
`~/.gemini/antigravity/mcp_config.json` — 21 MCP servers configured (global config for Antigravity IDE).

### Workspace-Level Configs (also found)
- `~/Google AntiGravity/.agent/mcp_config.json` — template with placeholder keys
- `~/Google AntiGravity/.agent/.agent/mcp_config.json` — duplicate template
- `~/Google AntiGravity/Test Workspace 1/.agent/mcp_config.json` — template
- `~/Google AntiGravity/Test Workspace 1/.vscode/mcp.json` — perplexity-bridge MCP (local node server)

### Errors + Fixes Applied

| Server | Error | Fix | Status |
|--------|-------|-----|--------|
| stripe | Not needed | REMOVED from config | DONE |
| slack | Not needed | REMOVED from config | DONE |
| google-maps | npm 404 (package doesn't exist) | REMOVED from config | DONE |
| render | npm 404 (package doesn't exist) | REMOVED from config | DONE |
| github-mcp-server | Docker/Colima not running | REMOVED — non-Docker `github` entry already exists | DONE |
| supabase-mcp-server | Tool limit (29 tools) + migrations schema bug | REMOVED — duplicate of `supabase` entry | DONE |
| supabase | Missing access token | Added --access-token from supabase-mcp-server entry, then REMOVED per Trent (migrations schema bug) | DONE |
| cloudflare | Wrong npm package name | Changed `@modelcontextprotocol/server-cloudflare` → `@cloudflare/mcp-server-cloudflare` + added `run` arg | DONE |
| cloudflare | v0.2.0 migrations tool schema incompatible with Gemini | Pinned to `@cloudflare/mcp-server-cloudflare@0.1.10` | DONE |
| apify | Wrong env var name | Changed `APIFY_API_TOKEN` → `APIFY_TOKEN` (what server expects) | DONE |
| postgres | DB URL in env instead of CLI arg | Moved URL from env to args array | DONE |

### Remaining MCP Errors (not yet fixed)
- **cloudrun** — tool limit exceeded (8 tools). Trent uses Cloud Run — keep but may need to trim other servers.
- **exa** — tool limit exceeded (3 tools). Trent wants to keep (cheaper than firecrawl for search).
- **sequential-thinking** — tool limit exceeded (1 tool). Trent wants to keep.

### Tool Limit Problem
Gemini has 100 tool max. After removals, still slightly over. cloudrun + exa hitting the limit. Needs further server trimming or Gemini limit increase.

### Cloudflare MCP — Migrations Schema Bug (CRITICAL)
- Package: `@cloudflare/mcp-server-cloudflare`
- v0.2.0 exposes D1 migration tools with schema that Gemini rejects
- Error: `GenerateContentRequest.tools[93].function_declarations[0].parameters.properties[migrations].items: field predicate failed: $type == Type.ARRAY`
- Fix: Pin to v0.1.10 (pre-migrations tool)
- This is a bug in the Cloudflare MCP package, not in our config
- Claude Code Cloudflare MCP is COMPLETELY SEPARATE — unaffected

### Servers Kept (post-cleanup, 13 total)
notebooklm, memory, github, brave-search, puppeteer, postgres, cloudflare (v0.1.10), firecrawl, apify, exa, perplexity-ask, gmp-code-assist, sequential-thinking, cloudrun, railway

---

## ISSUE 3: WORKSPACE PERSISTENCE IN AGENT MANAGER

### Symptom
Test Workspace 1 disappearing from Antigravity's agent manager sidebar on restart.

### Root Cause (compounded by T2 error)
1. IDE only remembers folder opened at launch — doesn't persist multi-folder state across restarts without a .code-workspace file
2. T2 created a .code-workspace file which CAUSED bogus workspace entries ("Google AntiGravity.code-works" and "workspace.json") in agent manager sidebar
3. .code-workspace file deleted but bogus entries persisted in state.vscdb SQLite database

### Investigation
- T9 identified state storage: `~/Library/Application Support/Antigravity/User/globalStorage/state.vscdb` (SQLite, 4.2MB)
- T5 queried state.vscdb, found:
  - `history.recentlyOpenedPathsList` — JSON with 2 bogus workspace entries pointing to non-existent .code-workspace files
  - `antigravityUnifiedStateSync.sidebarWorkspaces` — binary/protobuf format, contains workspace URIs but NOT Test Workspace 1
  - `antigravityUnifiedStateSync.scratchWorkspaces` — base64 encoded

### Fix Applied
1. Force quit Antigravity, verified with pgrep
2. Backed up state.vscdb → state.vscdb.bak
3. Read `history.recentlyOpenedPathsList` from state.vscdb
4. Removed 2 bogus workspace entries (configPath referencing deleted .code-workspace files)
5. Wrote cleaned JSON back via sqlite3 UPDATE
6. Restarted Antigravity with both folders opened via CLI

### Bogus Entries Removed
- `{"workspace":{"id":"ab01914cdc560aec987348d77cf725fa","configPath":"file:///Users/trentbelasco/Google%20AntiGravity/Google%20AntiGravity.code-workspace"}}`
- `{"workspace":{"id":"0e7695cd0eb262e16ea15206cfa33d80","configPath":"file:///Users/trentbelasco/Desktop/Test%20Workspace%201.code-workspace"}}`

### Entries Preserved
- `{"folderUri":"file:///Users/trentbelasco/Google%20AntiGravity"}` — GOOD
- `{"folderUri":"file:///Users/trentbelasco"}` — GOOD
- `{"folderUri":"file:///Users/trentbelasco/Google%20AntiGravity/Test%20Workspace%201"}` — GOOD
- All fileUri entries (recent files) — GOOD

### Backup Location
`~/Library/Application Support/Antigravity/User/globalStorage/state.vscdb.bak`

---

## SHARED BRAIN ACCESS FOR ANTIGRAVITY

Gemini prompt provided to Trent for querying shared brain D1 from Antigravity:

```
Database ID: 2001aba8-d651-41c0-9bd0-8d98866b057c
Account ID: 9488d0601315a70cac36f9bd87aa4e82
Tool: d1_database_query
Tables: documents, knowledge_atoms, memory_objects
```

Requires cloudflare MCP working (pinned to v0.1.10 to avoid migrations schema bug).

---

## KEY REFERENCE — ANTIGRAVITY CONFIG LOCATIONS

| Config | Path | Purpose |
|--------|------|---------|
| MCP servers (global) | `~/.gemini/antigravity/mcp_config.json` | All MCP server definitions |
| App storage | `~/Library/Application Support/Antigravity/User/globalStorage/storage.json` | profileAssociations, recent menu |
| State DB | `~/Library/Application Support/Antigravity/User/globalStorage/state.vscdb` | Recently opened, sidebar workspaces, editor state |
| User settings | `~/Library/Application Support/Antigravity/User/settings.json` | Editor preferences |
| Extensions | `~/.antigravity/extensions/` | Installed extensions |
| App binary | `/Applications/Antigravity.app/` | IDE application |
| CLI | `/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity` | CLI tool (supports --new-window, --add) |
| Product config | `/Applications/Antigravity.app/Contents/Resources/app/product.json` | App metadata (nameShort: "Antigravity", aliasName: "agy") |
| Workspace MCP | `~/Google AntiGravity/.agent/mcp_config.json` | Per-workspace MCP (template) |
| Workspace MCP | `~/Google AntiGravity/Test Workspace 1/.vscode/mcp.json` | Per-workspace MCP (perplexity-bridge) |

---

## LESSONS LEARNED

1. **Never create .code-workspace files in Antigravity** — agent manager treats them as separate workspace registrations, creates bogus sidebar entries
2. **Antigravity MCP config is at ~/.gemini/antigravity/mcp_config.json** — NOT in standard VS Code locations
3. **Trailing spaces in folder names** — silent killer. Always verify with `ls -1b` for byte-level precision
4. **@cloudflare/mcp-server-cloudflare v0.2.0** — has Gemini-incompatible migrations tool schema. Pin to v0.1.10
5. **state.vscdb** — SQLite DB controls workspace persistence. Can be surgically edited but BACKUP FIRST
6. **sidebarWorkspaces** — binary/protobuf format, not safely editable. Open folders via CLI to re-register
7. **Antigravity's agent manager** is separate from VS Code's file explorer — workspaces appear there based on folder opens + state.vscdb history
8. **Claude Code Cloudflare MCP is completely separate** from Antigravity's — changes to one never affect the other
9. **Always ask permission before editing config files** — especially when user has expressed concern about breaking access

---

## OPEN ITEMS

- [ ] Tool limit still exceeded for cloudrun (8), exa (3), sequential-thinking (1) — need to trim or accept
- [ ] Supabase access removed — may need to restore if Trent needs it. Check what Supabase project is used for
- [ ] Cloud Run usage — gcloud CLI not installed, need to determine if actively used
- [ ] Test Workspace 1 persistence in agent manager sidebar — may need manual re-open after each IDE restart until Antigravity fixes workspace state
