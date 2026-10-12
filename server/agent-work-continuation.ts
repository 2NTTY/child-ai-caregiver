import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { StorageCipher } from "./storage-crypto.ts";
import type { AgentWork, WorkResource } from "../src/shared/agent-work.ts";
import type { ProductAgentResult } from "../src/shared/product-agent.ts";
import type { KnowledgeSourceInput } from "../src/shared/knowledge.ts";
import type { KnowledgeReviewAssessment } from "./knowledge-version-review.ts";
import { internalKnowledgeSource } from "./knowledge-inputs.ts";
import { FamilyError } from "./family-access.ts";
import { appendOnlineChange } from "./online-change.ts";

export const WORK_CONTINUATION_CHECK_QUEUE = "agent-work-check-v1", WORK_CONTINUATION_QUEUE = "agent-work-continuation-v1";
export const WORK_CONTINUATION_OPTIONS = { heartbeatSeconds: 60, expireInSeconds: 120,
  retryLimit: 2, retryDelay: 5, retryBackoff: false, retentionSeconds: 14 * 86400, deleteAfterSeconds: 7 * 86400 };
export interface WorkContinuationJob { eventId: string; jobId: string; workerGeneration: string; storageEpoch: string }
export type WorkContinuationEnqueue = (client: PoolClient, job: WorkContinuationJob) => Promise<void>;
import { continuationKnowledgeMeaning, projectWorkContinuationContext } from "./agent-work-continuation-core.ts";
import type { ResourceBasis, KnowledgeBasis, Baseline, WorkContinuationChanges, WorkContinuationContextEntry } from "./agent-work-continuation-core.ts";
export { continuationKnowledgeMeaning, projectWorkContinuationContext, WORK_CONTINUATION_CONTEXT_LIMIT } from "./agent-work-continuation-core.ts";
export type { WorkContinuationChanges, WorkContinuationContextEntry } from "./agent-work-continuation-core.ts";
interface Constituent { workId: string; workVersion: number; changes: WorkContinuationChanges }
interface WorkRow { id: string; child_id: string; owner_user_id: string; version: number; status: AgentWork["status"];
  payload_encrypted: string; created_at: Date; updated_at: Date }
interface FollowUpRow { work_id: string; child_id: string; owner_user_id: string; workspace_id: string; work_version: number;
  authorization_version: string; storage_epoch: string; enabled: boolean; watch_resources: boolean;
  knowledge_source_ids: string[]; due_at: Date | null; due_consumed: boolean; next_check_at: Date | null; baseline_encrypted: string }
interface EventRow { id: string; child_id: string; owner_user_id: string; workspace_id: string; local_day: string;
  authorization_version: string; storage_epoch: string; worker_generation: string; job_id: string;
  state: "queued" | "completed" | "stopped" | "unknown" | "cancelled"; run_id: string | null; payload_encrypted: string; created_at: Date }
interface Authority { owner_user_id: string; access_version: string; storage_epoch: string }
interface KnowledgeCurrent extends KnowledgeBasis { assessment: KnowledgeReviewAssessment | null }
const baselineAad = (work: Pick<AgentWork, "id" | "childId" | "version">, userId: string) => `agent-work-followup:${work.childId}:${userId}:${work.id}:${work.version}`;
const eventAad = (event: Pick<EventRow, "id" | "child_id" | "owner_user_id">) => `agent-work-continuation:${event.child_id}:${event.owner_user_id}:${event.id}`;
const workAad = (row: WorkRow) => `agent-work:${row.child_id}:${row.owner_user_id}:${row.id}:${row.version}`;
const activeWork = (work: AgentWork) => (work.status === "active" || work.status === "waiting") && Boolean(work.followUp);
const meaningful = (changes: WorkContinuationChanges) => changes.due || changes.resources.length > 0 || changes.knowledge.length > 0;
const decodeWork = (cipher: StorageCipher, row: WorkRow): AgentWork => ({ ...JSON.parse(cipher.decrypt(row.payload_encrypted, workAad(row))),
  id: row.id, childId: row.child_id, version: row.version, status: row.status, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() });

