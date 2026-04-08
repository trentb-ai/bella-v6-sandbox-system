-- Migration 0002: Add UNIQUE constraint to call_turns to prevent duplicate turn_id rows
-- Step 1: Remove any pre-existing duplicate (call_id, turn_id) rows — keep earliest (lowest rowid)
DELETE FROM call_turns
WHERE rowid NOT IN (
  SELECT MIN(rowid) FROM call_turns GROUP BY call_id, turn_id
);
-- Step 2: Safe to create UNIQUE index now
CREATE UNIQUE INDEX IF NOT EXISTS idx_call_turns_unique ON call_turns(call_id, turn_id);
