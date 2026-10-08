# Kiokudo Core — Phase 2 migration gates

Baseline: `egbertbritannia-cpu/japanese-srs-system` commit `3348f4ee49c9539fb9ea60c96e42833811c325ca`.

## Implemented in this branch (staging-only)

- Exact Drizzle schema port: `src/db/schema.ts` (legacy source preserved).
- Explicit local/staging libSQL connection. `KIOKUDO_DATABASE_SCOPE=staging` required to open a configured URL.
- Fastify `GET /api/v1/cards`, `POST /api/v1/reviews`, `POST /api/v1/reviews/batch`.
- Canonical ts-fsrs scheduling plus immutable review events, single-transaction DB mutations and sorted offline batch replay.
- Mock-free integration tests against fresh temporary SQLite files, including duplicate replay and forced DB failure.

## Invariants / intended differences

- The new service never retries a failed transaction outside of a transaction. Legacy version caught arbitrary transaction failures and applied changes using a non-atomic fallback.
- Browser `scheduledDays` is ignored; FSRS server transition is authoritative.
- Duplicate event IDs with a different card/rating/reviewedAt are rejected (409).
- Batch replay requires stable event IDs; all successful entries are committed atomically.
- No on-demand synthetic grammar card insertion or Add Card. Grammar-practice migration must map to genuine persistent card IDs first.
- No production DB credentials have been installed; without explicit staging DB, the API returns 503 for business routes.
- These endpoints are not a production drop-in replacement until cross-repo integration, data reconciliation and parity tests complete.

## Gate checklist

| Gate | Status |
| --- | --- |
| Repo bootstrap / fail-closed service auth | Done |
| Schema port | Done (DDL migration parity review pending) |
| ReviewService + staging REST APIs | Implemented; CI validation required |
| Staging local SQLite integration tests | Implemented; CI validation required |
| Offline batch idempotency | Implemented; advanced concurrent replay tests pending |
| Staging Turso schema audit / data reconciliation | Pending |
| Grammar special-case migration | Pending |
| Google OAuth / media / IELTS APIs | Pending |
| FE live-data migration via BFF | Pending |
| Production cutover | **NOT AUTHORIZED** |

## Migration safety

1. Keep original Turso untouched.
2. Never point this migration build at the production Turso instance.
3. Copy + verify full data, validate DDL separately, compare review logs and card IDs.
4. Create staging backend identity credential and lock down FE BFF access before any external deployment.
5. Capture traces for duplicate replay and atomic rollback on staging.
6. Do not decommission `japanese-srs-system` until written approval and rollback rehearsal.
