import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { TaskRevision } from "../src/shared/tasks.ts";
import type { StorageCipher } from "./storage-crypto.ts";
import { createTaskScheduling, type TaskQueue } from "./task-worker.ts";
import { decodeTask, taskSelection, type TaskRow } from "./tasks.ts";

/** Operator-only maintenance, after verifying the restored target and stopping the old source. */
export async function activateTaskWorker(pool: Pool, cipher: StorageCipher, queue: TaskQueue): Promise<number> {
  const client = await pool.connect(); let discard = false;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='5s'");
    // Preserve the runtime lock order; writers cannot add a pending row behind this scan.
    await client.query("SELECT id FROM workspaces ORDER BY id FOR UPDATE");
    const control = (await client.query<{ generation: string; enabled: boolean }>("SELECT generation,enabled FROM worker_control WHERE id=1 FOR UPDATE")).rows[0];
    if (!control || control.enabled) throw new Error("worker_must_be_paused_before_activation");
    const missing = (await client.query<TaskRow>(`${taskSelection} WHERE o.state='scheduled' AND NOT EXISTS
      (SELECT 1 FROM task_work w WHERE w.task_id=t.id AND w.task_version=t.version) ORDER BY t.id`)).rows;
    const scheduling = createTaskScheduling(cipher, queue);
    for (const row of missing) {
      const task = decodeTask(row, cipher);
      const revision = (await client.query<{ payload_encrypted: string }>("SELECT payload_encrypted FROM task_revisions WHERE task_id=$1 AND version=$2", [task.id, task.version])).rows[0];
      const confirmed = JSON.parse(cipher.decrypt(revision.payload_encrypted, `care-task:${task.childId}:${task.id}:${task.version}:revision`)) as TaskRevision;
      const child = (await client.query<{ workspace_id: string }>("SELECT workspace_id FROM children WHERE id=$1", [task.childId])).rows[0];
      await scheduling.changed(client, child.workspace_id, confirmed.actorUserId, task);
    }
    const pending = (await client.query<{ id: string; failures: number; run_at: Date; valid: boolean }>(`SELECT w.id,w.failures,w.run_at,
      (w.task_version=t.version AND w.occurrence_id=o.id AND o.state='scheduled' AND w.storage_epoch=s.storage_epoch) AS valid
      FROM task_work w JOIN care_tasks t ON t.id=w.task_id JOIN task_occurrences o ON o.task_id=t.id
      JOIN children c ON c.id=t.child_id JOIN workspaces s ON s.id=c.workspace_id WHERE w.status='pending' ORDER BY w.id FOR UPDATE OF w`)).rows;
    let count = 0;
    for (const work of pending) {
      if (!work.valid || work.failures >= 3) {
        await client.query("UPDATE task_work SET status=$2,updated_at=now() WHERE id=$1", [work.id, work.failures >= 3 ? "failed" : "stopped"]); continue;
      }
      const jobId = randomUUID();
      await queue.enqueue(client, jobId, work.id, work.run_at.toISOString(), work.failures);
      await client.query("UPDATE task_work SET job_id=$2,worker_generation=$3,job_failures_base=failures,updated_at=now() WHERE id=$1", [work.id, jobId, control.generation]);
      count++;
    }
    await client.query("UPDATE worker_control SET enabled=true WHERE id=1");
    await client.query("COMMIT"); return count;
  } catch (error) { try { await client.query("ROLLBACK"); } catch { discard = true; } throw error; }
  finally { client.release(discard); }
}
