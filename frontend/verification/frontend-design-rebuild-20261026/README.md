# Family Journal: public verification summary

Status: independent experimental snapshot with a bounded synthetic preview pass.
Saving this source is not production deployment, merge approval, or full acceptance.

## Source identity and publication boundary

- Reviewed source candidate: `5fa35b6fba7244bf528517a009eb92ad3c95e90a`.
- Original tree: `3a7a223aea4b33e35bb46232cce549521f6a4e98`.
- Common comparison baseline: `0b9f5d60e73eb395ea8a2898864fa1e591e27938`.
- An earlier source candidate was `979219fa97532059afe0878c70433f06c23ffa7a`.
  Its chat-layout failure is not hidden by the later correction.
- Newly added verification documentation/run evidence is summarized or excluded
  for public distribution. In addition, `frontend/STATUS.md` retains its already-
  public baseline version; use this summary for the current experimental status
  rather than that retained baseline STATUS. Product code, tests, configuration,
  dependencies and all other baseline documents retain their reviewed bytes.
  The publication tree therefore differs from the original source tree.
- Private logs, raw export/source-map artifacts, screenshots, internal reports
  and execution paths are not included in this public evidence summary.

The [18-route design](../../EXPERIMENT_FRONTEND_DESIGN_REBUILD.md) and retained
official upstream skill snapshots are unchanged. They record design provenance,
not private execution output or a claim that all routes passed browser QA.

## Current bounded follow-up

The final source corrects heading semantics without replacing the existing
owners or chat-layout correction. The original title-level regression was
reproduced before correction; focused DOM checks passed 8/8 and existing status
cases 3/3. Full frontend TypeScript and the fresh Web export passed, and exact
final source-map correspondence was checked. The earlier 78-test combination
below is prior-stage evidence, not a new rerun or an additive test count.

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

## Earlier source-stage checks and scope (e0a8fb1)

- The prior chat-layout candidate passed **78/78 focused tests across 15
  scripts** and the full frontend TypeScript check. Earlier 62-test and
  74-test combinations are historical, overlapping subsets, not extra passes
  to add to 78.
- The chat-specific checks include three synthetic layout/state cases and
  preserved history/anchor and journal checks. The bounded 12-test combination
  is also a subset, not 12 additional full-browser cases.
- An AST comparison checked that the ChatContents business body changed only
  for two layout-measurement callbacks and two test IDs. Timeline, zoom-correct
  anchor, initial-position and composer implementations retained their bytes.
- The shared synthetic fixture/client/parser contracts passed **30/30**, with
  96 requests and six intentionally blocked negatives. They are a separate
  boundary check and do not represent production backend use.
- Exact-source export/source-map correspondence was reviewed for the latest
  candidate. A bounded synthetic chat browser check subsequently passed;
  that does not establish the remaining page, heading, keyboard or responsive
  matrix. See the [chat correction summary](chat-viewport-browser-fix/README.md).
- Selected palette comparisons exceeded 4.5:1. This is not a complete
  accessibility audit.

## Preserved failures

- Initial type checks encountered unavailable restored dependencies, one
  unsupported icon name, and two unreachable branches after a UI requirement
  changed. These setup/source issues were corrected before the reported pass.
- An earlier mixed test command accidentally selected four browser cases; all
  four failed at browser launch because the requested executable was absent.
  No pages were opened and that batch was not called wholly successful.
- An older source/photo harness failed 27 cases on a missing test transport or
  untranspiled native syntax. It did not establish product interaction results
  and is not reported as passed.
- Early targeted cases exposed a missing forwarded callback, an empty-calendar
  presentation issue, and an incomplete Summary test input. Their corrected
  results do not erase the earlier failures or justify summing rerun counts.

## Remaining acceptance boundary

The broader four-size layout, complete keyboard/screen-reader, gestures, native
devices, production backend, real model/PDF and persistent-save matrix remains
unaccepted. Source/DOM tests cannot substitute for those checks. Further changes
after this source snapshot are outside its bounded acceptance. Only synthetic
data was used; no real-family data or credentials are distributed, and no site
publication, PR, merge or account-permission change is implied.
