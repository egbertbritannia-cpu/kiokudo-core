# Kiokudo Core — migration gates

Source baseline: `egbertbritannia-cpu/japanese-srs-system` commit `3348f4ee49c9539fb9ea60c96e42833811c325ca`.

## Owned by core after migration

- Fastify REST endpoints under `/api/v1`
- Authoritative FSRS review mutation: `src/services/review-service.ts`
- Turso/libSQL + Drizzle schema, migrations and repositories
- Cards **read** APIs and learning services (no user-facing Add Card)
- Grammar, JPD133 curriculum, IELTS sessions and analysis
- Google OAuth/Sheets/Calendar/Tasks, media allowlist, AI provider calls
- Admin-only crawler/import/maintenance tooling kept outside API runtime

## Cutover invariants

1. No browser-side Turso, Google or AI secrets. No public browser-to-core direct calls.
2. FE connects via same-origin protected Next.js BFF with a server-side service credential.
3. Review POST uses canonical server-side FSRS and stable event IDs; retry cannot double-review.
4. Offline Dexie event replay must be idempotent, including batch path.
5. Card IDs must be genuine DB IDs; do not persist synthetic curriculum IDs.
6. Add Card remains decommissioned. Studio Shodo is a demo and must not silently become a persistent mutation.
7. Before using real Turso credentials: staging DB, data reconciliation, migration dry-run and rollback.
8. Fix/triage inherited CI failures before production cutover.
9. Test Google OAuth callback/redirect URIs in the new hosting topology.
10. The legacy repo and Vercel deployment remain untouched until acceptance.

## Gate status

| Gate | Status |
| --- | --- |
| Repo bootstrap + security boundary | Implemented; CI verification pending |
| Contract for existing business API | Pending |
| Database/repository migration | Pending |
| Canonical ReviewService port | Pending |
| Offline replay contract tests | Pending |
| OAuth/media integrations | Pending |
| End-to-end checks | Pending |
| Production cutover | **Not authorized** |

This repository contains a runnable **skeleton**, not a drop-in replacement backend.
