import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { realpath, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
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
import { createTaskScheduling } from "../server/task-worker.ts";
import { reminderLocalTime } from "../server/task-policy.ts";
import { createWorkerQueue, TASK_QUEUE, FAILED_QUEUE, JOB_OPTIONS, jobDataSchema } from "../server/worker-queue.ts";
import { createEncryptedBackup, restoreEncryptedBackup } from "../server/backup.ts";
import { createStorageCipher, readSecretKey } from "../server/storage-crypto.ts";
import { verifyEncryptedStorage } from "../server/storage-upgrade.ts";

const limits = { accounts: 3, children: 1, tasks: 12, http: 50, business: 100, workers: 2, restoreDatabases: 1, polls: 600 };
const counts = { accounts: 0, children: 0, tasks: 0, http: 0, business: 0, workersStarted: 0, restoreDatabases: 0, polls: 0 };
const repository = resolve(fileURLToPath(new URL("../", import.meta.url)));
const runId = randomUUID(), marker = `worker_acceptance_${randomBytes(6).toString("hex")}`;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const workers = new Set(), passed = [], taskIds = [], canaries = [];
const omitted = new Set(["app_migrations", "session", "verification", "worker_control"]);
let pool, restoredPool, producer, server, guard, directory, restoredDatabase, child, owner, caregiver;
let config, env, cipher, scheduling, tasks, families, online, records, backgroundFailure, outcome, recoveryMilliseconds;
let step = "preflight", childDeleted = false, originalControlEnabled = false, controlTouched = false, restoreCreationConfirmed = false;
const count = key => { if (++counts[key] > limits[key]) throw new Error("worker_acceptance_scope_cap"); };
const business = action => { count("business"); return action(); };
const check = async (name, action) => { step = name; await action(); passed.push(name); };
const dueNow = () => new Date(Date.now() - 5000).toISOString();
const later = () => new Date(Date.now() + 12 * 3600000).toISOString();
const noQuiet = { timeZone: "Asia/Hong_Kong", quietStart: "00:00", quietEnd: "00:00", allowAppointmentDuringQuiet: false };

function taggedUrl(url) {
  const value = new URL(url); value.searchParams.set("application_name", marker); return value;
}
function serverEnv(url) {
  return { ...process.env, DATABASE_URL: taggedUrl(url).toString(), AI_ENABLED: "false", NODE_ENV: "test",
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), SERVER_ORIGIN: "http://127.0.0.1:3099", WEB_ORIGIN: "http://127.0.0.1:3099", PORT: "3099" };
}
async function bounded(promise, milliseconds) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("worker_acceptance_timeout")), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
async function waitFor(read, accept, timeout = 30000, interval = 500) {
  const deadline = Date.now() + timeout;
  do {
    if (backgroundFailure) throw backgroundFailure;
    count("polls");
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() >= deadline) break;
    await delay(Math.min(interval, deadline - Date.now()));
  } while (Date.now() <= deadline);
  throw new Error("worker_acceptance_timeout");
}
async function foreignSessions(databasePool = pool) {
  // Refuse all foreign clients, including idle connections without a worker label.
  const rows = await databasePool.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
    AND (backend_type='client backend' OR backend_type IS NULL) AND pid<>pg_backend_pid()
    AND application_name IS DISTINCT FROM $1`, [marker]);
  assert.equal(rows.rowCount, 0);
}
async function snapshot(databasePool, names) {
  const client = await databasePool.connect(), result = new Map();
  try {
    await client.query("BEGIN"); await client.query("SET LOCAL TIME ZONE 'UTC'");
    names ??= (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows
      .map(row => row.tablename).filter(name => !omitted.has(name));
    for (const name of names) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error("worker_acceptance_table_invalid");
      const rows = (await client.query(`SELECT row_to_json(t)::text AS value FROM public."${name}" t`)).rows;
      const hashes = new Map();
      for (const row of rows) {
        const hash = createHash("sha256").update(row.value).digest("hex"); hashes.set(hash, (hashes.get(hash) ?? 0) + 1);
      }
      result.set(name, hashes);
    }
    await client.query("COMMIT"); return result;
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}
function preserve(before, after, exact = false) {
  for (const [table, hashes] of before) {
    assert.ok(after.has(table));
    for (const [hash, n] of hashes) assert.ok((after.get(table).get(hash) ?? 0) >= n);
    if (exact) assert.deepEqual(after.get(table), hashes);
  }
}
async function protectedDirectory() {
  const requested = process.env.WORKER_ACCEPTANCE_DIR;
  if (!requested || !isAbsolute(requested)) throw new Error("worker_acceptance_directory_required");
  const path = await realpath(requested), repo = await realpath(repository), inside = relative(repo, path);
  if (!inside || inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside)) throw new Error("worker_acceptance_directory_in_repository");
  const info = await stat(path);
  if (!info.isDirectory() || process.platform !== "win32" && (info.mode & 0o077)) throw new Error("worker_acceptance_directory_unprotected");
  if (process.platform === "win32") {
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "$ErrorActionPreference='Stop'; $acl=Get-Acl -LiteralPath $env:WORKER_ACCEPTANCE_DIR; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; if(-not $acl.AreAccessRulesProtected){exit 1}; foreach($rule in $acl.Access){if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -notin @($sid,'S-1-5-18')){exit 1}}"],
    { env: { ...process.env, WORKER_ACCEPTANCE_DIR: path }, stdio: "ignore", timeout: 10000, windowsHide: true });
  }
  return path;
}
async function request(account, path, body, expected = 200) {
  count("http");
  const response = await fetch(`${config.publicOrigin}/api${path}`, { method: body === undefined ? "GET" : "POST", signal: AbortSignal.timeout(10000),
    headers: { origin: config.publicOrigin, connection: "close", ...(account ? { cookie: account.cookie, "x-expected-user-id": account.id } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal(response.status, expected);
  return { data: await response.json(), headers: response.headers };
}
async function startServer() {
  const handler = createRequestHandler({ config, auth: createAuth(config, pool), workspaces: createWorkspaceStore(pool), records,
    families, tasks, online, checkDatabase: async () => { await pool.query("SELECT 1"); } });
  server = createServer((request, response) => { void handler(request, response); });
  await new Promise((resolveReady, reject) => { server.once("error", reject); server.listen(config.port, "127.0.0.1", resolveReady); });
}
function bindTaskStores() {
  scheduling = createTaskScheduling(cipher, producer.queue);
  tasks = createTaskStore(pool, cipher, scheduling); online = createOnlineStore(pool, cipher, scheduling);
}
async function closeServer() { if (server) { const current = server; server = undefined; await bounded(new Promise(resolveClosed => current.close(resolveClosed)), 15000); } }
async function newTask(kind = "appointment", assignee = owner, issuer = owner, store = tasks) {
  if (counts.tasks >= limits.tasks) throw new Error("worker_acceptance_scope_cap");
  const title = `WORKER-ACCEPTANCE-${randomUUID()}`; canaries.push(title);
  const task = await business(() => store.create(issuer.id, child.id, { confirm: true, values: {
    title, details: "合成 worker 驗收資料", kind, assigneeUserId: assignee.id, dueAt: dueNow(), timeZone: "Asia/Hong_Kong",
  } }));
  assert.ok(task); count("tasks"); taskIds.push(task.id); return task;
}
const workFor = (task, databasePool = pool) => databasePool.query("SELECT * FROM task_work WHERE task_id=$1 AND task_version=$2", [task.id, task.version]).then(result => result.rows[0]);
const reminderCount = (task, databasePool = pool) => databasePool.query("SELECT count(*)::int AS n FROM task_reminders WHERE occurrence_id=$1", [task.occurrence.id]).then(result => result.rows[0].n);
const jobFor = (id, databasePool = pool) => databasePool.query("SELECT id,state,retry_count,data,output FROM pgboss.job WHERE name=$1 AND id=$2", [TASK_QUEUE, id]).then(result => result.rows[0]);
const settled = id => waitFor(() => jobFor(id), row => row?.state === "completed");

async function startWorker(mode = "normal", target, url = config.databaseUrl) {
  await foreignSessions(new URL(url).pathname === new URL(config.databaseUrl).pathname ? pool : restoredPool);
  if ([...workers].filter(value => !value.exit).length >= limits.workers) throw new Error("worker_acceptance_scope_cap");
  const fixture = spawn(process.execPath, [fileURLToPath(new URL("./task-worker-fixture.mjs", import.meta.url)), mode, "--worker-fixture"], {
    cwd: repository, windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"],
    env: { ...env, DATABASE_URL: taggedUrl(url).toString(), WORKER_ACCEPTANCE_RUN_ID: runId, WORKER_FIXTURE_TARGET_WORK_ID: target ?? "" },
  });
  const entry = { process: fixture, events: [], expectedExit: false, exit: null, stopped: false };
  workers.add(entry); counts.workersStarted++;
  entry.finished = new Promise(resolveExit => {
    fixture.once("exit", (code, signal) => {
      entry.exit = { code, signal }; resolveExit(entry.exit);
      if (!entry.expectedExit) backgroundFailure = new Error("worker_fixture_unexpected_exit");
    });
  });
  fixture.once("error", () => { backgroundFailure = new Error("worker_fixture_spawn_failed"); });
  fixture.on("message", message => {
    if (!message || typeof message !== "object") { backgroundFailure = new Error("worker_fixture_message_invalid"); return; }
    if (message.type === "call") {
      if (!uuid.test(message.requestId ?? "") || !["process", "failed", "unavailable"].includes(message.kind)) { backgroundFailure = new Error("worker_fixture_message_invalid"); return; }
      try { count("business"); fixture.send({ type: "grant-call", requestId: message.requestId }); }
      catch { backgroundFailure = new Error("worker_acceptance_scope_cap"); if (fixture.connected) fixture.send({ type: "deny-call", requestId: message.requestId }); }
    } else if (message.type === "ready" && message.pid === fixture.pid
      || message.type === "claimed" && uuid.test(message.workId ?? "") && uuid.test(message.jobId ?? "") && Number.isInteger(message.retryCount)) {
      entry.events.push(message);
    } else backgroundFailure = new Error("worker_fixture_failed");
  });
  await waitFor(() => entry.events, events => events.some(event => event.type === "ready"));
  return entry;
}
const claimed = (entry, work) => waitFor(() => entry.events, events => events.some(event => event.type === "claimed" && event.workId === work.id && event.jobId === work.job_id));
const resume = (entry, work) => entry.process.send({ type: "resume", jobId: work.job_id });
async function stopWorker(entry, hard = false) {
  if (entry.exit) return;
  entry.expectedExit = true;
  if (hard) { if (!entry.process.kill("SIGKILL")) throw new Error("worker_fixture_kill_failed"); }
  else if (entry.process.connected) entry.process.send({ type: "stop" });
  const exit = await bounded(entry.finished, 25000);
  if (!hard) assert.equal(exit.code, 0);
  entry.stopped = true;
}
async function stopWorkers() { for (const entry of workers) await stopWorker(entry); }
async function change(task, action, extra = {}) {
  return business(() => tasks.change(owner.id, child.id, task.id, { action, expectedVersion: task.version, confirm: true, note: "合成狀態變更", ...extra }));
}
async function fenced(task, mutate, accept) {
  const work = await workFor(task), worker = await startWorker("stall-before-process", work.id);
  await claimed(worker, work); const result = await mutate(); resume(worker, work); await settled(work.job_id); await stopWorker(worker);
  assert.equal(await reminderCount(task), 0); await accept(result, await workFor(task));
}

try {
  if (!process.argv.includes("--approved-task-worker")) throw new Error("worker_acceptance_approval_required");
  const source = new URL(process.env.TEST_DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(source.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)
    || source.pathname !== "/yuban_s06_test" || source.search || source.hash || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(process.env.PG_TOOL_CONTAINER ?? "")) {
    throw new Error("worker_acceptance_local_container_required");
  }
  directory = await protectedDirectory();
  const storageKey = await readSecretKey(process.env.STORAGE_KEY_FILE), backupKey = await readSecretKey(process.env.BACKUP_KEY_FILE);
  assert.equal(timingSafeEqual(storageKey, backupKey), false); cipher = createStorageCipher(storageKey);
  env = serverEnv(source); config = readServerConfig(env); pool = createPool(config);
  await foreignSessions();
  guard = await pool.connect(); assert.equal((await guard.query("SELECT pg_try_advisory_lock(173061,13) AS acquired")).rows[0].acquired, true);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM care_tasks")).rows[0].n, 0);
  if ((await pool.query("SELECT to_regclass('public.worker_control') AS present")).rows[0].present) {
    originalControlEnabled = (await pool.query("SELECT enabled FROM worker_control WHERE id=1")).rows[0]?.enabled;
    assert.equal(typeof originalControlEnabled, "boolean");
  }
  if ((await pool.query("SELECT to_regclass('pgboss.job') AS present")).rows[0].present) {
    assert.equal((await pool.query("SELECT 1 FROM pgboss.job WHERE state NOT IN ('completed','cancelled','failed') LIMIT 1")).rowCount, 0);
  }
  const prior = await snapshot(pool), tools = url => ({ databaseUrl: new URL(url).toString(), container: process.env.PG_TOOL_CONTAINER });
  await check("prior_encrypted_backup", () => createEncryptedBackup(tools(source), join(directory, `${marker}-before.ybak`), backupKey));
  await check("migration_and_prior_business_rows", async () => {
    execFileSync(process.execPath, ["server/migrate.ts"], { cwd: repository, env, stdio: "ignore", timeout: 60000, windowsHide: true });
    await verifyEncryptedStorage(pool, cipher); await foreignSessions();
    assert.equal((await pool.query("SELECT 1 FROM app_migrations WHERE id='013-task-worker'")).rowCount, 1);
    assert.equal((await pool.query("SELECT version FROM pgboss.version")).rows[0].version, 42);
    assert.equal(JOB_OPTIONS.heartbeatSeconds, 60); assert.equal(JOB_OPTIONS.retryLimit, 2);
    preserve(prior, await snapshot(pool, [...prior.keys()]));
  });
  const { activateTaskWorker } = await import("../server/worker-control.ts");
  producer = createWorkerQueue(pool, "producer"); await producer.start();
  bindTaskStores(); families = createFamilyStore(pool, cipher, true); records = createRecordStore(pool, cipher, true);
  await check("bounded_synthetic_family_and_preferences", async () => {
    await startServer();
    const users = [];
    for (let index = 0; index < 2; index++) {
      count("accounts");
      const email = `worker-${randomUUID()}@example.test`;
      const response = await request(null, "/auth/sign-up/email", { name: `合成 worker 成員 ${index}`, email, password: randomBytes(24).toString("hex") });
      users.push({ id: response.data.user.id, email, cookie: response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") });
    }
    [owner, caregiver] = users;
    count("children"); child = (await request(owner, "/children", { displayName: "S13 worker 新建合成孩子" }, 201)).data.child;
    const family = (await business(() => families.list(owner.id))).find(value => value.id === child.workspaceId);
    const invitation = await business(() => families.invite(owner.id, family.id, caregiver.email, "caregiver", family.version));
    await business(() => families.accept(caregiver.id, invitation.token, family.id));
    for (const user of users) await business(() => families.savePreferences(user.id, noQuiet, 0));
    assert.equal((await request(owner, `/children/${child.id}/tasks`)).data.items.length, 0);
    await closeServer(); assert.equal(server, undefined);
    if (!(await pool.query("SELECT enabled FROM worker_control WHERE id=1")).rows[0].enabled) {
      controlTouched = true; await business(() => activateTaskWorker(pool, cipher, producer.queue));
    }
  });
  await check("atomic_task_receipt_and_job_rollback", async () => {
    let ref, failedTask;
    const broken = createTaskScheduling(cipher, { async enqueue(client, jobId, workId, at, failures) {
      ref = { jobId, workId }; await producer.queue.enqueue(client, jobId, workId, at, failures); throw new Error("worker_acceptance_enqueue_failure");
    } });
    const originalChanged = broken.changed;
    broken.changed = async (...args) => { failedTask = args[3].id; return originalChanged(...args); };
    const brokenOnline = createOnlineStore(pool, cipher, broken), path = `/api/children/${child.id}/tasks`;
    const payload = { confirm: true, values: { title: "合成原子回滾", details: "", kind: "appointment", assigneeUserId: owner.id, dueAt: dueNow(), timeZone: "Asia/Hong_Kong" } };
    const context = await business(() => brokenOnline.context(owner.id, { path, payload })), opId = randomUUID();
    await assert.rejects(business(() => brokenOnline.submit(owner.id, { path, payload, operation: { ...context, opId, deviceId: randomUUID() } })),
      error => error?.message === "worker_acceptance_enqueue_failure");
    assert.ok(ref); assert.ok(failedTask);
    for (const [sql, id] of [["SELECT 1 FROM care_tasks WHERE id=$1", failedTask], ["SELECT 1 FROM task_work WHERE id=$1", ref.workId],
      ["SELECT 1 FROM pgboss.job WHERE id=$1", ref.jobId], ["SELECT 1 FROM online_operations WHERE op_id=$1", opId]]) assert.equal((await pool.query(sql, [id])).rowCount, 0);
  });
  let original;
  await check("two_processes_backfill_merge_and_duplicate_refs", async () => {
    original = await newTask("ordinary", owner, owner, createTaskStore(pool, cipher));
    assert.equal(await workFor(original), undefined);
    controlTouched = true;
    await pool.query("UPDATE worker_control SET enabled=false WHERE id=1");
    await business(() => activateTaskWorker(pool, cipher, producer.queue));
    const first = await workFor(original); assert.ok(first);
    const a = await startWorker("stall-before-process", first.id); await claimed(a, first);
    await startServer();
    if (counts.tasks >= limits.tasks) throw new Error("worker_acceptance_scope_cap");
    const title = `WORKER-ACCEPTANCE-${randomUUID()}`; canaries.push(title);
    const path = `/api/children/${child.id}/tasks`, payload = { confirm: true, values: {
      title, details: "合成 worker 驗收資料", kind: "ordinary", assigneeUserId: owner.id, dueAt: dueNow(), timeZone: "Asia/Hong_Kong",
    } };
    const context = (await business(() => request(owner, "/online/context", { path, payload }))).data;
    const submission = { path, payload, operation: { ...context, opId: randomUUID(), deviceId: randomUUID() } };
    const receipt = (await business(() => request(owner, "/online/submit", submission))).data;
    const second = receipt.result.task; assert.ok(second); count("tasks"); taskIds.push(second.id);
    assert.equal(second.title, title); assert.equal(second.kind, "ordinary");
    const secondWork = await workFor(second); assert.ok(secondWork);
    assert.deepEqual((await business(() => request(owner, "/online/submit", submission))).data, receipt);
    assert.deepEqual(await workFor(second), secondWork);
    assert.equal((await pool.query("SELECT 1 FROM care_tasks WHERE id=$1", [second.id])).rowCount, 1);
    assert.equal((await pool.query("SELECT 1 FROM task_work WHERE task_id=$1", [second.id])).rowCount, 1);
    const jobs = (await pool.query("SELECT id FROM pgboss.job WHERE name=$1 AND data->>'workId'=$2", [TASK_QUEUE, secondWork.id])).rows;
    assert.equal(jobs.length, 1); assert.equal(jobs[0].id, secondWork.job_id);
    // Start the competing consumer after receipt replay, keeping job-count evidence stable.
    const b = await startWorker(); assert.notEqual(a.process.pid, b.process.pid);
    await waitFor(() => reminderCount(second), n => n === 1); await claimed(b, secondWork);
    resume(a, first); await settled(first.job_id); await waitFor(() => reminderCount(original), n => n === 1);
    const batch = (await pool.query("SELECT batch_id FROM task_reminders WHERE task_id=ANY($1::uuid[])", [[original.id, second.id]])).rows;
    assert.equal(batch.length, 2); assert.equal(new Set(batch.map(value => value.batch_id)).size, 1);
    const duplicate = randomUUID(), client = await pool.connect();
    try { await client.query("BEGIN"); await producer.queue.enqueue(client, duplicate, first.id, dueNow()); await client.query("COMMIT"); }
    catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; } finally { client.release(); }
    await settled(duplicate); assert.equal(await reminderCount(original), 1); assert.equal(await reminderCount(second), 1);
    const page = (await business(() => request(owner, `/children/${child.id}/tasks`))).data;
    assert.equal(page.workerEnabled, true); assert.equal(page.items.length, 2);
    for (const expected of [original, second]) {
      const item = page.items.find(value => value.id === expected.id);
      assert.ok(item); assert.equal(item.version, expected.version); assert.equal(item.occurrence.id, expected.occurrence.id);
      assert.equal(item.occurrence.state, "scheduled");
      const reminder = page.reminders.filter(value => value.taskId === item.id);
      assert.equal(reminder.length, 1); assert.equal(reminder[0].occurrenceId, item.occurrence.id);
      assert.equal(reminder[0].taskVersion, item.version); assert.equal(reminder[0].phase, "initial");
      const work = page.work.filter(value => value.taskId === item.id);
      assert.equal(work.length, 1); assert.equal(work[0].taskVersion, item.version); assert.equal(work[0].status, "pending");
      assert.ok(Date.parse(work[0].nextAt) > Date.now());
    }
    await closeServer(); assert.equal(server, undefined);
    await stopWorkers();
    original = await change(original, "complete"); const completedSecond = await change(second, "complete");
    assert.equal(original.occurrence.state, "completed"); assert.equal(completedSecond.occurrence.state, "completed");
    const stopped = (await pool.query("SELECT status FROM task_work WHERE id=ANY($1::uuid[])", [[first.id, secondWork.id]])).rows;
    assert.equal(stopped.length, 2); assert.ok(stopped.every(value => value.status === "stopped"));
  });
  await check("lost_settlement_ack_does_not_duplicate_result", async () => {
    const task = await newTask(), work = await workFor(task), worker = await startWorker("process-then-throw-once", work.id);
    const job = await settled(work.job_id); assert.equal(job.retry_count, 1); assert.equal(await reminderCount(task), 1);
    assert.equal((await workFor(task)).status, "processed"); await stopWorker(worker);
  });
  await check("quiet_time_defers_same_work", async () => {
    const minutes = reminderLocalTime(new Date().toISOString(), "Asia/Hong_Kong").minutes;
    const clock = value => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
    await business(() => families.savePreferences(caregiver.id, { ...noQuiet, quietStart: clock((minutes + 1380) % 1440), quietEnd: clock((minutes + 60) % 1440) }, 1));
    const task = await newTask("ordinary", caregiver), work = await workFor(task), worker = await startWorker();
    await settled(work.job_id); const deferred = await workFor(task);
    assert.equal(deferred.id, work.id); assert.equal(deferred.status, "pending"); assert.notEqual(deferred.job_id, work.job_id);
    assert.ok(new Date(deferred.run_at).getTime() > Date.now()); assert.equal(await reminderCount(task), 0);
    await stopWorker(worker); await change(task, "cancel");
    await business(() => families.savePreferences(caregiver.id, noQuiet, 2));
  });
  let cancelled;
  await check("claimed_cancel_and_reschedule_fences", async () => {
    cancelled = await newTask();
    await fenced(cancelled, () => change(cancelled, "cancel"), async (task, work) => { assert.equal(task.occurrence.state, "cancelled"); assert.equal(work.status, "stopped"); });
    const task = await newTask();
    await fenced(task, () => change(task, "reschedule", { dueAt: later(), timeZone: "Asia/Hong_Kong", assigneeUserId: owner.id }), async (changed, oldWork) => {
      assert.equal(oldWork.status, "stopped"); assert.equal(changed.occurrence.id, task.occurrence.id);
      const fresh = await workFor(changed); assert.equal(fresh.status, "pending"); assert.notEqual(fresh.job_id, oldWork.job_id);
      await change(changed, "cancel");
    });
  });
  await check("claimed_assignee_and_issuer_revocation_fences", async () => {
    const assigned = await newTask("appointment", caregiver), assignedWork = await workFor(assigned);
    const a = await startWorker("stall-before-process", assignedWork.id); await claimed(a, assignedWork);
    const issued = await newTask("appointment", owner, caregiver), issuedWork = await workFor(issued);
    const b = await startWorker("stall-before-process", issuedWork.id); await claimed(b, issuedWork);
    const family = (await business(() => families.list(owner.id))).find(value => value.id === child.workspaceId);
    await business(() => families.setMember(owner.id, family.id, caregiver.id, "revoked", family.version));
    resume(a, assignedWork); resume(b, issuedWork); await settled(assignedWork.job_id); await settled(issuedWork.job_id);
    assert.equal((await workFor(assigned)).status, "stopped"); assert.equal((await workFor(issued)).status, "stopped");
    assert.equal(await reminderCount(assigned), 0); assert.equal(await reminderCount(issued), 0); await stopWorkers();
  });
  await check("finite_failure_budget_and_activation_preservation", async () => {
    const task = await newTask(), work = await workFor(task), worker = await startWorker("fail-before-process", work.id);
    const failed = await waitFor(() => workFor(task), value => value?.status === "failed");
    assert.equal(failed.failures, 3); assert.equal(await reminderCount(task), 0);
    const job = await waitFor(() => jobFor(work.job_id), value => value?.state === "failed"); assert.equal(job.retry_count, 2);
    await waitFor(() => pool.query("SELECT state FROM pgboss.job WHERE name=$1 AND source_id=$2", [FAILED_QUEUE, work.job_id]).then(value => value.rows),
      rows => rows.length === 1 && rows[0].state === "completed");
    await stopWorker(worker); await pool.query("UPDATE worker_control SET enabled=false WHERE id=1");
    await business(() => activateTaskWorker(pool, cipher, producer.queue));
    const reviewed = await workFor(task); assert.equal(reviewed.status, "failed"); assert.equal(reviewed.failures, 3); assert.equal(reviewed.job_id, work.job_id);
    assert.equal((await workFor(cancelled)).status, "stopped");
  });
  await check("hard_kill_recovery_production_heartbeat", async () => {
    const task = await newTask(), work = await workFor(task), stalled = await startWorker("stall-before-process", work.id);
    await claimed(stalled, work); assert.equal((await jobFor(work.job_id)).state, "active");
    const started = Date.now(); await stopWorker(stalled, true);
    const replacement = await startWorker();
    const job = await waitFor(() => jobFor(work.job_id), value => value?.state === "completed", Math.max(1, 180000 - (Date.now() - started)), 1000);
    recoveryMilliseconds = Date.now() - started; assert.ok(recoveryMilliseconds <= 180000); assert.ok(job.retry_count >= 1);
    assert.equal(await reminderCount(task), 1); assert.equal((await workFor(task)).status, "processed"); await stopWorker(replacement);
  });
  await check("stopped_worker_persistence_and_http_closed", async () => {
    assert.equal(server, undefined); assert.ok([...workers].every(value => value.exit));
    const task = await newTask(), work = await workFor(task); assert.equal((await jobFor(work.job_id)).state, "created");
    assert.equal(await reminderCount(task), 0); await producer.stop(); producer = createWorkerQueue(pool, "producer"); await producer.start(); bindTaskStores();
    const worker = await startWorker(); await settled(work.job_id); assert.equal(await reminderCount(task), 1); await stopWorker(worker);
  });
  await check("encrypted_backup_active_job_and_paused_restore_restart", async () => {
    const task = await newTask(), work = await workFor(task), stalled = await startWorker("stall-before-process", work.id);
    await claimed(stalled, work); assert.equal((await jobFor(work.job_id)).state, "active");
    const originalTask = await business(() => tasks.get(owner.id, child.id, original.id));
    const originalEncrypted = (await pool.query("SELECT payload_encrypted FROM care_tasks WHERE id=$1", [original.id])).rows[0].payload_encrypted;
    const generation = (await pool.query("SELECT generation FROM worker_control WHERE id=1")).rows[0].generation;
    const expected = await snapshot(pool), backup = join(directory, `${marker}-active.ybak`);
    await createEncryptedBackup(tools(source), backup, backupKey);
    restoredDatabase = `yuban_s06_test_worker_restore_${randomBytes(6).toString("hex")}`;
    assert.match(restoredDatabase, /^yuban_s06_test_worker_restore_[0-9a-f]{12}$/); count("restoreDatabases");
    await pool.query(`CREATE DATABASE "${restoredDatabase}"`);
    restoreCreationConfirmed = true;
    const target = new URL(source); target.pathname = `/${restoredDatabase}`; assert.notEqual(target.pathname, source.pathname);
    restoredPool = createPool(readServerConfig(serverEnv(target)));
    assert.equal((await restoredPool.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
      AND c.relkind IN ('r','p','v','m','S','f') LIMIT 1`)).rowCount, 0);
    await restoreEncryptedBackup(tools(target), backup, backupKey); await verifyEncryptedStorage(restoredPool, cipher);
    assert.equal((await restoredPool.query("SELECT version FROM pgboss.version")).rows[0].version, 42);
    const control = (await restoredPool.query("SELECT enabled,generation FROM worker_control WHERE id=1")).rows[0];
    assert.equal(control.enabled, false); assert.notEqual(control.generation, generation);
    assert.equal((await jobFor(work.job_id, restoredPool)).state, "active");
    preserve(expected, await snapshot(restoredPool, [...expected.keys()]), true);
    assert.equal((await restoredPool.query("SELECT payload_encrypted FROM care_tasks WHERE id=$1", [original.id])).rows[0].payload_encrypted, originalEncrypted);
    assert.deepEqual(await business(() => createTaskStore(restoredPool, cipher).get(owner.id, child.id, original.id)), originalTask);
    const restoredWorker = await startWorker("normal", undefined, target);
    await waitFor(() => jobFor(work.job_id, restoredPool), value => value?.state === "completed", 180000, 1000);
    assert.equal(await reminderCount(task, restoredPool), 0); assert.equal((await workFor(task, restoredPool)).status, "pending");
    assert.equal((await restoredPool.query("SELECT enabled FROM worker_control WHERE id=1")).rows[0].enabled, false);
    preserve(expected, await snapshot(restoredPool, [...expected.keys()]), true);
    await stopWorker(restoredWorker); await stopWorker(stalled);
  });
  await check("job_refs_only_and_new_child_only_cleanup", async () => {
    await stopWorkers(); await foreignSessions();
    for (const row of (await pool.query("SELECT data,output FROM pgboss.job WHERE name=ANY($1::text[])", [[TASK_QUEUE, FAILED_QUEUE]])).rows) {
      jobDataSchema.parse(row.data);
      const encoded = JSON.stringify(row); assert.ok(!canaries.some(value => encoded.includes(value))); assert.ok(!encoded.includes("合成 worker 驗收資料"));
    }
    assert.equal(await business(() => records.deleteChildForUser(owner.id, child.id)), true); childDeleted = true;
    for (const table of ["care_tasks", "task_occurrences", "task_revisions", "task_work", "task_reminders"]) {
      const column = table === "care_tasks" ? "id" : "task_id";
      assert.equal((await pool.query(`SELECT 1 FROM ${table} WHERE ${column}=ANY($1::uuid[])`, [taskIds])).rowCount, 0);
    }
    assert.equal((await pool.query("SELECT 1 FROM children WHERE id=$1", [child.id])).rowCount, 0);
    preserve(prior, await snapshot(pool, [...prior.keys()]));
  });
  if (backgroundFailure) throw backgroundFailure;
  outcome = { status: "passed", checks: passed, counts, limits, originalDatabaseRetained: true, priorBusinessRowsPreserved: true,
    syntheticChildDeleted: true, restoredDatabase, restoredWorkerPaused: true, schemaVersion: 42, heartbeatSeconds: 60,
    monitorSeconds: 60, recoveryMilliseconds, httpServerClosedDuringLaterWorkerEffects: true, models: 0, notifications: 0, browser: false, deployed: false };
} catch (error) {
  outcome = { status: "failed", step, checks: passed, counts, limits, error: error instanceof assert.AssertionError ? "assertion_failed" : error?.name ?? "Error",
    originalDatabaseRetained: true, syntheticChildRetained: Boolean(child && !childDeleted),
    ...(restoredDatabase ? { restoredDatabase, restoreCreationConfirmed, restoreRetainedForReview: restoreCreationConfirmed } : {}) };
  process.exitCode = 1;
} finally {
  const cleanupFailure = () => { outcome = { ...outcome, status: "failed", cleanupFailed: true }; process.exitCode = 1; };
  try {
    await stopWorkers();
  } catch {
    // Force only subprocesses started by this script; preserve every database.
    for (const entry of workers) if (!entry.exit) {
      entry.expectedExit = true; entry.process.kill("SIGKILL"); await bounded(entry.finished, 10000).catch(() => {});
    }
    cleanupFailure();
  }
  await closeServer().catch(cleanupFailure); await producer?.stop().catch(cleanupFailure);
  if (controlTouched) {
    try {
      await pool.query("UPDATE worker_control SET enabled=$1 WHERE id=1", [originalControlEnabled]);
      assert.equal((await pool.query("SELECT enabled FROM worker_control WHERE id=1")).rows[0].enabled, originalControlEnabled);
      outcome = { ...outcome, sourceControlEnabledRestored: true, sourceControlEnabled: originalControlEnabled };
    } catch { cleanupFailure(); }
  }
  if (guard) { await guard.query("SELECT pg_advisory_unlock(173061,13)").catch(() => {}); guard.release(); }
  for (const databasePool of [restoredPool, pool]) await databasePool?.end().catch(() => {
    outcome = { ...outcome, status: "failed", cleanupFailed: true }; process.exitCode = 1;
  });
  // Keep bounded synthetic references for a targeted continuation after a failed check.
  // Never print credentials, cookies, keys or family bodies.
  outcome = { ...outcome, syntheticScope: { ownerId: owner?.id ?? null, caregiverId: caregiver?.id ?? null,
    childId: child?.id ?? null, taskIds } };
  if (directory) await writeFile(join(directory, `${marker}-checks.json`), JSON.stringify(outcome, null, 2) + "\n", { flag: "wx", mode: 0o600 }).catch(() => {
    outcome = { ...outcome, status: "failed", evidenceWriteFailed: true }; process.exitCode = 1;
  });
  console.log(JSON.stringify(outcome));
}
