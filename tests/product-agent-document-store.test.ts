import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Pool } from "pg";
import type { AgentScope } from "../server/agent-runtime.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import type { DocumentRequest } from "../src/shared/family-documents.ts";

// Real domain stores and source validators with a transaction/savepoint-aware synthetic Pool.
// This is not a PostgreSQL engine, live database, or transaction-race acceptance test.
test("committed document run association is atomic, scoped and recoverable without replay", async t => {
  const userId = "synthetic-parent", childId = "1ebcb39d-a2db-4b8c-a432-7ffcb3de5808";
  const workspaceId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", epoch = "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb";
  const runId = "d4a1b662-d13d-476b-bf52-40a28aa1a1a7", messageId = "7de5a0e8-e106-4485-b7d2-3b572741da39";
  const documentId = "11111111-1111-4111-8111-111111111111", snapshotId = "22222222-2222-4222-8222-222222222222";
  const opId = "6697e43e-648d-4edb-a356-eac5f330ca76", quote = "請把準備單首項勾選為已準備。";
  let profileVersion = 1;
  const profile = () => ({ childId, version: profileVersion, data: null, confirmedBy: null, confirmedAt: null, reason: null });
  t.mock.module("../server/care.ts", { namedExports: { createCareStore: () => ({ profile: async () => profile(), search: async () => ({ records: [] }) }) } });
  t.mock.module("../server/memory.ts", { namedExports: { createMemoryStore: () => ({ reportFacts: async () => ({ items: [] }) }) } });
  t.mock.module("../server/tasks.ts", { namedExports: { createTaskStore: () => ({ list: async () => ({ items: [] }) }) } });
  t.mock.module("../server/concern-store.ts", { namedExports: { createConcernStore: () => ({ reportPage: async () => ({ items: [] }) }) } });
  const { createProductAgentStore } = await import("../server/product-agent-store.ts");
  const { loadFamilyDocumentSources, buildFamilyDocumentSnapshot } = await import("../server/family-document-sources.ts");
  const cipher = createStorageCipher(Buffer.alloc(32, 38));
  const request: DocumentRequest = { kind: "preparation", purpose: "school", title: "Synthetic document", eventDate: null,
    period: { from: "2026-10-01", to: "2026-10-08" } };
  const scope: AgentScope = { userId, childId, workspaceId, authorizationVersion: "1", dataVersion: epoch + ":1" };
  async function harness() {
    profileVersion = 1;
    const loaded = await loadFamilyDocumentSources({ query: async (sql: string) => { throw new Error("Unexpected snapshot initialization SQL: " + sql); } } as never, cipher, userId, childId);
    const snapshot = buildFamilyDocumentSnapshot(loaded, request, 3, null); snapshot.id = snapshotId;
    const payloadContext = `family-document:${childId}:${documentId}:${userId}`;
    let state: any = { space: { access_version: "1", storage_epoch: epoch, change_seq: "1" }, allowed: true, sourceExists: true,
      run: { id: runId, child_id: childId, owner_user_id: userId, source_message_id: messageId, trigger_kind: "interactive", trigger_reference: messageId,
        authorization_version: "1", data_version: epoch + ":1", recipe_id: "product-interactive", state: "running", stop_reason: null,
        expires_at: new Date(Date.now() + 90_000), created_at: new Date(), result_encrypted: null },
      documents: new Map([[documentId, { id: documentId, child_id: childId, created_by: userId, version: 3, kind: "preparation", status: "active",
        auto_refresh: false, dirty: false, source_revision: "0", progress_encrypted: null,
        payload_encrypted: cipher.encrypt(JSON.stringify({ request, currentId: snapshotId, status: "active", archivedAt: null, autoRefresh: false }), payloadContext + ":3") }]]),
      snapshots: new Map([[snapshotId, { id: snapshotId, document_id: documentId, version: 3,
        payload_encrypted: cipher.encrypt(JSON.stringify(snapshot), payloadContext + ":snapshot:" + snapshotId + ":3") }]]),
      operations: new Map(), links: new Map(), documentChanges: 0 };
    const savepoints = new Map<string, any>(), queries: string[] = [];
    let transaction: any = null, failure: string | null = null, readFailure = false, receiptChildMismatch = false;
    const rows = (items: any[] = []) => ({ rows: structuredClone(items), rowCount: items.length });
    async function query(sql: string, values: any[] = []): Promise<any> {
      queries.push(sql);
      if (sql === "BEGIN") { assert.equal(transaction, null); transaction = structuredClone(state); return rows(); }
      if (sql === "COMMIT") { assert.ok(transaction); transaction = null; return rows(); }
      if (sql === "ROLLBACK") { assert.ok(transaction); state = transaction; transaction = null; savepoints.clear(); return rows(); }
      if (sql.startsWith("SAVEPOINT ")) { savepoints.set(sql.slice(10), structuredClone(state)); return rows(); }
      if (sql.startsWith("ROLLBACK TO SAVEPOINT ")) { state = structuredClone(savepoints.get(sql.slice(22))); return rows(); }
      if (sql.startsWith("RELEASE SAVEPOINT ")) { savepoints.delete(sql.slice(18)); return rows(); }
      if (/^(SET LOCAL|SELECT pg_advisory_xact_lock)/u.test(sql)) return rows();
      if (sql.startsWith("SELECT workspace_id FROM children")) return rows(values[0] === childId ? [{ workspace_id: workspaceId }] : []);
      if (sql.startsWith("SELECT owner_user_id, access_version")) return rows([{ owner_user_id: state.allowed ? userId : "revoked-owner", access_version: state.space.access_version }]);
      if (sql.includes("FROM family_members")) return rows();
      if (sql.startsWith("SELECT 1 FROM children")) return rows(values[0] === childId && values[1] === workspaceId ? [{}] : []);
      if (sql.startsWith("SELECT access_version::text") || sql.startsWith("SELECT storage_epoch") || sql.startsWith("SELECT w.storage_epoch")) return rows([state.space]);
      if (sql.startsWith("SELECT * FROM agent_runs")) return rows(values[0] === runId && values[1] === userId && values[2] === childId ? [state.run] : []);
      if (sql.startsWith("SELECT text_encrypted FROM chat_messages")) return rows(state.sourceExists ? [{ text_encrypted:
        cipher.encrypt(quote, `chat_messages:${messageId}:${childId}:${userId}:user::text`) }] : []);
      if (sql.startsWith("SELECT 1 FROM chat_messages")) return rows(state.sourceExists && values[0] === messageId && values[1] === childId && values[2] === userId ? [{}] : []);
      if (sql.startsWith("SELECT * FROM family_document_operations")) return rows([state.operations.get(values[0] + ":" + values[1])].filter(Boolean));
      if (sql.startsWith("SELECT child_id FROM family_document_operations")) {
        const item = state.operations.get(values[0] + ":" + values[1]);
        return rows(item ? [{ child_id: receiptChildMismatch ? "other-child" : item.child_id }] : []);
      }
      if (sql.startsWith("SELECT *") && sql.includes("FROM family_documents WHERE id=")) return rows([...state.documents.values()].filter((row: any) => row.id === values[0] && row.child_id === values[1]));
      if (sql.startsWith("SELECT id,version,payload_encrypted FROM family_document_snapshots")) {
        const items = [...state.snapshots.values()].filter((row: any) => row.document_id === values[0]);
        return rows(sql.includes("id IS DISTINCT") ? items.filter((row: any) => row.id !== values[1]).slice(0, values[2])
          : items.filter((row: any) => row.id === values[1] && (values[2] == null || row.version === values[2])));
      }
      if (sql.startsWith("UPDATE family_documents SET version=")) {
        const row = state.documents.get(values[0]); row.version = values[1]; row.status = values[2]; row.auto_refresh = values[3]; row.payload_encrypted = values[4];
        row.progress_encrypted = values[5]; row.dirty = values[8]; state.documentChanges++; return rows();
      }
      if (sql.startsWith("INSERT INTO family_document_snapshots")) { state.snapshots.set(values[0], { id: values[0], document_id: values[1], version: values[2], payload_encrypted: values[3] }); return rows(); }
      if (sql.startsWith("INSERT INTO family_document_operations")) {
        assert.equal(state.operations.has(values[0] + ":" + values[1]), false);
        state.operations.set(values[0] + ":" + values[1], { child_id: values[2], storage_epoch: values[3], request_encrypted: values[4], result_encrypted: values[5] }); return rows();
      }
      if (sql.startsWith("UPDATE workspaces SET change_seq")) { state.space.change_seq = String(Number(state.space.change_seq) + 1); return rows([{ change_seq: state.space.change_seq }]); }
      if (sql.startsWith("INSERT INTO online_changes") || sql.startsWith("SELECT 1 FROM app_migrations")) return rows();
      if (sql.startsWith("INSERT INTO agent_document_operations")) {
        if (failure === "link") throw new Error("synthetic-link-failure");
        assert.equal(values[0], runId); assert.equal(values[1], childId); assert.equal(values[2], userId);
        const receipt = state.operations.get(values[2] + ":" + values[3]); assert.equal(receipt?.child_id, values[1]);
        if (!state.links.has(values[2] + ":" + values[3])) state.links.set(values[2] + ":" + values[3],
          { run_id: values[0], child_id: values[1], owner_user_id: values[2], op_id: values[3], tool_name: values[4] });
        return rows();
      }
      if (sql.startsWith("SELECT a.")) {
        if (readFailure) throw new Error("synthetic-receipt-query-failure");
        const links = [...state.links.values()].map((link: any) => ({ ...link,
          receipt_child_id: state.operations.get(link.owner_user_id + ":" + link.op_id)?.child_id }));
        if (sql.includes("WHERE a.owner_user_id=")) return rows(links.filter((link: any) => link.owner_user_id === values[0] && link.op_id === values[1]));
        assert.equal(values[3], 9, "The read bound must be eight root tools plus one overflow sentinel");
        return rows(links.filter((link: any) => link.run_id === values[0] && link.owner_user_id === values[1] && link.child_id === values[2]).slice(0, values[3]));
      }
      if (sql.startsWith("UPDATE agent_runs SET data_version")) { if (failure === "run-update") throw new Error("synthetic-run-update-failure"); state.run.data_version = values[1]; return rows(); }
      if (sql.startsWith("UPDATE agent_runs SET state='unknown'")) {
        if (state.run.state === "running" && state.run.expires_at.getTime() <= Date.now()) { state.run.state = "unknown"; state.run.stop_reason = "interrupted"; return rows([{ id: runId }]); }
        return rows();
      }
      if (sql.startsWith("UPDATE agent_runs SET state=$2")) { Object.assign(state.run, { state: values[1], stop_reason: values[2], result_encrypted: values[3] }); return rows(); }
      if (sql.startsWith("UPDATE agent_proposals") || sql.startsWith("SELECT * FROM agent_proposals")) return rows();
      throw new Error("Unhandled synthetic query: " + sql);
    }
    const pool = { query, connect: async () => ({ query, release() { assert.equal(transaction, null); assert.equal(savepoints.size, 0); } }) } as unknown as Pool;
    const store = createProductAgentStore(pool, cipher);
    const mutation = { id: documentId, change: { action: "check_item" as const, expectedVersion: 3, authorityVersion: epoch + ":1", sectionId: "checklist", itemId: "template-0", checked: true } };
    const write = () => store.writeDocument(scope, runId, opId, quote, mutation);
    return { store, pool, write, queries, snapshot, get state() { return state; }, setFailure(value: string | null) { failure = value; },
      setReadFailure() { readFailure = true; }, mismatchReceiptChild() { receiptChildMismatch = true; } };
  }
  const assertSaved = (value: any) => {
    assert.ok(value); assert.equal(value.tools.length, 1); assert.deepEqual(value.tools[0], { name: "change_family_document", status: "succeeded", reference: documentId });
    assert.match(value.text, /文件操作已保存/u); assert.doesNotMatch(value.text, /最新|第4版|Synthetic document/u);
    assert.deepEqual(value.citations, []); assert.ok(!JSON.stringify(value).includes("【通用模板】"));
  };
  {
    const h = await harness(), first = await h.write(); assert.equal(first?.version, 4);
    assert.equal(h.state.operations.size, 1); assert.equal(h.state.links.size, 1); assert.equal(h.state.run.data_version, epoch + ":2");
    assert.equal(h.state.documentChanges, 1); assert.equal(h.state.space.change_seq, "2");
    assert.deepEqual(await h.store.documentReceipts(scope, runId), { receipts: [{ operationId: opId, documentId, savedVersion: 4, toolName: "change_family_document" }], unavailable: false, linked: true });
    assert.equal((await h.write())?.version, 4); assert.equal(h.state.documentChanges, 1); assert.equal(h.state.space.change_seq, "2"); assert.equal(h.state.links.size, 1);
    // A new store instance reads the durable maps after expiry, with no finish or process-local handles.
    h.state.run.expires_at = new Date(Date.now() - 1);
    const recovered = await createProductAgentStore(h.pool, cipher).get(userId, childId, runId);
    assertSaved(recovered); assert.equal(recovered!.status, "unknown"); assert.equal(recovered!.stopReason, "interrupted");
    assert.equal((await h.store.documentReceipts(scope, runId))?.receipts.length, 1); assert.equal(h.state.documentChanges, 1);
    console.log("PASS atomic commit, original-op replay, expiry and finish-before-crash recovery");
  }
  for (const stage of ["link", "run-update", "receipt-child"]) {
    const h = await harness(); if (stage === "receipt-child") h.mismatchReceiptChild(); else h.setFailure(stage);
    await assert.rejects(h.write);
    assert.equal(h.state.documents.get(documentId).version, 3); assert.equal(h.state.documentChanges, 0);
    assert.equal(h.state.operations.size, 0); assert.equal(h.state.links.size, 0); assert.equal(h.state.space.change_seq, "1");
    assert.equal(h.state.run.data_version, epoch + ":1"); assert.ok(h.queries.includes("ROLLBACK"));
    assert.deepEqual(await h.store.documentReceipts(scope, runId), { receipts: [], unavailable: false, linked: false });
  }
  console.log("PASS relation/update/scope failure rolls back document, receipt, linkage and run advance");
  {
    const h = await harness(); h.state.run.expires_at = new Date(Date.now() - 1);
    await assert.rejects(h.write); assert.equal(h.state.operations.size, 0); assert.equal(h.state.links.size, 0);
    assert.equal(h.state.documentChanges, 0); assert.deepEqual(await h.store.documentReceipts(scope, runId), { receipts: [], unavailable: false, linked: false });
    assert.ok(h.queries.filter(sql => sql.startsWith("SELECT owner_user_id, access_version")).every(sql => sql.endsWith("FOR UPDATE")));
  }
  console.log("PASS expiry prevents new writes while receipt reads use the existing document authority lock");
  for (const boundary of ["user", "child", "auth", "epoch", "revoked", "source-message", "deleted-document", "invalid-source"]) {
    const h = await harness(); await h.write();
    let queryScope = scope;
    if (boundary === "user") queryScope = { ...scope, userId: "other-user" };
    if (boundary === "child") queryScope = { ...scope, childId: "00000000-0000-4000-8000-000000000002" };
    if (boundary === "auth") h.state.space.access_version = "2";
    if (boundary === "epoch") h.state.space.storage_epoch = "cccccccc-cccc-4ccc-accc-cccccccccccc";
    if (boundary === "revoked") h.state.allowed = false;
    if (boundary === "source-message") h.state.sourceExists = false;
    if (boundary === "deleted-document") h.state.documents.clear();
    if (boundary === "invalid-source") profileVersion++;
    const receipts = await h.store.documentReceipts(queryScope, runId);
    assert.ok(receipts === null || receipts.receipts.length === 0, boundary);
    const value = await h.store.get(queryScope.userId, queryScope.childId, runId);
    assert.ok(value === null || !value.tools.some(tool => tool.reference === documentId), boundary);
    assert.ok(!JSON.stringify(value).includes("【通用模板】"), boundary); assert.equal(h.state.documentChanges, 1);
  }
  console.log("PASS cross-user/child, auth change, epoch, revocation, deleted message/document and invalid source");
  for (const legacy of [true, false]) {
    const h = await harness(); await h.write();
    const saved = { runId, provenance: null, status: "completed", stopReason: null,
      text: "PRIVATE HISTORICAL DOCUMENT BODY", citations: [], privateSourceCitations: [], retrievalMode: "not_used", proposals: [],
      tools: [{ name: "change_family_document", status: "succeeded", reference: documentId }],
      countsKnown: true, counts: { modelCalls: 2, toolCalls: 2, queryEmbeddings: 0 } };
    h.state.run.state = "completed";
    h.state.run.result_encrypted = cipher.encrypt(JSON.stringify(saved), `agent-run:${childId}:${userId}:${runId}`);
    if (legacy) { h.state.links.clear(); h.state.space.access_version = "2"; }
    else profileVersion++;
    const value = await h.store.get(userId, childId, runId);
    if (legacy) assert.deepEqual(value, saved, "Legacy history without new linkage keeps its original access/projection semantics");
    else {
      assert.equal(value?.status, "stopped"); assert.equal(value?.stopReason, "document_source_changed");
      assert.deepEqual(value?.tools, []); assert.ok(!JSON.stringify(value).includes(saved.text));
    }
  }
  console.log("PASS legacy no-linkage compatibility and new-linkage invalid-source body/reference cleanup");
  {
    const h = await harness(); await h.write(); h.state.run.expires_at = new Date(Date.now() - 1); profileVersion++;
    const value = await h.store.get(userId, childId, runId);
    assert.equal(value?.status, "unknown"); assert.equal(value?.stopReason, "interrupted");
    assert.deepEqual(value?.tools, []); assert.equal(h.state.documentChanges, 1);
  }
  console.log("PASS unknown/crash status and stop reason survive invalid-source projection");
  for (const boundary of ["query-error", "overflow"]) {
    const h = await harness(); await h.write();
    if (boundary === "query-error") h.setReadFailure();
    else for (let i = 1; i < 9; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      h.state.operations.set(userId + ":" + id, { ...h.state.operations.get(userId + ":" + opId) });
      h.state.links.set(userId + ":" + id, { ...h.state.links.get(userId + ":" + opId), op_id: id });
    }
    await assert.rejects(() => h.store.documentReceipts(scope, runId));
    const value = await h.store.get(userId, childId, runId);
    assert.equal(value?.status, "unknown"); assert.equal(value?.stopReason, "document_receipt_unavailable");
    assert.deepEqual(value?.tools, []); assert.equal(h.state.documentChanges, 1);
  }
  console.log("PASS query errors and >8 records fail closed as unknown without partial success or writes");
});

