import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createAuth } from "../server/auth.ts";
import { createAgentActionsStore } from "../server/agent-actions-store.ts";
import { createCareStore } from "../server/care.ts";
import { createChatStore } from "../server/chat.ts";
import { readServerConfig } from "../server/config.ts";
import { createContactStore } from "../server/contact-store.ts";
import { createPool } from "../server/database.ts";
import { FamilyError } from "../server/family-access.ts";
import { createProductAgentStore } from "../server/product-agent-store.ts";
import { createRecordStore } from "../server/records.ts";
import { createStorageCipher, readSecretKey } from "../server/storage-crypto.ts";
import { verifyEncryptedStorage } from "../server/storage-upgrade.ts";
import { createTaskStore } from "../server/tasks.ts";

// Preparation and migration are separate, primary-owned operations. This script
// never migrates, upgrades encryption, starts a worker, or constructs a gateway.
const limits = { accounts: 2, children: 1, tasks: 3, businessCalls: 80 };
const counts = { accounts: 0, children: 0, tasks: 0, businessCalls: 0, fixtureWrites: 0, networkAttempts: 0 };
const fixtures = { users: [], emails: [], childId: null, workspaceId: null, runId: null, bindingId: null };
const passed = [];
let pool, config, cipher, stores, step = "preflight";
const call = async fn => {
  assert.ok(++counts.businessCalls <= limits.businessCalls, "Business call cap exceeded");
  return fn();
};
const fixtureWrite = async fn => { counts.fixtureWrites++; return call(fn); };
const check = async (name, fn) => { step = name; await fn(); passed.push(name); };
const expectConflict = (fn, code) => assert.rejects(call(fn), error => error instanceof FamilyError && error.status === 409 && error.code === code);
const installStores = () => {
  const contactServices = { pushKey: null, telegramBotId: `int-w02-synthetic-${fixtures.bindingId}` };
  stores = {
    records: createRecordStore(pool, cipher, true), chat: createChatStore(pool, cipher, true, true),
    care: createCareStore(pool, cipher, true), tasks: createTaskStore(pool, cipher),
    agent: createProductAgentStore(pool, cipher), contacts: createContactStore(pool, cipher, contactServices),
    actions: createAgentActionsStore(pool, cipher, undefined, contactServices),
  };
};

