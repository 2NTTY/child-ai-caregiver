import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { FinishReason } from "@google/genai";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import type { AgentScope } from "../server/agent-runtime.ts";
import { createProductAgent } from "../server/product-agent.ts";
import { createProductAgentStore } from "../server/product-agent-store.ts";
import { createAgentConfirmationStore } from "../server/agent-confirmation-store.ts";
import { createPostgresAgentOriginalReceiptReader } from "../server/agent-original-receipts-postgres.ts";
import type { AgentOriginalReceiptReader } from "../server/agent-original-receipts.ts";
import { READ_ROLES, withChildAccess } from "../server/family-access.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import { readAiConfig } from "../server/ai-config.ts";
import { AGENT_LIMITS } from "../server/agent-budget.ts";
import type { ProductAgentResult } from "../src/shared/product-agent.ts";

const userId = "synthetic-parent", childId = "1ebcb39d-a2db-4b8c-a432-7ffcb3de5808";
const workspaceId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", epoch = "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb";
const messageId = "7de5a0e8-e106-4485-b7d2-3b572741da39", runId = "d4a1b662-d13d-476b-bf52-40a28aa1a1a7";
const actionId = "11111111-1111-4111-8111-111111111111", contactId = "22222222-2222-4222-8222-222222222222";
const proposalId = "33333333-3333-4333-8333-333333333333", proposalRunId = "44444444-4444-4444-8444-444444444444";
const confirmationId = "55555555-5555-4555-8555-555555555555";
const scope: AgentScope = { userId, childId, workspaceId, authorizationVersion: "1", dataVersion: epoch + ":1" };
const RECEIPT_QUERY_LIMIT = AGENT_LIMITS.toolCalls + 1;
const cipher = createStorageCipher(Buffer.alloc(32, 42));
const emptyResult: ProductAgentResult = { runId, status: "completed", stopReason: null, provenance: null,
  text: "PRIVATE TRANSIENT ANSWER", citations: [], privateSourceCitations: [], retrievalMode: "not_used", tools: [], proposals: [],
  countsKnown: true, counts: { modelCalls: 1, toolCalls: 1, queryEmbeddings: 0 } };

