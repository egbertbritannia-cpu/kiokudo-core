-- Kiokudo Phase 04 additive schema; OPERATOR APPROVAL REQUIRED.
-- Apply to independently verified staging only after snapshot backup.
-- NEVER run this file automatically or against production.
PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS kiokudo_jpd133_card_links (
  source_key TEXT PRIMARY KEY NOT NULL,
  slot_number INTEGER NOT NULL CHECK (slot_number IN (1,2,3,4,5,6,8,10)),
  source_page INTEGER NOT NULL,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kiokudo_jpd133_card_links_slot ON kiokudo_jpd133_card_links(slot_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kiokudo_jpd133_card_links_card_key
  ON kiokudo_jpd133_card_links(slot_number, source_key);
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
