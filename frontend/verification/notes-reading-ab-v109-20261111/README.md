# Private notes reading A/B, v109

Published entry: https://yuyoufang-fe37-private-qa.ec002se.chatgpt.site/experiments/private-notes-reading-pn01/

Official site source: `2e9c44f7e5cb46a092063d6ff420bd50271a1ecc`. Deployment succeeded as native v109. This source commit belongs to the site source, not to this GitHub documentation archive. Existing public access scope, revision 2, was unchanged.

## Exact scope

PN-READ01 compares A (one indexed note with full text) and B (all three notes in continuous reading). It contains three fixed synthetic formatting examples, not the user's actual preferences or family/health information. It has no save, delete, search, storage, model or backend operation and is not connected to the workbench. QA switching does not record a user choice.

This archive includes six byte-identical public source files (12,774 bytes), three original test modules, the full 516-row source manifest, exact six-add delta, a bounded Python byte checker, and these source/verification summaries. It does not include the 510-file baseline's bytes, raw test or browser records, service records, credentials, or screenshots. For this new entry, the public site serves only the six candidate source files, not the test or archive files.

The original FULL-MANIFEST.json retains its prepublication expected-metadata label. Its 516 rows subsequently matched the actual official checkout, 135,547,989 bytes. SOURCE.json records this later check and publication separately. All original v108 510 rows and source bytes were retained; only the six files under `experiments/private-notes-reading-pn01/` were added.

## Three distinct gates

- Gate A: managed local preview PASS at a 1165×747 viewport, using real keyboard input, observed h2/control focus, and visible complete note text. Note 2's three paragraphs and final sentence, all B notes, import notice and A2→B→A2 retention were checked.
- Gate B: actual source/archive/save/deploy PASS. The package had 517 regular members (516 source plus one unchanged hosting file) and exactly 104 parent directories, no extra regular members or symlinks. The official helper pushed source normally and verified its commit with ls-remote. Git was clean and exactly six files were added before save.
- Gate C: public-entry smoke PASS after deployment. Full A2/B text, all three notes, import notice, return A2 and focus on A were observed again. The full local Tab sequence was not repeated on the public site. Requested index.html resolved visibly to the slash URL; no HTTP redirect status or response-body hash was inferred.

Two packaging-checker assumptions failed with exit 1 and blocked save: hosting was at `dist/.openai/hosting.json`, not archive-root `.openai`; the official source helper had no persistent origin remote. Correcting those checker assumptions yielded the complete exit-0 packaging check before save. No product or archive bytes changed for those corrections. Pre-save and post-save gzip/raw-tar measurements matched. Native archive hash/size metadata is recorded separately and is not claimed equivalent to local raw tar or live HTTP bytes.

## Tests and replay conditions

Author evidence records 17/17 Node tests: seven state and ten controlled-DOM cases. Five static groups also passed and were rerun by the independent code reviewer. Archive preparation verified these recorded identities but did not run Node or replay product tests.

The portable subset preserves original relative imports: `tests/` next to `public/`, with no package install. The archive byte checker statically verifies all 15 imports and only permits the included files plus `node:test` and `node:assert/strict`. Node 24 is the reported author environment; other versions are not validated here. From this archive directory, the intended replay command is:

`node --max-old-space-size=128 --test --test-reporter=tap --test-concurrency=1 tests/state.test.mjs tests/view.test.mjs`

The original diagnostic runner and static checker are intentionally outside this portable subset. State-red and view-red were each a single missing-module load failure, not 7/10 executed failing assertions. The Node 24 default spec reporter originally left a TAP-only summary empty; adding `--test-reporter=tap` corrected the runner's reporting, not the product. Original diagnostic records were retained privately.

The HTML-like stress string in V3 is synthetic test code, not a runtime fixture or real data. The finite DOM double does not simulate CSS layout, native keyboard traversal or assistive-technology speech.

Run `python3 -B verify_bytes.py` (Python 3.9+) for bounded local source/test/manifest identity and import-closure checks. Add `--dist` with a separately obtained complete official source dist to compare all 516 actual files. That optional comparison remains a local source check, not HTTP-response identity or runtime acceptance. This checker neither starts services nor runs product tests.

## Explicit limits

Whole-version acceptance is false. Code review found 0 Critical, 0 Important and 1 Minor: V10 tests mounts in separate documents only. Fixed IDs can collide for multiple roots in one document. This entry is accepted only as a single-page, single-root demo; no general multi-instance support is claimed.

Not run: narrow/mobile viewport, effective zoom, touch, native IME, AT speech, measured contrast, runtime network/CSP telemetry, same-document multiple roots, whole-site suite or comprehensive security review. Existing Chat Fourth PARTIAL_BLOCKED and Summary/Photos UNVERIFIED gaps remain. Guide v108's existing bounded PASS is unchanged. No GitHub CI success is claimed.

This archive is an append-only historical record. Prior v102–v108 records are preserved unchanged, and master is outside this archive update.
