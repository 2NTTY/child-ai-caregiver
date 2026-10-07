import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createAuth } from "../server/auth.ts";
import { createAgentActionsStore } from "../server/agent-actions-store.ts";
import { createChatStore } from "../server/chat.ts";
import { readServerConfig } from "../server/config.ts";
import { createPool } from "../server/database.ts";
import { FamilyError } from "../server/family-access.ts";
import { createMemoryStore } from "../server/memory.ts";
import { createProductAgentStore } from "../server/product-agent-store.ts";
import { createRecordStore } from "../server/records.ts";
import { createStorageCipher, readSecretKey } from "../server/storage-crypto.ts";

// This approved synthetic batch never migrates, calls a model, starts a worker,
// sends a notification, or cleans pre-existing rows. Failure preserves its fixtures.
const limits = { accounts: 2, children: 2, tasks: 1, facts: 2, messages: 30, businessCalls: 90 };
const counts = { accounts: 0, children: 0, tasks: 0, facts: 0, messages: 0, businessCalls: 0, poolRebuilds: 0, networkAttempts: 0 };
const fixture = { users: [], emails: [], children: [] };
const passed = [];
let pool, config, cipher, stores, baseline, afterCleanup, step = "preflight", completed = false;
const snapshot = async () => (await pool.query(`SELECT (SELECT count(*)::int FROM children) AS children,(SELECT count(*)::int FROM chat_messages) AS messages,
  (SELECT count(*)::int FROM memory_facts) AS facts,(SELECT count(*)::int FROM photo_attachments) AS photos,(SELECT enabled FROM worker_control WHERE id=1) AS worker_enabled`)).rows[0];
const call = async fn => { assert.ok(counts.businessCalls < limits.businessCalls, "Business call cap exceeded"); counts.businessCalls++; return fn(); };
const check = async (name, fn) => { step = name; await fn(); passed.push(name); };
const conflict = (fn, code) => assert.rejects(call(fn), error => error instanceof FamilyError && error.code === code);
const install = () => { stores = { records: createRecordStore(pool, cipher, true), chat: createChatStore(pool, cipher, true, true),
  memory: createMemoryStore(pool, cipher, true), agent: createProductAgentStore(pool, cipher), actions: createAgentActionsStore(pool, cipher) }; };
