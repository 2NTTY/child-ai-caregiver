import assert from "node:assert/strict";
import test from "node:test";
import { FinishReason } from "@google/genai";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import { createProductAgent } from "../server/product-agent.ts";
import { readAiConfig } from "../server/ai-config.ts";
import type { ProductAgentResult, AgentProposal } from "../src/shared/product-agent.ts";

test("product reply uses native tools, keeps proposals unconfirmed, validates display and reuses the persisted run", async () => {
  const runId = "d4a1b662-d13d-476b-bf52-40a28aa1a1a7", childId = "1ebcb39d-a2db-4b8c-a432-7ffcb3de5808";
  const messageId = "7de5a0e8-e106-4485-b7d2-3b572741da39", userId = "synthetic-user";
  const scope = { userId, childId, workspaceId: "synthetic-workspace", authorizationVersion: "1", dataVersion: "epoch:1" };
  let claimed = false, calls = 0, writes = 0, saved: ProductAgentResult | null = null;
  const proposals: AgentProposal[] = [];
  const runtime = createAgentRuntime({ config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    usage: { reserve: async () => true, record: async () => {} },
    provider: { generate: async request => {
      const index = calls++;
      if (index > 0) assert.ok(request.contents.some(content => content.parts?.some(part => part.functionResponse)));
      const functionCall = index === 0 ? { id: "load-memory", name: "load_capabilities", args: { capabilities: ["memory"] } }
        : index === 1 ? { id: "candidate-call", name: "propose_fact", args: {
        key: "preferred_contact", content: "只在站內查看", intendedVisibility: "private", validUntil: null } }
        : index === 2 ? { id: "answer-call", name: "present_answer", args: { kind: "operation",
          paragraphs: [{ text: "已保存私人候選，尚待你確認。", citationIds: [] }] } } : null;
      return { content: { role: "model", parts: functionCall ? [{ functionCall }] : [{ text: "Unvalidated model closing text must not be displayed." }] },
        finishReason: FinishReason.STOP };
    } } });
  const options = {
    runtime,
    store: {
      claim: async () => { const created = !claimed; claimed = true; return { runId, scope, created, sourceMessageId: messageId, state: "running", expiresAt: new Date(Date.now() + 90000).toISOString() }; },
      authorize: async () => true,
      propose: async (_scope: unknown, originalRun: string, callId: string, value: AgentProposal["value"]) => {
        assert.equal(originalRun, runId); assert.equal(callId, "candidate-call"); writes++;
        const proposal: AgentProposal = { id: "f49a222e-77e4-4980-ae87-4c335b2b5c39", runId, childId, version: 1,
          status: "pending", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), value, result: null, targetLabel: null };
        proposals.push(proposal); return proposal;
      },
      finish: async (_scope: unknown, result: ProductAgentResult) => { saved = { ...result, proposals }; return true; },
      get: async () => saved,
    },
    memory: { context: async () => ({ profile: { childId, version: 0, data: null }, profileApplicable: false,
      facts: [], topics: [], summary: null, recentMessages: [], conflictingKeys: [], unavailableFactKeys: [],
      truncated: { facts: false, topics: false, messages: false } }) },
    chat: { listForUser: async () => ({ messages: [{ id: messageId, role: "user", text: "記住我只想在站內查看。" }] }) },
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
    knowledge: { createRun: () => ({ search: async () => { throw new Error("No knowledge call needed"); }, revalidateCitations: async () => true }) },
  } as unknown as Parameters<typeof createProductAgent>[0];
  const service = createProductAgent(options);
  const first = await service.reply(userId, childId, messageId, async () => true);
  assert.equal(first?.status, "completed", JSON.stringify(first));
  assert.equal(first.text, "已保存私人候選，尚待你確認。");
  assert.equal(first.proposals[0].status, "pending");
  assert.equal(first.proposals[0].result, null);
  assert.equal(first.provenance?.recipeId, "product-interactive");
  assert.deepEqual(first.counts, { modelCalls: 3, toolCalls: 3, queryEmbeddings: 0 });
  assert.equal(writes, 1);
  assert.deepEqual(await service.reply(userId, childId, messageId, async () => true), first);
  assert.equal(calls, 3); assert.equal(writes, 1);
});

