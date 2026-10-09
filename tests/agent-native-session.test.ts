import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { BaseSessionService, InMemorySessionService, type AppendEventRequest, type CreateSessionRequest, type DeleteSessionRequest, type GetSessionRequest, type ListSessionsRequest, type LlmRequest } from "@google/adk";
import { FinishReason } from "@google/genai";
import { z } from "zod";
import { createAgentRuntime, type AgentRunInput } from "../server/agent-runtime.ts";
import { readAiConfig } from "../server/ai-config.ts";
import { nativeSessionProductFixture } from "./helpers/native-session-product.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
type Stage = "create" | "get" | "seed" | "input" | "model" | "response" | "delete";
class InstrumentedSessions extends BaseSessionService {
  readonly delegate = new InMemorySessionService();
  log: Stage[] = [];
  before?: (stage: Stage, request: unknown) => Promise<void>;
  after?: (stage: Stage, request: unknown) => Promise<void>;
  async operation<T>(stage: Stage, request: unknown, action: () => Promise<T>) {
    this.log.push(stage); await this.before?.(stage, request);
    const result = await action(); await this.after?.(stage, request); return result;
  }
  override createSession(request: CreateSessionRequest) { return this.operation("create", request, () => this.delegate.createSession(request)); }
  override getSession(request: GetSessionRequest) { return this.operation("get", request, () => this.delegate.getSession(request)); }
  override appendEvent(request: AppendEventRequest) {
    const parts = request.event.content?.parts ?? [];
    const stage: Stage = request.event.invocationId === request.session.id ? "seed"
      : parts.some(part => part.functionResponse) ? "response" : request.event.author === "user" ? "input" : "model";
    return this.operation(stage, request, () => this.delegate.appendEvent(request));
  }
  listSessions(request: ListSessionsRequest) { return this.delegate.listSessions(request); }
  override deleteSession(request: DeleteSessionRequest) { return this.operation("delete", request, () => this.delegate.deleteSession(request)); }
}
function fixture(nativeSessionService = new InstrumentedSessions()) {
  let calls = 0, effects = 0, finalized = 0, authorized = true;
  const requests: LlmRequest[] = [];
  const runtime = createAgentRuntime({ nativeSessionService,
    config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    usage: { reserve: async () => true, record: async () => {} },
    provider: { generate: async request => {
      const index = calls++;
      assert.ok(index < 2, "No retry or closing provider call is allowed");
      requests.push(structuredClone({ ...request, toolsDict: {} }));
      return { content: { role: "model", parts: [{ functionCall: { id: `synthetic-call-${index}`,
        name: index === 0 ? "read_context" : "present_answer", args: {} }, thoughtSignature: "opaque-native-signature" }] }, finishReason: FinishReason.STOP };
    } } });
  const input: AgentRunInput = { runId: "synthetic-native-run", scope: { userId: "synthetic-user", childId: "synthetic-child", workspaceId: "synthetic-workspace", authorizationVersion: "1", dataVersion: "epoch:1" },
    recipeId: "p1-chat", trigger: { kind: "interactive", reference: "synthetic-message" },
    messages: [{ role: "user", text: "Synthetic seed" }, { role: "model", text: "Synthetic prior response" }, { role: "user", text: "Synthetic current request" }],
    tools: [{ name: "read_context", description: "Read synthetic context", parameters: z.object({}), authorize: async () => authorized,
      execute: async () => { effects++; return { status: "succeeded", reference: "synthetic-original-receipt" }; } },
    { name: "present_answer", description: "Prepare synthetic presentation", terminal: true, parameters: z.object({}), authorize: async () => authorized,
      execute: async () => ({ status: "succeeded" }) }],
    authorize: async () => authorized, finalize: async () => { finalized++; return "Verified synthetic presentation"; } };
  return { runtime, input, sessions: nativeSessionService, requests, revoke: () => { authorized = false; },
    observe: () => ({ calls, effects, finalized }) };
}

test("injected native session preserves two-step Runner parts and terminal presentation then cleans up", async () => {
  const s = fixture();
  assert.deepEqual(s.sessions.log, [], "Construction must do no storage I/O");
  const result = await s.runtime.run(s.input);
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(result.text, "Verified synthetic presentation");
  assert.deepEqual(s.observe(), { calls: 2, effects: 1, finalized: 1 });
  assert.deepEqual(result.counts, { modelCalls: 2, toolCalls: 2, queryEmbeddings: 0 });
  assert.deepEqual(s.sessions.log, ["create", "seed", "seed", "get", "input", "model", "response", "model", "response", "delete"]);
  const parts = s.requests[1].contents.flatMap(content => content.parts ?? []);
  assert.ok(parts.some(part => part.functionResponse?.id === "synthetic-call-0"));
  assert.ok(parts.some(part => part.thoughtSignature === "opaque-native-signature"));
  assert.doesNotMatch(JSON.stringify(result), /opaque-native-signature|Synthetic seed/);
  assert.equal(await s.sessions.getSession({ appName: "yuban_hk", userId: s.input.scope.userId, sessionId: s.input.runId! }), undefined);
});

for (const committed of [false, true]) test(`failed create is never retried or deleted, committed=${committed}`, async () => {
  const s = fixture();
  const fail = async (stage: Stage) => { if (stage === "create") throw new Error("synthetic create failure"); };
  if (committed) s.sessions.after = fail; else s.sessions.before = fail;
  const result = await s.runtime.run(s.input);
  assert.equal(result.stopReason, "unavailable"); assert.equal(result.text, null);
  assert.deepEqual(s.observe(), { calls: 0, effects: 0, finalized: 0 });
  assert.deepEqual(s.sessions.log, ["create"]);
  const stored = await s.sessions.getSession({ appName: "yuban_hk", userId: s.input.scope.userId, sessionId: s.input.runId! });
  assert.equal(Boolean(stored), committed);
});

