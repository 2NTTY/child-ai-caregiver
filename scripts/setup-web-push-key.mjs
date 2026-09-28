import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, resolve, relative, join, sep } from "node:path";
import webPush from "web-push";
import { checkedVapid } from "../server/web-push-gateway.ts";

try {
  const [directory, subject] = process.argv.slice(2);
  if (!directory || !isAbsolute(directory) || !relative(process.cwd(), resolve(directory)).startsWith(".." + sep)) throw new Error();
  const config = checkedVapid({ ...webPush.generateVAPIDKeys(), subject });
  // New external directory only; no overwrite or silent rotation of an existing key.
  await mkdir(directory, { mode: 0o700 });
  if (process.platform === "win32") {
    const identity = execFileSync("whoami", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true });
    const sid = identity.match(/S-1-[0-9-]+/)?.[0];
    if (!sid) throw new Error();
    execFileSync("icacls", [directory, "/inheritance:r", "/grant:r", "*" + sid + ":(OI)(CI)F"], { stdio: "ignore", windowsHide: true });
  }
  await writeFile(join(directory, "vapid.json"), JSON.stringify(config) + "\n", { flag: "wx", mode: 0o600 });
  console.info("web_push_vapid_created");
} catch { console.error("web_push_vapid_setup_failed"); process.exitCode = 1; }
