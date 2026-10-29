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
FRONTEND_TEST_FILES=(
  "tests/child-selection.test.ts"
  "tests/firestore-results-history.test.ts"
  "tests/handover-task-updates.test.ts"
)
AFFECTED_FIXTURE_TEST_FILES=(
  "tests/background-knowledge-maintenance.test.ts"
  "tests/product-agent-durable-cancellation.test.ts"
  "tests/firebase-app.test.ts"
  "tests/firebase-managed-photo-recovery.test.ts"
  "tests/firestore-disclosure.test.ts"
  "tests/firestore-documents-core.test.ts"
  "tests/firestore-native-push-expiration.test.ts"
  "tests/firestore-native-push-ios.test.ts"
  "tests/firestore-photos.test.ts"
  "tests/firestore-voice.test.ts"
  "tests/chat-photo-client.test.ts"
  "tests/native-push-client.test.ts"
)
FILTERED_GREETING_TEST="tests/agent-feedback.test.ts"

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
(("${#FRONTEND_TEST_FILES[@]}" == 3)) || fail "Expected exactly 3 frontend-facing tests."
(("${#AFFECTED_FIXTURE_TEST_FILES[@]}" == 12)) || fail "Expected exactly 12 affected-fixture tests."
declare -A seen=()
for test_file in "${TEST_FILES[@]}" "${FRONTEND_TEST_FILES[@]}" "${AFFECTED_FIXTURE_TEST_FILES[@]}"; do
  [[ "$test_file" =~ ^tests/[A-Za-z0-9_-]+\.test\.ts$ ]] ||
    fail "Unexpected test path: $test_file"
  [[ -f "$test_file" && ! -L "$test_file" ]] ||
    fail "Missing or symlinked test: $test_file"
  [[ -z "${seen[$test_file]:-}" ]] || fail "Duplicate test: $test_file"
  seen["$test_file"]=1
  git ls-files --error-unmatch -- "$test_file" >/dev/null
done
(("${#seen[@]}" == 34)) || fail "Expected exactly 34 unique test files."
[[ -f "$FILTERED_GREETING_TEST" && ! -L "$FILTERED_GREETING_TEST" ]]
[[ -z "${seen[$FILTERED_GREETING_TEST]:-}" ]]
git ls-files --error-unmatch -- "$FILTERED_GREETING_TEST" >/dev/null
grep -Fq 'test("pure greeting drafts must not imply reviewing progress", () => {' "$FILTERED_GREETING_TEST"

for config in tsconfig.json tsconfig.server.json frontend/tsconfig.json tsconfig.frontend-tests.json; do
  [[ -f "$config" && ! -L "$config" ]]
  git ls-files --error-unmatch -- "$config" >/dev/null
done
test -f tests/helpers/frontend-source-loader.mjs
test ! -L tests/helpers/frontend-source-loader.mjs
git ls-files --error-unmatch -- tests/helpers/frontend-source-loader.mjs >/dev/null
test -f frontend/package.json
git diff --exit-code
printf 'offline candidate=%s node=%s\n' "$EXPECTED_SHA" "$("$NODE_BIN" --version)"
sha256sum package-lock.json
printf 'selected-test=%s\n' "${TEST_FILES[@]}"
printf 'frontend-facing-test=%s\n' "${FRONTEND_TEST_FILES[@]}"
printf 'affected-fixture-test=%s\n' "${AFFECTED_FIXTURE_TEST_FILES[@]}"
printf 'filtered-test=%s pattern=pure greeting drafts (not-full-HTTP-suite)\n' "$FILTERED_GREETING_TEST"

stage=reviewed-postinstall-patch
"$NODE_BIN" --input-type=commonjs -e '
  const assert = require("node:assert/strict");
  const fs = require("node:fs");
  const root = require("./package.json");
  assert.equal(root.packageManager, "npm@11.8.0");
  assert.equal(root.scripts.postinstall,
    "patch-package --patch-dir frontend/patches --error-on-fail");
  assert.equal(root.scripts.typecheck,
    "npm run typecheck --workspace frontend && tsc --noEmit && tsc --project tsconfig.server.json && tsc --project tsconfig.frontend-tests.json");
  assert.equal(require("./node_modules/typescript/package.json").version, "6.0.3");
  assert.equal(require("./node_modules/patch-package/package.json").version, "8.0.1");
  assert.deepEqual(fs.readdirSync("frontend/patches").sort(),
    ["expo-sharing+57.0.21.patch"]);
'
test "$(git hash-object frontend/patches/expo-sharing+57.0.21.patch)" = \
  "e87f472779b67980d7726d988a41d57476a01f58"
