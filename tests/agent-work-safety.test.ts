import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { AgentWork, SaveAgentWork } from "../src/shared/agent-work.ts";
import { createAgentWorkStore } from "../server/agent-work-store.ts";
import { FamilyError } from "../server/family-access.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";

// Real store, validators, encryption, access and online-change code with an exact-query,
// rollback-capable synthetic Pool. This is not PostgreSQL or a concurrency/model test.
// The additive continuation migration is disabled; background follow-ups are not tested.
function fixture() {
  const userId = "synthetic-work-owner", childId = randomUUID(), workspaceId = randomUUID(), epoch = randomUUID();
  const cipher = createStorageCipher(Buffer.alloc(32, 63));
  let state: any = { messages: [], works: [], operations: [], changes: [],
    space: { access_version: "1", storage_epoch: epoch, change_seq: "1" }, run: null };
  let transaction: any = null;
  const queries: string[] = [];
  const rows = (items: any[] = []) => ({ rows: structuredClone(items), rowCount: items.length });
  const message = (role: "user" | "model", text: string, overrides: Record<string, unknown> = {}) => {
    // Text labels make the synthetic user intent explicit; SQL does not interpret it.
    const row = { id: randomUUID(), role, text, owner_user_id: userId, author_user_id: role === "user" ? userId : null,
      child_id: childId, created_at: new Date(1800000000000 + state.messages.length), ...overrides };
    state.messages.push(row); return row;
  };
  const start = (sourceId: string) => {
    state.run = { id: randomUUID(), owner_user_id: userId, child_id: childId, source_message_id: sourceId,
      authorization_version: "1", data_version: epoch + ":" + state.space.change_seq,
      trigger_kind: "interactive", state: "running", expires_at: new Date(Date.now() + 60000) };
    return state.run.id as string;
  };
  async function query(sql: string, p: any[] = []): Promise<any> {
    queries.push(sql);
    if (sql === "BEGIN") { assert.equal(transaction, null); transaction = structuredClone(state); return rows(); }
    if (sql === "COMMIT") { assert.ok(transaction); transaction = null; return rows(); }
    if (sql === "ROLLBACK") { assert.ok(transaction); state = transaction; transaction = null; return rows(); }
    if (sql.startsWith("SET LOCAL")) return rows();
    if (sql.startsWith("SELECT workspace_id FROM children")) return rows(p[0] === childId ? [{ workspace_id: workspaceId }] : []);
    if (sql.startsWith("SELECT owner_user_id, access_version FROM workspaces")) return rows(p[0] === workspaceId ? [{ owner_user_id: userId, access_version: 1 }] : []);
    if (sql.startsWith("SELECT 1 FROM children")) return rows(p[0] === childId && p[1] === workspaceId ? [{}] : []);
    if (sql.startsWith("SELECT access_version::text")) return rows(p[0] === workspaceId ? [state.space] : []);
    if (sql.startsWith("SELECT source_message_id,authorization_version")) {
      const run = state.run;
      return rows(run && run.id === p[0] && run.owner_user_id === p[1] && run.child_id === p[2]
        && run.trigger_kind === "interactive" && run.state === "running" && run.expires_at > new Date() ? [run] : []);
    }
    if (sql.startsWith("SELECT operation_id,payload_encrypted FROM agent_work_operations")) return rows(state.operations.filter((r: any) =>
      r.owner_user_id === p[0] && r.child_id === p[1] && (r.operation_id === p[2] || r.run_id === p[3] && r.call_id === p[4])));
    if (sql.startsWith("SELECT * FROM agent_work ")) return rows(state.works.filter((r: any) =>
      r.id === p[0] && r.owner_user_id === p[1] && r.child_id === p[2]));
    if (sql.startsWith("SELECT 1 FROM chat_messages")) {
      const current = state.messages.find((m: any) => m.id === p[3] && m.child_id === p[1] && m.owner_user_id === p[2]);
      return rows(state.messages.some((m: any) => m.id === p[0] && m.child_id === p[1] && m.owner_user_id === p[2]
        && current && (m.created_at < current.created_at || +m.created_at === +current.created_at && m.id <= current.id)
        && (!sql.includes("role='user'") || m.role === "user")
        && (!sql.includes("author_user_id=$3") || m.author_user_id === p[2])) ? [{}] : []);
    }
    if (sql.startsWith("INSERT INTO agent_work(")) {
      const r = { id: p[0], child_id: p[1], owner_user_id: p[2], version: p[3], status: p[4], payload_encrypted: p[5],
        created_at: new Date(), updated_at: new Date() }; state.works.push(r); return rows([r]);
    }
    if (sql.startsWith("UPDATE agent_work SET ")) {
      const r = state.works.find((r: any) => r.id === p[0]); assert.ok(r);
      Object.assign(r, { version: p[1], status: p[2], payload_encrypted: p[3], updated_at: new Date() }); return rows([r]);
    }
    if (sql.startsWith("INSERT INTO agent_work_operations")) {
      state.operations.push({ owner_user_id: p[0], child_id: p[1], operation_id: p[2], run_id: p[3], call_id: p[4], work_id: p[5], payload_encrypted: p[6] }); return rows();
    }
    if (sql.startsWith("UPDATE agent_confirmations")) return rows();
    if (sql.startsWith("SELECT 1 FROM app_migrations")) return rows();
    if (sql.startsWith("UPDATE workspaces SET change_seq")) { state.space.change_seq = String(Number(state.space.change_seq) + 1); return rows([{ change_seq: state.space.change_seq }]); }
    if (sql.startsWith("INSERT INTO online_changes")) { state.changes.push(p); return rows(); }
    if (sql.startsWith("UPDATE agent_runs SET data_version")) { assert.equal(state.run.id, p[0]); state.run.data_version = p[1]; return rows(); }
    throw new Error("Unhandled synthetic query: " + sql);
  }
  const pool = { query, connect: async () => ({ query, release() { assert.equal(transaction, null); } }) };
  const store = createAgentWorkStore(pool as never, cipher);
  const scope = () => ({ userId, childId, workspaceId, authorizationVersion: "1", dataVersion: epoch + ":" + state.space.change_seq });
  const input = (sourceMessageIds: string[], status: AgentWork["status"] = "active", work?: Pick<AgentWork, "id" | "version">): SaveAgentWork => ({
    operationId: randomUUID(), workId: work?.id ?? null, expectedVersion: work?.version ?? 0,
    values: { goal: "Synthetic document preparation", focus: "Synthetic progress", sourceMessageIds, resources: [],
      questions: status === "waiting" ? ["Which synthetic checklist item?"] : [], pending: [], status, followUp: null },
  });
  const submit = (command: SaveAgentWork, runId: string = state.run.id, callId: string = randomUUID()) =>
    store.saveWork(scope(), runId, callId, command);
  const save = (sourceMessageIds: string[], status: AgentWork["status"] = "active", work?: Pick<AgentWork, "id" | "version">) =>
    submit(input(sourceMessageIds, status, work));
  const checkpoint = () => ({ state: structuredClone(state), queryCount: queries.length });
  const unchanged = (before: ReturnType<typeof checkpoint>) => {
    assert.deepEqual(state, before.state, "Work, operations, changes and run/scope versions must remain unchanged");
    assert.deepEqual(queries.slice(before.queryCount).filter(sql => /^(INSERT|UPDATE|DELETE)\b/.test(sql)), [],
      "A rejected save or historical replay must not attempt any write");
  };
  return { message, start, input, submit, save, checkpoint, unchanged, get state() { return state; } };
}

