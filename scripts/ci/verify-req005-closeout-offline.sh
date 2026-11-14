#!/usr/bin/env bash
set -euo pipefail

echo "=== REQ-005 Acceptance Closeout Scenarios Offline Verification ==="

node --import ./frontend/scripts/family-cleanup-network-guard.mjs --experimental-transform-types --test \
  tests/req005-acceptance-scenarios.test.ts \
  tests/agent-context-window.test.ts \
  tests/agent-context-topology.test.ts \
  tests/initial-conversation-summary.test.ts \
  tests/personal-model-settings.test.ts \
  tests/agent-durable-ai-usage.test.ts

echo "=== TypeScript Checks ==="
npx tsc -p tsconfig.server.json --noEmit
npx tsc --noEmit
npx tsc -p frontend/tsconfig.json --noEmit

echo "ALL REQ-005 CLOSEOUT OFFLINE CHECKS PASSED"
