# Selection Workbench

The selection workbench (選配工作台) contains isolated, synthetic UI candidates for comparison.

## Version entry · preview30 candidate · 2026-11-06

Start with **[preview30's dated release status](versions/preview30/RELEASE-STATUS.md)**, then its [application README](versions/preview30/README.md) and [index.html source](versions/preview30/index.html). This experimental source snapshot contains 39 candidates across 38 modules, with 334 public files. It adds QK01 quick actions and RR01 route recovery relative to [Earlier preview29](versions/preview29/RELEASE-STATUS.md); [Earlier preview27](versions/preview27/RELEASE-STATUS.md) remains available. Native and HTTP checks for this release are **NOT_RUN**; all 88 full semantic-acceptance gates remain pending. This is not a deployed Site or a master merge.

For local viewing, use the complete `versions/preview30/` as its own HTTP document root: `python3 -m http.server 8000 --bind 127.0.0.1 --directory .`, then open `http://127.0.0.1:8000/index.html`. Run it from that version directory, not the repository root. No npm install or build is needed. GitHub's file browser is not a running website, and `file://` is not a reliable ES-module entry. These instructions have not been executed for this release.

## Historical navigation (preserved)

The “Latest” labels below describe their original historical snapshots, not the candidate entry above. All existing version files, candidate content, selections and undo behavior remain unchanged.

- **Latest experimental source archive: [preview23](versions/preview23/RELEASE-STATUS.md)** contains 25 candidates across 24 modules, 88 catalog boundaries, and 104 research URLs. It adds the independently reviewed SL01 and CD01 source snapshots, with bounded standalone checks only. Integrated native acceptance remains INCOMPLETE; a Chromium code 9 was associated with the tested URL and its cause is UNKNOWN. This is not full-site acceptance or a deployment. Read the dated release status before the [application README](versions/preview23/README.md). PC, AP, TC, child-scope and CW additions are not included. All earlier versions and their evidence limits remain unchanged.
- **Latest bounded candidate snapshot: [preview21](versions/preview21/README.md)** contains 23 candidates across 22 modules, an 88-boundary catalog, and 94 research URLs. Read its dated [release status and limits](versions/preview21/RELEASE-STATUS.md) first. MR01 memory reading and CI01 citation reading have bounded interaction checks; overall native acceptance remains INCOMPLETE because an earlier long browser session ended with Chromium code 9. A short follow-up did not reproduce it, but the cause remains unknown. This is a selection preview, not a complete accepted product.
- [preview18](versions/preview18/README.md) has 19 candidates across 18 modules. It adds CH01 chat reading, CR01 saved care records, and CP01 / P01 child-profile reading to preview15. The catalog contains 88 modules and 78 public research URLs.
- [preview15](versions/preview15/README.md): the preserved 16-candidate snapshot across 15 modules, including NH01 personal message history and the separate N01 latest-five view.
- [preview12](versions/preview12/README.md): the preserved 13-candidate snapshot, including the DV01 document version index.
- **Separate compact option: [CW01 over preview23](versions/cw01-preview23/RELEASE-STATUS.md)** retains the original gallery with a separate compact entry. Source/composition checks and bounded native observations have scoped acceptance; complete-gallery native acceptance remains INCOMPLETE.

Start with the selected version's README and serve that complete version directory over local HTTP. GitHub's file browser does not run the website. This branch does not deploy or replace the existing preview site or production application. The preview12, preview15 and preview18 files remain unchanged.

All 88 full semantic-acceptance gates remain pending. Preview18's bounded packaging and gallery checks do not resolve its documented chat, care, profile, focus, device, or accessibility limitations. Read the version's verified scope and known limits before evaluating a candidate.

## Original blue Care reconstruction

[Original blue Care, reconstruction05](versions/original-blue-59912-root05/README.md) is a separate synthetic, read-only preview reconstructed from commit `59912bd1f79dae120d393f66f944e4241ee483cb`. It retains the historical blue interface, with the corrected provenance notice. It is not the original sealed v92 archive or an additional preview18 module or candidate.

Follow that version's README. From `versions/original-blue-59912-root05/`, run `python3 verify.py`, then `python3 -m http.server 8000 --bind 127.0.0.1 --directory static`, and open `http://127.0.0.1:8000/`. Serve `static/` as an independent HTTP document root, not a workbench subpath or `file://`. Uploading these files does not deploy a website. The existing preview12, preview15 and preview18 files remain unchanged.

