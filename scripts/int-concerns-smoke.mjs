import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createAuth } from "../server/auth.ts";
import { createChatStore } from "../server/chat.ts";
import { createConcernStore } from "../server/concern-store.ts";
import { createConcernWorker } from "../server/concern-worker.ts";
import { CONCERN_AGENT_QUEUE, CONCERN_JOB_OPTIONS } from "../server/concern-events.ts";
import { readServerConfig } from "../server/config.ts";
import { createPool } from "../server/database.ts";
import { FamilyError } from "../server/family-access.ts";
import { createProductAgentStore } from "../server/product-agent-store.ts";
import { createRecordStore } from "../server/records.ts";
import { createStorageCipher, readSecretKey } from "../server/storage-crypto.ts";
import { createTaskStore } from "../server/tasks.ts";
import { createWorkerQueue, databaseAdapter } from "../server/worker-queue.ts";

// One primary-reviewed local scenario. The primary must confirm no other worker
// uses this database before setting INT_W05_SCRIPTED_WORKER_ONLY=true.
// The producer never starts a consumer, cron, Runner, model, embedding or notification.
const limits = { accounts: 2, children: 1, businessCalls: 40, polls: 60 };
const counts = { accounts: 0, children: 0, businessCalls: 0, polls: 0, networkAttempts: 0, scriptedAgentExecutions: 0 };
const scene = { userIds: [], childId: null, workspaceId: null, concernId: null, taskId: null, recordId: null, proposalId: null, runIds: [], jobId: null, followUpId: null };
let pool, queue, worker, generation, workerEnabled = false, step = "preflight", output;
const passed = [];
const call = async action => { assert.ok(++counts.businessCalls <= limits.businessCalls, "Business call cap exceeded"); return action(); };
const poll = async action => { assert.ok(++counts.polls <= limits.polls, "Poll cap exceeded"); return action(); };
const check = async (name, action) => { step = name; await action(); passed.push(name); };
globalThis.fetch = async () => { counts.networkAttempts++; throw new Error("External fetch is outside this scenario"); };

