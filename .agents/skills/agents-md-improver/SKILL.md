---
name: agents-md-improver
description: Audit repository AGENTS.md instructions when the user asks to check or improve them. Produce an evidence-backed report and targeted proposed diff; do not modify instruction files merely because this skill is installed.
---

# AGENTS.md Improver

> Adapted 2026-10-26 from Anthropic claude-md-improver (Apache-2.0); see [UPSTREAM.md](UPSTREAM.md).
> Targets repository AGENTS only; removes Claude tooling/global configuration assumptions.

## Repository scope and authority

This is an adapted, optional method for this repository, not a new authority layer.
Follow the applicable [AGENTS.md](../../../AGENTS.md), current user instructions,
SPEC/PLAN/contracts, assigned role/model and cost/verification limits. Do not
install additional skills, spawn extra agents, run broader tests, change permissions,
use real family data or call real models merely because this skill mentions them.
Use the smallest relevant evidence; preserve unrelated work and existing approvals.

Audit, evaluate, and improve AGENTS.md files across a codebase to ensure Codex has optimal project context.

**This skill can write to AGENTS.md files.** After presenting a quality report and getting user approval, it updates AGENTS.md files with targeted improvements.

## Workflow

### Phase 1: Discovery

Start with the root and assigned domain instructions. Locate only in-scope files;
for an explicitly repository-wide audit, list tracked instruction paths without
scanning ignored/private directories:

```bash
git ls-files -- 'AGENTS.md' 'AGENTS.override.md' ':(glob)**/AGENTS.md' ':(glob)**/AGENTS.override.md'
```

**File Types & Locations:**

| Type | Location | Purpose |
|------|----------|---------|
| Project root | `./AGENTS.md` | Primary project context (checked into git, shared with team) |
| Domain/subdirectory | In-scope nested `AGENTS.md` | Additional instructions for that domain |
| Local override, if explicitly in scope | `AGENTS.override.md` | Inspect only if present and authorized; do not create an override |

Follow the repository's own reading and precedence rules. Do not assume every
nested file is automatically loaded, read personal/global instructions for this
audit, or duplicate architecture/PLAN authority into AGENTS.

### Phase 2: Quality Assessment

For each AGENTS.md file, evaluate against quality criteria. See [references/quality-criteria.md](references/quality-criteria.md) for detailed rubrics.

**Quick Assessment Checklist:**

| Criterion | Weight | Check |
|-----------|--------|-------|
| Commands/workflows documented | High | Are build/test/deploy commands present? |
| Architecture clarity | High | Can Codex understand the codebase structure? |
| Non-obvious patterns | Medium | Are gotchas and quirks documented? |
| Conciseness | Medium | No verbose explanations or obvious info? |
| Currency | High | Does it reflect current codebase state? |
| Actionability | High | Are instructions executable, not vague? |

**Quality Scores:**
- **A (90-100)**: Comprehensive, current, actionable
- **B (70-89)**: Good coverage, minor gaps
- **C (50-69)**: Basic info, missing key sections
- **D (30-49)**: Sparse or outdated
- **F (0-29)**: Missing or severely outdated

### Phase 3: Quality Report Output

**ALWAYS output the quality report BEFORE making any updates.**

Format:

```
## AGENTS.md Quality Report

### Summary
- Files found: X
- Average score: X/100
- Files needing update: X

### File-by-File Assessment

#### 1. ./AGENTS.md (Project Root)
**Score: XX/100 (Grade: X)**

| Criterion | Score | Notes |
|-----------|-------|-------|
| Commands/workflows | X/20 | ... |
| Architecture clarity | X/20 | ... |
| Non-obvious patterns | X/15 | ... |
| Conciseness | X/15 | ... |
| Currency | X/15 | ... |
| Actionability | X/15 | ... |

**Issues:**
- [List specific problems]

**Recommended additions:**
- [List what should be added]

#### 2. ./packages/api/AGENTS.md (Package-specific)
...
```

### Phase 4: Targeted Updates

After outputting the quality report, ask user for confirmation before updating.

**Update Guidelines (Critical):**

1. **Propose targeted additions only** - Focus on genuinely useful info:
   - Commands or workflows discovered during analysis
   - Gotchas or non-obvious patterns found in code
   - Package relationships that weren't clear
   - Testing approaches that work
   - Configuration quirks

2. **Keep it minimal** - Avoid:
   - Restating what's obvious from the code
   - Generic best practices already covered
   - One-off fixes unlikely to recur
   - Verbose explanations when a one-liner suffices

3. **Show diffs** - For each change, show:
   - Which AGENTS.md file to update
   - The specific addition (as a diff or quoted block)
   - Brief explanation of why this helps future sessions

**Diff Format:**

```markdown
### Update: ./AGENTS.md

**Why:** Build command was missing, causing confusion about how to run the project.

```diff
+ ## Quick Start
+
+ ```bash
+ npm install
+ npm run dev  # Start development server on port 3000
+ ```
```
```

### Phase 5: Apply Updates

Apply only the approved targeted diff, using the author/role required by AGENTS.
An audit-only request stops at the report. Preserve existing structure and user
rules; do not change model settings, permissions or global instructions. Installing
this skill is not approval to apply any suggested AGENTS change.

## Templates

See [references/templates.md](references/templates.md) for AGENTS.md templates by project type.

## Common Issues to Flag

1. **Stale commands**: Build commands that no longer work
2. **Missing dependencies**: Required tools not mentioned
3. **Outdated architecture**: File structure that's changed
4. **Missing environment setup**: Required env vars or config
5. **Broken test commands**: Test scripts that have changed
6. **Undocumented gotchas**: Non-obvious patterns not captured

## User Tips to Share

- Keep instructions concise and project-specific.
- Link to the existing document owner instead of duplicating architecture or status.
- Distinguish source inspection from commands actually run; never mark a command
  verified based on a mental simulation.
- Repository copies are used after the user syncs this branch/merged commit into
  their own checkout. This installation does not write to their local computer.

## What Makes a Great AGENTS.md

**Key principles:**
- Concise and human-readable
- Actionable commands that can be copy-pasted
- Project-specific patterns, not generic advice
- Non-obvious gotchas and warnings

**Recommended sections** (use only what's relevant):
- Commands (build, test, dev, lint)
- Architecture (directory structure)
- Key Files (entry points, config)
- Code Style (project conventions)
- Environment (required vars, setup)
- Testing (commands, patterns)
- Gotchas (quirks, common mistakes)
- Workflow (when to do what)
