# HR01 Signal Dock: isolated preview archive

Version 0.1.0-draft, source and browser observations dated 2026-11-09. This archive preserves a paint-only horizontal overflow control candidate for comparison. It is **not integrated, not release-ready, and not a standalone runnable application**. The repository's production source, current appearance, and user selections are unchanged.

## What is preserved

- `overlay/` contains the exact two candidate source files, with original repository paths. `signal-dock.patch` records their delta against the audited baseline.
- `PROVENANCE.json` identifies the tested source hashes, original source ownership, public design references, and the separate GitHub archive base.
- `VERIFICATION.json` records bounded checks, earlier failures, known defects, and unverified areas. Tests and browser flows were not rerun for archival upload; the archived source and evidence hashes were checked again.
- `screenshots/` contains two selected, unedited synthetic-fixture screenshots: the 320px container state and keyboard focus on the reveal control. They are actual browser captures, not whole-application acceptance evidence.
- `MANIFEST.json` records the other archive files and hashes. Private runtime packets, credentials, dependencies, hosting configuration, and generated browser bundles are excluded.

## Design and ownership

The 32px glyph becomes a navy control with a gold chevron, 6px corners, and a white focus border. The existing 48px hit target and trailing slot are retained. This explores a game-control-panel direction without copying game art or replacing existing tab/search designs.

The optional `hintAppearance` contract explicitly reads seven paint properties. It does not accept dimensions, layout, opacity, events, references, selected values, routing, or domain data. No caller is changed, and the candidate is not enabled by default. Existing scrolling, geometry, pending reveal, animation preferences, focus fallback, and callback ownership remain with the original repository implementation. HR01 only adds the paint contract and new appearance; it does not claim authorship of the original rail behavior.

The design uses the W3C APG manual-tabs distinction between focus and selection, and Aashrey Sharma's Figma article on video-game navigation as method references. No third-party visual assets are copied. Exact links are in `PROVENANCE.json`.

## Bounded results and blockers

The recorded controlled React/RNW/JSDOM run passed 18 of 18 targeted tests. Actual Chromium fixture checks exercised all three real callers, focus versus activation, appearance round trips, and 240/320/900px containers. The fixture used real rail/caller/RNW/OverlayScrollbars code, but controlled motion, Paper, and icon boundaries.

**Not passed:** citation end-of-rail focus fell to BODY with both original and candidate appearances. One observation also moved from x=576 to x=528 and redisplayed the hint; the cause remains unresolved. These observations are retained, not attributed to the paint change or declared confirmed whole-application defects. Overall application acceptance and release admission remain false.

No full TypeScript check, full test suite, whole-application export, native device, assistive-technology, touch/drag, forced-colors, RTL, zoom, or complete chat reading-position verification is claimed. Review and integration need their own checks; do not apply this archive automatically or treat the branch as a release.
