import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createPool } from "../server/database.ts";
import { readServerConfig } from "../server/config.ts";
import { createAuth } from "../server/auth.ts";
import { createRequestHandler } from "../server/app.ts";
import { createWorkspaceStore } from "../server/workspaces.ts";
import { createRecordStore } from "../server/records.ts";
import { createFamilyStore } from "../server/families.ts";
import { createTaskStore } from "../server/tasks.ts";
import { createOnlineStore } from "../server/online.ts";
import { createStorageCipher, readSecretKey } from "../server/storage-crypto.ts";
import { verifyEncryptedStorage } from "../server/storage-upgrade.ts";

const limits = { http: 60, tasks: 3, accounts: 3 }, counts = { http: 0, tasks: 0, accounts: 0 };
let pool, server, step = "preflight", checks = 0;
const check = async (name, action) => { step = name; await action(); checks++; };
const count = key => { if (++counts[key] > limits[key]) throw new Error("Scope cap reached"); };
try {
  if (!process.argv.includes("--approved-tasks")) throw new Error("Approval required");
  const url = new URL(process.env.TEST_DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || !/^yuban_s06_test[A-Za-z0-9_]*$/.test(url.pathname.slice(1)) || url.search || url.hash) throw new Error("Local synthetic DB required");
  const cipher = createStorageCipher(await readSecretKey(process.env.STORAGE_KEY_FILE));
  const env = { ...process.env, DATABASE_URL: url.toString(), AI_ENABLED: "false", NODE_ENV: "test", BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    SERVER_ORIGIN: "http://127.0.0.1:3099", WEB_ORIGIN: "http://127.0.0.1:3099", PORT: "3099" };
  const config = readServerConfig(env);
  pool = createPool(config);
  const prior = new Map();
  const preservedTables = ["children", "text_records", "chat_messages", "memory_facts", "memory_topics", "conversation_summaries"];
  for (const table of preservedTables) for (const row of (await pool.query(`SELECT * FROM ${table}`)).rows) prior.set(`${table}:${row.id}`, row);
  await check("migration_and_existing_encryption", async () => {
    execFileSync(process.execPath, ["server/migrate.ts"], { cwd: fileURLToPath(new URL("../", import.meta.url)), env, stdio: "ignore", timeout: 60000, windowsHide: true });
    await verifyEncryptedStorage(pool, cipher);
    assert.equal((await pool.query("SELECT 1 FROM app_migrations WHERE id='012-task-ledger'")).rowCount, 1);
  });
  const start = async () => {
    const handler = createRequestHandler({ config, auth: createAuth(config, pool), workspaces: createWorkspaceStore(pool), records: createRecordStore(pool, cipher, true),
      families: createFamilyStore(pool, cipher, true), tasks: createTaskStore(pool, cipher), online: createOnlineStore(pool, cipher),
      checkDatabase: async () => { await pool.query("SELECT 1"); } });
    server = createServer((request, response) => { void handler(request, response); });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(3099, "127.0.0.1", resolve); });
  };
  await start();
  async function request(account, path, body, expected = 200) {
    count("http");
    const response = await fetch(`${config.publicOrigin}/api${path}`, { method: body === undefined ? "GET" : "POST", signal: AbortSignal.timeout(10000),
      headers: { origin: config.publicOrigin, connection: "close", ...(account ? { cookie: account.cookie, "x-expected-user-id": account.id } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(response.status, expected);
    return { data: await response.json(), headers: response.headers };
  }
  async function operation(account, path, payload) {
    const command = { path: `/api${path}`, payload };
    const context = (await request(account, "/online/context", command)).data;
    return { ...command, operation: { ...context, opId: randomUUID(), deviceId: randomUUID() } };
  }
  async function write(account, path, payload) {
    const command = await operation(account, path, payload);
    return { command, receipt: (await request(account, "/online/submit", command)).data };
  }
  const users = [], ids = [], occurrences = [];
  await check("synthetic_accounts", async () => {
    for (let index = 0; index < 3; index++) {
      count("accounts");
      const email = `tasks-${randomUUID()}@example.test`;
      const response = await request(null, "/auth/sign-up/email", { name: `合成事項成員 ${index}`, email, password: randomBytes(24).toString("hex") });
      users.push({ id: response.data.user.id, email, cookie: response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") });
    }
  });
  const [owner, caregiver, viewer] = users;
  let child, prefix, familyId, original, createCommand, caregiverCommand;
  await check("family_scope_and_roles", async () => {
    child = (await request(owner, "/children", { displayName: "S13 新建合成孩子" }, 201)).data.child;
    prefix = `/children/${child.id}/tasks`; familyId = child.workspaceId;
    await request(viewer, prefix, undefined, 404);
    for (const [person, role] of [[caregiver, "caregiver"], [viewer, "viewer"]]) {
      const space = (await request(owner, "/families")).data.families.find(item => item.id === familyId);
      const invitation = (await request(owner, `/families/${familyId}/invitations`, { email: person.email, role, expectedVersion: space.version }, 201)).data;
      await request(person, "/families/invitations/accept", { token: invitation.token, confirmWorkspaceId: familyId });
    }
    const page = (await request(viewer, prefix)).data;
    assert.equal(page.items.length, 0);
    assert.deepEqual(page.eligibleAssignees.map(value => value.userId).sort(), [owner.id, caregiver.id].sort());
    await request(viewer, "/online/context", { path: `/api${prefix}`, payload: {} }, 404);
  });
  const values = { title: "  合成任務原文\n", details: "保留空格  \n及換行", kind: "ordinary", assigneeUserId: caregiver.id, dueAt: "2026-09-29T10:00:00+08:00", timeZone: "Asia/Hong_Kong" };
  await check("confirmation_assignment_and_same_operation", async () => {
    createCommand = await operation(owner, prefix, { values, confirm: true });
    await request(owner, prefix, { values, confirm: true }, 428);
    await request(owner, "/online/submit", { ...createCommand, payload: { values, confirm: false } }, 400);
    await request(owner, "/online/submit", { ...createCommand, payload: { values: { ...values, assigneeUserId: viewer.id }, confirm: true } }, 400);
    const responses = await Promise.all([request(owner, "/online/submit", createCommand), request(owner, "/online/submit", createCommand)]);
    assert.deepEqual(responses[0].data, responses[1].data);
    original = responses[0].data.result.task; count("tasks"); ids.push(original.id); occurrences.push(original.occurrence.id);
    assert.equal(original.title, values.title); assert.equal(original.details, values.details);
    assert.equal((await pool.query("SELECT 1 FROM care_tasks WHERE child_id=$1", [child.id])).rowCount, 1);
    const stored = (await pool.query("SELECT payload_encrypted FROM care_tasks WHERE id=$1", [original.id])).rows[0].payload_encrypted;
    assert.ok(!stored.includes("合成")); assert.ok(stored.startsWith("yb1."));
  });
  let latest;
  await check("reschedule_same_occurrence_and_stale_write", async () => {
    const result = await write(caregiver, `${prefix}/${original.id}/change`, { action: "reschedule", expectedVersion: 1, confirm: true,
      note: "合成改期", dueAt: "2026-09-30T10:00:00+08:00", timeZone: "Asia/Hong_Kong", assigneeUserId: owner.id });
    caregiverCommand = result.command; latest = result.receipt.result.task;
    assert.equal(latest.occurrence.id, original.occurrence.id); assert.equal(latest.version, 2);
    const stale = await operation(owner, `${prefix}/${original.id}/change`, { action: "complete", expectedVersion: 1, confirm: true, note: "" });
    await request(owner, "/online/submit", stale, 409);
    const page = (await request(viewer, prefix)).data; assert.equal(page.items[0].version, 2);
  });
  await check("opposing_terminal_operations_and_resolution", async () => {
    const a = await operation(owner, `${prefix}/${original.id}/change`, { action: "complete", expectedVersion: 2, confirm: true, note: "合成完成" });
    const b = await operation(caregiver, `${prefix}/${original.id}/change`, { action: "cancel", expectedVersion: 2, confirm: true, note: "合成取消" });
    await Promise.all([request(owner, "/online/submit", a), request(caregiver, "/online/submit", b)]);
    latest = (await request(viewer, `${prefix}/${original.id}`)).data.task;
    assert.equal(latest.version, 4); assert.equal(latest.occurrence.state, "needs_review");
    const history = (await request(viewer, `${prefix}/${original.id}/history`)).data.revisions;
    assert.deepEqual(history.slice(0, 2).map(value => value.action).sort(), ["cancel", "complete"]);
    assert.ok(history.slice(0, 2).every(value => value.basisVersion === 2));
    latest = (await write(owner, `${prefix}/${original.id}/change`, { action: "resolve", expectedVersion: 4, outcome: "completed", confirm: true, note: "已核對合成結果" })).receipt.result.task;
    assert.equal(latest.occurrence.state, "completed");
    const revive = await operation(caregiver, `${prefix}/${original.id}/change`, { action: "reschedule", expectedVersion: 5, confirm: true, note: "不得復活", dueAt: values.dueAt, timeZone: values.timeZone, assigneeUserId: caregiver.id });
    await request(caregiver, "/online/submit", revive, 409);
  });
  await check("shared_change_feed_and_receipt", async () => {
    const identity = createCommand.operation;
    const feed = (await request(viewer, `/online/changes?workspaceId=${identity.workspaceId}&storageEpoch=${identity.storageEpoch}&cursor=0`)).data;
    assert.equal(feed.changes.filter(value => value.kind === "tasks").length, 5);
    const receipt = (await request(owner, `/online/operations/${identity.opId}`)).data;
    assert.equal(receipt.result.task.id, original.id); assert.equal(receipt.result.task.version, 1);
    // Receipts describe the original operation, not the current task state.
    assert.equal((await request(viewer, `${prefix}/${original.id}`)).data.task.version, 5);
  });
  await check("server_recreation_and_reconnection", async () => {
    await new Promise(resolve => server.close(resolve)); server = undefined;
    await pool.end(); pool = createPool(config); await start();
    const task = (await request(caregiver, `${prefix}/${original.id}`)).data.task;
    assert.deepEqual(task, latest); assert.equal(task.details, values.details);
  });
  await check("revocation_clears_read_and_replay_access", async () => {
    const space = (await request(owner, "/families")).data.families.find(item => item.id === familyId);
    await request(owner, `/families/${familyId}/members/${caregiver.id}`, { role: "revoked", expectedVersion: space.version });
    await request(caregiver, prefix, undefined, 404);
    await request(caregiver, `/online/operations/${caregiverCommand.operation.opId}`, undefined, 404);
    await request(caregiver, "/online/submit", caregiverCommand, 404);
    const assignment = await operation(owner, prefix, { values, confirm: true });
    await request(owner, "/online/submit", assignment, 400);
  });
  await check("new_child_only_deletion_and_no_recreation", async () => {
    await request(owner, `/children/${child.id}/delete`, { confirmChildId: child.id });
    for (const [table, column, list] of [["care_tasks", "id", ids], ["task_occurrences", "id", occurrences], ["task_revisions", "task_id", ids]]) {
      assert.equal((await pool.query(`SELECT 1 FROM ${table} WHERE ${column}=ANY($1::uuid[])`, [list])).rowCount, 0);
    }
    const receipt = (await request(owner, "/online/submit", createCommand)).data;
    assert.equal(receipt.result, null);
    assert.equal((await pool.query("SELECT 1 FROM children WHERE id=$1", [child.id])).rowCount, 0);
  });
  await check("prior_business_rows_unchanged", async () => {
    let checked = 0;
    for (const table of preservedTables) for (const row of (await pool.query(`SELECT * FROM ${table}`)).rows) {
      const key = `${table}:${row.id}`;
      if (prior.has(key)) { assert.deepEqual(row, prior.get(key)); checked++; }
    }
    assert.equal(checked, prior.size);
  });
  console.log(JSON.stringify({ status: "passed", checks, counts, limits, priorRowsPreserved: prior.size,
    database: "existing-local-synthetic", migration: "012-task-ledger", models: 0, notifications: 0, browser: false, deployed: false }));
} catch (error) {
  console.error(JSON.stringify({ status: "failed", step, checks, counts, error: error instanceof assert.AssertionError ? "assertion_failed" : error?.name ?? "Error" }));
  process.exitCode = 1;
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool?.end();
}
