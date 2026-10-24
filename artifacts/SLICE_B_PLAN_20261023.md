# Slice B — search-first (REQ-001 + REQ-002) plan

- Date: 2026-10-23 (Asia/Hong_Kong)
- Backlog: docs/REQUIREMENTS_BACKLOG.md **v0.9.1**
- Scope: Slice B only. HOLD REQ-003 / 004–006 / propose-widen / memory free-pass / Android / product-tools widen.
- REQ-007: layered memory planning-only; not a Slice B blocker.
- Prior readonly inventory gaps: thin official corpus; 4-call budget vs review reserve; coarse progress; no greeting early-path on master; weak failure taxonomy / cite UI.

## Tickets

| ID | Title | Why first / next | Status |
|---|---|---|---|
| **B0** | Greeting / small-talk early-path | Smallest safe UX bite from inventory: citation-free 你好/hi must not fail closed into independent review; care-shaped text never exempt. No memory free-pass, no propose widen. | **This branch** |
| B1 | Failure taxonomy + cite UI | Map delivery-review / no-source / budget stops to clearer user copy + expandable details; keep fail-closed. | Next |
| B2 | True progress + review-aware call budget | REQ-002 event-driven progress; reserve review/revision within root budget (4-call tension). | After B1 |

## B0 definition (done here)

1. Add `isPureGreetingOrSmallTalk` with positive greeting markers.
2. Skip delivery review only when greeting matches and care-domain / advisory patterns do not.
3. Model `kind` alone must not force review on trusted greeting shapes.
4. Unknown citation-free wording still fails closed into review.
5. Do **not** reintroduce `serverVerifiedMemoryGrounding` free-pass.

## Out of scope for B0

- Opening a PR (supervisor decides)
- Merging #254
- Labels strip PR
- Corpus ingestion, Android, assistant modes

## Follow-ups

- B1 / B2 only after supervisor green-lights next ticket
- Rebase onto master if #254 or other review-path PRs land first