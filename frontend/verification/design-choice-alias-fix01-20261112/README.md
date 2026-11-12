# Design-choice alias fix 01: public-safe source backup

This is a non-deployed, reviewed candidate for the existing design-comparison workbench. No PR or merge is requested by this backup.

## Fix

The selection ID now uses the already-admitted canonical page path, preserving variant and part. Known pathname aliases for the same page deduplicate. First-selected actualPath remains source provenance. Canonical old IDs remain unchanged, such as `care:/summary:page` and `care:/:page`.

Exactly one product file differs from the aligned base: `source/dist/experiments/workbench-compare/design-choices.mjs`. Main, catalog, fixture, observation matching, readiness and reload/navigation gates are unchanged. There is no migration, persistence or import of existing choices; old live selections and exports were not rewritten.

## Contents and transformations

The full source has 601 files: 575 deployment files exactly matching the verified fix candidate, plus 26 historical non-deployment files. Four historical JSON files replace 11 private local input-location fields with `[private-local-input-omitted]`. All other 597 source files are exact. The original private files and raw verification evidence are retained privately. No raw browser evidence, credentials or original private filesystem paths are included.

`SOURCE-TRANSFORM.json` identifies every changed JSON field and original/public-safe file hash. `SOURCE-MANIFEST.json` contains the exact public-safe source inventory. `VERSION.json` and `VERIFICATION.json` pin the candidate and the bounded test/review results. Two regression test files are included unchanged from the verified candidate.

## Verify after extraction

Run `python verify.py` to check all source files. Run `node --test tests/*.test.mjs` with a compatible installed JSDOM available through `JSDOM_PATH` if the retained development lookup is unavailable. No dependency installation is included in this archive.

32/32 candidate tests passed; independent read-only review found no blocking issue. A narrowly scoped browser smoke verified the two Summary pathname forms keep one choice. This is not whole-site acceptance or proof of public clean-route/header behavior. The local-only 127-byte Summary carrier alias and raw browser artifacts are intentionally excluded from source.
