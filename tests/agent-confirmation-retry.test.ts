import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { createAgentConfirmationStore } from "../server/agent-confirmation-store.ts";
import { createProductAgent } from "../server/product-agent.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import type { AgentProposal, ProductAgentResult } from "../src/shared/product-agent.ts";

const userId = "synthetic-parent", childId = "00000000-0000-4000-8000-000000000001", workspaceId = "synthetic-workspace";
const confirmationId = "00000000-0000-4000-8000-000000000002", proposalId = "00000000-0000-4000-8000-000000000003";
const originalRunId = "00000000-0000-4000-8000-000000000004", responseId = "00000000-0000-4000-8000-000000000005";
const newRunId = "00000000-0000-4000-8000-000000000006", factId = "00000000-0000-4000-8000-000000000007";
const cipher = createStorageCipher(Buffer.alloc(32, 73));

// Synthetic SQL responses exercise the real store and ProductAgent ordering, not PostgreSQL concurrency.
function harness() {
  const result: AgentProposal = { id: proposalId, runId: originalRunId, childId, version: 2, status: "accepted",
    createdAt: "2026-10-09T00:00:00Z", expiresAt: "2026-10-09T00:01:00Z", targetLabel: null,
    value: { kind: "memory_fact", key: "Synthetic confirmed value", content: "Synthetic prior-authority content", validUntil: null, intendedVisibility: "private" },
    result: { kind: "memory_fact", id: factId, version: 2 } };
  const row = { id: confirmationId, owner_user_id: userId, child_id: childId, asking_run_id: originalRunId,
    proposal_run_id: originalRunId, proposal_id: proposalId, proposal_version: 1, authorization_version: "1", storage_epoch: "synthetic-epoch",
    policy_version: 1, work_id: null, work_version: null, state: "accepted", ask_message_id: factId, response_message_id: responseId,
    expires_at: new Date("2026-10-09T00:01:00Z"), payload_encrypted: "", proposal_owner: userId, proposal_child: childId,
    proposal_authorization: "1", proposal_epoch: "synthetic-epoch", proposal_state: "accepted", saved_proposal_version: 2 };
  const saveResult = (value: AgentProposal) => { row.payload_encrypted = cipher.encrypt(JSON.stringify({
    hash: "synthetic-hash", question: "Synthetic specific confirmation", shared: false, result: value,
  }), `agent-confirmation:${childId}:${userId}:${confirmationId}`); };
  saveResult(result);
  const state = { authorization: "1", epoch: "synthetic-epoch", responseValid: true, present: true, overflow: false, lookupFailure: false };
  const calls = { connections: 0, releases: 0, decisions: 0, writes: 0, claims: 0, context: 0, runtime: 0 };
  const queries: string[] = [];
  const rows = (values: unknown[] = []) => ({ rows: values, rowCount: values.length });
  let active = false, locked = false;
  const query = async (sql: string, parameters: unknown[] = []) => {
    queries.push(sql);
    if (/^(INSERT|UPDATE|DELETE)/u.test(sql)) { calls.writes++; throw new Error("No business write permitted"); }
    if (sql === "BEGIN") { assert.equal(active, false); active = true; return rows(); }
    if (sql === "COMMIT" || sql === "ROLLBACK") { assert.equal(active, true); active = locked = false; return rows(); }
    if (sql.startsWith("SET LOCAL")) return rows();
    if (sql === "SELECT workspace_id FROM children WHERE id=$1") return rows([{ workspace_id: workspaceId }]);
    if (sql.startsWith("SELECT owner_user_id, access_version")) {
      assert.equal(active, true); assert.match(sql, /FOR UPDATE/u); locked = true;
      return rows([{ owner_user_id: userId, access_version: state.authorization }]);
    }
    if (sql.startsWith("SELECT 1 FROM children")) return rows([{}]);
    if (sql.startsWith("SELECT access_version::text,storage_epoch::text FROM workspaces")) {
      assert.equal(locked, true); return rows([{ access_version: state.authorization, storage_epoch: state.epoch }]);
    }
    if (sql.includes("FROM agent_confirmations")) {
      assert.equal(locked, true); assert.deepEqual(parameters, [userId, childId, responseId]);
      if (state.lookupFailure) throw new Error("synthetic-receipt-lookup-unavailable");
      if (!state.present) return rows();
      const projected = { ...row, verified_response_id: state.responseValid ? responseId : null };
      return rows(state.overflow ? [projected, { ...projected, id: factId }] : [projected]);
    }
    if (sql.startsWith("SELECT id,role,text_encrypted,created_at FROM chat_messages")) return rows();
    throw new Error("Unexpected synthetic query: " + sql);
  };
  const pool = { query, connect: async () => {
    calls.connections++; assert.equal(active, false, "Do not open a second transaction from the receipt helper");
    return { query, release() { calls.releases++; } };
  } } as unknown as Pool;
  const store = createAgentConfirmationStore(pool, cipher, async () => { calls.decisions++; throw new Error("No decision may replay"); });
  let receivedConfirmation: unknown = null, finished: ProductAgentResult | null = null;
  const options = { store: { consumeConfirmation: store.consumeConfirmation,
    claim: async () => { calls.claims++; return { runId: newRunId, scope: { userId, childId, workspaceId, authorizationVersion: state.authorization, dataVersion: state.epoch + ":8" },
      created: true, sourceMessageId: responseId, state: "running", expiresAt: new Date(Date.now() + 60_000).toISOString() }; },
    authorize: async () => true, finish: async (_scope: unknown, value: ProductAgentResult) => { finished = value; return true; }, get: async () => finished },
    runtime: { run: async (input: { context: { confirmationResult: unknown } }) => {
      calls.runtime++; receivedConfirmation = input.context.confirmationResult;
      return { runId: newRunId, status: "stopped", stopReason: "unavailable", text: null, tools: [], counts: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 } };
    } }, memory: { context: async () => { calls.context++; return { summary: null, truncated: { messages: false } }; } },
    chat: { listForUser: async () => ({ messages: [{ id: responseId, role: "user", text: "確認" }] }) }, tasks: {}, knowledge: {} };
  const agent = createProductAgent(options as unknown as Parameters<typeof createProductAgent>[0]);
  return { store, agent, state, calls, queries, row, result, saveResult, received: () => receivedConfirmation };
}

