---
name: brainstorming
description: Use for a non-trivial repository feature or behavior change when intent, requirements, constraints, or approach remain materially unclear. Do not reopen settled plans or turn a clear small task into a design ceremony.
---

# Brainstorming

> Adapted 2026-10-26 from obra/superpowers v7.0.1; see [UPSTREAM.md](UPSTREAM.md).
> Narrowed to repository work; visual companion and mandatory framework hand-offs are omitted.

## Repository scope and authority

This is an adapted, optional method for this repository, not a new authority layer.
Follow the applicable [AGENTS.md](../../../AGENTS.md), current user instructions,
SPEC/PLAN/contracts, assigned role/model and cost/verification limits. Do not
install additional skills, spawn extra agents, run broader tests, change permissions,
use real family data or call real models merely because this skill mentions them.
Use the smallest relevant evidence; preserve unrelated work and existing approvals.

## Goal

Understand what the user actually wants and why before building the wrong thing.
Reuse their existing answers and the project's decisions, not just your first guess.

## Workflow

1. **Look before asking.** Read the relevant request, current work-package entry,
   applicable instructions and the smallest connected code surface. Distinguish
   confirmed requirements, your assumptions and unresolved questions.
2. **Size the uncertainty.** If everything material is already clear, proceed
   through the normal repository workflow. Otherwise ask the one question whose
   answer most changes the outcome; do not ask what the repository already answers.
   Prefer a sensible stated assumption for a low-risk, reversible detail.
3. **Explore real alternatives only when needed.** Compare the few approaches
   that fit existing architecture and reusable capabilities. Explain meaningful
   tradeoffs and recommend one. Do not invent alternatives or reopen an approved
   approach for the sake of this method. Material scope, safety or cost decisions
   stay with the authorized decision-maker.
4. **Play back the result concisely.** Capture intent, success criteria, non-goals,
   constraints, chosen approach and remaining uncertainty. Attribute only actual
   user decisions to the user; label your defaults as proposals.
5. **Record only what belongs in the existing destination.** Follow AGENTS document
   responsibilities; reuse the current PLAN/SPEC or requested deliverable instead
   of creating `docs/superpowers/` or a parallel planning system. A chat summary
   is enough when repository rules do not call for a document update.
6. **Resolve material disagreement before implementation.** Existing explicit
   approval remains valid; a new document or repeated confirmation is not required
   for an already authorized clear change. Use the normal project planning and
   implementation process afterward. No separate planning skill is installed or
   required by this adaptation.

## Optional design check

For a genuinely complex design, the coordinating model may use the questions in
[builder-check-prompt.md](builder-check-prompt.md) during its own review or in an
already authorized read-only review. Role/model limits and final-review ownership
still come from AGENTS; this is not an instruction to create a new reviewer.

A throwaway spike needs a clear scope and cost boundary. Label its evidence and
limitations; do not quietly promote it into production or skip necessary checks.

## Red flags

- Asking questions that the existing specification already answers.
- Treating assumptions or a successful prototype as approved requirements.
- Replacing established architecture without a demonstrated gap.
- Forcing a full design document, visual server, new dependency or extra agent
  for a small clear task.
