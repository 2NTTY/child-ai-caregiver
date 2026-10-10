import assert from "node:assert/strict";
import test from "node:test";
import { InMemorySessionService } from "@google/adk";
import { FinishReason } from "@google/genai";
import { AgentBudget, agentBudgetFingerprint } from "../server/agent-budget.ts";
import { AgentGatewayModel } from "../server/agent-model-gateway.ts";
import { createKnowledgeRetriever } from "../server/knowledge-retriever.ts";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import { readAiConfig } from "../server/ai-config.ts";
import type { BudgetAttempt, DurableRootBudget, RootBudgetContext, RootBudgetSnapshot } from "../server/durable-root-budget.ts";
import type { InitialConversationSummary } from "../server/memory-summary.ts";

const config = readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" });
function admissionProbe(deadlineAtMs = Date.now() + 90_000) {
  const context: RootBudgetContext = { generation: 1, binding: { rootRunId: "synthetic-root", ownerId: "synthetic-user", workspaceId: "workspace", childId: "child",
    authorizationVersion: "1", storageEpoch: "epoch", trigger: { kind: "interactive", reference: "message" }, workflowVersion: "workflow",
    promptPackVersion: "0.1.37", settingsVersion: "fixed-settings", billingVersion: "fixed-billing", limits: { modelCalls: 4, toolCalls: 8, queryEmbeddings: 2 }, deadlineAtMs } };
  const snapshot: RootBudgetSnapshot = { generation: 1, deadlineAtMs, limits: { ...context.binding.limits }, used: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 }, status: "active", attempts: [] };
  // A unit-only admission probe. Persistent identity and restart are tested with the real emulator below.
  const adapter: DurableRootBudget = { open: async () => structuredClone(snapshot), read: async () => structuredClone(snapshot),
    reserve: async (_, attempt) => { const existing = snapshot.attempts.find(item => item.key === attempt.key);
      if (existing) return { decision: "lookup", attempt: existing, snapshot: structuredClone(snapshot) };
      snapshot.attempts.push({ ...attempt, outcome: { status: "reserved" } });
      snapshot.used[attempt.kind === "model" ? "modelCalls" : attempt.kind === "embedding" ? "queryEmbeddings" : "toolCalls"] += attempt.units;
      return { decision: "execute", attempt: snapshot.attempts.at(-1)!, snapshot: structuredClone(snapshot) }; },
    settle: async () => { throw new Error("No settlement permitted"); }, stop: async () => { snapshot.status = "stopped"; return structuredClone(snapshot); } };
  return { adapter, context, snapshot };
}

test("durable summary fingerprint matches the frozen outgoing payload and expiry after daily reserve stops dispatch", async () => {
  for (const expires of [false, true]) {
    const durable = admissionProbe(), budget = new AgentBudget(undefined, 90000, durable.context.binding.deadlineAtMs);
    await budget.initializeDurable(durable);
    let daily = 0, providers = 0, reserved = false; const realNow = Date.now, start = Date.now();
    const initial: InitialConversationSummary = { summary: { id: "synthetic-summary", version: 1, text: "Synthetic historical summary", createdAt: new Date(start).toISOString(), lastCoveredMessageId: "message" }, basis: "a".repeat(64), validUntil: new Date(start + 1000).toISOString() };
    const model = new AgentGatewayModel({ config, budget, userId: "synthetic-user", childId: "child", authorize: async () => true,
      modelAttemptKey: () => "model:synthetic-original", initialConversationSummary: initial,
      usage: { reserve: async () => { daily++; reserved = true; return true; }, record: async () => {} },
      provider: { generate: async outgoing => { providers++;
        assert.match(JSON.stringify(outgoing.contents), /Synthetic historical summary/);
        assert.equal(durable.snapshot.attempts[0].fingerprint, agentBudgetFingerprint({ model: config.model, contents: outgoing.contents, config: outgoing.config }));
        return { finishReason: FinishReason.STOP, content: { role: "model", parts: [{ text: "Synthetic reply" }] } }; } } });
    const invoke = async () => { for await (const _ of model.generateContentAsync({ contents: [{ role: "user", parts: [{ text: "Synthetic request" }] }], toolsDict: {}, liveConnectConfig: {} })) {} };
    try {
      Date.now = () => start + (expires && reserved ? 1000 : 0);
      if (expires) await assert.rejects(invoke(), { reason: "unavailable" }); else await invoke();
      assert.equal(daily, 1); assert.equal(providers, expires ? 0 : 1); assert.equal(budget.counts.modelCalls, 1);
    } finally { Date.now = realNow; budget.close(); }
  }
});

