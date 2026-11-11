#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

stage=preflight
trap 'status=$?; printf "FAIL stage=%s exit=%s\n" "$stage" "$status" >&2; exit "$status"' ERR

test "$(id -u)" -ne 0
test -n "${EXPECTED_SHA:-}"
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]]
test "$(git rev-parse HEAD)" = "$EXPECTED_SHA"
test -n "${PARENT_NETNS:-}"
test "$(readlink /proc/self/ns/net)" != "$PARENT_NETNS"
test "$(ip -o link show | wc -l)" -eq 1
ip -o link show lo | grep -Eq '^[0-9]+: lo:.*state DOWN'
test -z "$(ip -4 route show table all)"
test -z "$(ip -6 route show table all)"
grep -Eq '^NoNewPrivs:[[:space:]]+1$' /proc/self/status
awk '
  /^Cap(Inh|Prm|Eff|Bnd|Amb):/ {
    if ($2 != "0000000000000000") bad=1
    count++
  }
  END { exit (bad || count != 5) }
' /proc/self/status
test "${NODE_BIN:0:1}" = "/"
test "$("$NODE_BIN" --version)" = "v24.22.1"

CONTRACT=scripts/ci/summary-progress-contract.mjs
TEST_FILE=tests/agent-context-compaction.test.ts
MUTATION_SCRIPT=scripts/verify-compaction-mutations.mjs
EXPECTED_CASES=12

for source in "$TEST_FILE" "$MUTATION_SCRIPT" "$CONTRACT" tsconfig.server.json server/context-compactor.ts server/agent-runtime.ts; do
  test -f "$source" && test ! -L "$source"
  git ls-files --error-unmatch -- "$source" >/dev/null
done
git diff --exit-code HEAD

stage=locked-toolchain
"$NODE_BIN" --input-type=commonjs - <<'NODE'
const assert = require('node:assert/strict');
const lock = require('./package-lock.json');
for (const name of ['typescript', '@google/adk', 'zod']) {
  assert.equal(require('./node_modules/' + name + '/package.json').version,
    lock.packages['node_modules/' + name].version, name);
}
NODE

stage=complete-compaction-tests
TAP_FILE="$TMPDIR/compaction-tests.tap"
printf 'complete-test-file=%s expected-cases=%s\n' "$TEST_FILE" "$EXPECTED_CASES"
"$NODE_BIN" --test --test-timeout=30000 \
  --test-concurrency=1 --test-reporter=tap "$TEST_FILE" | tee "$TAP_FILE"
"$NODE_BIN" "$CONTRACT" check "$TAP_FILE" "$EXPECTED_CASES"

stage=compaction-mutations
"$NODE_BIN" "$MUTATION_SCRIPT"

stage=full-server-types
timeout 180s "$NODE_BIN" node_modules/typescript/bin/tsc \
  --project tsconfig.server.json --noEmit --pretty false

stage=final-source-integrity
git diff --exit-code HEAD
test "$(git rev-parse HEAD)" = "$EXPECTED_SHA"
printf 'PASS candidate=%s complete-test-files=1 cases=11 strict-type-config=tsconfig.server.json\n' "$EXPECTED_SHA"
