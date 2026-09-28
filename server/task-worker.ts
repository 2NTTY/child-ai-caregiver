import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from "../src/shared/family.ts";
import { appendOnlineChange } from "./online-change.ts";
import { nextReminderCheck, reminderDecision, reminderLocalTime, type ReminderEvidence } from "./task-policy.ts";
import { readTaskWork } from "./task-work-view.ts";
import { decodeTask, taskSelection, type TaskRow, type TaskScheduling } from "./tasks.ts";
import type { StorageCipher } from "./storage-crypto.ts";

/** The adapter must insert into the framework using this exact transaction client. */
export interface TaskQueue {
  enqueue(client: PoolClient, jobId: string, workId: string, at: string, failures?: number): Promise<void>;
}
interface Control { generation: string; enabled: boolean }
interface Work {
  id: string; task_id: string; task_version: number; occurrence_id: string;
  storage_epoch: string; worker_generation: string; job_id: string;
  status: string; failures: number; job_failures_base: number; payload_encrypted: string;
}
const payloadContext = (id: string) => `task-work:${id}`;

export function createTaskScheduling(cipher: StorageCipher, queue: TaskQueue): TaskScheduling {
  return {
    view: readTaskWork,
    async changed(client, workspaceId, actorUserId, task) {
      await client.query("UPDATE task_work SET status='stopped',updated_at=now() WHERE task_id=$1 AND status='pending'", [task.id]);
      if (task.occurrence.state !== "scheduled") return;
      const control = (await client.query<Control>("SELECT generation,enabled FROM worker_control WHERE id=1 FOR SHARE")).rows[0];
      const space = (await client.query<{ storage_epoch: string }>("SELECT storage_epoch FROM workspaces WHERE id=$1", [workspaceId])).rows[0];
      const id = randomUUID(), jobId = randomUUID();
      await client.query(`INSERT INTO task_work(id,task_id,occurrence_id,task_version,storage_epoch,worker_generation,job_id,run_at,status,payload_encrypted)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)`,
      [id, task.id, task.occurrence.id, task.version, space.storage_epoch, control.generation, jobId, task.occurrence.dueAt,
        cipher.encrypt(JSON.stringify({ actorUserId }), payloadContext(id))]);
      if (control.enabled) await queue.enqueue(client, jobId, id, task.occurrence.dueAt);
    },
  };
}

