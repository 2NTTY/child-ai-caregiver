import type { PoolClient } from "pg";
import type { TaskReminder, TaskWorkState } from "../src/shared/tasks.ts";

/** Caller holds the authorized child's workspace lock and supplies only that page's task IDs. */
export async function readTaskWork(client: PoolClient, userId: string, taskIds: string[]) {
  const control = (await client.query<{ enabled: boolean }>("SELECT enabled FROM worker_control WHERE id=1")).rows[0];
  const reminders = (await client.query<TaskReminder>(`SELECT r.id,r.batch_id AS "batchId",r.task_id AS "taskId",r.occurrence_id AS "occurrenceId",
    r.task_version AS "taskVersion",r.phase,to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"
    FROM task_reminders r JOIN task_reminder_batches b ON b.id=r.batch_id
    JOIN care_tasks t ON t.id=r.task_id JOIN task_occurrences o ON o.id=r.occurrence_id
    JOIN children c ON c.id=t.child_id JOIN workspaces s ON s.id=c.workspace_id
    WHERE r.task_id=ANY($1::uuid[]) AND b.recipient_user_id=$2 AND r.task_version=t.version AND o.state='scheduled'
      AND (s.owner_user_id=$2 OR EXISTS(SELECT 1 FROM family_members m WHERE m.workspace_id=s.id AND m.user_id=$2 AND m.role='caregiver'))
    ORDER BY r.created_at,r.id`, [taskIds, userId])).rows;
  const work = (await client.query<TaskWorkState>(`SELECT w.task_id AS "taskId",w.task_version AS "taskVersion",w.status,w.failures,
    to_char(w.run_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "nextAt"
    FROM task_work w JOIN care_tasks t ON t.id=w.task_id WHERE w.task_id=ANY($1::uuid[]) AND w.task_version=t.version`, [taskIds])).rows;
  return { reminders, work, workerEnabled: control?.enabled === true };
}
