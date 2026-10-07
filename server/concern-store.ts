import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import { concernChangeSchema, concernValuesSchema, type Concern, type ConcernChange, type ConcernEvent, type ConcernPage, type ConcernValues } from "../src/shared/concerns.ts";
import type { ProductAgentResult } from "../src/shared/product-agent.ts";
import { FamilyError, READ_ROLES, WRITE_ROLES, withChildAccess } from "./family-access.ts";
import type { StorageCipher } from "./storage-crypto.ts";
import { canonicalJson } from "./online-routing.ts";
import { appendOnlineChange } from "./online-change.ts";
import { CONCERN_AGENT_QUEUE } from "./concern-events.ts";

interface Row { id: string; child_id: string; created_by: string; version: number; payload_encrypted: string; follow_up_id: string | null }
interface FollowUpRow {
  id: string; concern_id: string; child_id: string; actor_user_id: string; concern_version: number; due_at: Date;
  state: NonNullable<Concern["followUp"]>["state"]; storage_epoch: string; authorization_version: string;
  worker_generation: string | null; job_id: string | null; run_id: string | null;
}
type Stored = Omit<Concern, "events" | "historyComplete" | "followUp">;
export interface ConcernWorkerScope { workerGeneration: string; storageEpoch: string }
export interface ConcernJob extends ConcernWorkerScope { childId: string; id: string; followUpId: string; version: number; jobId: string }
export type ConcernEnqueue = (client: PoolClient, job: ConcernJob) => Promise<void>;
const missing = () => new FamilyError(404, "not_found");
const conflict = () => new FamilyError(409, "concern_changed");
const context = (row: Pick<Row, "child_id" | "id" | "created_by">) => `concern:${row.child_id}:${row.id}:${row.created_by}`;
const receiptContext = (userId: string, childId: string, opId: string, field: string) => `concern-operation:${userId}:${childId}:${opId}:${field}`;
const MAX_CONCERNS = 200, MAX_EVENTS = 200;

