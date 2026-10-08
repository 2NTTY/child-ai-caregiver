import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { createConcernStore, type ConcernJob } from "../server/concern-store.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import { FamilyError } from "../server/family-access.ts";
import { createConcernsApi, ConcernApiError } from "../src/client/concerns-api.ts";
import { CONCERN_EVENT_LIMIT, CONCERN_STORED_EVENT_LIMIT, type Concern, type ConcernChange, type ConcernEvent } from "../src/shared/concerns.ts";

const childId = randomUUID(), workspaceId = randomUUID(), epoch = randomUUID(), generation = randomUUID();
const userId = "synthetic-owner", authorityVersion = epoch + ":1", at = "2026-10-01T00:00:00Z";
const cipher = createStorageCipher(Buffer.alloc(32, 47));
type Row = { id: string; child_id: string; created_by: string; version: number; payload_encrypted: string; follow_up_id: string | null };
type EventRow = { id: string; sequence: number; actor_user_id: string; payload_encrypted: string };
type Follow = { id: string; concern_id: string; child_id: string; actor_user_id: string; concern_version: number;
  due_at: Date; state: NonNullable<Concern["followUp"]>["state"]; storage_epoch: string; authorization_version: string;
  worker_generation: string | null; job_id: string | null; run_id: string | null };
type Operation = { child_id: string; storage_epoch: string; request_hash_encrypted: string; result_encrypted: string };
type Run = { id: string; state: string; expires_at: Date; result_encrypted: string | null };
interface State { rows: Map<string, Row>; events: Map<string, EventRow[]>; follows: Map<string, Follow>;
  operations: Map<string, Operation>; revisions: Map<string, string>; runs: Map<string, Run>; changes: number }
