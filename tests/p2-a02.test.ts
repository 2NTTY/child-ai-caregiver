import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { FinishReason } from "@google/genai";
import { z } from "zod";
import type { Pool } from "pg";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import { readAiConfig } from "../server/ai-config.ts";
import { createAgentWorkStore } from "../server/agent-work-store.ts";
import { createAgentWorkTools } from "../server/agent-work-tools.ts";
import { createAgentConfirmationStore } from "../server/agent-confirmation-store.ts";
import { createMemoryStore } from "../server/memory.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import { FamilyError } from "../server/family-access.ts";
import type { ProductAgentStore } from "../server/product-agent-store.ts";
import type { MemoryStore } from "../server/memory.ts";
import type { AgentProposal } from "../src/shared/product-agent.ts";

function harness() {
  const userId = "synthetic-a02-owner", childId = randomUUID(), workspaceId = randomUUID(), epoch = randomUUID();
  const cipher = createStorageCipher(Buffer.alloc(32, 38));
  const space = { access_version: "1", storage_epoch: epoch, change_seq: "1" };
  const messages: any[] = [], works: any[] = [], operations: any[] = [], confirmations: any[] = [], proposals: any[] = [], facts: any[] = [], revisions: any[] = [];
  const queries: string[] = [];
  let run = { id: randomUUID(), source_message_id: null as string | null, authorization_version: "1", data_version: epoch + ":1", trigger_reference: "" };
  const message = (role: "user" | "model", text: string, inReplyTo: string | null = null) => {
    const id = randomUUID(), created_at = new Date(Date.UTC(2026, 9, 8, 0, 0, 0, messages.length));
    const row = { id, role, child_id: childId, owner_user_id: userId, author_user_id: role === "user" ? userId : null,
      in_reply_to: inReplyTo, created_at, cursor_at: created_at.toISOString(),
      text_encrypted: cipher.encrypt(text, `chat_messages:${id}:${childId}:${userId}:${role}:${inReplyTo ?? ""}:text`) };
    messages.push(row); return row;
  };
  const addProposal = (): AgentProposal => {
    const id = randomUUID(), value = { kind: "memory_fact" as const, key: "synthetic-key", content: "synthetic-value", intendedVisibility: "private" as const, validUntil: null };
    const row = { id, version: 1, state: "pending", created_at: new Date(), expires_at: new Date(Date.now() + 60000), authorization_version: "1", data_version: epoch + ":1",
      payload_encrypted: cipher.encrypt(JSON.stringify({ value, result: null, targetLabel: null }), `agent-run:${childId}:${userId}:${run.id}:proposal:${id}:1`) };
    proposals.push(row);
    return { id, runId: run.id, childId, version: 1, status: "pending", value, result: null, targetLabel: null, createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString() };
  };
  const result = (rows: unknown[] = []) => ({ rows, rowCount: rows.length });
  const client = { release() {}, async query(sql: string, params: any[] = []): Promise<any> {
    queries.push(sql);
    if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE SAVEPOINT|SET LOCAL)/u.test(sql)) return result();
    if (sql.startsWith("SELECT workspace_id FROM children")) return result([{ workspace_id: workspaceId }]);
    if (sql.startsWith("SELECT owner_user_id, access_version FROM workspaces")) return result([{ owner_user_id: userId, access_version: 1 }]);
    if (sql.startsWith("SELECT 1 FROM children")) return result([{}]);
    // This legacy synthetic adapter keeps additive migrations disabled.
    if (sql.startsWith("SELECT 1 FROM app_migrations")) return result();
    if (sql.startsWith("SELECT access_version::text")) return result([space]);
    if (sql.startsWith("SELECT version FROM agent_operation_policies")) return result();
    if (sql.includes("FROM agent_runs") && !sql.includes("JOIN")) return result([run]);
    if (sql.startsWith("UPDATE agent_runs SET data_version")) { run.data_version = params[1]; return result(); }
    if (sql.startsWith("UPDATE workspaces SET change_seq")) { space.change_seq = String(Number(space.change_seq) + 1); return result([{ change_seq: space.change_seq }]); }
    if (sql.startsWith("INSERT INTO online_changes")) return result();
    if (sql.includes("FROM children c JOIN workspaces")) return result([{ owner_user_id: userId, display_name_encrypted: cipher.encrypt("合成孩子", `children:${childId}:${userId}:display_name`) }]);
    if (sql.includes("FROM chat_messages")) {
      if (sql.startsWith("SELECT 1")) return result(messages.some(item => item.id === params[0] && item.owner_user_id === params[2] && item.child_id === params[1]) ? [{}] : []);
      if (sql.startsWith("SELECT id FROM chat_messages") && sql.includes("role='user'")) return result(messages.filter(item => item.role === "user").slice(-1));
      if (sql.startsWith("SELECT id,role FROM")) {
        const current = messages.find(item => item.id === params[2]);
        return result(messages.filter(item => current && item.created_at < current.created_at).slice(-1));
      }
      if (sql.includes("WHERE id=$1")) return result(messages.filter(item => item.id === params[0]).map(item => ({ ...item, payload_encrypted: item.text_encrypted })));
      if (sql.includes("LIMIT 1") && !sql.includes("LIMIT 101")) return result(messages.slice(-1));
      const [owner, child, highAt, , afterAt] = params;
      return result(messages.filter(item => owner === userId && child === childId && item.created_at <= new Date(highAt) && (!afterAt || item.created_at > new Date(afterAt)))
        .slice(0, 101).map(item => ({ ...item, version: 1, payload_encrypted: item.text_encrypted })));
    }
    if (sql.startsWith("SELECT operation_id,payload_encrypted FROM agent_work_operations")) return result(operations.filter(item => item.operation_id === params[2] || item.run_id === params[3] && item.call_id === params[4]));
    if (sql.startsWith("INSERT INTO agent_work_operations")) { operations.push({ operation_id: params[2], run_id: params[3], call_id: params[4], payload_encrypted: params[6] }); return result(); }
    if (sql.startsWith("INSERT INTO agent_work(")) {
      const row = { id: params[0], child_id: params[1], owner_user_id: params[2], version: params[3], status: params[4], payload_encrypted: params[5],
        created_at: new Date(), updated_at: new Date() }; works.push(row); return result([row]);
    }
    if (sql.startsWith("UPDATE agent_work SET")) {
      const row = works.find(item => item.id === params[0]); Object.assign(row, { version: params[1], status: params[2], payload_encrypted: params[3], updated_at: new Date() }); return result([row]);
    }
    if (sql.includes("FROM agent_work ")) return result(works.filter(item => item.id === params[0]));
    if (sql.startsWith("SELECT p.id FROM agent_proposals")) return result(proposals.filter(item => item.state === "pending").slice(0, 2));
    if (sql.includes("FROM agent_proposals p JOIN")) return result(proposals.filter(item => item.id === params[0]));
    if (sql.startsWith("INSERT INTO agent_confirmations(")) {
      const names = ["id", "child_id", "owner_user_id", "asking_run_id", "proposal_run_id", "proposal_id", "proposal_version", "work_id", "work_version", "authorization_version", "storage_epoch", "policy_version", "payload_encrypted", "expires_at"];
      const row: any = { state: "waiting", ask_message_id: null, response_message_id: null, created_at: new Date() };
      names.forEach((key, i) => { row[key] = key === "expires_at" ? new Date(params[i]) : params[i]; }); confirmations.push(row); return result();
    }
    if (sql.includes("FROM agent_confirmations")) {
      if (sql.includes("response_message_id=$3")) return result(confirmations.filter(item => item.response_message_id === params[2] && item.state === "accepted"));
      if (sql.includes("asking_run_id=$1")) return result(confirmations.filter(item => item.asking_run_id === params[0] && item.proposal_id === params[1] && item.proposal_version === params[2]));
      if (sql.includes("JOIN agent_runs")) return result(confirmations.filter(item => item.state === "waiting" && run.trigger_reference === params[2]));
      if (sql.includes("ask_message_id=$3")) return result(confirmations.filter(item => item.state === "asked" && item.ask_message_id === params[2]).slice(0, 2));
      return result(confirmations.filter(item => ["waiting", "asked"].includes(item.state)));
    }
    if (sql.startsWith("UPDATE agent_confirmations")) {
      if (sql.startsWith("UPDATE agent_confirmations c ")) return result();
      if (sql.includes("WHERE owner_user_id=$1")) { for (const item of confirmations.filter(item => item.ask_message_id === params[2] && ["waiting", "asked"].includes(item.state))) item.state = "invalidated"; return result(); }
      const row = confirmations.find(item => item.id === params[0]);
      if (!row) return result();
      if (sql.includes("state=$2")) Object.assign(row, { state: params[1], ask_message_id: params[2] });
      else if (sql.includes("state='accepted'")) Object.assign(row, { state: "accepted", response_message_id: params[1], payload_encrypted: params[2] });
      else row.state = "invalidated";
      return result();
    }
    if (sql.startsWith("SELECT profile_version FROM children")) return result([{ profile_version: 0 }]);
    if (sql.includes("FROM memory_facts")) {
      if (sql.includes("id<>$2")) return result(facts.filter(item => item.id !== params[1]));
      return result(facts.filter(item => item.id === params[0] && item.child_id === params[1]));
    }
    if (sql.startsWith("UPDATE memory_facts SET visibility")) {
      const row = facts.find(item => item.id === params[0]); Object.assign(row, { visibility: params[1], status: params[2], version: params[3], source_message_id: params[4], source_record_id: params[5], source_record_version: params[6], payload_encrypted: params[7] }); return result();
    }
    if (sql.startsWith("UPDATE memory_facts SET valid_until")) { const row = facts.find(item => item.id === params[0]); row.valid_until = params[1]; row.validity_indexed = true; return result(); }
    if (sql.startsWith("INSERT INTO memory_fact_revisions")) { revisions.push(params); return result(); }
    throw new Error("Unhandled synthetic query: " + sql);
  } };
  const pool = { query: client.query, connect: async () => client } as unknown as Pool;
  return { userId, childId, workspaceId, cipher, pool, messages, works, facts, revisions, confirmations, proposals, message, addProposal, queries,
    get run() { return run; }, setRun(id: string, sourceId: string) { run = { ...run, id, source_message_id: sourceId, trigger_reference: sourceId, data_version: epoch + ":" + space.change_seq }; },
    get scope() { return { userId, childId, workspaceId, authorizationVersion: "1", dataVersion: epoch + ":" + space.change_seq }; } };
}
test("native Runner continues persisted work and bounded encrypted original history across runs", async () => {
  const h = harness(), old = h.message("user", "synthetic source " + "長".repeat(4200)), current = h.message("user", "continue the original work");
  h.setRun(randomUUID(), current.id);
  const store = createAgentWorkStore(h.pool, h.cipher);
  const values = { goal: "synthetic persisted goal", focus: "read original source", questions: ["which date?"], sourceMessageIds: [old.id], resources: [], pending: [], status: "waiting" as const };
  let workId = "", step = 0;
  const sequence = [
    { name: "save_work", args: { operationId: randomUUID(), workId: null, expectedVersion: 0, values } },
    { name: "present_answer", args: {} },
    { name: "read_work", args: () => ({ workId, cursor: null }) },
    { name: "read_history", args: { messageId: old.id, offset: 4000, limit: 4000 } },
    { name: "present_answer", args: {} },
  ];
  const runtime = createAgentRuntime({ config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    usage: { reserve: async () => true, record: async () => {} }, provider: { generate: async request => {
      if (step > 0 && step !== 2) assert.ok(request.contents.some(item => item.parts?.some(part => part.functionResponse)));
      const call = sequence[step++]; return { content: { role: "model", parts: [{ functionCall: { id: "step-" + step, name: call.name, args: typeof call.args === "function" ? call.args() : call.args } }] }, finishReason: FinishReason.STOP };
    } } });
  const executeRun = () => runtime.run({ scope: h.scope, runId: h.run.id, trigger: { kind: "interactive", reference: current.id }, recipeId: "product-interactive",
    availableInputs: ["run", "scope", "conversation", "context", "evidence", "capabilities"], context: {}, messages: [{ role: "user", text: "Synthetic continuation." }], authorize: async () => true,
    tools: run => [...createAgentWorkTools(store as unknown as ProductAgentStore, {} as MemoryStore, run, async () => true).filter(tool => ["save_work", "read_work", "read_history"].includes(tool.name)),
      { name: "present_answer", description: "Synthetic terminal check.", parameters: z.object({}), terminal: true, authorize: async () => true, execute: async () => ({ status: "succeeded" as const, data: { accepted: true } }) }],
    finalize: async () => "Synthetic completion." });
  assert.equal((await executeRun()).status, "completed");
  workId = h.works[0].id;
  assert.ok(h.works[0].payload_encrypted.startsWith("yb1."));
  h.setRun(randomUUID(), current.id);
  assert.equal((await executeRun()).status, "completed");
  assert.equal(step, 5);
  const recovered = await createAgentWorkStore(h.pool, h.cipher).readWork(h.userId, h.childId, { workId, cursor: null });
  assert.equal(recovered?.items[0].goal, values.goal);
  const tail = await store.readHistory(h.userId, h.childId, { messageId: old.id, offset: 4000, limit: 4000 });
  assert.equal(tail?.role, "user"); assert.equal(tail?.nextOffset, null); assert.equal(tail?.text.length, 217);
  for (let i = 0; i < 10; i++) h.message("user", "synthetic source " + i);
  const first = await store.searchHistory(h.userId, h.childId, { kind: "message", query: "synthetic source", cursor: null });
  assert.equal(first?.matches.length, 10); assert.ok(first?.nextCursor); assert.equal(first.complete, false);
  const second = await store.searchHistory(h.userId, h.childId, { kind: "message", query: "synthetic source", cursor: first.nextCursor });
  assert.equal(second?.matches.length, 1); assert.equal(second?.complete, true);
  await assert.rejects(store.searchHistory(h.userId, randomUUID(), { kind: "message", query: "synthetic source", cursor: first.nextCursor }), error => error instanceof FamilyError && error.code === "invalid_cursor");
});

