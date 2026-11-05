import fs from "node:fs";
import { execSync } from "node:child_process";

const COMPACTOR_PATH = "server/context-compactor.ts";
const RUNTIME_PATH = "server/agent-runtime.ts";

const originalCompactor = fs.readFileSync(COMPACTOR_PATH, "utf8");
const originalRuntime = fs.readFileSync(RUNTIME_PATH, "utf8");

function restoreAll() {
  fs.writeFileSync(COMPACTOR_PATH, originalCompactor, "utf8");
  fs.writeFileSync(RUNTIME_PATH, originalRuntime, "utf8");
}

function applyCompactorMutation(target, replacement, id) {
  const code = originalCompactor.replace(target, replacement);
  if (code === originalCompactor) {
    throw new Error(`Mutation pattern for ${id} failed to match in ${COMPACTOR_PATH}!`);
  }
  fs.writeFileSync(COMPACTOR_PATH, code, "utf8");
}

function applyRuntimeMutation(target, replacement, id) {
  const code = originalRuntime.replace(target, replacement);
  if (code === originalRuntime) {
    throw new Error(`Mutation pattern for ${id} failed to match in ${RUNTIME_PATH}!`);
  }
  fs.writeFileSync(RUNTIME_PATH, code, "utf8");
}

const mutations = [
  {
    id: "C1",
    name: "Guard C1: omit root budget admission debit in managed compaction model",
    mutate: () => {
      applyCompactorMutation(
        "await budget.admitModel();",
        "/* MUTATION C1: omitted budget.admitModel() */",
        "C1"
      );
    }
  },
  {
    id: "C2",
    name: "Guard C2: omit pre-stream cancellation check on abort signal",
    mutate: () => {
      applyCompactorMutation(
        /signal\?\.throwIfAborted\(\);\r?\n\s*if \(!isGatewayModel/,
        "/* MUTATION C2: omitted pre-stream check */ if (!isGatewayModel",
        "C2"
      );
    }
  },
  {
    id: "C3",
    name: "Guard C3: omit mid-stream chunk cancellation check on abort signal",
    mutate: () => {
      applyCompactorMutation(
        /signal\?\.throwIfAborted\(\);\r?\n\s*yield chunk;/,
        "/* MUTATION C3: omitted mid-stream check */ yield chunk;",
        "C3"
      );
    }
  },
  {
    id: "C4",
    name: "Guard C4: swallow AbortError in compaction error fallback handler",
    mutate: () => {
      applyCompactorMutation(
        'err?.name === "AbortError" ||',
        'false && /* MUTATION C4: swallowed AbortError */',
        "C4"
      );
    }
  },
  {
    id: "C5",
    name: "Guard C5: remove anti-extrapolation and consent invariants from DEFAULT_COMPACTION_PROMPT",
    mutate: () => {
      applyCompactorMutation(
        "Do not extrapolate, infer unmentioned facts, or claim user consent.",
        "/* MUTATION C5: removed invariants */",
        "C5"
      );
    }
  },
  {
    id: "C6",
    name: "Guard C6: omit runtime auto-wiring of AgentRunInput.contextCompaction",
    mutate: () => {
      applyRuntimeMutation(
        "effectiveCompactors.length ? { contextCompactors: effectiveCompactors } : {}",
        "/* MUTATION C6: omitted wiring */ {}",
        "C6"
      );
    }
  }
];

console.log("=== Starting REQ-005 PR 5 In-Run Compaction Mutation Verification ===\n");
let passedAll = true;

try {
  for (const m of mutations) {
    console.log(`Testing [${m.id}]: ${m.name}...`);
    m.mutate();
    try {
      execSync("node --test tests/agent-context-compaction.test.ts", {
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
  console.error("\nSome compaction mutations were not caught!");
  process.exit(1);
} else {
  console.log("\nAll compaction mutations (C1-C6) verified successfully (fail-on-mutation green).");
  process.exit(0);
}
