---
name: revise-agents-md
description: Update AGENTS.md with learnings from this session
---

Review this session for learnings about working with Codex in this codebase. Update AGENTS.md with context that would help future Codex sessions be more effective.

## Step 1: Reflect

What context was missing that would have helped Codex work more effectively?
- Bash commands that were used or discovered
- Code style patterns followed
- Testing approaches that worked
- Environment/configuration quirks
- Warnings or gotchas encountered

## Step 2: Find AGENTS.md Files

Use `exec_command` to read/search files and run the Bash example (Git Bash on Windows), and `apply_patch` for edits.

```bash
find . -name "AGENTS.md" -o -name "AGENTS.override.md" 2>/dev/null | head -20
```

Decide where each addition belongs:
- `AGENTS.md` - Team-shared (checked into git)
- `$CODEX_HOME/AGENTS.md` (default `~/.codex/AGENTS.md`) - User-wide personal guidance
- `AGENTS.override.md` - Replaces AGENTS.md in the same directory; not automatically private or gitignored. Codex has no automatically loaded `.claude.local.md` equivalent.

## Step 3: Draft Additions

**Keep it concise** - one line per concept. AGENTS.md is part of the prompt, so brevity matters.

Format: `<command or pattern>` - `<brief description>`

Avoid:
- Verbose explanations
- Obvious information
- One-off fixes unlikely to recur

## Step 4: Show Proposed Changes

For each addition:

```
### Update: ./AGENTS.md

**Why:** [one-line reason]

\`\`\`diff
+ [the addition - keep it brief]
\`\`\`
```

## Step 5: Apply with Approval

Ask if the user wants to apply the changes. Only edit files they approve.
