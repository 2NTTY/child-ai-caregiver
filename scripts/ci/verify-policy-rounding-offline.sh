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
  tests/agent-policy-rounding-alerts.test.ts
  tests/personal-model-settings.test.ts
  tests/admin-web.test.ts
  tests/model-settings-client.test.ts
  tests/model-settings-v3.test.ts
  frontend/scripts/model-settings-form.test.mjs
)

for source in "${TEST_FILES[@]}" "$GUARD" scripts/verify-soft-budget-mutations.mjs scripts/verify-policy-rounding-mutations.mjs tsconfig.json tsconfig.server.json frontend/tsconfig.json; do
  test -f "$source" && test ! -L "$source"
  git ls-files --error-unmatch -- "$source" >/dev/null
done
git diff --exit-code HEAD

stage=policy-rounding-tests
for source in "${TEST_FILES[@]}"; do
  "$NODE_BIN" --max-old-space-size=384 --import "./$GUARD" --experimental-transform-types --test --test-timeout=30000 \
    --test-concurrency=1 "$source"
done

stage=policy-mutation-guards
"$NODE_BIN" --max-old-space-size=384 --import "./$GUARD" scripts/verify-soft-budget-mutations.mjs
"$NODE_BIN" --max-old-space-size=384 --import "./$GUARD" scripts/verify-policy-rounding-mutations.mjs

stage=full-types
"$NODE_BIN" node_modules/typescript/bin/tsc --project tsconfig.server.json --noEmit
"$NODE_BIN" node_modules/typescript/bin/tsc --noEmit
"$NODE_BIN" node_modules/typescript/bin/tsc --project frontend/tsconfig.json --noEmit

git diff --exit-code HEAD
printf 'policy-rounding-offline-verification: PASS sha=%s\n' "$EXPECTED_SHA"
