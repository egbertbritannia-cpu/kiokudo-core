# Phase 4B — Grammar and IELTS read API contracts

This is a **staging-only**, read-only migration of business APIs. No Turso production access, OAuth or FE write permission.

Source reference: `japanese-srs-system` @ `3348f4ee49c9539fb9ea60c96e42833811c325ca`. Existing Drizzle tables are reused without DDL or implicit seeding.

| Core endpoint | Response | Legacy coverage |
| --- | --- | --- |
| `GET /api/v1/grammar` | `{lessons,stats,patterns}` | GrammarGallery / search / due statistics |
| `GET /api/v1/grammar/:lessonId` | Lesson object with parsed pattern JSON | Grammar lesson detail |
| `GET /api/v1/grammar/practice?lessonId=&limit=` | `{total,lessonId,exercises}` | Read exercise bank ONLY |
| `GET /api/v1/ielts/dashboard` | `{success,data}` | Real metrics, zero empty-state |
| `GET /api/v1/ielts/materials` | `{success,data}` | Read materials WITHOUT writes/default seeding |
| `GET /api/v1/ielts/sessions[/:id]` | `{success,data}` | Read sessions + logs/mistakes |
| `GET /api/v1/ielts/vocab` | `{success,data}` | Read vocab |
| `GET /api/v1/ielts/mistakes` | `{success,data}` | Read mistake taxonomy |

All routes require the existing Core Bearer service credential, and the existing startup staging-identity preflight. If there is no staging DB or the learning tables have not been provisioned, business endpoints return 503. No write endpoints are added.

## Intentional differences from legacy

- Legacy `ieltsRepository.getDashboardStats` returned hardcoded demo sessions, bands, mistakes and vocab counts when no data existed. **Core does not claim those are real data**; it returns 0 and empty lists.
- Legacy GET materials seeded 5 books as a write side effect. This API is strictly read-only; staging migrations must provision actual materials independently.
- Core does not create grammar synthetic FSRS cards or accept grade writes from browser.
- The catalog endpoint includes pattern summaries, removing FE-to-database coupling.

## Remaining blockers

Authenticated per-user BFF, actual Grammar Review POST / IELTS session write contracts, offline replay and real production data parity are NOT done. Do not expose these routes publicly or switch production.
