# Pure S1 lifecycle observation unit — Fix01

This is a small **source-only subset**, not an SSR application, server entry point,
build target, or runnable preview. It preserves the reviewed lifecycle observer
and its self-contained synthetic tests without changing any source/test bytes.

## Included scope

- `src/ssr-lifecycle.mjs`: a dependency-free observer for one Original or Harbour
  `/tasks` lifecycle. It tracks binding/owner identity, explicit disposal, genuine
  cancellation Promise settlement, and permanent observation failures.
- `tests/lifecycle.test.mjs` and `tests/fix01.test.mjs`: synthetic lifecycle and
  correction controls, including disposer/query-client replacement and accessors.
- `tests/synthetic-helpers.mjs`: in-memory test doubles; no family data or real
  service responses are included.

The `SSR` names describe the intended observation boundary, not proof that a
renderer or native owner has run. Tests using the word “native” pass synthetic
objects into the observer; they do not load production Owner classes or an SDK.
This unit is not a security sandbox. Its finite ordinary-object boundary checks
do not protect against arbitrary hostile Proxies, global monkeypatching or
unobserved transient mutation. It does not provide a host deadline or isolation.

## Self-contained synthetic checks

The test files use only local included files and Node built-ins. They need no
package install, dependencies, private input paths, renderer, or network access.
An independent relocated-package run on 2026-11-01 used pinned Node 24.22.1
and experimental VM modules. It ran only these two selected synthetic test files:

```sh
node --max-old-space-size=384 --experimental-vm-modules --test \
  --test-concurrency=1 tests/lifecycle.test.mjs tests/fix01.test.mjs
```

`vm.SourceTextModule` evaluates only the included pure observer in a synthetic
context. `Response`, `Promise`, and `structuredClone` are Node globals. Test
fetch/timer names refer to in-memory doubles; the tests do not call real network
or timer APIs.

**Independent selected-unit result: 27/27 PASS**, exit 0, approximately 0.265 s
supervised wall time, with no timeout, TERM or KILL. The four included code/test
files matched the reviewed donor bytes; the public-safety and dependency-closure
checks also passed. `PROVENANCE.json` records the exact result and evidence hashes.
Raw private evidence is not included.

This final copy changes only the two metadata documents and preserves the four
tested files and their relative layout exactly. Tests were not rerun for that
metadata-only copy. This is a selected pure-unit result, not the broader S1 suite,
real SSR, SDK/React, TypeScript, build/export or browser acceptance.

## Provenance and relocation

The four source/test files are byte-identical to their S1 Fix01 donor files and
retain their `src/` and `tests/` relationships. `PROVENANCE.json` records hashes,
roles, the sealed donor packet/review identities and the public base commit.
No source behavior, imports or fixture contents were rewritten. The two metadata
documents record the independent pure-unit review; their exact final bytes are
reviewed separately. This document does not assert that a remote publication has
occurred.

The earlier S1 review allowed only the scoped inert correction. The later public
unit review additionally checked the selected relocated code, synthetic tests,
public safety and dependency closure. Neither review admits real SSR execution
or broader application acceptance. The observer continues to report readiness
and host-isolation flags as false.

## Deliberately excluded

The projector, source pins, projection data, native C source trees, server entry
template, source-dependent projection/reviewer tests, raw review evidence,
receipts, logs, backups, and environment diagnostics are not part of this unit.
In particular, the server entry template still requires separately reviewed
renderer attachment and is not represented as dependency-closed here.

This additive tooling directory does not replace the existing application source
checkpoint or the previously published normal-tasks tooling. No TypeScript,
React/SDK, real SSR, browser, build/export, or site-deployment result is claimed.
