# Slice B — B3 retain sources on delivery-review failure

- Date: 2026-10-24 (Asia/Hong_Kong)
- Backlog: docs/REQUIREMENTS_BACKLOG.md **v0.9.1**
- Scope: Slice B remainder (REQ-001 cite closed loop + REQ-002 section 5.3 partial retention). HOLD REQ-003/004-006 / propose-widen / memory free-pass / Android / labels strip / #254 tip rewrite.
- Prior: B0 #262 greeting; B1 #263 failure taxonomy; B2 #265 soft review reserve + reviewing progress (partial). This ticket is **independent of B0-B2 tips** (branched from current origin/master).

## Inventory (code truth after B0-B2 open PRs)

Closed loop still broken when corpus allows search+cite:
1. acceptReviewedDelivery nulls the whole presentation on any review failure, so citations become empty even after successful search_knowledge + present_answer.
2. Stopped results only show incomplete copy; found official sources are discarded (against REQ-002 source layer / section 5.3).
3. Still remaining after B3 (not this PR): hard review/revise budget, early source-card stream before answer, disconnect recovery, corpus coverage, cite UI polish beyond B1.

## B3 definition (this branch)

1. On delivery-review stop (delivery_review_*), clear unreviewed draft text (never elevate to formal answer).
2. Re-run live presentation() and, if sources still revalidate, retain citations / privateSourceCitations / retrievalMode on the stopped result.
3. Source retract / revalidation failure still drops sources (fail closed).
4. No deliveryReview pass binding; status stays stopped.
5. Wire interactive (+ background care) result assembly so stopped review failures can surface retained citations.

## Out of scope

- Merging B0-B2; rewriting their tips
- Raising modelCalls / daily quotas
- Streaming source cards mid-run
- Android / memory free-pass / propose widen
