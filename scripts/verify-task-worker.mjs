import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { open, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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
const resumeCheckpoint = {
  checks: ["prior_encrypted_backup", "migration_and_prior_business_rows", "bounded_synthetic_family_and_preferences", "atomic_task_receipt_and_job_rollback"],
  counts: { accounts: 2, children: 1, tasks: 2, http: 7, business: 15, workersStarted: 2, restoreDatabases: 0, polls: 69 },
};
let pool, restoredPool, producer, server, guard, directory, restoredDatabase, child, owner, caregiver;
let config, env, cipher, scheduling, tasks, families, online, records, backgroundFailure, outcome, recoveryMilliseconds;
let resumeReport, resumeEvidence, resumeExclusions, resumedTasks, resumedWorks, recoveryResume = false;
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
async function snapshot(databasePool, names, exclusions) {
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
        const filters = exclusions?.get(name);
        if (filters?.length) {
          const value = JSON.parse(row.value);
          if (filters.some(filter => filter.ids.has(value[filter.column]))) continue;
        }
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
    const aclEnvironment = { ...process.env, WORKER_ACCEPTANCE_DIR: path };
    // A PowerShell 7 parent can pass incompatible modules to Windows PowerShell.
    // Let this isolated child discover its native modules; keep the ACL checks intact.
    for (const name of Object.keys(aclEnvironment)) if (name.toLowerCase() === "psmodulepath") delete aclEnvironment[name];
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "$ErrorActionPreference='Stop'; $acl=Get-Acl -LiteralPath $env:WORKER_ACCEPTANCE_DIR; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; if(-not $acl.AreAccessRulesProtected){exit 1}; foreach($rule in $acl.Access){if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -notin @($sid,'S-1-5-18')){exit 1}}"],
    { env: aclEnvironment, stdio: "ignore", timeout: 10000, windowsHide: true });
  }
  return path;
}
async function loadResumeReport() {
  const argumentsFound = process.argv.slice(2).filter(value => value.startsWith("--resume-report"));
  if (!argumentsFound.length) return;
  assert.equal(argumentsFound.length, 1);
  assert.ok(argumentsFound[0].startsWith("--resume-report="));
  const requested = argumentsFound[0].slice("--resume-report=".length); assert.ok(isAbsolute(requested));
  const path = await realpath(requested);
  assert.equal(relative(directory, dirname(path)), "");
  const name = basename(path); assert.match(name, /^worker_acceptance_[0-9a-f]{12}-checks\.json$/);
  const info = await stat(path);
  assert.ok(info.isFile() && info.size > 0 && info.size <= 32768);
  if (process.platform !== "win32") assert.equal(info.mode & 0o077, 0);
  const bytes = await readFile(path), report = JSON.parse(bytes.toString("utf8"));
  assert.equal(report.status, "failed");
  recoveryResume = report.step === "hard_kill_recovery_production_heartbeat";
  if (recoveryResume) {
    assert.deepEqual(report.counts, { accounts: 2, children: 1, tasks: 10, http: 12, business: 60, workersStarted: 13, restoreDatabases: 0, polls: 329 });
    assert.deepEqual(report.checks, [...resumeCheckpoint.checks, "resume_scope_baseline_and_synthetic_sign_in",
      "resumed_two_processes_duplicate_refs_and_http_metadata", "lost_settlement_ack_does_not_duplicate_result",
      "quiet_time_defers_same_work", "claimed_cancel_and_reschedule_fences", "claimed_assignee_and_issuer_revocation_fences",
      "finite_failure_budget_and_activation_preservation"]);
    assert.equal(report.executionMode, "resumed");
    assert.equal(report.resumedEvidence.initialReportSha256, "dab5aad8719c18a4acada69beda0639bf0506299d5f81f8f8791adf8194cf87b");
  } else {
    assert.equal(report.step, "two_processes_backfill_merge_and_duplicate_refs");
    assert.deepEqual(report.checks, resumeCheckpoint.checks); assert.deepEqual(report.counts, resumeCheckpoint.counts);
  }
  assert.deepEqual(report.limits, limits); assert.equal(report.originalDatabaseRetained, true);
  assert.equal(report.syntheticChildRetained, true); assert.equal(report.sourceControlEnabledRestored, true);
  assert.equal(report.sourceControlEnabled, false);
  assert.ok(!report.restoredDatabase && !report.cleanupFailed && !report.evidenceWriteFailed);
  const scope = report.syntheticScope;
  assert.deepEqual(Object.keys(scope).sort(), ["caregiverId", "childId", "ownerId", "taskIds"]);
  for (const id of [scope.ownerId, scope.caregiverId]) assert.match(id, /^[A-Za-z0-9]{1,128}$/);
  assert.notEqual(scope.ownerId, scope.caregiverId); assert.match(scope.childId, uuid);
  assert.ok(Array.isArray(scope.taskIds)); assert.equal(scope.taskIds.length, recoveryResume ? 10 : 2);
  for (const id of scope.taskIds) assert.match(id, uuid);
  assert.equal(new Set([scope.childId, ...scope.taskIds]).size, scope.taskIds.length + 1);
  const backupName = recoveryResume ? report.resumedEvidence.initialBackup : name.replace(/-checks\.json$/, "-before.ybak");
  assert.match(backupName, /^worker_acceptance_[0-9a-f]{12}-before\.ybak$/);
  const backupPath = await realpath(join(directory, backupName));
  assert.equal(relative(directory, dirname(backupPath)), "");
  const backupInfo = await stat(backupPath);
  assert.ok(backupInfo.isFile() && backupInfo.size > 32 && backupInfo.size <= 64 * 1024 * 1024 + 32);
  const file = await open(backupPath, "r");
  try { const magic = Buffer.alloc(4); assert.equal((await file.read(magic, 0, 4, 0)).bytesRead, 4); assert.equal(magic.toString(), "YBG1"); }
  finally { await file.close(); }
  resumeReport = report; Object.assign(counts, report.counts); passed.push(...report.checks); taskIds.push(...scope.taskIds);
  resumeEvidence = { initialReport: name, initialReportSha256: createHash("sha256").update(bytes).digest("hex"),
    initialStatus: report.status, initialStoppedStep: report.step, initialCounts: { ...report.counts }, carriedChecks: [...report.checks], initialBackup: backupName,
    initialBackupRetained: true, originalBackupComparisonReexecuted: false,
    initialMigrationPreservation: "carried_passed_check", initialDualProcessPhase: "previously_observed_by_primary_not_reexecuted" };
  if (recoveryResume) resumeEvidence = { ...report.resumedEvidence, recoveryContinuation: {
    priorReport: name, priorReportSha256: createHash("sha256").update(bytes).digest("hex"), priorCounts: { ...report.counts },
    cause: "Adapter discarded multi-statement pg results; supervisor could not recover expired jobs. Fixed without changing heartbeat or deadline.",
    priorHardKillFailed: true, sameLogicalTaskReused: true } };
  // A checkpoint is single-use: retrying the old report must not reset consumed caps.
  step = "resume_claim_initial_checkpoint";
  resumeEvidence.claim = name.replace(/-checks\.json$/, "-resume-claim.json");
  await writeFile(join(directory, resumeEvidence.claim), JSON.stringify({ initialReport: name,
    initialReportSha256: resumeEvidence.initialReportSha256, initialCounts: report.counts, continuation: marker }) + "\n", { flag: "wx", mode: 0o600 });
}
async function validateResumeScope() {
  step = "resume_exact_synthetic_identity";
  const scope = resumeReport.syntheticScope, ids = [scope.ownerId, scope.caregiverId];
  const users = (await pool.query('SELECT id,email,name FROM "user" WHERE id=ANY($1::text[])', [ids])).rows;
  assert.equal(users.length, 2);
  for (const [index, id] of ids.entries()) {
    const user = users.find(value => value.id === id); assert.ok(user);
    assert.equal(user.name, `合成 worker 成員 ${index}`); assert.match(user.email, /^worker-[0-9a-f-]{36}@example\.test$/);
  }
  [owner, caregiver] = ids.map(id => users.find(value => value.id === id));
  const spaces = (await pool.query("SELECT id,owner_user_id,storage_epoch FROM workspaces WHERE owner_user_id=ANY($1::text[])", [ids])).rows;
  assert.ok(spaces.length >= 1 && spaces.length <= 2);
  assert.equal(spaces.filter(value => value.owner_user_id === owner.id).length, 1);
  const children = (await pool.query("SELECT id,workspace_id FROM children WHERE workspace_id=ANY($1::uuid[])", [spaces.map(value => value.id)])).rows;
  assert.equal(children.length, 1); assert.equal(children[0].id, scope.childId);
  const space = spaces.find(value => value.id === children[0].workspace_id); assert.equal(space?.owner_user_id, owner.id);
  child = { id: scope.childId, workspaceId: space.id };
  const members = (await pool.query("SELECT workspace_id,user_id,role FROM family_members WHERE user_id=ANY($1::text[])", [ids])).rows;
  assert.deepEqual(members, [{ workspace_id: space.id, user_id: caregiver.id, role: "caregiver" }]);
  assert.deepEqual((await pool.query("SELECT id FROM care_tasks ORDER BY id")).rows.map(value => value.id), [...scope.taskIds].sort());
  const control = (await pool.query("SELECT enabled,generation FROM worker_control WHERE id=1")).rows[0];
  assert.equal(control?.enabled, false); assert.match(control.generation, uuid);
  assert.equal((await pool.query("SELECT version FROM pgboss.version")).rows[0].version, 42);
  assert.equal((await pool.query("SELECT 1 FROM app_migrations WHERE id='013-task-worker'")).rowCount, 1);
  await verifyEncryptedStorage(pool, cipher);
  step = "resume_existing_work_and_initial_effects";
  for (const user of [owner, caregiver]) assert.deepEqual(await business(() => families.preferences(user.id)), { ...noQuiet, version: 1 });
  resumedTasks = []; resumedWorks = [];
  for (const id of scope.taskIds) {
    const task = await business(() => tasks.get(owner.id, child.id, id)); assert.ok(task);
    assert.equal(task.childId, child.id); assert.equal(task.createdBy, owner.id); assert.equal(task.assigneeUserId, owner.id);
    assert.equal(task.kind, "ordinary"); assert.equal(task.version, 1); assert.equal(task.occurrence.state, "scheduled");
    assert.match(task.title, /^WORKER-ACCEPTANCE-[0-9a-f-]{36}$/); assert.equal(task.details, "合成 worker 驗收資料");
    const works = (await pool.query("SELECT * FROM task_work WHERE task_id=$1", [task.id])).rows;
    assert.equal(works.length, 1); const work = works[0];
    assert.equal(work.task_version, task.version); assert.equal(work.occurrence_id, task.occurrence.id);
    assert.equal(work.status, "pending"); assert.equal(work.failures, 0); assert.equal(work.job_failures_base, 0);
    assert.equal(work.storage_epoch, space.storage_epoch); assert.equal(work.worker_generation, control.generation);
    assert.ok(new Date(work.run_at).getTime() > Date.now() + 180000);
    const job = await jobFor(work.job_id); assert.equal(job?.state, "created");
    assert.deepEqual(jobDataSchema.parse(job.data), { workId: work.id, jobId: work.job_id });
    resumedTasks.push(task); resumedWorks.push(work); canaries.push(task.title);
  }
  const reminders = (await pool.query("SELECT id,batch_id,task_id,occurrence_id,task_version,phase FROM task_reminders ORDER BY task_id")).rows;
  assert.equal(reminders.length, 2); assert.equal(new Set(reminders.map(value => value.batch_id)).size, 1);
  for (const task of resumedTasks) {
    const reminder = reminders.find(value => value.task_id === task.id); assert.ok(reminder);
    assert.equal(reminder.occurrence_id, task.occurrence.id); assert.equal(reminder.task_version, task.version); assert.equal(reminder.phase, "initial");
  }
  const batch = (await pool.query("SELECT id,recipient_user_id,category,state FROM task_reminder_batches WHERE id=$1", [reminders[0].batch_id])).rows[0];
  assert.equal(batch?.recipient_user_id, owner.id); assert.equal(batch.category, "ordinary"); assert.equal(batch.state, "open");
  for (const row of (await pool.query("SELECT name,data FROM pgboss.job WHERE state NOT IN ('completed','cancelled','failed')")).rows) {
    assert.equal(row.name, TASK_QUEUE); const data = jobDataSchema.parse(row.data);
    assert.ok(resumedWorks.some(work => work.id === data.workId));
  }
  step = "resume_exact_credential_accounts";
  const credentials = (await pool.query('SELECT id,"userId","accountId" FROM account WHERE "userId"=ANY($1::text[]) AND "providerId"=\'credential\'', [ids])).rows;
  assert.equal(credentials.length, 2);
  for (const user of [owner, caregiver]) {
    const credential = credentials.filter(value => value.userId === user.id); assert.equal(credential.length, 1); assert.equal(credential[0].accountId, user.id);
  }
  step = "resume_verified_foreign_key_baseline";
  const roots = new Map([["user:id", new Set(ids)], ["workspaces:id", new Set(spaces.map(value => value.id))],
    ["children:id", new Set([child.id])], ["care_tasks:id", new Set(scope.taskIds)],
    ["task_occurrences:id", new Set(resumedTasks.map(value => value.occurrence.id))],
    ["task_work:id", new Set(resumedWorks.map(value => value.id))], ["task_reminder_batches:id", new Set([batch.id])]]);
  const foreignKeys = (await pool.query(`SELECT child.relname AS table_name,ca.attname AS column_name,
    parent.relname AS parent_table,pa.attname AS parent_column FROM pg_constraint fk
    JOIN pg_class child ON child.oid=fk.conrelid JOIN pg_namespace cn ON cn.oid=child.relnamespace
    JOIN pg_class parent ON parent.oid=fk.confrelid JOIN pg_namespace pn ON pn.oid=parent.relnamespace
    JOIN pg_attribute ca ON ca.attrelid=child.oid AND ca.attnum=fk.conkey[1]
    JOIN pg_attribute pa ON pa.attrelid=parent.oid AND pa.attnum=fk.confkey[1]
    WHERE fk.contype='f' AND cn.nspname='public' AND pn.nspname='public'
      AND cardinality(fk.conkey)=1 AND cardinality(fk.confkey)=1`)).rows;
  for (const [table, column, parent] of [["account", "userId", "user"], ["workspaces", "owner_user_id", "user"],
    ["notification_preferences", "user_id", "user"], ["children", "workspace_id", "workspaces"], ["care_tasks", "child_id", "children"],
    ["task_occurrences", "task_id", "care_tasks"], ["task_revisions", "task_id", "care_tasks"], ["task_work", "task_id", "care_tasks"],
    ["task_reminders", "task_id", "care_tasks"], ["task_reminder_batches", "recipient_user_id", "user"],
    ["family_members", "workspace_id", "workspaces"], ["family_invitations", "workspace_id", "workspaces"],
    ["online_operations", "user_id", "user"], ["online_changes", "workspace_id", "workspaces"], ["deleted_children", "workspace_id", "workspaces"]]) {
    assert.ok(foreignKeys.some(key => key.table_name === table && key.column_name === column && key.parent_table === parent && key.parent_column === "id"));
  }
  resumeExclusions = new Map();
  const exclude = (table, column, ids) => { const filters = resumeExclusions.get(table) ?? []; filters.push({ column, ids }); resumeExclusions.set(table, filters); };
  for (const [key, ids] of roots) { const [table, column] = key.split(":"); exclude(table, column, ids); }
  for (const key of foreignKeys) {
    const ids = roots.get(`${key.parent_table}:${key.parent_column}`);
    if (ids) exclude(key.table_name, key.column_name, ids);
  }
  resumeEvidence.initialEffects = { source: "existing_rows_revalidated_before_continuation", reminders: 2, sharedOrdinaryBatch: true,
    initialEffectsReexecuted: false, initialDualProcessFinalReview: "reserved_for_primary" };
  return credentials;
}
async function signInResumeAccounts(credentials) {
  step = "resume_synthetic_credential_refresh_and_sign_in";
  const { hashPassword } = await import("better-auth/crypto");
  await startServer();
  for (const user of [owner, caregiver]) {
    const credential = credentials.find(value => value.userId === user.id), password = randomBytes(24).toString("hex");
    const hash = await hashPassword(password);
    const updated = await business(() => pool.query(`UPDATE account SET password=$1,"updatedAt"=now()
      WHERE id=$2 AND "userId"=$3 AND "accountId"=$3 AND "providerId"='credential' RETURNING id`, [hash, credential.id, user.id]));
    assert.equal(updated.rowCount, 1);
    const response = await business(() => request(null, "/auth/sign-in/email", { email: user.email, password }));
    assert.equal(response.data.user.id, user.id);
    user.cookie = response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; "); assert.ok(user.cookie);
  }
}
async function loadRecoveryScope() {
  step = "resume_hard_kill_exact_scope_and_saved_baseline";
  const scope = resumeReport.syntheticScope;
  assert.deepEqual((await pool.query("SELECT id FROM care_tasks ORDER BY id")).rows.map(row => row.id), [...scope.taskIds].sort());
  const childRow = (await pool.query("SELECT c.id,c.workspace_id,s.owner_user_id FROM children c JOIN workspaces s ON s.id=c.workspace_id WHERE c.id=$1", [scope.childId])).rows[0];
  assert.equal(childRow?.owner_user_id, scope.ownerId);
  child = { id: scope.childId, workspaceId: childRow.workspace_id };
  owner = { id: scope.ownerId }; caregiver = { id: scope.caregiverId };
  assert.equal((await pool.query("SELECT enabled FROM worker_control WHERE id=1")).rows[0].enabled, false);
  const baselineName = resumeReport.resumedEvidence.continuationBaseline;
  assert.match(baselineName, /^worker_acceptance_[0-9a-f]{12}-resume-baseline\.json$/);
  const baselinePath = await realpath(join(directory, baselineName)); assert.equal(relative(directory, dirname(baselinePath)), "");
  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  assert.equal(baseline.initialReportSha256, "dab5aad8719c18a4acada69beda0639bf0506299d5f81f8f8791adf8194cf87b");
  assert.equal(baseline.excludedSyntheticScope.childId, child.id);
  const prior = new Map(Object.entries(baseline.rowHashes).map(([name, values]) => [name, new Map(Object.entries(values))]));
  preserve(prior, await snapshot(pool, [...prior.keys()]));
  for (const row of (await pool.query("SELECT payload_encrypted,id,version,child_id FROM care_tasks WHERE child_id=$1", [child.id])).rows) {
    const value = JSON.parse(cipher.decrypt(row.payload_encrypted, `care-task:${row.child_id}:${row.id}:${row.version}`));
    assert.match(value.title, /^WORKER-ACCEPTANCE-[0-9a-f-]{36}$/); canaries.push(value.title);
  }
  await verifyEncryptedStorage(pool, cipher);
  return prior;
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
  const workerPool = new URL(url).pathname === new URL(config.databaseUrl).pathname ? pool : restoredPool;
  await foreignSessions(workerPool);
  const targetJobId = target ? (await workerPool.query("SELECT job_id FROM task_work WHERE id=$1", [target])).rows[0]?.job_id : "";
  if (target) assert.match(targetJobId, uuid);
  if ([...workers].filter(value => !value.exit).length >= limits.workers) throw new Error("worker_acceptance_scope_cap");
  const fixture = spawn(process.execPath, [fileURLToPath(new URL("./task-worker-fixture.mjs", import.meta.url)), mode, "--worker-fixture"], {
    cwd: repository, windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"],
    env: { ...env, DATABASE_URL: taggedUrl(url).toString(), WORKER_ACCEPTANCE_RUN_ID: runId,
      WORKER_FIXTURE_TARGET_WORK_ID: target ?? "", WORKER_FIXTURE_TARGET_JOB_ID: targetJobId },
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
async function finishOrdinaryGroup(firstTask, second, firstWork, secondWork) {
  const page = (await business(() => request(owner, `/children/${child.id}/tasks`))).data;
  assert.equal(page.workerEnabled, true); assert.equal(page.items.length, 2);
  for (const expected of [firstTask, second]) {
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
  await closeServer(); assert.equal(server, undefined); await stopWorkers();
  const completedFirst = await change(firstTask, "complete"), completedSecond = await change(second, "complete");
  assert.equal(completedFirst.occurrence.state, "completed"); assert.equal(completedSecond.occurrence.state, "completed");
  const stopped = (await pool.query("SELECT status FROM task_work WHERE id=ANY($1::uuid[])", [[firstWork.id, secondWork.id]])).rows;
  assert.equal(stopped.length, 2); assert.ok(stopped.every(value => value.status === "stopped"));
  return completedFirst;
}

try {
  if (!process.argv.includes("--approved-task-worker")) throw new Error("worker_acceptance_approval_required");
  step = "preflight_local_target";
  const source = new URL(process.env.TEST_DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(source.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)
    || source.pathname !== "/yuban_s06_test" || source.search || source.hash || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(process.env.PG_TOOL_CONTAINER ?? "")) {
    throw new Error("worker_acceptance_local_container_required");
  }
  step = "preflight_protected_directory";
  directory = await protectedDirectory();
  step = "preflight_resume_report"; await loadResumeReport();
  step = "preflight_keys";
  const storageKey = await readSecretKey(process.env.STORAGE_KEY_FILE), backupKey = await readSecretKey(process.env.BACKUP_KEY_FILE);
  assert.equal(timingSafeEqual(storageKey, backupKey), false); cipher = createStorageCipher(storageKey);
  step = "preflight_configuration";
  env = serverEnv(source); config = readServerConfig(env); pool = createPool(config);
  step = "preflight_database_sessions";
  await foreignSessions();
  step = "preflight_database_state";
  guard = await pool.connect(); assert.equal((await guard.query("SELECT pg_try_advisory_lock(173061,13) AS acquired")).rows[0].acquired, true);
  if (!resumeReport) assert.equal((await pool.query("SELECT count(*)::int AS n FROM care_tasks")).rows[0].n, 0);
  if ((await pool.query("SELECT to_regclass('public.worker_control') AS present")).rows[0].present) {
    originalControlEnabled = (await pool.query("SELECT enabled FROM worker_control WHERE id=1")).rows[0]?.enabled;
    assert.equal(typeof originalControlEnabled, "boolean");
  }
  if (!resumeReport && (await pool.query("SELECT to_regclass('pgboss.job') AS present")).rows[0].present) {
    assert.equal((await pool.query("SELECT 1 FROM pgboss.job WHERE state NOT IN ('completed','cancelled','failed') LIMIT 1")).rowCount, 0);
  }
  let prior;
  const tools = url => ({ databaseUrl: new URL(url).toString(), container: process.env.PG_TOOL_CONTAINER });
  if (!resumeReport) {
  prior = await snapshot(pool);
  await check("prior_encrypted_backup", () => createEncryptedBackup(tools(source), join(directory, `${marker}-before.ybak`), backupKey));
  await check("migration_and_prior_business_rows", async () => {
    execFileSync(process.execPath, ["server/migrate.ts"], { cwd: repository, env, stdio: "ignore", timeout: 60000, windowsHide: true });
    await verifyEncryptedStorage(pool, cipher); await foreignSessions();
    assert.equal((await pool.query("SELECT 1 FROM app_migrations WHERE id='013-task-worker'")).rowCount, 1);
    assert.equal((await pool.query("SELECT version FROM pgboss.version")).rows[0].version, 42);
    assert.equal(JOB_OPTIONS.heartbeatSeconds, 60); assert.equal(JOB_OPTIONS.retryLimit, 2);
    preserve(prior, await snapshot(pool, [...prior.keys()]));
  });
  }
  const { activateTaskWorker } = await import("../server/worker-control.ts");
  producer = createWorkerQueue(pool, "producer"); await producer.start();
  bindTaskStores(); families = createFamilyStore(pool, cipher, true); records = createRecordStore(pool, cipher, true);
  if (recoveryResume) {
    prior = await loadRecoveryScope();
    controlTouched = true; await business(() => activateTaskWorker(pool, cipher, producer.queue));
  } else if (resumeReport) {
    await check("resume_scope_baseline_and_synthetic_sign_in", async () => {
      const credentials = await validateResumeScope();
      prior = await snapshot(pool, undefined, resumeExclusions);
      resumeEvidence.continuationBaseline = `${marker}-resume-baseline.json`;
      await writeFile(join(directory, resumeEvidence.continuationBaseline), JSON.stringify({ initialReport: resumeEvidence.initialReport,
        initialReportSha256: resumeEvidence.initialReportSha256, excludedSyntheticScope: resumeReport.syntheticScope,
        excludedSyntheticIdentityAndForeignKeyColumns: Object.fromEntries([...resumeExclusions].map(([table, filters]) => [table, filters.map(value => value.column)])),
        rowHashes: Object.fromEntries([...prior].map(([table, hashes]) => [table, Object.fromEntries(hashes)])) }) + "\n", { flag: "wx", mode: 0o600 });
      await signInResumeAccounts(credentials);
      controlTouched = true; await business(() => activateTaskWorker(pool, cipher, producer.queue));
    });
  } else {
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
  }
  let original;
  if (recoveryResume) {
    original = await business(() => tasks.get(owner.id, child.id, taskIds[0]));
    assert.equal(original?.occurrence.state, "completed");
  } else if (resumeReport) {
    await check("resumed_two_processes_duplicate_refs_and_http_metadata", async () => {
      [original] = resumedTasks; const second = resumedTasks[1];
      const first = await workFor(original), secondWork = await workFor(second);
      assert.ok(new Date(first.run_at).getTime() > Date.now() + 180000);
      assert.ok(new Date(secondWork.run_at).getTime() > Date.now() + 180000);
      const path = `/api/children/${child.id}/tasks`;
      const operations = (await pool.query(`SELECT op_id,device_id,workspace_id,storage_epoch FROM online_operations
        WHERE user_id=$1 AND child_id=$2 AND path=$3 AND status_code=201 AND result_encrypted IS NOT NULL`, [owner.id, child.id, path])).rows;
      assert.equal(operations.length, 1); const operation = operations[0];
      const receipt = await business(() => online.lookup(owner.id, operation.op_id));
      assert.equal(receipt.state, "confirmed"); assert.deepEqual(receipt.result.task, second);
      const payload = { confirm: true, values: Object.fromEntries(["title", "details", "kind", "assigneeUserId"].map(key => [key, second[key]])) };
      payload.values.dueAt = second.occurrence.dueAt; payload.values.timeZone = second.occurrence.timeZone;
      const submission = { path, payload, operation: { opId: operation.op_id, deviceId: operation.device_id,
        workspaceId: operation.workspace_id, storageEpoch: operation.storage_epoch } };
      const beforeJobs = (await pool.query("SELECT id,name,state FROM pgboss.job WHERE data->>'workId'=ANY($1::text[]) ORDER BY id", [[first.id, secondWork.id]])).rows;
      for (let attempt = 0; attempt < 2; attempt++) assert.deepEqual((await business(() => request(owner, "/online/submit", submission))).data, receipt);
      assert.deepEqual(await workFor(original), first); assert.deepEqual(await workFor(second), secondWork);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM care_tasks")).rows[0].n, 2);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM task_work")).rows[0].n, 2);
      assert.deepEqual((await pool.query("SELECT id,name,state FROM pgboss.job WHERE data->>'workId'=ANY($1::text[]) ORDER BY id", [[first.id, secondWork.id]])).rows, beforeJobs);
      const beforeReminders = (await pool.query("SELECT * FROM task_reminders ORDER BY id")).rows;
      const a = await startWorker(), b = await startWorker(); assert.notEqual(a.process.pid, b.process.pid);
      const duplicate = randomUUID(), client = await pool.connect();
      try { await client.query("BEGIN"); await producer.queue.enqueue(client, duplicate, first.id, dueNow()); await client.query("COMMIT"); }
      catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; } finally { client.release(); }
      await settled(duplicate);
      assert.ok([a, b].some(worker => worker.events.some(event => event.type === "claimed" && event.workId === first.id && event.jobId === duplicate)));
      assert.deepEqual((await pool.query("SELECT * FROM task_reminders ORDER BY id")).rows, beforeReminders);
      assert.deepEqual(await workFor(original), first); assert.deepEqual(await workFor(second), secondWork);
      resumeEvidence.continuedDuplicateProof = { competingProcesses: 2, duplicateJobsAdded: 1, duplicateClaimObserved: true,
        additionalReminderResults: 0, receiptReplayVerified: true };
      original = await finishOrdinaryGroup(original, second, first, secondWork);
    });
  } else {
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
    original = await finishOrdinaryGroup(original, second, first, secondWork);
  });
  }
  if (!recoveryResume) {
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
  }
  await check("hard_kill_recovery_production_heartbeat", async () => {
    const task = recoveryResume ? await business(() => tasks.get(owner.id, child.id, taskIds[9])) : await newTask();
    assert.equal(task?.occurrence.state, "scheduled");
    const work = await workFor(task); assert.equal(work.status, "pending"); assert.equal(work.failures, 0);
    const stalled = await startWorker("stall-before-process", work.id);
    await claimed(stalled, work); assert.equal((await jobFor(work.job_id)).state, "active");
    const started = Date.now(); await stopWorker(stalled, true);
    const replacement = await startWorker();
    const job = await waitFor(() => jobFor(work.job_id), value => value?.state === "completed", Math.max(1, 180000 - (Date.now() - started)), 2000);
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
    await waitFor(() => jobFor(work.job_id, restoredPool), value => value?.state === "completed", 180000, 2000);
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
    preserve(prior, await snapshot(pool, [...prior.keys()], resumeExclusions));
  });
  if (backgroundFailure) throw backgroundFailure;
  outcome = { status: resumeReport ? "resumed_passed" : "passed", checks: passed, counts, limits, originalDatabaseRetained: true,
    ...(resumeReport ? { continuationNonSyntheticRowsPreserved: true } : { priorBusinessRowsPreserved: true }),
    syntheticChildDeleted: true, restoredDatabase, restoredWorkerPaused: true, schemaVersion: 42, heartbeatSeconds: 60,
    monitorSeconds: 60, recoveryMilliseconds, httpServerClosedDuringLaterWorkerEffects: true, models: 0, notifications: 0, browser: false, deployed: false };
} catch (error) {
  outcome = { status: "failed", step, checks: passed, counts, limits, error: error instanceof assert.AssertionError ? "assertion_failed" : error?.name ?? "Error",
    originalDatabaseRetained: true, syntheticChildRetained: Boolean((child || resumeReport?.syntheticScope.childId) && !childDeleted),
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
  outcome = { ...outcome, executionMode: resumeReport ? "resumed" : "fresh", ...(resumeEvidence ? { resumedEvidence: resumeEvidence } : {}),
    syntheticScope: { ownerId: owner?.id ?? resumeReport?.syntheticScope.ownerId ?? null,
      caregiverId: caregiver?.id ?? resumeReport?.syntheticScope.caregiverId ?? null, childId: child?.id ?? resumeReport?.syntheticScope.childId ?? null, taskIds } };
  if (directory) await writeFile(join(directory, `${marker}-checks.json`), JSON.stringify(outcome, null, 2) + "\n", { flag: "wx", mode: 0o600 }).catch(() => {
    outcome = { ...outcome, status: "failed", evidenceWriteFailed: true }; process.exitCode = 1;
  });
  console.log(JSON.stringify(outcome));
}
