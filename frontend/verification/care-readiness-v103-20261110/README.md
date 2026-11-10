# Care readiness: published v103 source archive

This source-only archive adds the one comparison-host file used by public v103. It preserves the prior v102 archive unchanged and is not a standalone runnable preview or full product acceptance.

Public entry: https://yuyoufang-fe37-private-qa.ec002se.chatgpt.site/experiments/workbench-compare/

## Identity and reconstruction

- Base: v102, Sites source `4754cd8400f18956d54ab3e1b3f811fec816c194`, 504 product files.
- Published: v103, Sites source `d18926188ab2912e58e7161ab79cf4e22949d8cb`, 504 product files.
- Only `experiments/workbench-compare/app.mjs` changes. Its SHA256 is `a6881c5146f38b292c0f70f4aef39a9658fb2fa1785e5ecce2054d0c65ac31cb`; the other 503 product files are identical. No product file is added or deleted.
- Existing public audience and access revision 2 are unchanged. Source archival does not itself deploy or change permissions.

Obtain the exact retained v102 product tree through the authorized Sites source workflow. Verify it against [the immutable v102 manifest](https://github.com/2NTTY/child-ai-caregiver/blob/067f6e3380fd1d86ff6db2a91ef663f8b51c6ac0/frontend/verification/simple-workbench-compare-20261110/SOURCE.json), apply this archive's one source-overlay file at its original relative path, then verify all 504 rows in SOURCE.json. Its canonical digest uses UTF-8 path + NUL + sha256 + LF in listed order. Hosting configuration is not included and was unchanged by the publisher.

The [prior v102 README](https://github.com/2NTTY/child-ai-caregiver/blob/067f6e3380fd1d86ff6db2a91ef663f8b51c6ac0/frontend/verification/simple-workbench-compare-20261110/README.md) preserves its own baseline and dependency requirements. Neither archive includes all compiled renderers, payloads, assets or runtime dependencies. Do not treat an older partial GitHub source manifest as a complete runnable Sites baseline.

## Change

Original and Handbook Care screens previously rendered but remained unselectable because their startup briefly reported Home and triggered the permanent navigation lock. The host now waits for the existing first-screen ready gate and both visible Care-specific surfaces before arming initial Care selection. This extends the existing Tasks mechanism only to Care.

The exact loaded source/document/route checks, post-arm permanent navigation lock, Back/Cancel discipline and selection list remain. No historical renderer, payload, source catalog, transport or permission changed. Chat and Photos remain explicitly prohibited from picking. Other routes have no new readiness guarantee.

## Bounded public result

In the published v103 page, Original and Handbook each displayed its distinct real Care screen. Both completed the ready gate, exposed nonzero visible Care markers, enabled whole-page picking and recorded the correct loaded variant, /care route and source/payload hashes. All selections were synthetic QA, not the user's preferences.

One Original navigation to Home locked its picking. Normal browser Back returned to Care without unlocking it. Cancel retained the same frame epoch names, visible screen, lock and two choices. Confirmed Open created new epoch names and restored both Care selections while retaining the list. This is UI/DOM continuity, not a direct reading of hidden document IDs.

The author recorded a final complete 45/45 comparison-host controlled test pass, independently reviewed. The publisher did not rerun that suite or an Expo build; it performed fresh syntax, exact source/archive and public UI checks. Earlier failed test attempts and fixture corrections are summarized in VERIFICATION.json and remain preserved in the underlying evidence. This archival step does not rerun product tests.

## Separate follow-up

FOLLOWUP-VERIFICATION.json records a later v103 browser check of Harbour, Care and Fourth. Each displayed its real initial Care screen, completed the ready gate, exposed both visible Care markers and added the correct whole-page source identity. Together with the original publisher run, this covers initial Care display and selection for all five designs. It does not extend the Original-only navigation/Back/Cancel/reopen result to the other variants. The original publisher verification file is retained with its original scope.

## Limits

The initial publisher run accepted Original and Handbook Care plus one Original navigation sequence; the separate follow-up adds initial Care display and selection for the other three designs. Neither run establishes complete route coverage, physical mobile, full keyboard/accessibility, clipboard/fallback or cross-browser behavior. Chat/Photos limitations and older failures are not relabeled as fixed. No backend/model or real family-data operation occurred.

Official saved-version/source and succeeded-deployment reads establish publication provenance, not direct hashing of deployed HTTP response bodies. This archive contains only already-public project source, relative product identity rows, public source links and bounded verification summaries. It excludes raw browser/tool records, screenshots, credentials, private notes and household data. No PR or master merge is included.
