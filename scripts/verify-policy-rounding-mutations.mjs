import fs from "node:fs";
import { execFileSync } from "node:child_process";

const LIMITS_PATH = "src/shared/agent-run-limits.ts";
const BUDGET_PATH = "server/agent-budget.ts";
const HWM_PATH = "server/agent-high-watermark.ts";

const originals = new Map([
  [LIMITS_PATH, fs.readFileSync(LIMITS_PATH, "utf8")],
  [BUDGET_PATH, fs.readFileSync(BUDGET_PATH, "utf8")],
  [HWM_PATH, fs.readFileSync(HWM_PATH, "utf8")],
]);

function restoreAll() {
  for (const [file, content] of originals) {
    fs.writeFileSync(file, content, "utf8");
  }
}

function mutateFile(file, target, replacement, id) {
  const original = originals.get(file);
  const next = original.replace(target, replacement);
  if (next === original) {
    throw new Error(`Mutation ${id} pattern did not match in ${file}`);
  }
  fs.writeFileSync(file, next, "utf8");
}

const mutations = [
  {
    id: "P1",
    name: "Guard P1: replace Math.floor with Math.ceil in roundBudgetAllowance",
    mutate: () => mutateFile(
      LIMITS_PATH,
      "return Math.max(minAllowance, Math.floor(rawValue));",
      "return Math.max(minAllowance, Math.ceil(rawValue));",
      "P1",
    ),
  },
  {
    id: "P2",
    name: "Guard P2: replace Math.ceil with Math.floor in roundConsumptionReserve",
    mutate: () => mutateFile(
      LIMITS_PATH,
      "return Math.max(minReserve, Math.ceil(rawValue));",
      "return Math.max(minReserve, Math.floor(rawValue));",
      "P2",
    ),
  },
  {
    id: "P3",
    name: "Guard P3: suppress immediate abort when transition.enabled is false",
    mutate: () => mutateFile(
      BUDGET_PATH,
      "if (!this.signal.aborted) this.controller.abort(new AgentStopped(\"unavailable\"));",
      "/* skipped abort */",
      "P3",
    ),
  },
  {
    id: "P4",
    name: "Guard P4: suppress sustained high-watermark window threshold",
    mutate: () => mutateFile(
      HWM_PATH,
      "const sustainedWindowHit = highWatermarkCount >= minHighRuns;",
      "const sustainedWindowHit = false;",
      "P4",
    ),
  },
];

let passedAll = true;
try {
  for (const m of mutations) {
    console.log(`Testing [${m.id}]: ${m.name}...`);
    m.mutate();
    try {
      execFileSync(
        process.execPath,
        [
          "--import",
          "./frontend/scripts/family-cleanup-network-guard.mjs",
          "--experimental-transform-types",
          "--test",
          "tests/agent-policy-rounding-alerts.test.ts",
        ],
        {
          stdio: "pipe",
          encoding: "utf8",
        },
      );
      console.error(`  FAIL: Mutation ${m.id} was NOT caught!`);
      passedAll = false;
    } catch (err) {
      console.log(`  PASSED: Mutation ${m.id} caught (exit ${err.status}).`);
    } finally {
      restoreAll();
    }
  }
} finally {
  restoreAll();
}

if (!passedAll) process.exit(1);
console.log("All policy rounding and high-watermark mutations (P1-P4) caught.");
