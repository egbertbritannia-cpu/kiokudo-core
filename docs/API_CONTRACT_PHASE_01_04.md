# Kiokudo API contract — FE ↔ BFF ↔ Core (Phase 01–04)

**Version:** draft `2026-10-10-p01-p04` · **Owner:** single-owner staged dataset · **Status:** CODE_WRITTEN_UNTESTED. This is the integration contract, **not** an assertion that staging or production is configured. Source branches must be reviewed and built before merge. No production migration or deployment is authorized.

## 1. Base URLs & authorization

- **Browser → Next.js BFF:** `/api/backend/api/v1/...` (same-origin; `credentials:'same-origin'`).
- **Next.js → Fastify Core:** `{KIOKUDO_CORE_URL}/api/v1/...` (server only). Never use the service token or signing key in the browser.
- **Browser auth:** HttpOnly SameSite Strict `kiokudo_owner_session`; login via `POST /api/auth/login`; session lookup `GET /api/auth/session`. Session endpoint provides `ownerKey` only after cookie validation; this is a local cache partition, **not** authorization proof.
- **Core auth:** `Authorization: Bearer <server-token>` plus `x-kiokudo-owner-assertion: <signed-method-path-scope>`; `KIOKUDO_OWNER_SUBJECT`, `KIOKUDO_SINGLE_OWNER_DATASET_ACK=true`, staging marker and secrets must be separately verified by operator.
- **Write gate default OFF:** Web `KIOKUDO_WEB_STAGING_WRITES_ENABLED=true`, Core `KIOKUDO_STAGING_WRITE_ENABLED=true`; the BFF additionally needs its read/staging gate enabled. Client `NEXT_PUBLIC_KIOKUDO_STAGING_WRITES_ENABLED=true` only activates optional Grammar UI sending; **it is not a security gate**.
- **Curriculum mapping import gate:** Core `KIOKUDO_MAPPING_IMPORT_ENABLED=true` in addition to write gate and signed owner; never import arbitrary source/card IDs.
- **Login public rate limit:** production Web login requires `KIOKUDO_PUBLIC_LOGIN_RATE_LIMIT_ACK=true` *after* a real edge/proxy distributed rate limiter has been provisioned. This is operator attestation, **not** a rate limiter implementation. No plain passwords or hashes in Git.
- **Database:** no DDL runs automatically. Staging-only additive migration `kiokudo-core/migrations/20261010_p04_learning.sql` **requires independent operator approval and verified staging provenance**. Old data is never copied or mutated automatically.
- **CSRF:** browser mutation must include a valid same-origin `Origin` header and JSON content type. BFF uses a pinned HTTPS staging host for remote Core.

### Common response/error envelope

Most write endpoints return `{success:true,status:'created|applied|duplicate|draft_saved|submitted|undone',data:{...}}`; transport errors use `{error:'code'}` (some include `success:false`). Do **not** treat HTTP 2xx without matching `eventId`, `requestId`, session ID and canonical Core data as success.

| HTTP | Meaning | FE behavior |
| --- | --- | --- |
| 400 / 415 / 413 | Validation/content type/body too large | Keep local draft or failed event; show non-synced |
| 401 | Session/assertion invalid | Re-authenticate; no blind replay |
| 403 | CSRF, staging write or import gate disabled | Keep local data; never label synced |
| 404 | No record / unsupported route | Do not invent card, lesson or session |
| 409 | ID/revision conflict, non-latest undo or already submitted | Stop replay, resolve explicitly |
| 503 | Remote staging, schema migration, owner ack, DB or rate limit not configured | Retry only after operator fixes config |
| 502 | Core unavailable/unexpected payload | Retain event ID and retry |

## 2. Authentication — Web endpoints

### `POST /api/auth/login` (Phase 01)

JSON body `{"password":"<user entered string>"}`. Requires trusted `Origin`, JSON body ≤1024 UTF-8 bytes and successful async scrypt match. `200 {"authenticated":true}` with signed HttpOnly cookie. `401 invalid_credentials`; `403 forbidden_origin`; `503 login_rate_limit_unconfigured` for public deployment without verified ingress protection, or `auth_not_configured`. Password is never sent to Core.

### `POST /api/auth/logout` (Phase 01)

Clears cookie on trusted same-origin request; client must also clear any locally cached owner key and stop offline replay for the old owner.

### `GET /api/auth/session` (Phase 01)

`200 {"authenticated":true,"ownerKey":"<single-owner subject>"}` or `{"authenticated":false,"ownerKey":null}`. Owner key only scopes local IndexedDB outbox partition; BFF rechecks cookie and signed Core assertion for each operation.

## 3. Infrastructure / cards / FSRS — Core endpoints (BFF mirrors GET/POST where allowlisted)

### `GET /api/v1/health`

Public Core liveness. `{"status":"ok","service":"kiokudo-core","apiVersion":"v1"}`. No learner data.

### `GET /api/v1/status`

