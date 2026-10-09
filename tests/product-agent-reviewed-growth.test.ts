import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { FinishReason } from "@google/genai";
import { AgentBudget, AgentStopped } from "../server/agent-budget.ts";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import { readAiConfig } from "../server/ai-config.ts";
import { createKnowledgeRetriever } from "../server/knowledge-retriever.ts";
import { createProductAgent } from "../server/product-agent.ts";
import { createProductAgentTools } from "../server/product-agent-tools.ts";
import type { EmbeddingGateway } from "../server/embedding-gateway.ts";
import type { MemoryStore } from "../server/memory.ts";
import type { KnowledgeCandidate } from "../src/shared/knowledge.ts";
import type { ProductAgentResult } from "../src/shared/product-agent.ts";

function fixture() {
  const versionId = randomUUID(), userId = "synthetic-reviewed-parent", childId = randomUUID(), runId = randomUUID();
  const scope = { userId, childId, workspaceId: randomUUID(), authorizationVersion: "1", dataVersion: "synthetic-epoch:1" };
  const candidate = (key: string, originalText: string, text: string): KnowledgeCandidate => ({
    chunkId: randomUUID(), sourceId: "synthetic-reviewed-growth", versionId, versionHash: "a".repeat(64),
    contentHash: (key === "anchor" ? "b" : "c").repeat(64), key,
    url: "https://www.fhs.gov.hk/synthetic-reviewed-growth", title: "Synthetic public topic", publisher: "Synthetic publisher",
    classification: "official_guidance", sourcePublishedAt: null, sourceUpdatedAt: null,
    fetchedAt: "2026-10-01T00:00:00Z", checkedAt: "2026-10-01T00:00:00Z", reviewState: "reviewed", distance: 0.1, rankScore: 0.1,
    section: "Synthetic " + key, sourceExcerpt: "Synthetic source excerpt.", text, originalText, keywords: ["synthetic"],
    applicability: { region: "HK", ageBasis: "any", minAgeMonths: null, maxAgeMonths: null, topics: ["synthetic"], conditions: [] },
    applicabilityStatus: "applicable",
  });
  const anchor = candidate("anchor", "A".repeat(3600), "Reviewed anchor including all conditions.");
  const neighbor = candidate("neighbor", "Original prefix " + "B".repeat(3540) + " Required condition at end.",
    "Reviewed neighbor including the required condition.");
  let current = true, embeddings = 0, reads = 0;
  const knowledge = createKnowledgeRetriever({ candidates: async (_filter, _vector, selection = {}) => {
    reads++;
    if (!current) return [];
    const values = [anchor, neighbor];
    if (selection.chunkIds) return values.filter(item => selection.chunkIds!.includes(item.chunkId));
    if (selection.afterKey) return values.filter(item => item.key > selection.afterKey!);
    return [anchor];
  } }, { embed: async () => { embeddings++; return [1, ...Array(1023).fill(0)]; } } as unknown as EmbeddingGateway);
  const memory = { context: async () => ({ profile: { childId, version: 0, data: null }, profileApplicable: false,
    facts: [], topics: [], summary: null, recentMessages: [], conflictingKeys: [], unavailableFactKeys: [],
    truncated: { facts: false, topics: false, messages: false } }) } as unknown as MemoryStore;
  return { userId, childId, runId, scope, anchor, neighbor, knowledge, memory,
    withdraw: () => { current = false; }, get embeddings() { return embeddings; }, get reads() { return reads; } };
}
function direct(h: ReturnType<typeof fixture>, budget: AgentBudget, reviewed: boolean) {
  const value = createProductAgentTools({ run: { scope: h.scope, runId: h.runId, budget }, memory: h.memory,
    tasks: {} as Parameters<typeof createProductAgentTools>[0]["tasks"], store: {} as Parameters<typeof createProductAgentTools>[0]["store"],
    knowledge: h.knowledge, authorize: async () => true, visibility: "family", reviewedGrowthPresentation: reviewed });
  return { ...value, async invoke(name: string, args: Record<string, unknown>) {
    const tool = value.tools.find(item => item.name === name)!;
    const parsed = tool.parameters.parse(args) as Record<string, unknown>;
    assert.equal(await tool.authorize(parsed, h.scope), true);
    return tool.execute(parsed, { scope: h.scope, runId: h.runId, callId: "synthetic-" + name, signal: budget.signal });
  } };
}
async function readPartial(h: ReturnType<typeof fixture>, tools: ReturnType<typeof direct>) {
  assert.equal((await tools.invoke("search_knowledge", { query: "synthetic topic", classification: "official_guidance" })).status, "succeeded");
  const result = await tools.invoke("read_knowledge_context", { anchorChunkId: h.anchor.chunkId, cursor: null });
  assert.equal(result.status, "succeeded");
  const page = result.data!.result as import("../src/shared/knowledge.ts").KnowledgeContextResult;
  const partial = page.chunks.find(item => item.chunkId === h.neighbor.chunkId)!;
  assert.ok(partial); assert.equal(page.complete, false); assert.ok(partial.original.nextOffset);
  assert.ok(partial.original.text.length < partial.original.totalCharacters);
  assert.equal(partial.original.text.includes("Required condition at end."), false);
  return partial;
}
const answer = (id: string, text = "Model wording must never replace reviewed growth text.") => ({
  kind: "caregiving", paragraphs: [{ text, citationIds: [id] }],
});

