# 育伴港

A planned AI-assisted care coordination app for adult caregivers of children aged 0–10 in Hong Kong.

Planned capabilities include:

- Android and web clients with caregiver-confirmed text, Cantonese voice, photo, and shared-content records.
- Family handovers, proactive follow-ups, official Hong Kong parenting guidance, and traceable care summaries.
- User-controlled storage on a phone, in a browser, or on a designated server, with device pairing, sync, and portable backups.

**Current status: documentation only.** S00 documentation migration is complete; S01 has not started. There is no runnable app, APK, or deployed product service, and there is no live product URL. The agreed scope and acceptance criteria are defined in [SPEC.md](SPEC.md).

The current delivery roadmap requires a working web URL when P1 is complete. P2 is the competition-delivery target.

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

Application setup and test commands will be added after the relevant implementation is created and verified. For documentation checks already performed, see [WORKLOG](WORKLOG.md#records). Documentation acceptance is not evidence of a working product.
