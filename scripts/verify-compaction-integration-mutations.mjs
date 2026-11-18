#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();

function runMutationCase(label, relFile, transform) {
  const workDir = mkdtempSync(join(tmpdir(), "compaction-mut-"));
  try {
    for (const dir of ["server", "src", "tests", "prompts", "knowledge"]) {
      const srcDir = join(root, dir);
      if (existsSync(srcDir)) cpSync(srcDir, join(workDir, dir), { recursive: true, force: true });
    }
    for (const file of ["package.json", "tsconfig.json", "tsconfig.server.json"]) {
      const srcFile = join(root, file);
      if (existsSync(srcFile)) cpSync(srcFile, join(workDir, file), { force: true });
    }
    cpSync(
      join(root, "frontend/scripts/family-cleanup-network-guard.mjs"),
      join(workDir, "frontend/scripts/family-cleanup-network-guard.mjs"),
      { recursive: true, force: true },
    );
    symlinkSync(resolve(root, "node_modules"), join(workDir, "node_modules"), process.platform === "win32" ? "junction" : "dir");

    const targetPath = join(workDir, relFile);
    const original = readFileSync(targetPath, "utf8");
    const mutated = transform(original);
    assert.notEqual(mutated, original, `${label}: mutation target did not match`);
    writeFileSync(targetPath, mutated, "utf8");

    let failed = false;
    try {
      execFileSync(
        process.execPath,
        [
          "--import", "./frontend/scripts/family-cleanup-network-guard.mjs",
          "--experimental-transform-types",
          "--test",
          "tests/agent-compaction-integration.test.ts",
        ],
        { cwd: workDir, stdio: "pipe" },
      );
    } catch {
      failed = true;
    }
    assert.equal(failed, true, `${label}: integration tests failed to catch injected mutation!`);
    console.log(`[PASS] Caught mutation: ${label}`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

runMutationCase(
  "I1: removing isCompactedEvent system-author filter breaks post-compaction modelAttemptKey",
  "server/agent-runtime.ts",
  src => src.replace(
    `!(isCompactedEvent(event) && event.author === "system")`,
    `true`,
  ),
);

runMutationCase(
  "I2: leaking initialConversationSummary into compactionModel exposes private history to compaction prompts",
  "server/agent-runtime.ts",
  src => src.replace(
    /reserveDeliveryReview,\r?\n(\s*)\.\.\.\(durable \? \{ modelAttemptKey: \(request: LlmRequest\) => compactionAnchors\.get\(request\) \} : \{\}\),/,
    (_m, indent) => `reserveDeliveryReview,\n${indent}initialConversationSummary: input.initialConversationSummary,\n${indent}...(durable ? { modelAttemptKey: (request: LlmRequest) => compactionAnchors.get(request) } : {}),`,
  ),
);

runMutationCase(
  "I3: dropping compactionModel?.failure from modelLimit prevents finalizeOnModelLimit when reserveDeliveryReview blocks compaction",
  "server/agent-runtime.ts",
  src => src.replace(
    /\s*\|\|\s*compactionModel\?\.failure\?\.reason === "model_limit"/g,
    ``,
  ),
);

runMutationCase(
  "I4: dropping compactionAnchors lookup breaks durable ledger charging during compaction",
  "server/agent-runtime.ts",
  src => src.replace(
    `compactionAnchors.get(request)`,
    `undefined`,
  ),
);