// Real run/receipt stores and local ADK runtime with scripted models. This Pool models
// serialized transaction/savepoint mechanics, not PostgreSQL locks or concurrent SQL.
function harness(seed = true) {
  const run = { id: runId, child_id: childId, owner_user_id: userId, trigger_kind: "interactive", trigger_reference: messageId,
    source_message_id: messageId, authorization_version: "1", data_version: epoch + ":1", recipe_id: "product-interactive",
    state: "running", stop_reason: null as string | null, result_encrypted: null as string | null,
    created_at: new Date(), expires_at: new Date(Date.now() + 90_000) };
  let state = { space: { id: workspaceId, owner_user_id: userId, access_version: "1", storage_epoch: epoch, change_seq: "1" },
    allowed: [userId], sourceExists: true, sourceOwner: userId, sourceAuthor: userId, sourceRole: "user",
    runs: seed ? [run] : [] as typeof run[], actions: [] as { id: string; run_id: string; child_id: string; owner_user_id: string; payload_encrypted: string }[],
    contacts: [] as { id: string }[], confirmations: [] as Record<string, unknown>[],
    documentLinks: [] as { op_id: string; tool_name: string; child_id: string; receipt_child_id: string }[],
    proposals: [] as { id: string; run_id: string; call_id: string; version: number; state: string; payload_encrypted: string; created_at: Date; expires_at: Date }[] };
  const queries: { sql: string; values: unknown[]; connectionId?: number }[] = [];
  let connections = 0, releases = 0, actionReferenceIds: string[] | null = null;
  let authorityAfterDocumentRead: { access_version?: string; storage_epoch?: string; change_seq?: string } | null = null;
  let fail: string | null = null, tail = Promise.resolve();
  const rows = (items: unknown[] = []) => ({ rows: structuredClone(items), rowCount: items.length });
  function query(sql: string, values: any[], current: typeof state, connectionId?: number): any {
    queries.push({ sql, values: structuredClone(values), connectionId });
    if (fail && sql.includes(fail)) throw new Error("synthetic-query-failure");
    if (sql.startsWith("SET LOCAL")) return rows();
    if (sql.startsWith("UPDATE agent_proposals SET state='expired'")) {
      assert.equal(values.length, 1);
      for (const row of current.proposals) if (row.run_id === values[0] && row.state === "pending" && row.expires_at.getTime() <= Date.now()) row.state = "expired";
      return rows();
    }
    if (sql.startsWith("SELECT workspace_id FROM children")) return rows(values[0] === childId ? [{ workspace_id: workspaceId }] : []);
    if (sql.startsWith("SELECT owner_user_id, access_version")) return rows([current.space]);
    if (sql.startsWith("SELECT role FROM family_members")) return rows(current.allowed.includes(values[1]) ? [{ role: "caregiver" }] : []);
    if (sql.startsWith("SELECT 1 FROM children")) return rows(values[0] === childId && values[1] === workspaceId ? [{}] : []);
    if (sql.startsWith("SELECT access_version::text") || sql.startsWith("SELECT id,access_version")) return rows([current.space]);
    if (sql.startsWith("SELECT 1 FROM chat_messages")) return rows(current.sourceExists && values[0] === messageId && values[1] === childId
      && values[2] === current.sourceOwner && (!sql.includes("author_user_id") || values[2] === current.sourceAuthor)
      && current.sourceRole === "user" ? [{}] : []);
    if (sql.startsWith("INSERT INTO agent_runs")) {
      const prior = current.runs.find(row => row.owner_user_id === values[2] && row.child_id === values[1]
        && row.trigger_kind === values[3] && row.trigger_reference === values[4]);
      if (prior) return rows();
      const created = { ...run, id: values[0], child_id: values[1], owner_user_id: values[2], trigger_kind: values[3],
        trigger_reference: values[4], source_message_id: values[5], authorization_version: values[6], data_version: values[7], recipe_id: values[8] };
      current.runs.push(created); return rows([created]);
    }
    if (sql.startsWith("SELECT * FROM agent_runs")) {
      let selected;
      if (sql.includes("WHERE owner_user_id=")) {
        const claimRead = sql.includes("trigger_reference=$4");
        assert.equal(values.length, claimRead ? 4 : 3);
        selected = current.runs.filter(row => row.owner_user_id === values[0] && row.child_id === values[1]
          && row.trigger_kind === (claimRead ? values[2] : "interactive") && row.trigger_reference === (claimRead ? values[3] : values[2])
          && (sql.includes("source_message_id=$3") ? row.source_message_id === values[2] : true));
      }
      else if (sql.includes("AND state='running'")) selected = current.runs.filter(row => row.id === values[0] && row.child_id === values[1]
        && row.owner_user_id === values[2] && row.state === "running" && row.expires_at.getTime() > Date.now());
      else selected = current.runs.filter(row => row.id === values[0] && row.owner_user_id === values[1] && row.child_id === values[2]);
      return rows(selected);
    }
    if (sql.startsWith("UPDATE agent_runs SET state='unknown'")) {
      const selected = current.runs.find(row => row.id === values[0] && row.state === "running" && row.expires_at.getTime() <= Date.now());
      if (!selected) return rows(); selected.state = "unknown"; selected.stop_reason = "interrupted"; return rows([{ id: selected.id }]);
    }
    if (sql.startsWith("UPDATE agent_runs SET state='stopped'")) {
      const selected = current.runs.find(row => row.id === values[0] && row.state === "running");
      if (!selected) return rows(); selected.state = "stopped"; selected.stop_reason = "cancelled"; return rows([{ id: selected.id }]);
    }
    if (sql.startsWith("UPDATE agent_runs SET state=$2")) {
      const selected = current.runs.find(row => row.id === values[0])!;
      selected.state = values[1]; selected.stop_reason = values[2]; selected.result_encrypted = values[3]; return rows();
    }
    if (sql.startsWith("SELECT 1 FROM agent_runs")) return rows(current.runs.filter(row => row.id === values[0] && row.child_id === values[1] && row.owner_user_id === values[2]).map(() => ({})));
    if (sql.startsWith("SELECT id FROM agent_action_receipts") || sql.startsWith("SELECT * FROM agent_action_receipts")) {
      assert.equal(values[0], current.runs[0]?.id); assert.equal(values[1], userId); assert.equal(values[2], childId);
      if (sql.startsWith("SELECT id ") && actionReferenceIds) return rows(actionReferenceIds.map(id => ({ id })).slice(0, values[3]));
      return rows(current.actions.slice(0, sql.includes("LIMIT $4") ? values[3] : 8));
    }
    if (sql === "SELECT version FROM agent_operation_policies WHERE user_id=$1 AND child_id=$2") {
      assert.deepEqual(values, [userId, childId]);
      return rows(); // No operation policy is configured in this synthetic workspace.
    }
    if (sql === "SELECT * FROM agent_confirmations WHERE owner_user_id=$1 AND child_id=$2 AND asking_run_id=$3 AND state IN ('waiting','asked') AND expires_at>clock_timestamp() ORDER BY created_at,id LIMIT 9") {
      assert.deepEqual(values, [userId, childId, current.runs[0]?.id]);
      return rows(current.confirmations.filter(row => row.owner_user_id === values[0] && row.child_id === values[1]
        && row.asking_run_id === values[2] && (row.state === "waiting" || row.state === "asked")
        && row.expires_at instanceof Date && row.expires_at.getTime() > Date.now()).slice(0, 9));
    }
    if (sql.includes("SELECT c.*") && sql.includes("FROM agent_confirmations c")) {
      assert.deepEqual(values, [userId, childId, messageId]); assert.match(sql, /LIMIT 2/u);
      return rows(current.confirmations.slice(0, 2).map(row => ({ ...row, verified_response_id:
        current.sourceExists && current.sourceOwner === userId && current.sourceAuthor === userId && current.sourceRole === "user" ? messageId : null })));
    }
    if (sql.startsWith("SELECT r.id FROM contact_requests")) {
      assert.deepEqual(values.slice(0, 3), [userId, current.runs[0]?.id, childId]); assert.equal(values[3], RECEIPT_QUERY_LIMIT);
      return rows(current.contacts.slice(0, values[3]));
    }
    if (sql.startsWith("SELECT a.op_id")) {
      assert.deepEqual(values, [current.runs[0]?.id, userId, childId, RECEIPT_QUERY_LIMIT]);
      assert.match(sql, /ON o.user_id=a.owner_user_id AND o.op_id=a.op_id/u);
      assert.doesNotMatch(sql, /ON[^\n]+o.child_id=/u);
      assert.ok(typeof values[3] === "number");
      return rows(current.documentLinks.slice(0, values[3]));
    }
    if (sql.startsWith("SELECT * FROM family_document_operations")) {
      assert.deepEqual(values, [userId, actionId]);
      assert.match(sql, /WHERE user_id=\$1 AND op_id=\$2/u);
      if (authorityAfterDocumentRead) Object.assign(current.space, authorityAfterDocumentRead);
      return rows();
    }
    if (sql.startsWith("SELECT * FROM agent_proposals WHERE run_id=$1 ORDER BY created_at,id LIMIT $2")) {
      assert.equal(values.length, 2); assert.equal(values[1], RECEIPT_QUERY_LIMIT);
      return rows(current.proposals.filter(row => row.run_id === values[0]).slice(0, values[1]));
    }
    throw new Error("Unhandled synthetic query: " + sql);
  }
  const pool = { query: async (sql: string, values: any[] = []) => query(sql, values, state), connect: async () => {
    const connectionId = ++connections;
    let transaction: typeof state | null = null, unlock: (() => void) | null = null;
    const savepoints = new Map<string, typeof state>();
    return { query: async (sql: string, values: any[] = []) => {
      if (sql === "BEGIN") {
        const previous = tail; tail = new Promise<void>(resolve => { unlock = resolve; }); await previous;
        transaction = structuredClone(state); queries.push({ sql, values, connectionId }); return rows();
      }
      if (sql === "COMMIT" || sql === "ROLLBACK") {
        assert.ok(transaction); if (sql === "COMMIT") state = transaction;
        transaction = null; queries.push({ sql, values, connectionId }); unlock!(); return rows();
      }
      assert.ok(transaction);
      if (sql.startsWith("SAVEPOINT ")) { queries.push({ sql, values, connectionId }); savepoints.set(sql.slice(10), structuredClone(transaction)); return rows(); }
      if (sql.startsWith("ROLLBACK TO SAVEPOINT ")) { queries.push({ sql, values, connectionId }); transaction = structuredClone(savepoints.get(sql.slice(22))!); return rows(); }
      if (sql.startsWith("RELEASE SAVEPOINT ")) { queries.push({ sql, values, connectionId }); savepoints.delete(sql.slice(18)); return rows(); }
      return query(sql, values, transaction, connectionId);
    }, release() { releases++; assert.equal(transaction, null); assert.equal(savepoints.size, 0); } };
  } } as unknown as Pool;
  const stores = () => createProductAgentStore(pool, cipher);
  function addEffects() {
    state.actions.push({ id: actionId, run_id: state.runs[0].id, child_id: childId, owner_user_id: userId,
      payload_encrypted: cipher.encrypt(JSON.stringify({ receipt: { id: actionId, kind: "save_private_note", text: "PRIVATE ACTION BODY" } }),
      `agent-action:${childId}:${userId}:${state.runs[0].id}:${actionId}`) });
    state.contacts.push({ id: contactId });
    state.confirmations.push({ id: confirmationId, owner_user_id: userId, child_id: childId,
      proposal_run_id: proposalRunId, proposal_id: proposalId, proposal_version: 1, state: "accepted",
      authorization_version: "1", storage_epoch: epoch, response_message_id: messageId,
      expires_at: new Date(Date.now() - 1), proposal_owner: userId, proposal_child: childId,
      proposal_authorization: "1", proposal_epoch: epoch, proposal_state: "accepted", saved_proposal_version: 2,
      payload_encrypted: cipher.encrypt(JSON.stringify({ question: "PRIVATE QUESTION", result: {
        id: proposalId, runId: proposalRunId, childId, status: "accepted", version: 2,
        value: { content: "PRIVATE CONFIRMATION BODY" }, result: { kind: "task", id: actionId, version: 1 } } }),
      `agent-confirmation:${childId}:${userId}:${confirmationId}`) });
  }
  async function readOriginal<T>(operation: (reader: AgentOriginalReceiptReader) => Promise<T>) {
    return withChildAccess(pool, userId, childId, READ_ROLES, async (client, _role, workspace) => {
      const original = (await client.query<typeof run>("SELECT * FROM agent_runs WHERE id=$1 AND owner_user_id=$2 AND child_id=$3 FOR UPDATE",
        [runId, userId, childId])).rows[0];
      assert.ok(original);
      return operation(createPostgresAgentOriginalReceiptReader(client, cipher, workspace, {
        runId: original.id, ownerUserId: original.owner_user_id, childId: original.child_id, triggerKind: original.trigger_kind as "interactive" | "worker",
        sourceMessageId: original.source_message_id, authorizationVersion: original.authorization_version,
        storageEpoch: original.data_version.split(":")[0],
      }));
    }, true);
  }
  return { pool, stores, queries, addEffects, readOriginal, get state() { return state; }, fail(value: string | null) { fail = value; },
    connectionCounts: () => ({ connections, releases }), actionRefs(ids: string[]) { actionReferenceIds = ids; },
    afterDocumentRead(value: NonNullable<typeof authorityAfterDocumentRead>) { authorityAfterDocumentRead = value; } };
}

