import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repository = path.dirname(frontend);
const archive = path.join(frontend, "_archive", "fe-w38-replaced-ui");
const manifest = JSON.parse(readFileSync(path.join(archive, "manifest.json"), "utf8"));
const resolveEntry = relative => {
  const resolved = path.resolve(repository, relative);
  assert.ok(resolved.startsWith(repository + path.sep), "Archive paths stay inside the repository");
  return resolved;
};

test("Replaced UI snapshots preserve the exact original bytes and provenance", () => {
  assert.equal(manifest.entries.filter(entry => entry.kind === "runtime-module").length, 8);
  assert.equal(manifest.entries.filter(entry => entry.kind === "original-test").length, 2);
  for (const entry of manifest.entries) {
    const snapshot = resolveEntry(entry.snapshotPath);
    assert.ok(snapshot.startsWith(archive + path.sep));
    assert.ok(snapshot.endsWith(".snapshot"), "Historical sources are not executable modules or test entries");
    const bytes = readFileSync(snapshot);
    assert.equal(bytes.length, entry.bytes, entry.originalPath);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256, entry.originalPath);
    const header = Buffer.from("blob " + bytes.length + "\0");
    assert.equal(createHash("sha1").update(header).update(bytes).digest("hex"), entry.gitBlobSha, entry.originalPath);
    assert.ok(entry.replacement.length > 0, "Every snapshot identifies its active replacement or retained purpose");
    if (entry.removedExports) {
      const active = readFileSync(resolveEntry(entry.originalPath), "utf8");
      const source = ts.createSourceFile(entry.originalPath, active, ts.ScriptTarget.Latest, true);
      for (const name of entry.removedExports) {
        assert.ok(!source.statements.some(node => ts.isFunctionDeclaration(node) && node.name?.text === name), name + " remains in the active module");
      }
    }
  }
});

test("Archived runtime modules have no remaining executable copy at the old path", () => {
  for (const entry of manifest.entries.filter(entry => entry.runtimeRemoved)) {
    assert.equal(existsSync(resolveEntry(entry.originalPath)), false, entry.originalPath);
  }
  // The existing entry retains the active source URL guard after its form-only assertions are archived.
  assert.equal(existsSync(path.join(frontend, "src/components/growth/growth-form.test.mjs")), true);
});

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(filename)
      : /\.(?:ts|tsx|mjs|mts|js|jsx)$/.test(entry.name) ? [filename] : [];
  });
}

function moduleReferences(filename) {
  const source = ts.createSourceFile(filename, readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true);
  const references = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)) references.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.arguments.length
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")
      && ts.isStringLiteral(node.arguments[0])) references.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return references;
}

test("Runtime and active component tests do not import archived modules or snapshots", () => {
  const removed = new Set(manifest.entries.filter(entry => entry.runtimeRemoved).map(entry => resolveEntry(entry.originalPath)));
  for (const filename of [...sourceFiles(path.join(frontend, "app")), ...sourceFiles(path.join(frontend, "src"))]) {
    for (const reference of moduleReferences(filename)) {
      if (!reference.startsWith(".")) continue;
      const target = path.resolve(path.dirname(filename), reference);
      assert.ok(!target.startsWith(archive + path.sep), filename + " imports historical code");
      const candidates = [target, target + ".ts", target + ".tsx", target + ".web.ts", target + ".web.tsx",
        target + ".native.ts", target + ".native.tsx", path.join(target, "index.ts"), path.join(target, "index.tsx")];
      assert.ok(candidates.every(candidate => !removed.has(candidate)), filename + " still imports " + reference);
    }
  }
});

