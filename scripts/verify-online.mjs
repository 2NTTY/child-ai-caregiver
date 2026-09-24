import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createPool } from "../server/database.ts";
import { readServerConfig } from "../server/config.ts";
import { createAuth } from "../server/auth.ts";
import { createRequestHandler } from "../server/app.ts";
import { createWorkspaceStore } from "../server/workspaces.ts";
import { createRecordStore } from "../server/records.ts";
import { createFamilyStore } from "../server/families.ts";
import { createCareStore } from "../server/care.ts";
import { createChatStore } from "../server/chat.ts";
import { createOnlineStore } from "../server/online.ts";
import { createStorageCipher, readSecretKey } from "../server/storage-crypto.ts";
import { verifyEncryptedStorage } from "../server/storage-upgrade.ts";
import { emptyCareDetails } from "../src/shared/care.ts";

let pool, server, step = "preflight", checks = 0, requests = 0;
const check = async (name, action) => { step = name; await action(); checks++; };
try {
  if (!process.argv.includes("--approved-online")) throw new Error("Approval required");
  const url = new URL(process.env.TEST_DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || !/^yuban_s06_test[A-Za-z0-9_]*$/.test(url.pathname.slice(1)) || url.search || url.hash) throw new Error("Local synthetic DB required");
  const cipher = createStorageCipher(await readSecretKey(process.env.STORAGE_KEY_FILE));
  const env = { ...process.env, DATABASE_URL: url.toString(), AI_ENABLED: "false", NODE_ENV: "test", BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    SERVER_ORIGIN: "http://127.0.0.1:3099", WEB_ORIGIN: "http://127.0.0.1:3099", PORT: "3099" };
  const config = readServerConfig(env);
  pool = createPool(config);
  const before = new Map();
  for (const table of ["children", "text_records", "chat_messages"]) for (const row of (await pool.query(`SELECT * FROM ${table}`)).rows) before.set(`${table}:${row.id}`, row);
  await check("migration_preserves_existing_encryption", async () => {
    execFileSync(process.execPath, ["server/migrate.ts"], { cwd: fileURLToPath(new URL("../", import.meta.url)), env, stdio: "ignore", timeout: 60000, windowsHide: true });
    await verifyEncryptedStorage(pool, cipher);
    assert.equal((await pool.query("SELECT 1 FROM app_migrations WHERE id='010-online-operations'")).rowCount, 1);
  });
  const start = async () => {
    const handler = createRequestHandler({ config, auth: createAuth(config, pool), workspaces: createWorkspaceStore(pool),
      records: createRecordStore(pool, cipher, true), chat: createChatStore(pool, cipher, true),
      families: createFamilyStore(pool, cipher, true), care: createCareStore(pool, cipher, true), online: createOnlineStore(pool, cipher),
      checkDatabase: async () => { await pool.query("SELECT 1"); } });
    server = createServer((req, res) => { void handler(req, res); });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(3099, "127.0.0.1", resolve); });
  };
  await start();
  async function request(account, path, body, expected = 200) {
    if (++requests > 60) throw new Error("Request cap reached");
    const response = await fetch(`${config.publicOrigin}/api${path}`, { method: body === undefined ? "GET" : "POST", signal: AbortSignal.timeout(10000),
      headers: { origin: config.publicOrigin, connection: "close", ...(account ? { cookie: account.cookie, "x-expected-user-id": account.id } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (expected !== null) assert.equal(response.status, expected);
    return { data: await response.json(), status: response.status, headers: response.headers };
  }
  const command = async (account, path, payload) => {
    const context = (await request(account, "/online/context", { path: `/api${path}`, payload })).data;
    return { path: `/api${path}`, payload, operation: { ...context, opId: randomUUID(), deviceId: randomUUID() } };
  };
  const submit = async (account, value, expected = 200) => (await request(account, "/online/submit", value, expected)).data;
  const lookup = async (account, value, expected = 200) => (await request(account, `/online/operations/${value.operation.opId}`, undefined, expected)).data;
  const users = [];
  await check("synthetic_accounts_and_atomic_child_creation", async () => {
    for (let index = 0; index < 3; index++) {
      const email = `online-${randomUUID()}@example.test`;
      const response = await request(null, "/auth/sign-up/email", { name: `合成在線成員 ${index}`, email, password: randomBytes(24).toString("hex") });
      users.push({ id: response.data.user.id, email, cookie: response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") });
    }
  });
  const [owner, caregiver, viewer] = users;
  const createChild = await command(owner, "/children", { displayName: "S07 新建合成孩子" });
  const created = await Promise.all([submit(owner, createChild), submit(owner, createChild)]);
  assert.deepEqual(created[0], created[1]);
  const child = created[0].result.child, prefix = `/children/${child.id}`;
  let saved, careCommand, privateCommand, memberCommand;
  const values = { text: "  原操作合成記錄\n約半樽  ", source: "家長合成觀察", details: emptyCareDetails("feeding"), confirmShared: true };
  await check("family_acceptance_and_legacy_change_tracking", async () => {
    for (const [person, role] of [[caregiver, "caregiver"], [viewer, "viewer"]]) {
      const family = (await request(owner, "/families")).data.families.find(item => item.id === child.workspaceId);
      // The retained legacy route must still work and append a change once migration is enabled.
      const invite = (await request(owner, `/families/${child.workspaceId}/invitations`, { email: person.email, role, expectedVersion: family.version }, 201)).data;
      const join = await command(person, "/families/invitations/accept", { token: invite.token, confirmWorkspaceId: child.workspaceId });
      assert.equal((await submit(person, join)).result.joined, true);
    }
  });
  await check("same_operation_once_and_distinct_real_events", async () => {
    careCommand = await command(owner, `${prefix}/care`, values);
    const receipts = await Promise.all([submit(owner, careCommand), submit(owner, careCommand)]);
    assert.deepEqual(receipts[0], receipts[1]); saved = receipts[0].result.record;
    assert.equal(saved.text, values.text);
    // Ignore the original response as a client would after losing its acknowledgement.
    assert.equal((await lookup(owner, careCommand)).result.record.id, saved.id);
    const another = await submit(owner, { ...careCommand, operation: { ...careCommand.operation, opId: randomUUID() } });
    assert.notEqual(another.result.record.id, saved.id);
    assert.equal((await pool.query("SELECT 1 FROM text_records WHERE child_id=$1", [child.id])).rowCount, 2);
    await submit(owner, { ...careCommand, payload: { ...values, text: "改了內容" } }, 409);
    await submit(owner, { ...careCommand, operation: { ...careCommand.operation, storageEpoch: randomUUID() } }, 409);
    await request(viewer, "/online/context", { path: careCommand.path, payload: values }, 404);
    assert.equal((await lookup(viewer, careCommand)).state, "unconfirmed");
  });
  await check("version_conflicts_and_stale_pages", async () => {
    const priorSeq = (await pool.query("SELECT change_seq::text FROM workspaces WHERE id=$1", [child.workspaceId])).rows[0].change_seq;
    const revise = await command(owner, `${prefix}/care/${saved.id}/revise`, { ...values, expectedVersion: 1, reason: "更正合成資料" });
    saved = (await submit(owner, revise)).result.record;
    await submit(owner, { ...revise, operation: { ...revise.operation, opId: randomUUID() } }, 409);
    const page = await request(viewer, `${prefix}/care/search`, { cursor: { createdAt: saved.createdAt, id: saved.id, changeSeq: priorSeq } }, 409);
    assert.equal(page.data.error.code, "cursor_stale");
  });
  await check("profile_erasure_redacts_saved_receipt", async () => {
    const data = { age: { kind: "unknown" }, dueDate: null, gestationalWeeksRaw: null, region: "香港", language: "粵語", allergies: null,
      specialNeeds: null, preferences: null, source: "合成確認", validUntil: null };
    const profile = await command(owner, `${prefix}/profile`, { data, expectedVersion: 0, reason: "首次確認", confirmShared: true });
    await submit(owner, profile);
    await submit(owner, await command(owner, `${prefix}/profile/delete`, { expectedVersion: 1, confirmDelete: true }));
    assert.equal((await lookup(owner, profile)).result, null);
  });
  const changesPath = `/online/changes?${new URLSearchParams({ workspaceId: child.workspaceId, storageEpoch: createChild.operation.storageEpoch, cursor: "0" })}`;
  await check("private_chat_and_notification_receipt_privacy", async () => {
    privateCommand = await command(owner, `${prefix}/messages`, { text: "這是合成私人聊天" });
    await submit(owner, privateCommand);
    const publicFeed = (await request(viewer, changesPath)).data;
    assert.ok(publicFeed.changes.every(item => item.kind !== "chat" && item.kind !== "preferences"));
    const ownFeed = (await request(owner, changesPath)).data;
    assert.ok(ownFeed.changes.some(item => item.kind === "chat"));
    for (const row of (await pool.query("SELECT request_hash_encrypted,result_encrypted FROM online_operations WHERE workspace_id=$1", [child.workspaceId])).rows) {
      assert.ok(row.request_hash_encrypted.startsWith("yb1."));
      assert.ok(row.result_encrypted === null || row.result_encrypted.startsWith("yb1."));
    }
  });
  await check("revocation_blocks_receipts_replays_and_updates", async () => {
    memberCommand = await command(caregiver, `${prefix}/care`, { ...values, text: "其他照顧者合成記錄" });
    await submit(caregiver, memberCommand);
    const family = (await request(owner, "/families")).data.families.find(item => item.id === child.workspaceId);
    await submit(owner, await command(owner, `/families/${child.workspaceId}/members/${caregiver.id}`, { expectedVersion: family.version, role: "revoked" }));
    await lookup(caregiver, memberCommand, 404); await submit(caregiver, memberCommand, 404);
    await request(caregiver, changesPath, undefined, 404);
  });
  await check("server_restart_and_record_erasure", async () => {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await pool.end(); pool = createPool(config); await start();
    assert.equal((await lookup(owner, careCommand)).result.record.id, saved.id);
    await submit(owner, await command(owner, `${prefix}/care/${saved.id}/delete`, { expectedVersion: saved.version, confirmDelete: true }));
    assert.equal((await lookup(owner, careCommand)).result, null);
    assert.equal((await pool.query("SELECT 1 FROM deleted_records WHERE id=$1", [saved.id])).rowCount, 1);
  });
  await check("new_child_only_delete_and_old_create_cannot_restore", async () => {
    await submit(owner, await command(owner, `${prefix}/delete`, { confirmChildId: child.id }));
    assert.equal((await lookup(owner, createChild)).result, null);
    assert.equal((await submit(owner, createChild)).result, null);
    assert.equal((await pool.query("SELECT 1 FROM children WHERE id=$1", [child.id])).rowCount, 0);
    assert.equal((await pool.query("SELECT 1 FROM online_operations WHERE child_id=$1 AND result_encrypted IS NOT NULL AND path NOT LIKE '%/delete'", [child.id])).rowCount, 0);
  });
  await check("all_prior_business_rows_preserved", async () => {
    for (const table of ["children", "text_records", "chat_messages"]) for (const row of (await pool.query(`SELECT * FROM ${table}`)).rows) {
      const key = `${table}:${row.id}`, prior = before.get(key);
      if (prior) { for (const field of Object.keys(prior)) assert.deepEqual(row[field], prior[field]); before.delete(key); }
    }
    assert.equal(before.size, 0);
  });
  console.log(JSON.stringify({ result: "passed", checks, httpRequests: requests, accountsCreated: 3, childrenCreated: 1, recordsCreated: 3, chatMessagesCreated: 1,
    migrations: ["010-online-operations"], existingDataPreserved: true, deletedOnlyNewSyntheticChild: true, restarted: true,
    modelCalls: 0, notificationCalls: 0, browserE2E: false, databaseCleared: false, bodiesLogged: false }));
} catch (error) {
  const code = error?.cause?.code ?? error?.code;
  console.error(JSON.stringify({ result: "failed", step, checks, httpRequests: requests,
    errorKind: ["AssertionError", "TypeError", "Error"].includes(error?.name) ? error.name : "OtherError",
    errorCode: typeof code === "string" && /^[A-Z_0-9]{1,40}$/u.test(code) ? code : null, bodiesLogged: false }));
  process.exitCode = 1;
}
finally { if (server?.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await pool?.end(); }