test("original receipt reader uses only the authorized leased client and projects original references", async () => {
  const h = harness(); h.addEffects();
  h.state.runs[0].authorization_version = h.state.space.access_version = "9007199254740993";
  h.state.confirmations[0].authorization_version = h.state.confirmations[0].proposal_authorization = "9007199254740993";
  h.state.space.change_seq = "99";
  const original = structuredClone(h.state);
  await h.readOriginal(async reader => {
    const start = h.queries.length;
    assert.deepEqual(await reader.actionReferences(), [{ id: actionId, kind: "save_private_note" }]);
    assert.deepEqual(await reader.acceptedConfirmation(), { proposalId });
    assert.deepEqual(await reader.contactRequestReferences(), [{ id: contactId }]);
    assert.deepEqual(await reader.documentOperationReceipts(), { receipts: [], unavailable: false, linked: false });
    const reads = h.queries.slice(start);
    assert.ok(reads.length > 0 && reads.every(row => row.connectionId === 1), "Nested stores query the actual outer lease");
    assert.ok(reads.every(({ sql }) => !/^(?:INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK$)/u.test(sql)), "Only the reader boundary is read-only");
    assert.equal(reads.filter(({ sql }) => sql.startsWith("SAVEPOINT ")).length, 2);
    assert.equal(reads.filter(({ sql }) => sql.startsWith("RELEASE SAVEPOINT ")).length, 2);
    assert.deepEqual(h.connectionCounts(), { connections: 1, releases: 0 }, "No new connection or outer release");
    assert.ok(!JSON.stringify([await reader.actionReferences(), await reader.acceptedConfirmation()]).includes("PRIVATE"));
    assert.notEqual(h.state.confirmations[0].proposal_run_id, runId, "Accepted original proposal and response run remain distinct");
  });
  assert.deepEqual(h.connectionCounts(), { connections: 1, releases: 1 });
  assert.deepEqual(h.state, original);
  assert.equal(h.queries.filter(({ sql }) => sql === "BEGIN").length, 1);
  assert.equal(h.queries.filter(({ sql }) => sql === "COMMIT").length, 1);
  const lock = h.queries.findIndex(({ sql }) => sql.startsWith("SELECT owner_user_id, access_version"));
  assert.ok(lock >= 0 && lock < h.queries.findIndex(({ sql }) => sql.startsWith("SELECT id FROM agent_action_receipts")));
});

