# Database staging snapshot reconciliation (READ ONLY)

## Boundary / safety

This audit tool consumes exactly **two local, checkpointed SQLite EXPORT
files**. It NEVER accesses Turso, calls a remote API, updates/creates a database
table, or applies DDL. An exported snapshot is required; a live WAL-mode SQLite
file should not be read with `immutable=1` without checkpointing first.

- Baseline: separately verified full production **export**, stored securely.
- Staging: full independent staging **export** with the marker table
  `kiokudo_deployment_identity` provisioned by the operator on staging.
- The marker is verified in Core runtime before serving review APIs; never let
  this script create a staging marker in a target DB.
- Keep exports outside Git, CI artifacts and public file storage.
- The report contains table names, row counts, hashed contents and schema
  differences; no plaintext card rows are printed, but hashes/metadata may
  still be sensitive: store it privately.
- Only the staging marker table is exempted from row equality, because it does
  not exist in legacy production. All other tables are compared.

## Command

```bash
python3 scripts/audit_snapshots.py \
  --baseline /secure/export-production.db \
  --staging /secure/export-stage.db \
  --report /secure/audit-report.json
```

Exit 0: required entities exist and all application tables, column definitions,
foreign keys, indexes, raw schema DDL (including views/triggers), row counts\nand content hashes agree. The SQLite sequence state, when present, is\nalso compared.
Exit 1: parity failure, **BLOCK cutover**.
Exit 2: missing/invalid file or report already exists, **BLOCK cutover**.

This does not prove the actual identity of remote services or actual timing of
exports. For a live DB changing during the migration, use a consistent snapshot,
write-freeze/catch-up and independent provenance verification before cutover.

## External remote DB deployment guard

Before starting Core against a staging DB, manually verify Turso organization,
database ID, URL and credential scope. Then (on staging ONLY) create:
```sql
CREATE TABLE kiokudo_deployment_identity (
  environment TEXT PRIMARY KEY,
  marker TEXT NOT NULL
);
INSERT INTO kiokudo_deployment_identity(environment, marker)
VALUES ('staging', '<unique-random-marker-at-least-24-characters>');
```

Use a distinct private `KIOKUDO_EXPECTED_STAGING_MARKER` matching this row.
Local rehearsals carry the public `kiokudo-local-json-fixture-not-production-v1`
marker and **that marker is never accepted for remote staging**. The marker is
an accidental-target safety fence, not an authentication secret. Remote
service token/DB credentials and Vercel auth are still required.

Do NOT run the above SQL on production. There is no script in this repository
that automatically provisions a remote staging marker.
