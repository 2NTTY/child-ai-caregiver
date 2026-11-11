import assert from "node:assert/strict";
import test from "node:test";
import {
  createRunContextCompactor,
  createManagedCompactionModel,
  DEFAULT_COMPACTION_PROMPT,
  type InRunCompactionConfig
} from "../server/context-compactor.ts";
import { AgentStopped } from "../server/agent-budget.ts";
import { AgentGatewayModel } from "../server/agent-model-gateway.ts";
import { createEvent, type BaseLlm, type LlmRequest, type LlmResponse, type InvocationContext, type Session, type BaseContextCompactor } from "@google/adk";

function createMockLlm(summaryText: string = "Summarized interactions."): BaseLlm {
  return {
    async *generateContentAsync(request: LlmRequest, stream: boolean = false): AsyncGenerator<LlmResponse, void, unknown> {
      yield {
        content: {
          role: "model",
          parts: [{ text: summaryText }]
        }
      } as LlmResponse;
    }
  } as unknown as BaseLlm;
}

function createMockSession(events: any[] = []): Session {
  return {
    id: "mock_session_1",
    events: events.map(event => createEvent({ ...event, author: event.author === "model" ? "yuban_agent" : event.author }))
  } as unknown as Session;
}

function createMockInvocationContext(session: Session): InvocationContext {
  return {
    session,
    agent: { name: "yuban_agent" },
    isolationScope: undefined
  } as unknown as InvocationContext;
}

test("in-run context compaction triggers when token threshold is exceeded and remains transient", async () => {
  const model = createMockLlm("Key points: user asked for advice, caregiver answered.");
  const compactor = createRunContextCompactor({
    model,
    tokenThreshold: 100,
    eventRetentionSize: 2
  });

  const session = createMockSession([
    { author: "user", content: { role: "user", parts: [{ text: "A".repeat(300) }] }, timestamp: 1000 },
    { author: "model", content: { role: "model", parts: [{ text: "B".repeat(300) }] }, timestamp: 1001 },
    { author: "user", content: { role: "user", parts: [{ text: "Recent user question" }] }, timestamp: 1002 },
    { author: "model", content: { role: "model", parts: [{ text: "Recent model reply" }] }, timestamp: 1003, usageMetadata: { promptTokenCount: 200 } }
  ]);
  const ctx = createMockInvocationContext(session);

  assert.equal(compactor.shouldCompact(ctx), true, "Compactor should trigger when estimated tokens exceed threshold");

  await compactor.compact(ctx);

  assert.equal(session.events.length, 5, "Session events should now include the compacted summary event");
  const compacted = session.events[session.events.length - 1];
  assert.equal(compacted.author, "system");
  assert.equal((compacted as any).content?.role, "model");
  assert.match((compacted as any).content?.parts?.[0]?.text ?? "", /Key points/);
});

test("tool-call and response atomicity is strictly preserved across compaction", async () => {
  const model = createMockLlm("Tool executed successfully.");
  const compactor = createRunContextCompactor({
    model,
    tokenThreshold: 50,
    eventRetentionSize: 2
  });

  const session = createMockSession([
    { author: "user", content: { role: "user", parts: [{ text: "Query data" }] }, timestamp: 100 },
    {
      author: "yuban_agent",
      content: { role: "model", parts: [{ functionCall: { name: "check_schedule", args: {} } }] },
      timestamp: 101
    },
    {
      author: "yuban_agent",
      content: { role: "user", parts: [{ functionResponse: { name: "check_schedule", response: { ok: true } } }] },
      timestamp: 102
    },
    { author: "yuban_agent", content: { role: "model", parts: [{ text: "Here is your schedule." }] }, timestamp: 103 }
  ]);
  const ctx = createMockInvocationContext(session);

  await compactor.compact(ctx);

  const rawEvents = session.events.filter(e => e.author !== "system");
  assert.equal(rawEvents.length, 4, "Raw events preserved intact in session");

  const compacted = session.events.find(e => e.author === "system") as any;
  assert.ok(compacted, "Compacted event must exist in session");
  assert.equal(compacted.endTime, 100, "Compactor stepped retain index back across functionResponse/call pair so endTime is 100");

  const activeEvents = session.events.filter(e => e.author !== "system" && e.timestamp > compacted.endTime);
  assert.equal(activeEvents.length, 3, "Retains 3 events instead of naive 2, protecting the call/response pair");
  assert.ok(activeEvents.some(e => e.content?.parts?.some((p: any) => p.functionCall)), "FunctionCall retained in active window");
  assert.ok(activeEvents.some(e => e.content?.parts?.some((p: any) => p.functionResponse)), "FunctionResponse retained in active window");
});

