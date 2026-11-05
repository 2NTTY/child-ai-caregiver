# Scoped local acceptance

Observed on 2026-11-05, 22:15–22:22 UTC, against the exact Care and Handbook host02 HTML outputs included here and their unchanged, locally pinned application bundles. This record summarizes prior observations; preserving these files does not create new browser evidence.

## Passed within this scope

- Four CSS widths, 320/390/1024/1440, with the diagnostic disclosure closed and open for each variant: 16 geometry observations in total. Document width did not overflow; the application root and diagnostic panel occupied separate normal-flow space.
- At 320, 390 and actual browser 200% zoom, with the disclosure closed/open, all 60 bottom-navigation link-center hit tests identified their intended links. The desktop layouts at 1024/1440 had no bottom navigation; empty results were not counted as a desktop-navigation pass.
- Actual Chromium zoom showed 200%, with the CSS viewport width changing from 1188 to 594. Zoom was restored to 100% after each variant.
- Care: actual navigation to Settings at 320 and 200%; the recent-message dialog opened, and Escape returned focus to its button.
- Handbook: actual navigation through All Features to Settings at 320 and 200%; keyboard chapter selection returned focus to the selected child-settings section, and cancellation returned focus to the chapter button.
- At 200%, application content and the diagnostic panel both scrolled. Refresh diagnostics and the native teardown control remained usable.
- Both native teardowns observed settlement with one owner disposal, no active/pending/held work, no recorded failures, no forced timer/hold cleanup and zero default-transport activity.
- The existing host generator's 11 focused tests and nine independent negative integrity cases passed. Independent review covered the output census, hosting configuration, canonical lineage and symlink rejection. Candidate hashes were unchanged after browser checks.

## Not established

- This is not all-page/all-state, complete four-design, seven-condition, native-device or touch acceptance.
- The 1440-width result is DOM geometry, not a full-width pixel inspection. Screenshots were observed during the browser run; no screenshot files are included in this packet.
- The greater-than-512 timer-lifetime scenario was not rerun during this host-only check. This packet does not replace earlier evidence or claim new long-lifetime coverage.
- A separate runtime-source correction had passed scoped source/test review, but its new Care build ended with an unexplained external SIGKILL. The supervisor did not issue the signal, and its sampled resource thresholds did not trigger. The cause was not proven to be OOM, a platform denial or a product assertion failure. The corresponding new Handbook build was not started. This host-only pass does not convert either result into a successful build.
- The finite synthetic fixtures are not equivalent to the full public site. No public-site update, credential creation, PR merge or production deployment is represented here.

The full raw browser records, private execution receipts and local review materials are retained separately and intentionally excluded from this public preservation packet.
