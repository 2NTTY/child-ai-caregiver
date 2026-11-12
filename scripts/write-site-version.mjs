import { rm, writeFile } from "node:fs/promises";

// Only a supplied release identity may be published; local builds have no identity.
export async function writeSiteVersion(output, revision) {
  const file = new URL("site-version.json", output);
  if (revision === undefined || revision === "") {
    await rm(file, { force: true });
    return;
  }
  if (!/^[0-9a-f]{40}$/i.test(revision)) throw new Error("invalid_site_revision");
  await writeFile(file, JSON.stringify({ revision }) + "\n");
}
