# Growth reading index candidate (PR #593)

Base: `b3aba8d72403725db9c3fb83dd78b56d61292fa0`.
This is an isolated candidate, not a production migration or rollout approval.

## Behavior

- Complete legacy reads remain available until the derived index is ready. There is no fixed lookback that loses ancient active attention records.
- An authenticated background worker processes at most 200 source records per transaction, persisting an encrypted cursor and random bucket mapping. A failed transaction commits neither progress nor metadata. Source ciphertext, versions and original dates are not rewritten.
- Ready reads fetch all active records plus 31 closed records, using canonical timestamps and the existing history cursor contract. Active records remain unbounded by design.
- Indexed writers update source metadata and the encrypted marker in the same transaction. Older writers are detected using the workspace journal. Contiguous encrypted journal verification preserves progress across unrelated chat and other-child changes.
- Verification is capped at 200 journal entries. Gaps, larger deltas, authority changes and same-child growth/tasks/memory/children entries conservatively invalidate the index. Legacy compound growth operations can journal as tasks or memory, so ignoring those categories would be unsafe.
- Existing `growth_checks` backup/cleanup collection is reused. Restore recognizes the new encrypted record type but does not restore source index metadata; the authority hash includes the original scope/epoch/generation and forces reconstruction under a changed restore scope. Child/account deletion removes the source rows rather than leaving a separate searchable copy.

## Explicit limitations and privacy

This is not a constant-cost first-ever read. Before construction completes or after invalidation, the complete legacy history scan remains necessary. The 30-second continuation schedule means a large dataset may take many dispatches. Same-child legacy-compatible task/memory traffic or journal gaps may repeatedly restart migration. No blanket performance completion claim is warranted.

Random bucket tokens do **not** make classification information invisible to a database reader. They expose stable group membership, counts, canonical timestamps and query/access patterns for a child; correlation can infer which bucket is active. The encrypted marker hides the literal mapping, not these inferences. This adds derived query metadata and a composite index and requires a separate production privacy/rollout decision.

Tests use a serial synthetic transaction fixture, not a real Firestore emulator. Production transaction retry contention, composite-index deployment/readiness, worker latency and full restore rehearsal are not verified here. No real family data, production database, deployment or API call was used.

## Verification scope

- Synthetic C04 covers bounded 200-row progress, transaction interruption/rollback, replacing the process between batches, ancient active rows, legacy ISO offsets, full pagination, ready cold-process reads, indexed import writes, unrelated journal traffic, missing journal entries, legacy growth and tasks mutations, and wrong-scope encrypted marker rejection.
- Baseline candidate five-file run: 34 tests passed, including the existing >20,000-record evaluation recovery test.
- After the journal correction, the five-file run passed 34/34 again (89.46 seconds). The intended negative test-name filter did not exclude the >20,000-record evaluation recovery case; the output confirms it ran and passed. A subsequent index-comparator run passed 9/9 including the added migration/reading-index composite assertion.
- Final server typecheck: `node --max-old-space-size=4096 node_modules/typescript/bin/tsc --project tsconfig.server.json --noEmit` passed. A prior default 2 GB heap attempt exhausted memory, not a TypeScript diagnostic.
- Independent correctness/privacy review performed separately; final review must bind the candidate commit before any integration.