test("original receipt reader distinguishes empty results from errors, changed references and overflow", async t => {
  const empty = harness();
  await empty.readOriginal(async reader => {
    assert.deepEqual(await reader.actionReferences(), []);
    assert.equal(await reader.acceptedConfirmation(), null);
    assert.deepEqual(await reader.contactRequestReferences(), []);
    assert.deepEqual(await reader.documentOperationReceipts(), { receipts: [], unavailable: false, linked: false });
  });
  for (const boundary of ["action-error", "action-body-error", "contact-error", "confirmation-error", "document-error", "action-overflow",
    "contact-overflow", "confirmation-overflow", "document-overflow", "action-reference-changed", "confirmation-scope", "confirmation-payload"]) {
    await t.test(boundary, async () => {
      const h = harness(); h.addEffects();
      if (boundary === "action-error") h.fail("SELECT id FROM agent_action_receipts");
      if (boundary === "action-body-error") h.fail("SELECT * FROM agent_action_receipts");
      if (boundary === "contact-error") h.fail("SELECT r.id FROM contact_requests");
      if (boundary === "confirmation-error") h.fail("FROM agent_confirmations c");
      if (boundary === "document-error") h.fail("SELECT a.op_id");
      if (boundary === "action-overflow") while (h.state.actions.length < RECEIPT_QUERY_LIMIT) h.state.actions.push(h.state.actions[0]);
      if (boundary === "contact-overflow") while (h.state.contacts.length < RECEIPT_QUERY_LIMIT) h.state.contacts.push(h.state.contacts[0]);
      if (boundary === "confirmation-overflow") h.state.confirmations.push(h.state.confirmations[0]);
      if (boundary === "document-overflow") while (h.state.documentLinks.length < RECEIPT_QUERY_LIMIT) h.state.documentLinks.push({
        op_id: actionId, tool_name: "change_family_document", child_id: childId, receipt_child_id: childId });
      if (boundary === "action-reference-changed") h.actionRefs([contactId]);
      if (boundary === "confirmation-scope") h.state.confirmations[0].proposal_child = actionId;
      if (boundary === "confirmation-payload") h.state.confirmations[0].payload_encrypted = "yb1.invalid";
      await assert.rejects(() => h.readOriginal(async reader => {
        if (boundary.startsWith("action")) return reader.actionReferences();
        if (boundary.startsWith("contact")) return reader.contactRequestReferences();
        if (boundary.startsWith("confirmation")) return reader.acceptedConfirmation();
        return reader.documentOperationReceipts();
      }));
      assert.ok(h.queries.every(({ sql }) => !/^(?:INSERT|UPDATE|DELETE)/u.test(sql)));
      assert.equal(h.queries.filter(({ sql }) => sql === "COMMIT").length, 0);
      assert.deepEqual(h.connectionCounts(), { connections: 1, releases: 1 });
    });
  }
});

test("original receipt reader preserves document linkage, owner-wide operations and authority changes", async t => {
  for (const boundary of ["missing-operation", "wrong-child", "wrong-receipt-child", "wrong-tool", "auth", "epoch", "missing-source",
    "source-owner", "source-author", "source-role", "worker", "missing-source-id", "after-auth", "after-epoch", "same-epoch-data", "exact-auth"]) {
    await t.test(boundary, async () => {
      const h = harness();
      const link = { op_id: actionId, tool_name: "change_family_document", child_id: childId, receipt_child_id: childId };
      h.state.documentLinks.push(link);
      if (boundary === "wrong-child") link.child_id = contactId;
      if (boundary === "wrong-receipt-child") link.receipt_child_id = contactId;
      if (boundary === "wrong-tool") link.tool_name = "contact_caregiver";
      if (boundary === "auth") h.state.space.access_version = "2";
      if (boundary === "epoch") h.state.space.storage_epoch = contactId;
      if (boundary === "missing-source") h.state.sourceExists = false;
      if (boundary === "source-owner") h.state.sourceOwner = "other-parent";
      if (boundary === "source-author") h.state.sourceAuthor = "other-parent";
      if (boundary === "source-role") h.state.sourceRole = "model";
      if (boundary === "worker") h.state.runs[0].trigger_kind = "worker";
      if (boundary === "missing-source-id") h.state.runs[0].source_message_id = null as unknown as string;
      if (boundary === "after-auth") h.afterDocumentRead({ access_version: "2" });
      if (boundary === "after-epoch") h.afterDocumentRead({ storage_epoch: contactId });
      if (boundary === "same-epoch-data") h.afterDocumentRead({ change_seq: "99" });
      if (boundary === "exact-auth") h.state.runs[0].authorization_version = h.state.space.access_version = "9007199254740993";
      if (boundary.startsWith("wrong-")) await assert.rejects(() => h.readOriginal(reader => reader.documentOperationReceipts()), { code: "document_receipt_scope_changed" });
      else {
        const result = await h.readOriginal(reader => reader.documentOperationReceipts());
        if (["missing-operation", "same-epoch-data", "exact-auth"].includes(boundary))
          assert.deepEqual(result, { receipts: [], unavailable: true, linked: true });
        else assert.equal(result, null);
      }
      assert.ok(h.queries.every(({ sql }) => !/^(?:INSERT|UPDATE|DELETE)/u.test(sql)));
      assert.deepEqual(h.connectionCounts(), { connections: 1, releases: 1 });
    });
  }
});

function agentOptions(h: ReturnType<typeof harness>, onModel: () => Promise<void> = async () => {}) {
  let calls = 0, toolReads = 0; const signals: AbortSignal[] = [];
  const runtime = createAgentRuntime({ config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    usage: { reserve: async () => true, record: async () => {} }, provider: { generate: async (_request, signal) => {
      signals.push(signal); calls++;
      if (calls === 1) await onModel();
      // This cancellation fixture only reads context; it must not claim a saved proposal.
      return { content: { role: "model", parts: [{ functionCall: calls === 1
        ? { id: "read-context", name: "read_context", args: {} }
        : { id: "answer", name: "present_answer", args: { kind: "clarification", paragraphs: [{ text: "請問寶寶幾個月大？", citationIds: [] }] } } }] }, finishReason: FinishReason.STOP };
    } } });
  const options = { runtime, store: { ...h.stores(), consumeConfirmation: async () => null },
    memory: { context: async () => ({ profile: { childId, version: 0, data: null }, profileApplicable: false,
      facts: [], topics: [], summary: null, recentMessages: [], conflictingKeys: [], unavailableFactKeys: [],
      truncated: { facts: false, topics: false, messages: false } }) },
    chat: { listForUser: async () => ({ messages: [{ id: messageId, role: "user", text: "請核對目前事項。" }] }) },
    tasks: { list: async () => { toolReads++; return { items: [], eligibleAssignees: [], nextAfterId: null }; } },
    knowledge: { createRun: () => ({ search: async () => { throw new Error("No knowledge call expected"); }, revalidateCitations: async () => true }) },
  } as unknown as Parameters<typeof createProductAgent>[0];
  return { options, signals, observe: () => ({ calls, toolReads }) };
}

