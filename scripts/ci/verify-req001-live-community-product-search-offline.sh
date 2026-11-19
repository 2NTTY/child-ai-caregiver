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
  tests/req001-live-community-product-search.test.ts
  tests/official-live-pages.test.ts
  tests/library-citation-roundtrip.test.mjs
  tests/search-query-minimization.test.ts
  tests/search-official-evidence.test.ts
  tests/search-review-boundaries.test.ts
  tests/chat-web-sources-copy.test.ts
  tests/knowledge-source-parser.test.ts
  tests/knowledge-ranking.test.ts
  tests/product-agent-execution-contract.test.ts
  tests/agent-review-obligation.test.ts
  tests/chat-delivery-review.test.ts
  tests/req001-timely-news-and-expiry.test.ts
  tests/chat-workspace-view.test.ts
  tests/agent-context-topology.test.ts
  tests/req002-trace-settlement.test.ts
  tests/req002-mixed-repair.test.ts
)
TEST_CASES=(8 2 4 9 16 12 7 15 13 8 17 44 9 1 4 4 3)

for source in "${TEST_FILES[@]}" "$GUARD" "$CONTRACT" \
  tsconfig.json tsconfig.server.json frontend/tsconfig.json \
  src/shared/live-source-citation.ts server/live-source-citation.ts \
  server/live-community-product-search.ts server/product-agent-tools.ts \
  frontend/src/chat-view-model.ts frontend/src/components/chat/chat-copy.ts \
  frontend/src/production/agent-projection.ts \
  frontend/src/components/chat/CitationMarker.tsx \
  frontend/src/components/chat/CitationMarker.web.tsx \
  frontend/src/components/chat/AnswerSources.tsx; do
  test -f "$source" && test ! -L "$source"
  git ls-files --error-unmatch -- "$source" >/dev/null
done
git diff --exit-code HEAD

stage=locked-toolchain
"$NODE_BIN" --input-type=commonjs - <<'NODE'
const assert = require('node:assert/strict');
const lock = require('./package-lock.json');
for (const name of ['typescript', '@google/genai', '@google/adk', 'zod', 'patch-package']) {
  assert.equal(require('./node_modules/' + name + '/package.json').version,
    lock.packages['node_modules/' + name].version, name);
}
NODE

stage=existing-dependency-patches
"$NODE_BIN" node_modules/patch-package/index.js --patch-dir frontend/patches --error-on-fail

stage=req001-live-community-product-search-tests
total_cases=0
for index in "${!TEST_FILES[@]}"; do
  source="${TEST_FILES[$index]}"
  expected="${TEST_CASES[$index]}"
  TAP_FILE="$TMPDIR/req001-live-community-product-search-$index.tap"
  printf 'complete-test-file=%s expected-cases=%s\n' "$source" "$expected"
  "$NODE_BIN" --import "./$GUARD" --experimental-test-module-mocks --test --test-timeout=30000 \
    --test-concurrency=1 --test-reporter=tap "$source" | tee "$TAP_FILE"
  "$NODE_BIN" "$CONTRACT" check "$TAP_FILE" "$expected"
  total_cases=$((total_cases + expected))
done

stage=full-server-root-and-frontend-types
timeout 240s "$NODE_BIN" --max-old-space-size=3072 node_modules/typescript/bin/tsc \
  --project tsconfig.server.json --noEmit --pretty false
timeout 240s "$NODE_BIN" --max-old-space-size=3072 node_modules/typescript/bin/tsc \
  --noEmit --pretty false
timeout 240s "$NODE_BIN" --max-old-space-size=3072 node_modules/typescript/bin/tsc \
  --project frontend/tsconfig.json --noEmit --pretty false

stage=final-source-integrity
git diff --exit-code HEAD
test "$(git rev-parse HEAD)" = "$EXPECTED_SHA"
printf 'PASS candidate=%s complete-test-files=%s cases=%s strict-type-configs=tsconfig.server.json,tsconfig.json,frontend/tsconfig.json\n' \
  "$EXPECTED_SHA" "${#TEST_FILES[@]}" "$total_cases"
