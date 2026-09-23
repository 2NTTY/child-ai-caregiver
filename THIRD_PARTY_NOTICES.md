# Third-party notices

This project uses the packages below as unmodified npm dependencies. The application routes, configuration, shared contracts, and validation are project-specific code. No application source, prompts, images, fonts, or deployment files were copied from coo or the Expo default template. The Expo template was used only as a dependency-version reference.

The exact dependency tree and registry integrity values are recorded in [package-lock.json](package-lock.json). [The license inventory](licenses/manifest.json) records selected package versions, tarballs, original notice paths, and SHA-256 hashes. License texts are preserved without modification.

| Package | Installed version | Declared license | Preserved text |
|---|---|---|---|
| @expo/metro-runtime | 57.0.16 | MIT | [LICENSE](licenses/expo-metro-runtime/LICENSE) |
| expo | 57.0.24 | MIT | [LICENSE](licenses/expo/LICENSE) |
| expo-constants | 57.0.19 | MIT | [LICENSE](licenses/expo-constants/LICENSE) |
| expo-linking | 57.0.10 | MIT | [LICENSE](licenses/expo-linking/LICENSE) |
| expo-router | 57.0.22 | MIT | [LICENSE](licenses/expo-router/LICENSE) |
| react | 19.2.3 | MIT | [LICENSE](licenses/react/LICENSE) |
| react-dom | 19.2.3 | MIT | [LICENSE](licenses/react-dom/LICENSE) |
| react-native | 0.86.3 | MIT | [LICENSE](licenses/react-native/LICENSE) |
| react-native-gesture-handler | 2.32.0 | MIT | [LICENSE](licenses/react-native-gesture-handler/LICENSE) |
| react-native-reanimated | 4.5.1 | MIT | [LICENSE](licenses/react-native-reanimated/LICENSE) |
| react-native-safe-area-context | 5.7.0 | MIT | [LICENSE](licenses/react-native-safe-area-context/LICENSE) |
| react-native-screens | 4.26.0 | MIT | [LICENSE](licenses/react-native-screens/LICENSE) |
| react-native-web | 0.21.2 | MIT | [LICENSE](licenses/react-native-web/LICENSE) |
| react-native-worklets | 0.10.1 | MIT | [LICENSE](licenses/react-native-worklets/LICENSE) |
| @types/react (development) | 19.2.4 | MIT | [LICENSE](licenses/types-react/LICENSE) |
| typescript (development) | 6.0.3 | Apache-2.0 | [LICENSE](licenses/typescript/LICENSE.txt), [Third-party notice](licenses/typescript/ThirdPartyNoticeText.txt) |
| @google/genai | 2.24.0 | Apache-2.0 | [LICENSE](licenses/google-genai/LICENSE) |
| better-auth | 1.7.5 | MIT | [LICENSE](licenses/better-auth/LICENSE.md) |
| pg | 8.23.0 | MIT | [LICENSE](licenses/pg/LICENSE) |
| @types/node (development) | 24.13.6 | MIT | [LICENSE](licenses/types-node/LICENSE) |
| @types/pg (development) | 8.23.1 | MIT | [LICENSE](licenses/types-pg/LICENSE) |

The expo-router 57.0.22 npm tarball does not contain a root LICENSE file. Its npm `gitHead` is `7687b07947a5c866adeb11abbceae72403ccb188`; its preserved MIT license comes from the [Expo repository at that exact commit](https://github.com/expo/expo/blob/7687b07947a5c866adeb11abbceae72403ccb188/LICENSE). All other texts above were copied directly from the installed package. The project has not modified these upstream packages.

## SDK 57 dependency constraints

The Expo online compatibility check on 2026-09-22 required `react-native-web ^0.21.2` and `@types/react ~19.2.4`. These two direct dependencies were therefore fixed at 0.21.2 and 19.2.4 instead of the S01 candidate versions 0.21.0 and 19.2.2. Expo 57.0.24's installed `bundledNativeModules.json` still lists `react-native-web ~0.21.0` and does not list `@types/react`; both the local list and the updated online recommendation are retained as distinct evidence.

Router includes `react-native-drawer-layout`, whose required peers cause npm to install Gesture Handler and Reanimated even for this Web foundation. Reanimated in turn requires Worklets. Their explicit versions follow Expo 57.0.24's bundled compatibility list: Gesture Handler 2.32.0, Reanimated 4.5.1, and Worklets 0.10.1. They are installation support for Router; this work package does not implement drawer navigation, animations, or native features.

The initial automatic peer resolution chose Reanimated 4.7.0 and Worklets 0.13.0, while `expo-modules-core 57.0.18` accepts Worklets only in `^0.7.4 || ^0.8.0 || ^0.9.0 || ^0.10.0`. A first repair using npm `overrides` at the SDK 57 versions removed that version conflict, but npm 11.6.1 still reported 12 invalid graph entries despite their semver ranges matching. A single `npm ci` reproduced those entries with the override lockfile unchanged (SHA-256 `682aaf96c80351da688d95cbc54d21bea35555a8359dba675ab0ba5dcbea693`), ruling out stale installed files as the explanation. The final manifest removes those overrides and declares the same three exact versions as dependencies; no `--force` or `--legacy-peer-deps` was used.

After that repair, `npm ls --all --json` reported zero problems, `npx expo install --check` reported that dependencies were up to date, TypeScript checking passed, and the Web static export passed on Node 24.11.0 / npm 11.6.1. These are scoped build and dependency checks, not native or product acceptance.

## Transitive dependencies and distribution

S06-W03 adopts Better Auth's email/password/session handling and the PostgreSQL driver as unmodified server dependencies. Their installed package licenses and the Node/PostgreSQL development type licenses are preserved above. S11-W01 adds the unmodified Google Gen AI SDK 2.24.0 as a Server-only dependency. The current manifest covers 21 direct packages and 22 original license/notice texts; earlier verification artifacts retain their historical lockfile hashes.

Transitive packages and their individual license files remain in the installed `node_modules` tree. They are not all reproduced in this document, and `node_modules` is not committed. The inventory records every lockfile license declaration, including build tools and optional platform packages; declared metadata is not proof that every file or distribution obligation has been reviewed.

Before distributing an application build, review the actual shipped dependencies, bundled assets, package-specific notices, and required source or attribution materials. Preserve the applicable original notices with that distribution. This work package does not claim a complete legal, security, or release-license audit.


## P1 deployment images

S17 prepares unmodified upstream base images `node:24.19.0-bookworm-slim`, `postgres:18.6-bookworm`, and `caddy:2.11.4-alpine`; container execution and actual image digests remain to be verified. Caddy is used as a reverse proxy/static server under Apache-2.0. Its original [tagged license](https://github.com/caddyserver/caddy/blob/v2.11.4/LICENSE) is preserved in [licenses/caddy/LICENSE](licenses/caddy/LICENSE), SHA-256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`, and copied into the Web image. This image list is separate from the direct npm package inventory; base images retain their own upstream components and notices.
