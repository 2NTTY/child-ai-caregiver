import { createServer } from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createAuth } from "../server/auth.ts";
import { AccountAdmissionError, accountEmailHash, createAccountAdmission } from "../server/account-admission.ts";
import { createAuthMail } from "../server/auth-mail.ts";
import { createAuthMailWorker } from "../server/auth-mail-worker.ts";
import { parseAccountSmtpConfig } from "../server/account-service-config.ts";
import { SERVICE_POLICY_VERSION } from "../src/shared/account-service.ts";

const requireResult = (condition, code) => { if (!condition) throw new Error(code); };
const cookieHeader = response => response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");

async function localSmtpReceiver(expectedEmail) {
  const messages = [], sockets = new Set();
  const server = createServer(socket => {
    sockets.add(socket);
    socket.setEncoding("utf8"); socket.setTimeout(10000, () => socket.destroy());
    let pending = "", data = false, lines = [], recipients = [];
    const reply = value => socket.write(value + "\r\n");
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    socket.on("data", chunk => {
      pending += chunk;
      if (pending.length > 65536) { socket.destroy(); return; }
      let end;
      while ((end = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, end).replace(/\r$/u, ""); pending = pending.slice(end + 1);
        if (data) {
          if (line === ".") {
            if (recipients.length !== 1 || recipients[0] !== expectedEmail || messages.length >= 2) { reply("550 Rejected"); }
            else { messages.push(lines.join("\r\n")); reply("250 Accepted"); }
            data = false; lines = []; recipients = [];
          } else {
            lines.push(line.startsWith("..") ? line.slice(1) : line);
            if (lines.join("\n").length > 32768) { socket.destroy(); return; }
          }
          continue;
        }
        if (/^(?:EHLO|HELO) /iu.test(line)) reply("250 localhost");
        else if (/^MAIL FROM:/iu.test(line)) { recipients = []; reply("250 Sender accepted"); }
        else if (/^RCPT TO:/iu.test(line)) {
          const recipient = /^RCPT TO:<([^>]+)>/iu.exec(line)?.[1]?.toLowerCase();
          if (recipient !== expectedEmail || recipients.length) reply("550 Recipient rejected");
          else { recipients.push(recipient); reply("250 Recipient accepted"); }
        } else if (line === "DATA") {
          if (recipients.length !== 1) reply("554 No recipient");
          else { data = true; lines = []; reply("354 End with a single dot"); }
        } else if (line === "QUIT") { socket.end("221 Bye\r\n"); }
        else if (line === "RSET") { recipients = []; data = false; lines = []; reply("250 Reset"); }
        else if (line === "NOOP") reply("250 OK");
        else reply("500 Unsupported command");
      }
    });
    reply("220 localhost ESMTP");
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  requireResult(address && typeof address === "object", "a08_smtp_listen_failed");
  return {
    port: address.port, messages,
    async close() { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); },
  };
}

function receivedMailUrl(raw) {
  requireResult(typeof raw === "string", "a08_smtp_mail_missing");
  const boundary = raw.indexOf("\r\n\r\n");
  requireResult(boundary >= 0, "a08_smtp_mail_invalid");
  const headers = raw.slice(0, boundary), encoded = raw.slice(boundary + 4);
  const body = /Content-Transfer-Encoding:\s*base64/iu.test(headers) ? Buffer.from(encoded.replace(/\s/gu, ""), "base64").toString("utf8")
    : /Content-Transfer-Encoding:\s*quoted-printable/iu.test(headers)
      ? encoded.replace(/=\r?\n/gu, "").replace(/=([a-f0-9]{2})/giu, (_, hex) => String.fromCharCode(parseInt(hex, 16))) : encoded;
  const url = body.match(/^https?:\/\/[^\s]+$/mu)?.[0];
  requireResult(url, "a08_smtp_mail_url_missing");
  return url;
}

// Prepare only: the primary caller owns the isolated SQL fixture, worker controls and cleanup.
// No external mail, model calls or deployment. The real one-minute email rate window is retained.
export async function runAuthAcceptance({ pool, cipher, boss, config }) {
  const loopback = origin => {
    const url = new URL(origin);
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  };
  requireResult(!config.production && loopback(config.publicOrigin) && loopback(config.webOrigin), "a08_local_origin_required");
  const runId = randomUUID(), email = `a08-${runId}@example.invalid`, otherEmail = `a08-uninvited-${runId}@example.invalid`;
  const originalPassword = "SyntheticOriginal-" + randomBytes(18).toString("hex"), password = "SyntheticReplacement-" + randomBytes(18).toString("hex");
  let receiver, worker, userId = null, stage = "setup", httpCalls = 0, businessCalls = 0, lastHttpStatus = null;
  const evidence = () => ({ runId, userId, stage, httpCalls, businessCalls, lastHttpStatus, localSmtpAccepted: receiver?.messages.length ?? 0 });
  const business = async operation => { businessCalls++; requireResult(businessCalls <= 12, "a08_business_budget_exceeded"); return operation(); };
  try {
    await business(async () => requireResult((await pool.query("SELECT enabled FROM worker_control WHERE id=1")).rows[0]?.enabled === true,
      "a08_worker_control_must_be_enabled"));
    receiver = await localSmtpReceiver(email);
    const admission = createAccountAdmission(pool, { enabled: true, mailConfigured: true });
    const mail = createAuthMail(pool, cipher, boss, config), auth = createAuth(config, pool, { admission, mail });
    const smtp = parseAccountSmtpConfig({ host: "127.0.0.1", port: receiver.port, secure: false, from: "service@example.invalid" }, false, true);
    worker = createAuthMailWorker(pool, boss, cipher, { ...config, smtp, admission });
    const request = async (path, body, headers = {}) => {
      httpCalls++; requireResult(httpCalls <= 15, "a08_http_budget_exceeded");
      const response = await auth.handler(new Request(new URL(path, config.publicOrigin), { method: body === undefined ? "GET" : "POST",
        headers: { origin: config.publicOrigin, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
      lastHttpStatus = response.status; return response;
    };
    const expectJson = async (response, status) => {
      requireResult(response.status === status, "a08_native_http_status_unexpected");
      try { return await response.json(); } catch { throw new Error("a08_native_json_invalid"); }
    };
    const outbox = async kind => business(async () => {
      const row = (await pool.query(`SELECT id,job_id,state,created_at FROM auth_mail_outbox
        WHERE user_id=$1 AND kind=$2 ORDER BY created_at DESC,id DESC LIMIT 1`, [userId, kind])).rows[0];
      requireResult(row?.state === "queued", "a08_outbox_queued_missing"); return row;
    });
    stage = "uninvited_signup";
    const denied = await expectJson(await request("/api/auth/sign-up/email", { name: "Synthetic Uninvited", email: otherEmail,
      password: originalPassword }), 200);
    requireResult(denied.token === null, "a08_uninvited_session_created");
    await business(async () => requireResult((await pool.query('SELECT id FROM "user" WHERE email=$1', [otherEmail])).rowCount === 0,
      "a08_uninvited_user_created"));
    stage = "invited_signup";
    await business(() => pool.query(`INSERT INTO account_invitations(id,email_hash,expires_at)
      VALUES($1,$2,now()+interval '1 hour')`, [randomUUID(), accountEmailHash(email)]));
    const signup = await expectJson(await request("/api/auth/sign-up/email", { name: "Synthetic Invited", email,
      password: originalPassword, callbackURL: "/" }), 200);
    userId = signup.user?.id;
    requireResult(typeof userId === "string" && signup.token === null && signup.user?.emailVerified === false, "a08_native_signup_invalid");
    const initialMail = await outbox("verify");
    const unverified = await request("/api/auth/sign-in/email", { email, password: originalPassword });
    requireResult(unverified.status === 403, "a08_unverified_login_allowed");
    stage = "verification_mail";
    await business(() => worker.process({ mailId: initialMail.id, jobId: initialMail.job_id }, initialMail.job_id));
    const verifyUrl = receivedMailUrl(receiver.messages[0]);
    requireResult(new URL(verifyUrl).origin === config.publicOrigin, "a08_mail_origin_invalid");
    stage = "verify_email";
    const verified = await request(verifyUrl);
    requireResult(verified.status === 302 && new URL(verified.headers.get("location")).searchParams.get("account") === "verified", "a08_native_verify_invalid");
    const originalLogin = await request("/api/auth/sign-in/email", { email, password: originalPassword });
    const originalUser = await expectJson(originalLogin, 200);
    requireResult(originalUser.user?.id === userId && originalUser.user?.emailVerified === true, "a08_native_login_invalid");
    const originalHeaders = { cookie: cookieHeader(originalLogin), origin: config.publicOrigin };
    requireResult(Boolean(originalHeaders.cookie), "a08_native_session_cookie_missing");
    stage = "acknowledgement_gate";
    await business(async () => {
      let deniedConsent = false;
      try { await admission.assertUsable(userId); }
      catch (error) { deniedConsent = error instanceof AccountAdmissionError && error.code === "service_consent_required"; }
      requireResult(deniedConsent, "a08_consent_gate_missing");
    });
    const acknowledgement = await business(() => admission.acknowledge(userId,
      { policyVersion: SERVICE_POLICY_VERSION, accepted: true, operationId: randomUUID() }));
    requireResult(acknowledgement.user?.acknowledged === true, "a08_acknowledgement_invalid");
    await business(() => admission.assertUsable(userId));
    stage = "reset_rate_window";
    const remaining = Math.max(0, new Date(initialMail.created_at).getTime() + 61000 - Date.now());
    if (remaining) await delay(remaining);
    stage = "request_password_reset";
    await expectJson(await request("/api/auth/request-password-reset", { email, redirectTo: "/" }), 200);
    const resetMail = await outbox("reset");
    await business(() => worker.process({ mailId: resetMail.id, jobId: resetMail.job_id }, resetMail.job_id));
    stage = "reset_mail_callback";
    const resetCallback = await request(receivedMailUrl(receiver.messages[1]));
    requireResult(resetCallback.status === 302, "a08_native_reset_callback_invalid");
    const resetLocation = new URL(resetCallback.headers.get("location"));
    const resetToken = resetLocation.searchParams.get("token");
    requireResult(resetLocation.origin === config.webOrigin && resetLocation.searchParams.get("account") === "reset" && Boolean(resetToken),
      "a08_native_reset_token_missing");
    stage = "reset_password";
    await expectJson(await request("/api/auth/reset-password", { token: resetToken, newPassword: password }), 200);
    stage = "old_session_revoked";
    const oldSession = await expectJson(await request("/api/auth/get-session", undefined, originalHeaders), 200);
    requireResult(oldSession === null, "a08_old_session_survived_reset");
    stage = "replacement_password_login";
    const oldPassword = await request("/api/auth/sign-in/email", { email, password: originalPassword });
    requireResult(oldPassword.status === 401, "a08_old_password_survived_reset");
    const login = await request("/api/auth/sign-in/email", { email, password });
    const currentUser = await expectJson(login, 200);
    requireResult(currentUser.user?.id === userId, "a08_replacement_login_invalid");
    const headers = { cookie: cookieHeader(login), origin: config.publicOrigin };
    requireResult(Boolean(headers.cookie), "a08_replacement_cookie_missing");
    stage = "accepted_outbox";
    await business(async () => requireResult((await pool.query(`SELECT count(*)::int AS count FROM auth_mail_outbox
      WHERE user_id=$1 AND state='accepted'`, [userId])).rows[0]?.count === 2, "a08_smtp_acceptance_unconfirmed"));
    stage = "complete";
    return { userId, email, password, originalPassword, headers, originalHeaders, auth, admission, evidence: evidence() };
  } catch (cause) {
    const reason = cause instanceof Error && /^a08_[a-z_]+$/u.test(cause.message) ? cause.message : "a08_auth_step_failed";
    const error = new Error("a08_auth_acceptance_failed"); error.evidence = { ...evidence(), reason }; throw error;
  } finally {
    await worker?.stop(); await receiver?.close();
  }
}
