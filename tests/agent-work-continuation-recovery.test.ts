import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { FinishReason } from "@google/genai";
import type { AgentWork, SaveAgentWork } from "../src/shared/agent-work.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import { createProductAgentStore } from "../server/product-agent-store.ts";
import { createAgentWorkContinuationStore, WORK_CONTINUATION_CHECK_QUEUE, WORK_CONTINUATION_QUEUE,
  type WorkContinuationJob } from "../server/agent-work-continuation.ts";
import { createAgentWorkContinuationWorker } from "../server/agent-work-continuation-worker.ts";
import { createProductAgent } from "../server/product-agent.ts";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import { readAiConfig } from "../server/ai-config.ts";
import { createAiUsageStore } from "../server/ai-usage.ts";
import { createMemoryStore } from "../server/memory.ts";
import { createTaskStore } from "../server/tasks.ts";
import { createChatStore } from "../server/chat.ts";
import { createKnowledgeStore } from "../server/knowledge-store.ts";
import { createKnowledgeRetriever } from "../server/knowledge-retriever.ts";
import { createEmbeddingGateway, createEmbeddingUsage } from "../server/embedding-gateway.ts";

// Real work/continuation/run stores, access checks, cipher, worker, ProductAgent and ADK.
// Only storage, scheduler, clock and the model provider are synthetic. Exact-query
// adapters fail on unknown SQL; this does not emulate PostgreSQL locking or Cloud Tasks.
function fixture() {
  const userId = "synthetic-followup-owner", childId = randomUUID(), workspaceId = randomUUID();
  const epoch = randomUUID(), generation = randomUUID(), cipher = createStorageCipher(Buffer.alloc(32, 71));
  let state: any = { space: { owner_user_id: userId, access_version: "1", storage_epoch: epoch, change_seq: "1" },
    control: { enabled: true, generation }, messages: [], works: [], operations: [], followups: [], events: [], links: [],
    runs: [], changes: [], jobs: [], counters: {}, attempts: [] };
  let transaction: any = null, modelCalls = 0;
  const contexts: any[] = [], queries: string[] = [];
  const handlers = new Map<string, (jobs: any[]) => Promise<void>>(), schedules: any[] = [];
  const result = (rows: any[] = []) => ({ rows: structuredClone(rows), rowCount: rows.length });
  const backgroundRun = (eventId: string) => state.runs.find((r: any) => r.owner_user_id === userId
    && r.child_id === childId && r.trigger_kind === "worker" && r.trigger_reference === eventId);
  const currentLink = (link: any) => {
    const w = state.works.find((w: any) => w.id === link.work_id), f = state.followups.find((f: any) => f.work_id === link.work_id);
    return w && f && w.version === link.work_version && f.work_version === link.work_version
      && f.enabled && ["active", "waiting"].includes(w.status);
  };
  async function query(raw: string, p: any[] = []): Promise<any> {
    const sql = raw.replace(/\s+/g, " ").trim(); queries.push(sql);
    if (sql === "BEGIN") { assert.equal(transaction, null); transaction = structuredClone(state); return result(); }
    if (sql === "COMMIT") { assert.ok(transaction); transaction = null; return result(); }
    if (sql === "ROLLBACK") { assert.ok(transaction); state = transaction; transaction = null; return result(); }
    if (sql.startsWith("SET LOCAL") || sql === "SELECT pg_advisory_xact_lock(173061, 6)") return result();
    if (sql === "SELECT workspace_id FROM children WHERE id=$1") return result(p[0] === childId ? [{ workspace_id: workspaceId }] : []);
    if (sql === "SELECT 1 FROM children WHERE id=$1 AND workspace_id=$2") return result(p[0] === childId && p[1] === workspaceId ? [{}] : []);
    if (sql.startsWith("SELECT owner_user_id, access_version FROM workspaces")
      || sql.startsWith("SELECT owner_user_id,access_version::text,storage_epoch FROM workspaces")
      || sql.startsWith("SELECT access_version::text,storage_epoch")) return result(p[0] === workspaceId ? [state.space] : []);
    if (sql.startsWith("SELECT enabled,generation FROM worker_control WHERE id=1")) return result([state.control]);
    if (sql === "SELECT 1 FROM app_migrations WHERE id='033-agent-work-continuation'") return result([{}]);
    if (sql.startsWith("SELECT 1 FROM chat_messages")) {
      const ownerFirst = sql.includes("owner_user_id=$2");
      const row = state.messages.find((m: any) => m.id === p[0] && m.child_id === p[ownerFirst ? 2 : 1]
        && m.owner_user_id === p[ownerFirst ? 1 : 2]);
      if (!row || sql.includes("role='user'") && row.role !== "user"
        || sql.includes("author_user_id=$3") && row.author_user_id !== p[2]) return result();
      if (sql.includes("(created_at,id)")) {
        const cutoff = state.messages.find((m: any) => m.id === p[3] && m.child_id === p[1] && m.owner_user_id === p[2]);
        if (!cutoff || row.created_at > cutoff.created_at || +row.created_at === +cutoff.created_at && row.id > cutoff.id) return result();
      }
      return result([{}]);
    }
    if (sql.startsWith("SELECT source_message_id,authorization_version::text,data_version FROM agent_runs"))
      return result(state.runs.filter((r: any) => r.id === p[0] && r.owner_user_id === p[1] && r.child_id === p[2]
        && r.trigger_kind === "interactive" && r.state === "running" && r.expires_at.getTime() > Date.now()));
    if (sql.startsWith("INSERT INTO agent_runs(")) {
      if (state.runs.some((r: any) => r.owner_user_id === p[2] && r.child_id === p[1] && r.trigger_kind === p[3] && r.trigger_reference === p[4])) return result();
      const row = { id: p[0], child_id: p[1], owner_user_id: p[2], trigger_kind: p[3], trigger_reference: p[4], source_message_id: p[5],
        authorization_version: p[6], data_version: p[7], recipe_id: p[8], state: "running", stop_reason: null,
        result_encrypted: null, created_at: new Date(), expires_at: new Date(Date.now() + 90_000) };
      state.runs.push(row); return result([row]);
    }
    if (sql.startsWith("SELECT * FROM agent_runs WHERE owner_user_id=$1")) return result(state.runs.filter((r: any) =>
      r.owner_user_id === p[0] && r.child_id === p[1] && r.trigger_kind === p[2] && r.trigger_reference === p[3]));
    if (sql.startsWith("SELECT * FROM agent_runs WHERE id=$1")) {
      const live = sql.includes("state='running'");
      return result(state.runs.filter((r: any) => r.id === p[0] && r.owner_user_id === p[live ? 2 : 1]
        && r.child_id === p[live ? 1 : 2] && (!live || r.state === "running" && r.expires_at.getTime() > Date.now())));
    }
    if (sql.startsWith("SELECT id,state,expires_at,result_encrypted FROM agent_runs") || sql.startsWith("SELECT id FROM agent_runs WHERE owner_user_id=$1"))
      return result(state.runs.filter((r: any) => r.owner_user_id === p[0] && r.child_id === p[1] && r.trigger_kind === "worker" && r.trigger_reference === p[2]));
    if (sql.startsWith("UPDATE agent_runs SET state='unknown'")) {
      const row = state.runs.find((r: any) => r.id === p[0] && r.state === "running"
        && (!sql.includes("expires_at<=clock_timestamp()") || r.expires_at.getTime() <= Date.now()));
      if (row) { row.state = "unknown"; row.stop_reason = "interrupted"; }
      return result(row ? [{ id: row.id }] : []);
    }
    if (sql === "UPDATE agent_runs SET data_version=$2 WHERE id=$1") {
      state.runs.find((r: any) => r.id === p[0]).data_version = p[1]; return result();
    }
    if (sql.startsWith("UPDATE agent_runs SET state=$2,stop_reason=$3,result_encrypted=$4")) {
      Object.assign(state.runs.find((r: any) => r.id === p[0]), { state: p[1], stop_reason: p[2], result_encrypted: p[3] }); return result();
    }
    if (sql.startsWith("SELECT * FROM agent_proposals WHERE run_id=$1") || sql.startsWith("UPDATE agent_proposals SET state='expired'")
      || sql.startsWith("SELECT a.op_id,a.tool_name,a.child_id,o.child_id AS receipt_child_id")) return result();
    if (sql.startsWith("SELECT operation_id,payload_encrypted FROM agent_work_operations")) return result(state.operations.filter((r: any) =>
      r.owner_user_id === p[0] && r.child_id === p[1] && (r.operation_id === p[2] || r.run_id === p[3] && r.call_id === p[4])));
    if (sql.startsWith("SELECT * FROM agent_work WHERE id=$1")) {
      const ownerFirst = sql.includes("owner_user_id=$2");
      return result(state.works.filter((r: any) => r.id === p[0] && r.owner_user_id === p[ownerFirst ? 1 : 2] && r.child_id === p[ownerFirst ? 2 : 1]));
    }
    if (sql.startsWith("INSERT INTO agent_work(")) {
      const row = { id: p[0], child_id: p[1], owner_user_id: p[2], version: p[3], status: p[4], payload_encrypted: p[5], created_at: new Date(), updated_at: new Date() };
      state.works.push(row); return result([row]);
    }
    if (sql.startsWith("UPDATE agent_work SET version=$2")) {
      const row = state.works.find((r: any) => r.id === p[0]); Object.assign(row, { version: p[1], status: p[2], payload_encrypted: p[3], updated_at: new Date() }); return result([row]);
    }
    if (sql.startsWith("INSERT INTO agent_work_operations")) {
      state.operations.push({ owner_user_id: p[0], child_id: p[1], operation_id: p[2], run_id: p[3], call_id: p[4], work_id: p[5], payload_encrypted: p[6] }); return result();
    }
    if (sql.startsWith("UPDATE agent_confirmations SET state='invalidated'")) return result();
    if (sql.startsWith("INSERT INTO agent_work_followups(")) {
      const old = state.followups.find((f: any) => f.work_id === p[0]);
      const row = { work_id: p[0], child_id: p[1], owner_user_id: p[2], workspace_id: p[3], work_version: p[4], authorization_version: p[5],
        storage_epoch: p[6], enabled: p[7], watch_resources: p[8], knowledge_source_ids: p[9], due_at: p[10] ? new Date(p[10]) : null,
        due_consumed: false, next_check_at: p[11] ? new Date(p[11]) : null, baseline_encrypted: p[12] };
      if (old) Object.assign(old, row); else state.followups.push(row); return result();
    }
    if (sql.startsWith("SELECT *,authorization_version::text FROM agent_work_followups WHERE work_id=$1")) return result(state.followups.filter((f: any) => f.work_id === p[0]));
    if (sql.startsWith("UPDATE agent_work_continuations e SET state='cancelled'")) {
      for (const event of state.events.filter((e: any) => e.state === "queued" && e.owner_user_id === p[0] && e.child_id === p[1])) {
        const links = state.links.filter((l: any) => l.event_id === event.id);
        if (links.some((l: any) => l.work_id === p[2]) && !links.some(currentLink)) {
          event.state = "cancelled"; event.run_id ??= backgroundRun(event.id)?.id ?? null;
        }
      }
      return result();
    }
    if (sql.startsWith("SELECT f.work_id,f.owner_user_id,f.child_id,f.workspace_id FROM agent_work_followups f")) return result(state.control.enabled && state.control.generation === p[0]
      ? state.followups.filter((f: any) => f.enabled && f.next_check_at && f.next_check_at.getTime() <= Date.now())
        .sort((a: any, b: any) => +a.next_check_at - +b.next_check_at || a.work_id.localeCompare(b.work_id)).slice(0, 10) : []);
    if (sql === "SELECT (now() AT TIME ZONE 'Asia/Hong_Kong')::date::text AS day") return result([{ day: new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10) }]);
    if (sql.startsWith("SELECT 1 FROM agent_work_continuations WHERE owner_user_id=$1")) return result(state.events.filter((e: any) => e.owner_user_id === p[0] && e.child_id === p[1] && e.local_day === p[2]).map(() => ({})));
    if (sql.startsWith("INSERT INTO agent_work_continuations(")) {
      state.events.push({ id: p[0], child_id: p[1], owner_user_id: p[2], workspace_id: p[3], local_day: p[4], authorization_version: p[5],
        storage_epoch: p[6], worker_generation: p[7], job_id: p[8], state: "queued", payload_encrypted: p[9], run_id: null, created_at: new Date() }); return result();
    }
    if (sql.startsWith("INSERT INTO agent_work_continuation_works(")) { state.links.push({ event_id: p[0], work_id: p[1], work_version: p[2] }); return result(); }
    if (sql.startsWith("UPDATE agent_work_followups SET baseline_encrypted=$2")) {
      const f = state.followups.find((f: any) => f.work_id === p[0] && f.work_version === p[4]);
      if (f) Object.assign(f, { baseline_encrypted: p[1], due_consumed: p[2], next_check_at: p[3] }); return result();
    }
    if (sql.startsWith("UPDATE agent_work_followups SET enabled=false")) {
      const f = state.followups.find((f: any) => f.work_id === p[0]); if (f) Object.assign(f, { enabled: false, next_check_at: null }); return result();
    }
    if (sql.startsWith("UPDATE agent_work_followups f SET next_check_at=LEAST")) {
      for (const f of state.followups.filter((f: any) => f.workspace_id === p[0] && f.child_id === p[1] && f.enabled && f.watch_resources
        && (p[2] === null || f.owner_user_id === p[2]) && (!p[3] || f.owner_user_id === state.space.owner_user_id)))
        f.next_check_at = new Date(Math.min(f.next_check_at?.getTime() ?? Date.now(), Date.now()));
      return result();
    }
    if (sql.startsWith("SELECT workspace_id FROM agent_work_continuations WHERE id=$1")) return result(state.events.filter((e: any) => e.id === p[0]).map((e: any) => ({ workspace_id: e.workspace_id })));
    if (sql.startsWith("SELECT *,authorization_version::text FROM agent_work_continuations WHERE id=$1")) return result(state.events.filter((e: any) => e.id === p[0]));
    if (sql.startsWith("UPDATE agent_work_continuations SET state='cancelled'")) {
      const e = state.events.find((e: any) => e.id === p[0] && e.state === "queued"); if (e) { e.state = "cancelled"; e.run_id = p[1] ?? e.run_id; } return result();
    }
    if (sql.startsWith("UPDATE agent_work_continuations SET run_id=$2")) {
      const e = state.events.find((e: any) => e.id === p[0] && e.state === "queued"); if (e) e.run_id = p[1]; return result();
    }
    if (sql.startsWith("UPDATE agent_work_continuations SET state=$2,run_id=$3")) {
      const e = state.events.find((e: any) => e.id === p[0] && e.state === "queued"); if (e) { e.state = p[1]; e.run_id = p[2]; } return result();
    }
    if (sql.startsWith('SELECT e.id AS "eventId",e.job_id AS "jobId"')) return result(!state.control.enabled || state.control.generation !== p[0] ? [] : state.events
      .filter((e: any) => { const j = state.jobs.find((j: any) => j.id === e.job_id && j.name === p[1]);
        return e.state === "queued" && (e.worker_generation !== p[0] || !j || ["completed", "failed", "cancelled"].includes(j.state)); })
      .slice(0, 10).map((e: any) => ({ eventId: e.id, jobId: e.job_id, workerGeneration: e.worker_generation, storageEpoch: e.storage_epoch })));
    if (sql.startsWith("SELECT DISTINCT ON (l.work_id)")) {
      const values = p[0].flatMap((id: string) => {
        const links = state.links.filter((l: any) => l.work_id === id).map((l: any) => ({ link: l, event: state.events.find((e: any) => e.id === l.event_id) }))
          .filter(({ event }: any) => event.owner_user_id === p[1] && event.child_id === p[2]).sort((a: any, b: any) => +b.event.created_at - +a.event.created_at || b.event.id.localeCompare(a.event.id));
        if (!links.length) return [];
        const { event, link } = links[0]; return [{ work_id: id, id: event.id, run_id: event.run_id, created_at: event.created_at,
          state: event.state === "queued" && !currentLink(link) ? "cancelled" : event.state }];
      }); return result(values);
    }
    if (sql.startsWith("UPDATE workspaces SET change_seq=change_seq+1")) { state.space.change_seq = String(Number(state.space.change_seq) + 1); return result([{ change_seq: state.space.change_seq }]); }
    if (sql.startsWith("INSERT INTO online_changes(")) { state.changes.push(p); return result(); }
    if (sql.startsWith("INSERT INTO ai_daily_usage")) { for (const key of p[0]) state.counters[key] ??= 0; return result(); }
    if (sql.startsWith("SELECT scope_key, attempts FROM ai_daily_usage")) return result(p[0].map((key: string) => ({ scope_key: key, attempts: state.counters[key] })));
    if (sql.startsWith("UPDATE ai_daily_usage SET attempts = attempts + 1")) { for (const key of p[0]) state.counters[key]++; return result(); }
    if (sql.startsWith("INSERT INTO ai_attempts")) { state.attempts.push(p); return result(); }
    throw new Error("Unhandled synthetic query: " + sql);
  }
  const pool = { query, connect: async () => ({ query, release() { assert.equal(transaction, null); } }) } as unknown as Pool;
  const boss = {
    async getQueue(name: string) { return { name }; }, async getSchedules() { return schedules; },
    async schedule(name: string, cron: string, data: any, options: any) { schedules.push({ name, cron, data, ...options }); },
    async unschedule() { schedules.length = 0; },
    async work(name: string, _options: any, handler: (jobs: any[]) => Promise<void>) { handlers.set(name, handler); },
    async send(name: string, data: WorkContinuationJob, options: any) {
      assert.ok(transaction, "The queue write shares the work transaction"); assert.equal(typeof options.db.executeSql, "function");
      assert.equal(options.id, data.jobId); state.jobs.push({ id: options.id, name, data: structuredClone(data), state: "created" }); return options.id;
    },
  } as unknown as PgBoss;
  const create = () => {
    const store = createProductAgentStore(pool, cipher), continuation = createAgentWorkContinuationStore(pool, cipher);
    const config = readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" });
    const runtime = createAgentRuntime({ config, usage: createAiUsageStore(pool), provider: { generate: async request => {
      assert.equal(transaction, null, "No database transaction survives into generation"); modelCalls++;
      const body = JSON.stringify(request.contents); contexts.push(body);
      for (const name of ["save_work", "request_confirmation", "contact_caregiver", "generate_family_document"])
        assert.equal(Object.hasOwn(request.toolsDict, name), false);
      return { content: { role: "model", parts: [{ functionCall: { id: "synthetic-answer", name: "present_answer",
        args: { kind: "clarification", paragraphs: [{ text: "請核對這項合成工作接下來需要的資料。", citationIds: [] }] } } }] }, finishReason: FinishReason.STOP };
    } } });
    const knowledge = createKnowledgeRetriever(createKnowledgeStore(pool), createEmbeddingGateway({ config, usage: createEmbeddingUsage(pool) }));
    const agent = createProductAgent({ runtime, store, knowledge, memory: createMemoryStore(pool, cipher), tasks: createTaskStore(pool, cipher), chat: createChatStore(pool, cipher) });
    return { store, continuation, agent, worker: createAgentWorkContinuationWorker(pool, boss, continuation, agent) };
  };
  const scope = () => ({ userId, childId, workspaceId, authorizationVersion: "1", dataVersion: epoch + ":" + state.space.change_seq });
  async function save(status: AgentWork["status"] = "waiting", old?: AgentWork) {
    const message = { id: randomUUID(), child_id: childId, owner_user_id: userId, author_user_id: userId, role: "user", created_at: new Date(Date.now() + state.messages.length) };
    state.messages.push(message);
    const { store } = create(), claim = await store.claim(userId, childId, { kind: "interactive", reference: message.id }, "product-interactive"); assert.ok(claim);
    const input: SaveAgentWork = { operationId: randomUUID(), workId: old?.id ?? null, expectedVersion: old?.version ?? 0,
      values: { goal: "Synthetic scheduled follow-up " + message.id, focus: "Await synthetic user information", sourceMessageIds: [message.id], resources: [], questions: [], pending: [], status,
        followUp: status === "cancelled" ? null : { reason: "Explicit synthetic due-date follow-up", dueAt: new Date(Date.now() + 60_000).toISOString(), watchResources: false, knowledgeSourceIds: [] } } };
    const work = await store.saveWork(scope(), claim.runId, randomUUID(), input); assert.ok(work); return work;
  }
  const due = async () => { const handler = handlers.get(WORK_CONTINUATION_CHECK_QUEUE); assert.ok(handler); await handler([{ data: { generation } }]); };
  const deliver = async (job: any) => { const handler = handlers.get(WORK_CONTINUATION_QUEUE); assert.ok(handler); await handler([{ id: job.id, data: job.data }]); };
  return { create, save, due, deliver, scope, userId, childId, generation, contexts, queries, get state() { return state; }, get modelCalls() { return modelCalls; } };
}

