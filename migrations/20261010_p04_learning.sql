-- Kiokudo Phase 04 additive schema; OPERATOR APPROVAL REQUIRED.
-- Apply to independently verified staging only after snapshot backup.
-- NEVER run this file automatically or against production.
PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS kiokudo_grammar_attempt_logs (
  id TEXT PRIMARY KEY NOT NULL,
  exercise_id TEXT NOT NULL REFERENCES grammar_exercises(id) ON DELETE RESTRICT,
  answer TEXT NOT NULL,
  is_correct INTEGER NOT NULL CHECK(is_correct IN (0,1)),
  answered_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kiokudo_grammar_attempt_logs_exercise ON kiokudo_grammar_attempt_logs(exercise_id);
CREATE TABLE IF NOT EXISTS kiokudo_ielts_mutation_state (
  session_id TEXT PRIMARY KEY NOT NULL REFERENCES ielts_sessions(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  last_request_id TEXT NOT NULL,
  last_response TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
COMMIT;
