import assert from "node:assert/strict";
import test from "node:test";
import { AgentBudget } from "../server/agent-budget.ts";

test("each kind of attempt has an independent finite budget", () => {
  const budget = new AgentBudget();
  try {
    budget.take("modelCalls", 4);
    budget.take("toolCalls", 8);
    budget.take("queryEmbeddings", 2);
    assert.throws(() => budget.take("modelCalls"), { reason: "model_limit" });
    assert.throws(() => budget.take("toolCalls"), { reason: "tool_limit" });
    assert.throws(() => budget.take("queryEmbeddings"), { reason: "embedding_limit" });
    assert.deepEqual(budget.counts, { modelCalls: 4, toolCalls: 8, queryEmbeddings: 2 });
  } finally { budget.close(); }
});

test("cancellation prevents starting work and stops waiting for an uncooperative operation", async () => {
  const controller = new AbortController();
  const budget = new AgentBudget(controller.signal);
  try {
    const waiting = budget.wait(() => new Promise(() => {}));
    controller.abort();
    await assert.rejects(waiting, { reason: "cancelled" });
    let started = false;
    await assert.rejects(budget.wait(async () => { started = true; }), { reason: "cancelled" });
    assert.equal(started, false);
  } finally { budget.close(); }
});

test("one deadline bounds model and tool waits and cannot exceed the production maximum", async () => {
  assert.throws(() => new AgentBudget(undefined, 90001));
  const budget = new AgentBudget(undefined, 10);
  try {
    await assert.rejects(budget.wait(() => new Promise(() => {})), { reason: "deadline" });
    assert.throws(() => budget.take("toolCalls"), { reason: "deadline" });
  } finally { budget.close(); }
});
