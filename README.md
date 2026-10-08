# 記憶道 — Kiokudo Core

> Independent backend service for Kiokudo. **Bootstrap only; not yet the production API.**

## Technology

Node.js 22+, TypeScript, Fastify 5. Existing Turso/Drizzle and canonical server-side FSRS ReviewService will be migrated in phases; these business endpoints are **not implemented in this bootstrap**.

## Run

```bash
npm install
cp .env.example .env
# Set KIOKUDO_SERVICE_TOKEN to a long random string.
npm run dev
```

- `GET /api/v1/health` — public liveness, no sensitive data.
- `GET /api/v1/status` — authenticated bootstrap status, does not mean data/reviews have been migrated.
- All other `/api/v1/*` routes return 404 until explicitly implemented, tested and approved.

Run `npm test`, `npm run check`, `npm run build` before deployment.

**Security:** API uses a server-side service credential. No browser should call this backend directly. Set the *same* credential as `KIOKUDO_CORE_SERVICE_TOKEN` in the web BFF. Never use `NEXT_PUBLIC_*` for secrets or expose Turso/Google credentials to the web app.

**Migration:** [Scope and gates](./docs/MIGRATION.md) and [REST contract](./contracts/openapi.yaml).

Legacy baseline (still production): [japanese-srs-system](https://github.com/egbertbritannia-cpu/japanese-srs-system).
