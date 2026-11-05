# Selection Workbench preview18

This static selection workbench (選配工作台) offers 19 interactive candidates across 18 candidate-bearing modules. Its catalog contains 88 modules and 78 deduplicated public research URLs. The catalog is an inventory for comparison, not acceptance of 88 complete product features.

## Start locally

1. Clone the isolated preview branch, preserving its complete folder structure:

   ```sh
   git clone --single-branch --branch codex/selection-workbench-20261105 https://github.com/2NTTY/child-ai-caregiver.git
   cd child-ai-caregiver/previews/selection-workbench/versions/preview18
   ```

2. With Python 3 already installed, start a local static HTTP server:

   ```sh
   python3 -m http.server 8000 --bind 127.0.0.1
   ```

   On Windows, `py -m http.server 8000 --bind 127.0.0.1` is an alternative.
3. Open <http://127.0.0.1:8000/> on the same computer. Stop the server with Ctrl+C when finished.

Serve this version directory, which contains `index.html`, as the HTTP root. No npm installation, dependency setup, build, account, API key, or model is needed. Another ordinary static HTTP server is also suitable. Use HTTP rather than opening the HTML file directly. These instructions have not been run on your computer.

GitHub stores and displays the files; this branch is not a live website. This addition does not deploy to the existing preview site or change the production application. There is no separate preview archive. The complete [preview15](../preview15/README.md) and [preview12](../preview12/README.md) snapshots remain unchanged.

## Explore the candidates

Choose **候選試玩** on the homepage, then use the gallery's normal top-level links. Chinese search, functional-area filters, and the interactive-candidate filter help narrow the catalog. Search by a short code such as CH01, CR01, CP01, NH01, or DV01.

Compared with preview15, this snapshot adds three read-only candidates:

- **CH01, chat reading:** a continuous original-text timeline and a date index with a full-text reading pane. Both use the same synthetic host. Search covers loaded text only; an unknown history total does not become a completion percentage. Long text still requires scrolling.
- **CR01, saved care records:** an original-record notebook and a source/version comparison layout with a full-text reader. Raw quantities, units, times, sources, and uncertainty labels stay distinct.
- **CP01 / P01, child profile:** a grouped profile view and a field index with a full-text reader. Both display synthetic current-profile data without changing the production profile owner.

Earlier candidates, including NH01 personal message history and the separate N01 latest-five view, remain available. These pages do not send real messages or photos, use real family information, call real models, or perform production account, data, or permission operations.

## What was verified

- The 208 runtime files total **17,988,096 bytes**. Every path, size, and SHA-256 is recorded in [PUBLIC-MANIFEST.json](PUBLIC-MANIFEST.json). The runtime is identical to the independently accepted public payload. This README and the manifest are additional documentation, outside that 208-file count.
- Against preview15's runtime, 23 candidate files are added and four gallery/catalog files change. The other 181 runtime files are byte-identical; none is removed. The older version directories themselves are preserved.
- Bounded independent packaging review accepted the corrected static-entry recipe and exact output. A prior entry-path alias defect was reproduced; the corrected recipe rejects those paths before writing. This is packaging evidence for an ordinary static filesystem, not a general security guarantee or a new UI acceptance run.
- Existing bounded gallery/browser evidence was checked separately. Top-level root and nested Back paths returned focus to the CH01 link. The root keyboard focus-visible observation and nested pointer observation are distinct evidence, not interchangeable keyboard tests.

## Known limits

- **Chat formal acceptance remains mixed:** 11 actual-tested PASS, 1 actual-tested RED, 1 source-traced, 25 planned, and 1 out-of-scope case. **CHAT-READ-F01 is not fixed.** These 39 cases are separate from packaging and gallery observations.
- Private 320- and 1024-width iframe Back checks retained **NOT_PASS** because focus returned to BODY. A 1024-width resize observation also left the focused link offscreen. That private harness is not shipped, and later visible content does not erase those failures.
- The 81 formal care-record cases and 64 formal notification cases remain **ALL_NOT_RUN**. CR-F01 / CR-F02 and the existing child-profile CP-F01 / CP-F02 failures remain open. The child-profile formal matrix remains mixed, and all 88 catalog-module semantic gates remain **pending**.
- Existing fractional clipping, focus-outline clipping, a 1-pixel background outer scroll, and recorded console/network limitations remain. Observation, screenshot, and DOM-receipt counts are not totals of passing tests.
- Production-owner integration, real accounts and data, assistive technology, physical-device touch and IME, zoom, forced colors, arbitrary scroll ancestors, and full WCAG acceptance are not established by this snapshot.

The runtime and public manifest intentionally retain their frozen build-time `pending` and `draft` wording, including statements that later review was still pending. The bounded packaging and gallery results above are the current release summary; no historical runtime or manifest status has been rewritten into a pass.

## Public provenance

The runtime retains its existing public source references, source-role analysis, and license information in the gallery and its `sources-data.js`, `catalog-data.js`, and `modules.json` data. Research links describe references and do not imply that every linked library was adopted. Existing attributions and applicable licenses remain unchanged.

- Catalog source baseline: `e8918ddfde9ef5e978bb4d6d1b43d67193fa9a92`.
- Runtime source-freeze SHA-256: `7595a786c12bf27c1936e28b666232455e0efe389726330a259141ac5eda1d52`.
- Public manifest SHA-256: `cb6d7acf6b4f66e45c0deb38842f7758c8d9d0e9de2b9d7d057739616e3fe61d`.

Only approved project preview code, artwork, public analysis, and synthetic examples are included. Raw private review reports, private test harnesses, packaging recipes, credentials, local environment files, and internal notes are excluded. The existing synthetic `qa.html`, `qa.css`, and `qa.js` remain part of the approved runtime.
