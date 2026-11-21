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
  tests/req008-acceptance-closeout.test.ts
  tests/specialist-preview-wiring.test.mjs
  tests/req008-specialist-artifact-renderer.test.ts
  tests/req008-context-and-blindspot-discovery.test.ts
  tests/req008-highrisk-policy-and-cleanup.test.ts
  tests/req008-context-scope.test.ts
  tests/data-compose.test.ts
  tests/family-document-workflows.test.ts
  tests/handover-document-export.test.ts
  tests/agent-document-confirmation.test.ts
  tests/agent-document-receipts.test.ts
  tests/agent-document-source-quote.test.ts
  tests/chat-delivery-review.test.ts
  tests/agent-review-obligation.test.ts
  tests/product-agent-execution-contract.test.ts
  tests/agent-budget.test.ts
  tests/firestore-erasure-export.test.ts
  tests/firestore-restore.test.ts
  tests/firebase-recovery-operator.test.ts
  tests/firestore-summary-erasure-cleanup.test.ts
)
TEST_CASES=(12 5 11 9 9 6 14 18 1 1 1 1 44 17 8 9 1 7 7 3)

for source in "${TEST_FILES[@]}" "$GUARD" "$CONTRACT" \
  tsconfig.json tsconfig.server.json frontend/tsconfig.json \
  src/shared/specialist-artifact.ts \
  src/shared/product-agent.ts \
  src/shared/product-agent-result.ts \
  src/client/product-agent-api.ts \
  server/specialist-artifact-pdf-worker.ts \
  server/specialist-artifact-renderer.ts \
  server/specialist-artifact-agent.ts \
  server/firestore-agent-documents.ts \
  server/firestore-product-agent-store.ts \
  server/product-agent-store.ts \
  server/product-agent-capabilities.ts \
  server/product-agent-tools.ts \
  server/product-agent.ts \
  server/product-agent-api.ts \
  frontend/src/agent-view-model.ts \
  frontend/src/production/agent-projection.ts \
  frontend/src/components/agent/AgentRunView.tsx \
  frontend/src/production/ProductionProvider.tsx \
  frontend/src/platform/specialist-artifact-preview.ts \
  frontend/src/platform/specialist-artifact-preview.native.ts \
  frontend/src/platform/specialist-artifact-preview-contract.ts \
  PLAN.md docs/REQUIREMENTS_BACKLOG.md WORKLOG.md; do
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

stage=req008-acceptance-closeout-tests
total_cases=0
for index in "${!TEST_FILES[@]}"; do
  source="${TEST_FILES[$index]}"
  expected="${TEST_CASES[$index]}"
  TAP_FILE="$TMPDIR/req008-closeout-$index.tap"
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
