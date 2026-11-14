#!/usr/bin/env bash
set -euo pipefail

echo "=== Growth History Cursor & Pagination Offline Verification ==="

node --import ./frontend/scripts/family-cleanup-network-guard.mjs --experimental-test-module-mocks --experimental-transform-types --test \
  tests/growth-history-cursor.test.ts \
  tests/growth-age-gate.test.ts \
  tests/growth-policy.test.ts \
  tests/growth-read-boundary.test.ts \
  frontend/scripts/growth-concern-actions.test.mjs \
  frontend/scripts/growth-pagination-controller.test.mjs \
  frontend/scripts/shared-photo-pages.test.mjs

echo "=== Mutation Guards ==="
node scripts/verify-growth-cursor-mutations.mjs

echo "=== TypeScript Checks ==="
npx tsc -p tsconfig.server.json --noEmit
npx tsc --noEmit
npx tsc -p frontend/tsconfig.json --noEmit

echo "ALL GROWTH CURSOR OFFLINE CHECKS PASSED"