test("event retention size leaves the most recent n events uncompacted", async () => {
  const model = createMockLlm("Earlier history summarized.");
  const compactor = createRunContextCompactor({
    model,
    tokenThreshold: 50,
    eventRetentionSize: 3
  });

  const session = createMockSession([
    { author: "user", content: { role: "user", parts: [{ text: "Old message 1" }] }, timestamp: 10 },
    { author: "model", content: { role: "model", parts: [{ text: "Old message 2" }] }, timestamp: 20 },
    { author: "user", content: { role: "user", parts: [{ text: "Recent 1" }] }, timestamp: 30 },
    { author: "model", content: { role: "model", parts: [{ text: "Recent 2" }] }, timestamp: 40 },
    { author: "user", content: { role: "user", parts: [{ text: "Recent 3" }] }, timestamp: 50 }
  ]);
  const ctx = createMockInvocationContext(session);

  await compactor.compact(ctx);

  const compactedEvent = session.events.find(e => e.author === "system");
  assert.ok(compactedEvent, "Compacted event was created");
  assert.equal((compactedEvent as any).startTime, 10);
  assert.equal((compactedEvent as any).endTime, 20);
});

test("budget admission is enforced and charged upon compaction model calls", async () => {
  let admissionCount = 0;
  const mockBudget = {
    admitModel: async () => {
      admissionCount++;
    },
    counts: { modelCalls: 0 }
  };

  const model = createMockLlm("Summary generated.");
  const compactor = createRunContextCompactor({
    model,
    tokenThreshold: 20,
    eventRetentionSize: 1,
    budget: mockBudget
  });

  const session = createMockSession([
    { author: "user", content: { role: "user", parts: [{ text: "Message A".repeat(20) }] }, timestamp: 1 },
    { author: "model", content: { role: "model", parts: [{ text: "Message B".repeat(20) }] }, timestamp: 2 },
    { author: "user", content: { role: "user", parts: [{ text: "Message C" }] }, timestamp: 3 }
  ]);
  const ctx = createMockInvocationContext(session);

  await compactor.compact(ctx);

  assert.equal(admissionCount, 1, "Compaction call must be admitted through budget exactly once");
});

test("anti-extrapolation and anti-consent prompt invariants are strictly present", () => {
  assert.ok(
    DEFAULT_COMPACTION_PROMPT.includes("Do not extrapolate"),
    "Prompt must explicitly forbid extrapolation"
  );
  assert.ok(
    DEFAULT_COMPACTION_PROMPT.includes("claim user consent"),
    "Prompt must explicitly forbid claiming unverified user consent"
  );
});

test("tied retention boundary defers compaction without spending budget or changing timestamps", async () => {
  let admissions = 0;
  const model = createMockLlm("Batch summary.");
  const compactor = createRunContextCompactor({
    model,
    tokenThreshold: 20,
    eventRetentionSize: 2,
    budget: { admitModel: async () => { admissions++; } }
  });

  const session = createMockSession([
    { author: "user", content: { role: "user", parts: [{ text: "M1" }] }, timestamp: 500 },
    { author: "model", content: { role: "model", parts: [{ text: "M2" }] }, timestamp: 500 },
    { author: "user", content: { role: "user", parts: [{ text: "M3" }] }, timestamp: 500 },
    { author: "model", content: { role: "model", parts: [{ text: "M4" }] }, timestamp: 500 }
  ]);
  const ctx = createMockInvocationContext(session);
  const original = JSON.stringify(session.events);

  await compactor.compact(ctx);
  assert.equal(JSON.stringify(session.events), original);
  assert.equal(admissions, 0);

  session.events.push(createEvent({ author: "user", content: { role: "user", parts: [{ text: "New question" }] }, timestamp: 501 }),
    createEvent({ author: "yuban_agent", content: { role: "model", parts: [{ text: "New reply" }] }, timestamp: 502 }));
  await compactor.compact(ctx);
  const compacted = session.events.find(event => event.author === "system") as any;
  assert.ok(compacted);
  assert.equal(compacted.endTime, 500);
  assert.equal(JSON.stringify(session.events.slice(0, 4)), original);
  assert.deepEqual(session.events.filter(event => event.author !== "system" && event.timestamp > compacted.endTime).map(event => event.timestamp), [501, 502]);
  assert.equal(admissions, 1);
});

test("native trigger respects isolated visibility and observed token usage", async () => {
  const compactor = createRunContextCompactor({ model: createMockLlm(), tokenThreshold: 100, eventRetentionSize: 1 });
  const session = createMockSession([
    { author: "user", content: { role: "user", parts: [{ text: "A".repeat(2000) }] }, timestamp: 1, isolationScope: "other" },
    { author: "model", content: { role: "model", parts: [{ text: "B".repeat(2000) }] }, timestamp: 2, isolationScope: "other" },
    { author: "user", content: { role: "user", parts: [{ text: "Local question" }] }, timestamp: 3, isolationScope: "local" },
    { author: "model", content: { role: "model", parts: [{ text: "Local answer" }] }, timestamp: 4, isolationScope: "local" },
  ]);
  const ctx = createMockInvocationContext(session);
  session.events.push(...createMockSession([
    { author: "user", content: { role: "user", parts: [{ text: "Global question" }] }, timestamp: 5 },
    { author: "yuban_agent", content: { role: "model", parts: [{ text: "Answer" }] }, timestamp: 6 }
  ]).events);
  await compactor.compact(ctx);
  assert.equal(session.events.length, 6, "A global summary cannot replace another scope's active history");
  session.events.splice(4);
  ctx.isolationScope = "local";
  assert.equal(compactor.shouldCompact(ctx), false, "Hidden scope cannot inflate the local token estimate");
  session.events.at(-1)!.usageMetadata = { promptTokenCount: 2 };
  session.events.at(-1)!.content!.parts = [{ text: "C".repeat(2000) }];
  assert.equal(compactor.shouldCompact(ctx), false, "Observed token usage takes precedence over character estimates");
});

