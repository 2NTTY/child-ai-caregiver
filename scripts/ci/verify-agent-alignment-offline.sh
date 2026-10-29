#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

stage=preflight
trap 'status=$?; printf "FAIL stage=%s exit=%s\n" "$stage" "$status" >&2; exit "$status"' ERR
fail() { printf '%s\n' "$*" >&2; exit 64; }

# Approved synthetic tests; no network listeners, including loopback.
TEST_FILES=(
  "tests/agent-budget.test.ts"
  "tests/agent-model-gateway.test.ts"
  "tests/agent-runtime-contract.test.ts"
  "tests/agent-runtime.test.ts"
  "tests/agent-durable-budget.test.ts"
  "tests/agent-role-budget.test.ts"
  "tests/chat-delivery-review.test.ts"
  "tests/chat-stop-feedback.test.ts"
  "tests/chat-photo-agent.test.ts"
  "tests/chat-voice-review.test.ts"
  "tests/memory.test.ts"
  "tests/propose-memory-delivery.test.ts"
  "tests/firestore-memory-lifecycle.test.ts"
  "tests/firestore-agent-ledger.test.ts"
  "tests/agent-confirmation-retry.test.ts"
  "tests/product-agent-confirmation-budget.test.ts"
  "tests/product-agent.test.ts"
  "tests/data-compose.test.ts"
  "tests/agent-review-obligation.test.ts"
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

(("${#TEST_FILES[@]}" == 19)) || fail "Expected exactly 19 approved tests."
declare -A seen=()
for test_file in "${TEST_FILES[@]}"; do
  [[ "$test_file" =~ ^tests/[A-Za-z0-9_-]+\.test\.ts$ ]] ||
    fail "Unexpected test path: $test_file"
  [[ -f "$test_file" && ! -L "$test_file" ]] ||
    fail "Missing or symlinked test: $test_file"
  [[ -z "${seen[$test_file]:-}" ]] || fail "Duplicate test: $test_file"
  seen["$test_file"]=1
  git ls-files --error-unmatch -- "$test_file" >/dev/null
done

for config in tsconfig.json tsconfig.server.json frontend/tsconfig.json; do
  test -f "$config"
  git ls-files --error-unmatch -- "$config" >/dev/null
done
test -f frontend/package.json
git diff --exit-code
printf 'offline candidate=%s node=%s\n' "$EXPECTED_SHA" "$("$NODE_BIN" --version)"
sha256sum package-lock.json
printf 'selected-test=%s\n' "${TEST_FILES[@]}"

stage=reviewed-postinstall-patch
"$NODE_BIN" --input-type=commonjs -e '
  const assert = require("node:assert/strict");
  const fs = require("node:fs");
  const root = require("./package.json");
  assert.equal(root.packageManager, "npm@11.8.0");
  assert.equal(root.scripts.postinstall,
    "patch-package --patch-dir frontend/patches --error-on-fail");
  assert.equal(require("./node_modules/typescript/package.json").version, "6.0.3");
  assert.equal(require("./node_modules/patch-package/package.json").version, "8.0.1");
  assert.deepEqual(fs.readdirSync("frontend/patches").sort(),
    ["expo-sharing+57.0.21.patch"]);
'
test "$(git hash-object frontend/patches/expo-sharing+57.0.21.patch)" = \
  "e87f472779b67980d7726d988a41d57476a01f58"
"$NODE_BIN" node_modules/patch-package/index.js \
  --patch-dir frontend/patches --error-on-fail

stage=frontend-typecheck
"$NODE_BIN" node_modules/typescript/bin/tsc \
  --project frontend/tsconfig.json --noEmit --pretty false
stage=shared-typecheck
"$NODE_BIN" node_modules/typescript/bin/tsc \
  --project tsconfig.json --noEmit --pretty false
stage=server-and-test-types
"$NODE_BIN" node_modules/typescript/bin/tsc \
  --project tsconfig.server.json --noEmit --pretty false
stage=selected-synthetic-tests
# Match canonical D acceptance; forced exit does not verify handle cleanup.
"$NODE_BIN" --experimental-test-module-mocks --test --test-force-exit --test-concurrency=1 \
  "${TEST_FILES[@]}"

stage=final-source-integrity
git diff --exit-code
test "$(git rev-parse HEAD)" = "$EXPECTED_SHA"
printf 'PASS candidate=%s selected-tests=%s\n' "$EXPECTED_SHA" "${#TEST_FILES[@]}"
