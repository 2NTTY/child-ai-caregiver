import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { createAgentObserver } from "../server/agent-observer.ts";
import type { AgentDiagnostic } from "../server/agent-observer.ts";

test("observer emits metadata only and diagnostic sinks cannot change or block callbacks", async () => {
  const secret = "PRIVATE_SENTINEL_DO_NOT_EXPORT";
  const events: AgentDiagnostic[] = [];
  const observer = createAgentObserver({
    runId: "388c4fbb-b230-4496-b9b1-dfb2a3e07c5c",
    toolNames: ["read_context"],
    sink: event => {
      events.push(event);
      return Promise.reject(new Error(secret));
    },
  });
  const runParams = Object.freeze({
    invocationContext: Object.freeze({ userId: secret, session: Object.freeze({ content: secret }) }),
  }) as unknown as Parameters<typeof observer.beforeRunCallback>[0];
  const callbackContext = runParams.invocationContext as unknown as Parameters<typeof observer.beforeModelCallback>[0]["callbackContext"];
  const modelParams = Object.freeze({
    callbackContext,
    llmRequest: Object.freeze({ contents: secret, config: Object.freeze({ systemInstruction: secret }) }),
  }) as unknown as Parameters<typeof observer.beforeModelCallback>[0];
  const modelResult = Object.freeze({
    callbackContext,
    llmResponse: Object.freeze({ content: Object.freeze({ parts: [Object.freeze({ text: secret })] }) }),
  }) as unknown as Parameters<typeof observer.afterModelCallback>[0];
  const toolParams = Object.freeze({
    tool: Object.freeze({ name: "read_context", description: secret }),
    toolArgs: Object.freeze({ body: secret }),
    toolContext: callbackContext,
  }) as unknown as Parameters<typeof observer.beforeToolCallback>[0];
  const result = Object.freeze({ status: "succeeded", body: secret });
  const error = Object.freeze(new Error(secret));

  assert.equal(await observer.beforeRunCallback(runParams), undefined);
  assert.equal(await observer.beforeModelCallback(modelParams), undefined);
  assert.equal(await observer.afterModelCallback(modelResult), undefined);
  assert.equal(await observer.onModelErrorCallback({ ...modelParams, error }), undefined);
  assert.equal(await observer.beforeToolCallback(toolParams), undefined);
  assert.equal(await observer.afterToolCallback({ ...toolParams, result }), undefined);
  assert.equal(await observer.afterToolCallback({
    ...toolParams,
    tool: Object.freeze({ name: secret }) as typeof toolParams.tool,
    result: Object.freeze({ status: secret, body: secret }),
  }), undefined);
  assert.equal(await observer.onToolErrorCallback({ ...toolParams, error }), undefined);
  assert.equal(await observer.afterRunCallback(runParams), undefined);

  assert.deepEqual(events.map(event => event.phase), [
    "run_start", "model_start", "model_end", "model_error", "tool_start", "tool_end", "tool_end", "tool_error", "run_end",
  ]);
  for (const event of events) {
    assert.equal(event.runId, "388c4fbb-b230-4496-b9b1-dfb2a3e07c5c");
    assert.ok(Number.isFinite(event.elapsedMs) && event.elapsedMs >= 0);
    assert.ok(Object.keys(event).every(key => ["runId", "phase", "tool", "elapsedMs", "outcome"].includes(key)));
  }
  assert.equal(events[5]?.outcome, "succeeded");
  assert.equal(Object.hasOwn(events[6]!, "tool"), false);
  assert.equal(Object.hasOwn(events[6]!, "outcome"), false);
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE_SENTINEL_DO_NOT_EXPORT/u);
  assert.deepEqual(toolParams.toolArgs, { body: secret });
  assert.deepEqual(result, { status: "succeeded", body: secret });
  assert.equal(error.message, secret);

  const pendingObserver = createAgentObserver({
    runId: "ec1024c3-2432-4b16-befd-d146f77b1800",
    toolNames: [],
    sink: () => new Promise<void>(() => {}),
  });
  let callbackCompleted = false;
  void pendingObserver.beforeRunCallback(runParams).then(value => {
    assert.equal(value, undefined);
    callbackCompleted = true;
  });
  await setImmediate();
  assert.equal(callbackCompleted, true);
});

