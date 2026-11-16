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
  tests/search-official-evidence.test.ts
  tests/knowledge-ranking.test.ts
  tests/knowledge-a04.test.ts
  tests/knowledge-runtime.test.ts
  tests/firestore-knowledge.test.ts
  tests/local-knowledge-seed-assessments.test.ts
  tests/chat-delivery-review.test.ts
  tests/product-agent-execution-contract.test.ts
  tests/agent-prompt.test.ts
  tests/agent-prompt-wiring.test.ts
  tests/vertex-tool-contract.test.ts
  tests/agent-runtime.test.ts
  tests/agent-runtime-contract.test.ts
)
TEST_CASES=(12 13 4 6 9 3 44 8 3 4 6 20 17)

for source in "${TEST_FILES[@]}" "$GUARD" "$CONTRACT" tsconfig.json tsconfig.server.json \
  server/knowledge-ranking.ts server/knowledge-store.ts server/firestore-knowledge.ts \
  server/knowledge-retriever.ts server/knowledge-query-context.ts \
  server/chat-delivery-review.ts server/product-agent-tools.ts \
  scripts/local-knowledge-assessments.ts tests/helpers/firestore-domain-memory.ts \
  knowledge/hk-official-seed.json knowledge/local-development-seed.json; do
  test -f "$source" && test ! -L "$source"
  git ls-files --error-unmatch -- "$source" >/dev/null
done
git diff --exit-code HEAD

stage=locked-toolchain
"$NODE_BIN" --input-type=commonjs - <<'NODE'
const assert = require('node:assert/strict');
const lock = require('./package-lock.json');
for (const name of ['typescript', '@google/genai', '@google/adk', 'zod']) {
  assert.equal(require('./node_modules/' + name + '/package.json').version,
    lock.packages['node_modules/' + name].version, name);
}
NODE

stage=search-official-evidence-and-related-tests
total_cases=0
for index in "${!TEST_FILES[@]}"; do
  source="${TEST_FILES[$index]}"
  expected="${TEST_CASES[$index]}"
  TAP_FILE="$TMPDIR/search-evidence-$index.tap"
  printf 'complete-test-file=%s expected-cases=%s\n' "$source" "$expected"
  "$NODE_BIN" --import "./$GUARD" --test --test-timeout=30000 \
    --test-concurrency=1 --test-reporter=tap "$source" | tee "$TAP_FILE"
  "$NODE_BIN" "$CONTRACT" check "$TAP_FILE" "$expected"
  total_cases=$((total_cases + expected))
done

stage=full-server-and-root-types
timeout 240s "$NODE_BIN" --max-old-space-size=3072 node_modules/typescript/bin/tsc \
  --project tsconfig.server.json --noEmit --pretty false
timeout 240s "$NODE_BIN" --max-old-space-size=3072 node_modules/typescript/bin/tsc \
  --noEmit --pretty false

stage=final-source-integrity
git diff --exit-code HEAD
test "$(git rev-parse HEAD)" = "$EXPECTED_SHA"
printf 'PASS candidate=%s complete-test-files=%s cases=%s strict-type-configs=tsconfig.server.json,tsconfig.json\n' \
  "$EXPECTED_SHA" "${#TEST_FILES[@]}" "$total_cases"
