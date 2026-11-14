#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();

function runMutationCase(label, relFile, transform) {
  const workDir = mkdtempSync(join(tmpdir(), "xdomain-mut-"));
  try {
    for (const dir of ["server", "src", "tests"]) {
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
          "tests/cross-domain-snapshots.test.ts",
        ],
        { cwd: workDir, stdio: "pipe" },
      );
    } catch {
      failed = true;
    }
    assert.equal(failed, true, `${label}: tests failed to catch injected mutation!`);
    console.log(`[PASS] Caught mutation: ${label}`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

runMutationCase(
  "S1: bypassing authorityVersion check allows mixing stale snapshot epochs",
  "server/cross-domain-snapshot.ts",
  src => src.replace(
    `if (currentAuthorityVersion !== watermark.authorityVersion)`,
    `if (false && currentAuthorityVersion !== watermark.authorityVersion)`,
  ),
);

runMutationCase(
  "S2: ignoring in-window concurrent mutation emits torn cross-domain snapshot",
  "server/cross-domain-snapshot.ts",
  src => src.replace(
    `if (entry.updatedAtMs > watermark.snapshotAtMs)`,
    `if (false && entry.updatedAtMs > watermark.snapshotAtMs)`,
  ),
);

runMutationCase(
  "S3: skipping missing ciphertext fail-closed guard returns partial encrypted statistics",
  "server/cross-domain-snapshot.ts",
  src => src.replace(
    `if (!envelope.ciphertext || !envelope.ciphertextSha256)`,
    `if (false && (!envelope.ciphertext || !envelope.ciphertextSha256))`,
  ),
);

runMutationCase(
  "S4: bypassing voice basis check attaches stale transcript to superseded audio",
  "server/cross-domain-snapshot.ts",
  src => src.replace(
    `if (completedJob.voiceId !== currentVoice.voiceId || completedJob.basis !== currentBasis)`,
    `if (false)`,
  ),
);
