CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  lid TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  final_stage TEXT,
  total_turns INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS call_turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id TEXT NOT NULL REFERENCES calls(id),
  turn_index INTEGER NOT NULL,
  turn_id TEXT NOT NULL,
  speaker TEXT NOT NULL,
  utterance TEXT NOT NULL,
  stage TEXT NOT NULL,
  move_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lead_facts (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  fact_value TEXT NOT NULL,
  data_source TEXT NOT NULL DEFAULT 'prospect',
  confidence REAL DEFAULT 1.0,
  captured_at TEXT NOT NULL,
  captured_during TEXT,
  UNIQUE(lead_id, fact_key, data_source)
);

CREATE TABLE IF NOT EXISTS quality_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id TEXT NOT NULL REFERENCES calls(id),
  turn_id TEXT NOT NULL,
  compliance_score REAL,
  drift_type TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_quality_scores_call_turn ON quality_scores(call_id, turn_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_call_turns_unique ON call_turns(call_id, turn_id);
