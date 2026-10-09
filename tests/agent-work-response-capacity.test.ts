import assert from "node:assert/strict";
import test from "node:test";
import type { LlmRequest } from "@google/adk";
import { FinishReason } from "@google/genai";
import { agentWorkSchema } from "../src/shared/agent-work.ts";
import type { AgentWorkPage } from "../src/shared/agent-work.ts";
import { AgentBudget, AgentStopped } from "../server/agent-budget.ts";
import { AgentGatewayModel } from "../server/agent-model-gateway.ts";
import { createAgentWorkTools } from "../server/agent-work-tools.ts";
import type { AgentToolResult } from "../server/agent-runtime.ts";
import type { ProductAgentStore } from "../server/product-agent-store.ts";
import type { MemoryStore } from "../server/memory.ts";
import { FamilyError } from "../server/family-access.ts";
import { readAiConfig } from "../server/ai-config.ts";

const workId = "a4b1f891-837e-4b8c-9afb-584d835f4339";
const otherWorkId = "7de5a0e8-e106-4485-b7d2-3b572741da39";
const scope = { userId: "synthetic-budget-audit", childId: workId, workspaceId: "synthetic-space",
  authorizationVersion: "1", dataVersion: "synthetic:1" };
const work = (id = workId) => agentWorkSchema.parse({ id, childId: workId, version: 1,
  createdAt: "2026-10-08T00:00:00Z", updatedAt: "2026-10-08T00:00:00Z",
  goal: "合".repeat(1000), focus: "成".repeat(1000), questions: Array.from({ length: 6 }, () => "問".repeat(500)),
  sourceMessageIds: [], resources: [], pending: [], status: "waiting" });

function reader(budget: AgentBudget, read: () => Promise<AgentWorkPage | null>,
  requested: { workId: string | null; cursor: string | null } = { workId, cursor: null }) {
  let reads = 0, writes = 0;
  const store = {
    readWork: async (userId: string, childId: string, input: unknown) => {
      reads++;
      assert.equal(userId, scope.userId); assert.equal(childId, scope.childId);
      assert.deepEqual(input, requested);
      return read();
    },
    saveWork: async () => { writes++; throw new Error("A read must not write"); },
  } as unknown as ProductAgentStore;
  const tool = createAgentWorkTools(store, {} as MemoryStore,
    { scope, runId: otherWorkId, budget }, async () => true).find(item => item.name === "read_work")!;
  return { execute: () => tool.execute(requested,
    { scope, runId: otherWorkId, callId: "audit-read-work", signal: budget.signal }),
    counts: () => ({ reads, writes }) };
}

test("read_work preserves complete results and cursors, latest capacity and existing guard semantics", async () => {
  const budget = new AgentBudget(); budget.configureInputCharacters(64000);
  const page: AgentWorkPage = { items: [work(), work(otherWorkId)], complete: false, nextCursor: "original-unread-cursor" };
  let value: AgentWorkPage | null = page, failure: Error | null = null;
  const harness = reader(budget, async () => { if (failure) throw failure; return value; },
    { workId: null, cursor: "original-input-cursor" });
  try {
    const before = JSON.stringify(page);
    const expected: AgentToolResult = { status: "succeeded", data: { result: page } };
    const responseLength = JSON.stringify(expected).length;
    budget.prepareToolResponseBudget(64000 - 4096 - responseLength - 512, 0);
    assert.equal(budget.toolResponseCharacters, responseLength + 512);
    const accepted = await harness.execute();
    assert.equal(JSON.stringify(accepted), JSON.stringify(expected));
    assert.equal(accepted.data?.result, page);
    assert.equal(JSON.stringify(page), before);

    budget.accountToolResponse(JSON.stringify({ role: "user", parts: [{ functionResponse: {
      id: "previous-read", name: "read_context", response: { status: "succeeded", data: {} },
    } }] }).length);
    assert.deepEqual(await harness.execute(), { status: "rejected", data: { code: "response_limit" } });
    assert.equal(JSON.stringify(page), before, "No items or cursor may be changed to manufacture a smaller success");

    budget.prepareToolResponseBudget(64000, 0);
    value = null;
    await assert.rejects(harness.execute(), error => error instanceof AgentStopped && error.reason === "unauthorized");
    failure = new FamilyError(400, "invalid_cursor");
    assert.deepEqual(await harness.execute(), { status: "rejected", data: { code: "invalid_cursor" } });
    failure = new FamilyError(409, "version_conflict");
    assert.deepEqual(await harness.execute(), { status: "conflict", data: { code: "version_conflict" } });
    assert.deepEqual(harness.counts(), { reads: 5, writes: 0 });
  } finally { budget.close(); }
});

test("read_work rejects a legal oversized work before the next gateway request without bypassing input limits", async () => {
  for (const inputLength of [60000, 63900]) {
    const budget = new AgentBudget(); budget.configureInputCharacters(64000);
    const page: AgentWorkPage = { items: [work()], complete: true, nextCursor: null };
    const harness = reader(budget, async () => page);
    let providerCalls = 0;
    const content = { role: "model", parts: [{ functionCall: { id: "audit-read-work", name: "read_work",
      args: { workId, cursor: null } } }] };
    const model = new AgentGatewayModel({ config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
      budget, userId: scope.userId, childId: scope.childId, authorize: async () => true,
      usage: { reserve: async () => true, record: async () => {} },
      provider: { generate: async () => {
        providerCalls++;
        return { content: providerCalls === 1 ? content : { role: "model", parts: [{ text: "Synthetic capacity clarification." }] },
          finishReason: FinishReason.STOP };
      } } });
    const request = { model: "synthetic", contents: [{ role: "user", parts: [{ text: "合".repeat(inputLength) }] }],
      config: {}, toolsDict: { read_work: {} } } as unknown as LlmRequest;
    try {
      for await (const _response of model.generateContentAsync(request)) { /* Scripted gateway, not a real model. */ }
      assert.equal(budget.toolResponseCharacters, 0);
      const response = await harness.execute();
      assert.deepEqual(response, { status: "rejected", data: { code: "response_limit" } });
      assert.equal(Object.hasOwn(response.data!, "result"), false);
      const functionResponse = { role: "user", parts: [{ functionResponse: { id: "audit-read-work", name: "read_work", response: { ...response } } }] };
      budget.accountToolResponse(JSON.stringify(functionResponse).length);
      const next = { ...request, contents: [...request.contents, content, functionResponse] };
      const nextCharacters = JSON.stringify({ contents: next.contents, config: next.config }).length;
      if (inputLength === 60000) {
        assert.ok(nextCharacters <= 64000);
        for await (const _response of model.generateContentAsync(next)) { /* Consume the bounded scripted reply. */ }
        assert.equal(providerCalls, 2);
        assert.equal(budget.counts.modelCalls, 2);
        assert.equal(budget.counts.toolCalls, 1);
      } else {
        assert.ok(nextCharacters > 64000, "Even a minimal rejection cannot always fit");
        await assert.rejects(async () => { for await (const _response of model.generateContentAsync(next)) {} },
          error => error instanceof AgentStopped && error.reason === "input_limit");
        assert.equal(providerCalls, 1, "The existing gateway limit must still stop before another provider call");
      }
      assert.equal(budget.limits.inputCharacters, 64000);
      assert.equal(budget.limits.modelCalls, 4);
      assert.deepEqual(harness.counts(), { reads: 1, writes: 0 });
    } finally { budget.close(); }
  }
});
