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

GUARD=frontend/scripts/family-cleanup-network-guard.mjs
CONTRACT=scripts/ci/summary-progress-contract.mjs
TEST_FILES=(
  tests/growth-profile-evidence.test.ts
  frontend/scripts/growth-profile-evidence.test.mjs
  frontend/src/production/growth-read.test.mts
  frontend/scripts/growth-timeline-order.test.mjs
)
TEST_CASES=(10 2 17 4)
for source in "${TEST_FILES[@]}" "$GUARD" "$CONTRACT" frontend/tsconfig.json tsconfig.json tsconfig.server.json; do
  test -f "$source" && test ! -L "$source"
  git ls-files --error-unmatch -- "$source" >/dev/null
done
git diff --exit-code HEAD

stage=locked-toolchain
"$NODE_BIN" --input-type=commonjs - <<'NODE'
const assert = require('node:assert/strict');
const lock = require('./package-lock.json');
for (const name of ['typescript', 'react', 'react-dom', 'react-hook-form', 'zod', '@google-cloud/firestore',
  'patch-package', '@invertase/react-native-apple-authentication', '@react-native-google-signin/google-signin']) {
  assert.equal(require('./node_modules/' + name + '/package.json').version,
    lock.packages['node_modules/' + name].version, name);
}
NODE

# Lifecycle scripts stay disabled during installation. Apply only the existing,
# reviewed repository patches here, without network or credentials.
stage=existing-dependency-patches
"$NODE_BIN" node_modules/patch-package/index.js --patch-dir frontend/patches --error-on-fail

stage=complete-growth-profile-evidence-tests
for index in "${!TEST_FILES[@]}"; do
  source="${TEST_FILES[$index]}"
  TAP_FILE="$TMPDIR/growth-profile-evidence-$index.tap"
  printf 'complete-test-file=%s expected-cases=%s\n' "$source" "${TEST_CASES[$index]}"
  "$NODE_BIN" --max-old-space-size=384 --import "./$GUARD" --experimental-transform-types --test --test-timeout=30000 \
    --test-concurrency=1 --test-reporter=tap "$source" | tee "$TAP_FILE"
  "$NODE_BIN" "$CONTRACT" check "$TAP_FILE" "${TEST_CASES[$index]}"
done

stage=full-frontend-types
timeout 180s "$NODE_BIN" --max-old-space-size=1536 node_modules/typescript/bin/tsc \
  --project frontend/tsconfig.json --noEmit --pretty false

stage=full-root-types
timeout 180s "$NODE_BIN" --max-old-space-size=1536 node_modules/typescript/bin/tsc \
  --project tsconfig.json --noEmit --pretty false

stage=full-server-types
timeout 240s "$NODE_BIN" --max-old-space-size=3072 node_modules/typescript/bin/tsc \
  --project tsconfig.server.json --noEmit --pretty false

stage=final-source-integrity
git diff --exit-code HEAD
test "$(git rev-parse HEAD)" = "$EXPECTED_SHA"
printf 'PASS candidate=%s complete-test-files=4 cases=33 strict-type-configs=frontend/tsconfig.json,tsconfig.json,tsconfig.server.json\n' "$EXPECTED_SHA"
