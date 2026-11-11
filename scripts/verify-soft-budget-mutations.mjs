import fs from "node:fs";
import { execSync } from "node:child_process";

const BUDGET_PATH = "server/agent-budget.ts";
const LIMITS_PATH = "src/shared/agent-run-limits.ts";

const originalBudget = fs.readFileSync(BUDGET_PATH, "utf8");
const originalLimits = fs.readFileSync(LIMITS_PATH, "utf8");

function restoreAll() {
  fs.writeFileSync(BUDGET_PATH, originalBudget, "utf8");
  fs.writeFileSync(LIMITS_PATH, originalLimits, "utf8");
}

function applyBudgetMutation(target, replacement, id) {
  const code = originalBudget.replace(target, replacement);
  if (code === originalBudget) {
    throw new Error(`Mutation pattern for ${id} failed to match in ${BUDGET_PATH}!`);
  }
  fs.writeFileSync(BUDGET_PATH, code, "utf8");
}

function applyLimitsMutation(target, replacement, id) {
  const code = originalLimits.replace(target, replacement);
  if (code === originalLimits) {
    throw new Error(`Mutation pattern for ${id} failed to match in ${LIMITS_PATH}!`);
  }
  fs.writeFileSync(LIMITS_PATH, code, "utf8");
}

const mutations = [
  {
    id: "S1",
    name: "Guard S1: tamper DEFAULT_SOFT_BUDGET_RATIO default from 0.25 to 0.50",
    mutate: () => {
      applyLimitsMutation(
        "DEFAULT_SOFT_BUDGET_RATIO = 0.25;",
        "DEFAULT_SOFT_BUDGET_RATIO = 0.50;",
        "S1"
      );
    }
  },
  {
    id: "S2",
    name: "Guard S2: omit soft budget ratio bounds validation in freezeAgentRunLimits",
    mutate: () => {
      applyBudgetMutation(
        /if\s*\(limits\.softBudgetRatio\s*!==\s*undefined\)\s*\{[\s\S]*?extended\.softBudgetRatio\s*=\s*limits\.softBudgetRatio;\s*\}/,
        "if (limits.softBudgetRatio !== undefined) { extended.softBudgetRatio = limits.softBudgetRatio; }",
        "S2"
      );
    }
  },
  {
    id: "S3",
    name: "Guard S3: omit used counts subtraction in softRemaining calculation",
    mutate: () => {
      applyBudgetMutation(
        "modelCalls: Math.max(0, softBudget.modelCalls - this.used.modelCalls),",
        "modelCalls: softBudget.modelCalls,",
        "S3"
      );
    }
  },
  {
    id: "S4",
    name: "Guard S4: suppress softExceeded detection by always returning false",
    mutate: () => {
      applyBudgetMutation(
        "modelCalls: this.used.modelCalls >= softBudget.modelCalls,",
        "modelCalls: false,",
        "S4"
      );
    }
  },
  {
    id: "S5",
    name: "Guard S5: prematurely throw AgentStopped when soft budget target is reached",
    mutate: () => {
      applyBudgetMutation(
        "const admission = this.modelAdmission.then(async () => {",
        "const admission = this.modelAdmission.then(async () => { if (this.used.modelCalls >= Math.floor(this.selectedLimits.modelCalls * this.softRatio)) throw new AgentStopped('model_limit');",
        "S5"
      );
    }
  }
];

console.log("=== Starting REQ-005 PR 6 Soft Budget Mutation Verification ===\n");
let passedAll = true;

try {
  for (const m of mutations) {
    console.log(`Testing [${m.id}]: ${m.name}...`);
    m.mutate();
    try {
      execSync("node --test tests/agent-budget.test.ts", {
        stdio: "pipe",
        encoding: "utf8"
      });
      console.error(`  FAIL: Mutation ${m.id} was NOT caught by tests!`);
      passedAll = false;
    } catch (err) {
      console.log(`  PASSED: Mutation ${m.id} successfully caught by tests (exit code ${err.status}).`);
    } finally {
      restoreAll();
    }
  }
} finally {
  restoreAll();
}

if (!passedAll) {
  console.error("\nSome soft budget mutations were not caught!");
  process.exit(1);
} else {
  console.log("\nAll soft budget mutations (S1-S5) verified successfully (fail-on-mutation green).");
  process.exit(0);
}
