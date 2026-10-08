import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { betterAuth } from "better-auth";
import type { PgBoss, SendOptions } from "pg-boss";
import type { AccountAdmission } from "../server/account-admission.ts";
import { accountEmailHash } from "../server/account-admission.ts";
import { parseAccountSmtpConfig, readAccountServiceConfig } from "../server/account-service-config.ts";
import { AUTH_MAIL_OPTIONS, accountAuthCallbackUrls, createAuthMail, type AuthMailJob } from "../server/auth-mail.ts";
import { accountSmtpTransportOptions, createAuthMailWorker, type AuthMailTransport } from "../server/auth-mail-worker.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";

const config = { databaseUrl: "postgresql://localhost/unused", authSecret: "synthetic-a08-auth-secret-2026-native-hooks",
  publicOrigin: "http://localhost:3001", webOrigin: "http://localhost:3001", host: "127.0.0.1", port: 3001, production: false };

test("invited mode retains native verification, password reset and session hooks with strict callbacks", async context => {
  context.mock.module("better-auth", { namedExports: {
    betterAuth: (options: Parameters<typeof betterAuth>[0]) => betterAuth({ ...options,
      advanced: { ...options.advanced, database: { validateSchema: false } } }),
  } });
  const { createAuth } = await import("../server/auth.ts");
  const pool = new Pool();
  pool.connect = async () => { throw new Error("Unexpected database connection"); };
  const calls: string[] = [];
  const admission = { enabled: true,
    async assertCanRegister(email: string) { calls.push("register:" + email); },
    async admit(id: string, email: string) { calls.push("admit:" + id + ":" + email); },
    async assertSessionAdmission(id: string) { calls.push("session:" + id); },
  } as unknown as AccountAdmission;
  const mail = { async sendVerificationEmail() { calls.push("verify"); }, async sendResetPassword() { calls.push("reset"); } };
  const auth = createAuth(config, pool, { admission, mail });
  try {
    assert.equal(auth.options.emailAndPassword.requireEmailVerification, true);
    assert.equal(auth.options.emailAndPassword.revokeSessionsOnPasswordReset, true);
    assert.equal(auth.options.emailAndPassword.resetPasswordTokenExpiresIn, 3600);
    assert.equal(auth.options.emailVerification!.sendOnSignUp, true);
    assert.equal(auth.options.user.deleteUser.enabled, false);
    await auth.options.user.validateUserInfo!({ user: { email: "synthetic@example.invalid" },
      source: { action: "create-user", method: "email-password" } });
    await auth.options.databaseHooks!.user!.create!.after!({ id: "synthetic", email: "synthetic@example.invalid" } as never);
    await auth.options.databaseHooks!.session!.create!.before!({ userId: "synthetic" } as never);
    await auth.options.emailVerification!.sendVerificationEmail!({} as never);
    await auth.options.emailAndPassword.sendResetPassword!({} as never);
    assert.deepEqual(calls, ["register:synthetic@example.invalid", "admit:synthetic:synthetic@example.invalid", "session:synthetic", "verify", "reset"]);
    const foreign = await auth.handler(new Request(config.publicOrigin + "/api/auth/request-password-reset", { method: "POST",
      headers: { "content-type": "application/json", origin: config.publicOrigin },
      body: JSON.stringify({ email: "synthetic@example.invalid", redirectTo: "https://foreign.invalid/reset" }) }));
    assert.equal(foreign.status, 403);
    assert.equal((await foreign.json()).code, "INVALID_REDIRECT_URL");
    const legacy = createAuth(config, pool);
    assert.equal(legacy.options.emailAndPassword.requireEmailVerification, undefined);
    assert.equal((await readAccountServiceConfig({})).enabled, false);
    await assert.rejects(readAccountServiceConfig({ SERVICE_MODE: "invited", NODE_ENV: "production" }), /account_smtp_required/);
    const smtp = parseAccountSmtpConfig({ host: "smtp.example.invalid", port: 587, secure: false, from: "service@example.invalid" }, true);
    const options = accountSmtpTransportOptions(smtp);
    assert.equal(options.requireTLS, true); assert.equal(options.disableUrlAccess, true); assert.equal(options.disableFileAccess, true);
    assert.equal(options.socketTimeout, 10000); assert.equal(options.tls?.rejectUnauthorized, true);
    assert.throws(() => parseAccountSmtpConfig({ host: "smtp.example.invalid", port: 587, secure: false,
      from: "service@example.invalid" }, true, true), /configuration_invalid/);
    assert.equal(accountSmtpTransportOptions(parseAccountSmtpConfig({ host: "127.0.0.1", port: 2525, secure: false,
      from: "service@example.invalid" }, false, true)).requireTLS, false);
  } finally { await pool.end(); }
});