function harness(childIds: readonly string[] = [childId]) {
  let state: State = { rows: new Map(), events: new Map(), follows: new Map(), operations: new Map(), revisions: new Map(), runs: new Map(), changes: 0 };
  let snapshot: State | null = null;
  const options = { migration: true, allowed: true, workerEnabled: true, afterDueSelection: null as (() => Promise<void>) | null };
  const queries: string[] = [], jobs: ConcernJob[] = [];
  const result = (rows: unknown[]) => ({ rows, rowCount: rows.length });
  function fixture(count: number, followState: "pending" | "queued" | null = null, status: Concern["status"] = "following") {
    const id = randomUUID(), followId = followState ? randomUUID() : null, version = 10;
    const item: Concern = { id, childId, title: "Synthetic concern", reason: "Synthetic reason", status, version,
      createdAt: at, updatedAt: at, archivedAt: status === "closed" ? at : null, attentionIds: [],
      events: Array.from({ length: count }, (_, index): ConcernEvent => ({ id: randomUUID(), at, kind: "observation",
        title: "Synthetic observation", text: "Original event " + index, sourceLabel: "Synthetic", actorUserId: userId })),
      historyComplete: true, followUp: followId ? { id: followId, at, state: followState!, runId: null } : null };
    const { events, historyComplete: _complete, followUp: _follow, ...stored } = item;
    state.rows.set(id, { id, child_id: childId, created_by: userId, version, follow_up_id: followId,
      payload_encrypted: cipher.encrypt(JSON.stringify(stored), "concern:" + childId + ":" + id + ":" + userId + ":" + version) });
    state.events.set(id, events.map((event, index) => ({ id: event.id, sequence: index + 1, actor_user_id: userId,
      payload_encrypted: cipher.encrypt(JSON.stringify(event), "concern:" + childId + ":" + id + ":" + userId + ":event:" + event.id + ":" + userId) })));
    if (followId) state.follows.set(followId, { id: followId, concern_id: id, child_id: childId, actor_user_id: userId,
      concern_version: version, due_at: new Date(at), state: followState!, storage_epoch: epoch, authorization_version: "1",
      worker_generation: followState === "queued" ? generation : null, job_id: followState === "queued" ? randomUUID() : null, run_id: null });
    return item;
  }
  const client = { release() {}, async query(sql: string, values: unknown[] = []) {
    queries.push(sql);
    if (sql === "BEGIN") { snapshot = structuredClone(state); return result([]); }
    if (sql === "COMMIT") { snapshot = null; return result([]); }
    if (sql === "ROLLBACK") { if (snapshot) state = snapshot; snapshot = null; return result([]); }
    if (sql.startsWith("SET LOCAL") || sql.startsWith("SELECT pg_advisory")) return result([]);
    if (sql.startsWith("SELECT workspace_id FROM children")) return result(childIds.includes(String(values[0])) ? [{ workspace_id: workspaceId }] : []);
    if (sql.startsWith("SELECT owner_user_id, access_version FROM workspaces")) return result([{ owner_user_id: userId, access_version: 1 }]);
    if (sql.startsWith("SELECT 1 FROM children")) return result(childIds.includes(String(values[0])) && values[1] === workspaceId ? [{}] : []);
    if (sql.startsWith("SELECT storage_epoch,access_version")) return result([{ storage_epoch: epoch, access_version: "1" }]);
    if (sql.startsWith("SELECT 1 FROM app_migrations")) return result(sql.includes("029-concern-terminal-reserve") && options.migration ? [{}] : []);
    if (sql.startsWith("SELECT * FROM concern_operations")) return result(state.operations.has(String(values[1])) ? [state.operations.get(String(values[1]))] : []);
    if (sql.startsWith("INSERT INTO concern_operations")) {
      const [,_op, child_id, storage_epoch, request_hash_encrypted, result_encrypted] = values;
      state.operations.set(String(_op), { child_id, storage_epoch, request_hash_encrypted, result_encrypted } as Operation); return result([]);
    }
    if (sql.startsWith("SELECT * FROM concerns WHERE id=")) {
      const row = state.rows.get(String(values[0])); return result(row?.child_id === values[1] ? [row] : []);
    }
    if (sql.startsWith("SELECT * FROM concerns WHERE child_id=")) return result([...state.rows.values()].filter(row => row.child_id === values[0]).slice(0, 201));
    if (sql.includes("FROM concern_events WHERE")) return result((state.events.get(String(values[0])) ?? []).slice(0, Number(values[1] ?? 201)));
    if (sql.startsWith("SELECT *,authorization_version")) return result(state.follows.has(String(values[0])) ? [state.follows.get(String(values[0]))] : []);
    if (sql.startsWith("UPDATE concerns SET")) {
      const row = state.rows.get(String(values[0]))!;
      Object.assign(row, { version: values[1], payload_encrypted: values[3], follow_up_id: values[4] }); return result([]);
    }
    if (sql.startsWith("INSERT INTO concern_events")) {
      const [id, concernId, sequence, actor_user_id, payload_encrypted] = values;
      const events = state.events.get(String(concernId))!;
      assert.ok(Number(sequence) >= 1 && Number(sequence) <= (options.migration ? 202 : 200));
      assert.equal(events.some(event => event.sequence === sequence), false);
      events.push({ id, sequence, actor_user_id, payload_encrypted } as EventRow); return result([]);
    }
    if (sql.startsWith("INSERT INTO concern_revisions")) {
      const key = String(values[0]) + ":" + values[1]; assert.equal(state.revisions.has(key), false);
      state.revisions.set(key, String(values[2])); return result([]);
    }
    if (sql.startsWith("UPDATE concern_followups SET state='cancelled'")) {
      const follow = state.follows.get(String(values[0]))!;
      if (["pending", "queued"].includes(follow.state)) follow.state = "cancelled"; return result([]);
    }
    if (sql.startsWith("UPDATE concern_followups SET state='queued'")) {
      Object.assign(state.follows.get(String(values[0]))!, { state: "queued", concern_version: values[1], worker_generation: values[2], job_id: values[3] }); return result([]);
    }
    if (sql.startsWith("UPDATE concern_followups SET state=$2")) {
      const follow = state.follows.get(String(values[0]))!;
      if (!sql.includes("state IN") || ["pending", "queued"].includes(follow.state)) {
        follow.state = values[1] as Follow["state"]; follow.run_id = (values[2] ?? follow.run_id) as string | null;
      }
      return result([]);
    }
    if (sql.startsWith("UPDATE concern_followups SET concern_version=")) {
      state.follows.get(String(values[0]))!.concern_version = Number(values[1]); return result([]);
    }
    if (sql.startsWith("UPDATE workspaces SET change_seq")) return result([{ change_seq: String(++state.changes) }]);
    if (sql.startsWith("INSERT INTO online_changes")) return result([]);
    if (sql.startsWith("SELECT f.child_id")) {
      const selected = [...state.follows.values()]
      .filter(follow => ["pending", "queued"].includes(follow.state)
        && (options.migration || !sql.includes("e.sequence>=$2")
          || !state.events.get(follow.concern_id)!.some(event => event.sequence >= Number(values[1])))).slice(0, 10)
      .map(follow => ({ child_id: follow.child_id, concern_id: follow.concern_id, storage_epoch: epoch }));
      const intervene = options.afterDueSelection; options.afterDueSelection = null; await intervene?.();
      return result(selected);
    }
    if (sql.startsWith("SELECT w.owner_user_id")) return result([{ owner_user_id: userId }]);
    if (sql.startsWith("SELECT c.enabled")) return result([{ enabled: options.workerEnabled, generation, storage_epoch: epoch }]);
    if (sql.startsWith("SELECT 1 FROM workspaces")) return result(options.allowed ? [{}] : []);
    if (sql.startsWith("SELECT state FROM pgboss.job")) return result([]);
    if (sql.includes("FROM agent_runs")) return result(state.runs.has(String(values[2])) ? [state.runs.get(String(values[2]))] : []);
    throw new Error("Unexpected synthetic query: " + sql);
  } };
  const store = createConcernStore({ query: client.query, connect: async () => client } as unknown as Pool, cipher);
  const job = (item: Concern): ConcernJob => {
    const follow = state.follows.get(item.followUp!.id)!;
    return { childId, id: item.id, followUpId: follow.id, version: item.version, jobId: follow.job_id!, workerGeneration: generation, storageEpoch: epoch };
  };
  return { store, fixture, options, queries, jobs, job, get state() { return state; },
    enqueue: async (_client: unknown, value: ConcernJob) => { jobs.push(value); } };
}
const capacityError = (error: unknown) => error instanceof FamilyError && error.code === "concern_history_requires_review";
const archive = (item: Concern): ConcernChange => ({ action: "archive", expectedVersion: item.version, authorityVersion, confirm: true });
const cancel = (item: Concern): ConcernChange => ({ action: "schedule_followup", expectedVersion: item.version, authorityVersion, followUpAt: null });