test("create collision preserves the prior session without read, fallback or delete", async () => {
  const s = fixture();
  const key = { appName: "yuban_hk", userId: s.input.scope.userId, sessionId: s.input.runId! };
  await s.sessions.createSession({ ...key, state: { sentinel: "synthetic-existing-owner" } });
  s.sessions.log.length = 0;
  s.sessions.before = async stage => { if (stage === "create") throw new Error("session_exists"); };
  assert.equal((await s.runtime.run(s.input)).stopReason, "unavailable");
  assert.deepEqual(s.sessions.log, ["create"]);
  assert.equal((await s.sessions.getSession(key))?.state.sentinel, "synthetic-existing-owner");
  assert.deepEqual(s.observe(), { calls: 0, effects: 0, finalized: 0 });
});

for (const stage of ["seed", "get", "input", "model", "response"] as const) test(`storage ${stage} failure stops without fallback and cleans only its new session`, async () => {
  const s = fixture();
  s.sessions.before = async current => { if (current === stage) throw new Error("synthetic storage failure"); };
  const result = await s.runtime.run(s.input);
  assert.equal(result.stopReason, "unavailable", JSON.stringify(result));
  assert.equal(result.text, null); assert.equal(s.sessions.log.filter(value => value === "create").length, 1);
  assert.equal(s.sessions.log.at(-1), "delete");
  assert.deepEqual(s.observe(), { calls: ["model", "response"].includes(stage) ? 1 : 0, effects: stage === "response" ? 1 : 0, finalized: 0 });
  assert.equal(result.tools.some(tool => tool.reference === "synthetic-original-receipt"), stage === "response");
});

for (const stage of ["create", "seed", "get", "input", "model", "response", "delete"] as const) {
  for (const stop of ["cancelled", "unauthorized"] as const) test(`${stop} during ${stage} await blocks later storage/model/tool operations`, async () => {
    const s = fixture(), controller = new AbortController(); s.input.signal = controller.signal;
    const entered = deferred(), release = deferred();
    s.sessions.after = async current => { if (current === stage) { entered.resolve(); await release.promise; } };
    const run = s.runtime.run(s.input);
    await entered.promise;
    const atStop = { ...s.observe(), length: s.sessions.log.length };
    if (stop === "cancelled") controller.abort(); else s.revoke();
    release.resolve();
    const result = await run; await nextTurn();
    assert.equal(result.status, "stopped"); assert.equal(result.stopReason, stop, JSON.stringify(result));
    assert.equal(result.text, null); assert.deepEqual(result.tools, []);
    assert.deepEqual(s.observe(), { calls: atStop.calls, effects: atStop.effects, finalized: atStop.finalized });
    assert.equal(s.sessions.log.length, atStop.length, "No new cleanup/storage operation is permitted after the stop");
  });
}

test("a late create acknowledgement after deadline cannot trigger a blind delete or provider call", async () => {
  const s = fixture(), entered = deferred(), release = deferred(), settled = deferred();
  s.input.deadlineMs = 100;
  s.sessions.after = async stage => { if (stage === "create") { entered.resolve(); await release.promise; settled.resolve(); } };
  const run = s.runtime.run(s.input); await entered.promise;
  const result = await run;
  assert.equal(result.stopReason, "deadline"); assert.deepEqual(s.sessions.log, ["create"]);
  release.resolve(); await settled.promise; await nextTurn();
  assert.deepEqual(s.sessions.log, ["create"]); assert.deepEqual(s.observe(), { calls: 0, effects: 0, finalized: 0 });
});

test("cleanup failure preserves the primary finalization stop and original successful tool receipt", async () => {
  const s = fixture();
  s.sessions.before = async stage => { if (stage === "delete") throw new Error("synthetic cleanup failure"); };
  // An explicit typed primary reason must survive a different cleanup exception.
  const { AgentStopped } = await import("../server/agent-budget.ts");
  s.input.finalize = async () => { throw new AgentStopped("invalid_response"); };
  const result = await s.runtime.run(s.input);
  assert.equal(result.stopReason, "invalid_response");
  assert.equal(result.tools[0].reference, "synthetic-original-receipt");
  assert.equal(s.observe().effects, 1); assert.equal(s.sessions.log.filter(stage => stage === "delete").length, 1);
});

for (const stage of ["response", "delete"] as const) test(`product receipt survives ${stage} failure and duplicate message reuses the original run`, async () => {
  const sessions = new InstrumentedSessions();
  sessions.before = async (current, request) => {
    if (stage === "delete" && current === "delete" || stage === "response" && current === "response"
      && (request as AppendEventRequest).event.content?.parts?.some(part => part.functionResponse?.name === "change_family_document")) throw new Error("synthetic persistence failure");
  };
  const s = nativeSessionProductFixture(sessions, `synthetic-product-${stage}`);
  const first = await s.reply();
  assert.equal(first?.status, "stopped", JSON.stringify(first)); assert.equal(first.stopReason, "unavailable");
  assert.match(first.text, /文件操作已保存/);
  assert.ok(first.tools.some(tool => tool.name === "change_family_document" && tool.status === "succeeded" && tool.reference === s.documentId));
  assert.deepEqual(await s.reply(), first);
  const observed = s.observe();
  assert.equal(observed.writes, 1); assert.equal(observed.documentVersion, 4);
  assert.equal(observed.calls, stage === "response" ? 2 : 3);
  assert.deepEqual(observed.ledger.map(receipt => receipt.operationId), [s.operationId]);
  assert.equal(sessions.log.filter(value => value === "create").length, 1);
});
