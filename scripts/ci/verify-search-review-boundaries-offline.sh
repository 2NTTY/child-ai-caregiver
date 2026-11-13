#!/usr/bin/env bash
set -euo pipefail

echo "[B-P7] Running TypeScript checks..."
./node_modules/.bin/tsc -p tsconfig.server.json --noEmit
./node_modules/.bin/tsc -p tsconfig.json --noEmit

echo "[B-P7] Running delivery review boundary & mid-turn obligation tests..."
node --experimental-test-module-mocks --test \
  tests/search-review-boundaries.test.ts \
  tests/chat-delivery-review.test.ts \
  tests/agent-budget.test.ts

echo "[B-P7] Offline verification passed."