test("another service instance durably cancels without a local controller and retry keeps the original run", { timeout: 5000 }, async t => {
  const h = harness(false); let started!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; }), waiting = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  const a = agentOptions(h, async () => { started(); await waiting; }), b = agentOptions(h);
  const original = createProductAgent(a.options), other = createProductAgent(b.options);
  const pending = original.reply(userId, childId, messageId, async () => true); await ready;
  assert.equal(await other.cancelReply(userId, childId, messageId, async () => true), true);
  const originalRunId = h.state.runs[0].id;
  assert.equal(h.state.runs[0].state, "stopped"); assert.equal(h.state.runs[0].stop_reason, "cancelled");
  assert.equal(a.signals[0].aborted, false, "Durable cancellation does not promise to interrupt a remote in-flight model request");
  release(); const result = await pending;
  assert.equal(result?.runId, originalRunId); assert.equal(result?.status, "stopped", JSON.stringify(h.queries)); assert.equal(result?.stopReason, "cancelled");
  assert.equal(result?.countsKnown, false); assert.deepEqual(result?.tools, []);
  assert.deepEqual(a.observe(), { calls: 1, toolReads: 0 }); assert.deepEqual(b.observe(), { calls: 0, toolReads: 0 });
  assert.equal(await other.cancelReply(userId, childId, messageId, async () => true), true);
  let retry;
  try { retry = await other.reply(userId, childId, messageId, async () => true); }
  catch (error) { console.log("SYNTHETIC QUERY TRACE " + JSON.stringify(h.queries)); throw error; }
  assert.deepEqual(retry, result);
  assert.equal(h.state.runs.length, 1); assert.deepEqual(b.observe(), { calls: 0, toolReads: 0 });
});

test("cancellation is idempotent, strictly scoped and cannot overwrite finished or expired runs", async t => {
  for (const boundary of ["missing", "owner", "child", "auth", "epoch", "source", "source-owner", "source-author", "source-role", "source-binding", "completed", "unknown", "expired"]) {
    await t.test(boundary, async () => {
      const h = harness(); let actor = userId, child = childId, message = messageId;
      if (boundary === "missing") message = actionId;
      if (boundary === "owner") { actor = "another-parent"; h.state.allowed.push(actor); }
      if (boundary === "child") child = actionId;
      if (boundary === "auth") h.state.space.access_version = "2";
      if (boundary === "epoch") h.state.space.storage_epoch = actionId;
      if (boundary === "source") h.state.sourceExists = false;
      if (boundary === "source-owner") h.state.sourceOwner = "another-parent";
      if (boundary === "source-author") h.state.sourceAuthor = "another-parent";
      if (boundary === "source-role") h.state.sourceRole = "model";
      if (boundary === "source-binding") h.state.runs[0].source_message_id = actionId;
      if (boundary === "completed" || boundary === "unknown") h.state.runs[0].state = boundary;
      if (boundary === "expired") h.state.runs[0].expires_at = new Date(Date.now() - 1);
      assert.equal(await h.stores().cancelReply(actor, child, message), false);
      assert.notEqual(h.state.runs[0].stop_reason, "cancelled");
    });
  }
  const h = harness(); assert.equal(await h.stores().cancelReply(userId, childId, messageId), true);
  assert.equal(await h.stores().finish(scope, emptyResult), false); assert.equal(h.state.runs[0].result_encrypted, null);
  assert.equal(await h.stores().cancelReply(userId, childId, messageId), true);
  h.state.space.access_version = "2";
  assert.equal(await h.stores().cancelReply(userId, childId, messageId), false);
  assert.equal(await h.stores().get(userId, childId, runId), null);
});

test("durable cancellation reads only committed action, contact and expired confirmation references", async () => {
  const h = harness(); h.addEffects(); const originalActions = structuredClone(h.state.actions), originalConfirmation = structuredClone(h.state.confirmations);
  assert.equal(await h.stores().cancelReply(userId, childId, messageId), true);
  const expected = [{ name: "save_private_instruction", status: "succeeded", reference: actionId },
    { name: "confirmed_proposal", status: "succeeded", reference: proposalId },
    { name: "contact_caregiver", status: "succeeded", reference: contactId }];
  const first = await h.stores().readCancelled(scope, runId), restarted = await h.stores().get(userId, childId, runId);
  assert.equal(first?.status, "stopped"); assert.equal(first?.stopReason, "cancelled"); assert.deepEqual(first?.tools, expected);
  assert.deepEqual(restarted, first); assert.equal(first?.countsKnown, false);
  assert.deepEqual(first?.citations, []); assert.deepEqual(first?.privateSourceCitations, []); assert.deepEqual(first?.proposals, []);
  assert.match(first!.text, /不代表送達/u); assert.ok(!JSON.stringify(first).includes("PRIVATE"));
  assert.deepEqual(h.state.actions, originalActions); assert.deepEqual(h.state.confirmations, originalConfirmation);
  for (const changed of [{ workspaceId: actionId }, { authorizationVersion: "2" }, { dataVersion: actionId + ":1" }])
    assert.equal(await h.stores().readCancelled({ ...scope, ...changed }, runId), null);
  h.state.space.storage_epoch = actionId;
  assert.equal(await h.stores().get(userId, childId, runId), null);
});

