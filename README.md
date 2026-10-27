# 育有方

An AI parenting companion for adult caregivers of children aged **0–10 in Hong Kong**. Source-backed answers are the core experience: confirmed child context, everyday records, growth-stage concerns, tasks and preparation documents help caregivers follow through. The interface uses Hong Kong Traditional Chinese, with Cantonese voice input among the implemented input paths.

**[Web service](https://ex-machina.eu.org)** · **[Current status](STATUS.md)** · **[Local development](docs/AGENT_LOCAL.md)** · **[Product specification](SPEC.md)**

The hosted service is invitation-based. Check the [dated deployment observation](STATUS.md#deployment) for the last observed runtime, availability and VM stop setting; this repository is not automatically deployed when a PR merges. Use synthetic data for development and acceptance.

## Product overview

The shared product code covers:

- **Parenting chat:** official-source retrieval and citations, confirmed memory, persistent conversations, progress and operation receipts.
- **Everyday care:** child profiles, text/photo/voice inputs, private reference sources, records and corrections.
- **Follow-through:** tasks, appointments, growth concerns, preparation documents, summaries and growth reports with PDF output.
- **Caregiver controls:** consent and confirmation, personal model settings, usage limits, private data access and authorized notifications.

Web and native clients share the Expo/React Native frontend, TypeScript controllers and Server APIs. The Server owns business data, authorization, Agent execution and background work; clients do not maintain a separate business database or run an on-device Agent. Production uses **Firestore, Firebase Authentication and private Cloud Storage**, not PostgreSQL.

These are implemented product areas, not a claim that every platform or workflow has passed acceptance. The assistant does not diagnose illness, choose medication or replace professional care; photos and AI outputs are not medical assessments.

## Current delivery status

Snapshot checked against the project plan on **2026-10-24**. [PLAN](PLAN.md#active) owns package status and completion gates; [STATUS](STATUS.md) owns the short summary and dated deployment observations.

| Area | Actual status and remaining boundary |
|---|---|
| Web / P1–P2 | P1 and the core P2 Web/Firestore delivery are in place. Grey draft-text streaming and the deferred native backup restore verification remain open; P2 is not unconditionally complete. |
| Android / P3 | APK v2, compatible OTA delivery, retained sign-in/data after upgrade and one authorized FCM notification have evidence. Cross-device, media, care-notification completion/stop and OTA rollback checks remain; Android and P3 are not fully accepted. |
| iOS / P3 | Shared-app wiring, media/APNs code and release tooling are merged; local checks and an iOS JS/Hermes export passed. Apple team/app identity, signing, a signed IPA, TestFlight delivery and real iPhone/APNs acceptance are still pending. |
| Agent roles | Chat, independent review, document compilation and background knowledge-maintenance wiring are present, with bounded local evidence. Full role completion and final joint acceptance remain open; long-source and multimodal gaps are tracked in [DEV02](PLAN.md#dev-agent02). |
| P4 | Not started. Full multi-caregiver family sharing, compatible Server selection, Windows self-deployment, device pairing and broader migration/management capabilities remain future work. Existing personal workspaces and access isolation are not deferred. |

Merged source is also not a release: [expanded attachment readback](PLAN.md#attachment-read01) still has validation/deployment gates, and [profile/child avatars](PLAN.md#avatar-01) remain disabled (`AVATAR_LIFECYCLE_RELEASE_READY=false`). See the [platform plan](PLAN.md#p3-mobile), [iOS plan](PLAN.md#p3-ios) and [P4 scope](PLAN.md#p4-family) rather than treating previews or bundles as finished products.

<a id="entry"></a>
## Getting started

For a local product instance, use the emulator-based launcher below. For the hosted service, sign in with an eligible invited account; family-member invitations and shared caregiver roles are not yet enabled.

Before contributing, read [STATUS](STATUS.md), then the relevant domain:

- Frontend: [frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN#active](frontend/PLAN.md#active).
- Server, Agent, formal integration or root documentation: [AGENTS](AGENTS.md#read) → [PLAN#active](PLAN.md#active).
- Open only the contracts, handoff sections or Skills needed for that task. Historical evidence is not a setup prerequisite.

<a id="run-test"></a>
## Running and testing

Use the ranges in root [package.json](package.json): **Node `>=24.12.0 <25`** and **npm `>=11.8.0 <12`** (`packageManager` pins npm 11.8.0). The recorded development baseline is Node 24.19.0. The local emulator launcher also requires **Java 21+**.

From the repository root, start a data/UI development instance without model calls:

```sh
npm ci
npm run agent:local -- --no-model
```

Open the single `http://127.0.0.1:<port>` URL printed by the launcher, not Expo's direct port. It runs the current branch's Web/API against isolated, persistent Firebase emulators, creates a local synthetic account and prints the location of its credentials. First startup downloads the official emulators. No GCP deployment or cloud database is required; local notification previews are not real deliveries.

### Local server development

For real AI behavior, follow the [local Agent guide](docs/AGENT_LOCAL.md), configure your own protected `LOCAL_AGENT_CONFIG` outside the repository, then run:

```sh
npm run agent:local
```

The guide covers Gemini, Vertex and OpenAI-compatible chat configuration, separate embedding credentials, local quotas and explicit knowledge preparation. Real model/embedding requests consume the configured provider's allowance; ordinary startup does not run paid acceptance automatically. `--no-model` disables models rather than substituting fake answers. If that mode previously saved a disabled local AI policy, explicitly enable it in the local `/admin` before model work; do not reset data or usage to bypass it.

For frontend-only work, `npm run web` starts the `frontend/` Expo workspace. It **does not** start the API or initialize data: configure the matching API and Firebase public authentication values first. `EXPO_PUBLIC_API_BASE_URL` defaults to same-origin `/api`; authenticated Web use requires Web and API behind the same origin, not merely two development ports. Prefer the local launcher, or follow [.env.example](.env.example) and the [production setup](docs/PRODUCTION_FRONTEND.md#firestore-deployment) for a configured proxy. The API-address setting is not runtime Server switching.

Advanced `npm run server` / `npm run worker` entry points require the protected Firestore configuration described in that deployment guide. The retired `setup:local`, `db:migrate` and `storage:encrypt` commands deliberately refuse SQL startup; old SQL acceptance is historical, not a Firestore setup step.

### Available checks and builds

```sh
npm run typecheck
npm test
npm run build:web
```

Select checks appropriate to the change; this is not a requirement to run the full suite. `npm test` uses Node's built-in test runner. The root npm workspace uses one root lockfile; `build:web` exports `frontend/dist` and adds the Push service worker and license notices. Generated output is not committed, and the Docker Web stage serves it through Caddy.

Static checks, tests and platform exports are separate evidence from browser integration, persistence, live services and real devices. Native build/OTA/TestFlight operations use the [fixed mobile release guide](docs/PRODUCTION_FRONTEND.md#mobile-release); an iOS export is not an installable signed IPA. Legacy Web/build/test commands fail explicitly rather than running current acceptance.

## Repository layout

| Path | Responsibility |
|---|---|
| `frontend/app/`, `frontend/src/production/` | Shared Expo Router screens and authenticated data owners |
| `src/client/`, `src/shared/`, `src/config/` | Controllers, API clients, shared contracts/validation and public configuration |
| `server/` | HTTP API, authorization, Firestore/storage services, Agent runtime and background work |
| `prompts/`, `knowledge/` | Product Prompt Pack and knowledge-source assets |
| `deploy/`, `scripts/` | Deployment configuration, local development and operator/release tooling |
| `tests/` | Focused tests; evidence and remaining acceptance gates are linked from PLAN |

## Security and data boundaries

- Only public API/Firebase configuration belongs in `EXPO_PUBLIC_*`. Never include provider credentials, encryption keys, session secrets or private family data in the client bundle, Git or shared logs.
- API addresses accept HTTPS remotely and HTTP on loopback only; embedded credentials, query parameters and fragments are rejected.
- Keep existing storage keys and recovery material protected and separate from the repository. **Do not regenerate encryption keys to fix startup errors.**
- Writes are successful only when the Server confirms them. For an uncertain operation, look up its original run/operation and receipt before retrying; do not create a duplicate action because a connection dropped.
- Offline clients are not an offline write queue or authoritative record store. Private attachments, sources, child access and notification permissions remain Server-controlled.
- Dependency versions and integrity are locked in `package-lock.json`; attribution and adopted scope are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

<a id="authority"></a>
## Documentation

[Document responsibilities](AGENTS.md#document-updates) define each source of truth; this README is an entry point, not a second task log.

| Need | Start here |
|---|---|
| Current work, limitations and deployment observation | [STATUS](STATUS.md), [PLAN](PLAN.md#active) |
| Product behavior and technical contracts | [SPEC](SPEC.md), [architecture](docs/ARCHITECTURE.md), [data model](docs/DATA_MODEL.md), [API](docs/API.md) |
| Local development and hosted operation | [Local Agent guide](docs/AGENT_LOCAL.md), [production frontend / Firestore deployment](docs/PRODUCTION_FRONTEND.md#firestore-deployment) |
| Feature/API integration | [Formal UI/API map](docs/P2_UI_HANDOFF.md), [frontend handoff index](frontend/HANDOFF.md) |
| Agent prompts, reuse and decisions | [Prompt Pack](prompts/README.md), [technology reuse](docs/TECH_REUSE.md), [DECISIONS](docs/DECISIONS.md) |

<a id="historical-assets"></a>
## Historical baseline and research

Start with the [archive and evidence index](_archive/README.md), then follow a specific LOG/EV or source snapshot. The original P1 pilot, [P2 trial guide](docs/P2_TRIAL.md) and [P2 delivery record](docs/P2_DELIVERY.md) describe their dated releases, not current availability or complete acceptance of later changes.

`DEVELOPMENT_PLAN.md`, `PROJECT_PROPOSAL.md`, `PITCH_AND_DEMO.md` and `WEEKLY_LOGS.md` are compatibility entries for archived material. [OPEN_SOURCE_REUSE.md](OPEN_SOURCE_REUSE.md) is dated candidate/license research, not an adoption list. The replaced root Web interface is preserved in the [legacy Web archive](_archive/legacy-web-2026-10-07/README.md). Frozen evidence retains its original link context and is not rewritten to imply current support.
