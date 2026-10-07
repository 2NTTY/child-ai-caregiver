import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const archive = "_archive/legacy-web-2026-10-07/";
const manifest = JSON.parse(readFileSync(resolve(root, archive, "manifest.json"), "utf8")) as {
  sourceCommit: string;
  files: { originalPath: string; archivePath: string; gitBlobSha1: string; sha256: string; bytes: number }[];
};
const retiredMessage = "The legacy functional-test frontend is archived. See _archive/legacy-web-2026-10-07/README.md. Use an explicitly selected current frontend test configuration.";

test("legacy frontend snapshots preserve all approved original bytes", () => {
  assert.equal(manifest.sourceCommit, "0a39e018dc138b29a437ab52679866e3bfcc0378");
  assert.equal(manifest.files.length, 23);
  assert.equal(new Set(manifest.files.map(file => file.originalPath)).size, 23);
  for (const file of manifest.files) {
    assert.equal(file.archivePath, `${archive}${file.originalPath}.snapshot`);
    const bytes = readFileSync(resolve(root, file.archivePath));
    assert.equal(bytes.length, file.bytes, file.originalPath);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256, file.originalPath);
    assert.equal(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), file.gitBlobSha1, file.originalPath);
  }
});

test("legacy commands and the default browser configuration fail before starting services", () => {
  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["legacy:web"], "node scripts/legacy-web-retired.mjs");
  assert.equal(packageJson.scripts["legacy:build:web"], "node scripts/legacy-web-retired.mjs");
  assert.equal(packageJson.scripts["test:web"], "node --env-file-if-exists=.env scripts/verify-web.mjs");
  assert.equal(readFileSync(resolve(root, "scripts/legacy-web-retired.mjs"), "utf8").trim(), `throw new Error(${JSON.stringify(retiredMessage)});`);
  for (const entry of ["scripts/legacy-web-retired.mjs", "scripts/verify-web.mjs", "playwright.config.mjs"]) {
    const result = spawnSync(process.execPath, [resolve(root, entry)], { cwd: root, encoding: "utf8", timeout: 3_000 });
    assert.equal(result.error, undefined, entry);
    assert.equal(result.signal, null, entry);
    assert.equal(result.status, 1, entry);
    assert.ok(result.stderr.includes(retiredMessage), entry);
    assert.equal(result.stdout, "", entry);
  }
});

test("active source does not import archived UI and retained capabilities stay present", () => {
  const retired = new Set(manifest.files.filter(file => /\.[cm]?[jt]sx?$/.test(file.originalPath))
    .map(file => resolve(root, file.originalPath).replace(/\.[cm]?[jt]sx?$/, "")));
  const scan = (directory: string) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) scan(path);
      else if (/\.[cm]?[jt]sx?$/.test(extname(path))) {
        const text = readFileSync(path, "utf8");
        const imports = text.matchAll(/(?:\bfrom\s*|\b(?:import|require)\s*\(?\s*)["'](\.[^"']+)["']/g);
        for (const match of imports) {
          const target = resolve(dirname(path), match[1]).replace(/\.[cm]?[jt]sx?$/, "");
          assert.ok(!retired.has(target), `${path} imports retired ${match[1]}`);
        }
      }
    }
  };
  for (const directory of ["app", "src", "frontend/app", "frontend/src"]) scan(resolve(root, directory));
  for (const path of ["src/client/FamilyPanel.tsx", "src/client/EmergencyHelp.tsx", "src/client/records-controller.ts", "src/client/chat-controller.ts", "src/client/online-transport.ts", "src/client/push-browser.ts", "src/client/care-summary-api.ts"]) {
    assert.ok(existsSync(resolve(root, path)), path);
  }
  const screen = readFileSync(resolve(root, "frontend/src/screens/SummaryScreen.tsx"), "utf8");
  assert.ok(screen.includes('tab === "legacy-preparation"'));
  assert.ok(screen.includes("<TaskKnowledgeSummaryContent preparation"));
});
