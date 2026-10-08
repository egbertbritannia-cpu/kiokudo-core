# 記憶道 — Kiokudo Core

**Independent Kiokudo backend** — Fastify, TypeScript, libSQL/Turso, Drizzle, canonical ts-fsrs ReviewService.

> Phase 2 is a **staging-only migration**. This repository is NOT authorized to replace the currently deployed `japanese-srs-system` backend.

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

Set `KIOKUDO_DATABASE_SCOPE=staging` and `KIOKUDO_DATABASE_URL` (local `file:...` or separate Turso staging URL); set `KIOKUDO_DATABASE_AUTH_TOKEN` for remote URLs. There are **no automatic migrations**. Create/verify the staging schema manually before enabling real-data tests. Do NOT connect to existing production Turso.

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
npm run build
```

## Migration safety

See [Migration Gates](docs/MIGRATION.md), [schema review](migrations/README.md), and [OpenAPI contract](contracts/openapi.yaml).

**Not yet migrated:** IELTS, Grammar/JPD133 special-case creation parity, Google OAuth, media, staging Turso data reconciliation, FE real-data integration and production cutover.
