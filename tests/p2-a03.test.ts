import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { randomUUID } from "node:crypto";
import { FinishReason } from "@google/genai";
import { z } from "zod";
import type { Pool } from "pg";
import type { DocumentSnapshot, DocumentRequest, DocumentSource, DocumentPatch } from "../src/shared/family-documents.ts";
import { documentChangeSchema, documentPatchSchema } from "../src/shared/family-documents.ts";
import { agentProposalSchema } from "../src/shared/product-agent.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import { FamilyError } from "../server/family-access.ts";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import { readAiConfig } from "../server/ai-config.ts";
import { createFamilyDocumentsApi } from "../src/client/family-documents-api.ts";

let stopped = false;
function focusedTest(name: string, fn: () => Promise<void>) {
  test(name, async t => {
    if (stopped) { t.skip("Stopped at the first focused failure"); return; }
    try { await fn(); } catch (error) { stopped = true; throw error; }
  });
}
const loadedByChild = new Map<string, any>();
mock.module("../server/care.ts", { namedExports: { createCareStore: () => ({ reportSource: async (_u: string, child: string) => {
  const loaded = loadedByChild.get(child); return { profile: loaded.profile, records: loaded.records ?? [] };
} }) } });
mock.module("../server/memory.ts", { namedExports: { createMemoryStore: () => ({ context: async (_u: string, child: string) => ({ profileApplicable: true,
  facts: loadedByChild.get(child).facts ?? [], truncated: { facts: Boolean(loadedByChild.get(child).moreFacts) } }),
  getFact: async (_u: string, child: string, id: string) => loadedByChild.get(child).extraFacts?.get(id) ?? null }) } });
mock.module("../server/tasks.ts", { namedExports: { createTaskStore: () => ({ list: async (_u: string, child: string) => ({ items: [], eligibleAssignees: [], nextAfterId: loadedByChild.get(child).moreTasks ? randomUUID() : null }),
  get: async (_u: string, child: string, id: string) => loadedByChild.get(child).extraTasks?.get(id) ?? null }) } });
mock.module("../server/concern-store.ts", { namedExports: { createConcernStore: () => ({ list: async () => ({ items: [] }) }) } });
const { buildFamilyDocumentSnapshot, documentSnapshotValid, loadFamilyDocumentSources, supplementFamilyDocumentSources } = await import("../server/family-document-sources.ts");
const { applyFamilyDocumentPatch } = await import("../server/family-document-edits.ts");
const { createFamilyDocumentStore } = await import("../server/family-document-store.ts");
const { createProductAgentStore } = await import("../server/product-agent-store.ts");
const { createAgentDocumentTools } = await import("../server/agent-document-tools.ts");
const { handleFamilyDocumentRequest } = await import("../server/family-document-api.ts");
const { decodeDocumentCursor } = await import("../server/family-document-reading.ts");

