import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createAuth } from "../server/auth.ts";
import { createChatStore } from "../server/chat.ts";
import { readServerConfig } from "../server/config.ts";
import { createPool } from "../server/database.ts";
import { createRecordStore } from "../server/records.ts";
import { createMemoryStore } from "../server/memory.ts";
import { createTaskStore, taskSelection, decodeTask } from "../server/tasks.ts";
import { createConcernStore } from "../server/concern-store.ts";
import { createConcernWorker } from "../server/concern-worker.ts";
import { createProductAgentStore } from "../server/product-agent-store.ts";
import { createAgentWorkContinuationStore, WORK_CONTINUATION_QUEUE, WORK_CONTINUATION_OPTIONS } from "../server/agent-work-continuation.ts";
import { createAgentWorkContinuationWorker } from "../server/agent-work-continuation-worker.ts";
import { createWorkerQueue, databaseAdapter } from "../server/worker-queue.ts";
import { createStorageCipher, readSecretKey } from "../server/storage-crypto.ts";
import { canonicalJson } from "../server/online-routing.ts";
import { saveAgentWorkSchema } from "../src/shared/agent-work.ts";

// Primary applies reviewed 029/033 and takes an encrypted database checkpoint before this explicitly approved entry.
// No daemon/timekeeper is started. Worker control is briefly enabled for bounded direct calls,
// then restored paused even on failure. Unexpected failure stops the batch and preserves fixtures.
const limits = { accounts: 2, children: 1, businessCalls: 55, realModelCalls: 0, networkAttempts: 0 };
const counts = { accounts: 0, children: 0, businessCalls: 0, stubRuns: 0, realModelCalls: 0, networkAttempts: 0 };
const fixtures = { users: [], emails: [], childId: null, workspaceId: null, concernId: null, concernFollowUpId: null, jobs: [] };
let pool, cipher, queue, worker, config, originalControl, baseline, resumeReport = null, resumePrepared = null, resumePhase2 = false, completed = false, step = "preflight";
const passed = [];
const call = async fn => { assert.ok(counts.businessCalls < limits.businessCalls, "Business call budget exhausted"); counts.businessCalls++; return fn(); };
const check = async (name, fn) => { step = name; await fn(); if (!passed.includes(name)) passed.push(name); };
const totals = async (excludeChild = null) => (await pool.query(`SELECT
  (SELECT count(*)::int FROM children WHERE $1::uuid IS NULL OR id<>$1) AS children,
  (SELECT count(*)::int FROM agent_work WHERE $1::uuid IS NULL OR child_id<>$1) AS works,
  (SELECT count(*)::int FROM agent_work_continuations WHERE $1::uuid IS NULL OR child_id<>$1) AS events,
  (SELECT count(*)::int FROM agent_runs WHERE $1::uuid IS NULL OR child_id<>$1) AS runs,
  (SELECT count(*)::int FROM task_reminders r JOIN care_tasks t ON t.id=r.task_id WHERE $1::uuid IS NULL OR t.child_id<>$1) AS reminders,
  (SELECT count(*)::int FROM concerns WHERE $1::uuid IS NULL OR child_id<>$1) AS concerns,
  (SELECT count(*)::int FROM concern_events e JOIN concerns c ON c.id=e.concern_id WHERE $1::uuid IS NULL OR c.child_id<>$1) AS concern_events,
  (SELECT count(*)::int FROM concern_followups WHERE $1::uuid IS NULL OR child_id<>$1) AS concern_followups`, [excludeChild])).rows[0];