test("full archive and cancellation preserve history, receipts and terminal reserve", async () => {
  for (const follow of [null, "pending", "queued"] as const) {
    const h = harness(), original = h.fixture(200, follow), opId = randomUUID(), input = archive(original);
    const ciphertexts = h.state.events.get(original.id)!.map(value => value.payload_encrypted);
    const ended = await h.store.change(userId, childId, original.id, input, opId);
    assert.ok(ended); assert.equal(ended.status, "closed"); assert.equal(ended.version, 11);
    assert.equal(ended.events.length, follow ? 202 : 201); assert.equal(ended.historyComplete, true);
    assert.deepEqual(ended.events.slice(0, 200), original.events);
    assert.deepEqual(h.state.events.get(original.id)!.slice(0, 200).map(value => value.payload_encrypted), ciphertexts);
    if (follow) assert.equal(ended.followUp?.state, "cancelled");
    assert.deepEqual((await h.store.get(userId, childId, original.id))?.events, ended.events);
    const replay = await h.store.change(userId, childId, original.id, input, opId);
    assert.deepEqual(replay, ended); assert.equal(h.state.revisions.size, 1);
    if (follow) { assert.equal(await h.store.backgroundInput(h.job(original)), null); assert.equal(await h.store.finishBackground(h.job(original), null), "ignored"); }
    assert.equal(h.jobs.length, 0);
  }
  {
    const h = harness(), original = h.fixture(200, "pending");
    const cancelled = await h.store.change(userId, childId, original.id, cancel(original), randomUUID());
    assert.ok(cancelled); assert.equal(cancelled.events.length, 201); assert.equal(cancelled.followUp?.state, "cancelled");
    await assert.rejects(h.store.change(userId, childId, original.id, cancel(cancelled), randomUUID()), capacityError);
    const ended = await h.store.change(userId, childId, original.id, archive(cancelled), randomUUID());
    assert.ok(ended); assert.equal(ended.events.length, 202); assert.equal(ended.status, "closed");
    const read = await h.store.list(userId, childId); assert.equal(read?.items[0].events.length, 202);
    await assert.rejects(h.store.change(userId, childId, original.id, { action: "restore", expectedVersion: ended.version, authorityVersion, confirm: true }, randomUUID()), capacityError);
  }
});

