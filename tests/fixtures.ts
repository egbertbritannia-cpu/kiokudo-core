import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabaseConnection } from '../src/db/client.js';

export async function setupReviewDb() {
  const dir=await mkdtemp(join(tmpdir(),'kiokudo-review-'));
  const connection=createDatabaseConnection('file:'+join(dir,'review.db'));
  const {client}=connection;
  // Minimal DDL for 3 core entities only. NEVER execute on production.
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
  const now=Math.floor(Date.parse('2026-10-08T00:00:00.000Z')/1000);
  await client.execute({sql:'INSERT INTO decks (id,name,description,created_at) VALUES (?,?,?,?)',args:['jpd','JPD133','Test deck',now]});
  await client.execute({
    sql:`INSERT INTO cards (id,deck_id,type,front,reading,meaning,due,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`,
    args:['card-a','jpd','Vocab','父','ちち','father',now,now,now],
  });
  return {
    ...connection,
    close:async()=>{connection.client.close();await rm(dir,{recursive:true,force:true});},
  };
}
