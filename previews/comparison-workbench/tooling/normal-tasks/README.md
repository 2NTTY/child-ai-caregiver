# Normal Tasks read-data and clock source tools

Dependency-free, source-only tooling for the pinned Original and Harbour normal Tasks case. This additive package is **not connected to the 458-file application checkpoint**, and does not admit bootstrap, transport, Owner, hook, frame, browser or production readiness.

## What is included

- `src/normal-tasks-read-binding.mjs`: the fixed 17-ID projection of one child, six tasks, occurrences, reminders, batches and complete task histories into native read-data shapes.
- `src/normal-tasks.mjs` and `src/registry.mjs`: unchanged supporting projection and closed source-pin validation.
- `scripts/project-normal-tasks-clock.mjs`: the reviewed C1/C2-corrected pure source projector. It accepts pinned caller-supplied bytes and returns inert derived source strings: one import and two clock-call replacements per native hook, plus a fixed-clock helper. It does not write or execute those strings.
- `fixtures/normal-tasks.json`: the unchanged synthetic case, SHA-256 `d108aca1f8248e76e28ce4ab5c3497005cff5f1e6f15f2d23081b8d32bd2d5e4`.
- `fixtures/native-contracts/`: 32 exact pinned source specimens, read only as bytes by the tests. These intentionally incomplete donor subsets are **not runnable apps or importable Owner packages**.
- `fixtures/expected-clock-projection.json`: the unchanged inert expected-output test vector, SHA-256 `ce1ef3085759d866c8942c8b3115332fae4b9fe55aa076f7c3ffa6367f1ae43d`; it is not an installed source overlay.
- `sources/`: source identities, contract hashes and public subset inventories.
- `PROVENANCE.json` and `SOURCE-MANIFEST.json`: reviewed origin identities, explicit packaging differences and exact delivered file identities.

## Run the self-contained pure tests

Use the declared project environment, Node `>=24.12.0 <25`. No package installation is needed. From this directory:

```sh
node --test --test-concurrency=1 tests/source-pair/normal-binding.test.mjs tests/source-clock/clock.test.mjs tests/source-clock/review-r1.test.mjs
```

`npm test` runs the same test selection. The test graph imports only the four pure JavaScript modules, package-local JSON and Node built-ins. Native source specimens and projected source strings are never imported or evaluated.

Fresh packaging verification on **2026-11-01 UTC**, Node **24.22.1**: **20/20 tests passed**, exit 0. This covers six read-binding and fourteen source-clock tests; it is not a fresh native parser or Owner test result. No dependency installation, SDK/app execution, TypeScript compilation, export or browser test was performed for this delivery.

## Packaging differences and provenance

All four core modules, the normal fixture, registry JSON, expected projection and 32 source specimens retain their original bytes. Only two metadata files and three test locators were adapted:

1. `normal-tasks-read-bindings.json` points to local public source specimens and newly generated subset inventories. Each subset inventory preserves the original source identity, file pins and historical full-inventory digest; it is not presented as the historical full inventory.
2. Unpublished receipt/full-inventory file locators and recovery-root labels in `task-bindings.json` are `null`. Their historical digest values, source identities, file pins and other contract data remain unchanged. A digest is provenance, not a bundled receipt.
3. The three test files resolve their inputs inside this package; the regression test reads the preserved expected-output vector at its new fixture location. Test assertions were not removed or rewritten.

The read-pair source review digest is `258c2273bba94c67b6dab1bb500d548b072e56d278dc4d5c3ffdf20067b8d8ec`; the clock-fix source review digest is `514c55270496ad2caae54ee6854f39e3319e5f035957ad46b52d4a4f672057f2`. Those historical SOURCE ALLOW decisions do not by themselves approve this relocation or establish runtime compatibility. Local reviewed tree IDs in provenance are not claims that those trees were earlier published as commits.

## Boundaries

The normal case clock is `2026-10-04T16:00:00+08:00`, with declared `Asia/Hong_Kong` metadata; actual browser timezone remains unverified. The projector does not patch global time or native timer/auth/scope/mutation logic.

All readiness flags remain false. The read-binding module still lists bootstrap, native clock wiring, writes/reconciliation, non-Tasks pages and sourceframe/runtime as unavailable: generating clock source text does not install it. Original and Harbour use their exact independent frozen source identities; this package does not substitute the mixed Tasks owner for either full version.

No real family records, photographs, messages, credentials, raw private receipts, full recovery inventories or diagnostic logs are included. Do not use this package to claim successful writes, real authentication, model access, GCP operations, deployment or whole-site acceptance.