const request: DocumentRequest = { kind: "preparation", purpose: "appointment", title: "Synthetic A03", eventDate: null, period: { from: "2026-10-01", to: "2026-10-31" } };
function harness(long = false) {
  const userId = "synthetic-a03-owner", childId = randomUUID(), workspaceId = randomUUID(), epoch = randomUUID();
  const cipher = createStorageCipher(Buffer.alloc(32, 39));
  const loaded = { profile: { childId, version: 1, data: null, confirmedBy: null, confirmedAt: null, reason: null },
    records: long ? Array.from({ length: 18 }, (_, index) => ({ id: randomUUID(), version: 1, text: `Synthetic ${index}: ` + "x".repeat(3300),
      details: { kind: "note", eventTime: { at: "2026-10-08T00:00:00Z", precision: "exact" } } })) : [] };
  loadedByChild.set(childId, loaded);
  const rows: any[] = [], revisions: any[] = [], receipts: any[] = [], proposals: any[] = [], confirmations: any[] = [], queries: string[] = [];
  let seq = 1, activeCount: number | null = null; const workerGeneration = randomUUID();
  const scope = { userId, childId, workspaceId, authorizationVersion: "1", dataVersion: epoch + ":1" };
  const run = { id: randomUUID(), child_id: childId, owner_user_id: userId, state: "running", trigger_kind: "interactive", source_message_id: randomUUID(),
    authorization_version: "1", data_version: scope.dataVersion, created_at: new Date(), expires_at: new Date(Date.now() + 90000) };
  const result = (items: any[] = []) => ({ rows: structuredClone(items), rowCount: items.length });
  const query = async (sql: string, params: any[] = []): Promise<any> => {
    queries.push(sql);
    if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE SAVEPOINT|SET LOCAL)/u.test(sql)) return result();
    if (sql.startsWith("SELECT workspace_id FROM children")) return result(params[0] === childId ? [{ workspace_id: workspaceId }] : []);
    if (sql.startsWith("SELECT owner_user_id, access_version")) return result([{ owner_user_id: userId, access_version: 1 }]);
    if (sql.startsWith("SELECT role FROM family_members")) return result();
    if (sql.startsWith("SELECT 1 FROM children")) return result([{}]);
    if (sql.startsWith("SELECT storage_epoch")) return result([{ storage_epoch: epoch, access_version: "1" }]);
    if (sql.startsWith("SELECT access_version::text")) return result([{ storage_epoch: epoch, access_version: "1", change_seq: String(seq) }]);
    if (sql.startsWith("SELECT version FROM agent_operation_policies")) return result();
    if (sql.includes("FROM children c JOIN workspaces")) return result([{ owner_user_id: userId, display_name_encrypted: cipher.encrypt("A03 合成孩子", `children:${childId}:${userId}:display_name`) }]);
    if (sql.startsWith("UPDATE agent_runs SET state=")) return result();
    if (sql.startsWith("UPDATE agent_proposals SET state=")) return result();
    if (sql.includes("FROM agent_runs") && !sql.includes("JOIN")) return result([run]);
    if (sql.startsWith("SELECT text_encrypted FROM chat_messages")) return result([{ text_encrypted: cipher.encrypt("Synthetic remove only", `chat_messages:${run.source_message_id}:${childId}:${userId}:user::text`) }]);
    if (sql.startsWith("UPDATE agent_runs SET data_version")) { run.data_version = params[1]; return result(); }
    if (sql.startsWith("SELECT pg_advisory")) return result();
    if (sql.startsWith("SELECT * FROM family_document_operations")) return result(receipts.filter(item => item.user_id === params[0] && item.op_id === params[1]));
    if (sql.startsWith("SELECT count(*)")) return result([{ count: activeCount ?? rows.filter(item => item.status === "active").length }]);
    if (sql.startsWith("SELECT id,child_id,created_by FROM family_documents WHERE dirty")) return result(rows.filter(item => item.dirty));
    if (sql.startsWith("SELECT w.owner_user_id FROM children")) return result([{ owner_user_id: userId }]);
    if (sql.startsWith("SELECT enabled,generation FROM worker_control")) return result([{ enabled: true, generation: workerGeneration }]);
    if (sql.startsWith("SELECT 1 FROM workspaces")) return result([{}]);
    if (sql.startsWith("UPDATE family_documents SET dirty=false")) { rows.find(item => item.id === params[0]).dirty = false; return result(); }
    if (sql.startsWith("SELECT * FROM family_documents WHERE id=")) return result(rows.filter(item => item.id === params[0] && item.child_id === params[1]));
    if (sql.startsWith("SELECT * FROM family_documents WHERE child_id=$1 AND kind=")) return result(rows.filter(item => item.kind === "growth_report" && item.status === "active"));
    if (sql.includes("FROM family_documents WHERE child_id=$1 AND ($2=")) {
      const [child, status, highAt, highId, afterAt, afterId, limit] = params;
      const before = (item: any, at: string, id: string, inclusive: boolean) => item.cursor_at < at || item.cursor_at === at && (inclusive ? item.id <= id : item.id < id);
      return result(rows.filter(item => item.child_id === child && (status === "all" || item.status === status)
        && (!highAt || before(item, highAt, highId, true)) && (!afterAt || before(item, afterAt, afterId, false)))
        .sort((a, b) => b.cursor_at.localeCompare(a.cursor_at) || b.id.localeCompare(a.id)).slice(0, limit));
    }
    if (sql.startsWith("SELECT id,version,payload_encrypted FROM family_document_snapshots")) {
      let found = revisions.filter(item => item.document_id === params[0]);
      if (sql.includes("AND id=$2")) found = found.filter(item => item.id === params[1] && (!params[2] || item.version === params[2]));
      else if (sql.includes("AND id<>$2")) found = found.filter(item => item.id !== params[1]).sort((a, b) => b.version - a.version).slice(0, params[2]);
      else found = found.filter(item => (!params[1] || item.version <= params[1]) && (!params[2] || item.version < params[2])).sort((a, b) => b.version - a.version).slice(0, 11);
      return result(found);
    }
    if (sql.startsWith("INSERT INTO family_documents(")) { const created = new Date(Date.UTC(2026, 9, 8, 0, 0, 0, rows.length)).toISOString();
      rows.push({ id: params[0], child_id: params[1], created_by: params[2], version: params[3], kind: params[4], status: params[5], auto_refresh: params[6], payload_encrypted: params[7], cursor_at: created.replace("Z", "000Z") }); return result(); }
    if (sql.startsWith("UPDATE family_documents SET version=")) { Object.assign(rows.find(item => item.id === params[0]), { version: params[1], status: params[2], auto_refresh: params[3], payload_encrypted: params[4] }); return result(); }
    if (sql.startsWith("INSERT INTO family_document_snapshots")) { revisions.push({ id: params[0], document_id: params[1], version: params[2], payload_encrypted: params[3] }); return result(); }
    if (sql.startsWith("INSERT INTO family_document_operations")) { receipts.push({ user_id: params[0], op_id: params[1], child_id: params[2], storage_epoch: params[3], request_encrypted: params[4], result_encrypted: params[5] }); return result(); }
    if (sql.startsWith("UPDATE workspaces SET change_seq")) { seq++; return result([{ change_seq: String(seq) }]); }
    if (sql.startsWith("INSERT INTO online_changes")) return result();
    if (sql.includes("FROM agent_proposals p JOIN")) return result(proposals.filter(item => item.id === params[0]).map(item => ({ ...item, authorization_version: "1", data_version: run.data_version })));
    if (sql.includes("FROM agent_proposals WHERE id=")) return result(proposals.filter(item => item.id === params[0] && item.run_id === params[1]));
    if (sql.includes("FROM agent_proposals WHERE run_id=")) return result(proposals.filter(item => item.run_id === params[0]));
    if (sql.startsWith("INSERT INTO agent_proposals(")) { const row = { id: params[0], run_id: params[1], call_id: params[2], payload_encrypted: params[3], version: 1, state: "pending", created_at: new Date(), expires_at: new Date(Date.now() + 60000) }; proposals.push(row); return result([row]); }
    if (sql.startsWith("UPDATE agent_proposals SET")) { const row = proposals.find(item => item.id === params[0]); Object.assign(row, { version: params[1], state: params[2], payload_encrypted: params[3] }); return result([row]); }
    if (sql.startsWith("SELECT * FROM agent_confirmations")) return result(confirmations.filter(item => item.asking_run_id === params[0] && item.proposal_id === params[1] && item.proposal_version === params[2]));
    if (sql.startsWith("INSERT INTO agent_confirmations(")) { confirmations.push({ id: params[0] }); return result(); }
    throw new Error("Unhandled synthetic SQL: " + sql);
  };
  const client = { query, release() {} }, pool = { query, connect: async () => client } as unknown as Pool;
  const store = createFamilyDocumentStore(pool, cipher), agent = createProductAgentStore(pool, cipher);
  return { userId, childId, workspaceId, cipher, scope, run, rows, revisions, receipts, proposals, queries, store, agent, loaded,
    authority: epoch + ":1", workerGeneration, client, setActiveCount(value: number | null) { activeCount = value; } };
}
const patch = (h: ReturnType<typeof harness>, version: number, edits: DocumentPatch["edits"]): DocumentPatch => ({ action: "patch", expectedVersion: version, authorityVersion: h.authority, edits });

