import type { PoolClient } from "pg";
import type { OnlineChange } from "../src/shared/online.ts";

/** Caller already holds the workspace UPDATE lock. No content enters this ledger. */
export async function appendOnlineChange(client: PoolClient, workspaceId: string,
  kind: OnlineChange["kind"], childId: string | null = null, deleted = false,
  privateUserId: string | null = null, ownerOnly = false, options: { suppressWorkWake?: boolean } = {}): Promise<string> {
  const seq = (await client.query<{ change_seq: string }>(
    "UPDATE workspaces SET change_seq=change_seq+1 WHERE id=$1 RETURNING change_seq::text", [workspaceId])).rows[0].change_seq;
  await client.query("INSERT INTO online_changes(workspace_id,change_seq,kind,child_id,private_user_id,owner_only,deleted) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [workspaceId, seq, kind, childId, privateUserId, ownerOnly, deleted]);
  if (!privateUserId && !ownerOnly && childId && ["care", "profile", "memory", "tasks", "growth", "children"].includes(kind)
    && (await client.query("SELECT 1 FROM app_migrations WHERE id='028-family-documents'")).rowCount) {
    // Revisions include archived documents: old aggregates cannot survive a source correction or deletion.
    if ((await client.query("SELECT 1 FROM app_migrations WHERE id='032-growth-report-progress'")).rowCount)
      await client.query("UPDATE family_documents SET source_revision=source_revision+1 WHERE child_id=$1", [childId]);
    // Coalesce shared source changes durably, even while workers are paused. Documents never trigger themselves.
    await client.query(`UPDATE family_documents d SET dirty=true,dirty_epoch=w.storage_epoch,dirty_generation=c.generation
      FROM workspaces w,worker_control c WHERE d.child_id=$1 AND d.status='active' AND d.auto_refresh
      AND w.id=$2 AND c.id=1`, [childId, workspaceId]);
  }
  if (!privateUserId && kind === "family" && (await client.query("SELECT 1 FROM app_migrations WHERE id='032-growth-report-progress'")).rowCount) {
    // Role changes may be owner-only online events, but every affected shared aggregate must be invalidated.
    await client.query(`UPDATE family_documents d SET source_revision=source_revision+1,
      dirty=(d.status='active' AND d.auto_refresh),dirty_epoch=w.storage_epoch,dirty_generation=c.generation
      FROM children ch,workspaces w,worker_control c WHERE ch.id=d.child_id AND w.id=ch.workspace_id AND w.id=$1 AND c.id=1`, [workspaceId]);
  }
  if (!options.suppressWorkWake && childId && ["care", "profile", "memory", "tasks", "growth", "documents", "children"].includes(kind)
    && (await client.query("SELECT 1 FROM app_migrations WHERE id='033-agent-work-continuation'")).rowCount) {
    // Wake metadata checks only. Private changes cannot wake another caregiver's work.
    await client.query(`UPDATE agent_work_followups f SET next_check_at=LEAST(COALESCE(f.next_check_at,now()),now())
      FROM workspaces w WHERE f.workspace_id=$1 AND f.child_id=$2 AND f.enabled AND f.watch_resources AND w.id=f.workspace_id
      AND ($3::text IS NULL OR f.owner_user_id=$3) AND (NOT $4::boolean OR f.owner_user_id=w.owner_user_id)`,
      [workspaceId, childId, privateUserId, ownerOnly]);
  }
  return seq;
}
