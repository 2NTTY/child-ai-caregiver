# Simple workbench comparison: v102 source archive

This source-only archive preserves the five shell source files used in the published v102 design comparison. It is not a standalone runnable preview package, a complete website source tree, or full product acceptance.

Public entry: https://yuyoufang-fe37-private-qa.ec002se.chatgpt.site/experiments/workbench-compare/

## Version and reconstruction

- Public baseline: v99, Sites source `28eddf12ef3d9fbb452889810c239311f33b9513`, 503 product files.
- Archived candidate: v102, Sites source `4754cd8400f18956d54ab3e1b3f811fec816c194`, 504 product files.
- Overlay: four replacements and one added module. The other 499 baseline files are unchanged. `BASELINE-SOURCE.json` and `SOURCE.json` preserve complete before/after identity manifests. `SOURCE-DELTA.json` identifies every overlay path.
- The final fix2 changed only `experiments/workbench-compare/app.mjs` from v101/source `5023a7539cc0718fea44f1366d3bf8d6c859edbb`. Its SHA256 is `0f29ffedcc5eb36c93a7470f15b0039233194c264c05dcc4dfa987b12bb1995c`; the other 503 v101 files are unchanged.

Obtain the exact retained v99 Sites product tree through an authorized source workflow. Verify all 503 baseline paths, sizes and hashes. Copy the five files under `source-overlay/` to the same relative paths, preserving every other file. Verify all 504 candidate paths, sizes and hashes. Manifest canonical hashes use UTF-8 `path + NUL + sha256 + LF` in the manifest's listed order. This byte-level overlay reconstruction was checked without running product code. Hosting configuration is outside these product manifests and is not included here; the publisher retained it unchanged.

The predecessor GitHub archive is [Original global base at a88cebc0](https://github.com/2NTTY/child-ai-caregiver/tree/a88cebc0c748e0845c31c15cfbd5305543ea111d/frontend/verification/original-global-base-20261110). Its earlier 126-file comparison manifest is not the complete v99 tree: 125 rows match, while `experiments/dispatch.js` differs. Follow the exact Sites baseline and the manifests here, not that earlier manifest as a v99 substitute. `PROVENANCE.json` links the three unchanged direct imports to their exact public source commit `658fbed704a77d84e2e05123cca4665355ecc49f`; that separate source archive is not claimed as an ancestor or as wholly contained in this branch.

Compiled renderers, payloads, assets and other unchanged runtime dependencies remain intentionally omitted. The exact v99 Sites source and retained runtime are still required. This archive does not establish fresh full historical source membership or make those dependencies reproducible from these five files alone.

## Bounded verification

The publisher observed all five actual Tasks renderers becoming selectable, correct loaded-source identities, one Original calendar-layout part, pending-selector isolation, visual swap identity, removal, and the sticky cross-page lock. Normal Back remained locked; Cancel retained documents/lock/choices; confirmed Open created new selectable documents while preserving choices. At 674 x 432 CSS pixels using 175% desktop zoom, A/B switching and disabled hidden-side picking worked, and focus moved to the visible toggle. These were synthetic QA choices, not the user's preferences.

A later separate v102 check used one normal Copy and one native Chromium paste into the existing local-only Tasks search. The resulting 1096-character value retained the expected design label and handoff guidance, with exactly equal parsed JSON and source pins for one Original Tasks whole-page choice. The single-line input normalized line breaks to spaces: this is semantic delivery, not byte-exact clipboard formatting. The earlier tool clipboard read was empty and is preserved as a different-layer observation. This does not retroactively verify its earlier multi-choice content, exercise public fallback, explain that discrepancy, or prove all browsers/OSs. No product change was needed.

Focus relocation had no observed focus-visible ring. Other initial routes, full keyboard/accessibility, physical mobile, exact 1440/390/320 layouts, all parts, full Original/global/recovery and the broader matrix remain unverified. Photos error9, Chat limitations, historical UNKNOWN outcomes and earlier failures remain unchanged. The choices are intentionally not retained on reload/close.

`VERIFICATION.json` preserves these boundaries and hashes of retained publisher/copy receipts. The source reviewer recorded 10/10 controlled tests, using a controlled DOM/history model rather than the React bundle/browser. No test, browser or build was rerun for this archive. Publisher source/local-tar checks and Sites identity readback are not a direct hash attestation of deployed HTTP response bodies.

Only these public project sources, hashes and bounded summaries are included. No private raw evidence, screenshots, credentials, family data, dependency bodies or generated runtime bundles are uploaded. This branch only adds an archive directory; it does not change production source, publish another preview, open a PR or merge master. Later fixes should extend the same branch with a new explicitly versioned commit rather than silently rewriting this v102 record.
