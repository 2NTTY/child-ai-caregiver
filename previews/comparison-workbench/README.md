# Tasks comparison source checkpoint

This directory preserves editable source for the synthetic Tasks comparison pilot. It is a source checkpoint, **not a completed comparison Workbench, a production release, or a browser/export acceptance result**. It does not replace the repository's production frontend.

## Contents

- [`source/frontend/app`](source/frontend/app): bounded Expo Router entry points.
- [`source/frontend/src/workbench`](source/frontend/src/workbench): one synthetic Tasks owner, composition and presentation ports, and Original / Harbour / Care / Handbook / Fourth slot-renderer sources.
- [`source/frontend/src/components`](source/frontend/src/components): editable UI components, with supporting motion, preview and view-model source.
- [`source/frontend/assets`](source/frontend/assets): project branding and illustration assets.
- [`source/package.json`](source/package.json), [`source/package-lock.json`](source/package-lock.json): unchanged dependency declarations and lockfile.
- [`SOURCE-MANIFEST.json`](SOURCE-MANIFEST.json): relative paths, sizes, modes, SHA-256 hashes and Git blob IDs for the exact source payload.

All 458 source files (4,931,662 bytes) are unchanged from the prepared checkpoint and have Git mode `100644`. Private preparation receipts, raw diagnostic logs, dependencies, source maps, build outputs and local recovery material are not included. The manifest and this README are delivery metadata, outside the frozen source payload.

## Working with the source

The declared environment is Node `>=24.12.0 <25` and npm `>=11.8.0 <12`. From this directory:

```sh
cd source
npm ci
npm run web --workspace frontend
```

The frontend also declares `npm run typecheck --workspace frontend` and `npm run build:web --workspace frontend`. These commands were **not rerun for this publication**, and a clean dependency installation or web export is not claimed here.

The package files were deliberately preserved rather than silently rewritten. Root server, agent, deployment, test and aggregate build/typecheck scripts reference files outside this extracted source checkpoint; several frontend verification scripts are also absent. Do not treat those inherited scripts as supported checkpoint workflows. The dependency lock still includes packages from the original broader workspace; their presence is not a backend connection.

The preserved Expo web base path is `/variants/original` (`source/frontend/app.json`). Export/hosting needs compatible routing. The checkpoint contains the bounded Tasks composition source, not a fully accepted five-frame comparison host or working selection UI.

## Verification status

Existing evidence from **2026-11-01 UTC**, reused without a new compiler or product-test run:

| Scope | Result |
| --- | --- |
| Exact physical source preparation | 458 payload files; hashes and modes preserved |
| Supplemental local TypeScript no-emit diagnostic | Node 24.22.1 / TypeScript 6.0.3; 430 configured roots; exit 0; 0 diagnostics |
| Formal isolated/offline TypeScript and export gate | Blocked; not replaced by the supplemental diagnostic |
| Runtime, browser, native and full five-variant acceptance | Not run / not claimed for this checkpoint |
| `runtimeReady`, `selectable`, `dataMapped` | Remain `false` |

The configuration retains `allowJs: true` and `checkJs: false`; zero diagnostics is not a claim that every JavaScript behavior has been checked. Full browser interactions, export, frame integration, accessibility and production integration remain separate acceptance work.

Source-plan SHA-256: `efb32c8911e12dd4854294fa00a5676859a3950bd2cbb534dd17e20fa59fede9`.

Exact payload Git tree ID: `1856fb742425a3ebe9fea2462faee90625a38807`. This is a content identity, not a claim that an earlier published commit exists.

Existing diagnostic postcheck SHA-256: `918456171186715bdae29d09bae4b1713a6ed96b1b9bb525814b55697cf087f5`. The private raw report is intentionally not published.

## Data and service boundary

The pilot uses synthetic fixtures and explicitly labels unsupported pages and operations. It does not contain real family records, credentials or a production backend/model initializer. No real server/model calls, account-permission changes, GCP operations or deployment are part of this source delivery. Keep real family data, messages, photographs and credentials out of this preview.
