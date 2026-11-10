# v105 Growth readiness

Published source: `21c413613731c735caf9d6a7e9426712bbfbc1e2`, preview version **105**. The same preview URL and public access revision 2 were retained:
https://yuyoufang-fe37-private-qa.ec002se.chatgpt.site/experiments/workbench-compare/

This archive records a narrow repair to the simple display, compare, select and paste-back workflow. It adds no composition, automatic synchronization or stored user preferences. All recorded selections are synthetic QA actions, not the user's choices.

## Repair and boundaries

The first Growth screen could visibly finish rendering while selection stayed permanently locked by an earlier bootstrap Home observation. The only product change adds the existing `growth-scroll` and `growth-tabs-toolbar` witnesses to the closed initial-surface map in `app.mjs`, with a comment update. The other 503 product files are byte-identical to v104.

Source/configuration/document/current accepted marker/sequence/route checks and the ready gate still apply. The first verified Growth screen may arm selection; later cross-page navigation remains permanently locked through return and Cancel. Only a confirmed new Open creates new sessions and restores eligibility while retaining choices. Existing Tasks/Care/Settings behavior and Chat/Photos selection prohibitions remain unchanged.

The data-dependent `growth-index-surface` is deliberately not required. Empty concerns are a valid page state; no fixture records were invented to satisfy readiness. Fixed frame/tab witnesses remain on same-path workspace sections, but that does not constitute acceptance of their content or actions.

## Bounded verification

- Unchanged v104 red001: 43 tests, 38 intended assertion failures and five passing controls. A queued post-arm test was then strengthened to prove initial eligibility before product changes.
- Final unchanged-v104 red002: 43 tests, 39 intended assertion failures and four controls. Neither red run had harness errors, and their original inputs/results were retained.
- Final complete comparison-host suite: 103/103 passed, no failures/cancellations/skips. The existing 60 tests were unchanged; 43 Growth tests were added.
- Independent implementation review found no Critical, Important or Minor issue.
- Actual v105 Original and Handbook: one normal first Growth Open showed initial waiting, then distinct actual Growth screens, completed ready gates and visible nonzero fixed witnesses. Both whole-page synthetic picks matched their exact loaded sources. Both optional indexes happened to be present; empty-index behavior was not separately browser-tested.
- Original ordinary cross-page navigation locked its pick. Actual browser Back returned to Growth without unlocking. Cancel preserved both frame epochs, the lock and exact choices. Confirmed Open showed waiting, changed both epochs and restored eligibility while retaining choices.
- Final service readback confirmed version 105, source above, succeeded deployment and unchanged public revision 2. The sole owned browser tab was blanked/closed; the pre-existing tab was untouched.

Local tests use real host/session/frame-entry/boundary code over controlled DOM/history/clipboard ports, not React or a browser engine. Their modeled return is not the evidence for actual browser Back. Rectangles alone do not establish viewport intersection; actual-screen observations provide separate display evidence.

This is not acceptance of all five Growth renderers, every concern/preparation/detail/history action, all empty/error states, mobile/keyboard/gestures/accessibility, cross-browser/BFCache, clipboard, backend/model activity or a full security audit. Clipboard was not rerun; prior copy/paste evidence retains its original version and scope. Exact source/archive provenance is not a direct hash of deployed HTTP response bodies. No real family data, photo, message, model call or permission change was used.

## Contents and replay

`SOURCE.json` pins all 504 product files. `SOURCE-DELTA.json` records the exact change from the immutable [v104 archive](https://github.com/2NTTY/child-ai-caregiver/tree/129a3bc751db1b2568580f6e57b9481c2af726d6/frontend/verification/settings-readiness-v104-20261110). `source-overlay/` contains only the changed app, not a complete website. `VERIFICATION.json` records public-safe acceptance facts and evidence digests, without raw browser/service records, screenshots, credentials or local paths.

`checks/` contains the exact 43-test Growth subset, separately pinned source expectations and its two utilities. `history/public-v104/` provides the exact negative-control app and HTML. To replay, supply the full v104 runtime matching the linked manifest at `dist/`, beside `checks/` and `history/`; apply `source-overlay/` over that dist and verify the resulting complete tree against `SOURCE.json`. Then use a compatible Node built-in runner:

```
node --test --test-isolation=none --test-concurrency=1 checks/growth-readiness.test.mjs
```

This conditional replay runs 43 Growth tests, not all 103 recorded tests. It needs no browser, server or backend. Full compiled runtime and unrelated historical fixtures are intentionally not duplicated. The archive reviewer did not rerun tests.

This append preserves v102/v103/v104 archives and master. It does not perform another deployment, merge or imply that CI ran.