test("migration receipt and under-lock capacity gate preserve bounded due progress", async () => {
  {
    const h = harness(), original = h.fixture(200, "pending"); h.options.migration = false;
    await assert.rejects(h.store.change(userId, childId, original.id, archive(original), randomUUID()), capacityError);
    const read = await h.store.get(userId, childId, original.id);
    assert.equal(read?.status, "following"); assert.equal(read?.followUp?.state, "pending"); assert.equal(read?.version, 10);
    assert.equal(h.state.events.get(original.id)!.length, 200); assert.equal(h.state.operations.size, 0);
  }
  {
    const h = harness(), full = Array.from({ length: 10 }, () => h.fixture(200, "pending"));
    const normal = h.fixture(10, "pending"); h.options.migration = false;
    const originals = full.map(item => structuredClone(h.state.events.get(item.id)));
    await h.store.checkDue(generation, h.enqueue);
    assert.deepEqual(h.jobs.map(job => job.id), [normal.id]);
    for (const [index, item] of full.entries()) {
      assert.equal(h.state.follows.get(item.followUp!.id)?.state, "pending");
      assert.equal(h.state.rows.get(item.id)?.version, 10);
      assert.deepEqual(h.state.events.get(item.id), originals[index]);
    }
    assert.equal(h.state.revisions.size, 1);
    const query = h.queries.find(sql => sql.startsWith("SELECT f.child_id"))!;
    assert.match(query, /WHERE \(\(f.state='pending' AND f.due_at<=now\(\)\) OR f.state='queued'\)/u);
    assert.match(query, /EXISTS\(SELECT 1 FROM app_migrations WHERE id='029-concern-terminal-reserve'\)/u);
    assert.match(query, /NOT EXISTS\(SELECT 1 FROM concern_events e WHERE e.concern_id=f.concern_id AND e.sequence>=\$2\)/u);
    assert.match(query, /ORDER BY f.due_at,f.id LIMIT 10/u);
  }
  {
    const h = harness(), filling = h.fixture(199, "pending"), normal = h.fixture(10, "pending");
    h.options.migration = false;
    h.options.afterDueSelection = async () => {
      const appended = await h.store.change(userId, childId, filling.id, { action: "append", expectedVersion: filling.version,
        authorityVersion, text: "The last ordinary event", observedAt: at, links: { recordId: null, taskId: null, attentionId: null } }, randomUUID());
      assert.equal(appended?.events.length, 200);
    };
    await h.store.checkDue(generation, h.enqueue);
    assert.deepEqual(h.jobs.map(job => job.id), [normal.id]);
    assert.equal(h.state.follows.get(filling.followUp!.id)?.state, "pending");
    assert.equal(h.state.events.get(filling.id)!.length, 200);
    assert.equal(h.state.rows.get(filling.id)?.version, 11);
  }
  {
    const prior = await readFile(new URL("../server/migrations/027-concerns.sql", import.meta.url), "utf8");
    const next = await readFile(new URL("../server/migrations/029-concern-terminal-reserve.sql", import.meta.url), "utf8");
    const runner = await readFile(new URL("../server/migrate.ts", import.meta.url), "utf8");
    assert.equal(createHash("sha256").update(prior.replace(/\r\n/gu, "\n")).digest("hex"), "89e48065c9123fcf4933366267778e9ee2ab7b51461927c7740e4e66e369d356");
    assert.match(prior, /sequence BETWEEN 1 AND 200/u);
    assert.match(next, /ALTER TABLE concern_events\s+DROP CONSTRAINT concern_events_sequence_check,\s+ADD CONSTRAINT concern_events_sequence_check CHECK \(sequence BETWEEN 1 AND 202\);/u);
    assert.doesNotMatch(next, /\b(?:DELETE|UPDATE|TRUNCATE|DROP TABLE)\b/iu);
    assert.equal(CONCERN_EVENT_LIMIT, 200); assert.equal(CONCERN_STORED_EVENT_LIMIT, 202);
    assert.equal(runner.split('"029-concern-terminal-reserve"').length - 1, 1);
    assert.match(runner, /"028-family-documents", "029-concern-terminal-reserve"/u);
    assert.match(runner, /applied.rows\[0\].checksum !== checksum && applied.rows\[0\].checksum !== windowsChecksum/u);
    assert.match(runner, /"029-concern-terminal-reserve", "030-agent-work"/u);
  }
});