const NOW = Date.parse("2026-10-10T02:00:00.000Z");

test("authorized due work cancelled before delivery remains inert across worker restart and stale redelivery", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW }); const h = fixture();
  const first = h.create(); await first.worker.start(); t.after(() => first.worker.stop());
  const work = await h.save(); t.mock.timers.tick(60_000); await h.due();
  assert.equal(h.state.events.length, 1); assert.equal(h.state.jobs.length, 1);
  const job = structuredClone(h.state.jobs[0]);
  assert.ok(await first.continuation.backgroundInput(job.data), "The original event was eligible before cancellation");
  const cancelled = await h.save("cancelled", work);
  assert.equal(h.state.events[0].state, "cancelled"); assert.equal(h.state.followups[0].enabled, false);
  await first.worker.stop(); const restarted = h.create(); await restarted.worker.start(); t.after(() => restarted.worker.stop());
  await h.deliver(job); await h.deliver(job); await restarted.continuation.reconcile(h.generation);
  t.mock.timers.tick(86400_000); await h.due();
  assert.equal(h.modelCalls, 0); assert.equal(h.state.runs.filter((r: any) => r.trigger_kind === "worker").length, 0);
  assert.equal(h.state.events.length, 1); assert.equal(h.state.jobs.length, 1);
  const read = await restarted.store.readWork(h.userId, h.childId, { workId: work.id, cursor: null });
  assert.equal(read?.items[0].version, cancelled.version); assert.equal(read?.items[0].status, "cancelled");
  assert.equal(read?.items[0].latestFollowUp?.state, "cancelled");
});

