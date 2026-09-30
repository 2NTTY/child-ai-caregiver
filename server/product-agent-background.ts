import type { Pool, PoolClient } from "pg";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import type { StorageCipher } from "./storage-crypto.ts";
import type { ProductAgent } from "./product-agent.ts";
import { databaseAdapter } from "./worker-queue.ts";
import { withChildAccess, WRITE_ROLES } from "./family-access.ts";
import { createTaskStore } from "./tasks.ts";
import { transactionPool } from "./transaction-pool.ts";

import { AGENT_DUE_QUEUE, AGENT_DUE_OPTIONS } from "./agent-event-types.ts";
const inputSchema = z.object({ workId: z.uuid(), reminderId: z.uuid(), workerGeneration: z.uuid(), storageEpoch: z.uuid() }).strict();
type EventReference = z.infer<typeof inputSchema>;

export function createAgentBackground(pool: Pool, cipher: StorageCipher, boss: PgBoss, agent: ProductAgent) {
  const cancellation = new AbortController();
  async function current(ref: EventReference) {
    const routing = (await pool.query<{ child_id: string; recipient_user_id: string }>(
      "SELECT t.child_id,b.recipient_user_id FROM task_reminders r JOIN care_tasks t ON t.id=r.task_id JOIN task_reminder_batches b ON b.id=r.batch_id WHERE r.id=$1", [ref.reminderId])).rows[0];
    if (!routing || cancellation.signal.aborted) return null;
    return withChildAccess(pool, routing.recipient_user_id, routing.child_id, WRITE_ROLES, async (client, _role, workspaceId) => {
      const row = (await client.query<{ task_id: string; task_version: number; occurrence_id: string; phase: string; payload_encrypted: string }>(
        "SELECT r.task_id,r.task_version,r.occurrence_id,r.phase,w.payload_encrypted FROM task_reminders r JOIN task_reminder_batches b ON b.id=r.batch_id JOIN task_work w ON w.id=$2 AND w.task_id=r.task_id AND w.task_version=r.task_version AND w.occurrence_id=r.occurrence_id JOIN worker_control c ON c.id=1 AND c.enabled AND c.generation=w.worker_generation JOIN workspaces s ON s.id=$3 AND s.storage_epoch=w.storage_epoch WHERE r.id=$1 AND b.recipient_user_id=$4 AND w.status IN ('pending','processed') AND w.worker_generation=$5 AND w.storage_epoch=$6",
        [ref.reminderId, ref.workId, workspaceId, routing.recipient_user_id, ref.workerGeneration, ref.storageEpoch])).rows[0];
      if (!row) return null;
      const borrowed = transactionPool(client), task = await createTaskStore(borrowed.pool, cipher).get(routing.recipient_user_id, routing.child_id, row.task_id);
      borrowed.assertReleased();
      if (!task || task.version !== row.task_version || task.occurrence.id !== row.occurrence_id
        || task.occurrence.state !== "scheduled" || task.assigneeUserId !== routing.recipient_user_id) return null;
      const actor = JSON.parse(cipher.decrypt(row.payload_encrypted, "task-work:" + ref.workId)) as { actorUserId: string };
      const issuer = await client.query("SELECT 1 FROM workspaces s WHERE s.id=$1 AND (s.owner_user_id=$2 OR EXISTS(SELECT 1 FROM family_members m WHERE m.workspace_id=s.id AND m.user_id=$2 AND m.role='caregiver'))", [workspaceId, actor.actorUserId]);
      if (!issuer.rowCount) return null;
      return { userId: routing.recipient_user_id, childId: routing.child_id, task, phase: row.phase };
    });
  }
  return {
    async enqueue(client: PoolClient, workId: string, reminderId: string) {
      const original = (await client.query<{ worker_generation: string; storage_epoch: string }>("SELECT worker_generation,storage_epoch FROM task_work WHERE id=$1", [workId])).rows[0];
      if (!original) throw new Error("agent_event_source_missing");
      const data = inputSchema.parse({ workId, reminderId, workerGeneration: original.worker_generation, storageEpoch: original.storage_epoch });
      const sent = await boss.send(AGENT_DUE_QUEUE, data, { ...AGENT_DUE_OPTIONS, id: reminderId, db: databaseAdapter(client) });
      if (sent !== reminderId) throw new Error("agent_event_enqueue_unconfirmed");
    },
    async start() {
      if (!await boss.getQueue(AGENT_DUE_QUEUE)) throw new Error("agent_event_queue_missing");
      await boss.work<EventReference>(AGENT_DUE_QUEUE, { batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 2 }, async jobs => {
        for (const job of jobs) {
          const reference = inputSchema.parse(job.data);
          if (job.id !== reference.reminderId) throw new Error("agent_event_invalid");
          const event = await current(reference);
          if (!event) continue;
          // No transaction remains open while the model or embedding service is called.
          await agent.background({ userId: event.userId, childId: event.childId, reference: reference.reminderId,
            context: { task: event.task, phase: event.phase, purpose: "station_only_due_task_briefing", externalContactAuthorized: false },
            authorize: async () => Boolean(await current(reference)), signal: cancellation.signal });
        }
      });
    },
    stop() { cancellation.abort(); },
  };
}
