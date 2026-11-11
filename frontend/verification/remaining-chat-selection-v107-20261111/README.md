# Remaining Chat design selection: preview v107, partial acceptance

**Deployment verified. Actual QA: PARTIAL_BLOCKED. Full version accepted: false.**

Preview v107 is deployed at the [existing comparison entry](https://yuyoufang-fe37-private-qa.ec002se.chatgpt.site/experiments/workbench-compare/), using Sites source `c86d128384d3ebbd36a30c83d062858a96ebfbd9`. Native version/deployment readback confirms success and the unchanged public audience, revision 2. The browser acceptance stopped at a Fourth inspection timeout. Deployment success is not full-version acceptance. No rollback or product change followed the timeout.

## Exact source and narrow policy change

- `SOURCE.json` pins all 504 product files; canonical SHA256 `60c4f508cf34ce04b1fd87c4bb748d67f821b4bf820da8af3a608c146ac536a4`.
- Only `experiments/workbench-compare/app.mjs` and `design-choices.mjs` changed from public v106/source `f769e6129a4b1778a5f05389246459d9013e3c32`; the other 502 files are exact. `SOURCE-DELTA.json` contains the before/after hashes, and `REMAINING-CHAT-SELECTION.patch` is the exact delta.
- The frozen Chat allowlist adds only Original (`original`), Handbook (`journal`) and Fourth (`uiux-upgrade`) to the existing Harbour/Care entries. Readiness and resolver use that same list. The option now says “助手（可挑選整頁設計）”. Existing source, ready/data/nonbusy, witness, lifecycle and export guards remain.
- Five admitted IDs are a source-code fact, **not five current browser passes**. Only whole-page design preferences are admitted. Photos, non-page Chat parts, unknown or mismatched sources remain denied. No renderer, fixture, catalog, transport, boundary, clock, access or native-composition change occurred.
- Independent source review found no Critical, Important or Minor finding. It required actual QA; it did not mark that QA passed.

The local published checkout matches every candidate file. The official helper's local archive has 505 hash-checked members: 504 product files plus unchanged hosting configuration. Local gzip/raw-tar hashes and the native saved version's reported 505 files are recorded separately in `VERIFICATION.json`. The native archive content hash differs from the local raw-tar hash; its serialization semantics are **undetermined**. No normalization or corruption explanation is inferred. Native stored-archive members were not independently downloaded and compared, and published HTTP response bodies were not freshly hashed. Source binding, local membership and native deployment success are distinct evidence.

## Actual v107 results, including the blocker

**Original and Handbook: bounded initial-display/witness/receipt checks passed.** Both first showed waiting with disabled picks, then distinct actual layouts. Each rendered DOM held six recent synthetic messages; native textareas were empty and Send was disabled. Each had one ready/data-ready/nonbusy gate and both unique, nonzero toolbar/reading-panel witnesses inside it, without hidden ancestors. Screenshots show the visible viewport and conversation tail, not all six messages simultaneously. Geometry/ancestry checks are not independent viewport-intersection proof.

One whole-page pick per design produced **two exact receipts**, matching their original source/main/payload/catalog identities and `/chat`/`page`. These are synthetic QA examples, not the user's preferences. Captured receipt fields contain no message, draft, query or case content; no clipboard export was attempted.

**Fourth: initial display observed; required witness and receipt acceptance incomplete.** An ordinary confirmed Open showed waiting, then a distinct six-message Chat DOM, composer without displayed content, disabled Send, visible Chat/source/main diagnostics and an eligible pick. The extra native-textarea value evaluation was not completed. This observation does not substitute for its ready-gate/witness check.

The next read-only Fourth witness/geometry evaluation failed with **`Runtime.evaluate timed out` after 3000 ms**. No witness result returned. The following screenshot statement was not reached; separate AX and screenshot attempts timed out at `DOMSnapshot.captureSnapshot` and `Page.getLayoutMetrics`. Fourth was not selected and no third receipt was captured.

The cause is **UNDETERMINED**. Offline source comparison found the same evaluator body apart from insignificant single-parameter arrow parentheses; one wrapper inspected two frames and the other one frame. Its parent-element walk terminates. No identifiable inspector-source defect explains the timeout. This is not diagnosed as a product failure, React/Photos error9, out-of-memory event or resource kill; remote browser resource telemetry was unavailable. There was no reload, reopen or product modification after the failure.

**New navigation, actual browser Back, sticky-return lock, Cancel and fresh-Open lifecycle: NOT_RUN_AFTER_BLOCKER.** The earlier Open that loaded Fourth is not acceptance of that lifecycle. Prior receipts remained before the blocker, but the required three-receipt persistence flow was not run.

**Host-only clipboard paste: NOT_RERUN.** No ordinary supported paste destination was available. A copy status, injected destination, old-version result or Chat composer was not substituted for paste proof. Duplicate-pick and post-load pending-selector changes were not rerun in the browser; they have controlled-test coverage only. Hidden marker/configuration/sequence/document objects were not inspected.

Cleanup's one about:blank attempt timed out. Normal close succeeded, and a fresh inventory confirmed the owned tab absent; the pre-existing unowned tab was untouched. Publisher Node runs exited and were normally reaped, and Node/browser ownership was released. These facts do not diagnose the browser timeout. `VERIFICATION.json` retains concise resolved selector/dialog/local-preparation incidents as well as the unresolved blocker.

## Honest controlled-test history

The retained final candidate run passed **191/191**, with zero failure, cancellation or skip. The accounting is **143 unchanged current-suite cases + 3 updated current expectations + 3 genuine v106 historical controls + 42 new cases**. It is not 149 untouched current tests. The original 149-case inputs remain preserved in the source evidence; the complete suite is not duplicated here.

1. `red001`: genuine v106 app and resolver, 42 cases, 37 expected assertion failures and 5 passing controls.
2. `regression001`: 188/191, with three new changed-document test-port TypeErrors. These were harness errors, not product failures; the failed run remains failed.
3. An approved harness-only setup correction used the established `host.load()` controlled port. Every assertion and every product byte was preserved. The exact pre-correction test and correction patch are included.
4. `red002`: the corrected three cases failed their expected initial-eligibility assertions on genuine v106, with no harness errors.
5. `regression002`: 191/191 passed. Neither publication nor archive preparation reran this suite.

## Compact subset and conditional replay

This archive includes the unchanged **42-case** `checks/remaining-chat-selection.test.mjs`, exact helpers, both source-pin inputs and the required eight-file current/v106 host sets. The genuine-v106 shared control uses **both old app and old resolver**, with their imports and six exact shared support files. The broader suite's v105 controls retain their historical scope but are not imported by this subset.

`REPLAY-INPUTS.json` lists 28 exact input files and the 42 case names. The focused three-case red wrapper and pre-correction file are historical evidence, not extra default cases. The pre-correction file is not directly runnable at its retained historical path.

**This is not a standalone replay or browser distribution.** The source-pin case reads three real main/payload pairs totaling 17,497,460 bytes. Those large assets are omitted; do not skip that test, change it or substitute expected hashes for actual bytes. Supply a separately obtained complete 504-file dist matching `SOURCE.json`. All source and helper inputs must remain exact.

First, from this archive directory, verify the included inputs with Python 3.9 or later:

```sh
python3 verify_replay.py
```

That command intentionally reports `ARCHIVE_INPUTS_VERIFIED_FULL_DIST_REQUIRED`. To verify a complete supplied dist and optionally prepare a separate, new local replay directory:

```sh
python3 verify_replay.py --dist PATH_TO_COMPLETE_DIST --prepare PATH_TO_NEW_REPLAY_DIRECTORY
```

The verifier rejects missing/changed/extra source files and symlinks, checks all 504 files and the six source assets, and copies only verified inputs. The destination must not already exist or be inside the archive or supplied dist. It does not start Node or a server. If subsequently authorized to execute tests, enter that new directory and use Node.js 22.8 or later; no package installation is needed:

```sh
node --max-old-space-size=384 --test --test-isolation=none --test-concurrency=1 --test-reporter=tap checks/remaining-chat-selection.test.mjs
```

**Archive replay was not executed.** Byte verification is not a replay pass. The harness runs real host/resolver/session/frame-entry/boundary logic over controlled geometry/history/clipboard/transport. It does not run React or prove browser layout, actual Back/BFCache, clipboard paste or accessibility. Full browser rendering also requires the appropriate hosting configuration, which is outside the 504-file product manifest.

## Prior evidence and remaining limits

Harbour/Care's bounded actual acceptance remains attributed to **v106**. Fourth's earlier **v106** initial-display/witness result remained view-only with its bootstrap lock; it cannot fill the missing v107 witness/receipt result. Older local Original/Handbook Home-to-Chat displays retain their original wrapper and entry-path limitations. Nothing here relabels those as new v107 lifecycle acceptance.

Full 18-message history/pagination and content operations; typing, send/model/backend, attachments/media and real-family data; other pages; Photos/error9 and clock repair; native composition; full mobile/accessibility/keyboard/gestures/zoom/cross-browser and sustained stability; production readiness, GCP, complete CI and merge acceptance remain outside this archive. Separate Summary work is not included and cannot fill the Chat gap.

Only approved code/tests, source manifests and safe derived evidence summaries are included. Raw browser/service records, screenshots, private identifiers/download URLs, credentials, machine paths and internal coordination are excluded. This is one append-only archive alongside the unchanged v102–v106 archives, not a master merge or a full-version acceptance certificate.
