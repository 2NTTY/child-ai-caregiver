# Workbench index28: what to do while offline

One new private comparison, preserving the 19 previous groups, 25 original links and one separate historical singleton. The new catalogue totals 20 groups. Earlier content was not all retested.

## Immutable sources

- [Google Chrome Samples: Custom Offline Page](https://github.com/GoogleChrome/samples/blob/228e6e56581105bb55cab0d9ff6212d408ccc7dd/service-worker/custom-offline-page/offline.html). The standalone fallback document, not Chrome's built-in network error UI and not the tutorial index. It explains the unsuccessful load and advises checking the network and trying again; there is no retry button. The source HTML marks Apache-2.0, and the repository also specifies CC BY 4.0 for HTML/CSS; both notices retained. Original inline SVG and system font; untouched visible content.
- [Forem's historical offline document](https://github.com/forem/forem/blob/73125c07950aa1a9bb60a38f1a4c2399a69eb357/public/offline.html), AGPL-3.0-or-later, [March 1, 2021 change](https://github.com/forem/forem/pull/12834); [official retirement notice](https://dev.to/devteam/goodbye-offline-page-5d98). It offers a blank drawing area while waiting, not a reconnect button. The snapshot preserves the two original inline SVGs, six default swatches, palette selector and bottom signature. No drawing or clearing occurred. Retired design, not current service behavior or a trademark license.
- [Product account-check context](https://github.com/2NTTY/child-ai-caregiver/blob/ab0080f3a7dbc43f3b06803f6bc4748be066efa5/frontend/src/production/ProductionGate.tsx). Waiting for account confirmation is not evidence that an operation was saved or resubmitted. These sources compare communication, not authentication or delivery semantics.

## Verified evidence

Six Google and four Forem original file blobs matched fixed commits. Static inert source documents, no service workers or source scripts run. Both source widths used equal 1080 CSS px frame height for the full page. B originally lacks a mobile viewport tag; narrow rendering is not a physical phone test. Normal 844 px first view clipped the bottom of B, so it was not presented as the complete page. The full-height sources had neither horizontal nor vertical content overflow. B's six swatches fit one row on desktop and wrap on narrow. No genuine account, messages, personal data or artwork used. No real disconnection, cache, retry, resubmission, persistence, drawing or sync tested.

The private viewer opens in sequential mode. Start, next and previous controls move keyboard focus onto each full design; both widths land within 10 CSS px of the page top. Side-by-side on desktop, stacked on narrow, both single views, image size switch, image-local original-size scrolling, and return-to-catalogue were checked.

Private full-page image fingerprints (dimension / bytes / SHA-256):
- A-wide: 1150x1080 / 79531 / 865a6f132cf37e40ec9b9ee82ef8b16d0137c8e3e8c18950ac342d83f6ff2955
- A-narrow: 390x1080 / 52161 / 3948d836c789b300e5757722d3baf90f052f9aa043f51da8846ec50671145347
- B-wide: 1150x1080 / 202215 / 88de7ec8a3df1c8a04aa3ee750962970a14692b400fb5477a1054d4b1a926b40
- B-narrow: 390x1080 / 196185 / 027715b7df53736a2e3aa397a07c1c5746e90c266f0553ec1b5b4d298b0d258b

Private backup byte readback:
- incremental package: 1655820 / 7143d2c4cd0d8e0d72f0ca0dfbfb943486028b162ae27279752f6be98372aea5
- standalone viewer: 768311 / 8a0ac5b59a15069a611e1b47a30576253c8faca3a02cf8cbc2d71dab6941aa2f

This branch contains this author-written text only. It cannot recreate the preview. The private standalone viewer restores this pair; the complete historical catalogue needs its earlier base and increments through index27. No screenshots, copied source, font, private links or credentials are included.
