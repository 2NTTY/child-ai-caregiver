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
  tests/req005-acceptance-scenarios.test.ts
  tests/agent-context-window.test.ts
  tests/agent-context-topology.test.ts
  tests/initial-conversation-summary.test.ts
  tests/personal-model-settings.test.ts
  tests/agent-durable-ai-usage.test.ts
)

for source in "${TEST_FILES[@]}" "$GUARD" tsconfig.json tsconfig.server.json frontend/tsconfig.json; do
  test -f "$source" && test ! -L "$source"
  git ls-files --error-unmatch -- "$source" >/dev/null
done
git diff --exit-code HEAD

stage=req005-closeout-tests
for source in "${TEST_FILES[@]}"; do
  "$NODE_BIN" --max-old-space-size=384 --import "./$GUARD" --experimental-transform-types --test --test-timeout=30000 \
    --test-concurrency=1 "$source"
done

stage=full-types
"$NODE_BIN" node_modules/typescript/bin/tsc --project tsconfig.server.json --noEmit
"$NODE_BIN" node_modules/typescript/bin/tsc --noEmit
"$NODE_BIN" node_modules/typescript/bin/tsc --project frontend/tsconfig.json --noEmit

git diff --exit-code HEAD
printf 'req005-closeout-offline-verification: PASS sha=%s\n' "$EXPECTED_SHA"
