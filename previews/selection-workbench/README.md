# Selection Workbench

The selection workbench (選配工作台) contains isolated, synthetic UI candidates for comparison.

- **Latest: [preview18](versions/preview18/README.md)** has 19 candidates across 18 modules. It adds CH01 chat reading, CR01 saved care records, and CP01 / P01 child-profile reading to preview15. The catalog contains 88 modules and 78 public research URLs.
- [preview15](versions/preview15/README.md): the preserved 16-candidate snapshot across 15 modules, including NH01 personal message history and the separate N01 latest-five view.
- [preview12](versions/preview12/README.md): the preserved 13-candidate snapshot, including the DV01 document version index.

Start with the selected version's README and serve that complete version directory over local HTTP. GitHub's file browser does not run the website. This branch does not deploy or replace the existing preview site or production application. The preview12 and preview15 files remain unchanged.

All 88 full semantic-acceptance gates remain pending. Preview18's bounded packaging and gallery checks do not resolve its documented chat, care, profile, focus, device, or accessibility limitations. Read the version's verified scope and known limits before evaluating a candidate.

## Original blue Care reconstruction

[Original blue Care, reconstruction05](versions/original-blue-59912-root05/README.md) is a separate synthetic, read-only preview reconstructed from commit `59912bd1f79dae120d393f66f944e4241ee483cb`. It retains the historical blue interface, with the corrected provenance notice. It is not the original sealed v92 archive or an additional preview18 module or candidate.

Follow that version's README. From `versions/original-blue-59912-root05/`, run `python3 verify.py`, then `python3 -m http.server 8000 --bind 127.0.0.1 --directory static`, and open `http://127.0.0.1:8000/`. Serve `static/` as an independent HTTP document root, not a workbench subpath or `file://`. Uploading these files does not deploy a website. The existing preview12, preview15 and preview18 files remain unchanged.

