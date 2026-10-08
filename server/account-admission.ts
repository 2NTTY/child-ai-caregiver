import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { accountAcknowledgementSchema, SERVICE_DATA_NOTICE, SERVICE_POLICY_VERSION, type AccountServiceStatus } from "../src/shared/account-service.ts";

export class AccountServiceError extends Error {
  readonly status: 400 | 401 | 403 | 409 | 429 | 503;
  readonly code: string;
  constructor(status: AccountServiceError["status"], code: string) { super(code); this.status = status; this.code = code; }
}
export { AccountServiceError as AccountAdmissionError };
export function normalizeAccountEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!z.email().max(320).safeParse(normalized).success) throw new AccountServiceError(400, "account_email_invalid");
  return normalized;
}
export function accountEmailHash(email: string): string { return createHash("sha256").update(normalizeAccountEmail(email)).digest("hex"); }
interface AdmissionRow {
  id: string; email: string; email_verified: boolean; admitted: boolean; invitation_live: boolean;
  acknowledgement_version: string | null;
}

export function createAccountAdmission(pool: Pool, options: { enabled: boolean; mailConfigured: boolean }) {
  async function transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect(); let failed = false;
    try { await client.query("BEGIN"); const result = await operation(client); await client.query("COMMIT"); return result; }
    catch (error) { try { await client.query("ROLLBACK"); } catch { failed = true; } throw error; }
    finally { client.release(failed); }
  }
  async function readUser(userId: string, client: Pool | PoolClient = pool): Promise<AdmissionRow | null> {
    return (await client.query<AdmissionRow>(`SELECT u.id,u.email,u."emailVerified" AS email_verified,
      a.user_id IS NOT NULL AS admitted,a.acknowledgement_version,
      (a.source='legacy' OR (i.id IS NOT NULL AND i.revoked_at IS NULL AND i.bound_user_id=u.id)) AS invitation_live
      FROM "user" u LEFT JOIN account_admissions a ON a.user_id=u.id
      LEFT JOIN account_invitations i ON i.id=a.invitation_id WHERE u.id=$1`, [userId])).rows[0] ?? null;
  }
  async function assertCanRegister(email: string): Promise<void> {
    if (!options.enabled) return;
    const row = (await pool.query(`SELECT 1 FROM account_invitations WHERE email_hash=$1 AND revoked_at IS NULL
      AND consumed_at IS NULL AND expires_at>now() LIMIT 1`, [accountEmailHash(email)])).rows[0];
    if (!row) throw new AccountServiceError(403, "invitation_required");
  }
  async function admit(userId: string, email: string): Promise<void> {
    const hash = accountEmailHash(email);
    await transaction(async client => {
      const user = (await client.query<{ email: string }>('SELECT email FROM "user" WHERE id=$1 FOR UPDATE', [userId])).rows[0];
      if (!user || accountEmailHash(user.email) !== hash) throw new AccountServiceError(403, "invitation_required");
      const existing = (await client.query("SELECT 1 FROM account_admissions WHERE user_id=$1", [userId])).rows[0];
      if (existing) return;
      if (!options.enabled) {
        await client.query("INSERT INTO account_admissions(user_id,source) VALUES($1,'legacy')", [userId]); return;
      }
      const invitation = (await client.query<{ id: string }>(`SELECT id FROM account_invitations WHERE email_hash=$1
        AND revoked_at IS NULL AND consumed_at IS NULL AND expires_at>now() ORDER BY created_at,id LIMIT 1 FOR UPDATE`, [hash])).rows[0];
      if (!invitation) throw new AccountServiceError(403, "invitation_required");
      const consumed = await client.query(`UPDATE account_invitations SET bound_user_id=$2,consumed_at=now()
        WHERE id=$1 AND revoked_at IS NULL AND consumed_at IS NULL AND expires_at>now() RETURNING id`, [invitation.id, userId]);
      if (consumed.rowCount !== 1) throw new AccountServiceError(403, "invitation_required");
      await client.query("INSERT INTO account_admissions(user_id,source,invitation_id) VALUES($1,'invitation',$2)", [userId, invitation.id]);
    });
  }
  async function assertSessionAdmission(userId: string): Promise<void> {
    if (!options.enabled) return;
    let user = await readUser(userId);
    if (!user) throw new AccountServiceError(403, "invitation_required");
    // A committed native user may survive a failed after hook. Repair only with a still-valid invitation.
    if (!user.admitted) { await admit(userId, user.email); user = await readUser(userId); }
    if (!user?.admitted || !user.invitation_live) throw new AccountServiceError(403, "invitation_required");
  }
  async function status(userId: string | null): Promise<AccountServiceStatus> {
    const row = userId ? await readUser(userId) : null;
    return { enabled: options.enabled, registration: options.enabled ? "invite" : "trial", mailConfigured: options.mailConfigured,
      policyVersion: SERVICE_POLICY_VERSION, notice: SERVICE_DATA_NOTICE,
      user: row ? { id: row.id, emailVerified: row.email_verified, acknowledged: row.acknowledgement_version === SERVICE_POLICY_VERSION,
        acknowledgementVersion: row.acknowledgement_version } : null };
  }
  async function acknowledge(userId: string, input: unknown): Promise<AccountServiceStatus> {
    const parsed = accountAcknowledgementSchema.safeParse(input);
    if (!parsed.success) throw new AccountServiceError(400, "account_acknowledgement_invalid");
    await transaction(async client => {
      await client.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [userId]);
      const row = await readUser(userId, client);
      if (!row) throw new AccountServiceError(401, "unauthorized");
      if (!row.email_verified) throw new AccountServiceError(403, "email_verification_required");
      if (!row.admitted || !row.invitation_live) throw new AccountServiceError(403, "invitation_required");
      await client.query(`UPDATE account_admissions SET acknowledgement_version=$2,acknowledged_at=now(),acknowledgement_operation_id=$3
        WHERE user_id=$1 AND acknowledgement_version IS DISTINCT FROM $2`, [userId, parsed.data.policyVersion, parsed.data.operationId]);
    });
    return status(userId);
  }
  async function assertUsable(userId: string): Promise<void> {
    if (!options.enabled) return;
    const row = await readUser(userId);
    if (!row) throw new AccountServiceError(401, "unauthorized");
    if (!row.admitted || !row.invitation_live) throw new AccountServiceError(403, "invitation_required");
    if (!row.email_verified) throw new AccountServiceError(403, "email_verification_required");
    if (row.acknowledgement_version !== SERVICE_POLICY_VERSION) throw new AccountServiceError(403, "service_consent_required");
  }
  return { enabled: options.enabled, assertCanRegister, admit, assertSessionAdmission, status, acknowledge, assertUsable };
}
export type AccountAdmission = ReturnType<typeof createAccountAdmission>;