test("reviewed growth keeps current reviewed wording separate from partial original-read coverage", async t => {
  const h = fixture(), budget = new AgentBudget(); t.after(() => budget.close());
  const tools = direct(h, budget, true), partial = await readPartial(h, tools);
  assert.equal((await tools.invoke("present_answer", answer(h.neighbor.chunkId))).status, "succeeded");
  const presented = await tools.presentation(); assert.ok(presented);
  assert.equal(presented.text, h.neighbor.text + " [1]");
  assert.equal(presented.citations[0].text, partial.original.text);
  assert.deepEqual(presented.citations[0].readCoverage, { kind: "original_segment", ranges: [{ start: 0, end: partial.original.text.length }],
    offset: 0, nextOffset: partial.original.nextOffset, totalCharacters: partial.original.totalCharacters, complete: false });
  assert.equal(presented.citations[0].originalText, undefined);
  assert.equal(h.embeddings, 1); assert.equal(h.reads, 5);
});

test("withdrawn reviewed source cannot fall back to accumulated original text", async t => {
  const h = fixture(), budget = new AgentBudget(); t.after(() => budget.close());
  const tools = direct(h, budget, true); await readPartial(h, tools);
  assert.equal((await tools.invoke("present_answer", answer(h.neighbor.chunkId))).status, "succeeded");
  h.withdraw();
  await assert.rejects(tools.presentation(), error => error instanceof AgentStopped && error.reason === "invalid_response");
  assert.equal(h.embeddings, 1); assert.equal(h.reads, 5);
});

test("empty, missing and whitespace reviewed wording cannot fall back to accumulated original text", async t => {
  for (const invalid of ["", undefined, " \n\t "]) {
    const h = fixture(), budget = new AgentBudget(); t.after(() => budget.close());
    const tools = direct(h, budget, true); await readPartial(h, tools);
    assert.equal((await tools.invoke("present_answer", answer(h.neighbor.chunkId))).status, "succeeded");
    // A malformed injected current reader must fail closed despite matching identity metadata.
    (h.neighbor as unknown as { text: unknown }).text = invalid;
    await assert.rejects(tools.presentation(), error => error instanceof AgentStopped && error.reason === "invalid_response");
    assert.equal(h.embeddings, 1); assert.equal(h.reads, 5);
  }
});

test("ordinary presentation retains model wording and only the original ranges actually read", async t => {
  const h = fixture(), budget = new AgentBudget(); t.after(() => budget.close());
  const tools = direct(h, budget, false), partial = await readPartial(h, tools);
  const text = "Synthetic conditional summary based on the visible evidence.";
  assert.equal((await tools.invoke("present_answer", answer(h.neighbor.chunkId, text))).status, "succeeded");
  // The reviewed-growth-only guard must not broaden the existing ordinary citation predicate.
  h.neighbor.text = "";
  const presented = await tools.presentation(); assert.ok(presented);
  assert.equal(presented.text, text + " [1]");
  assert.equal(presented.citations[0].text, partial.original.text);
  assert.equal(presented.citations[0].readCoverage?.complete, false);
  assert.equal(h.reads, 5);
});

test("native background Runner expands original context and presents reviewed text within existing limits", async () => {
  const h = fixture(); let calls = 0, saved: ProductAgentResult | null = null;
  const steps = [
    { name: "search_knowledge", args: { query: "synthetic topic", classification: "official_guidance" } },
    { name: "read_knowledge_context", args: { anchorChunkId: h.anchor.chunkId, cursor: null } },
    { name: "present_answer", args: answer(h.neighbor.chunkId) },
  ];
  const runtime = createAgentRuntime({ config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    usage: { reserve: async () => true, record: async () => {} }, provider: { generate: async request => {
      if (calls > 0) assert.ok(request.contents.some(item => item.parts?.some(part => part.functionResponse)));
      if (calls === 2) {
        const responses = request.contents.flatMap(item => item.parts ?? []).flatMap(part => part.functionResponse ? [part.functionResponse] : []);
        const response = responses.find(item => item.name === "read_knowledge_context")!;
        assert.equal(response.response!.status, "succeeded");
      }
      const next = steps[calls++]; assert.ok(next, "No extra model step is permitted");
      return { content: { role: "model", parts: [{ functionCall: { id: "synthetic-step-" + calls, ...next } }] }, finishReason: FinishReason.STOP };
    } } });
  const service = createProductAgent({ runtime, memory: h.memory, knowledge: h.knowledge,
    store: { claim: async () => ({ runId: h.runId, scope: h.scope, created: true, state: "running", expiresAt: new Date(Date.now() + 90000).toISOString() }),
      authorize: async () => true, finish: async (_scope: unknown, result: ProductAgentResult) => { saved = result; return true; }, get: async () => saved },
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
    chat: { listForUser: async () => { throw new Error("Family background must not read private chat"); } },
  } as unknown as Parameters<typeof createProductAgent>[0]);
  const result = await service.background({ userId: h.userId, childId: h.childId, reference: randomUUID(),
    context: { eventType: "growth_attention" }, authorize: async () => true });
  assert.equal(result?.status, "completed", JSON.stringify(result)); assert.equal(result.stopReason, null);
  assert.equal(result.text, h.neighbor.text + " [1]");
  assert.equal(result.citations[0].readCoverage?.kind, "original_segment");
  assert.equal(result.citations[0].readCoverage?.complete, false);
  assert.equal(result.citations[0].text.includes("Required condition at end."), false);
  assert.deepEqual(result.tools.map(tool => ({ name: tool.name, status: tool.status })), steps.map(step => ({ name: step.name, status: "succeeded" })));
  assert.deepEqual(result.counts, { modelCalls: 3, toolCalls: 3, queryEmbeddings: 1 });
  assert.equal(calls, 3); assert.equal(h.embeddings, 1); assert.equal(h.reads, 5);
});