/** Only identifiers, versions and states enter the encrypted comparison baseline. */
async function resourceBasis(client: PoolClient, cipher: StorageCipher, userId: string, childId: string, ref: WorkResource): Promise<ResourceBasis> {
  const tables = { task: "care_tasks", memory_fact: "memory_facts", private_note: "agent_private_notes", private_source: "shared_inputs",
    concern: "concerns", family_document: "family_documents", care_record: "text_records", receipt: "agent_action_receipts" } as const;
  const privateFilter = ["private_note", "private_source", "receipt"].includes(ref.kind) ? " AND owner_user_id=$3"
    : ref.kind === "memory_fact" ? " AND (visibility='family' OR created_by=$3)" : "";
  const row = (await client.query<{ id: string; version: number; status?: string; payload_encrypted?: string; source_record_id?: string | null;
    source_record_version?: number; valid_until?: Date | null }>(`SELECT *,${ref.kind === "receipt" ? "1" : "version"} AS version
    FROM ${tables[ref.kind]} WHERE id=$1 AND child_id=$2${privateFilter} FOR SHARE`, privateFilter ? [ref.id, childId, userId] : [ref.id, childId])).rows[0];
  if (!row) return { ...ref, status: "unavailable", available: false, terminal: false };
  let status = row.status ?? "current", available = true, terminal = false;
  if (ref.kind === "task") {
    status = (await client.query<{ state: string }>("SELECT state FROM task_occurrences WHERE task_id=$1 FOR SHARE", [ref.id])).rows[0]?.state ?? "unavailable";
    terminal = status === "completed" || status === "cancelled"; available = status !== "unavailable";
  } else if (ref.kind === "concern") terminal = status === "closed";
  else if (ref.kind === "family_document") terminal = status === "archived";
  else if (ref.kind === "private_source") {
    const value = JSON.parse(cipher.decrypt(row.payload_encrypted!, `shared-input:${ref.id}:payload`)) as { management?: { enabled?: boolean } | null };
    available = value.management?.enabled !== false; status = available ? "current" : "disabled";
  } else if (ref.kind === "memory_fact") {
    available = status !== "inactive" && !(row.valid_until && row.valid_until.getTime() <= Date.now());
    if (row.source_record_id) {
      const source = (await client.query<{ version: number }>("SELECT version FROM text_records WHERE id=$1 AND child_id=$2 FOR SHARE", [row.source_record_id, childId])).rows[0];
      available = available && source?.version === row.source_record_version;
    }
  }
  return { kind: ref.kind, id: ref.id, version: row.version, status, available, terminal };
}
async function knowledgeCurrent(client: PoolClient, ids: string[]): Promise<KnowledgeCurrent[]> {
  if (!ids.length) return [];
  const rows = (await client.query<{ id: string; version_id: string; version_hash: string; document: KnowledgeSourceInput;
    assessment: KnowledgeReviewAssessment | null }>(`SELECT s.id,v.id AS version_id,v.version_hash,v.document,r.assessment
    FROM knowledge_sources s JOIN knowledge_versions v ON v.id=s.active_version_id AND v.source_id=s.id
    LEFT JOIN knowledge_observations o ON o.source_id=s.id LEFT JOIN knowledge_watches w ON w.id=COALESCE(o.watch_id,s.id)
    LEFT JOIN LATERAL (SELECT assessment FROM knowledge_version_reviews WHERE version_id=v.id ORDER BY reviewed_at DESC,id DESC LIMIT 1) r ON true
    WHERE s.id=ANY($1::text[]) AND s.enabled AND v.review_state='reviewed' AND v.published_at IS NOT NULL
    AND v.document->>'classification'='official_guidance'
    AND (v.document->>'validUntil' IS NULL OR (v.document->>'validUntil')::timestamptz>now())
    AND (w.id IS NULL OR (w.enabled AND o.source_id IS NOT NULL AND NOT o.unavailable AND o.approved_hash=o.content_hash AND o.approved_version_id=v.id))
    AND w.definition->>'audience' IS DISTINCT FROM 'internal_noncommercial'`, [ids])).rows;
  return ids.map(sourceId => {
    const row = rows.find(value => value.id === sourceId && !internalKnowledgeSource(value.document.url));
    return row ? { sourceId, versionId: row.version_id, hash: row.version_hash, available: true, assessment: row.assessment }
      : { sourceId, versionId: null, hash: null, available: false, assessment: null };
  });
}
async function capture(client: PoolClient, cipher: StorageCipher, userId: string, work: AgentWork) {
  const resources: ResourceBasis[] = [];
  for (const ref of work.resources) resources.push(await resourceBasis(client, cipher, userId, work.childId, ref));
  const knowledge = await knowledgeCurrent(client, work.followUp?.knowledgeSourceIds ?? []);
  return { resources, knowledge };
}

