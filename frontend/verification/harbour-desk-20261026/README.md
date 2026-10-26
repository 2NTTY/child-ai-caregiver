# Harbour Desk: public verification summary

Status: experimental source snapshot, pending final browser QA. This is not a
production release, deployment approval, or a claim that the whole UI is accepted.

## Source identity and publication boundary

- Reviewed source commit: `062c4679f8d70125f9272ce6e00cc9a8e7a127fe`.
- Original source tree: `6d319a913822737ee906667a85951f0639fed6fc`.
- Previous comparison candidate: `f8ce34a0e5dfbd1d57bdd704e324ae098b0b901c`.
- The public snapshot changes verification documentation only. Product code,
  tests, configuration, dependencies, and existing baseline documents retain
  their reviewed bytes. Its Git tree therefore differs from the original tree.
- Detailed working logs, intermediate receipts, raw exports, source maps,
  screenshots, and private execution locations are not distributed here.
  Earlier failures are summarized below rather than relabelled as passes.

## Completed checks for this source candidate

- Focused synthetic tests: **145/145**, no skipped tests, across 17 test files.
  Coverage includes navigation and guarded links, active categories, confirmed
  empty versus unavailable/error/unknown states, scope isolation, heading
  semantics, and preserved input/history/operation behavior.
- Full frontend TypeScript check: `tsc --noEmit`, exit 0. Dependency manifests
  and lockfiles were not changed for this work.
- Fresh Web export: exit 0; 36 HTML documents, 18 required route entries, and
  436 first-party source-map inputs matched the corresponding frozen source
  bytes. The portable source manifest covers 567 source/configuration inputs;
  that number is not a count of changed files.
- All 36 generated HTML roots declared `lang="zh-Hant"`. The server-only HTML
  entry was checked in source and generated HTML, not claimed as a client-map input.
- The existing synthetic HTTP fixture/client/parser contract checks passed
  **30/30**. These are separate from the 145 frontend tests, not additional UI cases.
- Independent review recalculated the source/artifact correspondence and
  checked the map-free fixture package. It also ran bounded semantic/link SSR
  checks; the author's full test suite, TypeScript and export were reviewed
  from their results, not claimed as independently rerun.

## Failures and their disposition

- An initial shell redirection failed before any tests ran.
- Early adjacent-test failures came from missing adapters and obsolete
  navigation assumptions. The adapters and relevant presentation assertions
  were corrected without weakening the scope, guard, payload or reading checks.
- Tests reproduced modified-click/prevented-event failures in the earlier link
  handler, then passed against the corrected handler and installed Expo path.
- A nested operation heading and the default document language were corrected;
  an initial SSR test import also failed on untranspiled native syntax before
  its loading boundary was fixed. Intermediate counts overlap the final 145
  and must not be added together.
- The first map-removal packaging assertion failed because a debug identifier
  followed the mapping directive. The packaging matcher was corrected without
  changing the product bundle or discarding that identifier.

## Reusable inputs and remaining limits

`product-source-freeze.json` is retained unchanged: it contains only repository-
relative source paths and SHA-256 digests. The unchanged `verify-export.py` and
`package-safe.py` are verification tooling, not stored private build artifacts.
The former regenerates an artifact receipt from a newly supplied export before
the latter consumes it. Such generated receipts are not part of this public
summary, and the build environment and fixture inputs must be supplied separately.

Source, SSR, synthetic tests and source-map checks do not establish real layout,
visible focus, natural scrolling, Back/Forward behavior, native tabs, or complete
screen-reader coverage. The current browser matrix remains pending. Earlier
candidate browser results do not count as acceptance of this source snapshot.
No real family data, model calls, production backend writes, permission changes,
site publication, PR, or merge is represented by these checks.