/** Shared concern authority. It never promotes private conversation or mutates a linked task. */
export function createConcernStore(pool: Pool, cipher: StorageCipher) {
  const access = <T>(userId: string, childId: string, write: boolean, action: (client: PoolClient, workspaceId: string, canManage: boolean) => Promise<T>) =>
    withChildAccess(pool, userId, childId, write ? WRITE_ROLES : READ_ROLES,
      (client, role, workspaceId) => action(client, workspaceId, WRITE_ROLES.includes(role)), write);
  async function authority(client: PoolClient, workspaceId: string) {
    const row = (await client.query<{ storage_epoch: string; access_version: string }>(
      "SELECT storage_epoch,access_version::text FROM workspaces WHERE id=$1", [workspaceId])).rows[0];
    return { epoch: row.storage_epoch, authorization: row.access_version, version: row.storage_epoch + ":" + row.access_version };
  }
  async function followup(client: PoolClient, id: string | null) {
    return id ? (await client.query<FollowUpRow>("SELECT *,authorization_version::text FROM concern_followups WHERE id=$1", [id])).rows[0] : undefined;
  }
  const decodeHeader = (row: Row): Stored => JSON.parse(cipher.decrypt(row.payload_encrypted, context(row) + ":" + row.version));
  const decodeEvent = (row: Row, event: { id: string; actor_user_id: string; payload_encrypted: string }): ConcernEvent =>
    JSON.parse(cipher.decrypt(event.payload_encrypted, context(row) + ":event:" + event.id + ":" + event.actor_user_id));
  async function decode(client: PoolClient, row: Row): Promise<Concern> {
    const value = decodeHeader(row);
    const events = (await client.query<{ id: string; actor_user_id: string; payload_encrypted: string }>(
      "SELECT id,actor_user_id,payload_encrypted FROM concern_events WHERE concern_id=$1 ORDER BY sequence LIMIT 201", [row.id])).rows;
    if (events.length > MAX_EVENTS) throw new FamilyError(400, "concern_history_requires_review");
    const scheduled = await followup(client, row.follow_up_id);
    return { ...value, events: events.map(event => decodeEvent(row, event)), historyComplete: true,
      followUp: scheduled ? { id: scheduled.id, at: scheduled.due_at.toISOString(), state: scheduled.state, runId: scheduled.run_id } : null };
  }
  async function find(client: PoolClient, childId: string, id: string) {
    const row = (await client.query<Row>("SELECT * FROM concerns WHERE id=$1 AND child_id=$2", [id, childId])).rows[0];
    return row ? { row, item: await decode(client, row) } : null;
  }
  async function save(client: PoolClient, workspaceId: string, row: Row, item: Concern, insert = false, event?: ConcernEvent) {
    const { events: _events, historyComplete: _complete, followUp: scheduled, ...value } = item;
    const payload = cipher.encrypt(JSON.stringify(value), context(row) + ":" + item.version);
    if (insert) await client.query("INSERT INTO concerns(id,child_id,created_by,version,status,payload_encrypted,follow_up_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [item.id, item.childId, row.created_by, item.version, item.status, payload, scheduled?.id ?? null, item.createdAt, item.updatedAt]);
    else await client.query("UPDATE concerns SET version=$2,status=$3,payload_encrypted=$4,follow_up_id=$5,updated_at=$6 WHERE id=$1",
      [item.id, item.version, item.status, payload, scheduled?.id ?? null, item.updatedAt]);
    if (event) {
      if (item.events.length > MAX_EVENTS) throw new FamilyError(400, "concern_history_requires_review");
      await client.query("INSERT INTO concern_events(id,concern_id,sequence,actor_user_id,payload_encrypted) VALUES($1,$2,$3,$4,$5)",
        [event.id, item.id, item.events.length, event.actorUserId,
          cipher.encrypt(JSON.stringify(event), context(row) + ":event:" + event.id + ":" + event.actorUserId)]);
    }
    await client.query("INSERT INTO concern_revisions(concern_id,version,payload_encrypted) VALUES($1,$2,$3)",
      [item.id, item.version, cipher.encrypt(JSON.stringify(item), context(row) + ":revision:" + item.version)]);
    await appendOnlineChange(client, workspaceId, "growth", item.childId);
  }
  async function links(client: PoolClient, childId: string, input: ConcernValues["links"]) {
    if (input.recordId && !(await client.query("SELECT 1 FROM text_records WHERE id=$1 AND child_id=$2", [input.recordId, childId])).rowCount) throw missing();
    if (input.taskId && !(await client.query("SELECT 1 FROM care_tasks WHERE id=$1 AND child_id=$2", [input.taskId, childId])).rowCount) throw missing();
    const attention = input.attentionId ? (await client.query<{ version: number }>(
      "SELECT version FROM growth_attention WHERE id=$1 AND child_id=$2", [input.attentionId, childId])).rows[0] : undefined;
    if (input.attentionId && !attention) throw missing();
    return { ...(input.recordId ? { recordId: input.recordId } : {}), ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.attentionId ? { attentionId: input.attentionId, attentionVersion: attention!.version } : {}) };
  }
  function future(at: string | null) {
    if (at !== null && (Date.parse(at) <= Date.now() || Date.parse(at) >= Date.UTC(2101, 0, 1))) throw new FamilyError(400, "invalid_input");
  }
  async function receipt(client: PoolClient, workspaceId: string, userId: string, childId: string, opId: string,
    request: unknown, operation: () => Promise<Concern>): Promise<Concern> {
    z.uuid().parse(opId);
    // This lock also serializes an opId accidentally reused across child workspaces.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,178108))", [userId + ":" + opId]);
    const current = await authority(client, workspaceId);
    const hash = createHash("sha256").update(canonicalJson(request)).digest("hex");
    const prior = (await client.query<{ child_id: string; storage_epoch: string; request_hash_encrypted: string; result_encrypted: string }>(
      "SELECT * FROM concern_operations WHERE user_id=$1 AND op_id=$2", [userId, opId])).rows[0];
    if (prior) {
      if (prior.child_id !== childId || prior.storage_epoch !== current.epoch) throw new FamilyError(409, "operation_mismatch");
      if (cipher.decrypt(prior.request_hash_encrypted, receiptContext(userId, childId, opId, "hash")) !== hash) throw new FamilyError(409, "operation_mismatch");
      return JSON.parse(cipher.decrypt(prior.result_encrypted, receiptContext(userId, childId, opId, "result"))) as Concern;
    }
    const item = await operation();
    await client.query("INSERT INTO concern_operations(user_id,op_id,child_id,storage_epoch,request_hash_encrypted,result_encrypted) VALUES($1,$2,$3,$4,$5,$6)",
      [userId, opId, childId, current.epoch, cipher.encrypt(hash, receiptContext(userId, childId, opId, "hash")),
        cipher.encrypt(JSON.stringify(item), receiptContext(userId, childId, opId, "result"))]);
    return item;
  }
  async function schedule(client: PoolClient, workspaceId: string, userId: string, item: Concern, at: string) {
    const current = await authority(client, workspaceId), id = randomUUID();
    await client.query("INSERT INTO concern_followups(id,concern_id,child_id,actor_user_id,concern_version,due_at,state,storage_epoch,authorization_version) VALUES($1,$2,$3,$4,$5,$6,'pending',$7,$8)",
      [id, item.id, item.childId, userId, item.version, at, current.epoch, current.authorization]);
    item.followUp = { id, at, state: "pending", runId: null };
  }
  async function cancel(client: PoolClient, item: Concern) {
    if (item.followUp && ["pending", "queued"].includes(item.followUp.state)) {
      await client.query("UPDATE concern_followups SET state='cancelled',updated_at=now() WHERE id=$1 AND state IN ('pending','queued')", [item.followUp.id]);
      item.followUp = { ...item.followUp, state: "cancelled" };
    }
  }
  function event(userId: string, at: string, kind: ConcernEvent["kind"], title: string, text: string, references: Partial<ConcernEvent> = {}): ConcernEvent {
    return { id: randomUUID(), at, kind, title, text, sourceLabel: "家庭共享關注", actorUserId: userId, ...references };
  }
  async function controlled(client: PoolClient, workspaceId: string, scope: ConcernWorkerScope) {
    const row = (await client.query<{ enabled: boolean; generation: string; storage_epoch: string }>(
      "SELECT c.enabled,c.generation,w.storage_epoch FROM worker_control c CROSS JOIN workspaces w WHERE c.id=1 AND w.id=$1 FOR SHARE OF c", [workspaceId])).rows[0];
    return Boolean(row?.enabled && row.generation === scope.workerGeneration && row.storage_epoch === scope.storageEpoch);
  }
  async function actorAllowed(client: PoolClient, workspaceId: string, scheduled: FollowUpRow) {
    const current = await authority(client, workspaceId);
    return current.epoch === scheduled.storage_epoch && current.authorization === scheduled.authorization_version
      && Boolean((await client.query("SELECT 1 FROM workspaces WHERE id=$1 AND (owner_user_id=$2 OR EXISTS(SELECT 1 FROM family_members WHERE workspace_id=$1 AND user_id=$2 AND role='caregiver'))",
        [workspaceId, scheduled.actor_user_id])).rowCount);
  }
  async function workerAccess<T>(job: Pick<ConcernJob, "childId" | "id">, operation: (client: PoolClient, workspaceId: string, row: Row, item: Concern, scheduled: FollowUpRow) => Promise<T>) {
    const owner = (await pool.query<{ owner_user_id: string }>("SELECT w.owner_user_id FROM children c JOIN workspaces w ON w.id=c.workspace_id WHERE c.id=$1", [job.childId])).rows[0];
    if (!owner) return null;
    return access(owner.owner_user_id, job.childId, true, async (client, workspaceId) => {
      const found = await find(client, job.childId, job.id);
      if (!found) return null;
      const scheduled = await followup(client, found.row.follow_up_id);
      return scheduled ? operation(client, workspaceId, found.row, found.item, scheduled) : null;
    });
  }
  async function stopCurrent(client: PoolClient, workspaceId: string, row: Row, item: Concern, state: "cancelled" | "unknown", runId: string | null = null) {
    await client.query("UPDATE concern_followups SET state=$2,run_id=COALESCE($3,run_id),updated_at=now() WHERE id=$1 AND state IN ('pending','queued')", [item.followUp!.id, state, runId]);
    item.followUp = { ...item.followUp!, state, runId: runId ?? item.followUp!.runId };
    item.version++; item.updatedAt = new Date().toISOString();
    await save(client, workspaceId, row, item);
  }
  async function settle(client: PoolClient, workspaceId: string, row: Row, item: Concern, scheduled: FollowUpRow, reported: ProductAgentResult | null, terminalJob = false) {
    const run = (await client.query<{ id: string; state: string; expires_at: Date; result_encrypted: string | null }>(
      "SELECT id,state,expires_at,result_encrypted FROM agent_runs WHERE owner_user_id=$1 AND child_id=$2 AND trigger_kind='worker' AND trigger_reference=$3",
      [scheduled.actor_user_id, item.childId, scheduled.id])).rows[0];
    if (!terminalJob && run?.state === "running" && run.expires_at.getTime() > Date.now()) return "running" as const;
    if (reported && reported.runId !== run?.id) throw new Error("concern_receipt_mismatch");
    const receipt = run?.result_encrypted ? JSON.parse(cipher.decrypt(run.result_encrypted, `agent-run:${item.childId}:${scheduled.actor_user_id}:${run.id}`)) as ProductAgentResult : null;
    const state = run?.state === "completed" && receipt ? "completed" : run?.state === "stopped" && receipt ? "stopped" : "unknown";
    if (!run) {
      // Missing model confirmation is a state, not a fabricated Agent receipt event.
      await stopCurrent(client, workspaceId, row, item, "unknown"); return "settled" as const;
    }
    if (item.events.length >= MAX_EVENTS) throw new FamilyError(400, "concern_history_requires_review");
    const summary = { completed: "本次站內跟進已完成；本人可查看原 Agent 結果。",
      stopped: "本次站內跟進已停止；本人可查看原 Agent 收據。",
      unknown: "未能確認本次站內跟進結果；保留原操作，沒有自動重新執行。" }[state];
    const now = new Date().toISOString(), added = event(scheduled.actor_user_id, now, "confirmed_action", "站內跟進結果",
      summary,
      { runId: run.id, sourceLabel: "Agent 站內跟進收據" });
    await client.query("UPDATE concern_followups SET state=$2,run_id=$3,updated_at=now() WHERE id=$1", [scheduled.id, state, run.id]);
    item.followUp = { ...item.followUp!, state, runId: run.id }; item.version++; item.updatedAt = now; item.events.push(added);
    await save(client, workspaceId, row, item, false, added); return "settled" as const;
  }
  return {
    /** Bounded shared report scan, including a header per concern. Terminal capacity rules stay unchanged. */
    reportPage(userId: string, childId: string, after?: { id: string; sequence: number }) {
      return access(userId, childId, false, async client => {
        const rows = (await client.query<Row & { sequence: number; event_id: string | null; actor_user_id: string; event_encrypted: string; has_observations: boolean }>(`
          SELECT c.*,p.sequence,p.event_id,p.actor_user_id,p.event_encrypted,
            EXISTS(SELECT 1 FROM concern_events e WHERE e.concern_id=c.id) AS has_observations
          FROM concerns c JOIN LATERAL (
            SELECT 0 AS sequence,NULL::uuid AS event_id,NULL::text AS actor_user_id,NULL::text AS event_encrypted
            UNION ALL SELECT sequence,id,actor_user_id,payload_encrypted FROM concern_events WHERE concern_id=c.id
          ) p ON true WHERE c.child_id=$1 AND ($2::uuid IS NULL OR (c.id,p.sequence)>($2::uuid,$3::integer))
          ORDER BY c.id,p.sequence LIMIT 101`, [childId, after?.id ?? null, after?.sequence ?? null])).rows;
        const page = rows.slice(0, 100), last = page.at(-1);
        return { items: page.map(row => ({ concern: decodeHeader(row), hasEvents: row.has_observations,
          event: row.event_id ? decodeEvent(row, { id: row.event_id, actor_user_id: row.actor_user_id, payload_encrypted: row.event_encrypted }) : null })),
          next: rows.length > 100 && last ? { id: last.id, sequence: last.sequence } : null };
      });
    },
    /** Exact references do not invoke the ordinary full-history decoder. */
    reportReference(userId: string, childId: string, id: string, eventId?: string) {
      return access(userId, childId, false, async client => {
        const row = (await client.query<Row>("SELECT * FROM concerns WHERE id=$1 AND child_id=$2", [id, childId])).rows[0];
        if (!row) return null;
        const events = (await client.query<{ id: string; actor_user_id: string; payload_encrypted: string }>(
          "SELECT id,actor_user_id,payload_encrypted FROM concern_events WHERE concern_id=$1 AND ($2::uuid IS NULL OR id=$2) ORDER BY sequence DESC LIMIT 201", [id, eventId ?? null])).rows;
        // Legacy concern snapshots referenced their most recent observations. Refuse unknown oversized legacy content.
        return { concern: decodeHeader(row), events: events.slice(0, 200).reverse().map(event => decodeEvent(row, event)), complete: events.length <= 200 };
      });
    },
    list(userId: string, childId: string) {
      return access(userId, childId, false, async (client, workspaceId, canManage): Promise<ConcernPage> => {
        const rows = (await client.query<Row>("SELECT * FROM concerns WHERE child_id=$1 ORDER BY created_at,id LIMIT 201", [childId])).rows;
        if (rows.length > MAX_CONCERNS) throw new FamilyError(400, "concern_history_requires_review");
        const items: Concern[] = [];
        for (const row of rows) items.push(await decode(client, row));
        return { authorityVersion: (await authority(client, workspaceId)).version, items, canManage };
      });
    },
    get(userId: string, childId: string, id: string) { return access(userId, childId, false, async client => (await find(client, childId, id))?.item ?? null); },
    create(userId: string, childId: string, raw: ConcernValues, opId: string) {
      const input = concernValuesSchema.parse(raw);
      return access(userId, childId, true, (client, workspaceId) => receipt(client, workspaceId, userId, childId, opId, { action: "create", values: input }, async () => {
        future(input.followUpAt);
        const count = (await client.query<{ count: number }>("SELECT count(*)::integer AS count FROM concerns WHERE child_id=$1", [childId])).rows[0].count;
        if (count >= MAX_CONCERNS) throw new FamilyError(400, "concern_history_requires_review");
        const refs = await links(client, childId, input.links), now = new Date().toISOString(), id = randomUUID();
        const first = event(userId, input.observedAt, "observation", "開始持續關注", input.observation, refs);
        const item: Concern = { id, childId, title: input.title, reason: input.reason, status: "following", version: 1,
          createdAt: now, updatedAt: now, archivedAt: null, attentionIds: input.links.attentionId ? [input.links.attentionId] : [], events: [first], historyComplete: true, followUp: null };
        const row: Row = { id, child_id: childId, created_by: userId, version: 1, payload_encrypted: "", follow_up_id: null };
        // Both references are committed together; every revision is inserted once.
        if (input.followUpAt) await schedule(client, workspaceId, userId, item, input.followUpAt);
        await save(client, workspaceId, row, item, true, first);
        return item;
      }));
    },
    change(userId: string, childId: string, id: string, raw: ConcernChange, opId: string) {
      const input = concernChangeSchema.parse(raw);
      return access(userId, childId, true, (client, workspaceId) => receipt(client, workspaceId, userId, childId, opId, { id, change: input }, async () => {
        if ((await authority(client, workspaceId)).version !== input.authorityVersion) throw conflict();
        const found = await find(client, childId, id); if (!found) throw missing();
        const { row, item } = found;
        if (item.version !== input.expectedVersion || item.version >= 2147483647) throw conflict();
        if (item.events.length >= MAX_EVENTS) throw new FamilyError(400, "concern_history_requires_review");
        const now = new Date().toISOString(); item.version++; item.updatedAt = now;
        let added: ConcernEvent;
        if (input.action === "append") {
          if (item.status !== "following") throw conflict();
          const refs = await links(client, childId, input.links);
          added = event(userId, input.observedAt, "observation", "補充觀察", input.text, refs);
          if (input.links.attentionId && !item.attentionIds.includes(input.links.attentionId)) item.attentionIds.push(input.links.attentionId);
          if (item.followUp?.state === "pending") await client.query("UPDATE concern_followups SET concern_version=$2,updated_at=now() WHERE id=$1", [item.followUp.id, item.version]);
          else await cancel(client, item);
        } else if (input.action === "archive") {
          if (item.status !== "following") throw conflict();
          await cancel(client, item); item.status = "closed"; item.archivedAt = now; item.statusBeforeArchive = "following";
          added = event(userId, now, "confirmed_action", "結束持續關注", "家長確認結束此關注；原有事件及相關任務保留。");
        } else if (input.action === "restore") {
          if (item.status !== "closed") throw conflict();
          await cancel(client, item); item.status = "following"; item.archivedAt = null;
          added = event(userId, now, "confirmed_action", "恢復持續關注", "家長確認恢復此關注；原有跟進不會自動重新安排。");
        } else {
          if (item.status !== "following") throw conflict();
          future(input.followUpAt); await cancel(client, item);
          if (input.followUpAt) await schedule(client, workspaceId, userId, item, input.followUpAt);
          added = event(userId, now, "confirmed_action", input.followUpAt ? "安排站內跟進" : "取消站內跟進",
            input.followUpAt ? "家長確認在指定時間進行一次站內跟進。" : "家長取消尚未完成的站內跟進。");
        }
        item.events.push(added); await save(client, workspaceId, row, item, false, added); return item;
      }));
    },
    async checkDue(generation: string, enqueue: ConcernEnqueue) {
      const due = (await pool.query<{ child_id: string; concern_id: string; storage_epoch: string }>(`SELECT f.child_id,f.concern_id,w.storage_epoch
        FROM concern_followups f JOIN concerns c ON c.id=f.concern_id AND c.follow_up_id=f.id
        JOIN children ch ON ch.id=f.child_id JOIN workspaces w ON w.id=ch.workspace_id
        JOIN worker_control ctl ON ctl.id=1 AND ctl.enabled AND ctl.generation=$1
        WHERE (f.state='pending' AND f.due_at<=now()) OR f.state='queued'
        ORDER BY f.due_at,f.id LIMIT 10`, [generation])).rows;
      for (const value of due) await workerAccess({ childId: value.child_id, id: value.concern_id }, async (client, workspaceId, row, item, scheduled) => {
        const scope = { workerGeneration: generation, storageEpoch: value.storage_epoch };
        if (!await controlled(client, workspaceId, scope)) return;
        if (item.status !== "following" || item.version !== scheduled.concern_version || !await actorAllowed(client, workspaceId, scheduled)) {
          if (["pending", "queued"].includes(scheduled.state)) await stopCurrent(client, workspaceId, row, item, "cancelled");
          return;
        }
        if (scheduled.state === "queued") {
          const job = (await client.query<{ state: string }>("SELECT state FROM pgboss.job WHERE name=$1 AND id=$2", [CONCERN_AGENT_QUEUE, scheduled.job_id])).rows[0];
          if (scheduled.worker_generation !== generation) await stopCurrent(client, workspaceId, row, item, "cancelled");
          else if (!job || ["completed", "failed", "cancelled"].includes(job.state)) await settle(client, workspaceId, row, item, scheduled, null, true);
          return;
        }
        if (scheduled.state !== "pending" || scheduled.due_at.getTime() > Date.now()) return;
        if (item.events.length >= MAX_EVENTS) throw new FamilyError(400, "concern_history_requires_review");
        item.version++; item.updatedAt = new Date().toISOString(); item.followUp = { ...item.followUp!, state: "queued" };
        const jobId = randomUUID(), job: ConcernJob = { childId: item.childId, id: item.id, followUpId: scheduled.id, version: item.version, jobId, ...scope };
        await client.query("UPDATE concern_followups SET state='queued',concern_version=$2,worker_generation=$3,job_id=$4,updated_at=now() WHERE id=$1", [scheduled.id, item.version, generation, jobId]);
        await save(client, workspaceId, row, item); await enqueue(client, job);
      });
    },
    backgroundInput(job: ConcernJob) {
      return workerAccess(job, async (client, workspaceId, row, item, scheduled) => {
        if (!await controlled(client, workspaceId, job) || scheduled.id !== job.followUpId || scheduled.job_id !== job.jobId
          || scheduled.worker_generation !== job.workerGeneration || scheduled.storage_epoch !== job.storageEpoch || scheduled.state !== "queued") return null;
        if (item.status !== "following" || item.version !== job.version || scheduled.concern_version !== job.version || !await actorAllowed(client, workspaceId, scheduled)) {
          await stopCurrent(client, workspaceId, row, item, "cancelled"); return null;
        }
        return { userId: scheduled.actor_user_id, concern: item };
      });
    },
    finishBackground(job: ConcernJob, reported: ProductAgentResult | null) {
      return workerAccess(job, async (client, workspaceId, row, item, scheduled) => {
        if (!await controlled(client, workspaceId, job) || scheduled.id !== job.followUpId || scheduled.job_id !== job.jobId || scheduled.state !== "queued"
          || scheduled.worker_generation !== job.workerGeneration || scheduled.storage_epoch !== job.storageEpoch) return "ignored" as const;
        if (item.status !== "following" || item.version !== job.version || !await actorAllowed(client, workspaceId, scheduled)) {
          await stopCurrent(client, workspaceId, row, item, "cancelled"); return "ignored" as const;
        }
        return settle(client, workspaceId, row, item, scheduled, reported);
      });
    },
  };
}
export type ConcernStore = ReturnType<typeof createConcernStore>;
