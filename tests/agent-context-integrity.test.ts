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
  const runtime = createAgentRuntime({ config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project", AI_AGENT_MAX_INPUT_CHARACTERS: "32000" }),
    usage: { reserve: async () => true, record: async () => {} }, provider: { generate: async request => {
      sizes.push(JSON.stringify({ contents: request.contents, config: request.config }).length);
      assert.ok(sizes.at(-1)! <= AGENT_LIMITS.inputCharacters);
      const index = calls++;
      assert.equal(Object.hasOwn(request.toolsDict, "stage_private_summary"), index > 0);
      if (index === 1) {
        assert.equal(request.contents.flatMap(content => content.parts ?? []).find(part => part.functionResponse?.id === "summary-capability")?.functionResponse?.response?.status, "succeeded");
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
        ? [{ functionCall: step, ...(index === 0 ? { thoughtSignature: "opaque-native-signature" } : {}) },
          ...(index === 0 ? [{ functionCall: { id: "summary-capability", name: "load_capabilities", args: { capabilities: ["memory_summary"] } } }] : [])] : [{ text: "unvalidated closing" }] } };
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
  assert.deepEqual(result.counts, { modelCalls: 3, toolCalls: 4, queryEmbeddings: 0 });
  assert.deepEqual(summary.coveredMessageIds, seen.privateSummaryInput.messageIds);
  assert.equal(summary.previousVersion, 0); assert.equal(summary.basis, "a".repeat(64));
  if (characters === 800) assert.ok(summary.coveredMessageIds.length < messages.length);
  assert.deepEqual(await service.reply(userId, childId, messageId, async () => true), result); assert.equal(calls, 3);
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
    const normalized = sql.replace(/\s+/gu, " ").trim();
    const authorityQuery = `SELECT md5(jsonb_build_array(
      (SELECT coalesce(jsonb_agg(jsonb_build_array(id,version) ORDER BY id),'[]'::jsonb) FROM text_records WHERE child_id=$1),
      (SELECT coalesce(jsonb_agg(jsonb_build_array(id,version,status,visibility,valid_until,valid_until IS NULL OR valid_until>clock_timestamp()) ORDER BY id),'[]'::jsonb)
        FROM memory_facts WHERE child_id=$1 AND (visibility='family' OR created_by=$2)),
      (SELECT coalesce(jsonb_agg(jsonb_build_array(id,version) ORDER BY id),'[]'::jsonb) FROM memory_topics WHERE child_id=$1 AND (visibility='family' OR created_by=$2))
      )::text) AS authority, NOT EXISTS(SELECT 1 FROM memory_facts WHERE child_id=$1 AND (visibility='family' OR created_by=$2) AND NOT validity_indexed) AS metadata_complete`.replace(/\s+/gu, " ").trim();
    if (normalized === authorityQuery) {
      assert.deepEqual(params, [child, user]);
      return result([{ authority: "f".repeat(32), metadata_complete: true }]);
    }
    if (sql.includes("ORDER BY version DESC LIMIT 1")) return result(savedRow ? [savedRow] : []);
    if (sql.startsWith("SELECT profile_version")) return result([{ profile_version: profileVersion }]);
    if (sql.includes("SELECT m.* FROM chat_messages")) return result(rows.filter(row => params[2] || !coverage.has(row.id)).slice(0, 51));
    if (sql.startsWith("INSERT INTO conversation_summaries")) { savedRow = { id: params[0], payload_encrypted: params[5], invalidated: false }; return result([]); }
    if (sql.startsWith("DELETE FROM summary_message_coverage")) { coverage.clear(); return result([]); }
    if (sql.startsWith("INSERT INTO summary_message_coverage")) { params[0].forEach((id: string) => coverage.add(id)); return result([]); }
    const emptyQueries = [
      "SELECT id,version,payload_encrypted FROM memory_facts WHERE child_id=$1 AND (visibility='family' OR created_by=$2) AND NOT validity_indexed ORDER BY id LIMIT 100",
      "SELECT version,payload_encrypted FROM child_profile_revisions WHERE child_id=$1 AND version=$2",
      "SELECT 1 FROM conversation_summaries s WHERE s.child_id=$1 AND s.owner_user_id=$2 AND NOT s.invalidated AND (SELECT count(*) FROM summary_message_coverage c WHERE c.summary_id=s.id) <> s.covered_count LIMIT 1",
      "UPDATE conversation_summaries SET invalidated=true WHERE child_id=$1 AND owner_user_id=$2",
    ];
    if (emptyQueries.includes(normalized)) return result([]);
    throw new Error("Unexpected synthetic summary SQL: " + sql);
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