const conflict = (code: string) => (error: unknown) => error instanceof FamilyError && error.status === 409 && error.code === code;

test("save_work accepts owned user sources and rejects model, foreign-author, scope and future sources without writes", async () => {
  const h = fixture();
  const original = h.message("user", "請整理一份合成入學準備清單。");
  const model = h.message("model", "我建議另外建立一項合成工作。");
  const foreignAuthor = h.message("user", "另一位合成人員提出的建議。", { author_user_id: "synthetic-other-author" });
  const current = h.message("user", "沿用我剛才的合成清單要求。"); h.start(current.id);
  const accepted = await h.save([original.id, current.id]); assert.ok(accepted);
  assert.equal(accepted.status, "active"); assert.deepEqual(accepted.sourceMessageIds, [original.id, current.id]);
  const otherOwner = h.message("user", "其他合成帳戶的要求。", { owner_user_id: "synthetic-other-owner", created_at: original.created_at });
  const otherChild = h.message("user", "其他合成孩子的要求。", { child_id: randomUUID(), created_at: original.created_at });
  const future = h.message("user", "這項合成要求發生在本次 run 的訊息之後。");
  for (const source of [model, foreignAuthor, otherOwner, otherChild, future]) {
    const before = h.checkpoint();
    assert.equal(await h.save([original.id, source.id]), null, "Invalid sources retain the existing not-found/null result");
    h.unchanged(before);
  }
  // This fix does not introduce a nonempty source-list requirement.
  const empty = await h.save([]); assert.ok(empty); assert.deepEqual(empty.sourceMessageIds, []);
});

