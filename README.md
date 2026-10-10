# 記憶道 — Kiokudo Core

Kiokudo's Fastify/TypeScript backend serves **Grammar, JPD133 curriculum and IELTS** on isolated staging.

## Removed features

As of 10 October 2026, **Add Card and flashcard learning/review are removed**. No public or authenticated endpoints remain for `/api/v1/cards`, `/api/v1/reviews`, `/api/v1/reviews/batch` or `/api/v1/reviews/{eventId}/undo`. These return 404 after normal authentication. Legacy `cards`, `decks`, and `review_logs` tables may still appear in existing schemas and JSON/SQLite migration fixtures: they are **historical source data**, not a supported card-creation or flashcard-learning feature. Do not drop production tables or learner history to perform feature retirement.

## Available endpoints

- `GET /api/v1/health`, `GET /api/v1/status`
- `GET /api/v1/grammar`, `GET /api/v1/grammar/{lessonId}`, `GET /api/v1/grammar/practice`
- `POST /api/v1/grammar/practice/attempts`
- `GET /api/v1/ielts/dashboard`, `GET /api/v1/ielts/materials`, `GET /api/v1/ielts/sessions`, `GET /api/v1/ielts/sessions/{id}`, `GET /api/v1/ielts/mistakes`, `GET /api/v1/ielts/vocab`
- `POST /api/v1/ielts/sessions`, `PUT /api/v1/ielts/sessions/{id}/draft`, `POST /api/v1/ielts/sessions/{id}/submit`, `POST /api/v1/ielts/mistakes`, `POST /api/v1/ielts/vocab`

Some additional IELTS updates are pending a separate PR; consult actual `src/routes/` modules rather than assuming every draft contract is merged.

## Development

```bash
npm install
cp .env.example .env
npm run check
npm test
npm run build
```

Staging safety: configure `KIOKUDO_DATABASE_SCOPE=staging`, DB URL, verified staging marker, service bearer, and signed single-owner assertion. Migrations are operator-only, not automatically executed, and **production database content must not be modified** for this removal. `contracts/openapi.yaml` documents the retained route surface. `npm run staging:local -- seed ./staging-rehearsal.db` creates isolated historical fixtures to validate data parity, not a flashcard service.
