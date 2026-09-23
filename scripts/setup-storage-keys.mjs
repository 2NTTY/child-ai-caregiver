import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, resolve, relative, join, sep } from "node:path";
try {
  const directory = process.argv[2];
  if (!directory || !isAbsolute(directory) || !relative(process.cwd(), resolve(directory)).startsWith(`..${sep}`)) throw new Error();
  // The parent must already exist; never reuse a directory with unknown ACLs.
  await mkdir(directory, { mode: 0o700 });
  if (process.platform === "win32") {
    const identity = execFileSync("whoami", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true });
    const sid = identity.match(/S-1-[0-9-]+/)?.[0];
    if (!sid) throw new Error();
    execFileSync("icacls", [directory, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`], { stdio: "ignore", windowsHide: true });
  }
  for (const name of ["storage.key", "backup.key"]) {
    await writeFile(join(directory, name), randomBytes(32).toString("base64") + "\n", { flag: "wx", mode: 0o600 });
  }
  console.log("independent_storage_and_backup_keys_created");
} catch { console.error("storage_key_setup_failed"); process.exitCode = 1; }