focusedTest("local typed edits preserve unrelated content, checks, order and protected refresh", async () => {
  const h = harness(), loaded = await loadFamilyDocumentSources(h.client as any, h.cipher, h.userId, h.childId);
  const prior = buildFamilyDocumentSnapshot(loaded, request, 1, null);
  prior.sections.find(section => section.id === "checklist")!.items.forEach(item => { item.checked = true; });
  const changed = applyFamilyDocumentPatch(prior, patch(h, 1, [{ op: "upsert_item", sectionId: "checklist", itemId: "template-0", text: "帶備水樽" },
    { op: "set_metadata", eventDate: "2026-10-19" }, { op: "remove_section", sectionId: "questions" },
    { op: "move_section", sectionId: "checklist", beforeId: "notes" }]), loaded, 2);
  assert.equal(changed.sections[0].id, "checklist"); assert.equal(changed.sections[0].items[0].checked, false); assert.equal(changed.sections[0].items[1].checked, true);
  assert.deepEqual(changed.period, prior.period); assert.equal(changed.ageLabel, prior.ageLabel); assert.equal(prior.eventDate, null);
  const refreshed = buildFamilyDocumentSnapshot(loaded, request, 3, changed);
  assert.deepEqual(refreshed.sections.find(section => section.id === "checklist"), changed.sections[0]); assert.equal(refreshed.eventDate, "2026-10-19");
  assert.equal(refreshed.sections[0].id, "checklist"); assert.ok(!refreshed.sections.some(section => section.id === "questions"));
  const factId = randomUUID(), source: DocumentSource = { id: "fact:" + factId, resourceId: factId, kind: "fact", version: 2, text: "known：synthetic", label: "已確認家庭事實", at: null };
  const outside = { ...prior, sources: [source] };
  const extraFact = { id: factId, version: 2, visibility: "family", status: "confirmed", applicable: true, sourceState: "current", key: "known", content: "synthetic" };
  Object.assign(h.loaded, { moreFacts: true, extraFacts: new Map([[factId, extraFact]]) });
  const prefix = await loadFamilyDocumentSources(h.client as any, h.cipher, h.userId, h.childId);
  assert.equal(prefix.limited, true); assert.equal(documentSnapshotValid(outside, prefix), false);
  await supplementFamilyDocumentSources(h.client as any, h.cipher, h.userId, h.childId, prefix, [outside]);
  assert.equal(documentSnapshotValid(outside, prefix), true);
});

