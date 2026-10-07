import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { FinishReason } from "@google/genai";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import { createProductAgent } from "../server/product-agent.ts";
import { createProductAgentTools } from "../server/product-agent-tools.ts";
import { AgentBudget, AGENT_LIMITS } from "../server/agent-budget.ts";
import { readAiConfig } from "../server/ai-config.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import { summaryInput, saveSummary } from "../server/memory-summary.ts";
import type { ProductAgentResult } from "../src/shared/product-agent.ts";
import type { ChatMessage } from "../src/shared/chat.ts";
import type { PoolClient } from "pg";

for (const characters of [200, 800]) test(`native Runner keeps ${characters}-character source messages once and saves only the shown summary prefix`, async () => {
  const userId = "synthetic-user", childId = randomUUID(), runId = randomUUID(), messageId = randomUUID();
  const scope = { userId, childId, workspaceId: randomUUID(), authorizationVersion: "1", dataVersion: "epoch:1" };
  const messages: ChatMessage[] = Array.from({ length: 12 }, (_, index) => ({ id: randomUUID(), childId, authorUserId: userId,
    role: index % 2 ? "model" : "user", inReplyTo: null, text: `來源${index}:` + "合".repeat(characters), createdAt: new Date().toISOString() }));
  const context = { profile: { childId, version: 0, data: null }, profileApplicable: false, facts: [], topics: [], summary: null,
    recentMessages: messages, conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false } };
  let calls = 0, claimed = false, saved: ProductAgentResult | null = null, summary: any, seen: any;
  const sizes: number[] = [];
  const runtime = createAgentRuntime({ config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    usage: { reserve: async () => true, record: async () => {} }, provider: { generate: async request => {
      sizes.push(JSON.stringify({ contents: request.contents, config: request.config }).length);
      assert.ok(sizes.at(-1)! <= AGENT_LIMITS.inputCharacters);
      const index = calls++;
      if (index === 1) {
        const parts = request.contents.flatMap(content => content.parts ?? []);
        assert.ok(parts.some(part => part.thoughtSignature === "opaque-native-signature"));
        seen = (parts.find(part => part.functionResponse?.name === "read_context")?.functionResponse?.response?.data as any).result;
        assert.ok(seen.uncoveredConversation.messages.length > 0);
        assert.deepEqual(seen.privateSummaryInput.messageIds, seen.uncoveredConversation.messages.map((message: ChatMessage) => message.id));
        assert.deepEqual(Object.keys(seen.privateSummaryInput).sort(), ["messageIds", "moreUncovered", "previousSummaryId"]);
        for (const message of seen.uncoveredConversation.messages) assert.equal(JSON.stringify(seen).split(message.text).length - 1, 1);
        assert.deepEqual(seen.uncoveredConversation.messages, messages.slice(0, seen.uncoveredConversation.messages.length));
        assert.equal(seen.uncoveredConversation.complete, seen.uncoveredConversation.messages.length === messages.length);
        assert.equal(seen.privateSummaryInput.moreUncovered, seen.uncoveredConversation.messages.length < messages.length);
      }
      const step = index === 0 ? { id: "read", name: "read_context", args: {} }
        : index === 1 ? { id: "summary", name: "stage_private_summary", args: { text: "僅整理已讀合成來源；沒有推斷未讀部分。" } }
        : index === 2 ? { id: "answer", name: "present_answer", args: { kind: "operation", paragraphs: [{ text: "已核對本次提供資料。", citationIds: [] }] } } : null;
      return { finishReason: FinishReason.STOP, content: { role: "model", parts: step
        ? [{ functionCall: step, ...(index === 0 ? { thoughtSignature: "opaque-native-signature" } : {}) }] : [{ text: "unvalidated closing" }] } };
    } } });
  const service = createProductAgent({ runtime, store: {
    claim: async () => { const created = !claimed; claimed = true; return { runId, scope, created, expiresAt: new Date(Date.now() + 90000).toISOString() }; },
    authorize: async () => true, finish: async (_scope: unknown, result: ProductAgentResult, draft: unknown) => { saved = result; summary = draft; return true; }, get: async () => saved,
  }, memory: { context: async () => context, prepareSummary: async () => ({ previous: null, previousVersion: 0, basis: "a".repeat(64), messages, moreUncovered: false }) },
    chat: { listForUser: async () => ({ messages: [{ id: messageId, role: "user", text: "請核對目前資料" }] }) },
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) }, knowledge: { createRun: () => ({ revalidateCitations: async () => true }) },
    actions: { policy: async () => null, receipts: async () => [] }, summary: {}, contact: {}, concerns: {}, sources: {}, documents: {}, growth: { list: async () => null },
  } as unknown as Parameters<typeof createProductAgent>[0]);
  const result = await service.reply(userId, childId, messageId, async () => true);
  assert.equal(result?.status, "completed", JSON.stringify(result));
  assert.deepEqual(summary.coveredMessageIds, seen.privateSummaryInput.messageIds);
  assert.equal(summary.previousVersion, 0); assert.equal(summary.basis, "a".repeat(64));
  if (characters === 800) assert.ok(summary.coveredMessageIds.length < messages.length);
  assert.deepEqual(await service.reply(userId, childId, messageId, async () => true), result); assert.equal(calls, 4);
});

