# Button flash baseline: limited live-browser evidence

Date: 2026-10-06 UTC
Site: https://yuyoufang-fe37-private-qa.ec002se.chatgpt.site/
Route tested: /tasks
Environment: dot cloud Chromium, normal public page, viewport 1180 × 757
Source/build supplied by parent: synthetic published v46; frozen source was not edited.

## Verified findings

1. AppSelect trigger “範圍：近期 7 天，2 項” visibly washes out locally during pointer hold. Baseline computed opacity was 1. Eight subsequent held samples were opacity 0.6, :active=true, aria-expanded=false, and frontend-preview-ready present. The text, border, badge and icon all lighten together. Background remained rgb(255,255,254); original ancestor baseline was opacity1 throughout. Release opened the expected range modal. Cancel restored the range selection unchanged.
2. Paper outlined “取消” button did not use whole-button opacity fading. Four held samples had opacity1 and every inspected ancestor opacity1. Hover background was rgba(39,35,67,0.06). The child ripple span background was rgba(39,35,67,0.12), with its opacity progressing from 0.5 to 1. All four samples reported startup state ready. Release closed the range dialog normally.
3. No sampled ready marker disappearance or pane-wide washout was observed in these two probes. These isolated screenshots and DOM samples do not establish every-frame continuity or rule out a brief route/unmount flash elsewhere.

## Method and qualification

- Used documented cua_repl browser/native coordinate click with durationMs to hold and release the real pointer; read-only DOM/computed-style inspection and screenshots ran while the click was held.
- Used visible DOM-derived coordinates and normal public browser interaction. No DevTools, localhost, hidden application state, page mutation, browser fetch, or network bypass was used.
- An initial very early selector sample returned :active=true and opacity1. This was not treated as a contradiction of source findings. A later bounded multi-sample probe captured the settled opacity0.6 state in all eight samples.
- No model/send, task completion, real-data confirmation, archive/restore, or preferences change was performed.
- No public publication, repository modification, or source edits were performed.
- Persistent element identity was not measured. The ready marker and route content were sampled; this is weaker than tracking node identity or every-frame rendering.

## Stopped probes and blockers

1. A read-only probe attempted performance.now(). The supported DOM scope did not expose performance; it failed with “TypeError: Cannot read properties of undefined (reading 'now')”. The failure was reported before retry. Parent authorized a bounded correction to omit performance. The corrected pure DOM/computed-style probe succeeded.
2. The reusable helper plus outlined Cancel held probe was denied once with “JavaScript execution did not receive approval”. After exact user authorization evidence from parent, the same call was retried once and succeeded.
3. The next call, held press on selected tab “待處理 4” followed by read-only task detail row “查看事項詳情：帶備上次到診資料；14:30 前；媽媽；待回報”, was denied. Exact user authorization evidence was supplied; the same call was retried once and denied again. As instructed, all remaining browser work stopped. The denied call did not produce evidence for either control.

## Coverage not completed

Runtime not verified: AppButton primary/danger/text; select options; disclosure; selected/unselected tab; task list row; calendar cell/month arrow; History row; chat suggestion toggle/chips/preview/process icons; mobile 320px wrapper. Source findings for these families must be labelled source-derived, not browser-confirmed. No live whole-content or route-transition diagnosis was completed beyond the two controls above.

## Evidence files

- tasks-before.jpg: tasks page baseline, range trigger at opacity1
- select-during.jpg: very early first held sample (opacity1), retained so it is not misrepresented
- select-mid-hold.jpg: verified local selector washout (opacity0.6)
- select-after.jpg: range modal after release
- select-samples.json: eight active/opacity0.6/ready-present observations
- secondary-cancel-before.jpg: range modal and outlined Cancel baseline
- secondary-cancel-during.jpg: held Cancel, dark ripple and unchanged whole-control opacity
- secondary-cancel-after.jpg: dialog dismissed, tasks page preserved
- secondary-cancel.json: before/during/after computed-style details, rectangle, ancestor styles, ripple attributes and sampled route text

## End state

Last verified live page was /tasks, range modal closed, original “近期 7 天” range unchanged. Browser work released on final handoff; no pending app transaction.