/** Called once for a new work version inside the original save_work transaction. */
export async function syncAgentWorkFollowUp(client: PoolClient, cipher: StorageCipher, input: {
  work: AgentWork; userId: string; workspaceId: string; authorizationVersion: string; storageEpoch: string;
}) {
  if (!(await client.query("SELECT 1 FROM app_migrations WHERE id='033-agent-work-continuation'")).rowCount) {
    if (input.work.followUp) throw new FamilyError(409, "work_followup_migration_required");
    return;
  }
  const { work, userId } = input, basis = await capture(client, cipher, userId, work);
  if (activeWork(work) && basis.knowledge.some(source => !source.available)) throw new FamilyError(404, "not_found");
  const enabled = activeWork(work) && !basis.resources.some(resource => resource.terminal);
  const baseline: Baseline = { resources: basis.resources, knowledge: basis.knowledge.map(({ assessment: _assessment, ...source }) => source) };
  await client.query(`INSERT INTO agent_work_followups(work_id,child_id,owner_user_id,workspace_id,work_version,authorization_version,storage_epoch,
    enabled,watch_resources,knowledge_source_ids,due_at,due_consumed,next_check_at,baseline_encrypted)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,$12,$13) ON CONFLICT(work_id) DO UPDATE SET
    work_version=EXCLUDED.work_version,authorization_version=EXCLUDED.authorization_version,storage_epoch=EXCLUDED.storage_epoch,
    enabled=EXCLUDED.enabled,watch_resources=EXCLUDED.watch_resources,knowledge_source_ids=EXCLUDED.knowledge_source_ids,due_at=EXCLUDED.due_at,
    due_consumed=false,next_check_at=EXCLUDED.next_check_at,baseline_encrypted=EXCLUDED.baseline_encrypted,updated_at=now()`,
  [work.id, work.childId, userId, input.workspaceId, work.version, input.authorizationVersion, input.storageEpoch,
    enabled, work.followUp?.watchResources ?? false, work.followUp?.knowledgeSourceIds ?? [], work.followUp?.dueAt ?? null,
    enabled ? work.followUp?.dueAt ?? null : null, cipher.encrypt(JSON.stringify(baseline), baselineAad(work, userId))]);
  // Invalidate the old event in this same transaction when no current constituent remains.
  // A partially stale event keeps its identity and is filtered again at execution.
  await client.query(`UPDATE agent_work_continuations e SET state='cancelled',updated_at=now(),run_id=COALESCE(e.run_id,
    (SELECT id FROM agent_runs WHERE owner_user_id=e.owner_user_id AND child_id=e.child_id AND trigger_kind='worker' AND trigger_reference=e.id))
    WHERE e.state='queued' AND e.owner_user_id=$1 AND e.child_id=$2
    AND EXISTS(SELECT 1 FROM agent_work_continuation_works l WHERE l.event_id=e.id AND l.work_id=$3)
    AND NOT EXISTS(SELECT 1 FROM agent_work_continuation_works l JOIN agent_work w ON w.id=l.work_id
      JOIN agent_work_followups f ON f.work_id=w.id WHERE l.event_id=e.id AND w.version=l.work_version
      AND f.work_version=l.work_version AND f.enabled AND w.status IN ('active','waiting'))`, [userId, work.childId, work.id]);
}

export async function latestAgentWorkFollowUps(client: PoolClient, userId: string, childId: string, workIds: string[]) {
  const values = new Map<string, NonNullable<AgentWork["latestFollowUp"]>>();
  if (!workIds.length || !(await client.query("SELECT 1 FROM app_migrations WHERE id='033-agent-work-continuation'")).rowCount) return values;
  const rows = (await client.query<{ work_id: string; id: string; run_id: string | null; state: EventRow["state"]; created_at: Date }>(`
    SELECT DISTINCT ON (l.work_id) l.work_id,e.id,e.run_id,
      CASE WHEN e.state='queued' AND (w.version<>l.work_version OR NOT f.enabled OR w.status NOT IN ('active','waiting'))
        THEN 'cancelled' ELSE e.state END AS state,e.created_at FROM agent_work_continuation_works l
    JOIN agent_work w ON w.id=l.work_id LEFT JOIN agent_work_followups f ON f.work_id=w.id
    JOIN agent_work_continuations e ON e.id=l.event_id WHERE l.work_id=ANY($1::uuid[]) AND e.owner_user_id=$2 AND e.child_id=$3
    ORDER BY l.work_id,e.created_at DESC,e.id DESC`, [workIds, userId, childId])).rows;
  for (const row of rows) values.set(row.work_id, { eventId: row.id, runId: row.run_id, state: row.state, createdAt: row.created_at.toISOString() });
  return values;
}