test("durable snapshots supply counts without local double charging and duplicate permits stop", async () => {
  const durable = admissionProbe(), budget = new AgentBudget();
  try {
    await budget.initializeDurable(durable);
    const attempt: BudgetAttempt = { kind: "model", units: 1, key: "original-model", fingerprint: agentBudgetFingerprint("fixed-request") };
    await budget.admit(attempt); assert.equal(budget.counts.modelCalls, 1);
    assert.throws(() => budget.take("modelCalls"), { reason: "unavailable" });
    await assert.rejects(budget.admit(attempt), { reason: "unavailable" }); assert.equal(budget.counts.modelCalls, 1);
    await durable.adapter.stop(durable.context); await assert.rejects(budget.checkDurable(), { reason: "unavailable" });
  } finally { budget.close(); }
});

test("durable assembly cannot omit native storage or mix dynamic routing and the original deadline is absolute", async () => {
  const durable = admissionProbe(), options = { config, usage: { reserve: async () => true, record: async () => {} }, provider: { generate: async () => { throw new Error("No provider"); } } };
  assert.throws(() => createAgentRuntime({ ...options, durableBudget: durable }), /Invalid durable budget assembly/);
  assert.throws(() => createAgentRuntime({ ...options, nativeSessionService: new InMemorySessionService(), durableBudget: durable,
    resolve: async () => { throw new Error("Dynamic route must not run"); } }), /Invalid durable budget assembly/);
  assert.throws(() => createAgentRuntime({ ...options, boundRunLimits: { modelCalls: 6, queryEmbeddings: 2 } }), /Invalid bound run limits assembly/);
  assert.throws(() => createAgentRuntime({ ...options, nativeSessionService: new InMemorySessionService(),
    bindDurableRun: () => durable, boundRunLimits: { modelCalls: 6, queryEmbeddings: 2 },
    resolve: async () => { throw new Error("Dynamic route must not run"); } }), /Invalid durable budget assembly/);
  let opens = 0, providers = 0, binds = 0;
  const runtime = createAgentRuntime({ ...options, nativeSessionService: new InMemorySessionService(),
    boundRunLimits: { modelCalls: 6, queryEmbeddings: 2 }, provider: { generate: async () => { providers++; throw new Error("No provider"); } },
    bindDurableRun: (_input, _pack, limits) => { binds++; assert.equal(limits.modelCalls, 6);
      return { ...durable, adapter: { ...durable.adapter, open: async context => { opens++; return durable.adapter.open(context); } } }; } });
  const stopped = await runtime.run({ runId: durable.context.binding.rootRunId, deadlineAtMs: durable.context.binding.deadlineAtMs,
    scope: { userId: 'synthetic-user', workspaceId: 'workspace', childId: 'child', authorizationVersion: '1', dataVersion: 'epoch:1' },
    trigger: { kind: 'interactive', reference: 'message' }, recipeId: 'product-interactive',
    availableInputs: ['run', 'scope', 'conversation', 'context', 'evidence', 'capabilities'],
    messages: [{ role: 'user', text: 'Synthetic binding mismatch.' }], tools: [], authorize: async () => true });
  assert.equal(stopped.stopReason, 'unavailable'); assert.equal(binds, 1); assert.equal(opens, 0); assert.equal(providers, 0);
  const budget = new AgentBudget(undefined, 90000, Date.now() + 10);
  try { await assert.rejects(budget.wait(() => new Promise(() => {})), { reason: "deadline" }); } finally { budget.close(); }
});


test("simultaneous identical queries cache the admission promise before its first asynchronous yield", async () => {
  const durable = admissionProbe(), budget = new AgentBudget(); let reservations = 0, embeddings = 0, candidates = 0;
  const reserve = durable.adapter.reserve;
  durable.adapter.reserve = async (...args) => { reservations++; await new Promise(resolve => setTimeout(resolve, 5)); return reserve(...args); };
  await budget.initializeDurable(durable);
  const retrieval = createKnowledgeRetriever({ candidates: async () => { candidates++; return []; } }, { embed: async () => { embeddings++; return [1]; } });
  const run = retrieval.createRun({ actor: { kind: "query_embedding", actorId: "synthetic-user", operationId: "synthetic-root" }, budget, authorize: async () => true });
  const filter = { region: "HK", classification: "official_guidance" as const, age: null, topics: [] };
  try {
    const replies = await Promise.all([run.search("合成查詢", filter, "synthetic-persisted-call-a"), run.search("合成查詢", filter, "synthetic-persisted-call-b")]);
    assert.deepEqual(replies[0], replies[1]);
    assert.equal(reservations, 1); assert.equal(embeddings, 1); assert.equal(candidates, 2); assert.equal(budget.counts.queryEmbeddings, 1);
  } finally { budget.close(); }
});
