import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import type { Pool, PoolClient } from "pg";
import type { PgBoss } from "pg-boss";
import { accountEmailHash, type AccountAdmission } from "./account-admission.ts";
import { isSmtpLoopback, type AccountSmtpConfig } from "./account-service-config.ts";
import { AUTH_MAIL_QUEUE, authMailAad, authMailJobSchema, authMailPayloadSchema, normalizeAuthMailUrl,
  type AuthMailJob, type AuthMailKind, type AuthMailOrigins, type AuthMailState } from "./auth-mail.ts";
import type { StorageCipher } from "./storage-crypto.ts";

export interface AuthMailTransport {
  send(input: { email: string; url: string; mailId: string; kind: AuthMailKind }): Promise<"accepted" | "failed" | "unknown">;
  close(): void;
}
export function accountSmtpTransportOptions(config: AccountSmtpConfig): SMTPTransport.Options {
  if (config.allowInsecureLoopback && !isSmtpLoopback(config.host)) throw new Error("account_smtp_configuration_invalid");
  return { host: config.host, port: config.port, secure: config.secure,
    requireTLS: !config.allowInsecureLoopback, ignoreTLS: config.allowInsecureLoopback,
    ...(config.user ? { auth: { user: config.user, pass: config.password } } : {}),
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 10000,
    disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false, pool: false };
}
export function createAccountMailTransport(config: AccountSmtpConfig, publicOrigin: string): AuthMailTransport {
  const transport = nodemailer.createTransport(accountSmtpTransportOptions(config));
  return {
    async send(input) {
      try {
        const result = await transport.sendMail({ from: config.from, to: [{ address: input.email, name: "" }],
          envelope: { from: config.from, to: [input.email] }, messageId: `<auth-${input.mailId}@${new URL(publicOrigin).hostname}>`,
          subject: input.kind === "verify" ? "育有方：驗證你的電郵" : "育有方：重設你的密碼",
          text: input.kind === "verify" ? `請開啟以下連結驗證你的電郵：\n${input.url}\n\n連結一小時內有效。如你沒有申請帳戶，請忽略這封電郵。`
            : `請開啟以下連結重設你的密碼：\n${input.url}\n\n連結一小時內有效。如你沒有要求重設密碼，請忽略這封電郵。`,
          disableFileAccess: true, disableUrlAccess: true });
        const accepted = result.accepted?.map(value => value.toLowerCase());
        return accepted?.length === 1 && accepted[0] === input.email.toLowerCase() ? "accepted" : "failed";
      } catch (error) {
        const responseCode = error && typeof error === "object" && "responseCode" in error ? error.responseCode : undefined;
        return typeof responseCode === "number" && responseCode >= 400 && responseCode <= 599 ? "failed" : "unknown";
      }
    },
    close() { transport.close(); },
  };
}
interface MailRow { id: string; job_id: string; user_id: string; email_hash: string; kind: AuthMailKind;
  state: AuthMailState; payload_encrypted: string; worker_generation: string; expired: boolean }