test("legacy encrypted cancellation keeps its original projection and running ciphertext is never cleared", async () => {
  const h = harness();
  const legacy = { ...emptyResult, status: "stopped" as const, stopReason: "cancelled" };
  const encrypted = cipher.encrypt(JSON.stringify(legacy), `agent-run:${childId}:${userId}:${runId}`);
  h.state.runs[0].result_encrypted = encrypted;
  assert.equal(await h.stores().cancelReply(userId, childId, messageId), false);
  assert.equal(h.state.runs[0].state, "running"); assert.equal(h.state.runs[0].result_encrypted, encrypted);
  h.state.runs[0].state = "stopped"; h.state.runs[0].stop_reason = "cancelled";
  h.state.space.access_version = "2";
  assert.deepEqual(await h.stores().get(userId, childId, runId), legacy);
  assert.equal(await h.stores().readCancelled(scope, runId), null);
  assert.equal(h.state.runs[0].result_encrypted, encrypted);
});

test("durable cancellation retains pending and expired candidates without deciding or executing them", async () => {
  const h = harness();
  h.state.proposals.push({ id: proposalId, run_id: runId, call_id: "synthetic-candidate", version: 1, state: "pending",
    created_at: new Date(), expires_at: new Date(Date.now() + 60_000),
    payload_encrypted: cipher.encrypt(JSON.stringify({ value: { kind: "memory_fact", key: "synthetic_preference",
      content: "SYNTHETIC PENDING CANDIDATE", intendedVisibility: "private", sourceMessageId: messageId }, result: null, targetLabel: null }),
    `agent-run:${childId}:${userId}:${runId}:proposal:${proposalId}:1`) });
  assert.equal(await h.stores().cancelReply(userId, childId, messageId), true);
  const pending = await h.stores().get(userId, childId, runId);
  assert.equal(pending?.proposals.length, 1); assert.equal(pending.proposals[0].id, proposalId);
  assert.equal(pending.proposals[0].status, "pending"); assert.equal(pending.proposals[0].result, null);
  assert.deepEqual(pending.tools, []);
  h.state.proposals[0].expires_at = new Date(Date.now() - 1);
  const expired = await h.stores().readCancelled(scope, runId);
  assert.equal(expired?.proposals[0].status, "expired"); assert.equal(expired?.proposals[0].result, null);
  assert.equal(h.state.proposals[0].state, "expired"); assert.deepEqual(expired?.tools, []);
  assert.ok(h.queries.every(({ sql }) => !/^(?:INSERT|DELETE)/u.test(sql)
    && (!sql.startsWith("UPDATE") || sql.startsWith("UPDATE agent_runs SET state='unknown'")
      || sql.startsWith("UPDATE agent_runs SET state='stopped'") || sql.startsWith("UPDATE agent_proposals SET state='expired'"))));
  assert.equal(h.state.actions.length, 0); assert.equal(h.state.contacts.length, 0); assert.equal(h.state.confirmations.length, 0);
  const expiryReads = h.queries.filter(({ sql }) => sql.startsWith("UPDATE agent_proposals")).length;
  h.state.space.access_version = "2";
  assert.equal(await h.stores().get(userId, childId, runId), null);
  assert.equal(h.queries.filter(({ sql }) => sql.startsWith("UPDATE agent_proposals")).length, expiryReads);
});

test("receipt lookup failures and overflow remain unknown without undoing accepted cancellation", async t => {
  for (const boundary of ["proposal-error", "proposal-overflow", "action-error", "contact-error", "confirmation-error", "action-overflow", "contact-overflow", "confirmation-overflow", "confirmation-scope", "confirmation-payload"]) {
    await t.test(boundary, async () => {
      const h = harness(); h.addEffects(); assert.equal(await h.stores().cancelReply(userId, childId, messageId), true);
      if (boundary === "proposal-error") h.fail("SELECT * FROM agent_proposals");
      if (boundary === "proposal-overflow") for (let index = 0; index < RECEIPT_QUERY_LIMIT; index++) h.state.proposals.push({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, run_id: runId,
        call_id: "synthetic-" + index, version: 1, state: "pending", payload_encrypted: "yb1.not-decoded-overflow",
        created_at: new Date(), expires_at: new Date(Date.now() + 60_000) });
      if (boundary === "action-error") h.fail("SELECT id FROM agent_action_receipts");
      if (boundary === "contact-error") h.fail("SELECT r.id FROM contact_requests");
      if (boundary === "confirmation-error") h.fail("FROM agent_confirmations c");
      if (boundary === "action-overflow") while (h.state.actions.length < RECEIPT_QUERY_LIMIT) h.state.actions.push(h.state.actions[0]);
      if (boundary === "contact-overflow") while (h.state.contacts.length < RECEIPT_QUERY_LIMIT) h.state.contacts.push(h.state.contacts[0]);
      if (boundary === "confirmation-overflow") h.state.confirmations.push(h.state.confirmations[0]);
      if (boundary === "confirmation-scope") h.state.confirmations[0].proposal_child = actionId;
      if (boundary === "confirmation-payload") h.state.confirmations[0].payload_encrypted = "yb1.invalid";
      const value = await h.stores().get(userId, childId, runId);
      assert.equal(value?.status, "unknown"); assert.equal(value?.stopReason, "cancelled_receipt_unavailable");
      assert.deepEqual(value?.tools, []); assert.match(value!.text, /取消已接受/u); assert.match(value!.text, /勿重新提交/u);
      assert.equal(h.state.runs[0].state, "stopped"); assert.equal(h.state.runs[0].stop_reason, "cancelled");
    });
  }
});

test("recorded confirmation lookup is read-only and never executes or retires a decision", async () => {
  const h = harness(); h.addEffects(); let decisions = 0;
  const reader = createAgentConfirmationStore(h.pool, cipher, async () => { decisions++; throw new Error("No decision permitted"); });
  assert.deepEqual(await reader.recordedConfirmation(userId, childId, messageId), { proposalId });
  h.state.confirmations = [];
  assert.equal(await reader.recordedConfirmation(userId, childId, messageId), null);
  assert.equal(decisions, 0); assert.ok(h.queries.every(({ sql }) => !/^(?:UPDATE|INSERT|DELETE)/u.test(sql)));
});

