# 育伴港

A planned AI-assisted care coordination app for adult caregivers of children aged 0–10 in Hong Kong.

Planned capabilities include:

- Android and web clients with caregiver-confirmed text, Cantonese voice, photo, and shared-content records.
- Family handovers, proactive follow-ups, official Hong Kong parenting guidance, and traceable care summaries.
- A server-owned data store and agent runtime, with online web/Android clients, device authorization, and encrypted backups. Compatible self-hosted servers and a Windows Docker Compose setup are planned for P4.

**Current status: local Web foundation and verified server authentication.** S06-W03 adds a Node/PostgreSQL server with email/password authentication and private account workspaces; all 11 approved real-database acceptance checks passed. The Web screen still states that login and storage are not connected. There is no usable care-record workflow, APK, deployed product service, or live product URL yet. See [STATUS.md](STATUS.md), [the reuse audit](docs/REUSE_AUDIT.md), and [SPEC.md](SPEC.md).

P1 requires a working web URL, server persistence, Gemini chat, and verified encryption/backup safeguards. P2 is the competition-delivery target: a persistent server agent, family permissions, web photo input, current knowledge, and preauthorized Web Push/Telegram follow-ups. Android follows in P3; deployment choice, full reports, migration, and disaster recovery complete P4. These are acceptance requirements, not claims of implemented features.

<a id="entry"></a>
## Getting started

Start with [STATUS.md](STATUS.md), then the current step and work package in [PLAN.md](PLAN.md). Follow [AGENTS.md](AGENTS.md) and read other documents only as needed.

<a id="authority"></a>
## Documentation

| File | Source of truth for |
|---|---|
| [README.md](README.md) | Project overview, navigation, and verified setup/test instructions |
| [AGENTS.md](AGENTS.md) | Agent workflow, language, model, quota, and verification rules |
| [SPEC.md](SPEC.md) | Product behavior, boundaries, permissions, and acceptance criteria |
| [PLAN.md](PLAN.md) | Implementation steps, dependencies, status, and acceptance gates |
| [STATUS.md](STATUS.md) | Current work snapshot, derived from PLAN |
| [WORKLOG.md](WORKLOG.md) | Append-only project history and evidence references |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, data flow, sync, AI, deployment, recovery, and runtime costs |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Entities, fields, relationships, invariants, and migration formats |
| [docs/API.md](docs/API.md) | Interface contracts, authorization, idempotency, errors, and compatibility |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decision rationale, superseded choices, and their impact |
| [artifacts/verification/](artifacts/verification/) | Redacted evidence from checks actually performed |
| [_archive/README.md](_archive/README.md) | Index of frozen baselines, legacy material, and archived verification evidence |

Maintain each definition in one authoritative document and reference it elsewhere. Preserve stable anchors for traceability; snapshots and verification evidence do not replace specifications.

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

Use Node.js 24.3 or newer within the Node 24 release line, and npm 11. The development baseline is Node 24.11.0 and npm 11.6.1. From the repository root:

```sh
npm ci
npm run web
```

Open the local address printed by Expo (normally `http://localhost:8081`). This is a foundation screen, not a working login or care-record application. No backend, database, model key, or external account is required for this package.

```sh
npm run typecheck
npm test
npm run build:web
```

The tests exercise shared public inputs, API-address and server configuration, and workspace authorization using Node's built-in runner. `build:web` creates a static export under `dist/`; generated output is not committed. These checks do not represent integration, browser E2E, Android, persistence, or live-service acceptance.

`EXPO_PUBLIC_API_BASE_URL` defaults to `/api` for a same-origin deployment. See [.env.example](.env.example) for a local separate-server example. This is a public value embedded in the client bundle: never put provider keys, credentials, or private data in `EXPO_PUBLIC_*`. Only HTTPS remote addresses and HTTP loopback addresses are accepted; embedded credentials, query parameters, and fragments are rejected. This configuration does not implement runtime server switching.

Code boundaries:

- `app/`: the minimal Expo Router Web entry.
- `src/shared/`: platform-independent child and text-record input contracts and validation; no storage or network access.
- `src/config/`: public deployment-address validation, loaded by the app entry.
- `server/`: PostgreSQL persistence, Better Auth, and the HTTP authorization boundary.
- `tests/`: focused unit tests for those public boundaries.

Dependency versions and integrity are fixed in `package-lock.json`; attribution and adopted scope are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). No coo or other parenting-application code was copied. Use [STATUS](STATUS.md) to locate package verification evidence without loading the full work log.

## Local server development

The following setup is for a local database and server. It is not the P4 self-hosting deployment bundle. Docker Desktop must be running. `setup:local` creates an ignored `.env` with random local database passwords and an authentication secret; it refuses to replace an existing file and never prints the values.

```sh
npm run setup:local
docker compose -f compose.dev.yaml up -d postgres
npm run db:migrate
npm run server
```

The server listens on `127.0.0.1:3001`, with `/api/health`, `/api/auth/*`, and `/api/workspaces` endpoints. PostgreSQL uses a persistent named volume and a loopback-only port. Migrations are additive, serialized by an advisory lock, and record application SQL checksums. Do not delete volumes to repair a migration or lose the `.env` secret: existing sessions depend on it. The Web product flow is delivered in S03-W01.

See [the API contract](docs/API.md#p1-server-http) and [.env.example](.env.example) for required settings. Production requires explicit HTTPS origins and a protected server-only secret. Email verification, password recovery, family invitations, and deployment proxy policy are outside S06-W03.

Integration checks require explicit approval under [AGENTS.md](AGENTS.md#finish). After approval, use the dedicated test database; these commands do not reset it:

```sh
docker compose -f compose.dev.yaml --profile test up -d postgres-test
npm run test:integration
```

The runner accepts only `TEST_DATABASE_URL` pointing to a local database whose name begins with `yuban_s06_test`. It uses synthetic accounts, retains those rows, and stops only its own server processes. Scope, costs, and result interpretation are in [S06-W03 acceptance](docs/S06_W03_ACCEPTANCE.md).
