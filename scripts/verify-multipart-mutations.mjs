/**
 * verify-multipart-mutations.mjs
 *
 * Automated verification of anti-bypass mutation guards G1 through G9 for REQ-005 multipart progression.
 * Applies mutations against server validation guards in server/firestore-memory.ts,
 * executes tests/summary-progress.test.ts via standard node test runner,
 * and asserts that each mutation produces red test failure.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const targetFile = path.join(repoRoot, 'server', 'firestore-memory.ts');
const originalContent = fs.readFileSync(targetFile, 'utf8');

const MUTATIONS = [
  {
    id: 'G1',
    description: 'Anti-Bypass Guard G1: forged sourceHash mismatching server safe chunk hash',
    target: "if (input.part.sourceHash && input.part.sourceHash !== expectedChunk.sourceHash) {\n        domainReject('summary_coverage_changed');\n      }",
    replacement: "if (false && input.part.sourceHash && input.part.sourceHash !== expectedChunk.sourceHash) {\n        domainReject('summary_coverage_changed');\n      }",
  },
  {
    id: 'G2',
    description: 'Anti-Bypass Guard G2: subsequent part index > 0 without active progress record in Firestore',
    target: "!prevPart ||",
    replacement: "false && !prevPart ||",
  },
  {
    id: 'G3',
    description: 'Anti-Bypass Guard G3: non-consecutive part index skipping intermediate chunks',
    target: "prevPart.index + 1 !== input.part.index ||",
    replacement: "false && prevPart.index + 1 !== input.part.index ||",
  },
  {
    id: 'G4',
    description: 'Anti-Bypass Guard G4: mid-progress chat message edit mismatching resume sourceHash',
    target: "sourceHash === progress.sourceHash &&",
    replacement: "true &&",
  },
  {
    id: 'G5',
    description: 'Anti-Bypass Guard G5: endOffset diverging from server safe chunk boundary',
    target: "if (input.part.endOffset !== undefined && input.part.endOffset !== expectedChunk.endOffset) {\n        domainReject('summary_coverage_changed');\n      }",
    replacement: "if (false && input.part.endOffset !== undefined && input.part.endOffset !== expectedChunk.endOffset) {\n        domainReject('summary_coverage_changed');\n      }",
  },
  {
    id: 'G6',
    description: 'Anti-Bypass Guard G6: forged total chunk count mismatching server-computed split count',
    target: "if (serverChunks.length !== input.part.total) domainReject('summary_coverage_changed');",
    replacement: "if (false && serverChunks.length !== input.part.total) domainReject('summary_coverage_changed');",
  },
  {
    id: 'G7',
    description: 'Anti-Bypass Guard G7: startOffset diverging from server safe chunk boundary',
    target: "if (input.part.startOffset !== undefined && input.part.startOffset !== expectedChunk.startOffset) {\n        domainReject('summary_coverage_changed');\n      }",
    replacement: "if (false && input.part.startOffset !== undefined && input.part.startOffset !== expectedChunk.startOffset) {\n        domainReject('summary_coverage_changed');\n      }",
  },
  {
    id: 'G8',
    description: 'Anti-Bypass Guard G8: repair summary write carrying illegal part payload',
    target: "if (repair) domainReject('summary_coverage_changed');",
    replacement: "if (false && repair) domainReject('summary_coverage_changed');",
  },
  {
    id: 'G9',
    description: 'Anti-Bypass Guard G9: startOffset diverging from previous progress endOffset',
    target: "input.part.startOffset !== prevPart.endOffset",
    replacement: "false && input.part.startOffset !== prevPart.endOffset",
  },
];

console.log('=== Starting REQ-005 Multipart Progression Mutation Verification ===\n');

const results = [];

try {
  for (const mut of MUTATIONS) {
    console.log(`Testing [${mut.id}]: ${mut.description}...`);
    const normalizedOriginal = originalContent.replace(/\r\n/g, '\n');
    const normalizedTarget = mut.target.replace(/\r\n/g, '\n');
    
    if (!normalizedOriginal.includes(normalizedTarget)) {
      console.error(`ERROR: Target string for mutation ${mut.id} not found in server/firestore-memory.ts`);
      process.exit(1);
    }

    const mutated = normalizedOriginal.replace(normalizedTarget, mut.replacement.replace(/\r\n/g, '\n'));
    fs.writeFileSync(targetFile, mutated, 'utf8');

    let output = '';
    let exitCode = 0;
    try {
      output = execSync('node --experimental-test-module-mocks --test tests/summary-progress.test.ts', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      exitCode = err.status ?? 1;
      output = (err.stdout ?? '') + (err.stderr ?? '');
    }

    const passMatch = output.match(/ℹ pass (\d+)/);
    const failMatch = output.match(/ℹ fail (\d+)/);
    const passed = passMatch ? parseInt(passMatch[1], 10) : 0;
    const failed = failMatch ? parseInt(failMatch[1], 10) : 0;

    console.log(`  Exit code: ${exitCode}, Passed: ${passed}, Failed: ${failed}`);
    if (failed === 0) {
      console.error(`  FAIL: Mutation ${mut.id} did NOT produce any test failure!`);
      process.exit(1);
    }

    results.push({
      id: mut.id,
      description: mut.description,
      passed,
      failed,
      exitCode,
    });
  }
} finally {
  // Always restore original file
  fs.writeFileSync(targetFile, originalContent, 'utf8');
  console.log('\nRestored server/firestore-memory.ts to original state.');
}

console.log('\n=== Mutation Verification Results Summary ===');
for (const r of results) {
  console.log(`[${r.id}] ${r.description} -> ${r.passed} passed / ${r.failed} failed (exit ${r.exitCode})`);
}
console.log('\nAll anti-bypass mutations verified successfully.');