test("interrupted original runs recover committed references without final ciphertext or replay", async () => {
  const h = harness(); h.addEffects(); h.state.runs[0].expires_at = new Date(Date.now() - 1);
  const effects = structuredClone({ actions: h.state.actions, contacts: h.state.contacts, confirmations: h.state.confirmations });
  const expected = [{ name: "save_private_instruction", status: "succeeded", reference: actionId },
    { name: "confirmed_proposal", status: "succeeded", reference: proposalId },
    { name: "contact_caregiver", status: "succeeded", reference: contactId }];
  const first = await h.stores().get(userId, childId, runId);
  assert.equal(first?.runId, runId); assert.equal(first?.status, "unknown"); assert.equal(first?.stopReason, "interrupted");
  assert.deepEqual(first?.tools, expected); assert.equal(first?.countsKnown, false);
  assert.deepEqual(first?.citations, []); assert.deepEqual(first?.privateSourceCitations, []);
  assert.match(first!.text, /勿重複提交/u); assert.match(first!.text, /不代表送達/u);
  assert.ok(!JSON.stringify(first).includes("PRIVATE"));
  assert.deepEqual(await h.stores().get(userId, childId, runId), first);
  assert.ok(h.queries.every(({ sql }) => !/^(?:INSERT|DELETE)/u.test(sql)
    && (!sql.startsWith("UPDATE") || sql.startsWith("UPDATE agent_runs SET state='unknown'")
      || sql.startsWith("UPDATE agent_proposals SET state='expired'"))));
  const restarted = agentOptions(h), service = createProductAgent(restarted.options);
  assert.deepEqual(await service.reply(userId, childId, messageId, async () => true), first);
  assert.deepEqual(restarted.observe(), { calls: 0, toolReads: 0 });
  assert.equal(h.state.runs.length, 1); assert.equal(h.state.runs[0].result_encrypted, null);
  assert.equal(h.state.runs[0].state, "unknown"); assert.equal(h.state.runs[0].stop_reason, "interrupted");
  assert.deepEqual({ actions: h.state.actions, contacts: h.state.contacts, confirmations: h.state.confirmations }, effects);
  assert.equal(await h.stores().readCancelled(scope, runId), null);
  assert.equal(await service.cancelReply(userId, childId, messageId, async () => true), false);
  assert.equal(await h.stores().finish(scope, emptyResult), false);
});

test("interrupted receipt projection requires the original owner, authority and source binding", async t => {
  for (const boundary of ["owner", "child", "revoked", "auth", "epoch", "source", "source-author", "source-role", "source-binding"]) {
    await t.test(boundary, async () => {
      const h = harness(); h.addEffects(); h.state.runs[0].expires_at = new Date(Date.now() - 1);
      let actor = userId, child = childId;
      if (boundary === "owner") { actor = "another-parent"; h.state.allowed.push(actor); }
      if (boundary === "child") child = actionId;
      if (boundary === "revoked") { h.state.space.owner_user_id = "another-parent"; h.state.allowed = []; }
      if (boundary === "auth") h.state.space.access_version = "2";
      if (boundary === "epoch") h.state.space.storage_epoch = actionId;
      if (boundary === "source") h.state.sourceExists = false;
      if (boundary === "source-author") h.state.sourceAuthor = "another-parent";
      if (boundary === "source-role") h.state.sourceRole = "model";
      if (boundary === "source-binding") h.state.runs[0].trigger_reference = actionId;
      assert.equal(await h.stores().get(actor, child, runId), null);
      assert.ok(h.queries.every(({ sql }) => !sql.includes("agent_action_receipts") && !sql.includes("FROM agent_confirmations c")
        && !sql.includes("FROM contact_requests")), "Reject scope before querying committed references");
      assert.equal(h.state.actions.length, 1); assert.equal(h.state.contacts.length, 1); assert.equal(h.state.confirmations.length, 1);
    });
  }
  const h = harness(); h.addEffects(); h.state.runs[0].expires_at = new Date(Date.now() - 1);
  h.state.runs[0].authorization_version = "9007199254740993"; h.state.space.access_version = "9007199254740993";
  h.state.confirmations[0].authorization_version = "9007199254740993";
  h.state.confirmations[0].proposal_authorization = "9007199254740993";
  h.state.space.change_seq = "99";
  assert.equal((await h.stores().get(userId, childId, runId))?.tools.length, 3, "New data in the same epoch does not hide committed references");
  h.state.space.access_version = "9007199254740992";
  assert.equal(await h.stores().get(userId, childId, runId), null, "Authorization versions remain exact strings");
});

test("interrupted receipt failures stay unknown and never relabel the run as cancelled", async t => {
  for (const boundary of ["action-error", "contact-error", "confirmation-error", "document-error", "action-overflow", "confirmation-scope", "confirmation-payload"]) {
    await t.test(boundary, async () => {
      const h = harness(); h.addEffects(); h.state.runs[0].expires_at = new Date(Date.now() - 1);
      if (boundary === "action-error") h.fail("SELECT id FROM agent_action_receipts");
      if (boundary === "contact-error") h.fail("SELECT r.id FROM contact_requests");
      if (boundary === "confirmation-error") h.fail("FROM agent_confirmations c");
      if (boundary === "document-error") h.fail("SELECT a.op_id");
      if (boundary === "action-overflow") while (h.state.actions.length < RECEIPT_QUERY_LIMIT) h.state.actions.push(h.state.actions[0]);
      if (boundary === "confirmation-scope") h.state.confirmations[0].proposal_child = actionId;
      if (boundary === "confirmation-payload") h.state.confirmations[0].payload_encrypted = "yb1.invalid";
      const value = await h.stores().get(userId, childId, runId);
      assert.equal(value?.status, "unknown"); assert.equal(value?.stopReason, "interrupted_receipt_unavailable");
      assert.equal(value?.countsKnown, false); assert.deepEqual(value?.tools, []);
      assert.deepEqual(value?.citations, []); assert.deepEqual(value?.privateSourceCitations, []);
      assert.match(value!.text, /運行中斷/u); assert.match(value!.text, /勿重新提交/u); assert.doesNotMatch(value!.text, /取消已接受/u);
      assert.ok(!JSON.stringify(value).includes("PRIVATE"));
      assert.equal(h.state.runs[0].state, "unknown"); assert.equal(h.state.runs[0].stop_reason, "interrupted");
      assert.equal(h.state.runs[0].result_encrypted, null);
      assert.equal(await h.stores().readCancelled(scope, runId), null);
      if (boundary.endsWith("error")) {
        h.fail(null);
        const retry = await h.stores().get(userId, childId, runId);
        assert.equal(retry?.stopReason, "interrupted"); assert.equal(retry?.tools.length, 3);
      }
    });
  }
});

