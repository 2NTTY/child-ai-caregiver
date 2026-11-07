#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

stage=preflight
trap 'status=$?; printf "FAIL stage=%s exit=%s\n" "$stage" "$status" >&2; exit "$status"' ERR
fail() { printf '%s\n' "$*" >&2; exit 64; }

# Every branch pins its complete suites and exact per-file case counts.
MANIFEST=scripts/ci/summary-progress-tests.json
CONTRACT=scripts/ci/summary-progress-contract.mjs
CONTRACT_TEST=tests/ci/summary-progress-contract.test.mjs
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


stage=suite-manifest
SUITE_LINES="$("$NODE_BIN" "$CONTRACT" list "$MANIFEST")"
mapfile -t TEST_SUITES <<< "$SUITE_LINES"
(("${#TEST_SUITES[@]}" >= 21)) || fail "Expected at least the 21 common complete regression suites."
TEST_FILES=()
TEST_CASES=()
for entry in "${TEST_SUITES[@]}"; do
  IFS=$'\t' read -r source cases <<< "$entry"
  TEST_FILES+=("$source")
  TEST_CASES+=("$cases")
done
for source in "${TEST_FILES[@]}" "$MANIFEST" "$CONTRACT" "$CONTRACT_TEST" tsconfig.server.json; do
  [[ -f "$source" && ! -L "$source" ]] || fail "Missing or symlinked source: $source"
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
"$NODE_BIN" --max-old-space-size=3072 node_modules/typescript/bin/tsc --project tsconfig.server.json --noEmit --pretty false

stage=ci-contract-tests
TAP_FILE="$TMPDIR/summary-progress-contract.tap"
"$NODE_BIN" --test --test-timeout=30000 --test-reporter=tap "$CONTRACT_TEST" | tee "$TAP_FILE"
"$NODE_BIN" "$CONTRACT" check "$TAP_FILE" 6

stage=complete-related-tests
# Complete files run serially; every file must produce its own exact, all-pass totals.
# Never filter tests or force exit. Pipefail preserves process and timeout failures.
for index in "${!TEST_FILES[@]}"; do
  source="${TEST_FILES[$index]}"
  TAP_FILE="$TMPDIR/summary-progress-$index.tap"
  printf 'complete-test-file=%s expected-cases=%s\n' "$source" "${TEST_CASES[$index]}"
  "$NODE_BIN" --experimental-test-module-mocks --test --test-timeout=30000 \
    --test-concurrency=1 --test-reporter=tap "$source" | tee "$TAP_FILE"
  "$NODE_BIN" "$CONTRACT" check "$TAP_FILE" "${TEST_CASES[$index]}"
done

stage=package-invariant-guard
for guard in scripts/verify-*-mutations.mjs; do
  if [[ -f "$guard" ]]; then
    printf 'package-invariant-guard=%s\n' "$guard"
    git ls-files --error-unmatch -- "$guard" >/dev/null
    "$NODE_BIN" "$guard"
  fi
done

stage=final-source-integrity
git diff --exit-code HEAD
test "$(git rev-parse HEAD)" = "$EXPECTED_SHA"
printf 'PASS candidate=%s complete-test-files=%s strict-type-config=tsconfig.server.json\n' \
  "$EXPECTED_SHA" "${#TEST_FILES[@]}"