for (const validCitation of [true, false]) test(`terminal product presentation revalidates citations on the last model step, valid=${validCitation}`, async () => {
  const userId = "synthetic-user", childId = "1ebcb39d-a2db-4b8c-a432-7ffcb3de5808";
  const runId = "d4a1b662-d13d-476b-bf52-40a28aa1a1a7", messageId = "7de5a0e8-e106-4485-b7d2-3b572741da39";
  const scope = { userId, childId, workspaceId: "synthetic-workspace", authorizationVersion: "1", dataVersion: "epoch:1" };
  const chunk = { chunkId: "reviewed-chunk", classification: "official_guidance", text: "已核對的合成照護說明。" };
  const values = { title: "合成跟進候選", details: "尚待本人明確確認。", kind: "ordinary", assigneeUserId: userId,
    dueAt: new Date(Date.now() + 3600000).toISOString(), timeZone: "Asia/Hong_Kong" };
  const steps = [
    [{ id: "context-call", name: "read_context", args: {} },
      { id: "load-tasks", name: "load_capabilities", args: { capabilities: ["tasks"] } },
      { id: "search-call", name: "search_knowledge", args: { query: "合成照護主題", classification: "official_guidance" } }],
    { id: "candidate-call", name: "propose_task", args: { values } },
    { id: "answer-call", name: "present_answer", args: { kind: "mixed", paragraphs: [{ kind: "caregiving", text: chunk.text, citationIds: [chunk.chunkId] },
      { kind: "operation", text: "候選已保存，仍待確認。", citationIds: [] }] } },
  ];
  let calls = 0, writes = 0, revalidations = 0, claimed = false, saved: ProductAgentResult | null = null;
  const proposals: AgentProposal[] = [];
  const runtime = createAgentRuntime({ config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    usage: { reserve: async () => true, record: async () => {} }, provider: { generate: async request => {
      const user = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? "").join("\n");
      if (user.includes("chat-delivery-review")) {
        assert.equal(validCitation, true, "Invalid citations must fail before semantic review");
        assert.deepEqual(Object.keys(request.toolsDict), []);
        const payload = JSON.parse(user.slice(user.indexOf("{"))) as { draftHash: string; paragraphs: { text: string; citationIds: string[] }[]; sources: { citationId: string; excerpt: string }[] };
        const supported = payload.paragraphs.every(paragraph => paragraph.citationIds.every(id => {
          const source = payload.sources.find(item => item.citationId === id);
          return Boolean(source?.excerpt.includes(paragraph.text));
        }));
        calls++;
        return { content: { role: "model", parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: supported ? "pass" : "revise",
          issues: supported ? [] : [{ paragraph: 0, reason: "unsupported meaning", support: "excerpt does not state the claim" }] }) }] }, finishReason: FinishReason.STOP };
      }
      const step = steps[calls++];
      assert.ok(step, "An extra generator call must not start");
      return { content: { role: "model", parts: [step].flat().map(functionCall => ({ functionCall })) }, finishReason: FinishReason.STOP };
    } } });
  const options = { runtime,
    store: {
      claim: async () => { const created = !claimed; claimed = true; return { runId, scope, created, state: "running", expiresAt: new Date(Date.now() + 90000).toISOString() }; },
      authorize: async () => true,
      propose: async (_scope: unknown, originalRun: string, callId: string, value: AgentProposal["value"]) => {
        assert.equal(originalRun, runId); assert.equal(callId, "candidate-call"); assert.equal(value.kind, "task_create"); writes++;
        const proposal: AgentProposal = { id: "f49a222e-77e4-4980-ae87-4c335b2b5c39", runId, childId, version: 1,
          status: "pending", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), value, result: null, targetLabel: null };
        proposals.push(proposal); return proposal;
      },
      finish: async (_scope: unknown, result: ProductAgentResult) => { saved = { ...result, proposals }; return true; },
      get: async () => saved,
    },
    memory: { context: async () => ({ profile: { childId, version: 0, data: null }, profileApplicable: false,
      facts: [], topics: [], summary: null, recentMessages: [], conflictingKeys: [], unavailableFactKeys: [],
      truncated: { facts: false, topics: false, messages: false } }) },
    chat: { listForUser: async () => ({ messages: [{ id: messageId, role: "user", text: "請整理合成照護說明及待确认跟進，並提出待確認的家庭任務。" }] }) },
    tasks: { list: async () => ({ items: [], eligibleAssignees: [{ userId, name: "Synthetic caregiver" }], nextAfterId: null }) },
    knowledge: { createRun: () => ({ search: async () => ({ mode: "vector_keyword", chunks: [chunk] }),
      revalidateCitations: async (items: unknown[]) => { revalidations++; assert.deepEqual(items, [chunk]); return validCitation; } }) },
  } as unknown as Parameters<typeof createProductAgent>[0];
  const service = createProductAgent(options);
  const result = await service.reply(userId, childId, messageId, async () => true);
  assert.equal(result?.status, validCitation ? "completed" : "stopped", JSON.stringify(result));
  assert.equal(result.stopReason, validCitation ? null : "invalid_response");
  assert.equal(result.text, validCitation ? chunk.text + " [1]\n\n候選已保存，仍待確認。" : "");
  assert.deepEqual(result.citations, validCitation ? [chunk] : []);
  assert.deepEqual(result.tools.map(tool => ({ name: tool.name, status: tool.status })),
    steps.flat().map(step => ({ name: step.name, status: "succeeded" })));
  assert.deepEqual(result.counts, { modelCalls: validCitation ? 4 : 3, toolCalls: 5, queryEmbeddings: 0 });
  assert.equal(result.deliveryReview?.decision, validCitation ? "pass" : undefined);
  if (validCitation) assert.equal(JSON.stringify(result.deliveryReview).includes(chunk.text), false);
  assert.equal(result.proposals[0].status, "pending");
  assert.equal(result.proposals[0].result, null);
  assert.equal(calls, validCitation ? 4 : 3); assert.equal(writes, 1); assert.equal(revalidations, 1);
  assert.deepEqual(await service.reply(userId, childId, messageId, async () => true), result);
  assert.equal(calls, validCitation ? 4 : 3); assert.equal(writes, 1); assert.equal(revalidations, 1);
});