test("context capacity rejection is explicit and family reads never prepare private summaries", async () => {
  const budget = new AgentBudget();
  try {
    const scope = { userId: "synthetic", childId: randomUUID(), workspaceId: randomUUID(), authorizationVersion: "1", dataVersion: "1" };
    const context = { profile: null, profileApplicable: false, facts: [], topics: [], summary: null, conflictingKeys: [], unavailableFactKeys: [],
      recentMessages: [{ id: randomUUID(), text: "private synthetic text" }], truncated: { messages: false } };
    const options = { run: { scope, runId: randomUUID(), budget }, memory: { context: async () => context,
      prepareSummary: async () => { throw new Error("Family context must never prepare a private summary"); } },
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) }, store: {}, knowledge: { createRun: () => ({}) }, authorize: async () => true };
    const call = { scope, runId: options.run.runId, callId: "read", signal: budget.signal };
    const family = createProductAgentTools({ ...options, visibility: "family" } as unknown as Parameters<typeof createProductAgentTools>[0]);
    const response = await family.tools.find(tool => tool.name === "read_context")!.execute({}, call);
    assert.equal((response.data?.result as any).uncoveredConversation, null);
    assert.equal((response.data?.result as any).privateSummaryInput, null);
    assert.equal(JSON.stringify(response).includes("private synthetic text"), false);
    budget.prepareToolResponseBudget(31000, 100);
    const rejected = await family.tools.find(tool => tool.name === "read_context")!.execute({}, call);
    assert.deepEqual(rejected, { status: "rejected", data: { code: "context_input_limit" } });
  } finally { budget.close(); }
});

test("summary persistence accepts only a nonempty ordered current prefix and advances coverage without skipping sources", async () => {
  const cipher = createStorageCipher(Buffer.alloc(32, 41)), user = "synthetic", child = randomUUID();
  let profileVersion = 0, savedRow: any = null;
  const coverage = new Set<string>();
  const rows = Array.from({ length: 5 }, () => { const id = randomUUID(); return { id, author_user_id: user, role: "user", in_reply_to: null,
    created_at: new Date(), text_encrypted: cipher.encrypt("合成來源", `chat_messages:${id}:${child}:${user}:user::text`) }; });
  const client = { async query(sql: string, params: any[] = []) {
    const result = (value: any[]) => ({ rows: value, rowCount: value.length });
    if (sql.includes("ORDER BY version DESC LIMIT 1")) return result(savedRow ? [savedRow] : []);
    if (sql.startsWith("SELECT profile_version")) return result([{ profile_version: profileVersion }]);
    if (sql.includes("SELECT m.* FROM chat_messages")) return result(rows.filter(row => params[2] || !coverage.has(row.id)));
    if (sql.startsWith("INSERT INTO conversation_summaries")) savedRow = { id: params[0], payload_encrypted: params[5], invalidated: false };
    if (sql.startsWith("DELETE FROM summary_message_coverage")) coverage.clear();
    if (sql.startsWith("INSERT INTO summary_message_coverage")) params[0].forEach((id: string) => coverage.add(id));
    return result([]);
  } } as unknown as PoolClient;
  const first = await summaryInput(client, cipher, user, child);
  const draft = { previousVersion: first.previousVersion, basis: first.basis, text: "只覆蓋最先兩則", coveredMessageIds: first.messages.slice(0, 2).map(message => message.id) };
  for (const ids of [[rows[1].id], [rows[0].id, rows[2].id], [rows[0].id, rows[0].id]])
    await assert.rejects(saveSummary(client, cipher, user, child, { ...draft, coveredMessageIds: ids }), /summary_coverage_changed|Invalid/u);
  await saveSummary(client, cipher, user, child, draft);
  assert.deepEqual([...coverage], draft.coveredMessageIds);
  const next = await summaryInput(client, cipher, user, child);
  assert.deepEqual(next.messages.map(message => message.id), rows.slice(2).map(row => row.id));
  assert.equal(next.previousVersion, 1); assert.equal(next.previous?.lastCoveredMessageId, rows[1].id);
  await assert.rejects(saveSummary(client, cipher, user, child, draft), /summary_coverage_changed/u);
  const nextDraft = { previousVersion: next.previousVersion, basis: next.basis, text: "下一批", coveredMessageIds: next.messages.map(message => message.id) };
  profileVersion++;
  await assert.rejects(saveSummary(client, cipher, user, child, nextDraft), /summary_coverage_changed/u);
  assert.equal(coverage.size, 2);
});