focusedTest("fixed long snapshot reads and keyset document/version pages remain resumable", async () => {
  const h = harness(true), documents = [];
  for (let i = 0; i < 3; i++) documents.push((await h.store.create(h.userId, h.childId, { ...request, title: "Synthetic " + i }, randomUUID()))!);
  const first = await h.store.list(h.userId, h.childId, { limit: 2 }); assert.equal(first!.items.length, 2); assert.ok(first!.nextCursor);
  assert.throws(() => decodeDocumentCursor(first!.nextCursor!, "documents", "other", h.childId, "all"), { code: "invalid_input" });
  assert.throws(() => decodeDocumentCursor(first!.nextCursor!, "documents", h.userId, h.childId, "archived"), { code: "invalid_input" });
  const second = await h.store.list(h.userId, h.childId, { limit: 2, cursor: first!.nextCursor }); assert.equal(second!.items.length, 1); assert.equal(second!.hasMore, false);
  const document = documents[0], original = document.current!, read = { snapshotId: original.id, snapshotVersion: original.version, offset: 0 };
  let text = "", offset = 0, total = 0;
  do { const page = (await h.store.readContent(h.userId, h.childId, document.id, { ...read, offset }))!; assert.ok(page.text.length <= 4000);
    assert.equal(page.snapshotId, original.id); assert.equal(page.contentKind, "snapshot_json"); text += page.text; total = page.totalCharacters; offset = page.nextOffset ?? -1;
  } while (offset !== -1);
  assert.equal(text.length, total); assert.deepEqual(JSON.parse(text), original); assert.ok(total > 7000);
  let current = document;
  for (let i = 0; i < 11; i++) current = (await h.store.change(h.userId, h.childId, document.id, { action: "check_item", expectedVersion: current.version,
    authorityVersion: h.authority, sectionId: "checklist", itemId: "template-0", checked: i % 2 === 0 }, randomUUID()))!;
  const oldRead = (await h.store.readContent(h.userId, h.childId, document.id, read))!; assert.equal(oldRead.snapshotId, original.id); assert.equal(oldRead.documentVersion, 12);
  const versions = (await h.store.listVersions(h.userId, h.childId, document.id))!; assert.equal(versions.items.length, 10); assert.ok(versions.nextCursor);
  const tail = (await h.store.listVersions(h.userId, h.childId, document.id, versions.nextCursor))!; assert.equal(tail.items.length, 2); assert.equal(tail.items.at(-1)!.snapshotId, original.id);
  assert.equal(await h.store.readContent(h.userId, h.childId, document.id, { ...read, snapshotVersion: 2 }), null);
  assert.ok(h.queries.some(sql => sql.includes("(created_at,id)<"))); assert.ok(!h.queries.some(sql => /OFFSET/u.test(sql)));
  const archived = (await h.store.change(h.userId, h.childId, document.id, { action: "archive", expectedVersion: current.version, authorityVersion: h.authority }, randomUUID()))!;
  assert.equal((await h.store.list(h.userId, h.childId, { status: "archived" }))!.items[0].id, archived.id);
  h.setActiveCount(50);
  await assert.rejects(h.store.create(h.userId, h.childId, request, randomUUID()), { code: "document_limit" });
  await assert.rejects(h.store.change(h.userId, h.childId, archived.id, { action: "restore", expectedVersion: archived.version, authorityVersion: h.authority }, randomUUID()), { code: "document_limit" });
  h.setActiveCount(null);
  assert.equal((await h.store.change(h.userId, h.childId, archived.id, { action: "restore", expectedVersion: archived.version, authorityVersion: h.authority }, randomUUID()))!.status, "active");
});

