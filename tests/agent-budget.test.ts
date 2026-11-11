import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentBudget,
  AGENT_LIMITS,
  DEFAULT_SOFT_BUDGET_RATIO,
  SOFT_BUDGET_RATIO_RANGE,
  freezeAgentRunLimits
} from "../server/agent-budget.ts";

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
  assert.throws(() => new AgentBudget(undefined, 900001));
  const deadlineAtMs = Date.now() + 10;
  const budget = new AgentBudget(undefined, 900000, deadlineAtMs);
  try {
    budget.configurePersonal({ modelCalls: 4, queryEmbeddings: 2, deadlineMs: 900000 });
    assert.equal(budget.deadlineAtMs, deadlineAtMs);
    await assert.rejects(budget.wait(() => new Promise(() => {})), { reason: "deadline" });
    assert.throws(() => budget.take("toolCalls"), { reason: "deadline" });
  } finally { budget.close(); }
});

test("planningSnapshot hard-reserves delivery review and finishes early enough to leave a review call", async () => {
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
    await assert.rejects(budget.admitModel({ reserveDeliveryReview: true }), { reason: "model_limit" });

    const withoutReserve = budget.planningSnapshot(true);
    assert.equal(withoutReserve.phase, "finish");
    await budget.admitModel();
    assert.equal(budget.counts.modelCalls, 4);
  } finally { budget.close(); }
});

test("hard delivery-review reserve does not raise default modelCalls and skips for non-review paths", async () => {
  assert.equal(AGENT_LIMITS.modelCalls, 4);
  const budget = new AgentBudget();
  try {
    assert.equal(budget.limits.modelCalls, 4);
    budget.take("modelCalls", 1);
    const mid = budget.planningSnapshot(true, { reserveDeliveryReview: true });
    assert.equal(mid.phase, "work");
    assert.equal(mid.reserveForFinish.modelCalls, 2);
    assert.equal(mid.remaining.modelCallsIncludingThisCall, 3);
    await budget.admitModel({ reserveDeliveryReview: true });
    assert.equal(budget.counts.modelCalls, 2);

    const greetingLike = budget.planningSnapshot(false);
    assert.equal(greetingLike.reserveForDeliveryReview.modelCalls, 0);
    assert.equal(greetingLike.reserveForFinish.modelCalls, 1);
    assert.equal(greetingLike.phase, "work");
  } finally { budget.close(); }
});

test("soft budget ratio derives normal planning targets at 0.25 without creating extra quota", () => {
  const budget = new AgentBudget();
  try {
    assert.equal(DEFAULT_SOFT_BUDGET_RATIO, 0.25);
    assert.equal(budget.softBudgetRatio, 0.25);
    assert.equal(budget.limits.modelCalls, 4);
    assert.equal(budget.limits.toolCalls, 16);
    assert.equal(budget.limits.queryEmbeddings, 2);

    const initial = budget.planningSnapshot(true);
    assert.equal(initial.softBudgetRatio, 0.25);
    assert.deepEqual(initial.softBudget, {
      modelCalls: 1, // floor(4 * 0.25)
      toolCalls: 4,   // floor(16 * 0.25)
      queryEmbeddings: 1 // max(1, floor(2 * 0.25))
    });
    assert.deepEqual(initial.softRemaining, {
      modelCalls: 1,
      toolCalls: 4,
      queryEmbeddings: 1
    });
    assert.deepEqual(initial.softExceeded, {
      modelCalls: false,
      toolCalls: false,
      queryEmbeddings: false,
      any: false
    });
  } finally { budget.close(); }
});

test("exceeding soft budget updates planning snapshot signals but allows continued progress within hard limits", async () => {
  const budget = new AgentBudget();
  try {
    // 1st model call reaches the soft target (1)
    await budget.admitModel();
    assert.equal(budget.counts.modelCalls, 1);

    const afterOne = budget.planningSnapshot(true);
    assert.equal(afterOne.softRemaining.modelCalls, 0);
    assert.equal(afterOne.softExceeded.modelCalls, true);
    assert.equal(afterOne.softExceeded.any, true);
    // Hard finish reserve is 1, remaining calls is 3 -> still in work phase
    assert.equal(afterOne.phase, "work");

    // 2nd model call exceeds soft target without throwing AgentStopped
    await budget.admitModel();
    assert.equal(budget.counts.modelCalls, 2);
    const afterTwo = budget.planningSnapshot(true);
    assert.equal(afterTwo.softRemaining.modelCalls, 0);
    assert.equal(afterTwo.softExceeded.modelCalls, true);
    assert.equal(afterTwo.remaining.modelCallsIncludingThisCall, 2);

    // 3rd model call reaches finish reserve (remaining = 1 <= reserve 1)
    await budget.admitModel();
    assert.equal(budget.counts.modelCalls, 3);
    const afterThree = budget.planningSnapshot(true);
    assert.equal(afterThree.phase, "finish");

    // 4th model call exhausts hard quota (4 of 4)
    await budget.admitModel();
    assert.equal(budget.counts.modelCalls, 4);

    // 5th model call must throw AgentStopped with model_limit
    await assert.rejects(budget.admitModel(), { reason: "model_limit" });
  } finally { budget.close(); }
});

