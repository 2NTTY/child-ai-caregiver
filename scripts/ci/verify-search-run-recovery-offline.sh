#!/usr/bin/env bash
set -euo pipefail

export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=3072}"

echo "[1/3] Running offline run recovery and SSE convergence tests..."
node --experimental-test-module-mocks --test \
  tests/chat-run-recovery.test.ts \
  tests/agent-feedback.test.ts

echo "[2/3] Running server TypeScript check (tsconfig.server.json)..."
./node_modules/.bin/tsc -p tsconfig.server.json --noEmit

echo "[3/3] Running root TypeScript check (tsconfig.json)..."
./node_modules/.bin/tsc -p tsconfig.json --noEmit

echo "Offline search-run-recovery verification passed."
