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
TEST_FILES=(
  tests/agent-budget.test.ts
)
TEST_CASES=(9)

for source in "${TEST_FILES[@]}" "$GUARD" scripts/verify-soft-budget-mutations.mjs tsconfig.json tsconfig.server.json; do
  test -f "$source" && test ! -L "$source"
  git ls-files --error-unmatch -- "$source" >/dev/null
done
git diff --exit-code HEAD

stage=complete-soft-budget-tests
for index in "${!TEST_FILES[@]}"; do
  source="${TEST_FILES[$index]}"
  printf 'complete-test-file=%s expected-cases=%s\n' "$source" "${TEST_CASES[$index]}"
  "$NODE_BIN" --max-old-space-size=384 --import "./$GUARD" --experimental-transform-types --test --test-timeout=30000 \
    --test-concurrency=1 "$source"
done

stage=soft-budget-mutation-guards
"$NODE_BIN" --max-old-space-size=384 --import "./$GUARD" scripts/verify-soft-budget-mutations.mjs

stage=full-server-and-root-types
"$NODE_BIN" node_modules/typescript/bin/tsc --project tsconfig.server.json --noEmit
"$NODE_BIN" node_modules/typescript/bin/tsc --noEmit

git diff --exit-code HEAD
printf 'soft-budget-offline-verification: PASS sha=%s\n' "$EXPECTED_SHA"