for (const growth of [false, true]) test(growth
  ? "growth Runner renders reviewed evidence without model embellishment or classification bypass"
  : "background Runner exposes only family reads and presentation, without private chat or mutation tools", async () => {
  const userId = "synthetic-caregiver", childId = "1ebcb39d-a2db-4b8c-a432-7ffcb3de5808";
  const runId = "d4a1b662-d13d-476b-bf52-40a28aa1a1a7", reference = "7de5a0e8-e106-4485-b7d2-3b572741da39";
  const scope = { userId, childId, workspaceId: "synthetic-workspace", authorizationVersion: "1", dataVersion: "epoch:1" };
  let calls = 0, reads = 0, saved: ProductAgentResult | null = null;
  const chunk = { chunkId: "reviewed-chunk", classification: "official_guidance",
    text: "約六個月時，單靠母乳已不足以滿足營養需要，應開始加入固體食物。" };
  const runtime = createAgentRuntime({ config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    usage: { reserve: async () => true, record: async () => {} },
    provider: { generate: async request => {
      const toolNames = Object.keys(request.toolsDict).sort();
      assert.deepEqual(toolNames, ["present_answer", "read_context", "read_knowledge_context", "search_knowledge"]);
      assert.ok(!toolNames.some(name => /^(?:propose_|save_|revise_|change_|create_|execute_|stage_|contact_)/u.test(name)));
      for (const name of ["search_history", "read_history", "read_private_instructions", "read_private_source", "list_private_sources"])
        assert.ok(!toolNames.includes(name));
      const index = calls++;
      if (index === 1) {
        const response = request.contents.flatMap(content => content.parts ?? []).find(part => part.functionResponse)?.functionResponse?.response;
        assert.equal(response?.status, "rejected");
        const data = response?.data as Record<string, unknown> | undefined;
        assert.deepEqual(data && { code: data.code, nextAction: data.nextAction, citationField: data.citationField },
          { code: "citation_required", citationField: undefined,
            nextAction: "Each caregiving or safety paragraph needs supporting official citationIds. Omit unsupported advice; report operation receipts separately from advice. Do not attach irrelevant citations." });
      }
      const functionCall = index === 0 ? { id: "invalid-source", name: "present_answer", args: { kind: "caregiving", paragraphs: [{ text: "未有有效引用的合成建議", citationIds: ["source-metadata-id"] }] } }
        : index === 1 ? (growth ? { id: "search-call", name: "search_knowledge", args: {
          query: "約六個月加固", classification: "official_guidance" } } : { id: "context-call", name: "read_context", args: {} })
        : index === 2 ? { id: "answer-call", name: "present_answer", args: { kind: "record_restatement",
          paragraphs: growth ? [{ text: "配方奶也不足，而且要立即加固。", citationIds: [chunk.chunkId] },
            { text: "另一項未經核對的照護建議。", citationIds: [] }]
            : [{ text: "原任務已到期，完成狀態仍待你確認。", citationIds: [] }] } } : null;
      return { content: { role: "model", parts: functionCall ? [{ functionCall }] : [{ text: "完成說明。" }] }, finishReason: FinishReason.STOP };
    } } });
  const options = { runtime,
    store: { claim: async (_user: string, _child: string, trigger: { kind: string; reference: string }) => {
      assert.deepEqual(trigger, { kind: "worker", reference });
      return { runId, scope, created: true, state: "running", expiresAt: new Date(Date.now() + 90000).toISOString() };
    }, authorize: async () => true, finish: async (_scope: unknown, result: ProductAgentResult) => { saved = result; return true; },
      get: async () => saved },
    memory: { context: async (_user: string, _child: string, visibility: string) => {
      assert.equal(visibility, "family"); reads++;
      return { profile: { childId, data: null }, profileApplicable: false, facts: [], topics: [], summary: null,
        recentMessages: [], conflictingKeys: [], unavailableFactKeys: [], truncated: { messages: false } };
    } },
    chat: { listForUser: async () => { throw new Error("Private chat must not be read by background"); } },
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
    knowledge: { createRun: () => ({ search: async () => ({ mode: "vector_keyword", chunks: [chunk] }),
      readReviewedCitations: async (items: unknown[]) => { assert.deepEqual(items, [chunk]); return [chunk]; },
      revalidateCitations: async (items: unknown[]) => { assert.deepEqual(items, [chunk]); return true; } }) },
  } as unknown as Parameters<typeof createProductAgent>[0];
  const result = await createProductAgent(options).background({ userId, childId, reference,
    context: { eventType: growth ? "growth_attention" : "task_due", purpose: "station_only_due_task_briefing" }, authorize: async () => true });
  assert.equal(result?.status, "completed", JSON.stringify(result));
  assert.equal(result.provenance?.recipeId, "product-background");
  assert.equal(result.text, growth ? chunk.text + " [1]" : "原任務已到期，完成狀態仍待你確認。");
  assert.equal(reads, 1); assert.equal(calls, 3); assert.deepEqual(result.proposals, []);
});