test("waiting work can continue to active and cancel, but latest-version cancelled work cannot become non-cancelled", async () => {
  const h = fixture(), original = h.message("user", "請整理合成清單，先問我需要哪一項。"); h.start(original.id);
  const waiting = await h.save([original.id], "waiting"); assert.ok(waiting); assert.equal(waiting.version, 1);
  const answer = h.message("user", "合成清單第二項。"); h.start(answer.id);
  const active = await h.save([original.id, answer.id], "active", waiting); assert.ok(active);
  assert.equal(active.id, waiting.id); assert.equal(active.status, "active"); assert.equal(active.version, 2);
  const cancellation = h.message("user", "取消這項合成工作，請不要再繼續。"); h.start(cancellation.id);
  const cancelled = await h.save([original.id, answer.id, cancellation.id], "cancelled", active); assert.ok(cancelled);
  assert.equal(cancelled.id, active.id); assert.equal(cancelled.status, "cancelled"); assert.equal(cancelled.version, 3);
  const unrelated = h.message("user", "現在只討論另一個合成問題，沒有要求恢復已取消的工作。"); h.start(unrelated.id);
  for (const status of ["active", "waiting", "completed"] as const) {
    const before = h.checkpoint();
    await assert.rejects(h.save([original.id], status, cancelled), conflict("work_cancelled"));
    h.unchanged(before);
  }
  const stale = h.checkpoint();
  await assert.rejects(h.save([original.id], "active", active), conflict("version_conflict")); h.unchanged(stale);
  // Existing cancelled-to-cancelled updates retain their prior versioned behavior.
  const stillCancelled = await h.save([original.id, cancellation.id], "cancelled", cancelled); assert.ok(stillCancelled);
  assert.equal(stillCancelled.id, cancelled.id); assert.equal(stillCancelled.status, "cancelled");
  assert.equal(stillCancelled.version, cancelled.version + 1);
});

test("cancelled work retains historical operation replay and conflict while an explicit new user request can create separate work", async () => {
  const h = fixture(), original = h.message("user", "建立這項合成準備工作。");
  const originalRun = h.start(original.id), originalCall = randomUUID(), command = h.input([original.id]);
  const active = await h.submit(command, originalRun, originalCall); assert.ok(active);
  const cancellation = h.message("user", "取消剛才的合成準備工作。"); h.start(cancellation.id);
  const cancelled = await h.save([original.id, cancellation.id], "cancelled", active); assert.ok(cancelled);
  const unrelated = h.message("user", "這是另一個合成問題，沒有恢復授權。"); h.start(unrelated.id);
  const replayBefore = h.checkpoint();
  const replay = await h.submit(command, originalRun, originalCall);
  assert.deepEqual(replay, active, "An exact replay returns the encrypted historical result");
  assert.equal(h.state.works.find((row: any) => row.id === cancelled.id).status, "cancelled");
  assert.equal(h.state.works.find((row: any) => row.id === cancelled.id).version, cancelled.version);
  h.unchanged(replayBefore);
  const conflictBefore = h.checkpoint();
  await assert.rejects(h.submit({ ...command, values: { ...command.values, focus: "Changed synthetic payload" } }, originalRun, originalCall), conflict("operation_conflict"));
  h.unchanged(conflictBefore);
  const newRequest = h.message("user", "另開一項新的合成清單工作；不要恢復已取消的那一項。"); h.start(newRequest.id);
  const oldRow = structuredClone(h.state.works.find((row: any) => row.id === cancelled.id));
  const newWork = await h.save([newRequest.id], "waiting"); assert.ok(newWork);
  assert.notEqual(newWork.id, cancelled.id); assert.equal(newWork.version, 1); assert.equal(newWork.status, "waiting");
  assert.deepEqual(newWork.sourceMessageIds, [newRequest.id]);
  assert.deepEqual(h.state.works.find((row: any) => row.id === cancelled.id), oldRow);
  assert.equal(h.state.works.length, 2, "A separate work exists only after the explicit new save");
});
