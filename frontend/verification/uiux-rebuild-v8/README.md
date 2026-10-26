# Care Workspace: public verification summary

Status: bounded synthetic preview pass; production/native acceptance is not claimed. This summary does
not approve a production release or claim completion of the full UI matrix.

## Source and documentation boundary

- Reviewed source commit: `7a1e973f76083ee77daca1e606ce8e8e37746852`.
- Original source tree: `9486b32188326ff2ae8faa0d059f095063f7a4d6`.
- Earlier comparison candidate: `8b512f6`; common product baseline: `0b9f5d6`.
- Product code, tests, configuration and dependencies retain the reviewed source
  bytes. This public verification summary is rewritten, and `frontend/STATUS.md`
  deliberately retains its already-public parent version without republishing the
  candidate status payload. For this snapshot's current status, use this summary
  rather than that retained baseline STATUS. Other source entries are unchanged;
  the publication tree is not the original source tree.
- Detailed working logs and private execution locations are not included.
  The retained design-search text is public design research, not private run
  evidence. It does not make irrelevant sales/landing-page recommendations into
  product requirements.

The existing [requirements disposition](requirements-disposition.md) and
[route plan](../../EXPERIMENT_UIUX_REBUILD.md) retain their source bytes.
`heading-level-plan.json` is likewise unchanged because the actual heading test
loads it as an input, rather than treating it as a discarded run receipt.

## Current bounded follow-up

The final source corrects heading semantics and the source-search accessible
name. Focused DOM checks passed 8/8, existing status cases 3/3, and the targeted
source-search check 1/1; full frontend TypeScript and the fresh Web export passed.
These are separate bounded sets, not an expanded all-suite pass. The broader
search runner had an unrelated missing task-harness port; only the source-specific
result above is claimed. Exact final source-map correspondence was checked.
The earlier 93-test combination below is prior-stage evidence, not a new rerun.

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

## Earlier source-stage checks (87b05e3)

- Prior corrected combination: **93/93 focused tests**, covering home states,
  tasks/records, reports/profile, attachments/sources, chat viewport/composer/
  focus, installed Expo links, navigation, shared read states, preparation saving,
  the Guide's real RecordsController, mounted Summary, and heading SSR.
- Full frontend `tsc --noEmit`: exit 0, without skipping product files or using
  test stubs to replace their types.
- Existing synthetic HTTP fixture v4 contracts: **30/30**, 96 requests and six
  intentional blocked-negative outcomes. No real service was called.
- Product controllers, API/permission owners, dependency manifests and lockfiles
  were not changed. Summary changes concern presentation and the obsolete
  intermediate dialog's local UI state, not a new data owner.

These are source, React DOM/controller, TypeScript and fixture-boundary checks.
They are not 93 browser journeys, native tests, or backend acceptance cases.

## Preserved failures and limitations

- The first TypeScript attempt lacked restored environment dependencies;
  restoring the locked runtime resolved that setup failure without changing
  the repository lockfile.
- An older source-read harness failed eight cases before useful interaction
  assertions because a transport test port was missing. That runner is not
  reported as passed.
- Eight older task presentation assertions and five growth/summary assertions
  did not match the retained baseline or changed presentation requirements.
  They were not rewritten into an invented all-suite success.
- One new source/attachment assertion incorrectly required an explicit
  `aria-hidden=false`; checking the actual non-hidden state produced 4/4.
- Shared read-state adapters were completed while retaining the real state and
  data assertions, yielding 21/21. Guide tests were aligned with the deliberate
  removal of forced steps while keeping dirty, unknown, focus, offline and
  identity/route cleanup behavior; those seven tests passed.
- A stale, unmounted Summary implementation was restored rather than counted
  as delivered UI. The mounted Summary path received the actual composition
  changes. These sub-results overlap the 93 and are not additive.

## Still pending

The bounded browser pass above remains separate from broader production/native acceptance.
Four-size geometry, actual 200% zoom, full keyboard/screen-reader coverage,
deep links and browser history, long-data/empty/error visual states, native
devices and real API/model/PDF behavior are not all established by these tests.
Fixture writes are confined to the existing closed preparation-memory behavior;
unsupported writes fail closed. No site publication, PR, or merge is implied.
