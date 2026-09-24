import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { FamilyInvitation, FamilySpace, InvitationPreview, MemberRole, NotificationPreferences } from "../src/shared/family.ts";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "../src/shared/family.ts";
import type { StorageCipher } from "./storage-crypto.ts";
import { FamilyError, READ_ROLES, requireFamilyVersion, withWorkspaceAccess } from "./family-access.ts";

interface InviteRow {
  id: string; workspace_id: string; email_encrypted: string; role: MemberRole; expires_at: Date;
  accepted_at: Date | null; accepted_by: string | null; revoked_at: Date | null;
}
const emailContext = (row: Pick<InviteRow, "id" | "workspace_id">) => `family-invitation:${row.workspace_id}:${row.id}:email`;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const emailKey = (email: string) => email.trim().toLowerCase();

export function createFamilyStore(pool: Pool, cipher: StorageCipher) {
  function invitation(row: InviteRow): FamilyInvitation {
    return { id: row.id, email: cipher.decrypt(row.email_encrypted, emailContext(row)), role: row.role,
      expiresAt: row.expires_at.toISOString(), status: row.revoked_at ? "revoked" : row.accepted_at ? "accepted"
        : row.expires_at.getTime() <= Date.now() ? "expired" : "pending" };
  }
  async function checkInvitation(userId: string, token: string, acceptWorkspace?: string): Promise<InvitationPreview> {
    const found = (await pool.query<InviteRow>("SELECT * FROM family_invitations WHERE token_hash=$1", [hashToken(token)])).rows[0];
    if (!found || (acceptWorkspace !== undefined && found.workspace_id !== acceptWorkspace)) throw new FamilyError(404, "invitation_unavailable");
    // The recipient is not a member yet; lock the workspace directly, then reread the invitation.
    const client = await pool.connect();
    let discard = false;
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='5s'");
      const space = (await client.query<{ owner_user_id: string }>("SELECT owner_user_id FROM workspaces WHERE id=$1 FOR UPDATE", [found.workspace_id])).rows[0];
      const row = (await client.query<InviteRow>("SELECT * FROM family_invitations WHERE id=$1 AND token_hash=$2", [found.id, hashToken(token)])).rows[0];
      const user = (await client.query<{ email: string }>('SELECT email FROM "user" WHERE id=$1', [userId])).rows[0];
      if (!space || !row || !user || row.revoked_at || row.expires_at.getTime() <= Date.now()
        || emailKey(cipher.decrypt(row.email_encrypted, emailContext(row))) !== emailKey(user.email)
        || space.owner_user_id === userId) throw new FamilyError(404, "invitation_unavailable");
      const member = (await client.query("SELECT role FROM family_members WHERE workspace_id=$1 AND user_id=$2", [row.workspace_id, userId])).rows[0];
      // A used invite cannot restore revoked access or change an existing member's role.
      if (row.accepted_at && (row.accepted_by !== userId || !member)) throw new FamilyError(404, "invitation_unavailable");
      if (acceptWorkspace !== undefined && !row.accepted_at) {
        if (member) throw new FamilyError(409, "already_member");
        await client.query("INSERT INTO family_members(workspace_id,user_id,role) VALUES($1,$2,$3)", [row.workspace_id, userId, row.role]);
        await client.query("UPDATE family_invitations SET accepted_at=now(),accepted_by=$2 WHERE id=$1", [row.id, userId]);
        await client.query("UPDATE workspaces SET access_version=access_version+1 WHERE id=$1", [row.workspace_id]);
      }
      const owner = (await client.query<{ name: string }>('SELECT name FROM "user" WHERE id=$1', [space.owner_user_id])).rows[0];
      await client.query("COMMIT");
      return { workspaceId: row.workspace_id, ownerName: owner.name, role: row.role, expiresAt: row.expires_at.toISOString() };
    } catch (error) { try { await client.query("ROLLBACK"); } catch { discard = true; } throw error; }
    finally { client.release(discard); }
  }
  return {
    async list(userId: string): Promise<FamilySpace[]> {
      const ids = await pool.query<{ id: string }>(`SELECT w.id FROM workspaces w WHERE w.owner_user_id=$1
        OR EXISTS(SELECT 1 FROM family_members m WHERE m.workspace_id=w.id AND m.user_id=$1) ORDER BY w.created_at,w.id`, [userId]);
      const spaces: FamilySpace[] = [];
      for (const { id } of ids.rows) {
        try {
          spaces.push(await withWorkspaceAccess(pool, userId, id, READ_ROLES, async (client, role, version) => {
            const members = await client.query<{ user_id: string; name: string; role: "owner" | MemberRole }>(`SELECT u.id AS user_id,u.name,'owner' AS role FROM workspaces w JOIN "user" u ON u.id=w.owner_user_id WHERE w.id=$1
              UNION ALL SELECT u.id,u.name,m.role FROM family_members m JOIN "user" u ON u.id=m.user_id WHERE m.workspace_id=$1`, [id]);
            const invitations = role === "owner" ? (await client.query<InviteRow>("SELECT * FROM family_invitations WHERE workspace_id=$1 ORDER BY (accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now()) DESC,created_at DESC,id LIMIT 100", [id])).rows.map(invitation) : [];
            return { id, ownerName: members.rows.find(member => member.role === "owner")!.name, role, version,
              members: members.rows.map(member => ({ userId: member.user_id, name: member.name, role: member.role })), invitations };
          }));
        } catch (error) { if (!(error instanceof FamilyError && error.status === 404)) throw error; }
      }
      return spaces;
    },
    async invite(userId: string, workspaceId: string, email: string, role: MemberRole, expectedVersion: number) {
      return withWorkspaceAccess(pool, userId, workspaceId, ["owner"], async (client, _role, version) => {
        requireFamilyVersion(version, expectedVersion);
        const pending = await client.query<InviteRow>("SELECT * FROM family_invitations WHERE workspace_id=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now()", [workspaceId]);
        if (pending.rows.length >= 20 || pending.rows.some(row => emailKey(invitation(row).email) === emailKey(email))) throw new FamilyError(409, "invitation_conflict");
        const member = await client.query(`SELECT 1 FROM "user" u WHERE lower(u.email)=$2 AND (u.id=$3 OR EXISTS(SELECT 1 FROM family_members m WHERE m.workspace_id=$1 AND m.user_id=u.id))`, [workspaceId, emailKey(email), userId]);
        if (member.rowCount) throw new FamilyError(409, "already_member");
        const id = randomUUID(), token = randomBytes(32).toString("base64url");
        const row = (await client.query<InviteRow>(`INSERT INTO family_invitations(id,workspace_id,token_hash,email_encrypted,role,created_by)
          VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [id, workspaceId, hashToken(token), cipher.encrypt(emailKey(email), emailContext({ id, workspace_id: workspaceId })), role, userId])).rows[0];
        await client.query("UPDATE workspaces SET access_version=access_version+1 WHERE id=$1", [workspaceId]);
        return { invitation: invitation(row), token };
      }, true);
    },
    preview: (userId: string, token: string) => checkInvitation(userId, token),
    async accept(userId: string, token: string, workspaceId: string) { await checkInvitation(userId, token, workspaceId); },
    async revokeInvite(userId: string, workspaceId: string, id: string, expectedVersion: number) {
      return withWorkspaceAccess(pool, userId, workspaceId, ["owner"], async (client, _role, version) => {
        requireFamilyVersion(version, expectedVersion);
        if (!(await client.query("UPDATE family_invitations SET revoked_at=now() WHERE id=$1 AND workspace_id=$2 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id", [id, workspaceId])).rowCount) throw new FamilyError(404, "not_found");
        await client.query("UPDATE workspaces SET access_version=access_version+1 WHERE id=$1", [workspaceId]);
      }, true);
    },
    async setMember(userId: string, workspaceId: string, memberId: string, role: MemberRole | "revoked", expectedVersion: number) {
      return withWorkspaceAccess(pool, userId, workspaceId, ["owner"], async (client, _role, version) => {
        requireFamilyVersion(version, expectedVersion);
        if (memberId === userId) throw new FamilyError(400, "owner_immutable");
        const updated = role === "revoked"
          ? await client.query("DELETE FROM family_members WHERE workspace_id=$1 AND user_id=$2 RETURNING user_id", [workspaceId, memberId])
          : await client.query("UPDATE family_members SET role=$3 WHERE workspace_id=$1 AND user_id=$2 RETURNING user_id", [workspaceId, memberId, role]);
        if (!updated.rowCount) throw new FamilyError(404, "not_found");
        await client.query("UPDATE workspaces SET access_version=access_version+1 WHERE id=$1", [workspaceId]);
      }, true);
    },
    async preferences(userId: string): Promise<NotificationPreferences> {
      const row = (await pool.query<{ preferences_encrypted: string; version: number }>("SELECT preferences_encrypted,version FROM notification_preferences WHERE user_id=$1", [userId])).rows[0];
      return row ? { ...JSON.parse(cipher.decrypt(row.preferences_encrypted, `notification-preferences:${userId}`)), version: row.version } : { ...DEFAULT_NOTIFICATION_PREFERENCES };
    },
    async savePreferences(userId: string, values: Omit<NotificationPreferences, "version">, expectedVersion: number): Promise<NotificationPreferences> {
      const client = await pool.connect();
      let discard = false;
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='5s'");
        await client.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [userId]);
        const current = (await client.query<{ version: number }>("SELECT version FROM notification_preferences WHERE user_id=$1", [userId])).rows[0]?.version ?? 0;
        requireFamilyVersion(current, expectedVersion);
        const version = current + 1;
        await client.query(`INSERT INTO notification_preferences(user_id,preferences_encrypted,version) VALUES($1,$2,$3)
          ON CONFLICT(user_id) DO UPDATE SET preferences_encrypted=EXCLUDED.preferences_encrypted,version=EXCLUDED.version,updated_at=now()`,
        [userId, cipher.encrypt(JSON.stringify(values), `notification-preferences:${userId}`), version]);
        await client.query("COMMIT");
        return { ...values, version };
      } catch (error) { try { await client.query("ROLLBACK"); } catch { discard = true; } throw error; }
      finally { client.release(discard); }
    },
  };
}
export type FamilyStore = ReturnType<typeof createFamilyStore>;
