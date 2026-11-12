import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const revision = "0123456789abcdef0123456789abcdef01234567";
async function outputFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "site-version-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { output: pathToFileURL(directory + "/"), file: join(directory, "site-version.json") };
}

test("release output contains only the supplied full revision", async t => {
  const { writeSiteVersion } = await import("./write-site-version.mjs");
  const { output, file } = await outputFixture(t);
  await writeSiteVersion(output, revision);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { revision });
});

test("legacy output removes a stale release marker when revision is absent", async t => {
  const { writeSiteVersion } = await import("./write-site-version.mjs");
  const { output, file } = await outputFixture(t);
  await writeFile(file, JSON.stringify({ revision }));
  await writeSiteVersion(output, undefined);
  await assert.rejects(readFile(file), { code: "ENOENT" });
});

test("release output rejects malformed revisions without publishing a marker", async t => {
  const { writeSiteVersion } = await import("./write-site-version.mjs");
  const { output, file } = await outputFixture(t);
  for (const invalid of ["short", "g".repeat(40), revision + "\n", " " + revision]) {
    await assert.rejects(writeSiteVersion(output, invalid), /invalid_site_revision/);
  }
  await assert.rejects(readFile(file), { code: "ENOENT" });
});
