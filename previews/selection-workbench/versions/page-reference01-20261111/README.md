# Page reference index 01

This additive selection-workbench snapshot groups three existing references by page. Open `index.html` from this directory served over HTTP. It is a static reference index, not a production frontend or a deployed Site.

| Page | ID | Retained version | Display scope |
| --- | --- | --- | --- |
| Home | H-01 | v1 | Unchanged Nextcloud Dashboard source image |
| Assistant chat | PC01 | v1.0.1 | Unchanged source image in the index; retained HTML/CSS reconstruction in its separate entry |
| Care records | C-01 | v1.0.0 | Unchanged Baby Buddy Timeline source viewport |

Each page currently has one reference. This is not yet a multiple-option comparison for the same page, and it does not reproduce complete interactive UX. The source metadata, licenses, READMEs, checksums and candidate bytes are retained without alteration. See `provenance.json` for the exact GitHub commits and blob identities.

The user must identify a page and candidate ID in conversation before a real frontend is implemented and uploaded. This snapshot performs no selection writes, automatic mixing, production integration, account changes, API/model calls, or data submission. Existing workbench versions and selections are not changed.

## Verification

- Recovered 19 files from the three fixed GitHub commits and checked their Git blob identities and byte sizes.
- All 16 entries in the original SHA256SUMS files matched.
- Viewed all three original images directly.
- Checked the new index's local page/image/license links, original image dimensions, and display-only boundary.
- Independently rendered this index and followed all three candidate entry links in Chromium through the official isolated local HTTP preview on 2026-11-11. Desktop viewport 1180 × 757, DPR 1.
- All three images loaded completely and preserved aspect ratio. Full-page capture measured width 1132 px and heights 707.5 / 784.453125 / 614.5 px; final normal-page readback with the scrollbar measured width 1117 px and heights 698.125 / 774.046875 / 606.359375 px. No horizontal overflow, additional cropping, or caption overlap was observed.
- The retained PC01 reconstruction rendered its answer in two lines (52 px height), with a 14 px gap before the action icons.
- The three candidate READMEs retain their historical, explicitly bounded checks; this fresh integration check does not expand them to full product acceptance.
- Mobile, keyboard, screen-reader, original interactive UX, tsc/export and product acceptance: NOT RUN.
- Source HTML contains no scripts, forms, iframes or external automatic loads. The official local preview injected its usual live-reload helper; it is not a source or uploaded asset.
- No Site deployment or master merge.

Only public upstream reference illustrations are present. No project family data, messages, credentials or private raw evidence are included.
