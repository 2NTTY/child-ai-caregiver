# Care Workspace: public verification summary

Status: experimental source snapshot, pending final browser QA. This summary does
not approve a production release or claim completion of the full UI matrix.

## Source and documentation boundary

- Reviewed source commit: `87b05e371c415ad71d9c78e610e25968a2b51ba0`.
- Original source tree: `e97096fad599f98f265f19bf631b95ca1858ac2d`.
- Previous candidate: `8b512f6`; common product baseline: `0b9f5d6`.
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

## Completed bounded checks

- Latest corrected combination: **93/93 focused tests**, covering home states,
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

Final browser acceptance remains separate from the source/artifact review.
Four-size geometry, actual 200% zoom, full keyboard/screen-reader coverage,
deep links and browser history, long-data/empty/error visual states, native
devices and real API/model/PDF behavior are not all established by these tests.
Fixture writes are confined to the existing closed preparation-memory behavior;
unsupported writes fail closed. No site publication, PR, or merge is implied.
