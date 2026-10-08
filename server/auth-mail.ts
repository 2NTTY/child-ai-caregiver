import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import { accountEmailHash, normalizeAccountEmail } from "./account-admission.ts";
import type { StorageCipher } from "./storage-crypto.ts";
import { databaseAdapter } from "./worker-queue.ts";

export const AUTH_MAIL_QUEUE = "account-auth-mail-v1";
export const AUTH_MAIL_OPTIONS = { heartbeatSeconds: 20, expireInSeconds: 30, retryLimit: 0,
  retryBackoff: false, retentionSeconds: 86400, deleteAfterSeconds: 7 * 86400 };
export const authMailJobSchema = z.object({ mailId: z.uuid(), jobId: z.uuid() }).strict();
export type AuthMailJob = z.infer<typeof authMailJobSchema>;
export type AuthMailKind = "verify" | "reset";
export type AuthMailState = "queued" | "sending" | "accepted" | "failed" | "unknown" | "expired";
export interface AuthMailNativeInput { user: { id: string; email: string }; url: string; token: string }
export interface AuthMailOrigins { publicOrigin: string; webOrigin: string }
export const authMailPayloadSchema = z.object({ email: z.email().max(320), url: z.string().max(8192) }).strict();
export const authMailAad = (id: string) => "auth-mail:" + id;
export function accountAuthCallbackUrls(origins: AuthMailOrigins): { verify: string; reset: string } {
  return { verify: new URL("/?account=verified", origins.webOrigin).href,
    reset: new URL("/?account=reset", origins.webOrigin).href };
}
export function validateAuthCallback(value: unknown, origins: AuthMailOrigins): void {
  if (value === undefined || value === null || value === "") return;
  try {
    if (typeof value !== "string" || value.length > 2048 || /[\\\s\u0000-\u001f\u007f]/u.test(value)) throw new Error();
    const url = new URL(value, origins.publicOrigin);
    if (url.username || url.password || url.hash || ![origins.publicOrigin, origins.webOrigin].includes(url.origin)) throw new Error();
  } catch { throw new Error("account_auth_callback_invalid"); }
}
export function normalizeAuthMailUrl(kind: AuthMailKind, input: { url: string; token?: string }, origins: AuthMailOrigins): string {
  try {
    if (input.url.length > 8192) throw new Error();
    const url = new URL(input.url);
    if (url.origin !== origins.publicOrigin || url.username || url.password || url.hash) throw new Error();
    if (kind === "verify") {
      if (url.pathname !== "/api/auth/verify-email" || !url.searchParams.get("token") || (input.token && url.searchParams.get("token") !== input.token)) throw new Error();
    } else if (!/^\/api\/auth\/reset-password\/[A-Za-z0-9_-]{16,256}$/u.test(url.pathname)
      || (input.token && url.pathname.split("/").at(-1) !== input.token)) throw new Error();
    const allowedKeys = kind === "verify" ? ["token", "callbackURL"] : ["callbackURL"];
    for (const key of url.searchParams.keys()) if (!allowedKeys.includes(key) || url.searchParams.getAll(key).length !== 1) throw new Error();
    validateAuthCallback(url.searchParams.get("callbackURL"), origins);
    url.searchParams.set("callbackURL", accountAuthCallbackUrls(origins)[kind]);
    return url.href;
  } catch { throw new Error("account_auth_mail_url_invalid"); }
}

export function createAuthMail(pool: Pool, cipher: StorageCipher, boss: PgBoss, origins: AuthMailOrigins) {
  async function enqueue(kind: AuthMailKind, input: AuthMailNativeInput): Promise<void> {
    if (!input.user.id || input.user.id.length > 200) throw new Error("account_auth_mail_user_invalid");
    const email = normalizeAccountEmail(input.user.email);
    const url = normalizeAuthMailUrl(kind, input, origins), emailHash = accountEmailHash(email);
    const client = await pool.connect(); let failed = false;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(173062,hashtext($1))", [emailHash]);
      const rate = (await client.query<{ total: number; recent: number }>(`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE created_at>now()-interval '1 minute')::int AS recent
        FROM auth_mail_outbox WHERE email_hash=$1 AND created_at>now()-interval '1 hour'`, [emailHash])).rows[0];
      // Preserve native generic responses for nonexistent, existing or rate-limited identities.
      if (rate && (rate.recent >= 1 || rate.total >= 5)) { await client.query("COMMIT"); return; }
      const control = (await client.query<{ generation: string }>("SELECT generation FROM worker_control WHERE id=1 FOR SHARE")).rows[0];
      if (!control) throw new Error("account_auth_mail_control_unavailable");
      const mailId = randomUUID(), jobId = randomUUID();
      const payload = cipher.encrypt(JSON.stringify({ email, url }), authMailAad(mailId));
      await client.query(`INSERT INTO auth_mail_outbox(id,job_id,user_id,email_hash,kind,state,payload_encrypted,worker_generation,expires_at)
        VALUES($1,$2,$3,$4,$5,'queued',$6,$7,now()+interval '45 minutes')`, [mailId, jobId, input.user.id, emailHash, kind, payload, control.generation]);
      const confirmed = await boss.send(AUTH_MAIL_QUEUE, { mailId, jobId }, { ...AUTH_MAIL_OPTIONS, id: jobId,
        startAfter: new Date(Date.now() + 5000).toISOString(), db: databaseAdapter(client) });
      if (confirmed !== jobId) throw new Error("account_auth_mail_enqueue_unconfirmed");
      await client.query("COMMIT");
    } catch { try { await client.query("ROLLBACK"); } catch { failed = true; } throw new Error("account_auth_mail_enqueue_failed"); }
    finally { client.release(failed); }
  }
  return { sendVerificationEmail: (input: AuthMailNativeInput) => enqueue("verify", input),
    sendResetPassword: (input: AuthMailNativeInput) => enqueue("reset", input) };
}
export type AuthMail = ReturnType<typeof createAuthMail>;
