"use strict";
// Expo Router57.0.22: external popstate must synchronize createMemoryHistory's
// private index before useLinking replaces the traversed entry. No router,
// root/scene or application presentation ownership policy changes.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const VERSION = "57.0.22";
const BEFORE = "6283ba26a72bea1424e1355d0c855e559b25c84d0ca6efbc1adf79143ca8ed49", AFTER = "9dbb4f3fb6682b03761b09b16cc81fb0d1357674a56e4b5a128fc4c4bcf14160", PATCH = "f347b241c2eb21db32c626a63dc29adf2e095306a5400225a46398b52bceacce";
const HELPER = "node_modules/expo-router/build/fork/createMemoryHistory.js";
const PATCH_FILE = "frontend/patches/expo-router-57.0.22-history-index.patch";
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
function regular(root, relative) {
  const parts = relative.split("/"); let current = root;
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]); const info = fs.lstatSync(current);
    if (info.isSymbolicLink() || (index < parts.length - 1 ? !info.isDirectory() : !info.isFile() || info.nlink !== 1)) {
      throw new Error("Refusing shared/symlinked or non-regular patch input: " + current);
    }
  }
  return current;
}
function applyHistoryPatch(projectRoot, { checkOnly = false } = {}) {
  const root = path.resolve(projectRoot);
  if (fs.realpathSync(root) !== root) throw new Error("Project root must not be symlinked");
  const packageFile = regular(root, "node_modules/expo-router/package.json");
  if (JSON.parse(fs.readFileSync(packageFile, "utf8")).version !== VERSION) throw new Error("Unsupported expo-router version");
  const patchFile = regular(root, PATCH_FILE);
  if (hash(fs.readFileSync(patchFile)) !== PATCH) throw new Error("Unrecognized tracked patch bytes");
  const target = regular(root, HELPER), original = fs.readFileSync(target), currentHash = hash(original);
  if (currentHash === AFTER) return { status: "already-applied", version: VERSION, sha256: AFTER };
  if (currentHash !== BEFORE) throw new Error("Unrecognized createMemoryHistory bytes");
  if (checkOnly) throw new Error("Required expo-router history patch is not applied");
  const needle = "                listener();";
  const source = original.toString("utf8");
  if (source.split(needle).length !== 2) throw new Error("History listener patch anchor is not unique");
  const output = source.replace(needle,
    "                // Synchronize the traversed slot before listener-triggered history writes.\n" +
    "                index = history.index;\n" + needle);
  if (hash(output) !== AFTER) throw new Error("Patched history hash mismatch");
  const before = fs.lstatSync(target), temporary = target + ".history-patch-" + process.pid;
  let created = false;
  try {
    fs.writeFileSync(temporary, output, { flag: "wx", mode: before.mode & 0o777 });
    created = true;
    const current = fs.lstatSync(target);
    if (current.dev !== before.dev || current.ino !== before.ino || current.nlink !== 1 || hash(fs.readFileSync(target)) !== BEFORE) {
      throw new Error("History target changed during patch preparation");
    }
    fs.renameSync(temporary, target);
  } finally {
    if (created && fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  if (hash(fs.readFileSync(target)) !== AFTER) throw new Error("Written history hash mismatch");
  return { status: "applied", version: VERSION, sha256: AFTER };
}
module.exports = { applyHistoryPatch };
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.length === 1 && args[0] !== "--check") throw new Error("Only --check is supported");
  console.log(JSON.stringify(applyHistoryPatch(path.resolve(__dirname, "../.."), { checkOnly: args[0] === "--check" })));
}
