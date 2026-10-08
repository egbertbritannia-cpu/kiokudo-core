# Kiokudo database migration policy

The schema in `src/db/schema.ts` was copied unchanged from legacy commit
`3348f4ee49c9539fb9ea60c96e42833811c325ca`.

**No automatic DDL runs on core startup.** Core connects only when
`KIOKUDO_DATABASE_SCOPE=staging` and an explicit `KIOKUDO_DATABASE_URL` are set.

Local test fixtures create an isolated minimal SQLite schema for the three review entities.
Do not run test DDL against production Turso.

Before activating the staging Turso database, complete a separate migration audit:
- Inventory every live table and applied legacy migration.
- Compare schema with actual Turso DB tables, indexes and FK modes.
- Back up the staging data, replay migrations in order and reconcile counts.
- Freeze and verify card IDs, review log IDs and timestamps.
- Run replay/retry tests and verify no data drift.

The existing migrations in the old repository are **not yet certified** for replay
on a new database. Do not copy or run them blindly.