const resumeTarget = {
  users: ["vngoiHs3kolmZWgzZQyxVPkT2AnPAE52", "gVUHCKr5tY4vJbfQeTott90m2k6wXE3x"],
  emails: ["p2-a06-5700eff7-2b3c-4090-b081-96a802b34c48@example.test", "p2-a06-bfb41426-1d05-485d-b756-f9a0b9c33025@example.test"],
  childId: "2ed7fff0-ff27-4e0b-91f2-c693e2941a93", workspaceId: "8b5c7b42-0281-47e6-9640-c9b5d98b6b42",
  concernId: null, concernFollowUpId: null, jobs: [],
};
const readStoppedReport = async (path, code, businessCalls) => {
  const bytes = await readFile(path);
  const text = bytes[0] === 255 && bytes[1] === 254 ? bytes.subarray(2).toString("utf16le") : bytes.toString("utf8").replace(/^\uFEFF/u, "");
  const reports = text.split(/\r?\n/u).filter(line => line.trim().startsWith("{"));
  assert.equal(reports.length, 1, "Only an exact preserved stopped batch report is resumable");
  const report = JSON.parse(reports[0]);
  assert.equal(report.status, "failed"); assert.equal(report.code, code);
  assert.equal(report.step, "persisted_private_watchers_and_terminal_task");
  assert.deepEqual(report.passed, ["reviewed_additive_migration_and_paused_control", "two_synthetic_accounts_and_one_child"]);
  assert.deepEqual(report.counts, { accounts: 2, children: 1, businessCalls, stubRuns: 0, realModelCalls: 0, networkAttempts: 0 });
  assert.deepEqual(report.limits, limits); assert.deepEqual(report.fixtures, resumeTarget);
  return report;
};
try {
  const args = process.argv.slice(2);
  if (args[0] === "--resume-phase2-approved-local-p2-a06") {
    assert.deepEqual(args, ["--resume-phase2-approved-local-p2-a06", "--worker-processes-stopped", "artifacts/verification/P2_A06_SQL_RESUME.log"]);
    const original = await readStoppedReport("artifacts/verification/P2_A06_SQL.log", "42883", 9);
    resumeReport = await readStoppedReport(args[2], "ERR_ASSERTION", 24);
    assert.deepEqual(resumeReport.fixtures, original.fixtures);
    assert.ok(resumeReport.frames[0].endsWith("/scripts/p2-a06-acceptance.mjs:172:12"));
    assert.ok(resumeReport.counts.businessCalls + 30 <= limits.businessCalls, "Remaining original groups must fit the combined budget");
    resumePhase2 = true;
  } else if (args[0] === "--resume-approved-local-p2-a06") {
    assert.deepEqual(args, ["--resume-approved-local-p2-a06", "--worker-processes-stopped", "artifacts/verification/P2_A06_SQL.log"]);
    resumeReport = await readStoppedReport(args[2], "42883", 9);
  } else assert.deepEqual(args, ["--approved-local-p2-a06", "--worker-processes-stopped"], "Explicit approved entry and stopped worker processes required");
  if (resumeReport) {
    Object.assign(counts, resumeReport.counts); Object.assign(fixtures, structuredClone(resumeTarget)); passed.push(...resumeReport.passed);
  }
  const url = new URL(process.env.TEST_DATABASE_URL);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname === "127.0.0.1" && url.port === "5434"
    && url.pathname === "/yuban_s06_test" && !url.search && !url.hash, "Assigned local database required");
  cipher = createStorageCipher(await readSecretKey(process.env.STORAGE_KEY_FILE));
  config = readServerConfig({ ...process.env, DATABASE_URL: url.toString(), NODE_ENV: "test", AI_ENABLED: "false", P2_AGENT_ENABLED: "false",
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), SERVER_ORIGIN: "http://127.0.0.1:3099", WEB_ORIGIN: "http://127.0.0.1:3099", PORT: "3099" });
  globalThis.fetch = async () => { counts.networkAttempts++; throw new Error("Network is outside this acceptance"); };
  pool = createPool(config);
  await check("reviewed_additive_migration_and_paused_control", async () => {
    for (const id of ["029-concern-terminal-reserve", "033-agent-work-continuation"]) {
      const sql = (await readFile(new URL(`../server/migrations/${id}.sql`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
      const receipt = (await pool.query("SELECT checksum FROM app_migrations WHERE id=$1", [id])).rows[0];
      assert.ok([sql, sql.replace(/\n/g, "\r\n")].map(value => createHash("sha256").update(value).digest("hex")).includes(receipt?.checksum));
    }
    originalControl = (await pool.query("SELECT enabled,generation FROM worker_control WHERE id=1")).rows[0];
    assert.equal(originalControl.enabled, false);
    if (resumeReport) assert.equal(originalControl.generation, "0fc82841-ae94-4d10-ab9f-c5a53df5cbd8");
    baseline = await totals(resumeReport ? fixtures.childId : null);
    queue = createWorkerQueue(pool, "producer"); await queue.start();
    assert.ok(await queue.boss.getQueue(WORK_CONTINUATION_QUEUE));
  });
  const records = createRecordStore(pool, cipher, true), chat = createChatStore(pool, cipher, true, true), memory = createMemoryStore(pool, cipher, true),
    tasks = createTaskStore(pool, cipher), agent = createProductAgentStore(pool, cipher), continuation = createAgentWorkContinuationStore(pool, cipher);
  await check("two_synthetic_accounts_and_one_child", async () => {
    if (resumeReport) {
      const accounts = (await pool.query('SELECT id,email FROM "user" WHERE id=ANY($1::text[])', [fixtures.users])).rows;
      assert.equal(accounts.length, 2);
      for (let i = 0; i < 2; i++) assert.equal(accounts.find(value => value.id === fixtures.users[i])?.email, fixtures.emails[i]);
      const children = (await pool.query(`SELECT c.id,c.workspace_id,w.owner_user_id,w.access_version::text,w.storage_epoch,w.change_seq::text
        FROM children c JOIN workspaces w ON w.id=c.workspace_id WHERE w.owner_user_id=$1`, [fixtures.users[0]])).rows;
      assert.equal(children.length, 1); const space = children[0];
      assert.equal(space.id, fixtures.childId); assert.equal(space.workspace_id, fixtures.workspaceId); assert.equal(space.access_version, "1");
      assert.equal((await pool.query("SELECT role FROM family_members WHERE workspace_id=$1 AND user_id=$2", [fixtures.workspaceId, fixtures.users[1]])).rows[0]?.role, "caregiver");
      const empty = (await pool.query(`SELECT (SELECT count(*)::int FROM agent_work WHERE child_id=$1) AS works,
        (SELECT count(*)::int FROM agent_work_followups WHERE child_id=$1) AS checks,
        (SELECT count(*)::int FROM agent_work_operations WHERE child_id=$1) AS operations,
        (SELECT count(*)::int FROM agent_work_continuations WHERE child_id=$1) AS continuations,
        (SELECT count(*)::int FROM concerns WHERE child_id=$1) AS concerns,
        (SELECT count(*)::int FROM concern_followups WHERE child_id=$1) AS concern_followups,
        (SELECT count(*)::int FROM task_work tw JOIN care_tasks t ON t.id=tw.task_id WHERE t.child_id=$1) AS task_jobs,
        (SELECT count(*)::int FROM pgboss.job WHERE data->>'childId'=$1::text
          OR data->>'taskId' IN (SELECT id::text FROM care_tasks WHERE child_id=$1)
          OR data->>'eventId' IN (SELECT id::text FROM agent_work_continuations WHERE child_id=$1)
          OR data->>'followUpId' IN (SELECT id::text FROM concern_followups WHERE child_id=$1)) AS queued_jobs`, [fixtures.childId])).rows[0];
      const expectedWorks = resumePhase2 ? 8 : 0;
      assert.deepEqual(empty, { works: expectedWorks, checks: expectedWorks, operations: expectedWorks, continuations: 0, concerns: 0, concern_followups: 0, task_jobs: 0, queued_jobs: 0 });
      const facts = (await pool.query("SELECT * FROM memory_facts WHERE child_id=$1", [fixtures.childId])).rows;
      assert.equal(facts.length, 1); const row = facts[0];
      assert.equal(row.created_by, fixtures.users[0]); assert.equal(row.visibility, "private"); assert.equal(row.status, "confirmed"); assert.equal(row.version, resumePhase2 ? 3 : 2);
      const fact = JSON.parse(cipher.decrypt(row.payload_encrypted, `memory-fact:${fixtures.childId}:${row.id}:${row.version}`));
      assert.equal(fact.id, row.id); assert.equal(fact.childId, fixtures.childId); assert.equal(fact.version, row.version);
      assert.equal(fact.key, "p2-a06-fact"); assert.equal(fact.content, resumePhase2 ? "Synthetic corrected fact" : "Synthetic old fact");
      assert.equal(fact.source.kind, "manual"); assert.equal(fact.source.description, resumePhase2 ? "Synthetic correction" : "Synthetic seed");
      const tasks = (await pool.query(`${taskSelection} WHERE t.child_id=$1`, [fixtures.childId])).rows;
      assert.equal(tasks.length, 1); const task = decodeTask(tasks[0], cipher);
      assert.equal(task.createdBy, fixtures.users[0]); assert.equal(task.assigneeUserId, fixtures.users[0]); assert.equal(task.version, resumePhase2 ? 2 : 1);
      assert.equal(task.childId, fixtures.childId); assert.equal(task.title, "Synthetic terminal task"); assert.equal(task.details, "No delivery");
      assert.equal(task.kind, "ordinary"); assert.equal(task.occurrence.state, resumePhase2 ? "completed" : "scheduled");
      if (resumePhase2) {
        const runs = (await pool.query("SELECT *,authorization_version::text FROM agent_runs WHERE child_id=$1", [fixtures.childId])).rows;
        const messages = (await pool.query("SELECT id,role,owner_user_id FROM chat_messages WHERE child_id=$1", [fixtures.childId])).rows;
        assert.equal(runs.length, 3); assert.equal(messages.length, 3);
        assert.equal(runs.filter(value => value.owner_user_id === fixtures.users[0]).length, 2);
        assert.equal(runs.filter(value => value.owner_user_id === fixtures.users[1]).length, 1);
        for (const run of runs) {
          assert.equal(run.trigger_kind, "interactive"); assert.equal(run.recipe_id, "product-interactive");
          assert.equal(run.source_message_id, run.trigger_reference); assert.equal(run.authorization_version, space.access_version);
          assert.equal(run.data_version.split(":")[0], space.storage_epoch); assert.equal(run.result_encrypted, null);
          assert.ok(["running", "unknown"].includes(run.state));
          const source = messages.find(value => value.id === run.source_message_id);
          assert.equal(source?.role, "user"); assert.equal(source?.owner_user_id, run.owner_user_id);
        }
        const workRows = (await pool.query("SELECT * FROM agent_work WHERE child_id=$1", [fixtures.childId])).rows;
        const operationRows = (await pool.query("SELECT * FROM agent_work_operations WHERE child_id=$1", [fixtures.childId])).rows;
        const followups = (await pool.query("SELECT *,authorization_version::text FROM agent_work_followups WHERE child_id=$1", [fixtures.childId])).rows;
        assert.equal(workRows.length, 8); assert.equal(operationRows.length, 8); assert.equal(followups.length, 8);
        const names = ["terminal-work", ...Array.from({ length: 6 }, (_, i) => `work-${i}`), "other-work"];
        assert.deepEqual(operationRows.map(value => value.call_id).sort(), [...names].sort());
        const saved = new Map();
        for (const operation of operationRows) {
          const owner = operation.call_id === "other-work" ? fixtures.users[1] : fixtures.users[0];
          const work = workRows.find(value => value.id === operation.work_id), run = runs.find(value => value.id === operation.run_id);
          assert.ok(work && run); assert.equal(operation.owner_user_id, owner); assert.equal(work.owner_user_id, owner); assert.equal(run.owner_user_id, owner);
          assert.equal(work.version, 1); assert.equal(work.status, "waiting");
          const values = JSON.parse(cipher.decrypt(work.payload_encrypted, `agent-work:${fixtures.childId}:${owner}:${work.id}:1`));
          const input = saveAgentWorkSchema.parse({ operationId: operation.operation_id, workId: null, expectedVersion: 0, values });
          const receipt = JSON.parse(cipher.decrypt(operation.payload_encrypted, `agent-work-operation:${fixtures.childId}:${owner}:${operation.operation_id}`));
          assert.equal(receipt.hash, createHash("sha256").update(canonicalJson(input)).digest("hex"));
          const result = { ...values, id: work.id, childId: fixtures.childId, version: 1,
            createdAt: work.created_at.toISOString(), updatedAt: work.updated_at.toISOString() };
          assert.deepEqual(receipt.result, result); assert.equal(values.focus, "Synthetic focus"); assert.equal(values.status, "waiting");
          assert.deepEqual(values.questions, []); assert.deepEqual(values.pending, []); assert.deepEqual(values.sourceMessageIds, [run.source_message_id]);
          const terminal = operation.call_id === "terminal-work", other = operation.call_id === "other-work";
          assert.equal(values.goal, terminal ? "Synthetic terminal work" : other ? "Synthetic other owner private work" : `Synthetic private work ${operation.call_id.slice(5)}`);
          assert.deepEqual(values.resources, terminal ? [{ kind: "task", id: task.id, version: 1 }] : other ? [] : [{ kind: "memory_fact", id: fact.id, version: 2 }]);
          assert.equal(values.followUp.reason, terminal ? "Synthetic due check" : other ? "Synthetic station-only due" : "Synthetic watched resource");
          assert.equal(values.followUp.watchResources, true); assert.deepEqual(values.followUp.knowledgeSourceIds, []);
          if (!terminal && !other) assert.equal(values.followUp.dueAt, null);
          const followup = followups.find(value => value.work_id === work.id);
          assert.ok(followup); assert.equal(followup.owner_user_id, owner); assert.equal(followup.workspace_id, fixtures.workspaceId);
          assert.equal(followup.work_version, 1); assert.equal(followup.authorization_version, space.access_version); assert.equal(followup.storage_epoch, space.storage_epoch);
          assert.equal(followup.enabled, true); assert.equal(followup.watch_resources, true); assert.equal(followup.due_consumed, false);
          assert.deepEqual(followup.knowledge_source_ids, []); assert.equal(followup.due_at?.toISOString() ?? null, values.followUp.dueAt);
          const basis = JSON.parse(cipher.decrypt(followup.baseline_encrypted, `agent-work-followup:${fixtures.childId}:${owner}:${work.id}:1`));
          assert.deepEqual(basis.resources.map(({ kind, id, version }) => ({ kind, id, version })), values.resources);
          assert.deepEqual(basis.knowledge, []);
          const claim = { runId: run.id, sourceMessageId: run.source_message_id, scope: { userId: owner, childId: fixtures.childId, workspaceId: fixtures.workspaceId,
            authorizationVersion: run.authorization_version, dataVersion: run.data_version } };
          saved.set(operation.call_id, { work: result, input, claim, followup });
        }
        const terminal = saved.get("terminal-work"), other = saved.get("other-work"), watched = Array.from({ length: 6 }, (_, i) => saved.get(`work-${i}`));
        assert.ok(watched.every(value => value.claim.runId === terminal.claim.runId));
        assert.equal(other.followup.due_at.toISOString(), "2026-10-08T00:23:06.114Z");
        assert.equal(other.followup.next_check_at.toISOString(), other.followup.due_at.toISOString());
        resumePrepared = { fact, task, terminalWork: terminal.work, ownerClaim: terminal.claim, otherClaim: other.claim,
          otherWork: other.work, otherInput: other.input, otherNext: other.followup.next_check_at,
          works: watched.map(value => value.work), workInputs: watched.map(value => value.input) };
        return;
      }
      const runs = (await pool.query(`SELECT *,authorization_version::text FROM agent_runs WHERE child_id=$1 AND owner_user_id=$2`, [fixtures.childId, fixtures.users[0]])).rows;
      assert.equal(runs.length, 1); const run = runs[0];
      assert.equal(run.trigger_kind, "interactive"); assert.equal(run.recipe_id, "product-interactive"); assert.equal(run.source_message_id, run.trigger_reference);
      assert.equal(run.authorization_version, space.access_version); assert.equal(run.data_version, space.storage_epoch + ":" + space.change_seq);
      const messages = (await pool.query("SELECT id,role,owner_user_id FROM chat_messages WHERE child_id=$1", [fixtures.childId])).rows;
      assert.equal(messages.length, 1); assert.equal(messages[0].id, run.source_message_id); assert.equal(messages[0].role, "user"); assert.equal(messages[0].owner_user_id, fixtures.users[0]);
      assert.ok(run.state === "running" || run.state === "unknown"); assert.equal(run.result_encrypted, null);
      resumePrepared = { fact, task, run, scope: { userId: fixtures.users[0], childId: fixtures.childId, workspaceId: fixtures.workspaceId,
        authorizationVersion: run.authorization_version, dataVersion: run.data_version } };
      return;
    }
    const auth = createAuth(config, pool);
    for (let i = 0; i < 2; i++) {
      const email = `p2-a06-${randomUUID()}@example.test`;
      const account = await call(() => auth.api.signUpEmail({ body: { name: `Synthetic P2-A06 ${i}`, email, password: randomBytes(24).toString("hex") }, headers: new Headers({ origin: config.publicOrigin }) }));
      fixtures.users.push(account.user.id); fixtures.emails.push(email); counts.accounts++;
    }
    const child = await call(() => records.createChildForUser(fixtures.users[0], { displayName: "P2-A06 合成孩子" }));
    fixtures.childId = child.id; fixtures.workspaceId = child.workspaceId; counts.children++;
    await pool.query("INSERT INTO family_members(workspace_id,user_id,role) VALUES($1,$2,'caregiver')", [child.workspaceId, fixtures.users[1]]);
  });
  const [owner, other] = fixtures.users, childId = fixtures.childId, generation = originalControl.generation;
  const message = async user => call(() => chat.createUserMessageForUser(user, childId, "Synthetic work continuation acceptance"));
  const claimFor = async user => { const saved = await message(user); return call(() => agent.claim(user, childId, { kind: "interactive", reference: saved.id }, "product-interactive")); };
  const input = (claim, title, resources = [], followUp = { reason: "Synthetic watched resource", dueAt: null, watchResources: true, knowledgeSourceIds: [] }) => ({
    operationId: randomUUID(), workId: null, expectedVersion: 0, values: { goal: title, focus: "Synthetic focus", questions: [], sourceMessageIds: [claim.sourceMessageId], resources, pending: [], status: "waiting", followUp } });
  const enqueue = async (client, job) => {
    assert.equal(await queue.boss.send(WORK_CONTINUATION_QUEUE, job, { ...WORK_CONTINUATION_OPTIONS, id: job.jobId, db: databaseAdapter(client) }), job.jobId);
    fixtures.jobs.push(job.jobId);
  };
  let ownerClaim, otherClaim, fact, task, terminalWork, otherWork, otherInput, initialOtherNext, workInputs = [], works = [], queued, payload, originalFollowUp;
  await check("persisted_private_watchers_and_terminal_task", async () => {
    if (resumePhase2) {
      ({ fact, task, terminalWork, ownerClaim, otherClaim, otherWork, otherInput, works, workInputs } = resumePrepared);
      initialOtherNext = resumePrepared.otherNext;
      await pool.query("UPDATE worker_control SET enabled=true WHERE id=1 AND generation=$1", [generation]);
      return;
    }
    if (resumePrepared) {
      fact = resumePrepared.fact; task = resumePrepared.task;
      const { run, scope } = resumePrepared;
      // A timed-out original claim is never extended or rewritten; no work operation was committed.
      ownerClaim = run.state === "running" && run.expires_at.getTime() > Date.now()
        ? { runId: run.id, sourceMessageId: run.source_message_id, scope } : await claimFor(owner);
    } else {
      const candidate = await call(() => memory.createFact(owner, childId, { intendedVisibility: "private", values: { key: "p2-a06-fact", content: "Synthetic old fact", source: { kind: "manual", description: "Synthetic seed" }, validUntil: null } }));
      fact = await call(() => memory.confirmFact(owner, childId, candidate.id, { expectedVersion: candidate.version, confirm: true, confirmShared: false }));
      task = await call(() => tasks.create(owner, childId, { values: { title: "Synthetic terminal task", details: "No delivery", kind: "ordinary", assigneeUserId: owner,
        dueAt: new Date(Date.now() + 86400000).toISOString(), timeZone: "Asia/Hong_Kong" }, confirm: true }));
      ownerClaim = await claimFor(owner);
    }
    terminalWork = await call(() => agent.saveWork(ownerClaim.scope, ownerClaim.runId, "terminal-work", input(ownerClaim, "Synthetic terminal work",
      [{ kind: "task", id: task.id, version: task.version }], { reason: "Synthetic due check", dueAt: new Date(Date.now() - 1000).toISOString(), watchResources: true, knowledgeSourceIds: [] })));
    for (let i = 0; i < 6; i++) {
      const raw = input(ownerClaim, `Synthetic private work ${i}`, [{ kind: "memory_fact", id: fact.id, version: fact.version }]);
      workInputs.push(raw); works.push(await call(() => agent.saveWork(ownerClaim.scope, ownerClaim.runId, `work-${i}`, raw)));
    }
    otherClaim = await claimFor(other);
    otherInput = input(otherClaim, "Synthetic other owner private work", [], { reason: "Synthetic station-only due", dueAt: new Date(Date.now() + 3600000).toISOString(), watchResources: true, knowledgeSourceIds: [] });
    otherWork = await call(() => agent.saveWork(otherClaim.scope, otherClaim.runId, "other-work", otherInput));

    assert.deepEqual((await call(() => agent.readWork(other, childId, { workId: works[0].id, cursor: null }))).items, []);
    await call(() => tasks.change(owner, childId, task.id, { action: "complete", expectedVersion: task.version, note: "Synthetic completion", confirm: true }));
    // Reset an unrelated wake caused by the shared task change before testing the private event boundary.
    initialOtherNext = (await pool.query("UPDATE agent_work_followups SET next_check_at=due_at WHERE work_id=$1 RETURNING next_check_at", [otherWork.id])).rows[0].next_check_at;
    fact = await call(() => memory.reviseFact(owner, childId, fact.id, { expectedVersion: fact.version, confirm: true, confirmShared: false, reason: "Synthetic correction",
      values: { key: "p2-a06-fact", content: "Synthetic corrected fact", source: { kind: "manual", description: "Synthetic correction" }, validUntil: null } }));
    assert.equal((await pool.query("SELECT next_check_at FROM agent_work_followups WHERE work_id=$1", [otherWork.id])).rows[0].next_check_at.toISOString(), initialOtherNext.toISOString());
    await pool.query("UPDATE worker_control SET enabled=true WHERE id=1 AND generation=$1", [generation]);
  });
  await check("029_archive_full_encrypted_history_cancels_and_replays_original_operation", async () => {
    const id = randomUUID(), followUpId = randomUUID(), jobId = randomUUID(), at = new Date().toISOString(), version = 10;
    fixtures.concernId = id; fixtures.concernFollowUpId = followUpId;
    const authority = (await pool.query("SELECT storage_epoch,access_version::text FROM workspaces WHERE id=$1", [fixtures.workspaceId])).rows[0];
    const stored = { id, childId, title: "Synthetic full concern", reason: "Synthetic capacity evidence", status: "following", version,
      createdAt: at, updatedAt: at, archivedAt: null, attentionIds: [] };
    const events = Array.from({ length: 200 }, (_, index) => {
      const event = { id: randomUUID(), at, kind: "observation", title: "Synthetic observation", text: `Synthetic original event ${index}`,
        sourceLabel: "Synthetic", actorUserId: owner };
      return { id: event.id, sequence: index + 1, actor_user_id: owner,
        payload_encrypted: cipher.encrypt(JSON.stringify(event), `concern:${childId}:${id}:${owner}:event:${event.id}:${owner}`) };
    });
    const client = await pool.connect();
    try {
      await client.query("BEGIN"); await client.query("SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='5s'");
      await client.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [fixtures.workspaceId]);
      assert.ok((await client.query("SELECT 1 FROM children WHERE id=$1 AND workspace_id=$2", [childId, fixtures.workspaceId])).rowCount);
      await client.query(`INSERT INTO concerns(id,child_id,created_by,version,status,payload_encrypted,follow_up_id,created_at,updated_at)
        VALUES($1,$2,$3,$4,'following',$5,$6,$7,$7)`, [id, childId, owner, version,
        cipher.encrypt(JSON.stringify(stored), `concern:${childId}:${id}:${owner}:${version}`), followUpId, at]);
      await client.query(`INSERT INTO concern_followups(id,concern_id,child_id,actor_user_id,concern_version,due_at,state,storage_epoch,authorization_version,worker_generation,job_id)
        VALUES($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,$10)`, [followUpId, id, childId, owner, version, at,
        authority.storage_epoch, authority.access_version, generation, jobId]);
      await client.query(`INSERT INTO concern_events(id,concern_id,sequence,actor_user_id,payload_encrypted)
        SELECT e.id,$2,e.sequence,e.actor_user_id,e.payload_encrypted FROM jsonb_to_recordset($1::jsonb)
        AS e(id uuid,sequence integer,actor_user_id text,payload_encrypted text)`, [JSON.stringify(events), id]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    const concerns = createConcernStore(pool, cipher), opId = randomUUID(), change = { action: "archive", expectedVersion: version,
      authorityVersion: authority.storage_epoch + ":" + authority.access_version, confirm: true };
    const ended = await call(() => concerns.change(owner, childId, id, change, opId));
    assert.equal(ended.status, "closed"); assert.equal(ended.events.length, 202); assert.equal(ended.followUp.state, "cancelled");
    assert.deepEqual(await call(() => concerns.change(owner, childId, id, change, opId)), ended);
    const preserved = (await pool.query("SELECT id,sequence,actor_user_id,payload_encrypted FROM concern_events WHERE concern_id=$1 ORDER BY sequence", [id])).rows;
    assert.equal(preserved.length, 202); assert.deepEqual(preserved.slice(0, 200), events);
    assert.equal((await pool.query("SELECT state FROM concern_followups WHERE id=$1", [followUpId])).rows[0].state, "cancelled");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM concern_revisions WHERE concern_id=$1", [id])).rows[0].n, 1);
    let oldJobAgentCalls = 0;
    const oldWorker = createConcernWorker(pool, queue.boss, concerns, { async background() { oldJobAgentCalls++; throw new Error("Cancelled concern must not run"); } });
    await call(() => oldWorker.process({ childId, id, followUpId, version, jobId, workerGeneration: generation, storageEpoch: authority.storage_epoch }, jobId));
    await oldWorker.stop(); assert.equal(oldJobAgentCalls, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM agent_runs WHERE trigger_kind='worker' AND trigger_reference=$1", [followUpId])).rows[0].n, 0);
  });
  await check("atomic_rollback_then_one_daily_event_with_five_works", async () => {
    await assert.rejects(call(() => continuation.checkDue(generation, async (client, job) => { await enqueue(client, job); throw new Error("synthetic_rollback"); })), /synthetic_rollback/);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM agent_work_continuations WHERE child_id=$1", [childId])).rows[0].n, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM pgboss.job WHERE id=ANY($1::uuid[])", [fixtures.jobs])).rows[0].n, 0);
    await call(() => continuation.checkDue(generation, enqueue));
    const events = (await pool.query("SELECT * FROM agent_work_continuations WHERE owner_user_id=$1 AND child_id=$2", [owner, childId])).rows;
    assert.equal(events.length, 1); const event = events[0];
    queued = { eventId: event.id, jobId: event.job_id, workerGeneration: event.worker_generation, storageEpoch: event.storage_epoch };
    payload = JSON.parse(cipher.decrypt(event.payload_encrypted, `agent-work-continuation:${childId}:${owner}:${event.id}`));
    assert.equal(payload.works.length, 5); assert.ok(payload.works.every(value => value.changes.resources.length === 1));
    const pending = (await pool.query("SELECT * FROM agent_work_followups WHERE work_id=ANY($1::uuid[])", [works.map(value => value.id)])).rows;
    const deferred = pending.find(value => !payload.works.some(item => item.workId === value.work_id));
    assert.ok(deferred.next_check_at > new Date());
    const old = JSON.parse(cipher.decrypt(deferred.baseline_encrypted, `agent-work-followup:${childId}:${owner}:${deferred.work_id}:1`));
    assert.equal(old.resources[0].version, fact.version - 1);
    assert.equal((await pool.query("SELECT enabled FROM agent_work_followups WHERE work_id=$1", [terminalWork.id])).rows[0].enabled, false);
    const job = (await pool.query("SELECT data FROM pgboss.job WHERE id=$1 AND name=$2", [queued.jobId, WORK_CONTINUATION_QUEUE])).rows[0];
    assert.deepEqual(Object.keys(job.data).sort(), ["eventId", "jobId", "storageEpoch", "workerGeneration"]);
    originalFollowUp = (await pool.query("SELECT * FROM agent_work_followups WHERE work_id=$1", [works[0].id])).rows[0];
    assert.deepEqual(await call(() => agent.saveWork(ownerClaim.scope, ownerClaim.runId, "work-0", workInputs[0])), works[0]);
    assert.deepEqual((await pool.query("SELECT * FROM agent_work_followups WHERE work_id=$1", [works[0].id])).rows[0], originalFollowUp);
    await call(() => continuation.checkDue(generation, enqueue));
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM agent_work_continuations WHERE owner_user_id=$1 AND child_id=$2", [owner, childId])).rows[0].n, 1);
  });
  await check("fresh_private_context_original_run_and_cancelled_constituent", async () => {
    const stopped = works.find(value => value.id === payload.works[0].workId), claim = await claimFor(owner);
    await call(() => agent.saveWork(claim.scope, claim.runId, "cancel-work", { operationId: randomUUID(), workId: stopped.id, expectedVersion: stopped.version,
      values: { ...workInputs[works.findIndex(value => value.id === stopped.id)].values, status: "cancelled", followUp: null, resources: [] } }));
    const current = await call(() => continuation.backgroundInput(queued));
    assert.equal(current.context.eventType, "work_continuation"); assert.equal(current.context.works.length, 4);
    assert.ok(current.context.works.every(value => value.work.resources[0].version === fact.version));
    const page = await call(() => agent.readWork(owner, childId, { workId: stopped.id, cursor: null }));
    assert.equal(page.items[0].latestFollowUp.state, "cancelled");
    const makeStub = persistedAgent => ({ async background(value) {
      assert.ok(await value.authorize());
      const claim = await call(() => persistedAgent.claim(value.userId, value.childId, { kind: "worker", reference: value.reference }, "product-background"));
      if (!claim.created) return call(() => persistedAgent.get(value.userId, value.childId, claim.runId));
      counts.stubRuns++;
      const receipt = { runId: claim.runId, status: "completed", stopReason: null, provenance: null, text: "Synthetic private station-only result",
        citations: [], privateSourceCitations: [], retrievalMode: "not_used", tools: [], countsKnown: true,
        counts: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 }, proposals: [] };
      assert.ok(await value.authorize()); assert.ok(await call(() => persistedAgent.finish(claim.scope, receipt))); return call(() => persistedAgent.get(value.userId, value.childId, claim.runId));
    } });
    const makeWorker = (continuationStore, persistedAgent) => createAgentWorkContinuationWorker(pool, queue.boss, { ...continuationStore,
      backgroundInput: ref => call(() => continuationStore.backgroundInput(ref)),
      finishBackground: (ref, receipt, terminal) => call(() => continuationStore.finishBackground(ref, receipt, terminal)) }, makeStub(persistedAgent));
    const nextChecks = async () => (await pool.query("SELECT work_id,next_check_at FROM agent_work_followups WHERE owner_user_id=$1 AND child_id=$2 ORDER BY work_id", [owner, childId])).rows;
    const beforeFinish = await nextChecks();
    worker = makeWorker(continuation, agent); await call(() => worker.process(queued, queued.jobId));
    await worker.stop();
    const restartedAgent = createProductAgentStore(pool, cipher), restartedContinuation = createAgentWorkContinuationStore(pool, cipher);
    worker = makeWorker(restartedContinuation, restartedAgent); await call(() => worker.process(queued, queued.jobId));
    assert.deepEqual(await nextChecks(), beforeFinish);
    assert.equal(counts.stubRuns, 1);
    const event = (await pool.query("SELECT state,run_id FROM agent_work_continuations WHERE id=$1", [queued.eventId])).rows[0];
    assert.equal(event.state, "completed"); assert.ok(event.run_id);
    assert.equal((await call(() => restartedAgent.get(owner, childId, event.run_id))).text, "Synthetic private station-only result");
    assert.equal(await call(() => agent.get(other, childId, event.run_id)), null);
  });
  await check("revocation_cancels_the_other_private_event_without_a_new_run", async () => {
    const claim = await claimFor(other);
    otherWork = await call(() => agent.saveWork(claim.scope, claim.runId, "other-due", { operationId: randomUUID(), workId: otherWork.id, expectedVersion: otherWork.version,
      values: { ...otherInput.values, followUp: { ...otherInput.values.followUp, dueAt: new Date(Date.now() - 1000).toISOString() } } }));
    await call(() => continuation.checkDue(generation, enqueue));
    const event = (await pool.query("SELECT * FROM agent_work_continuations WHERE owner_user_id=$1 AND child_id=$2", [other, childId])).rows[0];
    assert.ok(event);
    const client = await pool.connect();
    try { await client.query("BEGIN"); await client.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [fixtures.workspaceId]);
      await client.query("DELETE FROM family_members WHERE workspace_id=$1 AND user_id=$2", [fixtures.workspaceId, other]);
      await client.query("UPDATE workspaces SET access_version=access_version+1 WHERE id=$1", [fixtures.workspaceId]); await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    const ref = { eventId: event.id, jobId: event.job_id, workerGeneration: event.worker_generation, storageEpoch: event.storage_epoch };
    assert.equal(await call(() => continuation.backgroundInput(ref)), null);
    assert.equal((await pool.query("SELECT state FROM agent_work_continuations WHERE id=$1", [event.id])).rows[0].state, "cancelled");
    assert.equal(await call(() => agent.readWork(other, childId, { workId: otherWork.id, cursor: null })), null);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM agent_runs WHERE trigger_kind='worker' AND trigger_reference=$1", [event.id])).rows[0].n, 0);
    assert.equal(counts.stubRuns, 1); assert.equal(counts.networkAttempts, 0); assert.equal(counts.realModelCalls, 0);
  });
  completed = true;
} catch (error) {
  const frames = String(error.stack ?? "").split("\n").slice(1).map(line =>
    /(?:\(|\bat\s+)((?:file:\/\/\/|[A-Za-z]:[\\/]|\/)[^()\r\n]*:\d+:\d+)\)?$/u.exec(line)?.[1]).filter(Boolean).slice(0, 4);
  console.error(JSON.stringify({ status: "failed", step, passed, counts, limits, fixtures, code: error.code ?? error.name, frames })); process.exitCode = 1;
} finally {
  await worker?.stop();
  if (pool && originalControl) await pool.query("UPDATE worker_control SET enabled=false WHERE id=1 AND generation=$1", [originalControl.generation]);
  if (completed && pool) {
    for (const id of new Set(fixtures.jobs)) await queue.boss.deleteJob(WORK_CONTINUATION_QUEUE, id);
    for (let i = 0; i < fixtures.users.length; i++) {
      const row = (await pool.query('SELECT email FROM "user" WHERE id=$1', [fixtures.users[i]])).rows[0];
      assert.equal(row?.email, fixtures.emails[i]); assert.ok(row.email.startsWith("p2-a06-") && row.email.endsWith("@example.test"));
      await pool.query('DELETE FROM "user" WHERE id=$1', [fixtures.users[i]]);
    }
    const afterCleanup = await totals(); assert.deepEqual(afterCleanup, baseline);
    console.log(JSON.stringify({ status: "passed", node: process.versions.node, passed, counts, limits, resumedFromBusinessCalls: resumeReport?.counts.businessCalls ?? 0, baseline, afterCleanup,
      cleanup: "Only exact synthetic users, their cascading rows, and recorded continuation job IDs removed; worker remains paused." }));
  }
  try { await queue?.stop(); } finally { await pool?.end(); }
}
