# GD01 Guide A/B entry, v108

The existing public preview contains the unchanged six-file GD01 synthetic guide at:
https://yuyoufang-fe37-private-qa.ec002se.chatgpt.site/experiments/guide-reading-gd01/

Official source commit: `5de2d2a20fdfbf249b1099c970f97c53b35f4645`. Publication succeeded. Gate A source identity and the bounded Gate B desktop smoke passed separately. **This is not whole-site acceptance.** Chat remains PARTIAL_BLOCKED with Fourth witness/receipt/lifecycle gaps. Summary and Photos remain unverified; the existing Photos error9 is unresolved.

## Exact source scope

The complete published dist has 510 files / 135,535,215 bytes. All 504 previous files are byte-identical to v107; only six original GD01 files totaling 11,687 bytes were added under `experiments/guide-reading-gd01/`. There are zero modifications or deletions. Existing hosting configuration and public access scope remain unchanged. Byte identity does not establish new runtime acceptance of old routes.

`source/` contains only the six added source files. `FULL-MANIFEST.json` lists all 510 published paths, byte sizes and SHA-256 hashes, using its stated path-component ordering. `SIX-ADD-DELTA.json` gives the exact six additions. `SOURCE.json` binds these to the actual version and official source. The archive intentionally does not contain the entire product dist or private browser/service records and screenshots.

## Actual new-destination observation

One explicit `index.html` request resolved to the slash URL above. The smoke ran on that resulting page: A side directory at step 1 → select step 2 → B three cards above reading with step 2 retained → A side directory restored with step 2 retained. The requested URL and observed final URL are recorded separately. There was no second direct-slash navigation or reload, and no redirect HTTP status was measured.

Three desktop viewport images were 1165 × 747 image pixels, not an independently measured CSS viewport or device-pixel ratio. A bounded console sample returned eight extension errors and no candidate-origin errors; it is not a complete console/network audit. The owned tab was closed and absent from the subsequent inventory. All controls used synthetic guide data.

## Reuse and limitations

`VERIFICATION.json` separates the new smoke from historical November 7 Guide checks. Only the unchanged-source desktop A/B, step, simulated intent/return and specifically observed status/focus paths are reused, with their original timing, image-format and tool-provenance qualifications. Neither the old interaction matrix nor the 191-test suite was rerun. No mobile/touch, complete keyboard/AT, lifecycle, backend/model or comprehensive network/storage/CSP acceptance is claimed. Current workbench Guide selection and production GuideScreen are outside this isolated entry's scope.

Gate A compares official source and local package members, not live HTTP response bodies. The local package had 511 regular members: the 510 product files plus the unchanged hosting manifest. A validator initially misclassified a normal directory entry. Because its nonzero exit was not gated before save, v108 was saved before the corrected check. All members were then correctly checked before deployment; neither product nor archive bytes changed for that correction. No before-save compressed digest was captured. Native content-hash semantics are undocumented, so native hashes are not equated with raw tar hashes and before/after-save digest stability is not claimed.

## Bounded byte reproduction

From this archive directory run `python3 -B verify_bytes.py`. It checks the six included sources, both canonical source identities and exact addition metadata. To additionally compare a separately obtained complete official source dist, run `python3 -B verify_bytes.py --dist PATH_TO_DIST`. The optional input must contain exactly the 510 pinned regular files. The script rejects symlinks and unexpected members and only uses Python's standard library.

These commands perform byte checks only. They do not run JavaScript, start a server, replay browser tests, contact the network, access credentials or publish anything.
