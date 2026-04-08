-- Chunk 10C: Initial D1 schema for bella-data-v3
-- Tables: calls, call_turns, lead_facts

CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  lid TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  total_turns INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS call_turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id TEXT NOT NULL REFERENCES calls(id),
  turn_index INTEGER NOT NULL,
  turn_id TEXT NOT NULL,
  speaker TEXT NOT NULL,
  utterance TEXT,
  stage TEXT NOT NULL,
  created_at DATETIME DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lead_facts (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  fact_value TEXT,
  data_source TEXT NOT NULL,
  confidence REAL DEFAULT 0.8,
  captured_at DATETIME DEFAULT (datetime('now')),
  captured_during TEXT,
  UNIQUE(lead_id, fact_key, data_source)
);

CREATE INDEX IF NOT EXISTS idx_call_turns_call_id ON call_turns(call_id);
CREATE INDEX IF NOT EXISTS idx_lead_facts_lead_id ON lead_facts(lead_id);
