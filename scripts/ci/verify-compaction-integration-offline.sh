#!/usr/bin/env bash
set -euo pipefail

echo "=== Compaction Integration Offline Verification ==="

node --import ./frontend/scripts/family-cleanup-network-guard.mjs --experimental-test-module-mocks --experimental-transform-types --test \
  tests/agent-compaction-integration.test.ts \
  tests/agent-context-compaction.test.ts \
  tests/agent-durable-budget.test.ts \
  tests/agent-durable-ai-usage.test.ts \
  tests/product-agent-confirmation-budget.test.ts

echo "=== Mutation Guards ==="
node scripts/verify-compaction-mutations.mjs
node scripts/verify-compaction-integration-mutations.mjs

echo "=== TypeScript Checks ==="
npx tsc -p tsconfig.server.json --noEmit
npx tsc --noEmit
npx tsc -p frontend/tsconfig.json --noEmit

echo "ALL COMPACTION INTEGRATION OFFLINE CHECKS PASSED"