test("a merged event drops its cancelled work and runs only its remaining live constituent once", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW }); const h = fixture(), first = h.create();
  await first.worker.start(); t.after(() => first.worker.stop());
  const cancelledWork = await h.save(), liveWork = await h.save();
  t.mock.timers.tick(60_000); await h.due(); assert.equal(h.state.events.length, 1); assert.equal(h.state.links.length, 2);
  const job = structuredClone(h.state.jobs[0]); await h.save("cancelled", cancelledWork);
  assert.equal(h.state.events[0].state, "queued");
  const input = await first.continuation.backgroundInput(job.data); assert.ok(input);
  assert.deepEqual(input.context.works.map((entry: any) => entry.work.id), [liveWork.id]);
  await h.deliver(job); await h.deliver(job);
  assert.equal(h.modelCalls, 1); assert.equal(h.state.events[0].state, "completed");
  assert.equal(h.state.runs.filter((r: any) => r.trigger_kind === "worker").length, 1);
  assert.ok(h.contexts[0].includes(liveWork.id)); assert.ok(!h.contexts[0].includes(cancelledWork.id));
  const run = h.state.runs.find((r: any) => r.trigger_kind === "worker");
  const result = await first.store.get(h.userId, h.childId, run.id);
  assert.equal(result?.status, "completed"); assert.equal(result?.counts.modelCalls, 1);
  assert.equal(result?.text, "請核對這項合成工作接下來需要的資料。");
});