test("persisted specific question accepts once and rejects ambiguity, mixed consent and original decision conflict", async () => {
  for (const mode of ["accept", "multiple", "unbound", "mixed", "late", "conflict"] as const) {
    const h = harness(), source = h.message("user", "Synthetic fact proposal"); h.setRun(randomUUID(), source.id);
    const first = h.addProposal(); let effects = 0;
    const store = createAgentConfirmationStore(h.pool, h.cipher, async (_client, _user, _child, _run, _proposal, input) => {
      if (mode === "conflict") throw new FamilyError(409, "version_conflict");
      effects++; assert.equal(input.confirmShared, false); return { ...first, status: "accepted", version: 2, result: { kind: "memory_fact", id: randomUUID(), version: 2 } };
    });
    const confirmation = await store.requestConfirmation(h.scope, h.run.id, { runId: h.run.id, proposalId: first.id, expectedVersion: 1, workId: null });
    assert.ok(confirmation?.question.includes("合成孩子")); assert.ok(confirmation.question.includes("synthetic-value"));
    let text = confirmation.question;
    if (mode === "multiple") {
      const other = h.addProposal(), another = await store.requestConfirmation(h.scope, h.run.id, { runId: h.run.id, proposalId: other.id, expectedVersion: 1, workId: null });
      text += "\n\n" + another!.question;
    }
    if (mode === "unbound") h.addProposal();
    const ask = h.message("model", text, source.id); await store.bindConfirmationQuestion(h.userId, h.childId, ask.id);
    const response = h.message("user", mode === "mixed" ? "好，但改日期" : "確認");
    if (mode === "late") h.message("user", "cancel the previous request");
    const result = await store.consumeConfirmation(h.userId, h.childId, response.id);
    assert.equal(effects, mode === "accept" ? 1 : 0);
    if (mode === "accept") {
      assert.equal(result?.status, "accepted");
      assert.deepEqual(await store.consumeConfirmation(h.userId, h.childId, response.id), result);
      assert.equal(effects, 1);
    } else { assert.equal(result, null); assert.ok(h.confirmations.every(row => row.state === "invalidated")); }
  }
});