test("interrupted pending candidates remain undecided and expire without executing effects", async () => {
  const h = harness(); h.state.runs[0].expires_at = new Date(Date.now() - 1);
  h.state.proposals.push({ id: proposalId, run_id: runId, call_id: "synthetic-pending", version: 1, state: "pending",
    created_at: new Date(), expires_at: new Date(Date.now() + 60_000),
    payload_encrypted: cipher.encrypt(JSON.stringify({ value: { kind: "memory_fact", key: "synthetic_preference",
      content: "SYNTHETIC PENDING CANDIDATE", intendedVisibility: "private", sourceMessageId: messageId }, result: null, targetLabel: null }),
    `agent-run:${childId}:${userId}:${runId}:proposal:${proposalId}:1`) });
  const pending = await h.stores().get(userId, childId, runId);
  assert.equal(pending?.status, "unknown"); assert.equal(pending?.stopReason, "interrupted");
  assert.equal(pending?.proposals[0].status, "pending"); assert.equal(pending?.proposals[0].result, null);
  h.state.proposals[0].expires_at = new Date(Date.now() - 1);
  const expired = await h.stores().get(userId, childId, runId);
  assert.equal(expired?.proposals[0].status, "expired"); assert.equal(expired?.proposals[0].result, null);
  assert.deepEqual(expired?.tools, []); assert.equal(h.state.proposals[0].version, 1);
  assert.equal(h.state.actions.length, 0); assert.equal(h.state.contacts.length, 0); assert.equal(h.state.confirmations.length, 0);
  assert.ok(h.queries.every(({ sql }) => !/^(?:INSERT|DELETE)/u.test(sql)
    && (!sql.startsWith("UPDATE") || sql.startsWith("UPDATE agent_runs SET state='unknown'")
      || sql.startsWith("UPDATE agent_proposals SET state='expired'"))));
});

test("interrupted recovery excludes active runs, other unknown states, worker runs and saved history", async t => {
  for (const boundary of ["active", "other-unknown", "worker", "saved-interrupted", "saved-completed"]) {
    await t.test(boundary, async () => {
      const h = harness(); h.addEffects();
      const row = h.state.runs[0];
      if (boundary !== "active") { row.state = "unknown"; row.stop_reason = "interrupted"; }
      if (boundary === "other-unknown") row.stop_reason = "tool_unknown";
      if (boundary === "worker") { row.trigger_kind = "worker"; row.source_message_id = null as unknown as string; }
      if (boundary.startsWith("saved-")) {
        if (boundary === "saved-completed") { row.state = "completed"; row.stop_reason = null; }
        row.result_encrypted = cipher.encrypt(JSON.stringify({ ...emptyResult, status: row.state, stopReason: row.stop_reason }),
          `agent-run:${childId}:${userId}:${runId}`);
      }
      const ciphertext = row.result_encrypted;
      const value = await h.stores().get(userId, childId, runId);
      assert.equal(value?.status, row.state); assert.equal(value?.stopReason, row.stop_reason); assert.deepEqual(value?.tools, []);
      assert.equal(value?.text, boundary.startsWith("saved-") ? emptyResult.text : "");
      assert.equal(h.state.runs[0].result_encrypted, ciphertext);
      assert.ok(h.queries.every(({ sql }) => !sql.includes("agent_action_receipts") && !sql.includes("FROM agent_confirmations c")
        && !sql.includes("FROM contact_requests")));
    });
  }
});

test("local abort follows committed cancellation and a failed database cancellation is not accepted", async t => {
  for (const fail of [false, true]) await t.test(fail ? "database failure" : "local acceleration", async context => {
    const h = harness(false); let started!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; }), waiting = new Promise<void>(resolve => { release = resolve; });
    context.after(() => release());
    const a = agentOptions(h, async () => { started(); await waiting; }), agent = createProductAgent(a.options);
    const pending = agent.reply(userId, childId, messageId, async () => true); await ready;
    if (fail) h.fail("UPDATE agent_runs SET state='stopped'");
    if (fail) await assert.rejects(() => agent.cancelReply(userId, childId, messageId, async () => true), /synthetic-query-failure/u);
    else assert.equal(await agent.cancelReply(userId, childId, messageId, async () => true), true);
    assert.equal(a.signals[0].aborted, !fail); assert.equal(h.state.runs[0].state, fail ? "running" : "stopped");
    h.fail(null); release(); const result = await pending;
    assert.equal(result?.status, fail ? "completed" : "stopped", JSON.stringify({
      status: result?.status, stopReason: result?.stopReason, tools: result?.tools, observed: a.observe(),
    }));
    assert.equal(result?.stopReason, fail ? null : "cancelled");
    assert.deepEqual(a.observe(), fail ? { calls: 2, toolReads: 1 } : { calls: 1, toolReads: 0 });
    assert.deepEqual([h.state.actions, h.state.proposals, h.state.contacts], [[], [], []]);
    const beforeRetry = a.observe();
    assert.deepEqual(await agent.reply(userId, childId, messageId, async () => true), result);
    assert.deepEqual(a.observe(), beforeRetry, "Reading the original result must not repeat model or tool execution");
    assert.equal(h.state.runs.length, 1);
    assert.equal(await agent.cancelReply(userId, childId, messageId, async () => false), false);
  });
});

test("reply uses only strict cancellation recovery and rechecks identity after that read", async () => {
  const h = harness(false), a = agentOptions(h); let current = true, broadReads = 0, strictReads = 0;
  a.options.store.finish = async () => false;
  a.options.store.get = async () => { broadReads++; return emptyResult; };
  a.options.store.readCancelled = async () => { strictReads++; current = false; return { ...emptyResult, status: "stopped", stopReason: "cancelled" }; };
  const result = await createProductAgent(a.options).reply(userId, childId, messageId, async () => current);
  assert.equal(result, null); assert.equal(strictReads, 1); assert.equal(broadReads, 0);
});
