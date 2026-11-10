# v104 Settings account readiness

Published source: `a466c340ba245102d0643bd7764ab2ed157d4e5b`, public preview version **104**. The same preview URL and public access revision 2 were retained:
https://yuyoufang-fe37-private-qa.ec002se.chatgpt.site/experiments/workbench-compare/

This is a source and verification archive for the simple display, compare, select and paste-back workflow. It does not add design composition, automatic synchronization or stored user preferences. All recorded picks were synthetic QA actions, not the user's choices.

## Repair

The initial Settings account screen could visibly finish rendering while selection stayed permanently locked by an earlier bootstrap Home observation. The only product change adds the existing `account-settings` witness to the closed initial-surface map in `app.mjs`, with a comment update. The other 503 product files remain byte-identical to v103.

Arming still requires the accepted source, document, sequence and intended route, the completed ready gate, and a nonhidden/nonzero account witness. Existing source/configuration checks, post-arm cross-page lock and explicit Chat/Photos selection prohibitions remain. No renderer, fixture, backend, model call, settings value or permission was changed.

Scope is the default account screen. Other Settings sections remain browseable, but hidden or absent account content is not admitted for selection. Returning to account within Settings may restore its witness. Returning from another pathname does not clear the permanent lock; only a confirmed new Open can do that.

## Bounded verification

- Test-first unchanged v103: 15 new controlled tests, 11 intended assertion failures and four passing controls, no harness errors.
- Final complete comparison-host suite: 60/60 passed, no failures, cancellations or skips. Existing 45 tests were not edited.
- Independent review: no Critical or Important findings. One nonblocking Minor remains: the controlled test named “Back” models a return with pushState, not history traversal. The separate actual browser check below is the Back evidence.
- Actual v104 Original and Handbook: distinct account screens, ready/data-ready/nonbusy gates, visible nonzero account witnesses, both whole-page choices with correct source identities.
- Original read-only Appearance section navigation: hidden account content disabled picking while browsing stayed possible; Account restored eligibility.
- Original ordinary cross-page navigation and actual browser Back: selection stayed locked after returning. Cancel retained that lock, both frame epochs and the two test choices. Confirmed Open changed both epochs, showed loading, then restored both account picks while retaining the choices.
- Final service readback: version 104, source above, succeeded deployment, public revision 2. The sole owned browser tab was blanked and closed; the existing unowned tab was untouched.

These are bounded acceptance results, not all five Settings renderers, every section/control, mobile, keyboard/accessibility, cross-browser, clipboard, BFCache, backend/model or security-audit acceptance. Earlier Tasks/Care/Home evidence retains its original version and scope. Source metadata and exact packaged bytes are not a direct hash of deployed HTTP response bodies. No real family data, photo, message or model operation was used.

## Contents and replay

`SOURCE.json` pins all 504 product files. `SOURCE-DELTA.json` records the exact change from the immutable [v103 archive](https://github.com/2NTTY/child-ai-caregiver/tree/7d9bad338be0c9ec007bad9adb32bdde44e65105/frontend/verification/care-readiness-v103-20261110). `source-overlay/` contains only the changed app file; it is not a standalone deployable website. `VERIFICATION.json` contains public-safe acceptance facts and evidence digests, not raw browser records, screenshots, credentials or local paths.

The `checks/` files are the exact 15-test Settings subset and its two test utilities used during acceptance. `history/public-v103/` supplies the exact negative-control app and HTML. To replay locally, obtain the full v103 product tree matching the linked manifest, place it at `dist/` alongside `checks/` and `history/`, apply `source-overlay/` over `dist/`, and verify every resulting file against `SOURCE.json`. Then run a compatible Node built-in test runner:

```
node --test --test-isolation=none --test-concurrency=1 checks/settings-readiness.test.mjs
```

This subset exercises real host/session/frame-entry/boundary logic with controlled DOM/history ports. It does not start React, a browser, a server or a backend. It replays 15 Settings tests, not the full recorded 60-test suite. Full runtime files and unrelated historical test fixtures are intentionally not duplicated here.

This append-only archive does not replace the v102 or v103 records, merge master, publish another version or imply CI ran.
