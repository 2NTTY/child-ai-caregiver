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
import { createStorageCipher, readSecretKey } from "../server/storage-crypto.ts";
import { verifyEncryptedStorage } from "../server/storage-upgrade.ts";
import { emptyCareDetails } from "../src/shared/care.ts";

let pool, server, step = "preflight", checks = 0, requests = 0;
const check = async (name, action) => { step = name; await action(); checks++; };
try {
  if (!process.argv.includes("--approved-care")) throw new Error("Approval required");
  const url = new URL(process.env.TEST_DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || !/^yuban_s06_test[A-Za-z0-9_]*$/.test(url.pathname.slice(1)) || url.search || url.hash) throw new Error("Local synthetic DB required");
  const cipher = createStorageCipher(await readSecretKey(process.env.STORAGE_KEY_FILE));
  const env = { ...process.env, DATABASE_URL: url.toString(), AI_ENABLED: "false", NODE_ENV: "test", BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    SERVER_ORIGIN: "http://127.0.0.1:3099", WEB_ORIGIN: "http://127.0.0.1:3099", PORT: "3099" };
  const config = readServerConfig(env);
  pool = createPool(config);
  const before = new Map();
  for (const table of ["children", "text_records", "chat_messages"]) for (const row of (await pool.query(`SELECT * FROM ${table}`)).rows)
    before.set(`${table}:${row.id}`, row);
  await check("migration_and_existing_encryption", async () => {
    execFileSync(process.execPath, ["server/migrate.ts"], { cwd: fileURLToPath(new URL("../", import.meta.url)), env, stdio: "ignore", timeout: 60000, windowsHide: true });
    await verifyEncryptedStorage(pool, cipher);
    assert.equal((await pool.query("SELECT 1 FROM app_migrations WHERE id='007-confirmed-records'")).rowCount, 1);
  });
  const start = async () => {
    const handler = createRequestHandler({ config, auth: createAuth(config, pool), workspaces: createWorkspaceStore(pool), records: createRecordStore(pool, cipher),
      chat: createChatStore(pool, cipher), families: createFamilyStore(pool, cipher), care: createCareStore(pool, cipher), checkDatabase: async () => { await pool.query("SELECT 1"); } });
    server = createServer((req, res) => { void handler(req, res); });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(3099, "127.0.0.1", resolve); });
  };
  await start();
  async function request(account, path, body, expected = 200) {
    if (++requests > 60) throw new Error("Request cap reached");
    const response = await fetch(`${config.publicOrigin}/api${path}`, { method: body === undefined ? "GET" : "POST", signal: AbortSignal.timeout(10000),
      headers: { origin: config.publicOrigin, ...(account ? { cookie: account.cookie, "x-expected-user-id": account.id } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (expected !== null) assert.equal(response.status, expected);
    return { data: await response.json(), status: response.status, headers: response.headers };
  }
  const users = [];
  await check("three_synthetic_accounts", async () => {
    for (let index = 0; index < 3; index++) {
      const email = `care-${randomUUID()}@example.test`, response = await request(null, "/auth/sign-up/email", { name: `合成記錄成員 ${index}`, email, password: randomBytes(24).toString("hex") });
      users.push({ id: response.data.user.id, email, cookie: response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") });
    }
  });
  const [owner, caregiver, viewer] = users;
  let child, legacy, saved, profile;
  const values = { text: "  昨晚飲大約半樽\n尚未量度  ", details: { ...emptyCareDetails("feeding"), quantity: { rawValue: "大約半", unit: "樽", precision: "approximate" },
    eventTime: { rawText: "昨晚", at: null, timeZone: "Asia/Hong_Kong", precision: "approximate" } }, source: "家長合成觀察" };
  let prefix;
  await check("family_roles", async () => {
    child = (await request(owner, "/children", { displayName: "S05 新建合成孩子" }, 201)).data.child; prefix = `/children/${child.id}`;
    await request(viewer, `${prefix}/profile`, undefined, 404);
    for (const [person, role] of [[caregiver, "caregiver"], [viewer, "viewer"]]) {
      const space = (await request(owner, "/families")).data.families.find(item => item.id === child.workspaceId);
      const invite = (await request(owner, `/families/${space.id}/invitations`, { email: person.email, role, expectedVersion: space.version }, 201)).data;
      await request(person, "/families/invitations/accept", { token: invite.token, confirmWorkspaceId: space.id });
    }
  });
  await check("legacy_original_and_history", async () => {
    legacy = (await request(owner, `${prefix}/records`, { text: "  舊入口原文\n大概昨晚  " }, 201)).data.record;
    const page = (await request(owner, `${prefix}/care/search`, {})).data;
    assert.equal(page.records[0].text, legacy.text); assert.equal(page.records[0].version, 1);
    const history = (await request(viewer, `${prefix}/care/${legacy.id}/history`)).data;
    assert.equal(history.revisions[0].text, legacy.text);
  });
  await check("confirmed_record_and_correction", async () => {
    saved = (await request(owner, `${prefix}/care`, { ...values, confirmShared: true }, 201)).data.record;
    assert.deepEqual(saved.details, values.details); assert.equal(saved.text, values.text);
    const corrected = (await request(caregiver, `${prefix}/care/${legacy.id}/revise`, { ...values, expectedVersion: 1, reason: "補充單位", confirmShared: true })).data.record;
    assert.equal(corrected.authorUserId, owner.id); assert.equal(corrected.confirmedBy, caregiver.id);
    const history = (await request(viewer, `${prefix}/care/${legacy.id}/history`)).data.revisions;
    assert.equal(history.length, 2); assert.equal(history[1].text, legacy.text);
    assert.equal((await request(owner, `${prefix}/records`)).data.records.find(item => item.id === legacy.id).text, values.text);
  });
  await check("concurrent_correction_and_readonly", async () => {
    const input = { ...values, expectedVersion: 1, reason: "並發確認", confirmShared: true };
    const responses = await Promise.all([owner, caregiver].map(person => request(person, `${prefix}/care/${saved.id}/revise`, input, null)));
    assert.deepEqual(responses.map(item => item.status).sort(), [200, 409]); saved = responses.find(item => item.status === 200).data.record;
    await request(viewer, `${prefix}/care`, { ...values, confirmShared: true }, 404);
    await request(viewer, `${prefix}/care/${saved.id}/delete`, { expectedVersion: saved.version, confirmDelete: true }, 404);
  });
  await check("confirmed_age_precision_and_history", async () => {
    const initial = (await request(owner, `${prefix}/profile`)).data.profile; assert.equal(initial.data, null); assert.equal(initial.version, 0);
    const data = { age: { kind: "approximate", rawValue: "約六", unit: "months", asOf: "2026-09-01" }, dueDate: null, gestationalWeeksRaw: null,
      region: "香港", language: "粵語", allergies: null, specialNeeds: null, preferences: null, source: "家長合成估算", validUntil: null };
    profile = (await request(owner, `${prefix}/profile`, { data, expectedVersion: 0, reason: "首次按需補充", confirmShared: true })).data.profile;
    assert.deepEqual(profile.data.age, data.age);
    await request(viewer, `${prefix}/profile`, { data, expectedVersion: 1, reason: "無權更改", confirmShared: true }, 404);
    await request(caregiver, `${prefix}/profile`, { data, expectedVersion: 0, reason: "舊版本", confirmShared: true }, 409);
    profile = (await request(caregiver, `${prefix}/profile`, { data: { ...data, language: "繁體中文／粵語" }, expectedVersion: 1, reason: "補充語言", confirmShared: true })).data.profile;
    assert.equal((await request(viewer, `${prefix}/profile/history`)).data.revisions.length, 2);
  });
  await check("search_keyset_and_microseconds", async () => {
    const store = createCareStore(pool, cipher);
    const ids = [];
    for (let index = 0; index < 52; index++) ids.push((await store.create(owner.id, child.id, { ...values, text: `分頁合成 ${index}` })).id);
    await pool.query("UPDATE text_records SET created_at='2026-09-01T00:00:00.123456Z' WHERE child_id=$1 AND id=ANY($2::uuid[])", [child.id, ids]);
    const first = (await request(viewer, `${prefix}/care/search`, { query: "分頁合成" })).data;
    assert.equal(first.records.length, 50); assert.ok(first.nextCursor.createdAt.endsWith("123456Z"));
    const second = (await request(viewer, `${prefix}/care/search`, { query: "分頁合成", cursor: first.nextCursor })).data;
    assert.equal(second.records.length, 2); assert.equal(new Set([...first.records, ...second.records].map(item => item.id)).size, 52);
  });
  await check("encrypted_bodies_and_private_chat", async () => {
    await request(owner, `${prefix}/messages`, { text: "私人內容不應成為共享記錄" }, 201);
    assert.equal((await request(viewer, `${prefix}/care/search`, { query: "私人內容" })).data.records.length, 0);
    const row = (await pool.query("SELECT text_encrypted,details_encrypted FROM text_records WHERE id=$1", [saved.id])).rows[0];
    assert.ok(row.text_encrypted.startsWith("yb1.")); assert.ok(row.details_encrypted.startsWith("yb1."));
    for (const [table, column, id] of [["text_record_revisions", "record_id", saved.id], ["child_profile_revisions", "child_id", child.id]])
      for (const item of (await pool.query(`SELECT payload_encrypted FROM ${table} WHERE ${column}=$1`, [id])).rows) assert.ok(item.payload_encrypted.startsWith("yb1."));
  });
  await check("restart_persistence", async () => {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await pool.end(); pool = createPool(config); await start();
    assert.deepEqual((await request(caregiver, `${prefix}/profile`)).data.profile, profile);
    assert.equal((await request(owner, `${prefix}/care/${saved.id}/history`)).data.revisions.length, 2);
  });
  await check("record_and_profile_erasure", async () => {
    await request(caregiver, `${prefix}/care/${saved.id}/delete`, { expectedVersion: saved.version, confirmDelete: true });
    assert.equal((await pool.query("SELECT 1 FROM text_record_revisions WHERE record_id=$1", [saved.id])).rowCount, 0);
    assert.equal((await pool.query("SELECT 1 FROM deleted_records WHERE id=$1", [saved.id])).rowCount, 1);
    await request(owner, `${prefix}/care/${saved.id}/history`, undefined, 404);
    const erased = (await request(caregiver, `${prefix}/profile/delete`, { expectedVersion: profile.version, confirmDelete: true })).data.profile;
    assert.equal(erased.data, null); assert.equal(erased.version, profile.version + 1);
    assert.equal((await request(viewer, `${prefix}/profile/history`)).data.revisions.length, 0);
  });
  await check("new_child_only_cascade", async () => {
    await request(owner, `${prefix}/delete`, { confirmChildId: child.id });
    for (const [table, column] of [["text_records", "child_id"], ["chat_messages", "child_id"], ["child_profile_revisions", "child_id"], ["deleted_records", "child_id"]])
      assert.equal((await pool.query(`SELECT 1 FROM ${table} WHERE ${column}=$1`, [child.id])).rowCount, 0);
  });
  await check("prior_data_unchanged", async () => {
    for (const table of ["children", "text_records", "chat_messages"]) for (const row of (await pool.query(`SELECT * FROM ${table}`)).rows) {
      const key = `${table}:${row.id}`, prior = before.get(key);
      if (prior) { for (const field of Object.keys(prior)) assert.deepEqual(row[field], prior[field]); before.delete(key); }
    }
    assert.equal(before.size, 0);
  });
  console.log(JSON.stringify({ result: "passed", checks, httpRequests: requests, accountsCreated: 3, syntheticRecordsCreated: 54,
    migrations: ["007-confirmed-records"], existingDataPreserved: true, deletedOnlyNewSyntheticChild: true, restarted: true,
    modelCalls: 0, notificationCalls: 0, browserE2E: false, databaseCleared: false, bodiesLogged: false }));
} catch { console.error(JSON.stringify({ result: "failed", step, checks, httpRequests: requests, bodiesLogged: false })); process.exitCode = 1; }
finally { if (server?.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await pool?.end(); }
