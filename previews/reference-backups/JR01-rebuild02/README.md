# JR01-rebuild02 independent reference backup

This branch-only backup preserves the new BabyTracker v1.13.0 Journal design reference after the original JR01 local archive was lost. It is not the recovered original archive, a product integration, a PR, a merge, or a site deployment.

- Source: [mbentancour/babytracker at bcc0513567c2fba7c935bd61886ce998a2bf1fab](https://github.com/mbentancour/babytracker/tree/bcc0513567c2fba7c935bd61886ce998a2bf1fab).
- Download: [public-safe backup archive](jr01-rebuild02-public-safe-backup.tar.gz), verified by [BACKUP-MANIFEST.json](BACKUP-MANIFEST.json) and [SHA256SUMS](SHA256SUMS).
- Contents: exact reviewed 69-file static payload, pinned upstream sources, deterministic synthetic fixtures, offline harness, tests, local fonts, complete MIT/OFL/dependency notices, and an inspected synthetic desktop capture. See [PACKAGE-CONTENTS.json](PACKAGE-CONTENTS.json).
- Results and limits: [VERIFICATION.json](VERIFICATION.json). Fresh source/font hashes, build and tests passed; bounded desktop Journal navigation, both demo children, retained empty states, local font readiness and repeat layout/text were checked. Mobile, full interactions, accessibility, real network-egress proof, backend/model/account/device integration remain unverified.
- [Complete desktop capture](JOURNAL-REBUILD02-COMPLETE.jpg) is new synthetic-demo evidence, not upstream Journal.png or a claim of pixel fidelity.

The source App starts in Overview; enter Journal using its original navigation. Emma has three original demo notes and Liam two. Milestones/Medications remain empty. All backend/write methods except synthetic config are disabled; storage is memory-only. Do not enter real household data or select real files.

The archive preserves preparation-stage metadata unchanged. In particular, its preparation-time "not yet backed up" and "browser pending" statements are historical; this top-level verification record describes the later bounded check. Nothing asserts full product acceptance.

No private raw browser observations, hosting/extension metadata, internal workspace paths, credentials, internal archive, installed dependencies or package cache are included. The main branch and existing preview site are unchanged.
