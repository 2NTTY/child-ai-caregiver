---
name: agents-md-improver
description: Audit and improve AGENTS.md files in repositories. Use when user asks to check, audit, update, improve, or fix AGENTS.md files. Scans for all AGENTS.md files, evaluates quality against templates, outputs quality report, then makes targeted updates. Also use when the user mentions "AGENTS.md maintenance" or "project memory optimization".
---

# AGENTS.md Improver

Audit, evaluate, and improve AGENTS.md files across a codebase to ensure Codex has optimal project context.

**This skill can write to AGENTS.md files.** After presenting a quality report and getting user approval, it updates AGENTS.md files with targeted improvements.

## Workflow

### Phase 1: Discovery

Find all AGENTS.md files in the repository:

Use `exec_command` to read/search files and run the Bash examples (Git Bash on Windows), and `apply_patch` for edits.

```bash
find . -name "AGENTS.md" -o -name "AGENTS.override.md" 2>/dev/null | head -50
```

**File Types & Locations:**

| Type | Location | Purpose |
|------|----------|---------|
| Project root | `./AGENTS.md` | Primary project context (checked into git, shared with team) |
| Directory override | `./AGENTS.override.md` | Replaces AGENTS.md in the same directory; not automatically private or gitignored |
| Global defaults | `$CODEX_HOME/AGENTS.md` (default `~/.codex/AGENTS.md`) | User-wide defaults across all projects |
| Package-specific | `./packages/*/AGENTS.md` | Module-level context in monorepos |
| Subdirectory | Any nested location | Feature/domain-specific context |

**Note:** Codex loads global guidance from CODEX_HOME, then walks from the repository root to the working directory. At each level, a non-empty AGENTS.override.md takes precedence over AGENTS.md; at most one file is loaded per directory. Nested files outside that path are not automatically loaded.

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

After user approval, apply changes using `apply_patch`. Preserve existing content structure.

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

When presenting recommendations, remind users:

- **Session learnings**: Explicitly invoke `$revise-agents-md` to propose incorporating session learnings into AGENTS.md; Codex has no equivalent to the Claude `#` shortcut.
- **Keep it concise**: AGENTS.md should be human-readable; dense is better than verbose
- **Actionable commands**: All documented commands should be copy-paste ready
- **Personal preferences**: Codex has no automatically loaded `.claude.local.md` equivalent. Use user-wide guidance in CODEX_HOME; a project AGENTS.override.md replaces the same-directory AGENTS.md and is not automatically gitignored.
- **Global defaults**: Put user-wide preferences in `$CODEX_HOME/AGENTS.md` (default `~/.codex/AGENTS.md`)

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
