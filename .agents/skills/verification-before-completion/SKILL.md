---
name: verification-before-completion
description: Use before claiming a change is fixed, verified, complete, or ready for a PR/merge. Match each claim to observed evidence for the relevant final version, without automatically rerunning unrelated or costly checks.
---

# Verification Before Completion

> Adapted 2026-10-26 from obra/superpowers v7.0.1; see [UPSTREAM.md](UPSTREAM.md).
> Keeps evidence-before-claims while respecting existing valid evidence and bounded verification.

## Repository scope and authority

This is an adapted, optional method for this repository, not a new authority layer.
Follow the applicable [AGENTS.md](../../../AGENTS.md), current user instructions,
SPEC/PLAN/contracts, assigned role/model and cost/verification limits. Do not
install additional skills, spawn extra agents, run broader tests, change permissions,
use real family data or call real models merely because this skill mentions them.
Use the smallest relevant evidence; preserve unrelated work and existing approvals.

## Core principle

Evidence before claims. A plausible implementation, a previous version's pass,
or an agent's summary alone does not establish that the final change works.

## Gate

1. **Identify the claim and scope.** What behavior, revision and environment are
   you about to describe? What evidence is sufficient for that claim?
2. **Check existing evidence.** Reuse it only when the relevant code, inputs and
   environment have not invalidated it. Name that evidence and its limits; do not
   relabel an old run as a new run.
3. **Run only missing necessary authorized checks.** Use the repository's focused
   command and approval rules. A linter cannot substitute for a behavioral test,
   and a browser preview cannot substitute for real-device acceptance.
4. **Read the actual result.** Inspect exit status and relevant output; distinguish
   pass, failure, blocked, never run and manual acceptance still pending.
5. **Review the final diff.** Verify the claimed files/revision and required
   requirements directly. Delegated work still needs the coordinating model's
   review; a summary is not a substitute for the important diff and evidence.
6. **State only what follows.** A narrow check proves only its stated scope.
   If a required stage is missing, say so instead of marking the task complete.

## Examples of adequate claims

- "The focused parser regression passed on commit X; the full suite was not run."
- "The existing export evidence remains applicable; this edit changes prose only."
- "The patch is implemented, but the required device test is still pending."
- "The local check passed; remote CI and merge eligibility are not yet established."

## Never infer

- Green lint → build passes.
- One passing test → every requirement passed.
- A successful local commit → remote branch updated.
- Empty CI/status output → required checks passed.
- A merged PR or deployed preview → product/user acceptance passed.
- Missing credentials, unavailable tools or an old result → permission to bypass a gate.

Before publication or merge, verify the exact remote revision and applicable
required checks through the normal repository workflow. This skill grants no
merge/deployment authority and creates no forced recurring test loop.
