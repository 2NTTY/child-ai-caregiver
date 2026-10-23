# Slice B — search-first (REQ-001 + REQ-002) plan

- Date: 2026-10-23 (Asia/Hong_Kong)
- Backlog: docs/REQUIREMENTS_BACKLOG.md **v0.9.1**
- Scope: Slice B only. HOLD REQ-003 / 004-06 / propose-widen / memory free-pass / Android / product-tools widen.
- REQ-007: layered memory planning-only; not a Slice B blocker.

## Tickets

| ID | Title | Status |
|---|---|---|
| **B0** | Greeting early-path | **PR #262** |
| **B1** | Failure taxonomy + stop detail hints | **PR #263** (`cursor/slice-b-failure-taxonomy` @ `e2e36c3`) |
| **B2** | True progress + review-aware call budget | **Local commit** on `cursor/slice-b-progress-budget` (based on B1); PR not opened yet |

## B2 definition (this branch)

1. `planningSnapshot(..., { reserveDeliveryReview: true })` for `product-interactive`: soft guidance only — `reserveForFinish.modelCalls` becomes 1+reviewReserve and `reserveForDeliveryReview.modelCalls` is 1; **hard finish lock stays at the last model call** (avoids forcing terminal tools one call too early).
2. Emit real progress phase `reviewing` ("正在獨立核對回覆") before delivery review on interactive finalize.
3. Keep fail-closed if review still has no remaining call (`delivery_review_budget`).
4. No daily quota raise; no raise of hard `AGENT_LIMITS.modelCalls` default of 4.

## Tests (local)

- New: `planningSnapshot reserves delivery review...` and `reviewing phase is a real progress event...` pass.
- Pre-existing (unrelated): agent-budget deadline `90001` assert; chat-delivery-review `unavailable`; agent-feedback formal HTTP `calls===2` (actual 3).

## Out of scope

- Opening B2 PR until supervisor asks
- Corpus / Android / #254 / labels strip
