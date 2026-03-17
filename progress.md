# Progress Log

## Session: 2026-03-11

### Diagnosis Complete
- Read all 4 log files (bridge 6.8.0, 6.9.0, livecall, fast-intel-live)
- Read full bridge source (1568 lines), fast-intel source, deep-scrape source, voice-agent source
- Key finding: bridge 6.7.0 had 2K system_chars (worked), current 6.11.0-D has 14K+ (broken)
- Key finding: Deepgram warns SLOW_THINK_REQUEST after 5s — bridge must respond faster
- Key finding: deep-scrape `instance.already_exists` error for retested LIDs
- Key finding: stale script_state in KV causes WOW to skip on reused LIDs
