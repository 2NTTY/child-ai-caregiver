// Backport path normalization to the pinned fingerprint loader on Windows.
// Upstream: expo/expo packages/@expo/fingerprint/src/ExpoConfigLoader.ts.
// Keep every source and compatibility check; only normalize before glob matching.
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
if (process.platform !== "win32") process.exit(0);
const root = fs.realpathSync(path.resolve(__dirname, "../.."));
const fromApp = createRequire(path.join(root, "frontend/package.json"));
const fromExpo = createRequire(fromApp.resolve("expo/package.json"));
const packagePath = fromExpo.resolve("@expo/fingerprint/package.json");
const target = fs.realpathSync(path.join(path.dirname(packagePath), "build/ExpoConfigLoader.js"));
const relative = path.relative(root, target);
if (relative.startsWith("..") || path.isAbsolute(relative)) {
  throw new Error("Use a physical dependency installation within this build workspace");
}
const version = JSON.parse(fs.readFileSync(packagePath, "utf8")).version;
if (version !== "0.20.13") throw new Error("Review the fingerprint workaround after a dependency update");
const before = "const relativePath = path_1.default.relative(projectRoot, modulePath);";
const after = "const relativePath = (0, Path_1.toPosixPath)(path_1.default.relative(projectRoot, modulePath));";
const source = fs.readFileSync(target, "utf8");
if (source.includes(after) && !source.includes(before)) process.exit(0);
if (source.split(before).length !== 2) throw new Error("Unexpected pinned fingerprint loader source");
fs.writeFileSync(target, source.replace(before, after));
console.log("Normalized pinned Expo fingerprint paths for Windows");
