---
name: test-driven-development
description: Use when an authorized behavior change or bug fix needs a focused executable regression. Apply red-green-refactor within the repository's test scope, cost and safety limits; not a blanket requirement to run the entire suite.
---

# Test-Driven Development

> Adapted 2026-10-26 from obra/superpowers v7.0.1; see [UPSTREAM.md](UPSTREAM.md).
> Retains red-green-refactor; removes automatic full-suite runs and destructive restart rules.

## Repository scope and authority

This is an adapted, optional method for this repository, not a new authority layer.
Follow the applicable [AGENTS.md](../../../AGENTS.md), current user instructions,
SPEC/PLAN/contracts, assigned role/model and cost/verification limits. Do not
install additional skills, spawn extra agents, run broader tests, change permissions,
use real family data or call real models merely because this skill mentions them.
Use the smallest relevant evidence; preserve unrelated work and existing approvals.

## Core method

Write a small test for the intended behavior, observe the expected failure, make
the smallest justified change, then observe the test pass. A test that passes
before the change does not demonstrate that it detects the regression.

Use this when a focused test is needed to establish correctness. Reuse valid
existing evidence and the project's minimum necessary verification rules. A
text-only/configuration change may need a structural check instead of a new unit
test. Do not manufacture tests merely to meet a count.

## Red → green → refactor

1. **Define the assertion.** Name the production behavior and the specific defect
   the test would detect. Use the existing test framework and local conventions.
   Read [writing-good-tests.md](writing-good-tests.md) when writing/changing a test.
2. **Observe red.** Run the authorized focused command. Confirm it fails for the
   expected missing/incorrect behavior, not syntax, missing tools or setup errors.
   Preserve that evidence; do not change the assertion merely to obtain a pass.
3. **Implement minimally.** Fix the cause with no unrelated refactor or speculative
   abstraction. Keep mocks at external boundaries when real calls are unsafe,
   expensive or not authorized; do not assert only that the mock returned its own data.
4. **Observe green.** Re-run the same relevant check and any additionally necessary,
   authorized affected checks. Read exit status and failures. Focused checks do not
   imply that the full product suite passed.
5. **Refactor only if necessary.** Keep behavior and scope unchanged; recheck affected
   behavior after the final edit. Stop when the required evidence is sufficient.

## Existing implementation and failures

- Never delete or reset existing/user/other-agent work to recreate a test-first
  history. For code already present, add the necessary regression and report whether
  red was actually observed. An isolated temporary comparison may be used only
  within the authorized test scope and without changing the active checkout.
- Do not run bare `npm test`, integration/E2E, live services, real models or a deep
  suite simply because a focused test passed. AGENTS governs required scope and
  approvals; if an essential check is blocked, report it as unverified.
- On an acceptance failure, stop that batch and preserve evidence as required by
  AGENTS. Report unrelated/pre-existing failures without silently fixing them.
- Unresolved method, architecture or safety questions return to the coordinating
  model. Do not extend retries or redesign the system to make a test pass.

## Completion evidence

Report the behavior covered, exact command and tested revision, observed red/green
results, and any failures or unrun checks. Do not claim a retroactively added test
was written first. See [verification-before-completion](../verification-before-completion/SKILL.md).
