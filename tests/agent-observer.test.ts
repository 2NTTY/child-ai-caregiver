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
