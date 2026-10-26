---
name: requesting-code-review
description: Use when preparing a meaningful change or PR for review, especially before merge. Provide exact scope, requirements and revision evidence; reviewer delegation and final acceptance remain governed by AGENTS.
---

# Requesting Code Review

> Adapted 2026-10-26 from obra/superpowers v7.0.1; see [UPSTREAM.md](UPSTREAM.md).
> Removes mandatory per-task subagents and preserves the coordinating model's final review.

## Repository scope and authority

This is an adapted, optional method for this repository, not a new authority layer.
Follow the applicable [AGENTS.md](../../../AGENTS.md), current user instructions,
SPEC/PLAN/contracts, assigned role/model and cost/verification limits. Do not
install additional skills, spawn extra agents, run broader tests, change permissions,
use real family data or call real models merely because this skill mentions them.
Use the smallest relevant evidence; preserve unrelated work and existing approvals.

## Prepare a reviewable handoff

1. Establish the correct checkout, clean/dirty state, exact base and head, plus any
   relevant open PR. Do not assume `HEAD~1` is the task base or that the default
   branch is named `main` (this repository uses `master`).
2. State the requested outcome, changed paths, constraints, non-goals, verification
   performed and known gaps. Reference precise requirement sections, not an entire
   conversation dump.
3. Use [code-reviewer.md](code-reviewer.md) as a read-only checklist or handoff
   template. The coordinating model decides whether an allowed independent agent
   is worthwhile. This skill neither creates a new role nor changes a model/effort,
   cumulative agent limit, permission, or review owner.
4. Review important source/diff and evidence directly. Required independent review
   remains required where the user's workflow says so; unavailable review is a
   blocker to report, not a reason to invent approval.
5. Resolve material findings within the assigned scope. Challenge incorrect
   findings with evidence; defer optional polish instead of expanding the task.
6. After relevant corrections, recheck the affected behavior and ask the existing
   reviewer/coordinator to confirm closure. Do not start an endless chain of fresh
   reviewers. The coordinating model owns the final acceptance decision.

## Review priorities

- Requirement/contract alignment, safety and authority boundaries.
- Actual correctness, regressions, data isolation and recoverability.
- Adequacy and limits of evidence; not arbitrary coverage or stylistic preferences.
- Existing reusable capabilities before unnecessary custom frameworks.

A technical "ready" verdict is not a GitHub approval, completed required CI,
permission to merge, or proof of deployment. Follow normal branch protection and
publication rules; never force-push or bypass a check because review passed.
