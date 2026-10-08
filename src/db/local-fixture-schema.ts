import type { Client } from '@libsql/client';

/**
 * Narrow test/preview schema, NOT the canonical schema migration.
 * Compatible with the three Drizzle review entities: decks, cards, review_logs.
 */
export async function createLocalFixtureSchema(client: Client): Promise<void> {
  await client.execute('PRAGMA foreign_keys = ON');
  await client.execute(`CREATE TABLE decks (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, created_at INTEGER NOT NULL
  )`);
  await client.execute(`CREATE TABLE cards (
    id TEXT PRIMARY KEY, deck_id TEXT NOT NULL REFERENCES decks(id), type TEXT NOT NULL,
    front TEXT NOT NULL, reading TEXT, meaning TEXT NOT NULL, pitch TEXT, sentence TEXT,
    audio_url TEXT, tags TEXT, stability REAL NOT NULL DEFAULT 0,
    difficulty REAL NOT NULL DEFAULT 0, elapsed_days INTEGER NOT NULL DEFAULT 0,
    scheduled_days INTEGER NOT NULL DEFAULT 0, reps INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'New',
    due INTEGER NOT NULL, last_review INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`);
  await client.execute(`CREATE TABLE review_logs (
    id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id),
    rating TEXT NOT NULL, state TEXT NOT NULL, due INTEGER NOT NULL,
    stability REAL NOT NULL, difficulty REAL NOT NULL, elapsed_days INTEGER NOT NULL,
    last_elapsed_days INTEGER NOT NULL, scheduled_days INTEGER NOT NULL,
    review_time INTEGER NOT NULL
  )`);
}