test("custom soft budget ratio can be configured per run profile within legal bounds", () => {
  // Legal ratio range validation
  assert.equal(SOFT_BUDGET_RATIO_RANGE.min, 0.05);
  assert.equal(SOFT_BUDGET_RATIO_RANGE.max, 1.0);
  assert.equal(SOFT_BUDGET_RATIO_RANGE.default, 0.25);

  assert.throws(
    () => freezeAgentRunLimits({ modelCalls: 8, queryEmbeddings: 4, softBudgetRatio: -0.1 }),
    /Invalid agent soft budget ratio/
  );
  assert.throws(
    () => freezeAgentRunLimits({ modelCalls: 8, queryEmbeddings: 4, softBudgetRatio: 0.01 }),
    /Invalid agent soft budget ratio/
  );
  assert.throws(
    () => freezeAgentRunLimits({ modelCalls: 8, queryEmbeddings: 4, softBudgetRatio: 1.5 }),
    /Invalid agent soft budget ratio/
  );
  assert.throws(
    () => freezeAgentRunLimits({ modelCalls: 8, queryEmbeddings: 4, softBudgetRatio: Number.NaN }),
    /Invalid agent soft budget ratio/
  );

  const frozen = freezeAgentRunLimits({ modelCalls: 8, queryEmbeddings: 4, softBudgetRatio: 0.5 });
  assert.equal(frozen.softBudgetRatio, 0.5);

  const budget = new AgentBudget();
  try {
    budget.configurePersonal({
      modelCalls: 8,
      queryEmbeddings: 4,
      toolCalls: 16,
      softBudgetRatio: 0.5
    });
    assert.equal(budget.softBudgetRatio, 0.5);
    assert.equal(budget.limits.modelCalls, 8);

    const snapshot = budget.planningSnapshot(true);
    assert.equal(snapshot.softBudgetRatio, 0.5);
    assert.deepEqual(snapshot.softBudget, {
      modelCalls: 4, // floor(8 * 0.5)
      toolCalls: 8,  // floor(16 * 0.5)
      queryEmbeddings: 2 // floor(4 * 0.5)
    });
  } finally { budget.close(); }
});

test("planning snapshot exposes soft remaining and soft exceeded signals alongside hard reserves", () => {
  const budget = new AgentBudget();
  try {
    // Snapshot-level projection override does not change persistent ratio
    const customSnapshot = budget.planningSnapshot(true, {
      softBudgetRatio: 0.5,
      reserveDeliveryReview: true
    });
    assert.equal(customSnapshot.softBudgetRatio, 0.5);
    assert.equal(budget.softBudgetRatio, 0.25);
    assert.equal(customSnapshot.reserveForDeliveryReview.modelCalls, 1);
    assert.equal(customSnapshot.reserveForFinish.modelCalls, 2);
    assert.deepEqual(customSnapshot.softBudget, {
      modelCalls: 2, // floor(4 * 0.5)
      toolCalls: 8,  // floor(16 * 0.5)
      queryEmbeddings: 1 // floor(2 * 0.5)
    });

    // Tool calls soft remaining and soft exceeded behavior
    budget.take("toolCalls", 4);
    const afterTools = budget.planningSnapshot(true);
    assert.equal(afterTools.softBudget.toolCalls, 4);
    assert.equal(afterTools.softRemaining.toolCalls, 0);
    assert.equal(afterTools.softExceeded.toolCalls, true);
    assert.equal(afterTools.softExceeded.any, true);
    // Hard remaining tools is 12 (16 - 4)
    assert.equal(afterTools.remaining.toolCalls, 12);
  } finally { budget.close(); }
});
