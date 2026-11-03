#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

stage=preflight
trap 'status=$?; printf "FAIL stage=%s exit=%s\n" "$stage" "$status" >&2; exit "$status"' ERR
fail() { printf '%s\n' "$*" >&2; exit 64; }

# Complete related synthetic suites; no provider, service, or loopback access.
TEST_FILES=(
  "tests/summary-progress.test.ts"
  "tests/agent-runtime.test.ts"
  "tests/agent-model-gateway.test.ts"
  "tests/firestore-summary-batches.test.ts"
  "tests/firestore-memory-lifecycle.test.ts"
  "tests/memory.test.ts"
  "tests/private-summary-contract.test.ts"
  "tests/summary-prompt-contract.test.ts"
  "tests/agent-durable-ai-usage.test.ts"
  "tests/agent-durable-budget.test.ts"
  "tests/agent-native-session.test.ts"
  "tests/agent-owned-session-cleanup.test.ts"
  "tests/avatar-runtime.test.ts"
  "tests/handover-attachment-pipeline.test.ts"
  "tests/firestore-voice.test.ts"
  "tests/firestore-restore-codec.test.ts"
  "tests/firestore-restore.test.ts"
  "tests/firestore-restore-voice-relations.test.ts"
)
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


(("${#TEST_FILES[@]}" == 18)) || fail "Expected exactly 18 complete related test files."
declare -A seen=()
for source in "${TEST_FILES[@]}" tsconfig.server.json; do
  [[ "$source" == tsconfig.server.json || "$source" =~ ^tests/[A-Za-z0-9_-]+\.test\.ts$ ]] || fail "Unexpected source path: $source"
  [[ -f "$source" && ! -L "$source" ]] || fail "Missing or symlinked source: $source"
  [[ -z "${seen[$source]:-}" ]] || fail "Duplicate source: $source"
  seen["$source"]=1
  git ls-files --error-unmatch -- "$source" >/dev/null
done
git diff --exit-code HEAD
printf 'offline candidate=%s node=%s\n' "$EXPECTED_SHA" "$("$NODE_BIN" --version)"
sha256sum package-lock.json
printf 'complete-test-file=%s\n' "${TEST_FILES[@]}"
printf 'strict-type-config=tsconfig.server.json (unchanged server/shared/test roots)\n'

stage=locked-toolchain
"$NODE_BIN" --input-type=commonjs - <<'NODE'
const assert = require('node:assert/strict');
const lock = require('./package-lock.json');
assert.equal(require('./package.json').packageManager, 'npm@11.8.0');
assert.equal(lock.lockfileVersion, 3);
for (const name of ['typescript', '@google/adk', '@google/genai', 'zod', 'yazl', 'yauzl']) {
  assert.equal(require('./node_modules/' + name + '/package.json').version,
    lock.packages['node_modules/' + name].version, name);
}
NODE

stage=server-shared-and-test-types
"$NODE_BIN" node_modules/typescript/bin/tsc --project tsconfig.server.json --noEmit --pretty false

stage=complete-related-tests
# Timeout fails a stalled test; never force exit or filter out individual cases.
TAP_FILE="$TMPDIR/summary-progress-tests.tap"
"$NODE_BIN" --experimental-test-module-mocks --test --test-timeout=30000 \
  --test-concurrency=1 --test-reporter=tap "${TEST_FILES[@]}" | tee "$TAP_FILE"

stage=complete-test-totals
"$NODE_BIN" --input-type=commonjs - "$TAP_FILE" <<'NODE'
const assert = require('node:assert/strict');
const output = require('node:fs').readFileSync(process.argv[2], 'utf8');
const entries = [...output.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) ([0-9]+)$/gm)]
  .map(([, name, count]) => [name, Number(count)]);
assert.equal(entries.length, 6, 'Require exactly one complete TAP summary');
const totals = Object.fromEntries(entries);
assert.equal(Object.keys(totals).length, 6, 'Require every TAP counter');
assert.equal(totals.tests, 162, 'Run every declared regression case');
assert.equal(totals.pass, totals.tests);
for (const name of ['fail', 'cancelled', 'skipped', 'todo']) assert.equal(totals[name], 0, name);
console.log('PASS complete-test-totals ' + JSON.stringify(totals));
NODE

stage=final-source-integrity
git diff --exit-code HEAD
test "$(git rev-parse HEAD)" = "$EXPECTED_SHA"
printf 'PASS candidate=%s complete-test-files=%s strict-type-config=tsconfig.server.json\n' \
  "$EXPECTED_SHA" "${#TEST_FILES[@]}"