test("encrypted transaction outbox limits mail and never replays uncertain SMTP acceptance", async () => {
  const cipher = createStorageCipher(randomBytes(32));
  const email = "synthetic@example.invalid", token = "synthetic-native-token-0123456789";
  type TestMailRow = { id: string; job_id: string; user_id: string; email_hash: string; kind: string; state: string; payload_encrypted: string; worker_generation: string; expired: boolean };
  let row: TestMailRow | null = null;
  let job: AuthMailJob | undefined, sending = 0, inTransaction = false, failResult = false, live = true;
  let generation = randomUUID(), rotateBeforeSend = false;
  const sqlValues: unknown[][] = [];
  const client = { async query(sql: string, values: unknown[] = []) {
    sqlValues.push(values);
    if (sql === "BEGIN") inTransaction = true;
    if (sql === "COMMIT" || sql === "ROLLBACK") inTransaction = false;
    if (sql.startsWith("INSERT INTO auth_mail_outbox")) {
      assert.equal(inTransaction, true);
      row = { id: values[0] as string, job_id: values[1] as string, user_id: values[2] as string,
        email_hash: values[3] as string, kind: values[4] as string, state: "queued", payload_encrypted: values[5] as string,
        worker_generation: values[6] as string, expired: false };
    }
    if (sql.startsWith("SELECT count(*)")) return { rows: [{ total: row ? 1 : 0, recent: row ? 1 : 0 }] };
    if (sql.startsWith("SELECT generation")) return { rows: [{ generation, enabled: true }] };
    if (sql.startsWith("SELECT *,expires_at")) return { rows: row ? [row] : [] };
    if (sql.startsWith("SELECT u.email")) return { rows: live ? [{ email, verified: false, admitted: true, generation, enabled: true, expired: false }] : [] };
    if (sql.startsWith("UPDATE auth_mail_outbox")) {
      if (failResult && sql.includes("state=$2")) { failResult = false; throw new Error("Synthetic result loss"); }
      if (row) row.state = sql.includes("state=$2") ? values[1] as string : sql.includes("SET state='sending'") ? "sending"
        : sql.includes("state='unknown'") ? "unknown" : sql.includes("state='expired'") ? "expired" : "failed";
      if (rotateBeforeSend && sql.includes("SET state='sending'")) { generation = randomUUID(); rotateBeforeSend = false; }
    }
    return { rows: [], rowCount: 1 };
  }, release() {} } as unknown as PoolClient;
  const pool = { connect: async () => client, query: client.query.bind(client) } as unknown as Pool;
  const boss = { async send(_name: string, data: AuthMailJob, options: SendOptions) {
    assert.equal(inTransaction, true); assert.equal(options.retryLimit, 0);
    assert.ok(Date.parse(options.startAfter as string) > Date.now());
    await options.db!.executeSql("synthetic-framework-queue-write", []);
    job = data; return data.jobId;
  } } as unknown as PgBoss;
  const mail = createAuthMail(pool, cipher, boss, config);
  await assert.rejects(mail.sendVerificationEmail({ user: { id: "synthetic", email }, token,
    url: config.publicOrigin + "/api/auth/verify-email?token=" + token + "&callbackURL=https%3A%2F%2Fforeign.invalid" }), /mail_url_invalid/);
  assert.equal(row, null);
  const input = { user: { id: "synthetic", email }, token,
    url: config.publicOrigin + "/api/auth/verify-email?token=" + token + "&callbackURL=%2F" };
  await mail.sendVerificationEmail(input);
  await mail.sendVerificationEmail(input);
  assert.equal(AUTH_MAIL_OPTIONS.retryLimit, 0);
  assert.ok(job); assert.ok(row);
  const selected = row as unknown as TestMailRow;
  assert.equal(selected.email_hash, accountEmailHash(email));
  assert.ok(sqlValues.every(values => !JSON.stringify(values).includes(email) && !JSON.stringify(values).includes(token)));
  const transport: AuthMailTransport = { async send(value) { sending++; assert.equal(value.email, email);
    assert.equal(new URL(value.url).searchParams.get("callbackURL"), accountAuthCallbackUrls(config).verify); return "accepted"; }, close() {} };
  const worker = createAuthMailWorker(pool, boss, cipher, { ...config, admission: { enabled: true },
    smtp: parseAccountSmtpConfig({ host: "127.0.0.1", port: 2525, secure: false, from: "service@example.invalid" }, false, true) }, transport);
  await worker.process(job!, job!.jobId); assert.equal(selected.state, "accepted");
  await worker.process(job!, job!.jobId); assert.equal(sending, 1);
  selected.state = "queued"; failResult = true;
  await assert.rejects(worker.process(job!, job!.jobId), /result_unconfirmed/);
  assert.equal(selected.state, "sending");
  await worker.process(job!, job!.jobId); assert.equal(selected.state, "unknown"); assert.equal(sending, 2);
  selected.state = "queued"; live = false;
  await worker.process(job!, job!.jobId); assert.equal(selected.state, "expired"); assert.equal(sending, 2);
  selected.state = "queued"; live = true; rotateBeforeSend = true;
  await worker.process(job!, job!.jobId); assert.deepEqual({ state: selected.state, sends: sending }, { state: "expired", sends: 2 });
  await assert.rejects(worker.process({ mailId: job!.mailId, jobId: randomUUID() }, job!.jobId), /job_invalid/);
  await worker.stop();
});