/** The database owns eligibility and durable daily limits; the model owns only the private response. */
export function createAgentWorkContinuationStore(pool: Pool, cipher: StorageCipher) {
  async function transaction<T>(workspaceId: string, operation: (client: PoolClient, authority: Authority) => Promise<T>) {
    const client = await pool.connect(); let discard = false;
    try {
      await client.query("BEGIN"); await client.query("SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='5s'");
      const authority = (await client.query<Authority>("SELECT owner_user_id,access_version::text,storage_epoch FROM workspaces WHERE id=$1 FOR UPDATE", [workspaceId])).rows[0];
      const result = authority ? await operation(client, authority) : null;
      await client.query("COMMIT"); return result;
    } catch (error) { try { await client.query("ROLLBACK"); } catch { discard = true; } throw error; }
    finally { client.release(discard); }
  }
  async function allowed(client: PoolClient, authority: Authority, owner: string, workspaceId: string) {
    return authority.owner_user_id === owner || Boolean((await client.query("SELECT 1 FROM family_members WHERE workspace_id=$1 AND user_id=$2 AND role=ANY($3::text[])",
      [workspaceId, owner, ["caregiver", "viewer"]])).rowCount);
  }
  async function controlled(client: PoolClient, generation: string) {
    const control = (await client.query<{ enabled: boolean; generation: string }>("SELECT enabled,generation FROM worker_control WHERE id=1 FOR SHARE")).rows[0];
    return control?.enabled && control.generation === generation;
  }
  async function rows(client: PoolClient, workId: string, owner: string, childId: string) {
    const work = (await client.query<WorkRow>("SELECT * FROM agent_work WHERE id=$1 AND owner_user_id=$2 AND child_id=$3 FOR UPDATE", [workId, owner, childId])).rows[0];
    const followUp = (await client.query<FollowUpRow>("SELECT *,authorization_version::text FROM agent_work_followups WHERE work_id=$1 FOR UPDATE", [workId])).rows[0];
    return work && followUp ? { work: decodeWork(cipher, work), followUp } : null;
  }
  const scopeMatches = (authority: Authority, followUp: FollowUpRow) => followUp.enabled && followUp.authorization_version === authority.access_version
    && followUp.storage_epoch === authority.storage_epoch;
  async function disable(client: PoolClient, workId: string) {
    await client.query("UPDATE agent_work_followups SET enabled=false,next_check_at=NULL,updated_at=now() WHERE work_id=$1", [workId]);
  }
  async function advance(client: PoolClient, work: AgentWork, followUp: FollowUpRow, baseline: Baseline, consumeDue: boolean) {
    const consumed = followUp.due_consumed || consumeDue;
    await client.query(`UPDATE agent_work_followups SET baseline_encrypted=$2,due_consumed=$3,next_check_at=$4,updated_at=now()
      WHERE work_id=$1 AND work_version=$5`, [work.id, cipher.encrypt(JSON.stringify(baseline), baselineAad(work, followUp.owner_user_id)), consumed,
      !consumed ? followUp.due_at : null, work.version]);
  }
  async function defer(client: PoolClient, workId: string) {
    await client.query(`UPDATE agent_work_followups SET next_check_at=(date_trunc('day',now() AT TIME ZONE 'Asia/Hong_Kong')+interval '1 day')
      AT TIME ZONE 'Asia/Hong_Kong',updated_at=now() WHERE work_id=$1`, [workId]);
  }
  async function settle(client: PoolClient, event: EventRow, reported: ProductAgentResult | null, terminalJob = false) {
    const run = (await client.query<{ id: string; state: string; expires_at: Date; result_encrypted: string | null }>(`
      SELECT id,state,expires_at,result_encrypted FROM agent_runs WHERE owner_user_id=$1 AND child_id=$2
      AND trigger_kind='worker' AND trigger_reference=$3 FOR UPDATE`, [event.owner_user_id, event.child_id, event.id])).rows[0];
    if (!terminalJob && run?.state === "running" && run.expires_at.getTime() > Date.now()) {
      await client.query("UPDATE agent_work_continuations SET run_id=$2,updated_at=now() WHERE id=$1 AND state='queued'", [event.id, run.id]);
      return "running" as const;
    }
    if (reported && reported.runId !== run?.id) throw new Error("work_continuation_receipt_mismatch");
    const receipt = run?.result_encrypted ? JSON.parse(cipher.decrypt(run.result_encrypted,
      `agent-run:${event.child_id}:${event.owner_user_id}:${run.id}`)) as ProductAgentResult : null;
    const state = run?.state === "completed" && receipt?.status === "completed" ? "completed"
      : run?.state === "stopped" && receipt?.status === "stopped" ? "stopped" : "unknown";
    if (run?.state === "running" && run.expires_at.getTime() <= Date.now())
      await client.query("UPDATE agent_runs SET state='unknown',stop_reason='interrupted',updated_at=now() WHERE id=$1 AND state='running'", [run.id]);
    await client.query("UPDATE agent_work_continuations SET state=$2,run_id=$3,updated_at=now() WHERE id=$1 AND state='queued'", [event.id, state, run?.id ?? null]);
    await appendOnlineChange(client, event.workspace_id, "memory", event.child_id, false, event.owner_user_id, false, { suppressWorkWake: true });
    return "settled" as const;
  }
  async function eventAccess<T>(job: WorkContinuationJob, action: (client: PoolClient, authority: Authority, event: EventRow) => Promise<T>) {
    const routing = (await pool.query<{ workspace_id: string }>("SELECT workspace_id FROM agent_work_continuations WHERE id=$1", [job.eventId])).rows[0];
    if (!routing) return null;
    return transaction(routing.workspace_id, async (client, authority) => {
      if (!await controlled(client, job.workerGeneration)) return null;
      const event = (await client.query<EventRow>("SELECT *,authorization_version::text FROM agent_work_continuations WHERE id=$1 FOR UPDATE", [job.eventId])).rows[0];
      if (!event || event.state !== "queued" || event.job_id !== job.jobId || event.worker_generation !== job.workerGeneration
        || event.storage_epoch !== job.storageEpoch) return null;
      return action(client, authority, event);
    });
  }
  async function current(client: PoolClient, authority: Authority, event: EventRow) {
    if (event.storage_epoch !== authority.storage_epoch || event.authorization_version !== authority.access_version
      || !await allowed(client, authority, event.owner_user_id, event.workspace_id)
      || !(await client.query("SELECT 1 FROM children WHERE id=$1 AND workspace_id=$2", [event.child_id, event.workspace_id])).rowCount) return [];
    const payload = JSON.parse(cipher.decrypt(event.payload_encrypted, eventAad(event))) as { works: Constituent[] };
    const inputs: WorkContinuationContextEntry[] = [];
    for (const item of payload.works) {
      const found = await rows(client, item.workId, event.owner_user_id, event.child_id);
      if (!found || found.work.version !== item.workVersion || found.followUp.work_version !== item.workVersion
        || !activeWork(found.work) || !scopeMatches(authority, found.followUp)) continue;
      const basis = await capture(client, cipher, event.owner_user_id, found.work);
      if (basis.resources.some(ref => ref.terminal)) { await disable(client, found.work.id); continue; }
      const visible = basis.resources.filter(ref => ref.available && !ref.terminal);
      const sourceIds = basis.knowledge.filter(source => source.available).map(source => source.sourceId);
      const changes: WorkContinuationChanges = { due: item.changes.due,
        resources: item.changes.resources.flatMap(change => {
          const ref = visible.find(ref => ref.id === change.id && ref.kind === change.kind);
          return ref ? [{ ...change, version: ref.version, status: ref.status }] : [];
        }),
        knowledge: item.changes.knowledge.filter(change => sourceIds.includes(change.sourceId)).map(change => ({ ...change,
          versionId: basis.knowledge.find(source => source.sourceId === change.sourceId)!.versionId! })) };
      if (!meaningful(changes)) continue;
      const sourceMessageIds: string[] = [];
      for (const id of found.work.sourceMessageIds) if ((await client.query("SELECT 1 FROM chat_messages WHERE id=$1 AND owner_user_id=$2 AND child_id=$3", [id, event.owner_user_id, event.child_id])).rowCount) sourceMessageIds.push(id);
      inputs.push({ work: { id: found.work.id, childId: found.work.childId, version: found.work.version, status: found.work.status,
        goal: found.work.goal.slice(0, 500), focus: found.work.focus.slice(0, 300),
        questions: found.work.questions.slice(0, 2).map(question => question.slice(0, 300)), resources: visible.map(({ kind, id, version }) => ({ kind, id, version })), sourceMessageIds,
        followUp: { ...found.work.followUp!, reason: found.work.followUp!.reason.slice(0, 300), knowledgeSourceIds: sourceIds } },
        textPartial: found.work.goal.length > 500 || found.work.focus.length > 300 || found.work.questions.length > 2
          || found.work.questions.some(question => question.length > 300) || found.work.followUp!.reason.length > 300,
        changes, knowledgeSourceIds: sourceIds });
    }
    return inputs;
  }
  async function cancel(client: PoolClient, event: EventRow) {
    const run = (await client.query<{ id: string }>("SELECT id FROM agent_runs WHERE owner_user_id=$1 AND child_id=$2 AND trigger_kind='worker' AND trigger_reference=$3", [event.owner_user_id, event.child_id, event.id])).rows[0];
    await client.query("UPDATE agent_work_continuations SET state='cancelled',run_id=COALESCE($2,run_id),updated_at=now() WHERE id=$1 AND state='queued'", [event.id, run?.id ?? null]);
    await appendOnlineChange(client, event.workspace_id, "memory", event.child_id, false, event.owner_user_id, false, { suppressWorkWake: true });
  }
  return {
    async checkDue(generation: string, enqueue: WorkContinuationEnqueue) {
      const due = (await pool.query<{ work_id: string; owner_user_id: string; child_id: string; workspace_id: string }>(`
        SELECT f.work_id,f.owner_user_id,f.child_id,f.workspace_id FROM agent_work_followups f
        JOIN worker_control c ON c.id=1 AND c.enabled AND c.generation=$1
        WHERE f.enabled AND f.next_check_at<=now() ORDER BY f.next_check_at,f.work_id LIMIT 10`, [generation])).rows;
      const groups = new Map<string, typeof due>();
      for (const row of due) { const key = row.workspace_id + ":" + row.owner_user_id + ":" + row.child_id; groups.set(key, [...(groups.get(key) ?? []), row]); }
      for (const selected of groups.values()) await transaction(selected[0].workspace_id, async (client, authority) => {
        if (!await controlled(client, generation)) return;
        const { owner_user_id: owner, child_id: childId, workspace_id: workspaceId } = selected[0];
        if (!await allowed(client, authority, owner, workspaceId)) {
          for (const row of selected) await disable(client, row.work_id); return;
        }
        const candidates: { work: AgentWork; followUp: FollowUpRow; baseline: Baseline; changes: WorkContinuationChanges }[] = [];
        for (const row of [...selected].sort((a, b) => a.work_id.localeCompare(b.work_id))) {
          const found = await rows(client, row.work_id, owner, childId);
          if (!found || !found.followUp.enabled || !found.followUp.next_check_at || found.followUp.next_check_at.getTime() > Date.now()) continue;
          const { work, followUp } = found;
          if (!scopeMatches(authority, followUp) || !activeWork(work) || work.version !== followUp.work_version) { await disable(client, work.id); continue; }
          const next = await capture(client, cipher, owner, work);
          if (next.resources.some(ref => ref.terminal)) { await disable(client, work.id); continue; }
          const previous = JSON.parse(cipher.decrypt(followUp.baseline_encrypted, baselineAad(work, owner))) as Baseline;
          const baseline: Baseline = { resources: next.resources, knowledge: next.knowledge.map(({ assessment: _assessment, ...source }) => source) };
          const changes: WorkContinuationChanges = { due: !followUp.due_consumed && Boolean(followUp.due_at && followUp.due_at.getTime() <= Date.now()), resources: [], knowledge: [] };
          if (followUp.watch_resources) for (const ref of next.resources.filter(ref => ref.available && !ref.terminal)) {
            const before = previous.resources.find(old => old.kind === ref.kind && old.id === ref.id);
            if (before?.available && (before.version !== ref.version || before.status !== ref.status))
              changes.resources.push({ kind: ref.kind, id: ref.id, previousVersion: before.version, version: ref.version, status: ref.status });
          }
          for (const source of next.knowledge) {
            const meaning = continuationKnowledgeMeaning(previous.knowledge.find(old => old.sourceId === source.sourceId), source);
            if (meaning && source.versionId) changes.knowledge.push({ sourceId: source.sourceId, versionId: source.versionId, meaning });
          }
          if (!meaningful(changes)) { await advance(client, work, followUp, baseline, false); continue; }
          candidates.push({ work, followUp, baseline, changes });
        }
        if (!candidates.length) return;
        const day = (await client.query<{ day: string }>("SELECT (now() AT TIME ZONE 'Asia/Hong_Kong')::date::text AS day")).rows[0].day;
        if ((await client.query("SELECT 1 FROM agent_work_continuations WHERE owner_user_id=$1 AND child_id=$2 AND local_day=$3", [owner, childId, day])).rowCount) {
          for (const candidate of candidates) await defer(client, candidate.work.id); return;
        }
        const eligible = candidates.slice(0, 5), id = randomUUID(), jobId = randomUUID();
        const payload = { works: eligible.map(candidate => ({ workId: candidate.work.id, workVersion: candidate.work.version, changes: candidate.changes })) };
        await client.query(`INSERT INTO agent_work_continuations(id,child_id,owner_user_id,workspace_id,local_day,authorization_version,storage_epoch,
          worker_generation,job_id,state,payload_encrypted) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'queued',$10)`,
        [id, childId, owner, workspaceId, day, authority.access_version, authority.storage_epoch, generation, jobId,
          cipher.encrypt(JSON.stringify(payload), eventAad({ id, child_id: childId, owner_user_id: owner }))]);
        for (const candidate of eligible) {
          await client.query("INSERT INTO agent_work_continuation_works(event_id,work_id,work_version) VALUES($1,$2,$3)", [id, candidate.work.id, candidate.work.version]);
          await advance(client, candidate.work, candidate.followUp, candidate.baseline, candidate.changes.due);
        }
        for (const candidate of candidates.slice(5)) await defer(client, candidate.work.id);
        await enqueue(client, { eventId: id, jobId, workerGeneration: generation, storageEpoch: authority.storage_epoch });
        await appendOnlineChange(client, workspaceId, "memory", childId, false, owner, false, { suppressWorkWake: true });
      });
    },
    backgroundInput(job: WorkContinuationJob) {
      return eventAccess(job, async (client, authority, event) => {
        const works = await current(client, authority, event);
        if (!works.length) { await cancel(client, event); return null; }
        return { userId: event.owner_user_id, childId: event.child_id, context: projectWorkContinuationContext(event.id, works) };
      });
    },
    finishBackground(job: WorkContinuationJob, reported: ProductAgentResult | null, terminalJob = false) {
      return eventAccess(job, async (client, authority, event) => {
        if (!(await current(client, authority, event)).length) { await cancel(client, event); return "ignored" as const; }
        return settle(client, event, reported, terminalJob);
      });
    },
    async reconcile(generation: string) {
      const jobs = (await pool.query<WorkContinuationJob>(`SELECT e.id AS "eventId",e.job_id AS "jobId",e.worker_generation AS "workerGeneration",e.storage_epoch AS "storageEpoch"
        FROM agent_work_continuations e JOIN worker_control c ON c.id=1 AND c.enabled AND c.generation=$1
        LEFT JOIN pgboss.job j ON j.id=e.job_id AND j.name=$2 WHERE e.state='queued'
        AND (e.worker_generation<>$1 OR j.id IS NULL OR j.state IN ('completed','failed','cancelled')) ORDER BY e.created_at,e.id LIMIT 10`,
      [generation, WORK_CONTINUATION_QUEUE])).rows;
      for (const job of jobs) {
        if (job.workerGeneration !== generation) {
          const routing = (await pool.query<{ workspace_id: string }>("SELECT workspace_id FROM agent_work_continuations WHERE id=$1", [job.eventId])).rows[0];
          if (routing) await transaction(routing.workspace_id, async (client) => {
            if (!await controlled(client, generation)) return;
            const event = (await client.query<EventRow>("SELECT *,authorization_version::text FROM agent_work_continuations WHERE id=$1 FOR UPDATE", [job.eventId])).rows[0];
            if (event?.state === "queued" && event.worker_generation !== generation) await cancel(client, event);
          });
        } else await this.finishBackground(job, null, true);
      }
    },
  };
}
export type AgentWorkContinuationStore = ReturnType<typeof createAgentWorkContinuationStore>;