test("pre-stream cancellation throws immediately if signal is aborted", async () => {
  const controller = new AbortController();
  controller.abort(new Error("pre-stream abort"));

  const emptyModel = {
    async *generateContentAsync() {}
  } as unknown as BaseLlm;
  const managed = createManagedCompactionModel(emptyModel, undefined, controller.signal);
  const gen = managed.generateContentAsync({ contents: [] } as any, false);

  await assert.rejects(
    async () => {
      await gen.next();
    },
    (err: any) => /abort/i.test(err?.message || err?.name)
  );
});

test("mid-stream chunk cancellation throws when signal is aborted during generation", async () => {
  const controller = new AbortController();
  const multiChunkModel = {
    async *generateContentAsync() {
      yield { content: { role: "model", parts: [{ text: "chunk 1" }] } } as LlmResponse;
      controller.abort(new Error("mid-stream abort"));
      yield { content: { role: "model", parts: [{ text: "chunk 2" }] } } as LlmResponse;
    }
  } as unknown as BaseLlm;

  const managed = createManagedCompactionModel(multiChunkModel, undefined, controller.signal);
  const gen = managed.generateContentAsync({ contents: [] } as any, false);

  const first = await gen.next();
  assert.equal(first.done, false);

  await assert.rejects(
    async () => {
      await gen.next();
    },
    (err: any) => /abort/i.test(err?.message || err?.name)
  );
});

test("compactor rethrows abort error without swallowing into fallback", async () => {
  const abortError = new Error("Direct AbortError");
  abortError.name = "AbortError";

  const abortingModel = {
    async *generateContentAsync() {
      throw abortError;
    }
  } as unknown as BaseLlm;

  const compactor = createRunContextCompactor({
    model: abortingModel,
    tokenThreshold: 10,
    eventRetentionSize: 1
  });

  const session = createMockSession([
    { author: "user", content: { role: "user", parts: [{ text: "A".repeat(50) }] }, timestamp: 1 },
    { author: "user", content: { role: "user", parts: [{ text: "B" }] }, timestamp: 2 }
  ]);
  const ctx = createMockInvocationContext(session);

  await assert.rejects(
    async () => {
      await compactor.compact(ctx);
    },
    (err: any) => err?.name === "AbortError"
  );
});

test("agent runtime auto-wires contextCompaction into agentConfig", async () => {
  const { createAgentRuntime } = await import("../server/agent-runtime.ts");
  const { readAiConfig } = await import("../server/ai-config.ts");

  let spyCalled = false;
  const spyCompactor: BaseContextCompactor = {
    shouldCompact() {
      spyCalled = true;
      return false;
    },
    compact: async () => {}
  };

  const runtime = createAgentRuntime({
    config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    usage: { reserve: async () => true, record: async () => {} },
    provider: {
      generate: async () => {
        return { content: { role: "model", parts: [{ text: "done" }] }, finishReason: "STOP" } as any;
      }
    }
  });

  await runtime.run({
    scope: { userId: "u1", childId: "c1", workspaceId: "w1", authorizationVersion: "1", dataVersion: "1" },
    recipeId: "p1-chat",
    trigger: { kind: "interactive", reference: "test" },
    messages: [{ role: "user", text: "hello" }],
    tools: [],
    authorize: async () => true,
    contextCompactors: [spyCompactor],
    finalize: async () => null
  });

  assert.equal(spyCalled, true, "Agent runtime must wire contextCompactors into agentConfig");
});

test("managed compaction model avoids double admitModel when model is agent gateway model", async () => {
  let admits = 0;
  const mockBudget = {
    admitModel: async () => { admits++; }
  };
  const fakeGateway = Object.create(AgentGatewayModel.prototype);
  fakeGateway.generateContentAsync = async function* () {
    // AgentGatewayModel internally calls admitModel
    await mockBudget.admitModel();
    yield { content: { role: "model", parts: [{ text: "done" }] } };
  };

  const managed = createManagedCompactionModel(fakeGateway, mockBudget);
  const dummyRequest: LlmRequest = { contents: [], liveConnectConfig: {}, toolsDict: {} };
  const generator = managed.generateContentAsync(dummyRequest, false);
  for await (const _ of generator) {
    // consume generator
  }

  assert.equal(admits, 1, "budget.admitModel must be called exactly once inside gateway, not double-debited by proxy");
});
