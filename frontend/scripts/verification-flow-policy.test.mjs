import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { availableFlowNames, currentLayoutRoutes, legacyFlowReasons, resolveVerificationSelection } from "./verification-flow-policy.mjs";
import { verifyTasks, verifyMemory, setDateTime } from "./flows/tasks-memory.mjs";
import { verifyGrowth, verifyGrowthText } from "./flows/growth.mjs";
import { verifySummary, verifySummaryText } from "./flows/summary.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));

test("Legacy aggregate, obsolete flows and unknown names fail instead of silently skipping checks", () => {
  assert.throws(() => resolveVerificationSelection([]), /default legacy browser aggregate is unsupported pending migration/);
  for (const name of Object.keys(legacyFlowReasons)) {
    assert.throws(() => resolveVerificationSelection([name]), /unsupported pending migration/);
    assert.throws(() => resolveVerificationSelection(["layout", name]), /unsupported pending migration/);
  }
  assert.throws(() => resolveVerificationSelection(["layuot"]), /Unknown browser flow/);
  assert.deepEqual([...resolveVerificationSelection(["layout", "profile", "layout"])], ["layout", "profile"]);
});

test("Available flow selections correspond to actual dispatchers and current layout routes", () => {
  const entry = readFileSync(path.join(directory, "verify-ui.mjs"), "utf8");
  const dispatched = [...entry.matchAll(/\["([^"]+)", verify[A-Za-z]+\]/g)].map(match => match[1]);
  assert.deepEqual([...dispatched, "layout"].sort(), [...availableFlowNames].sort());
  for (const route of currentLayoutRoutes) {
    const routeFile = route === "/login" ? "app/login.tsx" : "app/(dashboard)/" + (route === "/" ? "index" : route.slice(1)) + ".tsx";
    assert.ok(existsSync(path.resolve(directory, "..", routeFile)), routeFile);
  }
  assert.ok(currentLayoutRoutes.includes("/history") && currentLayoutRoutes.includes("/more"));
});

test("Direct calls to retired flow exports fail explicitly while shared date selection stays available", async () => {
  for (const flow of [verifyTasks, verifyMemory, verifyGrowth, verifyGrowthText, verifySummary, verifySummaryText]) {
    await assert.rejects(flow(), /unsupported pending migration/);
  }
  assert.equal(typeof setDateTime, "function");
});

test("The real CLI fails before browser launch or evidence creation for obsolete/default selections", () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "frontend-legacy-policy-"));
  try {
    for (const args of [[], ["memory"], ["layuot"]]) {
      const evidence = path.join(temp, args[0] ?? "default");
      const result = spawnSync(process.execPath, [path.join(directory, "verify-ui.mjs"), ...args], {
        encoding: "utf8", timeout: 5000,
        env: { ...process.env, BROWSER_EXECUTABLE: path.join(temp, "browser-must-not-launch"), FRONTEND_VERIFICATION_DIR: evidence },
      });
      assert.equal(result.error, undefined);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, args[0] === "layuot" ? /Unknown browser flow/ : /unsupported pending migration/);
      assert.doesNotMatch(result.stderr, /browserType\.launch|Executable doesn't exist|browser-must-not-launch/);
      assert.equal(existsSync(evidence), false);
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test("Preview readiness uses FirstScreenGate without requiring an expanded disclosure", () => {
  const helper = readFileSync(path.join(directory, "preview-browser.mjs"), "utf8");
  assert.match(helper, /getByTestId\("frontend-preview-ready"\)\.waitFor/);
  assert.doesNotMatch(helper, /getByText\("介面預覽 · 合成資料 · 未接駁 Server"/);
});

