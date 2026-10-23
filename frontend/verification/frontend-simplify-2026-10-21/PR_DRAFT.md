# Simplify caregiver workspaces and preserve draft-safe navigation

## Summary
- Simplify child selection, navigation, home/rail, task completion, sign-in and settings without changing routes, permissions or domain states.
- Regroup concerns with preparation documents and child overview with growth reports, retaining deep links, authority gating and combined refresh.
- Make ordinary manual entry secondary and modal, with read-first profiles and original write recovery inside each form. Preserve local drafts and exact frozen-operation ownership.
- Fix read-loading navigation locks, first-screen greeting admission, stacked confirmation visibility and the redundant Paper Portal that lost local guard/production contexts.
- Add scoped device-local Home backgrounds using existing platform dependencies, minute-level timestamps, a care-result reading dialog, and calmer chat interaction with intentional keyboard-send focus.

## API boundaries
No backend, wire schema, authentication policy, permissions, model invocation or deployment changes. Header attention, important Home reminders and a content-centric notification inbox remain **proposed/unimplemented** in `frontend/ATTENTION_API_HANDOFF.md`. No page-owner business aggregation, fabricated counts or production mock fallback.

## Validation
- Targeted component/form/guard/time suite: **48/48**; focus-delta consumer regression: **34/34**; final read-state/Home-time regression: **25/25**.
- Installed Paper/RN Web modal and focus-trap DOM regression: **7/7**, including actual SourceComposer/RHF and TasksView; synthetic host/action ports remain explicit.
- Source/Photo owner hooks: **41/41**; original-operation Documents owner/API-parser subset: **3/3**.
- Chat send-focus DOM: **4/4**; chat presentation regression: **10/10**; separate input DOM + Profile owner/parser suite: **10/10**. Background lifecycle/storage ports: **8/8**.
- Frontend typecheck is **blocked by two existing ContactConsentCard errors**; no new diagnostics. Full Documents lifecycle is **34/36**: two synchronous URL-cleanup assertions also fail against isolated HEAD product source with the same harness ports. No production export/timer change.
- Offline Web snapshot09: **35 routes / 62 artifacts**, 524 source hashes stable. The last two-file delta only stabilizes Tasks close focus and formats the Home task-summary time.
- Independent cloud Chrome: representative 320/390/768/1024/1440 checks are versioned, not a full matrix. Background persistence/restore/logout masking/isolation, manual draft guarding and recovery, source context retention, photo time, chat keyboard focus and reading-anchor behavior passed targeted checks. Care trigger return passed snapshot08; snapshot09 passed fresh/stable Tasks close, read-settle focus, Tab continuation and Home minute-format checks. Tasks deliberately returns once to its stable heading instead of a trigger that a later read can disable.
- Commands, failed histories and evidence boundaries: `frontend/verification/frontend-simplify-2026-10-21/checks.json`. Counts overlap; do not add them as unique cases. `git diff --check` passed.

## Limits
Only synthetic family data and images; no real messages, model calls, notifications or permission changes. Browser evidence is not Android device, live API or full screen-reader acceptance. Existing native expo-crypto is used without a new native dependency; APK/OTA compatibility has not been claimed.

Keep this PR **draft**. Do not merge, enable auto-merge, deploy or publish OTA as part of this change.