try {
  assert.deepEqual(process.argv.slice(2), ["--approved-local-int-w02"], "Explicit approved entry required");
  assert.equal(process.versions.node.split(".").slice(0, 2).join("."), "24.19", "Node 24.19 required");
  const url = new URL(process.env.TEST_DATABASE_URL);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname === "127.0.0.1"
    && url.port === "5434" && url.pathname === "/yuban_s06_test" && !url.search && !url.hash, "Assigned local database required");
  assert.ok(process.env.STORAGE_KEY_FILE, "External storage key file required");
  cipher = createStorageCipher(await readSecretKey(process.env.STORAGE_KEY_FILE));
  config = readServerConfig({ ...process.env, DATABASE_URL: url.toString(), NODE_ENV: "test", AI_ENABLED: "false",
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), SERVER_ORIGIN: "http://127.0.0.1:3099", WEB_ORIGIN: "http://127.0.0.1:3099", PORT: "3099" });
  // Catch accidental fetches without exposing a target or sending any HTTP traffic.
  globalThis.fetch = async () => { counts.networkAttempts++; throw new Error("Network is outside this acceptance scope"); };
  pool = createPool(config);
  await check("existing_migration_key_and_disabled_worker", async () => {
    const sql = (await readFile(new URL("../server/migrations/025-agent-actions.sql", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
    const hashes = [sql, sql.replace(/\n/g, "\r\n")].map(value => createHash("sha256").update(value).digest("hex"));
    const migration = (await pool.query("SELECT checksum FROM app_migrations WHERE id='025-agent-actions'")).rows[0];
    assert.ok(migration && hashes.includes(migration.checksum), "Primary must apply the reviewed 025 migration first");
    await call(() => verifyEncryptedStorage(pool, cipher));
    assert.equal((await pool.query("SELECT enabled FROM worker_control WHERE id=1")).rows[0]?.enabled, false, "Worker must remain disabled");
  });
  await check("two_synthetic_accounts_one_child", async () => {
    const auth = createAuth(config, pool);
    for (let index = 0; index < limits.accounts; index++) {
      const email = `int-w02-${randomUUID()}@example.test`;
      const account = await call(() => auth.api.signUpEmail({ body: { name: `Synthetic INT-W02 ${index}`, email, password: randomBytes(24).toString("hex") },
        headers: new Headers({ origin: config.publicOrigin }) }));
      assert.ok(account?.user?.id); fixtures.users.push(account.user.id); fixtures.emails.push(email); counts.accounts++;
    }
    fixtures.bindingId = randomUUID(); installStores();
    const child = await call(() => stores.records.createChildForUser(fixtures.users[0], { displayName: "INT-W02 合成驗收孩子" }));
    fixtures.childId = child.id; fixtures.workspaceId = child.workspaceId; counts.children++;
    assert.equal(counts.accounts, 2); assert.equal(counts.children, 1);
  });
  const [owner, other] = fixtures.users, childId = fixtures.childId;
  const binding = { channel: "telegram", bindingId: fixtures.bindingId, bindingVersion: 1 };
  let consent, policy, policyInput, claim, recordReceipt, noteReceipt, taskAReceipt, taskBReceipt, pendingTask, expiredFact, manualGrant;
  const dueA = new Date(Date.now() + 2 * 86400000).toISOString(), dueB = new Date(Date.now() + 3 * 86400000).toISOString();
  const recordQuote = "今日喝了半樽奶", noteQuote = "今晚想讀圖畫書";
  const taskAQuote = `請於 ${dueA} 給本人一般提醒 A`, taskBQuote = `請於 ${dueB} 給本人一般提醒 B`;
  let recordAction, noteAction, taskAAction;
  await check("synthetic_binding_consent_and_exact_policy", async () => {
    const botId = `int-w02-synthetic-${fixtures.bindingId}`;
    await fixtureWrite(() => pool.query(`INSERT INTO telegram_bindings(id,user_id,bot_id,version,status,target_hash,target_encrypted)
      VALUES($1,$2,$3,1,'active',$4,$5)`, [fixtures.bindingId, owner, botId, createHash("sha256").update(fixtures.bindingId).digest("hex"),
      cipher.encrypt(JSON.stringify({ label: "INT-W02 local synthetic binding", chatId: "0" }), `telegram:binding:${owner}:${fixtures.bindingId}`)]));
    consent = await call(() => stores.contacts.saveConsent(owner, childId, { expectedVersion: 0, enabled: true, allowBackup: false, bindings: [binding], confirm: true }));
    assert.equal(consent.version, 1);
    const empty = await call(() => stores.actions.policy(owner, childId));
    assert.equal(empty.version, 0); assert.equal(empty.effective, false);
    policyInput = { operationId: randomUUID(), expectedVersion: 0, recordKinds: ["feeding"], allowPrivateNotes: true, allowSelfTasks: true,
      reminderConsentVersion: consent.version, reminderBindings: [binding], confirm: true, confirmShared: true };
    policy = await call(() => stores.actions.savePolicy(owner, childId, policyInput));
    assert.equal(policy.version, 1); assert.equal(policy.effective, true);
    assert.deepEqual(await call(() => stores.actions.savePolicy(owner, childId, policyInput)), policy);
  });
  await check("normal_interactive_run_and_committed_effects", async () => {
    const message = await call(() => stores.chat.createUserMessageForUser(owner, childId,
      [recordQuote, noteQuote, taskAQuote, taskBQuote, "請把一般安排列作待確認候選。"].join("。")));
    assert.ok(message);
    claim = await call(() => stores.agent.claim(owner, childId, { kind: "interactive", reference: message.id }, "product-interactive"));
    assert.equal(claim.created, true); assert.equal(claim.state, "running"); fixtures.runId = claim.runId;
    recordAction = { kind: "save_record", sourceQuote: recordQuote, expectedPolicyVersion: policy.version, text: recordQuote,
      details: { kind: "feeding", quantity: { rawValue: "半", unit: "樽", precision: "approximate" },
        eventTime: { rawText: "今日", at: null, timeZone: "Asia/Hong_Kong", precision: "approximate" } } };
    noteAction = { kind: "save_private_note", sourceQuote: noteQuote, expectedPolicyVersion: policy.version, title: "圖畫書安排", text: noteQuote };
    taskAAction = { kind: "create_self_task", sourceQuote: taskAQuote, expectedPolicyVersion: policy.version,
      title: "INT-W02 本人一般提醒 A", details: "合成本人安排", dueAt: dueA, timeZone: "Asia/Hong_Kong" };
    recordReceipt = await call(() => stores.actions.execute(claim.scope, claim.runId, "save-record", recordAction));
    noteReceipt = await call(() => stores.actions.execute(claim.scope, claim.runId, "save-note", noteAction));
    taskAReceipt = await call(() => stores.actions.execute(claim.scope, claim.runId, "create-task-a", taskAAction)); counts.tasks++;
    taskBReceipt = await call(() => stores.actions.execute(claim.scope, claim.runId, "create-task-b", { ...taskAAction, sourceQuote: taskBQuote,
      title: "INT-W02 本人一般提醒 B", dueAt: dueB })); counts.tasks++;
    assert.equal(recordReceipt.state, "saved"); assert.equal(noteReceipt.state, "saved");
    for (const receipt of [taskAReceipt, taskBReceipt]) {
      assert.equal(receipt.state, "scheduled"); assert.equal(receipt.notification, "authorized_for_due_event"); assert.deepEqual(receipt.channels, ["telegram"]);
    }
    assert.equal(await call(() => stores.agent.authorize(claim.scope, claim.runId)), true, "Own writes must advance this run's data version");
  });
  await check("cross_connection_persistence_and_original_receipt_replay", async () => {
    await pool.end(); pool = createPool(config); installStores();
    const receipts = await call(() => stores.actions.receipts(owner, childId, claim.runId));
    assert.deepEqual(new Set(receipts.map(value => value.id)), new Set([recordReceipt.id, noteReceipt.id, taskAReceipt.id, taskBReceipt.id]));
    const records = await call(() => stores.care.search(owner, childId, {}));
    assert.equal(records.records.length, 1); assert.equal(records.records[0].confirmationBasis, "preauthorized_user_statement");
    assert.equal(records.records[0].text, recordQuote);
    const notes = await call(() => stores.actions.notes(owner, childId, "圖畫書"));
    assert.equal(notes.items.length, 1); assert.equal(notes.items[0].text, noteQuote); assert.equal(notes.items[0].provenance, "user_statement");
    assert.equal(notes.items[0].sourceMessageId, claim.sourceMessageId); assert.equal(notes.nextAfterId, null);
    const tasks = await call(() => stores.tasks.list(owner, childId));
    assert.equal(tasks.items.length, 2);
    assert.ok(tasks.items.every(value => value.kind === "ordinary" && value.createdBy === owner && value.assigneeUserId === owner));
    assert.deepEqual(await call(() => stores.actions.execute(claim.scope, claim.runId, "save-record", recordAction)), recordReceipt);
    assert.deepEqual(await call(() => stores.actions.execute(claim.scope, claim.runId, "save-record-equivalent", { details: recordAction.details,
      text: recordAction.text, expectedPolicyVersion: recordAction.expectedPolicyVersion, sourceQuote: recordAction.sourceQuote, kind: recordAction.kind })), recordReceipt);
    await expectConflict(() => stores.actions.execute(claim.scope, claim.runId, "save-record", { ...recordAction, text: "Different same-call input" }), "agent_call_conflict");
    await expectConflict(() => stores.actions.execute(claim.scope, claim.runId, "unmatched-source", { ...noteAction, sourceQuote: "Not present in the original user message" }), "agent_source_mismatch");
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM text_records WHERE child_id=$1", [childId])).rows[0].count, 1);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM memory_facts WHERE child_id=$1", [childId])).rows[0].count, 0, "Private statements must not create confirmed facts");
    assert.equal((await call(() => stores.actions.receipts(owner, childId, claim.runId))).length, 4);
  });
  await check("persistent_candidates_and_one_confirmation_effect", async () => {
    pendingTask = await call(() => stores.agent.propose(claim.scope, claim.runId, "pending-task", { kind: "task_create", values: {
      title: "INT-W02 明確確認的一般任務", details: "合成候選", kind: "ordinary", assigneeUserId: owner,
      dueAt: new Date(Date.now() + 4 * 86400000).toISOString(), timeZone: "Asia/Hong_Kong" } }));
    expiredFact = await call(() => stores.agent.propose(claim.scope, claim.runId, "expired-private-candidate", { kind: "memory_fact",
      key: "合成一般安排", content: "待本人核對的一般安排", intendedVisibility: "private", validUntil: null }));
    assert.ok(pendingTask && expiredFact);
    await pool.end(); pool = createPool(config); installStores();
    const pending = await call(() => stores.agent.pendingProposals(owner, childId));
    assert.deepEqual(new Set(pending.proposals.map(value => value.id)), new Set([pendingTask.id, expiredFact.id]));
    const decision = { expectedVersion: pendingTask.version, decision: "accept", confirmShared: true };
    const accepted = await call(() => stores.agent.decide(owner, childId, claim.runId, pendingTask.id, decision)); counts.tasks++;
    assert.equal(accepted.status, "accepted"); assert.equal(accepted.result.kind, "task");
    assert.deepEqual(await call(() => stores.agent.decide(owner, childId, claim.runId, pendingTask.id, decision)), accepted);
    assert.equal((await call(() => stores.tasks.get(owner, childId, accepted.result.id))).createdBy, owner);
    const expired = await fixtureWrite(() => pool.query("UPDATE agent_proposals SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1 AND run_id=$2 RETURNING id", [expiredFact.id, claim.runId]));
    assert.equal(expired.rowCount, 1);
    const page = await call(() => stores.agent.pendingProposals(owner, childId));
    assert.equal(page.proposals.length, 1); assert.equal(page.proposals[0].id, expiredFact.id); assert.equal(page.proposals[0].status, "expired");
    await expectConflict(() => stores.agent.decide(owner, childId, claim.runId, expiredFact.id,
      { expectedVersion: expiredFact.version, decision: "accept", confirmShared: false }), "confirmation_expired");
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM care_tasks WHERE child_id=$1", [childId])).rows[0].count, 3);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM memory_facts WHERE child_id=$1", [childId])).rows[0].count, 0);
  });
  await check("stopped_run_reads_real_receipts_without_repeating_effect", async () => {
    assert.equal(await call(() => stores.agent.finish(claim.scope, { runId: claim.runId, status: "stopped", stopReason: "interrupted",
      provenance: null, countsKnown: true, text: "合成操作已保存；請查原收據。", citations: [], retrievalMode: "not_used",
      tools: [recordReceipt, noteReceipt, taskAReceipt, taskBReceipt].map(value => ({ name: "execute_ordinary_instruction", status: "succeeded", reference: value.id })),
      counts: { modelCalls: 0, toolCalls: 6, queryEmbeddings: 0 }, proposals: [] })), true);
    assert.equal((await call(() => stores.agent.get(owner, childId, claim.runId))).status, "stopped");
    assert.deepEqual(await call(() => stores.actions.execute(claim.scope, claim.runId, "create-task-a", taskAAction)), taskAReceipt);
    assert.equal((await call(() => stores.actions.receipts(owner, childId, claim.runId))).length, 4);
  });
  await check("isolated_account_cannot_read", async () => {
    assert.equal(await call(() => stores.actions.notes(other, childId)), null);
    assert.equal(await call(() => stores.actions.policy(other, childId)), null);
    assert.equal(await call(() => stores.actions.receipts(other, childId, claim.runId)), null);
    assert.equal(await call(() => stores.agent.pendingProposals(other, childId)), null);
    assert.equal(await call(() => stores.care.search(other, childId, {})), null);
    assert.equal(await call(() => stores.tasks.list(other, childId)), null);
    assert.equal(await call(() => stores.chat.listForUser(other, childId)), null);
  });
  await check("policy_withdrawal_revokes_only_its_exact_task_grant", async () => {
    const before = await call(() => stores.contacts.page(owner, childId));
    const grantA = before.grants.find(value => value.taskId === taskAReceipt.resource.id), grantB = before.grants.find(value => value.taskId === taskBReceipt.resource.id);
    assert.equal(grantA.enabled, true); assert.equal(grantB.enabled, true);
    manualGrant = await call(() => stores.contacts.saveGrant(owner, childId, grantB.taskId, { expectedVersion: grantB.version,
      expectedTaskVersion: grantB.taskVersion, enabled: true, allowFollowUp: false, allowFallback: false, backupUserId: null,
      validUntil: new Date(Date.parse(dueB) + 86400000).toISOString(), confirm: true, content: "generic_notice", trigger: "task_due" }));
    assert.equal(manualGrant.version, grantB.version + 1);
    const revokeInput = { operationId: randomUUID(), expectedVersion: policy.version, recordKinds: [], allowPrivateNotes: false,
      allowSelfTasks: false, reminderConsentVersion: null, reminderBindings: [], confirm: true, confirmShared: false };
    const revoked = await call(() => stores.actions.savePolicy(owner, childId, revokeInput));
    assert.equal(revoked.version, policy.version + 1); assert.equal(revoked.allowSelfTasks, false);
    assert.deepEqual(await call(() => stores.actions.savePolicy(owner, childId, revokeInput)), revoked);
    const after = await call(() => stores.contacts.page(owner, childId));
    const afterA = after.grants.find(value => value.taskId === grantA.taskId), afterB = after.grants.find(value => value.taskId === grantB.taskId);
    assert.equal(afterA.enabled, false); assert.equal(afterA.version, grantA.version + 1);
    assert.deepEqual(afterB, manualGrant, "A later explicit manual grant must remain untouched");
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM agent_task_authorizations WHERE user_id=$1 AND child_id=$2", [owner, childId])).rows[0].count, 0);
    const historical = await call(() => stores.actions.savePolicy(owner, childId, policyInput));
    assert.equal(historical.version, policy.version); assert.equal(historical.effective, false);
    assert.equal((await call(() => stores.actions.policy(owner, childId))).version, revoked.version);
  });
  await check("no_external_delivery_and_scope_caps", async () => {
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM contact_requests WHERE child_id=$1", [childId])).rows[0].count, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM telegram_deliveries WHERE user_id=ANY($1::text[])", [fixtures.users])).rows[0].count, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM task_work w JOIN care_tasks t ON t.id=w.task_id WHERE t.child_id=$1", [childId])).rows[0].count, 0);
    assert.equal((await pool.query("SELECT enabled FROM worker_control WHERE id=1")).rows[0].enabled, false);
    assert.equal(counts.networkAttempts, 0); assert.equal(counts.tasks, limits.tasks);
    assert.ok(counts.businessCalls < limits.businessCalls, "Reserve one call for scoped cleanup");
  });
  await check("cleanup_only_this_synthetic_scene", async () => {
    await call(async () => {
      const client = await pool.connect();
      let discard = false;
      try {
        await client.query("BEGIN");
        const removedChild = await client.query(`DELETE FROM children ch USING workspaces w
          WHERE ch.id=$1 AND ch.workspace_id=$2 AND w.id=ch.workspace_id AND w.owner_user_id=$3 RETURNING ch.id`, [childId, fixtures.workspaceId, owner]);
        assert.equal(removedChild.rowCount, 1);
        const removedUsers = await client.query('DELETE FROM "user" WHERE id=ANY($1::text[]) AND email=ANY($2::text[]) RETURNING id', [fixtures.users, fixtures.emails]);
        assert.equal(removedUsers.rowCount, 2);
        await client.query("COMMIT");
      } catch (error) { try { await client.query("ROLLBACK"); } catch { discard = true; } throw error; }
      finally { client.release(discard); }
    });
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM "user" WHERE id=ANY($1::text[])', [fixtures.users])).rows[0].count, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM children WHERE id=$1", [childId])).rows[0].count, 0);
  });
  console.log(JSON.stringify({ result: "passed", checks: passed, counts, limits, syntheticOnly: true, cleanedSyntheticScene: true,
    realModelCalls: 0, embeddings: 0, externalNotifications: 0, migratedByThisScript: false, scope: "INT-W02 local stores and committed database effects" }));
} catch (error) {
  // No retry or cleanup after an acceptance failure. Only safe synthetic IDs are retained.
  console.error(JSON.stringify({ result: "failed", step, errorKind: error instanceof FamilyError ? error.code : error?.name ?? "Error",
    checksPassed: passed, counts, limits, preservedScene: fixtures, cleanupAttempted: step === "cleanup_only_this_synthetic_scene" }));
  process.exitCode = 1;
} finally {
  await pool?.end();
}
