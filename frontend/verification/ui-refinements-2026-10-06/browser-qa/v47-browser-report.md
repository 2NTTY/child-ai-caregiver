# Published v47 browser verification

Verified 2026-10-06, approximately 07:06–07:14 UTC, using the normal dot cloud Chromium browser.

Public site: https://yuyoufang-fe37-private-qa.ec002se.chatgpt.site/
Published version supplied by parent: v47
Deployment supplied by parent: appgdep_6ac49dba05588191aa9db008eea9d6e1
Source/build fingerprint supplied by parent: 459128602754492d317b4b801e0ddba790b829788ce225786236873f78217d34

## Result

The shared whole-control opacity fix passes the sampled representative controls. Preparation content-first layout passes at desktop 1180 × 757 and actual mobile iframe 320 × 600. The correct History growth-category subtitle is present. The removed legacy entry is absent.

One residual remains for the next patch: Paper primary and danger buttons still brighten with white 6% hover and white 12% ripple. This is local button feedback, distinct from the fixed whole-control opacity fade. It was reported immediately to the parent and is not counted as fixed in v47.

## Pointer evidence

Each of eleven controls has before/during/after screenshots and a JSON record. Each control was held for the supported native 4.5-second pointer click; four sequential read-only computed-style samples were collected while :active was true. These are sampled observations, not a frame-by-frame recording.

All 44 held samples had control opacity 1, every inspected ancestor opacity 1, and frontend-preview-ready startup state ready.

- Range field: mint rgb(227,246,245) while held. v46 baseline had opacity 0.6 on this same control; v47 therefore directly demonstrates removal of the earlier whole-control washout.
- Counted range menu option: transparent initial sample then mint; remains opacity 1. Re-selected the already-active range.
- Selected task tab: mint; selected tab state preserved.
- Task list row: mint progressing to darker mint rgb(186,232,232); release opened read-only detail normally. Detail closed afterward.
- Calendar month arrow: mint. Previous month opened normally; original month restored.
- Calendar day: mint. Local date filter activated normally; original recent-seven-day range restored afterward.
- Chat suggestions toggle: light mint progressing to mint. Suggestions opened; collapsed afterward.
- Preparation disclosure: transparent initial sample then dark rgba(39,35,67,0.08); remains opacity 1. Expanded then restored collapsed.
- Secondary outlined Cancel: full opacity; dark 6% hover plus dark 12% ripple. Cancel closed the synthetic concern confirmation without applying it.
- Primary “請助手安排”: full opacity, but white 6% hover and white 12% ripple remain. Release only navigated to chat with a local draft; no message was sent. Generated draft was cleared.
- Danger “結束關注：日常遊戲與表達”: full opacity, but the same white hover/ripple remain. Release opened a confirmation dialog only. The final confirmation was never pressed; Cancel dismissed it and concern remained unchanged.

## History

Verified exact relevant subtitle at /history?category=growth:
“查看已結束的關注與跟進記錄”

Screenshot: v47-history-growth-subtitle.jpg
DOM/result record: v47-history-growth-check.json

The current fixture has zero archived concern rows, so that specific row owner was not runtime-tested. No archive or restore was created just to obtain a test fixture. An earlier top-level History screenshot is also retained, but it is not the evidence for the changed category subtitle.

## Preparation layout

Verified /summary?tab=preparation:

- All four current preparation cards appear before archive, purpose, and next-step controls
- Desktop card positions: first top 311, final bottom 915; footer begins at top 931 or later
- Exact legacy label “舊共享準備／原操作查核” is absent from the rendered panel/controls
- Source/limitations disclosure is collapsed by default, below the useful content and footer
- At 320 pixels, the panel has clientWidth 288 and scrollWidth 288, with card bounds x=16 to x=304
- Mobile final card bottom 963; archive top 980, purpose top 1041, next-step top 1101, and disclosure top 1165
- Mobile footer wraps vertically and is reachable by ordinary scrolling; no horizontal overflow was observed

Evidence:
- v47-preparation-desktop-top.jpg
- v47-preparation-desktop-footer.jpg
- v47-preparation-desktop-layout.json
- v47-preparation-320-top.jpg
- v47-preparation-320-footer.jpg
- v47-preparation-320-layout.json

Mobile wrapper note: the wrapper’s static size label still reads “320 × 900 CSS px” after choosing height 600. Actual iframe height attribute was 600, inline style height:600px, and rendered border box was 322 × 602. The layout check therefore used actual 320 × 600 content. This wrapper-label inconsistency is separate from product layout.

## Method limitations and safety

- Normal public cloud browser only; no DevTools, localhost, hidden state, runtime edits, source edits, or network bypass
- Used documented visible UI actions, read-only DOM/computed-style inspection, screenshots, and wrapper controls
- Ready-marker and ancestor-opacity samples do not prove continuous DOM identity or absence of every transient frame
- Did not confirm, send, archive, restore, complete a task, invoke a model, or modify real user data
- Temporary range/month/detail/disclosure state was restored; generated chat draft cleared
- Mobile bottom-navigation active-state and camera droplet changes are intentionally outside the v47 batch and were not treated as failures
- One Preparation-tab opening call was denied by the reviewer. After exact renewed user authorization was supplied, the same call was retried once and succeeded. No method bypass or repeated retry loop was used

## Handoff

No further v47 browser activity is needed for this scope. Preserve this evidence and the separate v46 baseline. The next published version should receive targeted primary/danger ripple checks plus the separately requested mobile active-state/droplet checks.