test("document association migration is additive, scoped and registered once", async () => {
  const sql = await readFile(new URL("../server/migrations/036-agent-document-operations.sql", import.meta.url), "utf8");
  const runner = await readFile(new URL("../server/migrate.ts", import.meta.url), "utf8");
  assert.match(sql, /UNIQUE\(user_id,op_id,child_id\)/u);
  assert.match(sql, /REFERENCES agent_runs\(id,child_id,owner_user_id\) ON DELETE CASCADE/u);
  assert.match(sql, /REFERENCES family_document_operations\(user_id,op_id,child_id\) ON DELETE CASCADE/u);
  assert.match(sql, /PRIMARY KEY\(owner_user_id,op_id\)/u); assert.match(sql, /UNIQUE\(run_id,op_id\)/u);
  for (const statement of sql.replace(/--[^\n]*/gu, "").split(";"))
    assert.doesNotMatch(statement.trim(), /^(?:DELETE|UPDATE|TRUNCATE|DROP\s+TABLE)\b/iu);
  assert.doesNotMatch(sql, /(?:text_encrypted|result_encrypted|payload_encrypted)/u);
  assert.equal(runner.split('"036-agent-document-operations"').length - 1, 1);
  assert.match(runner, /"035-account-data-exit", "036-agent-document-operations"/u);
  assert.match(runner, /applied.rows\[0\].checksum !== checksum && applied.rows\[0\].checksum !== windowsChecksum/u);
  assert.equal(createHash("sha256").update(sql.replace(/\r\n/gu, "\n")).digest("hex").length, 64);
});
