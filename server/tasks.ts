import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { CareTask, TaskAssignee, TaskChange, TaskCreate, TaskHistory, TaskPage, TaskRevision } from "../src/shared/tasks.ts";
import { taskChangeSchema, taskCreateSchema } from "../src/shared/tasks.ts";
import { FamilyError, READ_ROLES, WRITE_ROLES, withChildAccess } from "./family-access.ts";
import type { StorageCipher } from "./storage-crypto.ts";
import { appendOnlineChange } from "./online-change.ts";
import { changeTask } from "./task-policy.ts";

interface TaskRow { id: string; child_id: string; version: number; payload_encrypted: string; occurrence_id: string; occurrence_encrypted: string }
const selection = `SELECT t.id,t.child_id,t.version,t.payload_encrypted,o.id AS occurrence_id,o.payload_encrypted AS occurrence_encrypted
  FROM care_tasks t JOIN task_occurrences o ON o.task_id=t.id`;
const context = (childId: string, id: string, version: number) => `care-task:${childId}:${id}:${version}`;
const occurrenceContext = (task: Pick<CareTask, "childId" | "id" | "version" | "occurrence">) => `${context(task.childId, task.id, task.version)}:occurrence:${task.occurrence.id}`;

export function createTaskStore(pool: Pool, cipher: StorageCipher) {
  const transaction = <T>(userId: string, childId: string, write: boolean, operation: (client: PoolClient, workspaceId: string) => Promise<T>) =>
    withChildAccess(pool, userId, childId, write ? WRITE_ROLES : READ_ROLES, (client, _role, workspaceId) => operation(client, workspaceId), write);
  async function assignees(client: PoolClient, workspaceId: string): Promise<TaskAssignee[]> {
    return (await client.query<TaskAssignee>(`SELECT u.id AS "userId",u.name FROM workspaces w JOIN "user" u ON u.id=w.owner_user_id WHERE w.id=$1
      UNION ALL SELECT u.id,u.name FROM family_members m JOIN "user" u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.role='caregiver'`, [workspaceId])).rows;
  }
  async function requireAssignee(client: PoolClient, workspaceId: string, userId: string) {
    if (!(await assignees(client, workspaceId)).some(member => member.userId === userId)) throw new FamilyError(400, "invalid_input");
  }
  function decode(row: TaskRow): CareTask {
    const value = JSON.parse(cipher.decrypt(row.payload_encrypted, context(row.child_id, row.id, row.version))) as Omit<CareTask, "occurrence">;
    const occurrence = JSON.parse(cipher.decrypt(row.occurrence_encrypted, `${context(row.child_id, row.id, row.version)}:occurrence:${row.occurrence_id}`));
    return { ...value, occurrence };
  }
  async function find(client: PoolClient, childId: string, id: string): Promise<CareTask | null> {
    const row = (await client.query<TaskRow>(`${selection} WHERE t.child_id=$1 AND t.id=$2`, [childId, id])).rows[0];
    return row ? decode(row) : null;
  }
  async function save(client: PoolClient, workspaceId: string, revision: TaskRevision, create: boolean) {
    const { task } = revision, { occurrence, ...arrangement } = task;
    const encrypted = cipher.encrypt(JSON.stringify(arrangement), context(task.childId, task.id, task.version));
    const occurrenceEncrypted = cipher.encrypt(JSON.stringify(occurrence), occurrenceContext(task));
    if (create) {
      await client.query("INSERT INTO care_tasks(id,child_id,version,payload_encrypted) VALUES($1,$2,$3,$4)", [task.id, task.childId, task.version, encrypted]);
      await client.query("INSERT INTO task_occurrences(id,task_id,due_at,state,payload_encrypted) VALUES($1,$2,$3,$4,$5)", [occurrence.id, task.id, occurrence.dueAt, occurrence.state, occurrenceEncrypted]);
    } else {
      await client.query("UPDATE care_tasks SET version=$2,payload_encrypted=$3 WHERE id=$1", [task.id, task.version, encrypted]);
      await client.query("UPDATE task_occurrences SET due_at=$2,state=$3,payload_encrypted=$4 WHERE id=$1 AND task_id=$5", [occurrence.id, occurrence.dueAt, occurrence.state, occurrenceEncrypted, task.id]);
    }
    await client.query("INSERT INTO task_revisions(task_id,version,payload_encrypted) VALUES($1,$2,$3)",
      [task.id, task.version, cipher.encrypt(JSON.stringify(revision), `${context(task.childId, task.id, task.version)}:revision`)]);
    await appendOnlineChange(client, workspaceId, "tasks", task.childId);
  }
  return {
    list(userId: string, childId: string, afterId?: string): Promise<TaskPage | null> {
      return transaction(userId, childId, false, async (client, workspaceId) => {
        const rows = (await client.query<TaskRow>(`${selection} WHERE t.child_id=$1 AND ($2::uuid IS NULL OR t.id>$2) ORDER BY t.id LIMIT 51`, [childId, afterId ?? null])).rows;
        const items = rows.slice(0, 50).map(decode);
        return { items, eligibleAssignees: await assignees(client, workspaceId), nextAfterId: rows.length > 50 ? items.at(-1)!.id : null };
      });
    },
    get: (userId: string, childId: string, id: string) => transaction(userId, childId, false, client => find(client, childId, id)),
    history(userId: string, childId: string, id: string, beforeVersion?: number): Promise<TaskHistory | null> {
      childId = childId.toLowerCase(); id = id.toLowerCase();
      return transaction(userId, childId, false, async client => {
        if (!await find(client, childId, id)) return null;
        const rows = (await client.query<{ version: number; payload_encrypted: string }>("SELECT version,payload_encrypted FROM task_revisions WHERE task_id=$1 AND ($2::integer IS NULL OR version<$2) ORDER BY version DESC LIMIT 51", [id, beforeVersion ?? null])).rows;
        const revisions = rows.slice(0, 50).map(row => JSON.parse(cipher.decrypt(row.payload_encrypted, `${context(childId, id, row.version)}:revision`)) as TaskRevision);
        return { revisions, nextBeforeVersion: rows.length > 50 ? revisions.at(-1)!.task.version : null };
      });
    },
    create(userId: string, childId: string, raw: TaskCreate): Promise<CareTask | null> {
      childId = childId.toLowerCase();
      const input = taskCreateSchema.parse(raw);
      return transaction(userId, childId, true, async (client, workspaceId) => {
        await requireAssignee(client, workspaceId, input.values.assigneeUserId);
        const now = new Date().toISOString(), { dueAt, timeZone, ...values } = input.values;
        const task: CareTask = { ...values, id: randomUUID(), childId, version: 1, createdBy: userId, createdAt: now, updatedAt: now,
          occurrence: { id: randomUUID(), dueAt, timeZone, state: "scheduled", terminalBasisVersion: null } };
        await save(client, workspaceId, { task, action: "create", actorUserId: userId, basisVersion: 0, note: "", at: now }, true);
        return task;
      });
    },
    change(userId: string, childId: string, id: string, raw: TaskChange): Promise<CareTask | null> {
      const input = taskChangeSchema.parse(raw);
      return transaction(userId, childId, true, async (client, workspaceId) => {
        const current = await find(client, childId, id);
        if (!current) return null;
        if (input.action === "reschedule") await requireAssignee(client, workspaceId, input.assigneeUserId);
        const now = new Date().toISOString(), task = changeTask(current, input, now);
        await save(client, workspaceId, { task, action: input.action, actorUserId: userId, basisVersion: input.expectedVersion, note: input.note, at: now }, false);
        return task;
      });
    },
  };
}
export type TaskStore = ReturnType<typeof createTaskStore>;
