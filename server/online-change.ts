import type { PoolClient } from "pg";
import type { OnlineChange } from "../src/shared/online.ts";

/** Caller already holds the workspace UPDATE lock. No content enters this ledger. */
export async function appendOnlineChange(client: PoolClient, workspaceId: string,
  kind: OnlineChange["kind"], childId: string | null = null, deleted = false,
  privateUserId: string | null = null, ownerOnly = false): Promise<string> {
  const seq = (await client.query<{ change_seq: string }>(
    "UPDATE workspaces SET change_seq=change_seq+1 WHERE id=$1 RETURNING change_seq::text", [workspaceId])).rows[0].change_seq;
  await client.query("INSERT INTO online_changes(workspace_id,change_seq,kind,child_id,private_user_id,owner_only,deleted) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [workspaceId, seq, kind, childId, privateUserId, ownerOnly, deleted]);
  return seq;
}