focusedTest("native ADK declares document edits and saves one bound shared candidate before decision", async () => {
  const h = harness(), document = (await h.store.create(h.userId, h.childId, request, randomUUID()))!;
  const value = { documentId: document.id, change: patch(h, document.version, [{ op: "upsert_item", sectionId: "checklist", itemId: "template-0", text: "帶備替換衣服" }]) };
  let step = 0;
  const runtime = createAgentRuntime({ config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }), usage: { reserve: async () => true, record: async () => {} },
    provider: { generate: async args => {
      const declarations = JSON.stringify(args.config?.tools); assert.ok(!declarations.includes('"oneOf"')); assert.ok(!declarations.includes('"exclusiveMinimum"'));
      if (step++) { assert.ok(args.contents.some(item => item.parts?.some(part => part.functionResponse))); return { content: { role: "model", parts: [{ functionCall: { id: "finish", name: "present_answer", args: {} } }] }, finishReason: FinishReason.STOP }; }
      return { content: { role: "model", parts: [{ functionCall: { id: "candidate", name: "propose_family_document_change", args: value } }] }, finishReason: FinishReason.STOP };
    } } });
  const result = await runtime.run({ scope: h.scope, runId: h.run.id, trigger: { kind: "interactive", reference: h.run.source_message_id! }, recipeId: "product-interactive",
    availableInputs: ["run", "scope", "conversation", "context", "evidence", "capabilities"], context: {}, messages: [{ role: "user", text: "Synthetic specific document update." }], authorize: async () => true,
    tools: run => [...createAgentDocumentTools(h.store, h.agent, run, async () => true), { name: "present_answer", description: "Synthetic terminal.", parameters: z.object({}).strict(), terminal: true,
      authorize: async () => true, execute: async () => ({ status: "succeeded", data: { accepted: true } }) }], finalize: async () => "Synthetic candidate saved." });
  assert.equal(result.status, "completed"); assert.equal(h.proposals.length, 1); assert.equal(h.rows[0].version, 1);
  const proposalId = h.proposals[0].id;
  const question = await h.agent.requestConfirmation(h.scope, h.run.id, { runId: h.run.id, proposalId, expectedVersion: 1, workId: null });
  assert.ok(question?.question.includes("帶備替換衣服") || question?.question.includes("帶備替換衣服")); assert.ok(question!.question.includes("目前孩子的共用資料；其他有權照顧者可查看這份整理，私人聊天原文不會分享。"));
  await assert.rejects(h.agent.decide(h.userId, h.childId, h.run.id, proposalId, { decision: "accept", expectedVersion: 1, confirmShared: false }), { code: "sharing_confirmation_required" });
  const accepted = (await h.agent.decide(h.userId, h.childId, h.run.id, proposalId, { decision: "accept", expectedVersion: 1, confirmShared: true }))!;
  assert.equal(accepted.result!.kind, "family_document"); assert.equal(accepted.result!.id, document.id); assert.equal(accepted.result!.version, 2);
  assert.deepEqual(await h.agent.decide(h.userId, h.childId, h.run.id, proposalId, { decision: "accept", expectedVersion: 1, confirmShared: true }), accepted);
  assert.equal(h.receipts.at(-1).op_id, proposalId); assert.equal(h.rows[0].version, 2);
  const candidate = (await h.agent.propose(h.scope, h.run.id, "source-bound", { kind: "family_document_change", documentId: document.id,
    change: patch(h, 2, [{ op: "set_metadata", summary: "Sensitive candidate wording", eventDate: "2026-10-19" }]) }))!;
  assert.ok(!("documentSourceBasis" in candidate), "Server-only source binding must not enter public proposals");
  h.loaded.records.push({ id: randomUUID(), version: 1, text: "Synthetic newly confirmed source", details: { kind: "note", eventTime: { at: "2026-10-08T00:00:00Z", precision: "exact" } } });
  await assert.rejects(h.agent.decide(h.userId, h.childId, h.run.id, candidate.id, { decision: "accept", expectedVersion: candidate.version, confirmShared: true }), { code: "source_changed" });
  const view = (await h.agent.get(h.userId, h.childId, h.run.id))!.proposals.find(item => item.id === candidate.id)!;
  assert.equal(view.contentState, "invalidated"); assert.equal(view.targetLabel, null); assert.ok(!JSON.stringify(view.value).includes("Sensitive candidate wording"));
  assert.ok(JSON.stringify(view.value).includes("內容已失效，請重新核對")); assert.ok(!JSON.stringify(view.value).includes("2026-10-19"));
  assert.ok(h.cipher.decrypt(h.proposals.find(item => item.id === candidate.id).payload_encrypted,
    `agent-run:${h.childId}:${h.userId}:${h.run.id}:proposal:${candidate.id}:1`).includes("Sensitive candidate wording"), "Read redaction must not rewrite the encrypted candidate");
});