try {
  assert.deepEqual(process.argv.slice(2), ["--approved-local-int-w05"]);
  assert.equal(Number(process.versions.node.split(".")[0]), 24);
  assert.equal(process.env.INT_W05_SCRIPTED_WORKER_ONLY, "true");
  const database = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["postgres:", "postgresql:"].includes(database.protocol) && ["localhost", "127.0.0.1"].includes(database.hostname)
    && database.port === "5434" && database.pathname === "/yuban_s06_test" && !database.search && !database.hash);
  assert.ok(process.env.STORAGE_KEY_FILE && isAbsolute(process.env.STORAGE_KEY_FILE));
  for (const flag of ["AI_ENABLED", "WEB_PUSH_ENABLED", "TELEGRAM_ENABLED"]) assert.equal(process.env[flag], "false");
  const key = await readSecretKey(process.env.STORAGE_KEY_FILE), cipher = createStorageCipher(key); key.fill(0);
  const config = readServerConfig({ DATABASE_URL: process.env.DATABASE_URL, NODE_ENV: "test", BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    SERVER_ORIGIN: "http://127.0.0.1:3099", WEB_ORIGIN: "http://127.0.0.1:3099", HOST: "127.0.0.1", PORT: "3099" });
  pool = createPool(config);
  await check("reviewed_migration_disabled_worker", async () => {
    const sql = (await readFile(new URL("../server/migrations/027-concerns.sql", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
    const hashes = [sql, sql.replace(/\n/g, "\r\n")].map(value => createHash("sha256").update(value).digest("hex"));
    const row = (await call(() => pool.query(`SELECT m.checksum,c.enabled,c.generation FROM app_migrations m
      CROSS JOIN worker_control c WHERE m.id='027-concerns' AND c.id=1`))).rows[0];
    assert.ok(row && hashes.includes(row.checksum)); assert.equal(row.enabled, false); generation = row.generation;
  });
  queue = createWorkerQueue(pool, "producer"); await queue.start();
  assert.ok(await poll(() => queue.boss.getQueue(CONCERN_AGENT_QUEUE)));
  const records = createRecordStore(pool, cipher, true), chat = createChatStore(pool, cipher, true, true);
  const agent = createProductAgentStore(pool, cipher), concerns = createConcernStore(pool, cipher), tasks = createTaskStore(pool, cipher);
  await check("two_accounts_one_child_and_shared_links", async () => {
    const auth = createAuth(config, pool);
    for (let index = 0; index < limits.accounts; index++) {
      const account = await call(() => auth.api.signUpEmail({ body: { name: `Synthetic INT-W05 ${index}`,
        email: `int-w05-${randomUUID()}@example.test`, password: randomBytes(24).toString("hex") }, headers: new Headers({ origin: config.publicOrigin }) }));
      assert.ok(account?.user?.id); scene.userIds.push(account.user.id); counts.accounts++;
    }
    const child = await call(() => records.createChildForUser(scene.userIds[0], { displayName: "INT-W05 合成驗收孩子" }));
    scene.childId = child.id; scene.workspaceId = child.workspaceId; counts.children++;
    const task = await call(() => tasks.create(scene.userIds[0], child.id, { confirm: true, values: { title: "合成相關照護任务", details: "僅供本機驗收",
      kind: "ordinary", assigneeUserId: scene.userIds[0], dueAt: new Date(Date.now() + 86400000).toISOString(), timeZone: "Asia/Hong_Kong" } }));
    assert.ok(task); scene.taskId = task.id;
    const record = await call(() => records.createRecordForUser(scene.userIds[0], { childId: child.id, text: "合成共享觀察記錄" }));
    assert.ok(record); scene.recordId = record.id;
    assert.equal((await call(() => pool.query("INSERT INTO family_members(workspace_id,user_id,role) VALUES($1,$2,'viewer') RETURNING user_id",
      [scene.workspaceId, scene.userIds[1]]))).rowCount, 1);
  });
  const [owner, foreign] = scene.userIds, childId = scene.childId;
  let item, values, firstFollowup, authorityVersion;
  await check("actual_agent_confirmation_and_original_operation_replay", async () => {
    const message = await call(() => chat.createUserMessageForUser(owner, childId, "合成驗收：請把這項觀察建立為家庭共享持續關注。")); assert.ok(message);
    const claim = await call(() => agent.claim(owner, childId, { kind: "interactive", reference: message.id }, "product-interactive")); assert.ok(claim?.created);
    scene.runIds.push(claim.runId);
    values = { title: "合成持續關注", reason: "家長明確確認供共同照護參考", observation: "合成觀察：本週開始建立固定作息。",
      observedAt: new Date().toISOString(), links: { recordId: scene.recordId, taskId: scene.taskId, attentionId: null },
      followUpAt: new Date(Date.now() + 86400000).toISOString() };
    const proposal = await call(() => agent.propose(claim.scope, claim.runId, "int-w05-concern-once", { kind: "concern_create", values })); assert.ok(proposal);
    scene.proposalId = proposal.id;
    assert.equal(await call(() => agent.finish(claim.scope, { runId: claim.runId, status: "completed", stopReason: null, provenance: null, countsKnown: true,
      text: "合成候選等待家長核對。", citations: [], retrievalMode: "not_used", tools: [{ name: "propose_concern", status: "succeeded", reference: proposal.id }],
      counts: { modelCalls: 0, toolCalls: 1, queryEmbeddings: 0 }, proposals: [] })), true);
    const decision = { expectedVersion: proposal.version, decision: "accept", confirmShared: true };
    const accepted = await call(() => agent.decide(owner, childId, claim.runId, proposal.id, decision));
    assert.ok(accepted?.status === "accepted" && accepted.result?.kind === "concern"); scene.concernId = accepted.result.id;
    assert.deepEqual(await call(() => agent.decide(owner, childId, claim.runId, proposal.id, decision)), accepted);
    const page = await call(() => concerns.list(owner, childId)); assert.equal(page.items.length, 1); authorityVersion = page.authorityVersion;
    item = page.items[0]; assert.equal(item.id, scene.concernId); assert.equal(item.version, 1); firstFollowup = item.followUp.id;
    const shared = await call(() => concerns.list(foreign, childId));
    assert.equal(shared.canManage, false); assert.equal(shared.authorityVersion, authorityVersion); assert.deepEqual(shared.items, page.items);
  });
  await check("append_then_archive_restore_preserves_task_and_history", async () => {
    const append = { action: "append", expectedVersion: item.version, authorityVersion, text: "合成後續觀察：已有更多規律。",
      observedAt: new Date().toISOString(), links: { recordId: scene.recordId, taskId: scene.taskId, attentionId: null } }, opId = randomUUID();
    item = await call(() => concerns.change(owner, childId, item.id, append, opId));
    assert.deepEqual(await call(() => concerns.change(owner, childId, item.id, append, opId)), item);
    assert.equal(item.events.length, 2); assert.equal(item.followUp.state, "pending");
    const originalTask = await call(() => tasks.get(owner, childId, scene.taskId));
    item = await call(() => concerns.change(owner, childId, item.id, { action: "archive", expectedVersion: item.version, authorityVersion, confirm: true }, randomUUID()));
    assert.equal(item.status, "closed"); assert.equal(item.followUp.id, firstFollowup); assert.equal(item.followUp.state, "cancelled");
    item = await call(() => concerns.change(owner, childId, item.id, { action: "restore", expectedVersion: item.version, authorityVersion, confirm: true }, randomUUID()));
    assert.equal(item.status, "following"); assert.equal(item.followUp.id, firstFollowup); assert.equal(item.followUp.state, "cancelled");
    assert.equal(item.events.length, 4); assert.equal(item.events[0].taskId, originalTask.id);
    assert.deepEqual(await call(() => tasks.get(owner, childId, scene.taskId)), originalTask);
    const rows = (await call(() => pool.query(`SELECT c.payload_encrypted,
      (SELECT count(*)::integer FROM concern_events e WHERE e.concern_id=c.id) AS events,
      (SELECT count(*)::integer FROM concern_revisions r WHERE r.concern_id=c.id) AS revisions
      FROM concerns c WHERE c.id=$1`, [item.id]))).rows[0];
    assert.ok(rows.payload_encrypted.startsWith("yb1.")); assert.equal(rows.events, 4); assert.equal(rows.revisions, item.version);
  });
  await check("revoked_outsider_denied", async () => {
    assert.equal((await call(() => pool.query(`WITH removed AS (DELETE FROM family_members WHERE workspace_id=$1 AND user_id=$2 RETURNING workspace_id)
      UPDATE workspaces SET access_version=access_version+1 WHERE id IN(SELECT workspace_id FROM removed) RETURNING storage_epoch,access_version::text`,
    [scene.workspaceId, foreign]))).rowCount, 1);
    assert.equal(await call(() => concerns.get(foreign, childId, item.id)), null);
    const page = await call(() => concerns.list(owner, childId)); authorityVersion = page.authorityVersion;
  });
  await check("one_durable_followup_exact_agent_claim_and_job_dedup", async () => {
    const dueAt = new Date(Date.now() + 1500).toISOString();
    item = await call(() => concerns.change(owner, childId, item.id, { action: "schedule_followup", expectedVersion: item.version, authorityVersion, followUpAt: dueAt }, randomUUID()));
    scene.followUpId = item.followUp.id;
    let enqueued = 0;
    const enqueue = async (client, job) => {
      enqueued++; assert.equal(enqueued, 1); scene.jobId = job.jobId;
      assert.deepEqual(Object.keys(job).sort(), ["childId", "followUpId", "id", "jobId", "storageEpoch", "version", "workerGeneration"]);
      assert.equal(await queue.boss.send(CONCERN_AGENT_QUEUE, job, { ...CONCERN_JOB_OPTIONS, id: job.jobId, db: databaseAdapter(client) }), job.jobId);
    };
    await delay(Math.max(0, Date.parse(dueAt) - Date.now() + 20));
    await call(() => concerns.checkDue(generation, enqueue)); assert.equal(enqueued, 0);
    assert.equal((await call(() => pool.query("UPDATE worker_control SET enabled=true WHERE id=1 AND generation=$1 AND enabled=false RETURNING id", [generation]))).rowCount, 1);
    workerEnabled = true;
    await call(() => concerns.checkDue(generation, enqueue)); assert.equal(enqueued, 1);
    const scriptedReplyText = "合成站內跟進結果：請繼續觀察並記錄近況。";
    const scripted = { async background(input) {
      assert.equal(input.reference, scene.followUpId); assert.equal(input.context.eventType, "concern_followup"); assert.equal(await input.authorize(), true);
      const claim = await call(() => agent.claim(input.userId, input.childId, { kind: "worker", reference: input.reference }, "product-background")); assert.ok(claim);
      if (claim.created) {
        counts.scriptedAgentExecutions++;
        scene.runIds.push(claim.runId);
        assert.equal(await call(() => agent.finish(claim.scope, { runId: claim.runId, status: "completed", stopReason: null, provenance: null,
          text: scriptedReplyText, citations: [], retrievalMode: "not_used", tools: [], countsKnown: true,
          counts: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 }, proposals: [] })), true);
      }
      return call(() => agent.get(input.userId, input.childId, claim.runId));
    } };
    // Count the actual business entry points invoked inside the handler as well.
    const measuredStore = { ...concerns, backgroundInput: (...args) => call(() => concerns.backgroundInput(...args)),
      finishBackground: (...args) => call(() => concerns.finishBackground(...args)) };
    worker = createConcernWorker(pool, queue.boss, measuredStore, scripted);
    let jobs = [];
    for (let attempt = 0; attempt < limits.polls && !jobs.length; attempt++) {
      jobs = await poll(() => queue.boss.fetch(CONCERN_AGENT_QUEUE, { batchSize: 1 }));
      if (!jobs.length) await delay(100);
    }
    assert.equal(jobs.length, 1); const job = jobs[0]; assert.equal(job.id, scene.jobId);
    await worker.process(job.data, job.id); await poll(() => queue.boss.complete(CONCERN_AGENT_QUEUE, job.id));
    item = await call(() => concerns.get(owner, childId, scene.concernId)); assert.equal(item.followUp.state, "completed");
    assert.equal(JSON.stringify(item).includes(scriptedReplyText), false);
    assert.equal(item.followUp.runId, scene.runIds.at(-1)); assert.equal(item.events.at(-1).runId, item.followUp.runId);
    await worker.process(job.data, job.id); assert.equal(counts.scriptedAgentExecutions, 1);
    const sameClaim = await call(() => agent.claim(owner, childId, { kind: "worker", reference: scene.followUpId }, "product-background"));
    assert.equal(sameClaim.created, false); assert.equal(sameClaim.runId, item.followUp.runId); assert.equal(sameClaim.state, "completed");
    assert.equal(counts.networkAttempts, 0);
  });
  await check("disable_and_cleanup_created_child", async () => {
    assert.equal((await call(() => pool.query("UPDATE worker_control SET enabled=false WHERE id=1 AND generation=$1 RETURNING id", [generation]))).rowCount, 1); workerEnabled = false;
    assert.equal(await call(() => records.deleteChildForUser(owner, childId)), true);
  });
  output = { result: "passed", checks: passed, counts, limits, scene, cleanedChild: true, syntheticAccountsRetained: true,
    realModelCalls: 0, embeddings: 0, externalNotifications: 0, migratedByThisScript: false };
} catch (error) {
  // First failure stops the scenario. Keep synthetic IDs and no credentials or bodies.
  process.exitCode = 1;
  output = { result: "failed", step, errorKind: error instanceof FamilyError ? error.code : error?.name ?? "Error", checksPassed: passed, counts, limits, preservedScene: scene };
} finally {
  try { await worker?.stop(); } catch { process.exitCode = 1; output = { ...output, result: "failed", stopWorkerFailed: true }; }
  if (workerEnabled) {
    try { await pool.query("UPDATE worker_control SET enabled=false WHERE id=1 AND generation=$1", [generation]); }
    catch { process.exitCode = 1; output = { ...output, result: "failed", restoreDisabledWorkerFailed: true }; }
  }
  try { await queue?.stop(); } catch { process.exitCode = 1; output = { ...output, result: "failed", stopQueueFailed: true }; }
  try { await pool?.end(); } catch { process.exitCode = 1; output = { ...output, result: "failed", closePoolFailed: true }; }
}
process.stdout.write(JSON.stringify(output) + "\n");
