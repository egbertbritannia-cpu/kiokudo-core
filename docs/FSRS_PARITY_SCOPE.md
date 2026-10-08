# FSRS parity gate — source-authenticated reference

This regression test extracts the **pure calculation** at lines 196–247 from
`japanese-srs-system/src/services/review-service.ts`, commit
`3348f4ee49c9539fb9ea60c96e42833811c325ca`. The test oracle is
`tests/legacy-transition-reference.ts`; its algorithm body was copied
verbatim except the exported function name. The tested code is
`src/services/review-service.ts::calculateReviewTransition`.

## Tested parity
- New / Learning / Review / Relearning card states;
- all 4 FSRS ratings; multiple day offsets;
- stability, difficulty, intervals, counts and exact due timestamps;
- deterministic multi-review trajectories;
- new service atomicity/idempotency remains covered by separate SQLite tests.

## NOT claimed as parity
- Legacy grammar synthetic-card auto-creation, intentionally disabled;
- legacy non-atomic transaction fallback, intentionally disabled;
- actual personalized FSRS params / production histories (no DB snapshot);
- long-term offline replay, concurrent multi-instance races and active Turso
  schema / timestamp representation;
- runtime security and authorization, tested separately.

**Gate remains BLOCKED** until real snapshot read-only schema and data diff plus
staging reconciliation, and full review/grammar path integration are verified.
