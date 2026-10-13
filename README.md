# 育有方

An AI companion centered on source-backed parenting answers for adult caregivers of children aged 0–10 in Hong Kong. It uses confirmed child and family context to answer everyday questions and surface relevant growth-stage concerns; records, collaboration, memory, and notifications support that experience.

Planned capabilities include:

- Android and web clients with caregiver-confirmed text, Cantonese voice, photo, and shared-content records.
- Family handovers, proactive follow-ups, official Hong Kong parenting guidance, and traceable care summaries.
- A server-owned data store and agent runtime, with online web/Android clients, device authorization, and encrypted backups. Compatible self-hosted servers and a Windows Docker Compose setup are planned for P4.

P1 and the original P2 packages are complete; P3 has not started. The redesigned frontend is now the public Web entry at https://ex-machina.eu.org, backed by the existing authenticated Server, database and Agent. See the [production entry, feature map and deployment guide](docs/PRODUCTION_FRONTEND.md), [STATUS](STATUS.md) and [integration evidence](PLAN.md#active) for actual validation and remaining limitations. Check the [dated deployment observation](STATUS.md#deployment) for the last observed runtime revision, availability and VM stop setting; recheck before operating the VM.

Product requirements belong in [SPEC](SPEC.md); package scope and completion gates belong in [PLAN](PLAN.md#phases). The shared Prompt Pack and visual assets are reused.

<a id="entry"></a>
## Getting started

Read [STATUS](STATUS.md), then the relevant domain and current package:

- Frontend: [frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN#active](frontend/PLAN.md#active).
- Server, Agent, formal integration, or root documentation: [AGENTS](AGENTS.md#read) → [PLAN#active](PLAN.md#active).
- Open only the contracts, handoff sections, or Skills linked by that task. History is not a prerequisite.

<a id="authority"></a>
## Documentation

[Document responsibilities and update destinations](AGENTS.md#document-updates) define where each kind of information belongs. PLAN owns tasks; STATUS is a short projection; handoffs own integration differences, not another task log.

- Behavior and contracts: [SPEC](SPEC.md), [architecture](docs/ARCHITECTURE.md), [data model](docs/DATA_MODEL.md), [API](docs/API.md).
- Integration: [formal UI/API map](docs/P2_UI_HANDOFF.md), [frontend handoff index](frontend/HANDOFF.md).
- Reusable methods: the applicable project Skill; product prompts have their own [entry](prompts/README.md).
- Decisions and history: [DECISIONS](docs/DECISIONS.md), [archive and evidence index](_archive/README.md). Follow a specific LOG/EV link rather than reading all of WORKLOG or scanning evidence directories.

<a id="historical-assets"></a>
## Historical baseline and research

These original files are retained as historical assets. Start with the [archive index](_archive/README.md), then open only the specific source needed. Superseded recommendations are documented in [ADR-002](docs/DECISIONS.md#adr-002); they do not override the current specifications.

- [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md): compatibility entry for the archived complete v1.0 baseline.
- [PROJECT_PROPOSAL.md](PROJECT_PROPOSAL.md): compatibility entry for archived product research, Hong Kong sources, and validation hypotheses.
- [OPEN_SOURCE_REUSE.md](OPEN_SOURCE_REUSE.md): dated candidate and license research; inclusion does not imply adoption. Adoption decisions belong in DECISIONS.
- [PITCH_AND_DEMO.md](PITCH_AND_DEMO.md): compatibility entry for an archived presentation draft; simulations remain labeled.
- [WEEKLY_LOGS.md](WEEKLY_LOGS.md): compatibility entry for archived supervisor log templates.

Frozen documents keep the relative-link context of their source commit. Their compatibility pages and the archive index provide both the local archived copy and a fixed GitHub source snapshot; the frozen evidence itself is not rewritten.

<a id="run-test"></a>
## Running and testing

Use Node.js 24.3 or newer within the Node 24 release line and npm 11.8 or newer within npm 11. The verified development baseline is Node 24.19.0 and npm 11.8.0. From the repository root:

```sh
npm ci
npm run web
```

The root npm workspace uses `frontend/` for Web and a single root lockfile. Set `EXPO_PUBLIC_API_BASE_URL` to the existing Server's `/api` URL for local development (for example `http://localhost:3001/api`); the production default is same-origin `/api`. `npm run build:web` writes `frontend/dist`, including the existing Push service worker and license notices. The Docker Web stage serves this output through the existing Caddy configuration. Routes not yet connected are explicitly unavailable during integration, never simulated successes. The replaced root test interface is retained as byte-preserving snapshots in [_archive/legacy-web-2026-10-07](_archive/legacy-web-2026-10-07/README.md). Legacy Web/build/test commands fail explicitly; they do not run production acceptance.

Open the local address printed by Expo (normally `http://localhost:8081`). The record workflow requires the local server and database setup below; no model key is needed. Use synthetic data throughout P1.

```sh
npm run typecheck
npm test
npm run build:web
```

The tests exercise shared public inputs, API-address and server configuration, and workspace authorization using Node's built-in runner. `build:web` creates a static export under `frontend/dist/`; generated output is not committed. Select only checks needed for a change; the commands above are available entry points, not a requirement to run the full suite. Static checks do not represent integration, browser E2E, Android, persistence, or live-service acceptance.

`EXPO_PUBLIC_API_BASE_URL` defaults to `/api` for a same-origin deployment. See [.env.example](.env.example) for a local separate-server example. This is a public value embedded in the client bundle: never put provider keys, credentials, or private data in `EXPO_PUBLIC_*`. Only HTTPS remote addresses and HTTP loopback addresses are accepted; embedded credentials, query parameters, and fragments are rejected. This configuration does not implement runtime server switching.

Code boundaries:

- `frontend/app/`: the production Expo Router Web entry; `frontend/src/production/` owns authenticated shared data. The replaced root `app/` is archived; shared controllers and API clients remain active.
- `src/shared/`: platform-independent child and text-record input contracts and validation; no storage or network access.
- `src/config/`: public deployment-address validation, loaded by the app entry.
- `server/`: Firestore persistence, Firebase Authentication, and the shared HTTP/Agent authorization boundary.
- `tests/`: focused unit tests for those public boundaries.

Dependency versions and integrity are fixed in `package-lock.json`; attribution and adopted scope are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). No coo or other parenting-application code was copied. Use [STATUS](STATUS.md) to locate package verification evidence without loading the full work log.

## Local server development

The current application uses Firestore, Firebase Authentication and private Cloud Storage through the shared Node API. It does not start PostgreSQL or run SQL migrations. Follow [the production frontend and Firestore setup](docs/PRODUCTION_FRONTEND.md#firestore-deployment), including the existing VM/Compose configuration, protected storage key and scoped application identity.

```sh
# Configure the protected environment described in the deployment guide first.
npm run server
npm run worker
npm run web
```

Do not regenerate encryption keys to resolve startup errors. Keep provider credentials and storage keys outside the repository; never put them in public frontend variables. Frontend pages and Agent tools access the same Server authority, not separate client databases.

The retired `setup:local`, `db:migrate` and `storage:encrypt` commands deliberately refuse SQL startup. [P1 storage instructions](docs/P1_STORAGE.md) and [S06 acceptance](docs/S06_W03_ACCEPTANCE.md) describe historical SQL evidence, not the current setup. Necessary verification is scoped to the active package; do not run the old SQL integration suite as a prerequisite for Firestore development.

## Web record workflow

With both the server and Expo running, register an account or sign in, create a child, and enter a text record. Review the original text and child before confirming the save. Only a successful server response produces a saved receipt. The list displays the latest 100 confirmed records for the selected child; switching children keeps separate unsaved drafts in page memory.

Reopen the page and sign in to the same account to load saved records from the server. Offline mode blocks submission and warns that displayed data may be stale. A failed or uncertain submission keeps its input and requires a fresh read and manual duplicate check before retrying. There is no automatic write retry or persistent browser record store. Closing or refreshing a page with unsaved input shows the browser's warning; successful sign-out clears the page's private state.

The original SQL/browser record checks remain historical evidence in [S03-W01 acceptance](docs/S03_W01_ACCEPTANCE.md). Current Firestore checks and deferred items are scoped by [PLAN](PLAN.md#active); they are not a requirement to repeat the legacy acceptance suite.


## Team pilot

The original seven-day P1 pilot passed its necessary deployed-service and independent trial acceptance, including the Firefox login fix, and closed with [PR #23](https://github.com/2NTTY/child-ai-caregiver/pull/23). The same site hosted the authorized P2 release at the last recorded deployment; [current availability is unverified](STATUS.md#deployment). Use synthetic data and follow the [P2 trial guide](docs/P2_TRIAL.md). Use the [dated deployment observation](STATUS.md#deployment) for the last recorded VM stop setting; retained disk/IP charges continue after a stop. The [P2 delivery record](docs/P2_DELIVERY.md) preserves that release's operations and limits.