test("accepted confirmation retry rejects changed authority before a fresh ProductAgent run", async () => {
  const h = harness();
  h.state.authorization = "2";
  await assert.rejects(h.store.recordedConfirmation(userId, childId, responseId), { code: "confirmation_receipt_changed" });
  await assert.rejects(h.agent.reply(userId, childId, responseId, async () => true), { code: "confirmation_receipt_changed" });
  assert.equal(h.received(), null);
  assert.equal(h.calls.claims + h.calls.context + h.calls.runtime + h.calls.decisions + h.calls.writes, 0);
  assert.equal(h.calls.connections, 2); assert.equal(h.calls.releases, 2);
});

test("accepted receipt readers preserve valid expired results and genuinely absent receipts", async () => {
  const h = harness(), ciphertext = h.row.payload_encrypted;
  assert.deepEqual(await h.store.recordedConfirmation(userId, childId, responseId), { proposalId });
  assert.deepEqual(await h.store.consumeConfirmation(userId, childId, responseId), h.result);
  assert.deepEqual(await h.store.consumeConfirmation(userId, childId, responseId), h.result);
  assert.equal(h.row.payload_encrypted, ciphertext);
  assert.equal(h.row.state, "accepted"); assert.equal(h.calls.decisions + h.calls.writes, 0);
  h.state.present = false;
  assert.equal(await h.store.recordedConfirmation(userId, childId, responseId), null);
  assert.equal(await h.store.consumeConfirmation(userId, childId, responseId), null);
  assert.equal(h.calls.connections, 5); assert.equal(h.calls.releases, 5);
});

test("accepted receipt mismatches and lookup failures never become absence or replay", async () => {
  for (const boundary of ["epoch", "response", "proposal", "payload", "lookup", "overflow"] as const) {
    const h = harness();
    if (boundary === "epoch") h.state.epoch = "replacement-epoch";
    if (boundary === "response") h.state.responseValid = false;
    if (boundary === "proposal") h.row.proposal_child = factId;
    if (boundary === "payload") h.saveResult({ ...h.result, runId: newRunId });
    if (boundary === "lookup") h.state.lookupFailure = true;
    if (boundary === "overflow") h.state.overflow = true;
    const before = structuredClone(h.row);
    const expected = boundary === "lookup" ? { message: "synthetic-receipt-lookup-unavailable" }
      : { code: boundary === "overflow" ? "confirmation_receipt_limit" : "confirmation_receipt_changed" };
    await assert.rejects(h.store.recordedConfirmation(userId, childId, responseId), expected, boundary);
    await assert.rejects(h.store.consumeConfirmation(userId, childId, responseId), expected, boundary);
    assert.deepEqual(h.row, before, boundary);
    assert.equal(h.calls.decisions + h.calls.writes, 0, boundary);
    assert.equal(h.calls.connections, 2); assert.equal(h.calls.releases, 2);
  }
});
