# Defense-in-Depth Validation

> Repository note (2026-10-26): upstream illustrative method, not project evidence.
> Add checks only at necessary owned boundaries; do not redesign architecture,
> duplicate authoritative services or expand permissions to follow this example.

## Overview

When you fix a bug caused by invalid data, adding validation at one place feels sufficient. But that single check can be bypassed by different code paths, refactoring, or mocks.

**Core principle:** Enforce the invariant at the necessary trust/ownership boundaries.
Use defense in depth where evidence shows a bypass; do not duplicate every check
or claim that finite tests make a bug impossible.

## Why Multiple Layers

Single validation: "We fixed the bug"
Multiple layers: "We covered a demonstrated bypass at another necessary boundary"

Different layers catch different cases:
- Entry validation catches most bugs
- Business logic catches edge cases
- Environment guards prevent context-specific dangers
- Debug logging helps when other layers fail

## The Four Layers

### Layer 1: Entry Point Validation
**Purpose:** Reject obviously invalid input at API boundary

```typescript
function createProject(name: string, workingDirectory: string) {
  if (!workingDirectory || workingDirectory.trim() === '') {
    throw new Error('workingDirectory cannot be empty');
  }
  if (!existsSync(workingDirectory)) {
    throw new Error(`workingDirectory does not exist: ${workingDirectory}`);
  }
  if (!statSync(workingDirectory).isDirectory()) {
    throw new Error(`workingDirectory is not a directory: ${workingDirectory}`);
  }
  // ... proceed
}
```

### Layer 2: Business Logic Validation
**Purpose:** Ensure data makes sense for this operation

```typescript
function initializeWorkspace(projectDir: string, sessionId: string) {
  if (!projectDir) {
    throw new Error('projectDir required for workspace initialization');
  }
  // ... proceed
}
```

### Layer 3: Environment Guards
**Purpose:** Prevent dangerous operations in specific contexts

Use an existing, verified workspace-isolation or path-containment facility;
do not treat a lexical string prefix such as `path.startsWith(tmpDir)` as a
security boundary. Similar sibling names and symlinks can escape that assumption.
This reference does not supply a safe filesystem guard. If the target cannot be
shown to stay in the authorized disposable workspace, do not run a mutating
operation there. Prefer source inspection and an already isolated synthetic test.

### Layer 4: Debug Instrumentation
**Purpose:** Capture context for forensics

```typescript
async function gitInit(directory: string) {
  const stack = new Error().stack;
  logger.debug('About to git init', {
    directory,
    cwd: process.cwd(),
    stack,
  });
  // ... proceed
}
```

## Applying the Pattern

When you find a bug:

1. **Trace the data flow** - Where does bad value originate? Where used?
2. **Map all checkpoints** - List every point data passes through
3. **Add necessary validation** - Keep the authoritative check; add a boundary guard only for a demonstrated bypass
4. **Verify the relevant boundary** - Use the minimum necessary authorized synthetic checks

## Example from Session

Bug: Empty `projectDir` caused `git init` in source code

**Data flow:**
1. Test setup → empty string
2. `Project.create(name, '')`
3. `WorkspaceManager.createWorkspace('')`
4. `git init` runs in `process.cwd()`

**Four layers added:**
- Layer 1: `Project.create()` validates not empty/exists/writable
- Layer 2: `WorkspaceManager` validates projectDir not empty
- Layer 3: `WorktreeManager` refuses git init outside tmpdir in tests
- Layer 4: Stack trace logging before git init

**Upstream-reported result:** 1847 tests passed in that historical example.
That is not this repository's evidence and does not prove the bug impossible.

## Key Insight

In the upstream example, multiple layers addressed distinct observed paths:
- Different code paths bypassed entry validation
- Mocks bypassed business logic checks
- Edge cases on different platforms needed environment guards
- Debug logging identified structural misuse

The upstream example needed multiple checks; select only the layers necessary
for this repository's actual invariant and authorization boundary.
