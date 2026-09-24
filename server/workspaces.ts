import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export interface Workspace {
  id: string;
  storageEpoch: string;
  createdAt: string;
}

export interface WorkspaceStore {
  listForUser(userId: string): Promise<Workspace[]>;
  getForUser(userId: string, workspaceId: string): Promise<Workspace | null>;
  ensureForUser(userId: string): Promise<Workspace>;
}

interface WorkspaceRow {
  id: string;
  storage_epoch: string;
  created_at: Date;
}

function toWorkspace(row: WorkspaceRow): Workspace {
  return { id: row.id, storageEpoch: row.storage_epoch, createdAt: row.created_at.toISOString() };
}

export function createWorkspaceStore(pool: Pool): WorkspaceStore {
  return {
    async listForUser(userId) {
      const result = await pool.query<WorkspaceRow>(
        `SELECT w.id,w.storage_epoch,w.created_at FROM workspaces w WHERE w.owner_user_id=$1
          OR EXISTS(SELECT 1 FROM family_members m WHERE m.workspace_id=w.id AND m.user_id=$1) ORDER BY w.created_at`, [userId],
      );
      return result.rows.map(toWorkspace);
    },
    async getForUser(userId, workspaceId) {
      const result = await pool.query<WorkspaceRow>(
        `SELECT w.id,w.storage_epoch,w.created_at FROM workspaces w WHERE w.id=$2 AND (w.owner_user_id=$1
          OR EXISTS(SELECT 1 FROM family_members m WHERE m.workspace_id=w.id AND m.user_id=$1))`, [userId, workspaceId],
      );
      return result.rows[0] ? toWorkspace(result.rows[0]) : null;
    },
    async ensureForUser(userId) {
      const result = await pool.query<WorkspaceRow>(
        `INSERT INTO workspaces (id, owner_user_id, storage_epoch)
         VALUES ($1, $2, $3)
         ON CONFLICT (owner_user_id) DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id
         RETURNING id, storage_epoch, created_at`,
        [randomUUID(), userId, randomUUID()],
      );
      return toWorkspace(result.rows[0]!);
    },
  };
}