test("tool rejection diagnostics allow only configured tools and canonical metadata", () => {
  const secret = "PRIVATE_DIAGNOSTIC_SENTINEL";
  const events: AgentDiagnostic[] = [];
  const reads = { otherToolData: 0, unknownToolStatus: 0, successData: 0 };
  const observer = createAgentObserver({ runId: "synthetic-run", toolNames: ["propose_task", "save_record"], sink: event => { events.push(event); } });
  const hints = [
    { path: "values.dueAt", reason: "invalid_format", expected: secret, input: secret, message: secret },
    { path: secret, reason: "wrong_type" },
    { path: "values.title", reason: secret },
  ];
  observer.recordToolRejection("propose_task", "schema", { status: "rejected", data: { code: secret, hints } });
  observer.recordToolRejection("propose_task", "authorization", { status: "rejected", data: { code: secret, hints } });
  observer.recordToolRejection("propose_task", "execution", { status: "rejected", data: { code: "invalid_assignee", hints } });
  observer.recordToolRejection("propose_task", "execution", { status: "failed", data: { code: secret, hints } });
  observer.recordToolRejection("propose_task", "execution", { status: "unknown" });
  observer.recordToolRejection("save_record", "execution", { status: "conflict", get data() { reads.otherToolData++; return { code: secret }; } });
  observer.recordToolRejection(secret, "schema", { get status() { reads.unknownToolStatus++; return "rejected"; } });
  observer.recordToolRejection("propose_task", secret as "schema", { status: "rejected" });
  observer.recordToolRejection("propose_task", "execution", { status: secret, data: { code: secret } });
  observer.recordToolRejection("propose_task", "execution", { status: "succeeded", get data() { reads.successData++; return { code: secret }; } });
  assert.deepEqual(reads, { otherToolData: 0, unknownToolStatus: 0, successData: 0 });
  assert.equal(events.length, 6);
  assert.deepEqual(events.map(({ stage, code, outcome, hints }) => ({ stage, code, outcome, hints })), [
    { stage: "schema", code: "invalid_parameters", outcome: "rejected", hints: [{ path: "values.dueAt", reason: "invalid_format" }] },
    { stage: "authorization", code: "not_authorized", outcome: "rejected", hints: undefined },
    { stage: "execution", code: "invalid_assignee", outcome: "rejected", hints: undefined },
    { stage: "execution", code: "unknown", outcome: "failed", hints: undefined },
    { stage: "execution", code: "unknown", outcome: "unknown", hints: undefined },
    { stage: "execution", code: "unknown", outcome: "conflict", hints: undefined },
  ]);
  for (const event of events) {
    assert.equal(event.phase, "tool_rejection");
    assert.ok(Object.keys(event).every(key => ["runId", "phase", "tool", "elapsedMs", "outcome", "stage", "code", "hints"].includes(key)));
  }
  assert.doesNotMatch(JSON.stringify(events), new RegExp(secret, "u"));
});

test("tool rejection projection is bounded and ignores extra fields without affecting control flow", async () => {
  const events: AgentDiagnostic[] = [];
  const reads = { expected: 0, message: 0, input: 0, fourthHint: 0, disabledStatus: 0, malformedData: 0 };
  const hint = { path: "values.title", reason: "wrong_type", get expected() { reads.expected++; return "PRIVATE_EXPECTED"; },
    get message() { reads.message++; return "PRIVATE_MESSAGE"; }, get input() { reads.input++; return "PRIVATE_INPUT"; } };
  const observer = createAgentObserver({ runId: "synthetic-run", toolNames: ["propose_task"], sink: event => { events.push(event); } });
  observer.recordToolRejection("propose_task", "schema", { status: "rejected", data: {
    hints: [hint, { path: "values.details", reason: "out_of_range" }, { path: "values.dueAt", reason: "invalid_format" },
      { get path() { reads.fourthHint++; return "values.timeZone"; }, reason: "wrong_type" }],
  } });
  assert.equal(events[0]?.hints?.length, 3);
  assert.ok(JSON.stringify(events[0]!.hints).length <= 256);
  observer.recordToolRejection("propose_task", "schema", { status: "rejected", data: { hints: [hint, hint] } });
  assert.deepEqual(events[1]?.hints, [{ path: "values.title", reason: "wrong_type" }]);
  assert.doesNotThrow(() => observer.recordToolRejection("propose_task", "execution", {
    status: "rejected", get data(): never { reads.malformedData++; throw new Error("PRIVATE_GETTER_ERROR"); },
  }));
  for (const sink of [() => { throw new Error("PRIVATE_SINK_ERROR"); }, () => Promise.reject(new Error("PRIVATE_SINK_ERROR")),
    () => new Promise<void>(() => {})]) {
    const failing = createAgentObserver({ runId: "synthetic-run", toolNames: ["propose_task"], sink });
    assert.equal(failing.recordToolRejection("propose_task", "execution", { status: "rejected", data: { code: "invalid_input" } }), undefined);
  }
  const disabled = createAgentObserver({ runId: "synthetic-run", toolNames: ["propose_task"] });
  disabled.recordToolRejection("propose_task", "execution", { get status() { reads.disabledStatus++; return "rejected"; } });
  assert.deepEqual(reads, { expected: 0, message: 0, input: 0, fourthHint: 0, disabledStatus: 0, malformedData: 1 });
  assert.equal(events.length, 2);
  await setImmediate();
});
