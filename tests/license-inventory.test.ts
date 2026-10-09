import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
const json = (path: string) => JSON.parse(read(path).toString("utf8"));
const sha256 = (value: Buffer) => createHash("sha256").update(value).digest("hex");

test("Firestore license inventory matches the selected direct dependency and preserved notice", () => {
  const name = "@google-cloud/firestore";
  const manifest = json("licenses/manifest.json");
  const entries = manifest.packages.filter((entry: { name: string }) => entry.name === name);
  assert.equal(entries.length, 1);
  const entry = entries[0];
  const locked = json("package-lock.json").packages[`node_modules/${name}`];
  assert.equal(entry.dependencyType, "dependency");
  assert.equal(entry.version, json("package.json").dependencies[name]);
  assert.equal(entry.version, locked.version);
  assert.equal(entry.license, "Apache-2.0");
  assert.equal(entry.license, locked.license);
  assert.equal(entry.tarball, locked.resolved);
  assert.equal(entry.integrity, locked.integrity);
  assert.equal(entry.files.length, 1);
  const file = entry.files[0];
  assert.equal(file.path, "licenses/google-cloud-firestore/LICENSE");
  assert.equal(file.source, `node_modules/${name}/LICENSE`);
  assert.equal(file.sha256, sha256(read(file.path)));
  assert.match(read(file.path).toString("utf8"), /Apache License\s+Version 2\.0, January 2004/);
  const notices = read("THIRD_PARTY_NOTICES.md").toString("utf8");
  assert.ok(notices.includes(`| ${name} | ${entry.version} | ${entry.license} | [LICENSE](${file.path}) |`));
});

test("License inventory lock summary and selected-package counts are reproducible", () => {
  const manifest = json("licenses/manifest.json");
  assert.equal(manifest.lockfile.path, "package-lock.json");
  const lockBytes = read(manifest.lockfile.path);
  assert.equal(manifest.lockfile.sha256, sha256(lockBytes));
  const locked = JSON.parse(lockBytes.toString("utf8"));
  const packages = Object.entries(locked.packages) as Array<[string, { link?: boolean; license?: string }]>;
  const declarations: Record<string, number> = {};
  const missingDeclarations: string[] = [];
  let packageEntries = 0;
  for (const [path, entry] of packages) {
    if (!path.includes("node_modules/") || entry.link) continue;
    packageEntries += 1;
    if (entry.license) declarations[entry.license] = (declarations[entry.license] ?? 0) + 1;
    else missingDeclarations.push(path);
  }
  assert.deepEqual(manifest.lockfileLicenseDeclarations, { packageEntries, declarations, missingDeclarations });
  const selected = manifest.packages as Array<{ dependencyType: string; files: unknown[] }>;
  const direct = selected.filter(entry => ["dependency", "devDependency"].includes(entry.dependencyType)).length;
  const transitive = selected.filter(entry => entry.dependencyType === "transitive").length;
  const files = selected.reduce((count, entry) => count + entry.files.length, 0);
  const notices = read("THIRD_PARTY_NOTICES.md").toString("utf8");
  assert.ok(notices.includes(`${direct} direct packages, ${transitive} explicitly inventoried transitive packages, and ${files} original license/notice file entries`));
});
