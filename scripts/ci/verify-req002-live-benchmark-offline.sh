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
  tests/req002-live-benchmark-and-disconnect.test.ts
  tests/req002-harness-boundaries.test.ts
  tests/search-official-evidence.test.ts
  tests/knowledge-ranking.test.ts
  tests/knowledge-a04.test.ts
  tests/knowledge-runtime.test.ts
  tests/local-knowledge-seed-assessments.test.ts
  tests/search-query-minimization.test.ts
  tests/agent-prompt.test.ts
  tests/agent-prompt-wiring.test.ts
  tests/agent-runtime.test.ts
  tests/agent-runtime-contract.test.ts
  tests/chat-recovered-draft.test.ts
  tests/chat-web-sources-copy.test.ts
  tests/chat-busy-stop-feedback.test.ts
  tests/chat-stop-feedback.test.ts
  tests/agent-work-continuation-recovery.test.ts
  tests/pr608-review-regressions.test.mjs
  tests/search-review-boundaries.test.ts
  tests/agent-review-obligation.test.ts
  tests/chat-delivery-review.test.ts
  tests/agent-budget.test.ts
  tests/product-agent-execution-contract.test.ts
  tests/req002-schema-and-trace.test.ts
  tests/req002-trace-settlement.test.ts
  tests/initial-conversation-summary.test.ts
  tests/agent-observer.test.ts
  tests/agent-model-gateway.test.ts
  tests/personal-compatible-provider.test.ts
  tests/data-compose.test.ts
  tests/background-knowledge-model.test.ts
  tests/knowledge-pdf-windows.test.ts
  tests/agent-durable-budget.test.ts
  tests/p2-a06-background-scope.test.ts
  tests/p2-a06-continuation.test.ts
  tests/confirmed-fact-recall.test.ts
  tests/req002-batch-reuse-and-repair.test.ts
  tests/req002-reuse-policy.test.ts
  tests/req002-mixed-repair.test.ts
  tests/chat-workspace-view.test.ts
  tests/agent-context-topology.test.ts
)
TEST_CASES=(6 9 16 13 4 6 3 9 3 5 21 17 3 7 1 2 3 11 12 17 44 9 8 13 4 6 4 18 3 14 7 2 4 1 2 3 10 9 3 1 4)

for source in "${TEST_FILES[@]}" "$GUARD" "$CONTRACT" \
  tsconfig.json tsconfig.server.json frontend/tsconfig.json \
  server/req002-acceptance-harness.ts \
  scripts/lib/req002-acceptance-runner.ts \
  scripts/verify-req002-live.mjs; do
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

stage=req002-live-benchmark-and-regression-tests
total_cases=0
for index in "${!TEST_FILES[@]}"; do
  source="${TEST_FILES[$index]}"
  expected="${TEST_CASES[$index]}"
  TAP_FILE="$TMPDIR/req002-live-$index.tap"
  printf 'complete-test-file=%s expected-cases=%s\n' "$source" "$expected"
  "$NODE_BIN" --import "./$GUARD" --experimental-test-module-mocks --test --test-timeout=30000 \
    --test-concurrency=1 --test-reporter=tap "$source" | tee "$TAP_FILE"
  "$NODE_BIN" "$CONTRACT" check "$TAP_FILE" "$expected"
  total_cases=$((total_cases + expected))
done

stage=req002-offline-cli-gate
if "$NODE_BIN" --import "./$GUARD" scripts/verify-req002-live.mjs >/dev/null 2>&1; then
  echo "FAIL unflagged verify-req002-live.mjs must refuse execution" >&2
  exit 1
fi
receipt="$TMPDIR/req002-unsupported-live.json"
if LOCAL_AGENT_CONFIG="$TMPDIR/absent-config" "$NODE_BIN" --import "./$GUARD" scripts/verify-req002-live.mjs --live --write-receipt="$receipt" >/dev/null; then
  echo "FAIL live baseline with synthetic document vectors must not run" >&2
  exit 1
fi
"$NODE_BIN" -e 'const r=require(process.argv[1]); if (r.mode !== "live" || r.verdict.status !== "unsupported" || r.scenarios.length || r.totals.runsStarted || r.totals.modelCalls || r.totals.queryEmbeddings) process.exit(1)' "$receipt"
receipt="$TMPDIR/req002-offline-receipt.json"
"$NODE_BIN" --import "./$GUARD" scripts/verify-req002-live.mjs --offline --write-receipt="$receipt" >/dev/null
"$NODE_BIN" -e 'const r=require(process.argv[1]); if (r.verdict.status !== "passed" || r.mode !== "offline_scripted") process.exit(1)' "$receipt"
receipt="$TMPDIR/req002-stopped-receipt.json"
if "$NODE_BIN" --import "./$GUARD" scripts/verify-req002-live.mjs --offline --max-model-calls=1 --write-receipt="$receipt" >/dev/null; then
  echo "FAIL stopped or incomplete acceptance must exit nonzero" >&2
  exit 1
fi
"$NODE_BIN" -e 'const r=require(process.argv[1]); if (r.verdict.status !== "failed" || r.totals.modelCalls !== 1 || r.scenarios.length !== 1) process.exit(1)' "$receipt"

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
