import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { FinishReason } from "@google/genai";
import type { BaseSessionService } from "@google/adk";
import { createAgentRuntime, type AgentScope } from "../../server/agent-runtime.ts";
import { createProductAgent } from "../../server/product-agent.ts";
import { readAiConfig } from "../../server/ai-config.ts";
import type { DocumentChange, FamilyDocument } from "../../src/shared/family-documents.ts";
import type { ProductAgentResult } from "../../src/shared/product-agent.ts";

/** Synthetic domain ledger only; native storage may be memory or the isolated emulator. */
export function nativeSessionProductFixture(nativeSessionService: BaseSessionService, runId: string) {
  const userId = "synthetic-native-user", childId = "1ebcb39d-a2db-4b8c-a432-7ffcb3de5808";
  const messageId = "7de5a0e8-e106-4485-b7d2-3b572741da39";
  const scope: AgentScope = { userId, childId, workspaceId: "synthetic-workspace", authorizationVersion: "1", dataVersion: "epoch:1" };
  const sourceQuote = "請把合成準備單的書包一項勾選為已準備。";
  const document: FamilyDocument = { id: "11111111-1111-4111-8111-111111111111", childId, kind: "preparation", purpose: "school",
    version: 3, status: "active", archivedAt: null, autoRefresh: false, readState: "ready", history: [],
    current: { id: "22222222-2222-4222-8222-222222222222", version: 2, generatedAt: "2026-10-09T00:00:00Z", sourceBasis: "synthetic-basis",
      title: "Synthetic preparation", summary: "Synthetic summary", ageLabel: "Unknown", period: { from: "2026-10-09", to: "2026-10-09" }, eventDate: null,
      coverageNote: "Synthetic coverage", sources: [], changes: [], sections: [{ id: "checklist", title: "Checklist", kind: "checklist", domain: null,
        items: [{ id: "bag", text: "Synthetic bag", sourceIds: [], checked: false }] }] },
    manifest: { snapshotId: "22222222-2222-4222-8222-222222222222", snapshotVersion: 2, invalidated: false,
      sections: [{ id: "checklist", kind: "checklist", itemIds: ["bag"] }] } };
  const change: DocumentChange = { action: "check_item", expectedVersion: 3, authorityVersion: "synthetic-authority:6", sectionId: "checklist", itemId: "bag", checked: true };
  const hash = createHash("sha256").update(`family-document:${runId}:check-bag`).digest("hex");
  const operationId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  const ledger = new Map<string, { runId: string; documentId: string; savedVersion: number; toolName: "change_family_document" }>();
  let calls = 0, writes = 0, claimed = false, authorized = true, saved: ProductAgentResult | null = null;
  const runtime = createAgentRuntime({ nativeSessionService,
    config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    usage: { reserve: async () => true, record: async () => {} },
    provider: { generate: async request => {
      assert.equal(authorized, true);
      const index = calls++;
      assert.ok(index < 3, "No provider retry or extra closing generation is permitted");
      if (index > 0) assert.ok(request.contents.some(content => content.parts?.some(part => part.functionResponse)));
      const functionCall = index === 0 ? { id: "load-documents", name: "load_capabilities", args: { capabilities: ["document_edit"] } }
        : index === 1 ? { id: "check-bag", name: "change_family_document", args: { sourceQuote, documentId: document.id, change } }
        : { id: "answer", name: "present_answer", args: { kind: "operation", paragraphs: [{ text: "合成文件項目已按原操作收據更新。", citationIds: [] }] } };
      assert.ok(Object.hasOwn(request.toolsDict, functionCall.name));
      return { content: { role: "model", parts: [{ functionCall, thoughtSignature: "synthetic-native-signature" }] }, finishReason: FinishReason.STOP };
    } } });
  const options = { runtime,
    store: {
      claim: async (actor: string, child: string, trigger: { kind: string; reference: string }, recipe: string) => {
        assert.deepEqual([actor, child, trigger, recipe], [userId, childId, { kind: "interactive", reference: messageId }, "product-interactive"]);
        const created = !claimed; claimed = true;
        return { runId, scope, created, sourceMessageId: messageId, state: saved?.status ?? "running", expiresAt: new Date(Date.now() + 90000).toISOString() };
      },
      authorize: async (value: AgentScope, originalRun: string) => { assert.deepEqual(value, scope); assert.equal(originalRun, runId); return authorized; },
      writeDocument: async (value: AgentScope, originalRun: string, originalOperation: string, quote: string, mutation: { id: string; change: DocumentChange }) => {
        assert.equal(authorized, true); assert.deepEqual(value, scope); assert.equal(originalRun, runId); assert.equal(originalOperation, operationId);
        assert.equal(quote, sourceQuote); assert.deepEqual(mutation, { id: document.id, change });
        assert.equal(ledger.has(originalOperation), false, "The original operation may commit only once");
        writes++; document.version = 4; document.current!.sections[0].items[0].checked = true;
        ledger.set(originalOperation, { runId, documentId: document.id, savedVersion: 4, toolName: "change_family_document" });
        return structuredClone(document);
      },
      documentReceipts: async (value: AgentScope, originalRun: string) => {
        assert.equal(authorized, true); assert.deepEqual(value, scope); assert.equal(originalRun, runId);
        return { receipts: [...ledger].map(([operationId, receipt]) => ({ operationId, ...receipt })), unavailable: false, linked: ledger.size > 0 };
      },
      finish: async (value: AgentScope, result: ProductAgentResult) => { assert.equal(authorized, true); assert.deepEqual(value, scope); saved = structuredClone(result); return true; },
      get: async (actor: string, child: string, originalRun: string) => { assert.deepEqual([actor, child, originalRun], [userId, childId, runId]); return authorized ? structuredClone(saved) : null; },
    },
    documents: { describe: async (actor: string, child: string, id: string) => {
      assert.equal(authorized, true); assert.deepEqual([actor, child, id], [userId, childId, document.id]);
      return { item: structuredClone(document), authorityVersion: "synthetic-authority:7" };
    } },
    memory: { context: async () => ({ profile: { childId, version: 0, data: null }, profileApplicable: false, facts: [], topics: [], summary: null,
      recentMessages: [], conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false } }) },
    chat: { listForUser: async () => ({ messages: [{ id: messageId, role: "user", text: sourceQuote }] }) },
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
    knowledge: { createRun: () => ({ search: async () => { throw new Error("No knowledge call permitted"); }, revalidateCitations: async () => true }) },
  } as unknown as Parameters<typeof createProductAgent>[0];
  const agent = createProductAgent(options);
  return { key: { appName: "yuban_hk", userId, sessionId: runId }, operationId, documentId: document.id,
    reply: (signal?: AbortSignal) => agent.reply(userId, childId, messageId, async () => authorized, signal),
    revoke: () => { authorized = false; },
    observe: () => ({ calls, writes, documentVersion: document.version, ledger: [...ledger].map(([operationId, receipt]) => ({ operationId, ...receipt })) }) };
}