export function createTaskWorker(pool: Pool, cipher: StorageCipher, queue: TaskQueue,
  onReminder?: (client: PoolClient, workId: string, reminderId: string) => Promise<void>) {
  async function locked<T>(workId: string, operation: (client: PoolClient, work: Work, workspace: { id: string; owner_user_id: string; storage_epoch: string }) => Promise<T>): Promise<T | undefined> {
    const client = await pool.connect(); let discard = false;
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='10s'");
      const ref = (await client.query<{ workspace_id: string }>(`SELECT c.workspace_id FROM task_work w JOIN care_tasks t ON t.id=w.task_id
        JOIN children c ON c.id=t.child_id WHERE w.id=$1`, [workId])).rows[0];
      if (!ref) { await client.query("COMMIT"); return; }
      const space = (await client.query<{ id: string; owner_user_id: string; storage_epoch: string }>("SELECT id,owner_user_id,storage_epoch FROM workspaces WHERE id=$1 FOR UPDATE", [ref.workspace_id])).rows[0];
      const work = (await client.query<Work>("SELECT * FROM task_work WHERE id=$1 FOR UPDATE", [workId])).rows[0];
      const result = space && work ? await operation(client, work, space) : undefined;
      await client.query("COMMIT"); return result;
    } catch (error) { try { await client.query("ROLLBACK"); } catch { discard = true; } throw error; }
    finally { client.release(discard); }
  }
  return {
    async process(workId: string, jobId: string, retryCount = 0) {
      return locked(workId, async (client, work, space) => {
        if (work.status !== "pending" || work.job_id !== jobId) return;
        const control = (await client.query<Control>("SELECT generation,enabled FROM worker_control WHERE id=1 FOR SHARE")).rows[0];
        // Restores remain paused until an operator reviews and requeues current work.
        if (!control.enabled || work.worker_generation !== control.generation) return;
        work.failures = Math.max(work.failures, Math.min(3, work.job_failures_base + retryCount));
        if (work.failures >= 3) {
          await client.query("UPDATE task_work SET failures=3,status='failed',updated_at=now() WHERE id=$1", [work.id]); return;
        }
        await client.query("UPDATE task_work SET failures=$2 WHERE id=$1", [work.id, work.failures]);
        const row = (await client.query<TaskRow>(`${taskSelection} WHERE t.id=$1`, [work.task_id])).rows[0];
        const task = row ? decodeTask(row, cipher) : null;
        async function status(value: "stopped" | "processed") {
          await client.query("UPDATE task_work SET status=$2,updated_at=now() WHERE id=$1", [work.id, value]);
          if (task) await appendOnlineChange(client, space.id, "tasks", task.childId);
        }
        if (!task || task.version !== work.task_version || task.occurrence.id !== work.occurrence_id || task.occurrence.state !== "scheduled" || space.storage_epoch !== work.storage_epoch) {
          await status("stopped"); return;
        }
        const { actorUserId } = JSON.parse(cipher.decrypt(work.payload_encrypted, payloadContext(work.id))) as { actorUserId: string };
        // Membership is read after taking the parent lock, including the issuer of this revision.
        const members = (await client.query<{ user_id: string }>("SELECT user_id FROM family_members WHERE workspace_id=$1 AND role='caregiver'", [space.id])).rows;
        const eligible = (id: string) => id === space.owner_user_id || members.some(member => member.user_id === id);
        if (!eligible(actorUserId) || !eligible(task.assigneeUserId)) { await status("stopped"); return; }
        // Serializes recipients across workspaces and with preference changes; no network I/O follows.
        await client.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [task.assigneeUserId]);
        const preference = (await client.query<{ preferences_encrypted: string; version: number }>("SELECT preferences_encrypted,version FROM notification_preferences WHERE user_id=$1", [task.assigneeUserId])).rows[0];
        const prefs: NotificationPreferences = preference
          ? { ...JSON.parse(cipher.decrypt(preference.preferences_encrypted, `notification-preferences:${task.assigneeUserId}`)), version: preference.version }
          : DEFAULT_NOTIFICATION_PREFERENCES;
        const now = (await client.query<{ at: string }>("SELECT clock_timestamp()::text AS at")).rows[0].at;
        const key = task.kind === "ordinary" ? reminderLocalTime(now, prefs.timeZone).day : task.occurrence.id;
        const prior = (await client.query<{ phase: string; at: string }>("SELECT phase,created_at::text AS at FROM task_reminders WHERE occurrence_id=$1", [task.occurrence.id])).rows;
        const batch = (await client.query<{ id: string; state: string; at: string }>("SELECT id,state,created_at::text AS at FROM task_reminder_batches WHERE recipient_user_id=$1 AND category=$2 AND batch_key=$3", [task.assigneeUserId, task.kind, key])).rows[0];
        const evidence: ReminderEvidence = { authorized: true, assigneeEligible: true, deliveryUnknown: false,
          initialAt: prior.find(value => value.phase === "initial")?.at ?? null,
          followUpAt: prior.find(value => value.phase === "follow_up")?.at ?? null,
          lastOrdinaryBatchAt: task.kind === "ordinary" && batch?.state === "sealed" ? batch.at : null };
        const decision = reminderDecision(task, prefs, evidence, now);
        async function defer(at: string | null) {
          if (!at) { await status("processed"); return; }
          const nextJob = randomUUID();
          await queue.enqueue(client, nextJob, work.id, at, work.failures);
          await client.query("UPDATE task_work SET job_id=$2,run_at=$3,job_failures_base=failures,updated_at=now() WHERE id=$1", [work.id, nextJob, at]);
        }
        if (decision !== "initial" && decision !== "follow_up") {
          await defer(nextReminderCheck(task, prefs, evidence, now)); return;
        }
        const batchId = batch?.id ?? randomUUID();
        if (!batch) await client.query("INSERT INTO task_reminder_batches(id,recipient_user_id,category,batch_key) VALUES($1,$2,$3,$4)", [batchId, task.assigneeUserId, task.kind, key]);
        const inserted = await client.query<{ id: string }>(`INSERT INTO task_reminders(id,batch_id,task_id,occurrence_id,task_version,phase) VALUES($1,$2,$3,$4,$5,$6)
          ON CONFLICT(occurrence_id,phase) DO NOTHING RETURNING id`, [randomUUID(), batchId, task.id, task.occurrence.id, task.version, decision]);
        if (inserted.rows[0] && onReminder) await onReminder(client, work.id, inserted.rows[0].id);
        await appendOnlineChange(client, space.id, "tasks", task.childId, false, task.assigneeUserId);
        if (task.kind === "ordinary" && decision === "initial") {
          await defer(nextReminderCheck(task, prefs, { ...evidence, initialAt: now }, now));
        } else await status("processed");
      });
    },
    async failed(workId: string, jobId: string, attempts: number) {
      await locked(workId, async (client, work, space) => {
        if (work.status !== "pending" || work.job_id !== jobId) return;
        const control = (await client.query<Control>("SELECT generation,enabled FROM worker_control WHERE id=1 FOR SHARE")).rows[0];
        if (!control.enabled || control.generation !== work.worker_generation) return;
        const count = Math.min(3, Math.max(work.failures, work.job_failures_base + attempts));
        await client.query("UPDATE task_work SET failures=$2,status=CASE WHEN $2>=3 THEN 'failed' ELSE status END,updated_at=now() WHERE id=$1", [work.id, count]);
        const child = (await client.query<{ child_id: string }>("SELECT child_id FROM care_tasks WHERE id=$1", [work.task_id])).rows[0];
        if (child) await appendOnlineChange(client, space.id, "tasks", child.child_id);
      });
    },
    async unavailable(workId: string, jobId: string) {
      await locked(workId, async (client, work, space) => {
        if (work.status !== "pending" || work.job_id !== jobId) return;
        const control = (await client.query<Control>("SELECT generation,enabled FROM worker_control WHERE id=1 FOR SHARE")).rows[0];
        if (!control.enabled || control.generation !== work.worker_generation) return;
        // A missing/cancelled framework job is not evidence that the care task completed.
        await client.query("UPDATE task_work SET status='unknown',updated_at=now() WHERE id=$1", [work.id]);
        const child = (await client.query<{ child_id: string }>("SELECT child_id FROM care_tasks WHERE id=$1", [work.task_id])).rows[0];
        if (child) await appendOnlineChange(client, space.id, "tasks", child.child_id);
      });
    },
  };
}
