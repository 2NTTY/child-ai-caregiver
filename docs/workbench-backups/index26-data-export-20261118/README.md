# Workbench index26: choosing what to export

Authored text-only reference index. No application changes. Index26 adds one comparison of two different export surfaces, preserving index25's 17 previous groups, 25 original links, and its one separate historical single. There are now 18 groups. Old links were preserved, not all individually retested.

## Primary sources

- [Kin export page](https://github.com/ock666/Kin-CRM/blob/469db7000e1308778dcc52553eb30b7704cca080/app/templates/export.html), [layout](https://github.com/ock666/Kin-CRM/blob/469db7000e1308778dcc52553eb30b7704cca080/app/templates/base.html), [scope](https://github.com/ock666/Kin-CRM/blob/469db7000e1308778dcc52553eb30b7704cca080/app/scoping.py). Version 2026.11.1, MIT (Skye). Complete three-card web page: generic JSON plus separate CSVs for people and journal entries. Product source scopes these records to the household, not just the individual. Same-version Atkinson Hyperlegible fonts, SIL OFL 1.1 (Braille Institute of America), notice pinned at google/fonts@eff7af0d90b4d532ffa4b041937b560c6df4e7b1e95.
- [Todo export window](https://github.com/followG/todo-tauri/blob/399807827c82ed74de143cb8faa30f5f0a9aa196/src/Export.vue), [window specification](https://github.com/followG/todo-tauri/blob/399807827c82ed74de143cb8faa30f5f0a9aa196/src-tauri/tauri.conf.json). Package/config version 1.0.0, MIT (G). Complete app content area of a 320x320 resizable desktop window. Format and time range are independent; the screenshots show default Markdown/all. Scope is current and completed tasks, not all application settings or account data. OS decoration and native folder picker are not reproduced.
- [Product comparison point](https://github.com/2NTTY/child-ai-caregiver/blob/39f2f32287e032501c7b0c2663db57972e7fce9b/frontend/src/components/account/AccountDataControls.tsx): data available to the requesting person is delivered in batches. An early portion is not completion; reloading loses the current cursor. Neither source demonstrates that contract.

## Evidence and limits

21 original Git blobs verified against fixed references. A: 1150x760 and 390x865 CSS px, all three choices and final action visible after entrance animations settled; narrow navigation scrolls horizontally inside its own strip. B: 320x320 original design and 390x320 resized desktop content. No page-level horizontal/vertical overflow in the four full captures. Linux font fallback for the B system stack is not a Windows hardware test. Only synthetic pre-export layout and fixed template states; no source app runtime, accounts, real people or tasks, downloads, generated records, directory selection, upload, or successful restore was tested.

The viewer was opened from the catalogue. Combined/single modes, original vs same-width views, original-size local image scroll, scope disclosure and return navigation were checked; no viewer-level horizontal overflow at a 390px frame.

Private capture fingerprints (PNG, pixels, bytes, SHA-256):
- A-native: 1150x760 / 190105 / 927f308c29e84a418c4f668144e2a334202b69b180b73467b2263e63b54af0f2
- A-narrow: 390x865 / 140274 / fe63f9170c7e0ef5a21d0a646bb192d6a9bc54f42519adb65dc021dc35c2279a
- B-native: 320x320 / 19783 / d80b1bf0709bd5ec0c7cc7f800a81101a6bd89b6c3f46f96b03050732bbf28e1
- B-narrow: 390x320 / 20436 / 6c7dab13221c7632574be648a1772b2db138eca9a9d93c2304ad82e40995de52

Private artifacts verified by full byte readback:
- incremental ZIP / 1193657 bytes / 4c08122414d9404cf3910a153ab4509d2577554c31efb029be678a02068873c3
- standalone viewer / 512201 bytes / 3b612dcfbc0986ed403ef7aaa3b5d5c8b6522ef94f95b65b4d7172848fb60429

This branch contains only this authored text. It cannot independently recreate the view from the hashes. The private standalone viewer restores this pair; the private catalogue increment needs the prior base and increments through index25 for the older entries. No screenshots, external raw materials, fonts, HTML, private artifact locations, credentials, or product data are included here.
