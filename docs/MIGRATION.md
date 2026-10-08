# Kiokudo Core — Migration gates

Legacy baseline: `japanese-srs-system` @ `3348f4ee49c9539fb9ea60c96e42833811c325ca`.

## Implemented (no production cutover)
- Fastify REST API with server-only Bearer service token.
- Canonical Drizzle table definitions, typed cards reads, server-side FSRS
  review transitions, event ID idempotency and transaction-only batch replay.
- Safe local import rehearsal of tracked 256 JPD133 + 60 N5 JSON rows, 22
  missing readings retained and audited. This is **NOT** production data.
- GitHub Actions end-to-end integration with Web on isolated SQLite.
- DB-resident staging marker checked in Fastify `onReady` before accepting
  requests. No remote DB marker DDL is performed automatically.
- Read-only comparison of **checkpointed exports**: all application tables,
  definitions, indexes, foreign keys, count and row-value hashes.
- Pure FSRS scheduling reference parity against exact legacy source commit.
  See [scope / exclusions](FSRS_PARITY_SCOPE.md).

## Mandatory still-blocked gates
| Gate | Status |
| --- | --- |
| Core/Web tests and local integration | Complete |
| Database marker gate + negative tests | Under CI validation |
| Full schema/data audit tool | Under CI validation |
| Pure FSRS calculation parity | Under CI validation |
| Real production Turso checkpointed export | **NOT AVAILABLE** |
| Independent Turso staging instance & verification | **NOT AVAILABLE** |
| Preserve original production card IDs and review history | **NOT DONE** |
| Grammar synthetic ID behavior mapping | **NOT DONE** |
| FE live review + Dexie replay / OAuth / IELTS parity | **NOT DONE** |
| Authenticated cloud staging and rollback rehearsal | **NOT DONE** |
| Production cutover | **NOT AUTHORIZED** |

## Operating constraints
Never supply production Turso credentials to the new Core while migration
checks are in progress. The staging marker is an accidental-target fence, not
proof of non-production ownership; manually verify Turso organization and
database identity. To audit data without ever opening a live connection, use
local exports and `scripts/audit_snapshots.py` as documented in
[DB_SNAPSHOT_PARITY.md](DB_SNAPSHOT_PARITY.md).

Legacy production must remain untouched. Do not re-enable Add Card.
