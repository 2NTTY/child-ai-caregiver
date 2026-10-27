import assert from "node:assert/strict";
import test from "node:test";
import { AgentBudget, AGENT_LIMITS } from "../server/agent-budget.ts";

test("each kind of attempt has an independent finite budget", () => {
  const budget = new AgentBudget();
  try {
    budget.take("modelCalls", 4);
    budget.take("toolCalls", AGENT_LIMITS.toolCalls);
    budget.take("queryEmbeddings", 2);
    assert.throws(() => budget.take("modelCalls"), { reason: "model_limit" });
    assert.throws(() => budget.take("toolCalls"), { reason: "tool_limit" });
    assert.throws(() => budget.take("queryEmbeddings"), { reason: "embedding_limit" });
    assert.deepEqual(budget.counts, { modelCalls: 4, toolCalls: AGENT_LIMITS.toolCalls, queryEmbeddings: 2 });
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

test("planningSnapshot hard-reserves delivery review and finishes early enough to leave a review call", () => {
  assert.equal(AGENT_LIMITS.modelCalls, 4);
  const budget = new AgentBudget();
  try {
    budget.take("modelCalls", 2);
    const plain = budget.planningSnapshot(true);
    assert.equal(plain.phase, "work");
    assert.equal(plain.reserveForFinish.modelCalls, 1);
    assert.equal(plain.reserveForDeliveryReview.modelCalls, 0);

    const reserved = budget.planningSnapshot(true, { reserveDeliveryReview: true });
    assert.equal(reserved.phase, "finish");
    assert.equal(reserved.reserveForFinish.modelCalls, 2);
    assert.equal(reserved.reserveForDeliveryReview.modelCalls, 1);
    assert.equal(reserved.remaining.modelCallsIncludingThisCall, 2);

    budget.take("modelCalls", 1);
    const lastWork = budget.planningSnapshot(true, { reserveDeliveryReview: true });
    assert.equal(lastWork.phase, "finish");
    assert.equal(lastWork.remaining.modelCallsIncludingThisCall, 1);
    assert.throws(() => budget.assertDeliveryReviewReserveAvailable(true), { reason: "delivery_review_incomplete" });

    const withoutReserve = budget.planningSnapshot(true);
    assert.equal(withoutReserve.phase, "finish");
    assert.doesNotThrow(() => budget.assertDeliveryReviewReserveAvailable(false));
  } finally { budget.close(); }
});

test("hard delivery-review reserve does not raise default modelCalls and skips for non-review paths", () => {
  assert.equal(AGENT_LIMITS.modelCalls, 4);
  const budget = new AgentBudget();
  try {
    assert.equal(budget.limits.modelCalls, 4);
    budget.take("modelCalls", 1);
    const mid = budget.planningSnapshot(true, { reserveDeliveryReview: true });
    assert.equal(mid.phase, "work");
    assert.equal(mid.reserveForFinish.modelCalls, 2);
    assert.equal(mid.remaining.modelCallsIncludingThisCall, 3);
    assert.doesNotThrow(() => budget.assertDeliveryReviewReserveAvailable(true));

    const greetingLike = budget.planningSnapshot(false);
    assert.equal(greetingLike.reserveForDeliveryReview.modelCalls, 0);
    assert.equal(greetingLike.reserveForFinish.modelCalls, 1);
    assert.equal(greetingLike.phase, "work");
  } finally { budget.close(); }
});