test("original memory revision preserves family scope, versions, source and inactive history", async () => {
  const h = harness(), source = h.message("user", "Synthetic corrected fact");
  const original = { id: randomUUID(), childId: h.childId, version: 2, visibility: "family" as const, intendedVisibility: "family" as const,
    status: "confirmed" as const, createdBy: h.userId, confirmedBy: h.userId, confirmedAt: new Date().toISOString(), key: "synthetic-key", content: "old",
    source: { kind: "manual" as const, description: "Synthetic seed" }, validUntil: null, reason: "Synthetic seed", applicable: true, sourceState: "current" as const };
  h.facts.push({ id: original.id, child_id: h.childId, created_by: h.userId, version: 2, visibility: "family", status: "confirmed",
    payload_encrypted: h.cipher.encrypt(JSON.stringify(original), `memory-fact:${h.childId}:${original.id}:2`) });
  const store = createMemoryStore(h.pool, h.cipher);
  const input = { expectedVersion: 2, confirm: true as const, confirmShared: false, reason: "Synthetic correction",
    values: { key: original.key, content: "corrected", validUntil: null, source: { kind: "private_chat" as const, messageId: source.id, description: "Synthetic original source" } } };
  await assert.rejects(store.reviseFact(h.userId, h.childId, original.id, input), error => error instanceof FamilyError && error.code === "sharing_confirmation_required");
  const revised = await store.reviseFact(h.userId, h.childId, original.id, { ...input, confirmShared: true });
  assert.equal(revised?.visibility, "family"); assert.equal(revised?.version, 3); assert.equal(revised?.source.kind, "private_chat");
  await assert.rejects(store.reviseFact(h.userId, h.childId, original.id, { ...input, confirmShared: true }), error => error instanceof FamilyError && error.code === "version_conflict");
  const inactive = await store.deactivateFact(h.userId, h.childId, original.id, { expectedVersion: 3, reason: "Synthetic retirement" });
  assert.equal(inactive?.status, "inactive"); assert.equal(inactive?.version, 4); assert.equal(h.revisions.length, 2);
  assert.equal(h.facts[0].validity_indexed, true);
});
