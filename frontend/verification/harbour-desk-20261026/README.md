# Harbour Desk: public verification summary

Status: bounded synthetic preview pass; production/native acceptance is not claimed. This is not a
production release, deployment approval, or a claim that the whole UI is accepted.

## Source identity and publication boundary

- Reviewed source commit: `1facfec21cd4e4ef52aaf283a44cec62d72310e5`.
- Original source tree: `6d99127e2e3d7eee9c5a6e13b9206c4e331714ea`.
- Previous comparison candidate: `f8ce34a0e5dfbd1d57bdd704e324ae098b0b901c`.
- The public snapshot changes verification documentation only. Product code,
  tests, configuration, dependencies, and existing baseline documents retain
  their reviewed bytes. Its Git tree therefore differs from the original tree.
- Detailed working logs, intermediate receipts, raw exports, source maps,
  screenshots, and private execution locations are not distributed here.
  Earlier failures are summarized below rather than relabelled as passes.

## Current bounded follow-up

The final source includes the heading hierarchy correction and the two wide
preparation/calendar heading fixes. The wide-heading regression passed 4/4 after
its original 2/4 result; combined semantic SSR passed 23/23, and full frontend
TypeScript and the fresh Web export passed. These counts overlap earlier checks
and must not be added together. Source-map correspondence was checked against
the exact final source. The current portable freeze covers 570 relative inputs,
including three focused test files; earlier counts below describe the prior stage.

A bounded synthetic preview pass covered **18 route entries** for this candidate,
including representative viewport/state checks and the affected final semantics.
Previously checked unchanged behavior was reused within the agreed finite scope;
this is not a fresh exhaustive route-by-viewport-by-state matrix. No known
blocking findings remained within that bounded scope.

Not covered: real backend writes, unknown-commit recovery, outages or permission
revocation; populated photo inspection, uploads, media capture/playback,
extraction or model calls; authentication, real notifications, multi-child or
real-household data; native keyboard/IME/touch and OS screen-readers; or every
route x viewport x state combination. No deployment or merge is implied.

## Earlier source-stage checks (062c4679)

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

`product-source-freeze.json` is updated for the current source: 570 repository-
relative input paths and SHA-256 digests, including three focused test inputs. The unchanged `verify-export.py` and
`package-safe.py` are verification tooling, not stored private build artifacts.
The former regenerates an artifact receipt from a newly supplied export before
the latter consumes it. Such generated receipts are not part of this public
summary, and the build environment and fixture inputs must be supplied separately.

Source, SSR, synthetic tests and source-map checks do not establish real layout,
visible focus, natural scrolling, Back/Forward behavior, native tabs, or complete
screen-reader coverage. The broader matrix remains untested; the bounded pass above does not establish it. Earlier
candidate browser results alone do not establish acceptance of this source snapshot.
No real family data, model calls, production backend writes, permission changes,
site publication, PR, or merge is represented by these checks.