test("restart recovers the original completed receipt or expired unknown run without another generation", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  for (const outcome of ["completed", "unknown"] as const) {
    const h = fixture(), original = h.create(); await original.worker.start(); t.after(() => original.worker.stop());
    const work = await h.save(); t.mock.timers.tick(60_000); await h.due(); const job = structuredClone(h.state.jobs[0]);
    const input = await original.continuation.backgroundInput(job.data); assert.ok(input);
    let runId: string, saved: unknown;
    if (outcome === "completed") {
      // Model result is committed, but the process ends before event acknowledgement.
      saved = await original.agent.background({ ...input, reference: job.data.eventId, authorize: async () => Boolean(await original.continuation.backgroundInput(job.data)) });
      assert.equal((saved as any)?.status, "completed"); runId = (saved as any).runId;
    } else {
      // Durable claim exists after interruption; its expired outcome is unknown, never a new run.
      const claim = await original.store.claim(h.userId, h.childId, { kind: "worker", reference: job.data.eventId }, "product-work-followup"); assert.ok(claim);
      runId = claim.runId; t.mock.timers.tick(90_001);
    }
    assert.equal(h.state.events[0].state, "queued"); const beforeCalls = h.modelCalls;
    await original.worker.stop();
    if (outcome === "completed") h.state.jobs[0].state = "completed"; // Native queue no longer offers an active handler.
    const restarted = h.create(); await restarted.worker.start(); t.after(() => restarted.worker.stop());
    await h.deliver(job); await h.deliver(job); await restarted.continuation.reconcile(h.generation);
    assert.equal(h.modelCalls, beforeCalls); assert.equal(h.state.events.length, 1);
    assert.equal(h.state.runs.filter((r: any) => r.trigger_kind === "worker").length, 1);
    assert.equal(h.state.events[0].state, outcome); assert.equal(h.state.events[0].run_id, runId);
    const read = await restarted.store.get(h.userId, h.childId, runId); assert.equal(read?.runId, runId); assert.equal(read?.status, outcome);
    if (outcome === "completed") assert.deepEqual(read, saved);
    else { assert.equal(read?.countsKnown, false); assert.equal(read?.stopReason, "interrupted"); assert.equal(h.modelCalls, 0); }
    const latest = await restarted.store.readWork(h.userId, h.childId, { workId: work.id, cursor: null });
    assert.equal(latest?.items[0].latestFollowUp?.runId, runId); assert.equal(latest?.items[0].latestFollowUp?.state, outcome);
  }
});