focusedTest("source invalidation, atomic rejection, scope and original unknown operation stay protected", async () => {
  const h = harness(true), document = (await h.store.create(h.userId, h.childId, request, randomUUID()))!, loaded = await loadFamilyDocumentSources(h.client as any, h.cipher, h.userId, h.childId);
  const unsafe = patch(h, 1, [{ op: "set_metadata", title: "Partial write must roll back" }, { op: "move_item", sectionId: "checklist", itemId: "missing", beforeId: null }]);
  await assert.rejects(h.store.change(h.userId, h.childId, document.id, { ...unsafe, confirmShared: true }, randomUUID()), { code: "invalid_document_edit" }); assert.equal(h.rows[0].version, 1);
  assert.equal(documentChangeSchema.safeParse({ ...unsafe, confirmShared: false }).success, false);
  assert.equal(documentPatchSchema.safeParse({ ...unsafe, path: "/access" }).success, false);
  assert.equal(agentProposalSchema.safeParse({ kind: "family_document_change", documentId: document.id, change: patch(h, 1, [
    { op: "upsert_item", sectionId: "checklist", itemId: "template-0", text: "x".repeat(4000) }, { op: "upsert_item", sectionId: "checklist", itemId: "template-1", text: "y".repeat(4000) }]) }).success, false);
  await assert.rejects(h.agent.writeDocument(h.scope, h.run.id, randomUUID(), "Synthetic", { id: document.id, change: { ...patch(h, 1, [{ op: "set_metadata", title: "Smuggled" }]), confirmShared: true } }), { code: "document_confirmation_required" });
  const duplicate = structuredClone(document.current!); duplicate.sections.push(structuredClone(duplicate.sections[0]));
  assert.throws(() => applyFamilyDocumentPatch(duplicate, patch(h, 1, [{ op: "set_metadata", title: "Safe title" }]), loaded, 2), { code: "invalid_document_edit" });
  const oversize = structuredClone(document.current!); oversize.summary = "x".repeat(240000);
  assert.throws(() => applyFamilyDocumentPatch(oversize, patch(h, 1, [{ op: "set_metadata", title: "Safe title" }]), loaded, 2), { code: "document_capacity_exceeded" });
  const first = (await h.store.list(h.userId, h.childId, { limit: 1 }))!;
  if (first.nextCursor) assert.throws(() => decodeDocumentCursor(first.nextCursor!, "documents", "other", h.childId, "all"));
  assert.equal(await h.store.get("synthetic-other", h.childId, document.id), null);
  const change = { ...patch(h, 1, [{ op: "upsert_item", sectionId: "checklist", itemId: "template-0", text: "明確確認的準備" }]), confirmShared: true as const };
  let lost = true, bodies: string[] = [];
  const api = createFamilyDocumentsApi("https://synthetic.invalid", async (url, options) => {
    if (options?.body) bodies.push(String(options.body));
    const response = await handleFamilyDocumentRequest(new Request(String(url), options as RequestInit), h.userId, h.store, async () => true);
    if (lost && options?.body) { lost = false; return new Response("", { status: 503 }); } return response;
  });
  const signal = new AbortController().signal;
  await assert.rejects(api.change(h.childId, document.id, change, signal, h.userId)); assert.ok(api.hasUnknownOriginal());
  const readback = await api.getItem(h.childId, document.id, signal, h.userId); assert.equal(readback.version, 2);
  assert.equal((await api.change(h.childId, document.id, change, signal, h.userId)).version, 2); assert.equal(bodies[0], bodies[1]);
  const sourceItem = document.current!.sections.find(section => section.id === "notes")!.items.find(item => item.sourceIds[0].startsWith("record:"))!;
  h.loaded.records.length = 0;
  const invalid = (await h.store.get(h.userId, h.childId, document.id))!; assert.equal(invalid.current, null); assert.equal(invalid.manifest!.invalidated, true);
  const redacted = (await h.store.readContent(h.userId, h.childId, document.id, { snapshotId: readback.current!.id, snapshotVersion: 2, offset: 0 }))!;
  assert.equal(redacted.contentKind, "redacted_manifest_json"); assert.equal(redacted.invalidated, true); assert.ok(!redacted.text.includes('"title"')); assert.ok(!redacted.text.includes('"text"'));
  await assert.rejects(h.store.change(h.userId, h.childId, document.id, { ...patch(h, 2, [{ op: "upsert_item", sectionId: "notes", itemId: sourceItem.id, text: sourceItem.text, sourceIds: [] }]), confirmShared: true }, randomUUID()), { code: "source_changed" });
  const repaired = (await h.store.change(h.userId, h.childId, document.id, { ...patch(h, 2, [{ op: "remove_section", sectionId: "notes" }]), confirmShared: true }, randomUUID()))!;
  assert.ok(repaired.current); assert.equal(repaired.current!.sources.some(source => source.kind === "record"), false);
  assert.ok(repaired.current!.sources.some(source => source.kind === "profile"), "Age metadata retains its original profile dependency after removing notes");
  const worker = harness(), growth = { ...request, kind: "growth_report" as const, purpose: "handoff" as const };
  const protectedDocument = (await worker.store.create(worker.userId, worker.childId, growth, randomUUID()))!;
  const regular = (await worker.store.create(worker.userId, worker.childId, growth, randomUUID()))!;
  const protectedSnapshot = (await worker.store.change(worker.userId, worker.childId, protectedDocument.id, { ...patch(worker, 1, [
    { op: "upsert_item", sectionId: "profile", itemId: "profile:" + worker.childId, text: "Explicit profile wording", sourceIds: ["profile:" + worker.childId] }]), confirmShared: true }, randomUUID()))!;
  worker.loaded.profile.version = 2;
  worker.rows.forEach(row => { row.dirty = true; row.dirty_epoch = worker.authority.split(":")[0]; row.dirty_generation = worker.workerGeneration; });
  assert.equal(await worker.store.refreshPending(worker.workerGeneration), 1, "A review-required document must not stop the next worker document");
  assert.equal(worker.rows.find(row => row.id === protectedDocument.id).dirty, false);
  assert.equal(worker.rows.find(row => row.id === protectedDocument.id).version, protectedSnapshot.version);
  assert.equal(worker.rows.find(row => row.id === regular.id).version, 2);
  assert.equal((await worker.store.get(worker.userId, worker.childId, protectedDocument.id))!.current, null);
  const transition = (await worker.store.change(worker.userId, worker.childId, protectedDocument.id, { ...patch(worker, protectedSnapshot.version,
    [{ op: "remove_section", sectionId: "profile" }]), confirmShared: true }, randomUUID()))!;
  assert.equal(transition.readState, "invalidated"); assert.equal(transition.current, null);
  const fresh = (await worker.store.change(worker.userId, worker.childId, protectedDocument.id, { action: "refresh", expectedVersion: transition.version, authorityVersion: worker.authority }, randomUUID()))!;
  assert.equal(fresh.readState, "ready"); assert.equal(fresh.current!.sources.find(source => source.kind === "profile")!.version, 2);
  assert.ok(!fresh.current!.sections.some(section => section.id === "profile"));
});
