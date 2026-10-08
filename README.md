# 記憶道 — Kiokudo Core

**Independent Kiokudo backend** — Fastify, TypeScript, libSQL/Turso, Drizzle, canonical ts-fsrs ReviewService.

> Phase 3 safety-hardening on **staging-only infrastructure**. This repository is NOT authorized to replace the currently deployed `japanese-srs-system` backend.

## Quick start (API without DB)

```bash
npm install
cp .env.example .env
# Set a long, random KIOKUDO_SERVICE_TOKEN (24+ characters).
npm run dev
```

Liveness: `GET /api/v1/health` (public). Migration status: `GET /api/v1/status` (Bearer token required).

Without a staging DB, business routes deliberately return HTTP 503.

## Staging database

Set `KIOKUDO_DATABASE_SCOPE=staging`, `KIOKUDO_DATABASE_URL` and `KIOKUDO_EXPECTED_STAGING_MARKER`.
The marker **must already exist inside the staging database** in `kiokudo_deployment_identity`, and must match the environment variable before Fastify starts serving routes.
For remote Turso staging use a unique, separately verified marker and `KIOKUDO_DATABASE_AUTH_TOKEN`. Never reuse the public local-fixture marker for Turso.
There are **no automatic remote migrations**. Independently verify the destination's Turso organization/database identity before adding its marker; never point this app at production.
For local JSON rehearsal use `npm run staging:local -- seed ./staging-rehearsal.db` and the documented fixture marker `kiokudo-local-json-fixture-not-production-v1`.

## Implemented staging REST API

| Method | Endpoint | Behavior |
| --- | --- | --- |
| GET | `/api/v1/health` | Public process liveness only |
| GET | `/api/v1/status` | Authenticated migration status |
| GET | `/api/v1/cards` | Read-only cards, decks and summaries |
| POST | `/api/v1/reviews` | Canonical FSRS state transition in atomic transaction |
| POST | `/api/v1/reviews/batch` | Chronological offline event replay in one transaction |

All except health require `Authorization: Bearer <KIOKUDO_SERVICE_TOKEN>`.
No browser directly calls core; the future authenticated Kiokudo Web BFF owns this service credential.

For review replay supply a stable `eventId`, a real DB `cardId`, `rating` and `reviewedAt`.
Repeated `eventId` with matching identity returns `duplicate` without a second mutation. Conflicts return 409.
Client-provided `scheduledDays` is ignored. No user-facing Add Card.

## Verify

```bash
npm run check
npm test
python3 -m unittest discover -s tests_py -p 'test_*.py' -v
npm run build
```

## Migration safety

See [Migration Gates](docs/MIGRATION.md), [DB staging identity and read-only snapshot audit](docs/DB_SNAPSHOT_PARITY.md), [FSRS reference parity scope](docs/FSRS_PARITY_SCOPE.md), [schema review](migrations/README.md), and [OpenAPI contract](contracts/openapi.yaml).

**Not yet migrated:** IELTS, Grammar/JPD133 special-case creation parity, Google OAuth, media, staging Turso data reconciliation, FE real-data integration and production cutover.
