#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();

function runMutationCase(label, relFile, transform, testArgs) {
  const workDir = mkdtempSync(join(tmpdir(), "growth-cur-mut-"));
  try {
    for (const dir of ["server", "src", "tests", "frontend"]) {
      const srcDir = join(root, dir);
      if (existsSync(srcDir)) cpSync(srcDir, join(workDir, dir), { recursive: true, force: true });
    }
    for (const file of ["package.json", "tsconfig.json", "tsconfig.server.json"]) {
      const srcFile = join(root, file);
      if (existsSync(srcFile)) cpSync(srcFile, join(workDir, file), { force: true });
    }
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
          ...testArgs,
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
  "G1: omitting historyCursor forwarding in server/growth-api.ts breaks HTTP pagination",
  "server/growth-api.ts",
  src => src.replace(
    `store.list(userId, childId, { historyCursor: rawCursor })`,
    `store.list(userId, childId)`,
  ),
  ["tests/growth-history-cursor.test.ts"],
);

runMutationCase(
  "G2: dropping ?historyCursor query param in src/client/growth-api.ts breaks client continuation requests",
  "src/client/growth-api.ts",
  src => src.replace(
    "const suffix = historyCursor ? `?historyCursor=${encodeURIComponent(historyCursor)}` : \"\";",
    "const suffix = \"\";",
  ),
  ["tests/growth-history-cursor.test.ts"],
);

runMutationCase(
  "G3: dropping cursor forwarding in server/firestore-growth.ts ignores historyCursor in Firestore store",
  "server/firestore-growth.ts",
  src => src.replace(
    `const records = await readPageRecords(b, cursor)`,
    `const records = await readPageRecords(b, null)`,
  ),
  ["tests/growth-history-cursor.test.ts"],
);

runMutationCase(
  "G4: repeating active items inside continuation slices in server/growth-rules.ts causes duplicate items",
  "server/growth-rules.ts",
  src => src.replace(
    `selected: slice,\n    historyHasMore,`,
    `selected: [...active, ...slice],\n    historyHasMore,`,
  ),
  ["tests/growth-history-cursor.test.ts"],
);

runMutationCase(
  "G5: omitting authorityVersion check in loadMoreHistory allows mixing mismatched snapshots",
  "frontend/src/production/task-knowledge-growth.ts",
  src => src.replace(
    `if (next.authorityVersion !== basis.authorityVersion)`,
    `if (false && next.authorityVersion !== basis.authorityVersion)`,
  ),
  ["frontend/scripts/growth-pagination-controller.test.mjs"],
);
