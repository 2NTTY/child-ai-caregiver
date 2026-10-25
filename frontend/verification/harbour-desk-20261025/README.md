# Harbour Desk candidate verification

- Source baseline: `0b9f5d60e73eb395ea8a2898864fa1e591e27938`; approved common patches listed in experiment README.
- Frontend TypeScript: exit 0 (`NODE_OPTIONS=--max-old-space-size=2048 node node_modules/typescript/bin/tsc -p frontend/tsconfig.json --noEmit`).
- Focused offline aggregate: **254 passed, 0 failed, 0 skipped** across 28 files. Exact test names/results in `focused-tests.txt`; these are synthetic harness/HTTP checks, not browser or live-service results.
- Contrast verifier: **22 semantic pairs passed**, `color-checks.json`.
- `git diff --check`: passed.
- Interim checkpoint `02e84085` Web export: exit 0, 36 static routes. This is not the final candidate artifact. Final source-map-verified export and synthetic browser results pending.
- Regression triage is preserved in `regression-triage.json`: first expanded run 147/221; an isolated common-base run reproduced 45 existing failures out of its 71 tests (missing test ports, old labels and second-precision expectations). All selected failures are resolved in final aggregate without changing domain behavior or relaxing safety guards.
- Responsive reader test executes actual HistoryScreen, Workspace compounds, category selector, and private-history consumers. Control-prop unit tests may replace layout only; they do not stand in for pixel geometry or real React/browser scheduling.
- Independent source review: first checkpoint P2 web shortcut semantics fixed and tested. Final-candidate review found the same link issue in family/admin plus two misleading copy cases (child deletion implications and closed concern status); all corrected without domain changes. Affected delta: **25 passed**, including proposed/following/closed labels, family native callbacks/web hrefs and retained child-delete gates; full TypeScript repeated, exit 0. Delta review pending.
- Browser: queued only through shared browser owner; no claimed screenshots yet.
- No production backend, real model, real family, GCP, deployment, PR or master merge.

## Skip-link regression follow-up

The final source review and the browser independently found that RNWeb's later `position: relative` rule overrides the early custom skip-link CSS at candidate `49b7b983`. In that candidate's actual 1180px viewport the skip control occupies a 108px-wide, 757px-high flex-row column; this is a failed result, not a passing narrow-layout screenshot. The immutable old artifact remains available for comparison.

The fix moves `position: absolute`, left/right offsets and z-index into the real RN component style. Only the offscreen/focus top coordinate remains in CSS, with no inline top that would lock out focus. **11 focused tests pass**, including a real React Native Web production SSR primitive with the actual style declaration, late RN stylesheet cascade and an oracle that reproduces the old relative-position failure. Full TypeScript repeated: exit 0. Browser geometry/focus recheck on the new artifact remains pending. This SSR test does not claim browser layout or native keyboard scheduling.

## Real Slot boundary follow-up

At `bd7beecc`, the browser confirmed the keyboard skip fix at 1180px and 500px. It also exposed three newly added web links whose Pressable style callbacks were swallowed by Expo's asChild/Radix Slot merge: home shortcuts, family destinations and admin return. The original artifacts and geometry are retained as failures, not silently replaced.

Those three links now use pressed state plus `StyleSheet.flatten`, matching the existing navigation pattern; guarded hrefs and native callbacks are unchanged. The new real React/Radix Slot/RNWeb SSR tests extract each actual product style, check href/link semantics and min-height/row layout, and reproduce the original callback loss as a negative oracle. **18 affected tests pass**, full TypeScript exit 0. A scan of every newly added PreviewLink found no further callback-style child. Browser recheck on this new candidate remains pending.

The current shared HTTP fixture is v3 (`629b654a8f13a4a18293feb8ed2c5904d6b02674e6b930349de49a10c279c5cd`): real client/ChatController checks **28 pass**; 18 stored chat messages page 6→12→18, with no model calls. Earlier v1/v2 receipts remain historical. Source/build evidence is version-specific and is not added together as a larger test count.

## Short-height / 200% browser zoom follow-up

Actual native Chrome 200% on `bd7beecc` produced CSS 590×378. The fixed-height chrome and composer overlap left only ~21.5px unobscured timeline; the latest message was not readable. That failure is retained. The new Web-only short-height presentation keeps the same Timeline/scroll refs/controllers, a 48px visible heading/activity/privacy toolbar, wrapping input/tool row, unchanged 48px controls and 16px text, a maximum 72px internally scrolling textarea, no composer overlap, and reduced timeline spacing. Attachment preview and original processing copy stay in a bounded 64px scrollable context rather than disappearing. No zoom override, model call or owner change.

**28 affected checks pass** across 6 files, including real ReactDOM textarea/send-focus tests using the existing read-only JSDOM dependency. The textarea test explicitly injects measurement ports (JSDOM has no layout engine), retains the DOM node/draft across 72→168 limits, and verifies Enter/Shift+Enter/IME behavior. Screen tests retain timeline refs and domain callbacks across short/normal widths; old reading-anchor and recovery assertions still pass. TypeScript: exit 0. Actual 200% and ordinary 100% geometry/anchor recheck are pending on the next immutable export.

The exploratory older `clean-chat-layout.test.mjs` fails at its missing ChatPhotoMessage test port before assertions; isolated pre-short candidate `53160e02` reproduces it, alongside two stale/missing-port expectations that the focused tests now correct. See `pre-short-baseline-tests.txt`. This is not reported as a whole repository suite pass. Current fixture packaging moves to v4 only for a previously missing optional model-list metadata read; it still reports not_checked with no fake key/model success, and retains the v3 stored chat data.
