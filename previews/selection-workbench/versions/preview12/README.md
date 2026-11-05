# Selection Workbench preview12

This is the complete static selection workbench (選配工作台), with 13 isolated interactive candidates: 9 original directions with 18 layouts, plus 4 presentations extracted from earlier project previews. The catalog lists 88 modules, 16 functional areas, and 47 public reference URLs.

## Open the preview

1. Select the `codex/selection-workbench-20261105` branch on GitHub and use **Code → Download ZIP**, or clone that branch. Keep the complete folder structure after extracting it.
2. Open a terminal in `previews/selection-workbench/versions/preview12`, the directory containing this README and `index.html`.
3. If Python 3 is already installed, run:

   ```sh
   python3 -m http.server 8000 --bind 127.0.0.1
   ```

   On Windows, `py -m http.server 8000 --bind 127.0.0.1` is an alternative.
4. Open <http://127.0.0.1:8000/> on the same computer. Press Ctrl+C in the terminal when finished.

The version directory must be the HTTP root, rather than the repository root. No npm install or build is needed. Avoid opening `index.html` directly with `file://`; browser module and asset restrictions can prevent candidates from working. Any ordinary static HTTP server can serve this directory. The command above listens only on the local computer. It has not been run on your device.

GitHub displays these files but does not run the website. Publishing this branch does not deploy the preview site or create an installed app. The branch contains the static files once, without an additional copy of the preview ZIP.

## What to try

Open **候選試玩** on the homepage, or search the catalog by a short code such as DV01, KM01, or TI01. Chinese search, functional-area filters, and the interactive-candidate filter are also available.

DV01 adds the read-only document version index with **修訂星軌** and **索引對照台** layouts. Both use the same synthetic metadata host. You can load more entries and explicitly select a version. This is separate from the D01 document reader: DV01 does not read document bodies or PDFs, download files, write data, or connect to a production adapter. The previous 12 candidates remain present.

## Verified scope

- The 165 static runtime files total 17,649,604 bytes. They match the accepted preview12 package byte for byte. [manifest.json](manifest.json) lists each public runtime path, size, and SHA-256.
- The previous 12 candidates retain their 145 runtime files unchanged. DV01 adds 6 files; 4 catalog and provenance files changed.
- Independent review repeated 179 integration checks, added 21 checks and 5 regression controls, and verified deterministic packaging, all archive CRCs, safe paths, and exact file identity in two isolated replays. These overlapping layers are not a combined product-test count. One initial negative control was terminated by SIGKILL for an undetermined reason and excluded; a smaller equivalent assertion then produced the expected failure.
- A bounded browser review covered 15 observations, including catalog filtering, D01/DV01 separation, four CSS widths, and DV01 navigation. It verified the selected version stayed pinned after switching layouts and completing load-more, while switching to a different document with the same title cleared the old selection. Intermediate loading observations were followed by settled-state checks.

## Limits and provenance

Only project preview code, artwork, and synthetic examples are included. There are no production accounts, real family data, real-model calls, or live mixed-module publishing features in this preview.

The catalog retains its `e8918dd` source baseline: 86 entries have source traces and 2 are not applicable. Semantic acceptance of all 88 modules remains unfinished. Full five-version extraction, production-owner mixing, real accounts and data, native devices, screen readers, and complete accessibility acceptance are not covered. The existing HC01 production reread gap and inherited React Native Web touch warnings remain. FR01 and SN01 are not included.

The UI retains conservative acceptance wording from when the runtime was frozen, including preview12 integration-pending notes. The verification summary above records later bounded acceptance without changing the verified runtime bytes. This snapshot is a selection aid, not evidence that unfinished production functions are complete.

The runtime corresponds to the locally validated `selection-workbench-preview12.zip`: 5,299,594 bytes, SHA-256 `24181c1a34d33994ca0cc2d43e24cbf3aa881153eca5a99df619e8b1322d70fd`. That ZIP is not duplicated in this branch. The frozen source manifest SHA-256 is `54c7c7f24c2aa58481de3e4c4d1ba754e626cce2e32f5ce17b8a124e196cb561`. Raw QA reports, internal source snapshots, credentials, and local environment files are excluded from this addition.