"$NODE_BIN" node_modules/patch-package/index.js \
  --patch-dir frontend/patches --error-on-fail

stage=type-root-coverage
"$NODE_BIN" --input-type=commonjs - "${FRONTEND_TEST_FILES[@]}" <<'NODE'
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const frontendTests = process.argv.slice(2);
// Exact pre-partition config at 6c4ad79; no older Git object/network is needed.
const baseline = {
  compilerOptions: {
    target: "ES2023", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
    erasableSyntaxOnly: true, noEmit: true, allowImportingTsExtensions: true,
    skipLibCheck: true, types: ["node"],
  },
  include: ["server/**/*.ts", "src/shared/**/*.ts", "tests/**/*.test.ts"],
};
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
assert.deepEqual(read("tsconfig.server.json"), { ...baseline, exclude: frontendTests });
assert.deepEqual(read("tsconfig.frontend-tests.json"), {
  extends: "./tsconfig.server.json",
  compilerOptions: { module: "ESNext", moduleResolution: "Bundler", erasableSyntaxOnly: false },
  include: frontendTests, exclude: [],
});
const host = { ...ts.sys, onUnRecoverableConfigFileDiagnostic: diagnostic => {
  assert.fail(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
} };
const old = ts.parseJsonConfigFileContent(baseline, ts.sys, process.cwd());
const server = ts.getParsedCommandLineOfConfigFile("tsconfig.server.json", {}, host);
const frontend = ts.getParsedCommandLineOfConfigFile("tsconfig.frontend-tests.json", {}, host);
const roots = config => {
  assert.ok(config);
  assert.deepEqual(config.errors, []);
  return [...new Set(config.fileNames.map(file => path.resolve(file)))].sort();
};
const oldRoots = roots(old), serverRoots = roots(server), frontendRoots = roots(frontend);
assert.deepEqual(frontendRoots, frontendTests.map(file => path.resolve(file)).sort());
assert.equal(serverRoots.some(file => frontendRoots.includes(file)), false);
assert.deepEqual([...new Set([...serverRoots, ...frontendRoots])].sort(), oldRoots);
const testCount = files => files.filter(file => file.endsWith(".test.ts")).length;
assert.ok(testCount(serverRoots) > 0);
console.log(`PASS type-root-coverage roots=${oldRoots.length} tests=${testCount(oldRoots)} serverTests=${testCount(serverRoots)} frontendTests=${testCount(frontendRoots)}`);
NODE

stage=frontend-typecheck
"$NODE_BIN" node_modules/typescript/bin/tsc \
  --project frontend/tsconfig.json --noEmit --pretty false
stage=shared-typecheck
"$NODE_BIN" node_modules/typescript/bin/tsc \
  --project tsconfig.json --noEmit --pretty false
stage=server-and-test-types
"$NODE_BIN" node_modules/typescript/bin/tsc \
  --project tsconfig.server.json --noEmit --pretty false
stage=frontend-facing-test-types
"$NODE_BIN" node_modules/typescript/bin/tsc \
  --project tsconfig.frontend-tests.json --noEmit --pretty false
stage=selected-synthetic-tests
# Match canonical D acceptance; forced exit does not verify handle cleanup.
"$NODE_BIN" --experimental-test-module-mocks --test --test-force-exit --test-concurrency=1 \
  "${TEST_FILES[@]}"
stage=frontend-facing-synthetic-tests
"$NODE_BIN" --experimental-test-module-mocks --test --test-force-exit --test-concurrency=1 \
  "${FRONTEND_TEST_FILES[@]}"
stage=affected-fixture-synthetic-tests
"$NODE_BIN" --experimental-test-module-mocks --test --test-force-exit --test-concurrency=1 \
  "${AFFECTED_FIXTURE_TEST_FILES[@]}"
stage=filtered-greeting-test
# The HTTP listener is inside an unselected test body; never run this whole file here.
"$NODE_BIN" --experimental-test-module-mocks --test --test-force-exit --test-concurrency=1 \
  --test-name-pattern='pure greeting drafts' "$FILTERED_GREETING_TEST"

stage=final-source-integrity
git diff --exit-code
test "$(git rev-parse HEAD)" = "$EXPECTED_SHA"
printf 'PASS candidate=%s selected-tests=%s frontend-facing-tests=%s affected-fixture-tests=%s full-test-files=%s filtered-test-files=1\n' \
  "$EXPECTED_SHA" "${#TEST_FILES[@]}" "${#FRONTEND_TEST_FILES[@]}" \
  "${#AFFECTED_FIXTURE_TEST_FILES[@]}" "${#seen[@]}"
