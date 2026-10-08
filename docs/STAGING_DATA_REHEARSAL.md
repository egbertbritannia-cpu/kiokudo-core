# Phase 3 — Local staging rehearsal (not Turso migration)

## Provenance

The two fixtures below are exact copies of tracked JSON in `japanese-srs-system`
at commit `3348f4ee49c9539fb9ea60c96e42833811c325ca`:

- `fixtures/legacy-json/jpd133_vocab.json`: 256 source entries
- `fixtures/legacy-json/n5_vocab.json`: 60 source entries

They are **source learning content, not a production database snapshot**.
No current Turso card IDs, FSRS history or user progress can be inferred from them.
The rehearsal intentionally generates different fixture-only IDs and zero review logs.

## Run the safe rehearsal

```bash
npm install
npm run staging:local -- seed ./staging-rehearsal.db
npm run staging:local -- audit ./staging-rehearsal.db
```

Expected: 2 decks, 316 cards, 0 review logs, all cards New, no orphans.
The tool refuses remote URLs, cannot overwrite existing local DBs and saves a
`.manifest.json` with source hashes and expected counts.

## Actual staging Turso migration — BLOCKED

A separate, empty Turso staging instance + non-production credentials and
a **verified export of production data** are required to transfer the real state.
Do not share credentials in tickets/commits/chat.

Before any import, obtain:
- backup/snapshot of production database using an appropriate secure channel;
- independent staging Turso URL/token, confirming not same origin/database;
- full table/index/foreign-key schema verification (3-table fixture schema
  is NOT sufficient for the real app);
- frozen, original `cards.id`, `review_logs.id` and timestamps;
- pre/post counts and referential integrity checks for all tables;
- replay regression and rollback rehearsal.

No direct production connection, database export or staging Turso import
was performed by this migration PR.