const userMessage = async (text, childId = fixture.children[0]) => {
  assert.ok(++counts.messages <= limits.messages); return call(() => stores.chat.createUserMessageForUser(fixture.users[0], childId, text));
};
const ask = async (claim, proposal, workId = null) => {
  const request = await call(() => stores.agent.requestConfirmation(claim.scope, claim.runId, { runId: proposal.runId, proposalId: proposal.id, expectedVersion: proposal.version, workId }));
  assert.ok(request.question.includes("P2-A02 合成孩子")); assert.ok(request.question.includes(proposal.value.kind === "task_create" ? proposal.value.values.title : proposal.value.kind === "memory_fact_revise" ? proposal.value.content : proposal.targetLabel));
  assert.ok(++counts.messages <= limits.messages);
  const message = await call(() => stores.chat.createModelMessageForUser(fixture.users[0], fixture.children[0], claim.sourceMessageId, request.question));
  await call(() => stores.agent.bindConfirmationQuestion(fixture.users[0], fixture.children[0], message.id)); return { request, message };
};
const claimFor = message => call(() => stores.agent.claim(fixture.users[0], fixture.children[0], { kind: "interactive", reference: message.id }, "product-interactive"));
const decideDismiss = proposal => call(() => stores.agent.decide(fixture.users[0], fixture.children[0], proposal.runId, proposal.id, { expectedVersion: proposal.version, decision: "dismiss", confirmShared: false }));
try {
  assert.deepEqual(process.argv.slice(2), ["--approved-local-p2-a02"], "Explicit approved entry required");
  const url = new URL(process.env.TEST_DATABASE_URL);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname === "127.0.0.1" && url.port === "5434"
    && url.pathname === "/yuban_s06_test" && !url.search && !url.hash, "Assigned local database required");
  assert.ok(process.env.STORAGE_KEY_FILE, "External key file required");
  cipher = createStorageCipher(await readSecretKey(process.env.STORAGE_KEY_FILE));
  config = readServerConfig({ ...process.env, DATABASE_URL: url.toString(), NODE_ENV: "test", AI_ENABLED: "false",
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), SERVER_ORIGIN: "http://127.0.0.1:3099", WEB_ORIGIN: "http://127.0.0.1:3099", PORT: "3099" });
  globalThis.fetch = async () => { counts.networkAttempts++; throw new Error("Network is outside this acceptance"); };
  pool = createPool(config); install();
  await check("reviewed_migration_and_paused_worker", async () => {
    const sql = (await readFile(new URL("../server/migrations/030-agent-work.sql", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
    const checksum = (await pool.query("SELECT checksum FROM app_migrations WHERE id='030-agent-work'")).rows[0]?.checksum;
    assert.ok([sql, sql.replace(/\n/g, "\r\n")].map(value => createHash("sha256").update(value).digest("hex")).includes(checksum), "Primary must apply the reviewed 030 first");
    baseline = await snapshot();
    assert.equal(baseline.worker_enabled, false, "Worker must remain paused");
  });
  await check("two_synthetic_accounts_and_two_children", async () => {
    const auth = createAuth(config, pool);
    for (let i = 0; i < 2; i++) {
      const email = `p2-a02-${randomUUID()}@example.test`, account = await call(() => auth.api.signUpEmail({ body: { name: `Synthetic P2-A02 ${i}`, email, password: randomBytes(24).toString("hex") }, headers: new Headers({ origin: config.publicOrigin }) }));
      assert.ok(account?.user?.id); fixture.users.push(account.user.id); fixture.emails.push(email); counts.accounts++;
    }
    for (let i = 0; i < 2; i++) {
      const child = await call(() => stores.records.createChildForUser(fixture.users[0], { displayName: `P2-A02 合成孩子 ${i}` }));
      fixture.children.push(child.id); counts.children++;
    }
  });
  const [owner, other] = fixture.users, [childId, otherChild] = fixture.children;
  let old, current, work, workInput, recordReceipt, privateFact, familyFact;
  await check("cross_turn_work_source_and_original_receipt", async () => {
    for (const visibility of ["private", "family"]) {
      const candidate = await call(() => stores.memory.createFact(owner, childId, { intendedVisibility: visibility,
        values: { key: `p2-a02-${visibility}`, content: "synthetic old value", source: { kind: "manual", description: "Synthetic seed" }, validUntil: null } }));
      const fact = await call(() => stores.memory.confirmFact(owner, childId, candidate.id, { expectedVersion: candidate.version, confirm: true, confirmShared: visibility === "family" }));
      if (visibility === "private") privateFact = fact; else familyFact = fact; counts.facts++;
    }
    const policy = await call(() => stores.actions.savePolicy(owner, childId, { operationId: randomUUID(), expectedVersion: 0, recordKinds: ["feeding"], allowPrivateNotes: true, allowSelfTasks: false,
      reminderConsentVersion: null, reminderBindings: [], confirm: true, confirmShared: true }));
    old = await userMessage("synthetic 原話：今日 08:15 喝了100ml奶；更正為 synthetic corrected value。");
    current = await userMessage("synthetic 請保存剛才的普通記錄，接續這項整理。");
    const claim = await claimFor(current);
    workInput = { operationId: randomUUID(), workId: null, expectedVersion: 0, values: { goal: "synthetic 跨輪整理", focus: "核對原文", questions: ["還有補充嗎？"], sourceMessageIds: [old.id, current.id], resources: [], pending: [], status: "waiting" } };
    work = await call(() => stores.agent.saveWork(claim.scope, claim.runId, "save-work", workInput)); assert.equal(work.version, 1);
    assert.deepEqual(await call(() => stores.agent.saveWork(claim.scope, claim.runId, "save-work", workInput)), work);
    const action = { kind: "save_record", sourceQuote: "請保存剛才的普通記錄", sourceMessages: [{ messageId: old.id, quote: "今日 08:15 喝了100ml奶" }], expectedPolicyVersion: policy.version,
      text: "依本人原話整理的普通餵奶記錄", quantityEvidence: "100ml", details: { kind: "feeding", quantity: { rawValue: "100", unit: "ml", precision: "exact" },
        eventTime: { rawText: "08:15", at: "2026-10-08T08:15:00+08:00", timeZone: "Asia/Hong_Kong", precision: "exact" } } };
    recordReceipt = await call(() => stores.actions.execute(claim.scope, claim.runId, "record", action));
    assert.equal(recordReceipt.quantityGrounding.status, "source_supported");
    assert.deepEqual(await call(() => stores.actions.execute(claim.scope, claim.runId, "record", action)), recordReceipt);
    await conflict(() => stores.actions.execute(claim.scope, claim.runId, "bad-source", { ...action, sourceMessages: [{ messageId: old.id, quote: "not in source" }] }), "agent_source_mismatch");
    const original = await call(() => stores.agent.readHistory(owner, childId, { messageId: old.id, offset: 0, limit: 4000 }));
    assert.equal(original.role, "user"); assert.equal(original.version, 1); assert.equal(original.nextOffset, null);
    assert.ok(await call(() => stores.agent.finish(claim.scope, { runId: claim.runId, provenance: null, status: "completed", stopReason: null, text: "Synthetic saved result",
      citations: [], retrievalMode: "not_used", tools: [{ name: "save_ordinary_record", status: "succeeded", reference: recordReceipt.id }], countsKnown: true, counts: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 }, proposals: [] })));
    assert.equal(await call(() => stores.agent.readWork(other, childId, { workId: work.id, cursor: null })), null);
    assert.deepEqual((await call(() => stores.agent.readWork(owner, otherChild, { workId: work.id, cursor: null }))).items, []);
  });
  await check("pool_rebuild_preserves_encrypted_work", async () => {
    await pool.end(); pool = createPool(config); counts.poolRebuilds++; install();
    const page = await call(() => stores.agent.readWork(owner, childId, { workId: work.id, cursor: null }));
    assert.equal(page.items[0].goal, work.values?.goal ?? work.goal); assert.equal(page.items[0].version, 1);
    const encrypted = (await pool.query("SELECT payload_encrypted FROM agent_work WHERE id=$1", [work.id])).rows[0].payload_encrypted;
    assert.ok(encrypted.startsWith("yb1.") && !encrypted.includes("synthetic"));
  });
  await check("unique_specific_confirmation_and_response_retry", async () => {
    const message = await userMessage("synthetic 請安排一項普通事項。"), claim = await claimFor(message);
    const proposal = await call(() => stores.agent.propose(claim.scope, claim.runId, "task", { kind: "task_create", values: { title: "synthetic 一項普通待辦", details: "只驗站內保存",
      kind: "ordinary", assigneeUserId: owner, dueAt: new Date(Date.now() + 86400000).toISOString(), timeZone: "Asia/Hong_Kong" } }));
    await ask(claim, proposal);
    const response = await userMessage("確認");
    const accepted = await call(() => stores.agent.consumeConfirmation(owner, childId, response.id));
    assert.equal(accepted.status, "accepted"); assert.equal(accepted.result.kind, "task"); counts.tasks++;
    assert.deepEqual(await call(() => stores.agent.consumeConfirmation(owner, childId, response.id)), accepted);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM care_tasks WHERE child_id=$1", [childId])).rows[0].n, 1);
  });
  const revision = (content = "synthetic corrected value") => ({ kind: "memory_fact_revise", factId: privateFact.id, expectedVersion: privateFact.version, key: privateFact.key,
    content, validUntil: null, sourceMessageId: old.id, reason: "synthetic 跨輪原話更正" });
  await check("expired_multiple_and_later_correction_do_not_accept", async () => {
    let message = await userMessage("synthetic 更正候選過期測試。"), claim = await claimFor(message);
    let proposal = await call(() => stores.agent.propose(claim.scope, claim.runId, "expired", revision()));
    await ask(claim, proposal);
    await pool.query("UPDATE agent_proposals SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [proposal.id]);
    let response = await userMessage("好");
    assert.equal(await call(() => stores.agent.consumeConfirmation(owner, childId, response.id)), null); await decideDismiss(proposal);
    message = await userMessage("synthetic 兩項不同更正候選。"); claim = await claimFor(message);
    const first = await call(() => stores.agent.propose(claim.scope, claim.runId, "first", revision("synthetic value A")));
    const second = await call(() => stores.agent.propose(claim.scope, claim.runId, "second", revision("synthetic value B")));
    await ask(claim, first);
    response = await userMessage("確認");
    assert.equal(await call(() => stores.agent.consumeConfirmation(owner, childId, response.id)), null); await decideDismiss(first); await decideDismiss(second);
    message = await userMessage("synthetic 需要接續確認。"); claim = await claimFor(message);
    proposal = await call(() => stores.agent.propose(claim.scope, claim.runId, "late", revision())); await ask(claim, proposal, work.id);
    response = await userMessage("好");
    const cancellation = await userMessage("取消剛才的整理，先不要更正。");
    assert.equal(await call(() => stores.agent.consumeConfirmation(owner, childId, response.id)), null);
    const cancelClaim = await claimFor(cancellation);
    const cancelled = await call(() => stores.agent.saveWork(cancelClaim.scope, cancelClaim.runId, "cancel-work", { operationId: randomUUID(), workId: work.id,
      expectedVersion: 1, values: { ...workInput.values, resources: [{ kind: "receipt", id: recordReceipt.id, version: 1 }, { kind: "care_record", id: recordReceipt.resource.id, version: recordReceipt.resource.version }], status: "cancelled" } }));
    assert.equal(cancelled.status, "cancelled"); assert.equal(cancelled.version, 2); await decideDismiss(proposal);
  });
  await check("original_fact_revision_and_shared_deactivation", async () => {
    let message = await userMessage("synthetic 使用原話更正私人事實。"), claim = await claimFor(message);
    let proposal = await call(() => stores.agent.propose(claim.scope, claim.runId, "revise", revision())); assert.equal(proposal.targetVisibility, "private");
    await ask(claim, proposal); let response = await userMessage("確認");
    const revised = await call(() => stores.agent.consumeConfirmation(owner, childId, response.id)); assert.equal(revised.result.kind, "memory_fact");
    privateFact = await call(() => stores.memory.getFact(owner, childId, privateFact.id)); assert.equal(privateFact.content, "synthetic corrected value");
    assert.equal(privateFact.source.messageId, old.id); assert.equal(privateFact.visibility, "private");
    message = await userMessage("synthetic 停用這項共享事實。"); claim = await claimFor(message);
    proposal = await call(() => stores.agent.propose(claim.scope, claim.runId, "deactivate", { kind: "memory_fact_deactivate", factId: familyFact.id, expectedVersion: familyFact.version, reason: "synthetic 不再適用" }));
    assert.equal(proposal.targetVisibility, "family"); const asked = await ask(claim, proposal); assert.ok(asked.request.question.includes("共用資料"));
    response = await userMessage("確認"); const deactivated = await call(() => stores.agent.consumeConfirmation(owner, childId, response.id));
    assert.equal(deactivated.result.kind, "memory_fact");
    const fact = await call(() => stores.memory.getFact(owner, childId, familyFact.id)); assert.equal(fact.status, "inactive"); assert.equal(fact.visibility, "family");
    await pool.query("UPDATE memory_facts SET validity_indexed=false WHERE id=$1", [privateFact.id]);
    const context = await call(() => stores.memory.context(owner, childId, "private"));
    assert.equal((await pool.query("SELECT validity_indexed FROM memory_facts WHERE id=$1", [privateFact.id])).rows[0].validity_indexed, true); assert.equal(context.summaryUnavailable, null);
    assert.ok(context.facts.some(item => item.id === privateFact.id));
  });
  await check("history_high_water_and_unknown_run_recovery", async () => {
    const message = await userMessage("synthetic 未知運行。"), claim = await claimFor(message);
    await pool.query("UPDATE agent_runs SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [claim.runId]);
    assert.equal((await call(() => stores.agent.get(owner, childId, claim.runId))).status, "unknown");
    const retry = await claimFor(message); assert.equal(retry.created, false); assert.equal(retry.state, "unknown");
    const first = await call(() => stores.agent.searchHistory(owner, childId, { kind: "message", query: "", cursor: null })); assert.ok(first.nextCursor);
    const later = await userMessage("synthetic 高水位之後新增訊息。");
    const seen = first.matches.map(item => item.id); let cursor = first.nextCursor;
    while (cursor) {
      const page = await call(() => stores.agent.searchHistory(owner, childId, { kind: "message", query: "", cursor }));
      seen.push(...page.matches.map(item => item.id)); cursor = page.nextCursor;
    }
    assert.ok(!seen.includes(later.id)); assert.equal(seen.length, counts.messages - 1); assert.equal(new Set(seen).size, seen.length);
  });
  assert.equal(counts.networkAttempts, 0); assert.equal(counts.poolRebuilds, 1);
  assert.ok(counts.facts <= limits.facts && counts.tasks <= limits.tasks && counts.messages <= limits.messages);
  completed = true;
} catch (error) {
  console.error(JSON.stringify({ status: "failed", step, passed, counts, fixtures: fixture, code: error.code ?? error.name,
    message: error.name === "AssertionError" || error instanceof FamilyError ? error.message : "Acceptance stopped; inspect local diagnostics without exposing secrets." }));
  process.exitCode = 1;
} finally {
  if (completed && pool) {
    for (let i = 0; i < fixture.users.length; i++) {
      const row = (await pool.query('SELECT email FROM "user" WHERE id=$1', [fixture.users[i]])).rows[0];
      assert.equal(row?.email, fixture.emails[i]); assert.ok(row.email.startsWith("p2-a02-") && row.email.endsWith("@example.test"));
      await pool.query('DELETE FROM "user" WHERE id=$1', [fixture.users[i]]);
    }
    afterCleanup = await snapshot(); assert.deepEqual(afterCleanup, baseline, "Pre-existing totals and paused worker must remain unchanged");
    console.log(JSON.stringify({ status: "passed", baseline, afterCleanup, node: process.versions.node, passed, counts, limits, cleanup: "Only newly created synthetic users and cascading rows removed." }));
  }
  await pool?.end();
}
