#!/usr/bin/env bash
set -euo pipefail

echo "=== Cross-Domain Snapshots, Encrypted Statistics & Export Consistency Verification ==="

node --import ./frontend/scripts/family-cleanup-network-guard.mjs --experimental-transform-types --test \
  tests/cross-domain-snapshots.test.ts \
  tests/p2-a05-reports.test.ts \
  tests/p2-a05-report-client.test.ts \
  tests/firestore-erasure-export.test.ts \
  tests/firestore-voice.test.ts \
  tests/handover-concern-snapshot.test.ts

echo "=== Mutation Guards ==="
node scripts/verify-cross-domain-snapshot-mutations.mjs

echo "=== TypeScript Checks ==="
npx tsc -p tsconfig.server.json --noEmit
npx tsc --noEmit
npx tsc -p frontend/tsconfig.json --noEmit

echo "ALL CROSS-DOMAIN SNAPSHOT OFFLINE CHECKS PASSED"