export function createAuthMailWorker(pool: Pool, boss: PgBoss, cipher: StorageCipher,
  options: AuthMailOrigins & { smtp: AccountSmtpConfig; admission: Pick<AccountAdmission, "enabled"> }, injectedTransport?: AuthMailTransport) {
  const transport = injectedTransport ?? createAccountMailTransport(options.smtp, options.publicOrigin);
  let stopping = false;
  async function transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect(); let failed = false;
    try { await client.query("BEGIN"); const result = await operation(client); await client.query("COMMIT"); return result; }
    catch { try { await client.query("ROLLBACK"); } catch { failed = true; } throw new Error("account_auth_mail_claim_failed"); }
    finally { client.release(failed); }
  }
  async function process(data: AuthMailJob, frameworkJobId: string): Promise<void> {
    const parsed = authMailJobSchema.safeParse(data);
    if (!parsed.success || parsed.data.jobId !== frameworkJobId) throw new Error("account_auth_mail_job_invalid");
    if (stopping) return;
    const prepared = await transaction(async client => {
      const row = (await client.query<MailRow>(`SELECT *,expires_at<=now() AS expired FROM auth_mail_outbox
        WHERE id=$1 AND job_id=$2 FOR UPDATE`, [data.mailId, data.jobId])).rows[0];
      if (!row || ["accepted", "failed", "unknown", "expired"].includes(row.state)) return null;
      if (row.state === "sending") {
        await client.query("UPDATE auth_mail_outbox SET state='unknown',updated_at=now() WHERE id=$1", [row.id]); return null;
      }
      const control = (await client.query<{ generation: string; enabled: boolean }>("SELECT generation,enabled FROM worker_control WHERE id=1 FOR SHARE")).rows[0];
      const user = (await client.query<{ email: string; verified: boolean; admitted: boolean }>(`SELECT u.email,u."emailVerified" AS verified,
        (a.user_id IS NOT NULL AND (a.source='legacy' OR (i.revoked_at IS NULL AND i.bound_user_id=u.id))) AS admitted
        FROM "user" u LEFT JOIN account_admissions a ON a.user_id=u.id LEFT JOIN account_invitations i ON i.id=a.invitation_id
        WHERE u.id=$1 FOR SHARE OF u`, [row.user_id])).rows[0];
      if (!control?.enabled || control.generation !== row.worker_generation || row.expired || !user || accountEmailHash(user.email) !== row.email_hash
        || (options.admission.enabled && !user.admitted) || (row.kind === "verify" && user.verified)) {
        await client.query("UPDATE auth_mail_outbox SET state='expired',updated_at=now() WHERE id=$1", [row.id]); return null;
      }
      let payload;
      try {
        payload = authMailPayloadSchema.parse(JSON.parse(cipher.decrypt(row.payload_encrypted, authMailAad(row.id))));
        if (accountEmailHash(payload.email) !== row.email_hash || normalizeAuthMailUrl(row.kind, payload, options) !== payload.url) throw new Error();
      } catch { await client.query("UPDATE auth_mail_outbox SET state='failed',updated_at=now() WHERE id=$1", [row.id]); return null; }
      await client.query("UPDATE auth_mail_outbox SET state='sending',updated_at=now() WHERE id=$1", [row.id]);
      return { email: payload.email, url: payload.url, mailId: row.id, kind: row.kind, workerGeneration: row.worker_generation };
    });
    if (!prepared) return;
    // A persisted sending claim is never automatically replayed after an uncertain external effect.
    let result: "accepted" | "failed" | "unknown" = "unknown";
    if (!stopping) {
      // Claim and SMTP are separate effects. Recheck authority after committing the sending claim.
      const current = (await pool.query<{ email: string; verified: boolean; admitted: boolean; generation: string; enabled: boolean; expired: boolean }>(`SELECT u.email,
        u."emailVerified" AS verified,c.generation,c.enabled,m.expires_at<=now() AS expired,
        (a.user_id IS NOT NULL AND (a.source='legacy' OR (i.revoked_at IS NULL AND i.bound_user_id=u.id))) AS admitted
        FROM auth_mail_outbox m JOIN worker_control c ON c.id=1 JOIN "user" u ON u.id=m.user_id
        LEFT JOIN account_admissions a ON a.user_id=u.id LEFT JOIN account_invitations i ON i.id=a.invitation_id
        WHERE m.id=$1 AND m.job_id=$2 AND m.state='sending' AND m.email_hash=$3`,
      [prepared.mailId, data.jobId, accountEmailHash(prepared.email)]).catch(() => {
        throw new Error("account_auth_mail_authority_unavailable");
      })).rows[0];
      if (!current?.enabled || current.generation !== prepared.workerGeneration || current.expired
        || accountEmailHash(current.email) !== accountEmailHash(prepared.email) || (options.admission.enabled && !current.admitted)
        || (prepared.kind === "verify" && current.verified)) {
        await pool.query("UPDATE auth_mail_outbox SET state='expired',updated_at=now() WHERE id=$1 AND state='sending'", [prepared.mailId])
          .catch(() => { throw new Error("account_auth_mail_expiry_unconfirmed"); }); return;
      }
      try { result = await transport.send(prepared); } catch { /* Keep the uncertain result without recording SMTP text. */ }
    }
    try { await pool.query("UPDATE auth_mail_outbox SET state=$2,updated_at=now() WHERE id=$1 AND state='sending'", [prepared.mailId, result]); }
    catch { throw new Error("account_auth_mail_result_unconfirmed"); }
  }
  return {
    process,
    async start() {
      const workOptions = { batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 2, includeMetadata: true } as const;
      await boss.work<AuthMailJob, void, typeof workOptions>(AUTH_MAIL_QUEUE, workOptions, async jobs => {
        for (const job of jobs) await process(job.data, job.id);
      });
    },
    async stop() { stopping = true; transport.close(); },
  };
}
