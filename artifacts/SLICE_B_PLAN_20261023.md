# Slice B — search-first (REQ-001 + REQ-002) plan

- Date: 2026-10-23 (Asia/Hong_Kong)
- Backlog: docs/REQUIREMENTS_BACKLOG.md **v0.9.1**
- Scope: Slice B only. HOLD REQ-003 / 004–006 / propose-widen / memory free-pass / Android / product-tools widen.
- REQ-007: layered memory planning-only; not a Slice B blocker.
- Prior readonly inventory gaps: thin official corpus; 4-call budget vs review reserve; coarse progress; no greeting early-path on master; weak failure taxonomy / cite UI.

## Tickets

| ID | Title | Why first / next | Status |
|---|---|---|---|
| **B0** | Greeting / small-talk early-path | Smallest safe UX bite from inventory. | **PR #262** (`cursor/slice-b-greeting-early-path` @ `bc5f78c`) |
| **B1** | Failure taxonomy + cite UI | Map delivery-review / no-source / budget stops to clearer user copy + detail hint in activity UI; keep fail-closed. | **Local branch** `cursor/slice-b-failure-taxonomy` (not in #262) |
| B2 | True progress + review-aware call budget | REQ-002 event-driven progress; reserve review/revision within root budget (4-call tension). | After B1 |

## B0 definition

1. Add `isPureGreetingOrSmallTalk` with positive greeting markers.
2. Skip delivery review only when greeting matches and care-domain / advisory patterns do not.
3. Model `kind` alone must not force review on trusted greeting shapes.
4. Unknown citation-free wording still fails closed into review.
5. Do **not** reintroduce `serverVerifiedMemoryGrounding` free-pass.

## B1 definition (this branch)

1. Split opaque `delivery_review_incomplete` into:
   - `delivery_review_rejected` — independent review did not pass / insufficient evidence
   - `delivery_review_no_sources` — pass would need supporting excerpts but draft has none
   - `delivery_review_budget` — no remaining model calls for review / repair+re-review
   - keep `delivery_review_incomplete` for parse / hash / live retract / provenance gaps
2. Parent-facing labels via `agentStopMessage`; optional next-step hint via `agentStopDetailHint`.
3. Activity / run details surface the detail hint under the stop label (`stopReasonDetail`).
4. Durable chat body text stays the shared incomplete copy (does not leak unreviewed claims).
5. Fail-closed unchanged: unreviewed care wording still never becomes a formal reply.

## Out of scope

- Opening B1 PR until tip ready and supervisor asks
- Merging #254 / labels strip
- Corpus ingestion, Android, assistant modes

## Follow-ups

- Open B1 PR when tests green and supervisor asks
- B2 after B1