Core service-bearer only, no learner payload. Returns phase/readiness flags including `productionCutoverAllowed:false`.

### `GET /api/v1/cards` (Phase 01+02)

Query: `deck?:string`, `search?:string`, `limit?:integer<=2000`. Returns `{success:true,data:Card[],decks:Deck[]}`. Each card includes existing Core card `id` and FSRS fields. Never use curriculum source key as canonical `cardId` without a stored mapping.

### `POST /api/v1/reviews` (Phase 02)

Body:
```json
{"eventId":"review_immutable_01","cardId":"core_card_id","rating":"Good","reviewedAt":"2026-10-10T07:00:00.000Z","responseTimeMs":2400}
```
`rating`: `Again|Hard|Good|Easy`. **Client must provide stable `eventId`**, including after browser restart or lost response; legacy server can generate one for non-offline callers but browser sender must not rely on that. Response:
```json
{"success":true,"status":"applied","eventId":"review_immutable_01","data":{"cardId":"core_card_id","rating":"Good","state":"Review","stability":3.2,"difficulty":5.5,"scheduledDays":2,"nextReviewDate":"2026-10-12T07:00:00.000Z"}}
```
`status='duplicate'` means same event was applied earlier; no second FSRS mutation. Conflict `409 EVENT_ID_CONFLICT`. `409 REVIEW_ALREADY_UNDONE` prevents replay after server undo. Store result only on matching canonical event/card/rating. Event + pre-grade snapshot + FSRS history are stored transactionally on staged database; requires additive migration.

### `POST /api/v1/reviews/batch` (Phase 02)

Body `{"reviews":[{"eventId":"...","cardId":"...","rating":"Hard","reviewedAt":"..."}]}` (1–200 records; **each** must have stable eventId). `200` envelope contains `results` each status `applied|duplicate|rejected`, `processedCount`, `rejectedCount`. Respect transaction behavior and inspect each result; never delete non-acknowledged queued events.

### `POST /api/v1/reviews/{eventId}/undo` (Phase 02)

Body `{}` (JSON). Response `{"success":true,"eventId":"...","status":"undone|already_undone","cardId":"..."}`. Only the **latest unambiguous review on that card** with persisted snapshot may be reversed. Older-event or card-state divergence → 409; missing snapshot → 404. Tombstone blocks reapplying old event ID after undo. FE may locally cancel a never-sent event without calling this endpoint; an uncertain/in-flight event must not be assumed undoable.

## 4. Grammar & JPD133 (Phase 04)

### `GET /api/v1/grammar`

Read-only catalog with `lessons`, `patterns`, stats. FSRS card counts are based on existing `grammar_jpd133` deck/tag heuristics and are not proof of stable mapping.

### `GET /api/v1/grammar/{lessonId}`

Read-only lesson + normalized JSON patterns. `404 lesson_not_found`.

### `GET /api/v1/grammar/practice`

Query `lessonId?:'all'|id`, `limit?:integer<=200`; returns `{"total":N,"lessonId":"...","exercises":[...]}`. Practice UI currently computes local immediate feedback; saving attempts is distinct from FSRS review writes.

### `POST /api/v1/grammar/practice/attempts`

Body `{"eventId":"stable_uuid_or_id","exerciseId":"existing_id","answer":"A","answeredAt":"2026-10-10T10:00:00.000Z"}`. Core reads the official exercise's answer/options, calculates `isCorrect` itself and persists idempotently. Response `{"success":true,"eventId":"...","status":"applied|duplicate","data":{"exerciseId":"...","isCorrect":true,"answeredAt":"..."}}`. Same event ID with different payload → 409; missing exercise → 404. Requires `kiokudo_grammar_attempt_logs` migration. No fabricated FSRS review occurs.

### `GET /api/v1/curriculum/jpd133/mappings`

Optional query `slot=1|2|3|4|5|6|8|10`. Returns `{"success":true,"data":[{"sourceKey":"jpd133-p1-...","slotNumber":1,"sourcePage":1,"cardId":"existing_core_id"}]}`. Only stored **verified mappings** can authorize source-to-FSRS links; absent mappings are displayed as not linked. Requires `kiokudo_jpd133_card_links` migration. Static manifest source keys are deterministic with respect to array ordering, but a content correction may change a key and demands an explicit review.

### `POST /api/v1/curriculum/jpd133/mappings` (operator only)

Body `{"sourceKey":"jpd133-p1-...","slotNumber":1,"sourcePage":1,"cardId":"existing_core_card_id"}`. Requires `KIOKUDO_MAPPING_IMPORT_ENABLED=true`, signed owner/write gates, an existing card and independently reviewed mapping. `201 created` or `200 duplicate`; `409 mapping_conflict`, `404 card_not_found`. Do not bulk generate cards, synthetic IDs or history.

## 5. IELTS (Phase 04)

### `GET /api/v1/ielts/dashboard`

`{"success":true,"data":{...}}` with session stats and real recorded progress. Empty tables yield no fabricated bands.

### `GET /api/v1/ielts/materials`

