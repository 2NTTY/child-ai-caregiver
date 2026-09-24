import type { Pool, PoolClient } from "pg";
import type { FamilyRole } from "../src/shared/family.ts";

export const READ_ROLES: readonly FamilyRole[] = ["owner", "caregiver", "viewer"];
export const WRITE_ROLES: readonly FamilyRole[] = ["owner", "caregiver"];
export class FamilyError extends Error {
  readonly status: 400 | 404 | 409;
  readonly code: string;
  constructor(status: 400 | 404 | 409, code: string) { super(code); this.status = status; this.code = code; }
}

// Workspace locks serialize revocation with protected operations. Check membership in a
// separate READ COMMITTED statement after acquiring the lock, never from an older snapshot.
export async function withWorkspaceAccess<T>(pool: Pool, userId: string, workspaceId: string,
  roles: readonly FamilyRole[], operation: (client: PoolClient, role: FamilyRole, version: number) => Promise<T>, exclusive = false): Promise<T> {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='5s'");
    const space = await client.query<{ owner_user_id: string; access_version: number }>(
      `SELECT owner_user_id, access_version FROM workspaces WHERE id=$1 FOR ${exclusive ? "UPDATE" : "SHARE"}`, [workspaceId]);
    if (!space.rows[0]) throw new FamilyError(404, "not_found");
    const role: FamilyRole | undefined = space.rows[0].owner_user_id === userId ? "owner"
      : (await client.query<{ role: FamilyRole }>("SELECT role FROM family_members WHERE workspace_id=$1 AND user_id=$2", [workspaceId, userId])).rows[0]?.role;
    if (!role || !roles.includes(role)) throw new FamilyError(404, "not_found");
    const result = await operation(client, role, space.rows[0].access_version);
    await client.query("COMMIT");
    return result;
  } catch (error) { try { await client.query("ROLLBACK"); } catch { discard = true; } throw error; }
  finally { client.release(discard); }
}

export async function withChildAccess<T>(pool: Pool, userId: string, childId: string,
  roles: readonly FamilyRole[], operation: (client: PoolClient, role: FamilyRole) => Promise<T>): Promise<T | null> {
  const row = (await pool.query<{ workspace_id: string }>("SELECT workspace_id FROM children WHERE id=$1", [childId])).rows[0];
  if (!row) return null;
  try {
    return await withWorkspaceAccess(pool, userId, row.workspace_id, roles, async (client, role) => {
      if (!(await client.query("SELECT 1 FROM children WHERE id=$1 AND workspace_id=$2", [childId, row.workspace_id])).rowCount) return null;
      return operation(client, role);
    });
  } catch (error) { if (error instanceof FamilyError && error.status === 404) return null; throw error; }
}

export function requireFamilyVersion(actual: number, expected: number) {
  if (actual !== expected) throw new FamilyError(409, "version_conflict");
}
