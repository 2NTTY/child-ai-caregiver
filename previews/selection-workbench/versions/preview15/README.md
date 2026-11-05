# Selection Workbench preview15

This complete static selection workbench (選配工作台) contains 16 isolated interactive candidates across 15 candidate-bearing modules. The catalog lists 88 modules and 64 deduplicated public reference URLs. The catalog is an inventory, not a claim that all 88 modules are implemented or fully accepted.

## Open the preview

1. Select the `codex/selection-workbench-20261105` branch on GitHub and use **Code → Download ZIP**, or clone that branch. Preserve the complete folder structure.
2. Open a terminal in `previews/selection-workbench/versions/preview15`, the directory containing this README and `index.html`.
3. If Python 3 is already installed, run:

   ```sh
   python3 -m http.server 8000 --bind 127.0.0.1
   ```

   On Windows, `py -m http.server 8000 --bind 127.0.0.1` is an alternative.
4. Open <http://127.0.0.1:8000/> on the same computer. Press Ctrl+C when finished.

Use this version directory as the HTTP root, not the repository root. No npm install, dependency installation, or build is needed. Avoid opening `index.html` directly with `file://`; browser module and asset restrictions can prevent candidates from working. Any ordinary static HTTP server can serve this directory. The example listens only on the local computer and has not been run on your device.

GitHub displays the files but does not run this website. This branch addition does not deploy or replace the existing preview site, production application, or an installed app. The runtime files are stored once without an additional preview ZIP. [preview12](../preview12/README.md) remains available unchanged.

## What to try

Open **候選試玩** on the homepage, or search by a short code such as NH01, N01, DV01, or KM01. Chinese search, functional-area filters, and the interactive-candidate filter are available.

NH01 adds the read-only synthetic personal message-history candidate with A **訊號艙** and B **信件冊** layouts. N01's latest-five view remains a separate candidate. Both belong to the existing notifications module, so 16 candidates cover 15 modules. Search and date filtering in NH01 cover only the currently loaded synthetic window, not complete history. There is no real-message sending, mark-as-read, receipt confirmation, production login, or live adapter.

## Verified scope

- The 185 static runtime files total 17,818,273 bytes and match the accepted preview15 package byte for byte. [manifest.json](manifest.json) records every public runtime path, size, and SHA-256.
- Compared with the accepted local preview14, NH01 adds eight public files. Four gallery/catalog files change; 173 prior public files and all 163 prior candidate runtime files remain unchanged. Nothing is removed from that package.
- Independent payload review verified the exact public set, byte identities, ZIP membership and CRCs, and deterministic complete-recipe replays. It audited 937 saved negative-destination cases and independently executed eight selected negative cases. These are separate overlapping verification layers, not a combined product-test count.
- A packaging defect that previously allowed an extra FIFO in the static payload directory was reproduced and fixed. The corrected recipe rejects that special entry before writing outputs. The packaging checks assume an ordinary static filesystem and normal Python assertions, not concurrent hostile path replacement or Python `-O`.
- Existing bounded gallery-browser evidence was verified. Its 20 observations include pending and terminal observations and are not 20 independent PASS results. This branch upload does not claim a new browser or device acceptance run.

## Limits and provenance

Only project preview code, artwork, public module/source mappings, operation-boundary analysis, and synthetic examples are included. Raw QA reports, internal notes, private source snapshots, credentials, node_modules, and local environment files are excluded. No real family data, real-model calls, production data changes, or permission changes are part of this publication.

All 88 catalog-module semantic acceptance gates remain **pending**. The 64 formal notification acceptance cases remain **ALL_NOT_RUN**; the original NH01 remains **BLOCKED**. These 64 formal cases are separate from the 64 public reference URLs. Production-owner integration, real accounts and data, physical devices, touch, IME, assistive technology, and full WCAG acceptance are not covered. Existing candidate-specific limits remain in the catalog.

Runtime pages retain conservative status text from the frozen snapshot, including pending integration/review wording. Later bounded local acceptance is recorded here without changing those verified runtime bytes. This snapshot is a selection aid, not evidence that unfinished production features are complete.

The catalog retains source baseline `e8918ddfde9ef5e978bb4d6d1b43d67193fa9a92`. The runtime source-freeze SHA-256 is `71f17ec0df324ce49638b89d20c686b3fa5b7ceb778ff108659f23bf470e3bd1`. The corresponding locally validated ZIP is 5,359,427 bytes with SHA-256 `cd19866ba92c455807c5a5438a5464cc35f37a8b5730d02702ed77a9dc86b69b`; the archive is not duplicated in this branch.
