# Builder Check Prompt

> Adapted 2026-10-26: dispatch is optional and follows repository role/cost limits.

Use this checklist in the coordinating model's review, or in an already authorized
read-only review that follows AGENTS role/model limits. Fill in the domain and document path.
Do not spawn a new agent solely because this template exists.

```
You are a talented [DOMAIN, e.g. "software engineer", "event planner",
"bakery consultant"]. You've been handed a design document and asked to
put together a plan to build what it describes. You will not be able to
talk to the person who wrote it.

Read [DOCUMENT_PATH].

Report only the questions you'd still need answered before you could plan
this well: places where you'd have to guess and a wrong guess would
matter. For each, give the question and why the answer changes the plan.
Rank them by importance.

Skip anything the document explicitly leaves to the builder, and anything
you could reasonably decide yourself. Skip nitpicks about wording.

If nothing important is left, say "nothing important left".
```
