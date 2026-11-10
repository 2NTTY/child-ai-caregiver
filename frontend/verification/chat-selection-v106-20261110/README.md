# Harbour/Care Chat design selection · preview v106

Published preview v106 uses Sites source `f769e6129a4b1778a5f05389246459d9013e3c32` at the [existing comparison entry](https://yuyoufang-fe37-private-qa.ec002se.chatgpt.site/experiments/workbench-compare/). Deployment succeeded. The public audience, revision 2 and complete access policy are unchanged.

This repair permits whole-page Chat design preferences for Harbour and Care only, using one shared closed allowlist and the existing toolbar/reading-panel readiness witnesses. The other three Chat variants and every Photos variant remain unselectable. A design preference does not grant native composition or full Chat acceptance.

## Exact source and scope

- `SOURCE.json` pins all 504 published product files, canonical SHA256 `b067e2c88b7e07e3f16c9b7ace1e454f4c3e8f22e8551ef7fcae0a043eab3403`.
- Only `experiments/workbench-compare/app.mjs` and `design-choices.mjs` changed from public v105/source `21c413613731c735caf9d6a7e9426712bbfbc1e2`. The other 502 files are byte-exact. `SOURCE-DELTA.json` records both sides and `CHAT-SELECTION.patch` contains the exact delta.
- The current `dist/` here is an eight-file host subset, **not the complete browser runtime**. It includes the two exact changed modules and the controlled-test dependencies. No renderer, fixture, catalog, clock, transport, boundary, permission or audience change is included.
- Independent source review found no Critical or Important issue. Minor M1 was accepted: equivalent Photos aliases now show the accurate existing prohibition sentence; Photos stays denied.

## What the bounded real-browser pass established

The first Chat Open showed waiting with disabled picks, then distinct Harbour and Care designs. Each rendered DOM contained the same six recent synthetic messages, an empty native textarea and disabled Send. Screenshots showed the layouts and visible conversation tail, not all six messages simultaneously. Each frame had one ready/data-ready/nonbusy gate and both existing witnesses inside it, with nonzero rectangles and no hidden ancestors. Rectangle/ancestry checks alone are not independent viewport-intersection proof.

One whole-page selection per side produced two exact receipts matching the published main/payload/catalog identities. These are synthetic QA selections, not the user's preferences. Harbour's 今日 navigation displayed Home and locked its pick while Care remained eligible. Actual browser Back returned Harbour Chat but retained the lock. Cancel preserved both epoch names, Harbour's lock, Care's eligibility and both exact receipts. A new explicit Open replaced both epochs, showed waiting, then enabled both picks while retaining the two receipts.

Hidden current markers, accepted sequences, frozen configuration and private document IDs were not directly inspected. Evidence combines source review and controlled tests with visible diagnostics, exact receipts and real lifecycle behavior; it is not fresh HTTP response-body hashing. Three Open-click transport timeouts occurred at active confirmation dialogs; each dialog was handled once without blindly repeating a click. Two earlier local setup failures occurred before helper startup or remote actions, not in the product. Owned publication processes exited normally and the owned tab was blanked and closed.

**Chat clipboard paste: NOT_RERUN.** There was no ordinary host-only paste destination. Neither a copy-only status nor old v102 evidence is treated as a Chat paste pass. Duplicate-pick and post-load pending-selector mutation were also not rerun in the browser; they have controlled-test coverage only.

## Included regression subset and replay

The retained final run passed **149/149** cases, with no failures, cancellation or skips. It covers 102 unchanged original cases, one intentionally narrowed obsolete all-Chat-ban case, and 46 new cases. The preceding 148-case green implementation and red001/red002 runs are separate unpublished history, not this final result. `TEST-CHANGES.json` preserves the explicit original-test change.

This archive includes **46 cases only**: the 45-case Chat selection file and one non-Chat waiting-note regression. Their helpers, source pins and all required host modules are included byte-exact. Both old v105 app **and old v105 resolver** are preserved under `history/public-v105/`, with their original imports. The six shared supporting modules are verified unchanged from v105. `REPLAY-INPUTS.json` lists all 24 pinned replay/source inputs and all 46 case names, which passed within the retained 149-case run.

Archive preparation checked Python custody and static dependency closure; **it did not rerun Node**. This is a self-contained controlled-DOM subset, not a self-contained browser preview or a reproduction of all 149 tests. The harness executes actual host/resolver/session/frame-entry/boundary code while controlling DOM dimensions, history, clipboard and transport. It does not render React or establish browser geometry, actual Back/BFCache, mobile or accessibility behavior.

From this archive directory, first verify the bytes with Python 3.9 or later:

```sh
python3 verify_replay.py
```

To run only the included 46 cases, use Node.js 22.8 or later; no package installation is required:

```sh
node --max-old-space-size=384 --test --test-isolation=none --test-concurrency=1 --test-reporter=tap checks/chat-selection.test.mjs checks/scope-isolation.test.mjs
```

For actual browser rendering, separately obtain the complete published 504-file dist and its required hosting configuration. This archive intentionally omits most renderer bundles, payloads and assets. `python3 verify_replay.py --full-dist PATH_TO_COMPLETE_DIST` verifies all 504 product files against `SOURCE.json`; the hosting configuration is outside that product manifest. Source pins in controlled tests are expectations, not execution of those renderer bundles.

## Limits that remain open

Full 18-message history/pagination and content workflows; the other three actual Chat designs; all Photos rendering and interaction; send/model/backend/voice/photo/file/attachment operations; real family data; native composition/adapters; mobile, keyboard, accessibility, gesture, zoom and cross-browser matrices; sustained stability; production readiness, GCP and merges are not accepted by this archive.

Photos Chromium error9 remains unresolved and is not a React invariant finding. Observing a Chat textarea does not establish Photos PaperTextInput acceptance or prove Photos/clock repair.

`VERIFICATION.json` provides sanitized outcomes, exact receipt pins, witness dimensions, review/test distinctions and evidence digests. Raw browser/service output, screenshots, private identifiers, credentials, deployment packages and machine paths are deliberately excluded. This directory is an append-only archive alongside the unchanged v102/v103/v104/v105 archives, not a master merge.
