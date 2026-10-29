# Slice B — B4 hard delivery-review budget reserve

- Date: 2026-10-27 (Asia/Hong_Kong)
- Backlog: docs/REQUIREMENTS_BACKLOG.md **v0.9.1** (REQ-001 closing plan must count first review + allowed revise/re-review; early bounded wind-down when balance insufficient). REQ-002 planningSnapshot was soft-only on #265.
- Scope: Slice B remainder. HOLD merge of open B0–B3 tips (#262/#263/#265/#273). HOLD REQ-003/004-006 / propose-widen / memory free-pass / Android / labels strip / PRIMARY / daily quota / raising AGENT_LIMITS.modelCalls.
- Prior: B0 #262 greeting; B1 #263 failure taxonomy; B2 #265 soft review reserve + reviewing progress (partial — hard finish lock stayed on last call); B3 #273 retain sources on review fail. This ticket is **independent of B0–B3 tips** (branched from origin/master @ fd5f432).

## Why B4 (not mid-run source cards)

- Narrower and unit-testable on the server budget path.
- Independent of Owner reviews / frontend streaming.
- #265 explicitly did **not** hard-guarantee a review call left; B4 closes that gap.

## B4 definition (this branch)

1. `planningSnapshot(..., { reserveDeliveryReview: true })` for `product-interactive`: **hard** finish reserve = 1 (present/finish) + 1 (delivery review). `phase === "finish"` when remaining model calls ≤ that hard reserve (not soft metadata alone).
2. `assertDeliveryReviewReserveAvailable`: when reserve is active and only the review call remains, refuse another agent generation (`delivery_review_incomplete`) so the reserved call is not spent on non-review work. Review `completeText` runs after the agent loop and does not hit this gate.
3. Revise/re-review stays opportunistic when budget remains after the first review (existing `remainingModelCalls >= 2` path). No hard revise reserve; no raise of default modelCalls=4.
4. Non-`product-interactive` / no-reserve paths unchanged (greeting-like and contract recipes keep finish reserve = 1).

## Out of scope

- Merging or rewriting #254 / #262 / #263 / #265 / #273 tips
- Mid-run source-card stream before answer
- Disconnect recovery, corpus coverage, cite UI polish beyond B1
- `delivery_review_budget` stop-code taxonomy (owned by B1 #263) — reuse existing `delivery_review_incomplete` on master
- Raising modelCalls / daily quotas / Android / memory free-pass / propose widen