`{"success":true,"data":[...materials]}`. No seeded fake tests during GET.

### `GET /api/v1/ielts/sessions`

Query `limit?:integer<=100`. Lists existing sessions, newest first.

### `GET /api/v1/ielts/sessions/{id}`

`{"success":true,"data":{...session,"logs":[...],"mistakes":[...]}}` or 404.

### `GET /api/v1/ielts/vocab`

Read-only saved vocabulary list `{"success":true,"data":[...]}`.

### `GET /api/v1/ielts/mistakes`

Read-only saved mistakes `{"success":true,"data":[...]}`.

### `POST /api/v1/ielts/sessions`

Create immutable client session ID, so retry is idempotent. Body:
```json
{"sessionId":"uuid_or_stable_id","section":"Reading","testType":"academic","materialId":null,"testNumber":"Test 1"}
```
Valid section `Listening|Reading|Writing|Speaking`, testType `academic|general`. Response `201 {"success":true,"status":"created","data":{"id":"...","revision":0,"sessionStatus":"in_progress"}}` or `200 status=duplicate` with **current** `revision` and status. Conflicting reuse → `409 session_id_conflict`. Creates `kiokudo_ielts_mutation_state` entry in same transaction.

### `PUT /api/v1/ielts/sessions/{id}/draft`

Body:
```json
{"requestId":"stable_retry_id","expectedRevision":0,"answers":[{"number":1,"answer":"A"},{"number":41,"answer":"writing task text"}]}
```
`number` ∈ 1–42 (41/42 reserved for writing); answer length ≤20k; max 42 unique entries. A full draft **replaces all saved answers transactionally**. Response `200 {"success":true,"status":"draft_saved","requestId":"...","data":{"sessionId":"...","revision":1,"sessionStatus":"in_progress"}}`. Repeating the last requestId returns the stored canonical acknowledgment; stale expectedRevision → 409 and currentRevision. Retain localStorage draft/retry key if request is uncertain. No automatic score/grade.

### `POST /api/v1/ielts/sessions/{id}/submit`

Body `{"requestId":"stable_retry_id","expectedRevision":1}`. Requires prior draft; response `status:'submitted'` and `data:{sessionId,revision:2,sessionStatus:'completed'}`. Idempotent last request; duplicate create later returns current completed status. Does **not** assign band scores; scoring and human review are separate.

### `POST /api/v1/ielts/mistakes`

Body `{"id":"stable_id","sessionId":"existing_session_id","category":"Vocabulary","rootCause":"...","actionPlan":"..."}`. Stores explicit user-provided analysis, not invented grading. `201 {success:true,data:{id}}`; `409 duplicate_mistake_id`, `404 session_not_found`.

### `POST /api/v1/ielts/vocab`

Body `{"id":"stable_id","sessionId":"existing_session_id","word":"paraphrase","meaning":"...","partOfSpeech":"noun"}`. `201 {success:true,data:{id}}`; `409 duplicate_vocab_id`, `404 session_not_found`.

## 6. FE integration recipes

**FSRS:**
```ts
const event = prepareReviewEvent({ownerKey,cardId,rating:'Good'}, crypto.randomUUID());
await indexedDbOutbox.enqueue(event);
await replayStoredReviews(ownerKey);
// Do not claim a successful grade until canonical ack was persisted.
```

**IELTS:**
```ts
const session = await post('/api/v1/ielts/sessions',{sessionId,section,testType});
const draft = await put(`/api/v1/ielts/sessions/${sessionId}/draft`,{
  requestId:draftRequestId,expectedRevision:session.data.revision,answers,
});
const result = await post(`/api/v1/ielts/sessions/${sessionId}/submit`,{
  requestId:submitRequestId,expectedRevision:draft.data.revision,
});
// 'completed' means submitted, NOT automatically scored.
```

**JPD133:** use source manifest `id` only as `sourceKey`. Resolve the real `cardId` via `GET mappings?slot=N`. No link → do not create FSRS grade or fake card row.

## 7. Activation blockers, safety and acceptance status

1. These branches contain **unverified source code**; tests/check/build/browser E2E were **NOT EXECUTED by request**. No code changes were merged or deployed automatically.
2. **Migration required:** `migrations/20261010_p04_learning.sql` must be reviewed, backed up and executed by an authorized operator on **verified isolated staging only**. The new transactional FSRS event snapshots mean even old Core review writes on a new branch now need the undo tables; a missing migration should fail rather than silently dropping undo safety.
3. Operator must explicitly verify one-owner staging dataset, signed principal, HTTPS Core origin, edge login throttle, and secrets configured only in private dashboards. Browser write flag OFF until then.
4. No real production snapshots, DB exports, migration, cloud writes, rollback rehearsal or public deployment are performed by this implementation.
5. **Progress checkpoint:** code on unmerged feature branches is `IMPLEMENTED_UNVERIFIED`, never `DONE_VERIFIED`. Feature completion still requires end-to-end acceptance and matching schema version.