test("ordinary append and rescheduling cannot consume terminal reserve", async () => {
  const h = harness(), original = h.fixture(200, "pending");
  for (const input of [
    { action: "append", expectedVersion: 10, authorityVersion, text: "New observation", observedAt: at, links: { recordId: null, taskId: null, attentionId: null } },
    { action: "schedule_followup", expectedVersion: 10, authorityVersion, followUpAt: "2099-01-01T00:00:00Z" },
  ] as ConcernChange[]) await assert.rejects(h.store.change(userId, childId, original.id, input, randomUUID()), capacityError);
  assert.equal(h.state.events.get(original.id)!.length, 200);
  assert.equal(h.state.rows.get(original.id)?.version, 10);
  assert.equal(h.state.follows.get(original.followUp!.id)?.state, "pending");
  assert.equal(h.state.operations.size, 0);
});

test("a due full concern stops without enqueueing and the next due item still queues", async () => {
  const h = harness(), full = h.fixture(200, "pending"), normal = h.fixture(10, "pending");
  await h.store.checkDue(generation, h.enqueue);
  assert.deepEqual(h.jobs.map(job => job.id), [normal.id]);
  const read = await h.store.get(userId, childId, full.id);
  assert.equal(read?.followUp?.state, "cancelled"); assert.equal(read?.events.length, 201);
  assert.equal(read?.events.at(-1)?.sourceLabel, "Server 站內跟進狀態");
  assert.ok(read);
  const ended = await h.store.change(userId, childId, full.id, archive(read), randomUUID());
  assert.equal(ended?.events.length, 202);
});

test("all follow-up reserve write paths still require migration and roll back safely", async () => {
  for (const action of ["cancel", "authorize", "settle"] as const) {
    const h = harness(), original = h.fixture(200, action === "cancel" ? "pending" : "queued");
    h.options.migration = false;
    if (action === "settle") {
      const runId = randomUUID();
      h.state.runs.set(original.followUp!.id, { id: runId, state: "completed", expires_at: new Date(at),
        result_encrypted: cipher.encrypt(JSON.stringify({ runId, status: "completed" }), "agent-run:" + childId + ":" + userId + ":" + runId) });
    }
    const before = structuredClone(h.state);
    await assert.rejects(action === "cancel" ? h.store.change(userId, childId, original.id, cancel(original), randomUUID())
      : action === "authorize" ? h.store.backgroundInput(h.job(original)) : h.store.finishBackground(h.job(original), null), capacityError);
    assert.deepEqual(h.state, before, action + " must roll back every persistent change");
  }
});

