# Workbench trial archive

Frozen preview07 source and dispatch05 public overlay, prepared locally for a separate GitHub branch. The archive has not been uploaded; no PR or master merge has occurred. The published Site and the GitHub snapshot are separate repositories and versions.

- `source/`: the exact 704 project-source, artwork and synthetic-fixture files. `SOURCE.json` records their sizes and SHA-256 values. Canonical source SHA-256: `c94b8fd018402103248859f81b4a08c12eaf8bea566fb35e290a7a6636bc02c6`.
- `public-overlay/`: the exact eight public payload files. This is not a standalone website: it requires the separate Site baseline in `PROVENANCE.json`. The overlay preserves 341 of 342 baseline files, replaces the experimental dispatcher and adds seven files, yielding 349 files.
- `PROVENANCE.json`: source/version pins and bounded verification limits. Hosting configuration, credentials, installed dependencies, private browser evidence and local bound runtime packages are excluded. Fixed synthetic loopback protocol constants remain unchanged.

## Published Site

[Workbench trial](https://yuyoufang-fe37-private-qa.ec002se.chatgpt.site/experiments/workbench-trial/) is PUBLIC as Site v97, deployed at `2026-11-09T12:09:33.494008+00:00`. Site source commit: `5c3a99cb62189a7583529ccd7f01b79eb466cfc2`. The separate GitHub archive base remains `5f3cd680de426cb77fd94b9a346076740c885c6d`.

## Bounded verification

Existing exact-source verification passed 272 matched product tests, full frontend typechecking and one production export. The longer local desktop journey covered Apply/Exit, search/scope/calendar/completed navigation, detail return, actual Back/Forward, form Discard, Home departure/fresh return and native cleanup. Its 13 post-bootstrap cases ended with zero lost events and failures; startup loss 246 remains inconclusive. These checks were not rerun for this archival update.

Actual public landing-to-Tasks routing and the observed script/SRI chain passed, followed by four Fourth-region Apply/Exit, completed-route continuity and normal Control reuse. Public cases 2–3 ended with zero lost events and failures; startup loss 255 remains inconclusive. Native cleanup passed. Original and four historical entries reached distinct first screens; that is reachability evidence, not complete legacy acceptance.

Both browser checks used desktop 1180 × 757 at DPR 1. Mobile, other native profiles, broad HTTP/CSP enforcement, broad accessibility, full legacy behavior, full Original/five-site fidelity and release admission remain unverified or incomplete. The public check did not repeat the longer local interaction matrix. No real-family input or model call was used.
