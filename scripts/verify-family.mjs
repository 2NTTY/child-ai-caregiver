import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createPool } from "../server/database.ts";
import { readServerConfig } from "../server/config.ts";
import { createAuth } from "../server/auth.ts";
import { createRequestHandler } from "../server/app.ts";
import { createWorkspaceStore } from "../server/workspaces.ts";
import { createRecordStore } from "../server/records.ts";
import { createChatStore } from "../server/chat.ts";
import { createFamilyStore } from "../server/families.ts";
import { createStorageCipher, readSecretKey } from "../server/storage-crypto.ts";
import { verifyEncryptedStorage } from "../server/storage-upgrade.ts";

let pool, server, step = "preflight", checks = 0, requests = 0;
const check = async (name, action) => { step = name; await action(); checks++; };
const repository = fileURLToPath(new URL("../", import.meta.url));
try {
  if (!process.argv.includes("--approved-family")) throw new Error("Approval required");
  const url = new URL(process.env.TEST_DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !/^yuban_s06_test[A-Za-z0-9_]*$/.test(url.pathname.slice(1)) || url.search || url.hash) throw new Error("Synthetic local DB required");
  const cipher = createStorageCipher(await readSecretKey(process.env.STORAGE_KEY_FILE));
  const env = { ...process.env, DATABASE_URL: url.toString(), AI_ENABLED: "false", NODE_ENV: "test",
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), SERVER_ORIGIN: "http://127.0.0.1:3098", WEB_ORIGIN: "http://127.0.0.1:3098", PORT: "3098" };
  pool = createPool(readServerConfig(env));
  const before = new Map();
  for (const table of ["children", "text_records", "chat_messages"]) {
    for (const row of (await pool.query(`SELECT * FROM ${table}`)).rows) before.set(`${table}:${row.id}`, JSON.stringify(row));
  }
  await check("additive_migration_and_storage", async () => {
    execFileSync(process.execPath, ["server/migrate.ts"], { cwd: repository, env, stdio: "ignore", windowsHide: true, timeout: 60000 });
    await verifyEncryptedStorage(pool, cipher);
    assert.equal((await pool.query("SELECT 1 FROM app_migrations WHERE id='006-family-access'")).rowCount, 1);
  });
  const config = readServerConfig(env), auth = createAuth(config, pool);
  const workspaces = createWorkspaceStore(pool), records = createRecordStore(pool, cipher), chat = createChatStore(pool, cipher), families = createFamilyStore(pool, cipher);
  const handler = createRequestHandler({ config, auth, workspaces, records, chat, families, checkDatabase: async () => { await pool.query("SELECT 1"); } });
  server = createServer((req, res) => { void handler(req, res); });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(3098, "127.0.0.1", resolve); });
  async function request(account, path, body, expected = 200) {
    if (++requests > 60) throw new Error("Acceptance request cap reached");
    const response = await fetch(`${config.publicOrigin}/api${path}`, { method: body === undefined ? "GET" : "POST", signal: AbortSignal.timeout(10000),
      headers: { origin: config.publicOrigin, ...(account ? { cookie: account.cookie, "x-expected-user-id": account.id } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(response.status, expected);
    return { data: await response.json(), headers: response.headers };
  }
  const users = [];
  await check("four_synthetic_authenticated_accounts", async () => {
    for (let index = 0; index < 4; index++) {
      // Better Auth limits signup to 3 requests per 10 seconds; preserve the real limit.
      if (index === 3) await delay(10100);
      const email = `family-${randomUUID()}@example.test`;
      const response = await request(null, "/auth/sign-up/email", { name: `合成家庭成員 ${index}`, email, password: randomBytes(24).toString("hex") });
      users.push({ id: response.data.user.id, email, cookie: response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") });
    }
  });
  const [owner, caregiver, viewer, outsider] = users;
  let child, invite, version;
  const refresh = async () => { const list = (await request(owner, "/families")).data.families; version = list.find(item => item.id === child.workspaceId).version; };
  await check("owner_child_and_foreign_boundary", async () => {
    child = (await request(owner, "/children", { displayName: "合成家庭共享孩子" }, 201)).data.child;
    await request(owner, `/children/${child.id}/records`, { text: "  原擁有者記錄\n約 120 ml  " }, 201);
    assert.equal((await request(outsider, "/children")).data.children.length, 0);
    await request(outsider, `/children/${child.id}/records`, undefined, 404);
    await refresh();
  });
  await check("targeted_preview_and_wrong_recipient", async () => {
    invite = (await request(owner, `/families/${child.workspaceId}/invitations`, { email: caregiver.email, role: "caregiver", expectedVersion: version }, 201)).data;
    await request(outsider, "/families/invitations/preview", { token: invite.token }, 404);
    assert.equal((await request(caregiver, "/families/invitations/preview", { token: invite.token })).data.invitation.workspaceId, child.workspaceId);
  });
  await check("concurrent_accept_once", async () => {
    await Promise.all([1, 2].map(() => request(caregiver, "/families/invitations/accept", { token: invite.token, confirmWorkspaceId: child.workspaceId })));
    assert.equal((await pool.query("SELECT 1 FROM family_members WHERE workspace_id=$1 AND user_id=$2", [child.workspaceId, caregiver.id])).rowCount, 1);
  });
  await check("caregiver_shared_records_and_owner_only_management", async () => {
    const shared = (await request(caregiver, "/children")).data.children.find(item => item.id === child.id);
    assert.equal(shared.displayName, child.displayName); assert.equal(shared.accessRole, "caregiver");
    await request(caregiver, `/children/${child.id}/records`, { text: "  照顧者原文\n約三點  " }, 201);
    const page = (await request(owner, `/children/${child.id}/records`)).data.records;
    assert.ok(page.some(row => row.authorUserId === caregiver.id && row.text === "  照顧者原文\n約三點  "));
    await request(caregiver, `/children/${child.id}/delete`, { confirmChildId: child.id }, 404);
    await request(caregiver, `/families/${child.workspaceId}/invitations`, { email: outsider.email, role: "viewer", expectedVersion: version }, 404);
  });
  await check("viewer_read_only", async () => {
    await refresh();
    const invitation = (await request(owner, `/families/${child.workspaceId}/invitations`, { email: viewer.email, role: "viewer", expectedVersion: version }, 201)).data;
    await request(viewer, "/families/invitations/accept", { token: invitation.token, confirmWorkspaceId: child.workspaceId });
    assert.equal((await request(viewer, `/children/${child.id}/records`)).data.records.length, 2);
    await request(viewer, `/children/${child.id}/records`, { text: "拒絕此寫入" }, 404);
    await request(viewer, `/families/${child.workspaceId}/children`, { displayName: "拒絕此孩子" }, 404);
  });
  await check("private_chat_owner_and_caregiver_isolation", async () => {
    await request(owner, `/children/${child.id}/messages`, { text: "擁有者私人內容" }, 201);
    await request(caregiver, `/children/${child.id}/messages`, { text: "照顧者私人內容" }, 201);
    assert.deepEqual((await request(owner, `/children/${child.id}/messages`)).data.messages.map(row => row.text), ["擁有者私人內容"]);
    assert.deepEqual((await request(caregiver, `/children/${child.id}/messages`)).data.messages.map(row => row.text), ["照顧者私人內容"]);
    assert.deepEqual((await request(viewer, `/children/${child.id}/messages`)).data.messages, []);
  });
  await check("version_conflict_and_downgrade", async () => {
    await refresh();
    await request(owner, `/families/${child.workspaceId}/members/${caregiver.id}`, { role: "viewer", expectedVersion: version });
    await request(owner, `/families/${child.workspaceId}/members/${caregiver.id}`, { role: "caregiver", expectedVersion: version }, 409);
    await request(caregiver, `/children/${child.id}/records`, { text: "降權後拒絕" }, 404);
  });
  await check("revocation_and_no_invitation_resurrection", async () => {
    await refresh();
    await request(owner, `/families/${child.workspaceId}/members/${caregiver.id}`, { role: "revoked", expectedVersion: version });
    await request(caregiver, `/children/${child.id}/records`, undefined, 404);
    await request(caregiver, `/children/${child.id}/messages`, undefined, 404);
    await request(caregiver, "/families/invitations/accept", { token: invite.token, confirmWorkspaceId: child.workspaceId }, 404);
    assert.equal((await request(caregiver, "/children")).data.children.length, 0);
  });
  await check("revoked_and_expired_invites", async () => {
    await refresh();
    const invitation = (await request(owner, `/families/${child.workspaceId}/invitations`, { email: outsider.email, role: "viewer", expectedVersion: version }, 201)).data;
    await refresh();
    await request(owner, `/families/${child.workspaceId}/invitations/${invitation.invitation.id}/revoke`, { expectedVersion: version });
    await request(outsider, "/families/invitations/accept", { token: invitation.token, confirmWorkspaceId: child.workspaceId }, 404);
    await refresh();
    const expired = (await request(owner, `/families/${child.workspaceId}/invitations`, { email: outsider.email, role: "viewer", expectedVersion: version }, 201)).data;
    await pool.query("UPDATE family_invitations SET expires_at=now()-interval '1 second' WHERE id=$1", [expired.invitation.id]);
    await request(outsider, "/families/invitations/preview", { token: expired.token }, 404);
  });
  await check("personal_preferences_and_ciphertext", async () => {
    const initial = (await request(viewer, "/notification-preferences")).data.preferences;
    assert.equal(initial.version, 0);
    await request(viewer, "/notification-preferences", { timeZone: "Asia/Hong_Kong", quietStart: "21:00", quietEnd: "08:00", allowAppointmentDuringQuiet: false, expectedVersion: 0 });
    assert.equal((await request(owner, "/notification-preferences")).data.preferences.version, 0);
    const row = (await pool.query("SELECT preferences_encrypted FROM notification_preferences WHERE user_id=$1", [viewer.id])).rows[0];
    assert.ok(row.preferences_encrypted.startsWith("yb1.")); assert.ok(!row.preferences_encrypted.includes("Hong_Kong"));
    const storedInvite = (await pool.query("SELECT token_hash,email_encrypted FROM family_invitations WHERE id=$1", [invite.invitation.id])).rows[0];
    assert.notEqual(storedInvite.token_hash, invite.token); assert.ok(storedInvite.email_encrypted.startsWith("yb1."));
  });
  await check("existing_data_preserved", async () => {
    for (const table of ["children", "text_records", "chat_messages"]) for (const row of (await pool.query(`SELECT * FROM ${table}`)).rows) {
      const previous = before.get(`${table}:${row.id}`); if (previous) { assert.equal(JSON.stringify(row), previous); before.delete(`${table}:${row.id}`); }
    }
    assert.equal(before.size, 0);
  });
  console.log(JSON.stringify({ result: "passed", checks, httpRequests: requests, accountsCreated: 4, migrations: ["006-family-access"], existingDataPreserved: true,
    modelCalls: 0, notificationCalls: 0, databaseCleared: false, browserE2E: false, bodiesLogged: false }));
} catch { console.error(JSON.stringify({ result: "failed", step, checks, httpRequests: requests, bodiesLogged: false })); process.exitCode = 1; }
finally { if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await pool?.end(); }
