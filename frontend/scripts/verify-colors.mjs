import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { converter, wcagContrast } from "culori";

const themeSource = await readFile("src/theme.ts", "utf8");
const body = themeSource.split("export const colors = {")[1]?.split("} as const")[0];
assert.ok(body, "Theme color tokens must be readable.");
const colors = Object.fromEntries([...body.matchAll(/^\s*([a-zA-Z]\w*):\s*"([^"]+)"/gm)].map(match => [match[1], match[2]]));
const pairs = [
  ["body on card", "ink", "white", 4.5],
  ["body on canvas", "ink", "canvas", 4.5],
  ["secondary on card", "muted", "white", 4.5],
  ["secondary on canvas", "muted", "canvas", 4.5],
  ["secondary on menu", "muted", "quietSurface", 4.5],
  ["secondary on green tint", "muted", "paleTeal", 4.5],
  ["secondary on selected tint", "muted", "selectedNav", 4.5],
  ["secondary on warning tint", "muted", "paleAmber", 4.5],
  ["secondary on error tint", "muted", "paleCoral", 4.5],
  ["primary button", "white", "teal", 4.5],
  ["emphasized button", "white", "deepTeal", 4.5],
  ["error text", "errorInk", "paleCoral", 4.5],
  ["warning text", "warningInk", "paleAmber", 4.5],
  ["selected navigation", "deepTeal", "selectedNav", 4.5],
  ["input boundary on card", "controlOutline", "white", 3],
  ["input boundary on canvas", "controlOutline", "canvas", 3],
  ["control icon on menu", "deepTeal", "quietSurface", 3],
  ["control icon on card", "teal", "white", 3],
];
const results = pairs.map(([label, foreground, background, minimum]) => {
  assert.ok(colors[foreground] && colors[background], "Missing color role: " + label);
  const ratio = wcagContrast(colors[foreground], colors[background]);
  assert.ok(ratio >= minimum, label + ": contrast " + ratio + " is below " + minimum);
  return { label, foreground: colors[foreground], background: colors[background], ratio, minimum };
});
const directory = resolve(process.env.FRONTEND_VERIFICATION_DIR ?? "verification/fe-w06-design");
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, "color-checks.json"), JSON.stringify({
  at: new Date().toISOString(),
  scope: "Token pairs used by this light preview; not a full accessibility audit",
  themeSha256: createHash("sha256").update(themeSource).digest("hex"),
  colors: Object.fromEntries(Object.entries(colors).filter(([, value]) => value.startsWith("#")).map(([name, value]) => [name, { hex: value, oklch: converter("oklch")(value) }])),
  pairs: results,
}, null, 2) + "\n");
console.log("Passed " + results.length + " light-theme contrast pairs.");