test("queued capacity input is cancelled before model authorization and a recorded result can settle once", async () => {
  const blocked = harness(), full = blocked.fixture(200, "queued"), oldJob = blocked.job(full);
  assert.equal(await blocked.store.backgroundInput(oldJob), null);
  assert.equal((await blocked.store.get(userId, childId, full.id))?.followUp?.state, "cancelled");
  assert.equal(await blocked.store.finishBackground(oldJob, null), "ignored");
  const h = harness(), original = h.fixture(200, "queued"), job = h.job(original), runId = randomUUID();
  h.state.runs.set(original.followUp!.id, { id: runId, state: "completed", expires_at: new Date(at),
    result_encrypted: cipher.encrypt(JSON.stringify({ runId, status: "completed" }), "agent-run:" + childId + ":" + userId + ":" + runId) });
  assert.equal(await h.store.finishBackground(job, null), "settled");
  const settled = await h.store.get(userId, childId, original.id);
  assert.ok(settled); assert.equal(settled.followUp?.state, "completed"); assert.equal(settled.events.length, 201);
  assert.equal(settled.events.at(-1)?.runId, runId);
  assert.equal(await h.store.finishBackground(job, null), "ignored");
  const ended = await h.store.change(userId, childId, original.id, archive(settled), randomUUID());
  assert.equal(ended?.events.length, 202);
});

test("capacity escape retains scope, authority and version checks", async () => {
  const otherChildId = randomUUID(), h = harness([childId, otherChildId]), original = h.fixture(200, "pending");
  const before = structuredClone(h.state);
  assert.equal(await h.store.change(userId, otherChildId, original.id, archive(original), randomUUID()), null);
  assert.ok(h.queries.some(sql => sql.startsWith("SELECT * FROM concerns WHERE id=")));
  assert.deepEqual(h.state, before);
  for (const input of [{ ...archive(original), expectedVersion: 9 }, { ...archive(original), authorityVersion: epoch + ":0" }]) {
    await assert.rejects(h.store.change(userId, childId, original.id, input, randomUUID()), error => error instanceof FamilyError && error.code === "concern_changed");
    assert.equal(h.state.events.get(original.id)!.length, 200); assert.equal(h.state.operations.size, 0);
    assert.deepEqual(h.state, before);
  }
  const ended = await h.store.change(userId, childId, original.id, archive(original), randomUUID());
  assert.ok(ended); assert.equal(ended.status, "closed"); assert.equal(ended.version, 11);
  assert.equal(ended.events.length, 202); assert.equal(ended.followUp?.state, "cancelled");
  assert.equal(h.state.operations.size, 1);
});

test("readers accept complete 202-event history and reject 203 events", async () => {
  const h = harness(), accepted = h.fixture(202, null, "closed");
  const read = await h.store.get(userId, childId, accepted.id); assert.equal(read?.events.length, 202);
  const api = createConcernsApi("https://synthetic.invalid", async () => Response.json({ page: { authorityVersion, canManage: true, items: [accepted] } }));
  assert.equal((await api.getPage(childId, new AbortController().signal, userId)).items[0].events.length, 202);
  const bad = h.fixture(203, null, "closed");
  await assert.rejects(h.store.get(userId, childId, bad.id), capacityError);
  const badApi = createConcernsApi("https://synthetic.invalid", async () => Response.json({ page: { authorityVersion, canManage: true, items: [bad] } }));
  await assert.rejects(badApi.getPage(childId, new AbortController().signal, userId), error => error instanceof ConcernApiError && error.readFailure?.category === "schema");
  assert.ok(h.queries.some(sql => sql.includes("ORDER BY sequence LIMIT $2")));
});
