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
import { createCareStore } from "../server/care.ts";
import { createChatStore } from "../server/chat.ts";
import { createMemoryStore } from "../server/memory.ts";
import { createOnlineStore } from "../server/online.ts";
import { createStorageCipher, readSecretKey } from "../server/storage-crypto.ts";
import { verifyEncryptedStorage } from "../server/storage-upgrade.ts";
import { emptyCareDetails } from "../src/shared/care.ts";

const limits = { http: 60, store: 100, facts: 6, topics: 5, chatMessages: 6, careRecords: 2, summaries: 4 };
const counts = { http: 0, store: 0, facts: 0, topics: 0, chatMessages: 0, careRecords: 0, summaries: 0 };
let pool, server, memory, online, step = "preflight", checks = 0;
const check = async (name, action) => { step = name; await action(); checks++; };
const count = key => { if (++counts[key] > limits[key]) throw new Error("Scope cap reached"); };
const manual = (key, content, validUntil = null) => ({ key, content, source: { kind: "manual", description: "合成家長確認" }, validUntil });
const factCreate = (values, intendedVisibility = "family") => ({ values, intendedVisibility });
const confirmation = version => ({ expectedVersion: version, confirm: true, confirmShared: true });
const isConflict = error => error?.status === 409;
const isInputError = error => error?.name === "ZodError";

try {
  if (!process.argv.includes("--approved-memory")) throw new Error("Approval required");
  const url = new URL(process.env.TEST_DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || !/^yuban_s06_test[A-Za-z0-9_]*$/.test(url.pathname.slice(1)) || url.search || url.hash) throw new Error("Local synthetic DB required");
  const cipher = createStorageCipher(await readSecretKey(process.env.STORAGE_KEY_FILE));
  const env = { ...process.env, DATABASE_URL: url.toString(), AI_ENABLED: "false", NODE_ENV: "test", BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    SERVER_ORIGIN: "http://127.0.0.1:3099", WEB_ORIGIN: "http://127.0.0.1:3099", PORT: "3099" };
  const config = readServerConfig(env);
  pool = createPool(config);
  const prior = new Map();
  for (const table of ["children", "text_records", "chat_messages"]) {
    for (const row of (await pool.query(`SELECT * FROM ${table}`)).rows) prior.set(`${table}:${row.id}`, row);
  }
  await check("memory_migrations_and_existing_encryption", async () => {
    execFileSync(process.execPath, ["server/migrate.ts"], { cwd: fileURLToPath(new URL("../", import.meta.url)), env, stdio: "ignore", timeout: 60000, windowsHide: true });
    await verifyEncryptedStorage(pool, cipher);
    assert.equal((await pool.query("SELECT 1 FROM app_migrations WHERE id='008-long-term-memory'")).rowCount, 1);
    assert.equal((await pool.query("SELECT 1 FROM app_migrations WHERE id='011-memory-online'")).rowCount, 1);
  });
  const start = async () => {
    memory = createMemoryStore(pool, cipher, true); online = createOnlineStore(pool, cipher);
    const handler = createRequestHandler({ config, auth: createAuth(config, pool), workspaces: createWorkspaceStore(pool), records: createRecordStore(pool, cipher, true),
      families: createFamilyStore(pool, cipher, true), care: createCareStore(pool, cipher, true), chat: createChatStore(pool, cipher, true), memory, online,
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
    if (expected !== null) assert.equal(response.status, expected);
    return { data: await response.json(), status: response.status, headers: response.headers };
  }
  async function direct(method, ...args) { count("store"); return memory[method](...args); }
  async function directOnline(method, ...args) { count("store"); return online[method](...args); }
  async function expectStoreConflict(method, ...args) { await assert.rejects(direct(method, ...args), isConflict); }
  const users = [];
  await check("synthetic_family", async () => {
    for (let index = 0; index < 3; index++) {
      const email = `memory-${randomUUID()}@example.test`;
      const response = await request(null, "/auth/sign-up/email", { name: `合成記憶成員 ${index}`, email, password: randomBytes(24).toString("hex") });
      users.push({ id: response.data.user.id, email, cookie: response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") });
    }
  });
  const [owner, caregiver, viewer] = users;
  let child, prefix, familyId, ownerMessage, caregiverMessage, sharedFact, careFact, careRecord, terminal, reopened, snoozed, deletedMemoryId, candidateOperation;
  await check("family_roles", async () => {
    child = (await request(owner, "/children", { displayName: "S09 新建合成孩子" }, 201)).data.child;
    prefix = `/children/${child.id}`; familyId = child.workspaceId;
    await request(viewer, `${prefix}/memory/facts`, undefined, 404);
    for (const [person, role] of [[caregiver, "caregiver"], [viewer, "viewer"]]) {
      const space = (await request(owner, "/families")).data.families.find(item => item.id === familyId);
      const invitation = (await request(owner, `/families/${familyId}/invitations`, { email: person.email, role, expectedVersion: space.version }, 201)).data;
      await request(person, "/families/invitations/accept", { token: invitation.token, confirmWorkspaceId: familyId });
    }
  });
  await check("candidate_excluded_and_viewer_private", async () => {
    const command = { path: `/api${prefix}/memory/facts`, payload: factCreate(manual("睡眠候選", "尚待家長確認")) };
    const context = (await request(owner, "/online/context", command)).data;
    candidateOperation = { ...command, operation: { ...context, opId: randomUUID(), deviceId: randomUUID() } };
    const receipts = await Promise.all([request(owner, "/online/submit", candidateOperation), request(owner, "/online/submit", candidateOperation)]);
    assert.deepEqual(receipts[0].data, receipts[1].data);
    const candidate = receipts[0].data.result.fact; count("facts");
    assert.equal((await directOnline("lookup", owner.id, candidateOperation.operation.opId)).result.fact.id, candidate.id);
    const privateFeed = await directOnline("changes", caregiver.id, familyId, context.storageEpoch, "0");
    assert.ok(privateFeed.changes.every(item => item.kind !== "memory"));
    assert.equal(candidate.status, "candidate"); assert.equal(candidate.visibility, "private");
    assert.equal((await direct("context", owner.id, child.id, "private")).facts.some(item => item.id === candidate.id), false);
    assert.equal((await request(caregiver, `${prefix}/memory/facts`)).data.items.some(item => item.id === candidate.id), false);
    assert.equal(await direct("delete", owner.id, child.id, "facts", candidate.id, 1), true);
    assert.equal((await directOnline("lookup", owner.id, candidateOperation.operation.opId)).result, null);
    assert.equal((await directOnline("submit", owner.id, candidateOperation)).result, null);
    const ownTopic = (await request(viewer, `${prefix}/memory/topics`, { title: "私人待辦", note: "合成", visibility: "private", confirmShared: false }, 201)).data.topic; count("topics");
    assert.equal(ownTopic.visibility, "private");
    await request(viewer, `${prefix}/memory/topics`, { title: "不可共享", note: "合成", visibility: "family", confirmShared: true }, 404);
  });
  await check("private_chat_requires_explicit_sharing", async () => {
    ownerMessage = (await request(owner, `${prefix}/messages`, { text: "只屬於本人嘅合成聊天來源" }, 201)).data.message; count("chatMessages");
    const values = { key: "作息", content: "合成已確認作息", source: { kind: "private_chat", description: "家長主動分享", messageId: ownerMessage.id }, validUntil: null };
    const draft = (await request(owner, `${prefix}/memory/facts`, factCreate(values), 201)).data.fact; count("facts");
    await request(owner, `${prefix}/memory/facts/${draft.id}/confirm`, { ...confirmation(1), confirmShared: false }, 400);
    sharedFact = (await request(owner, `${prefix}/memory/facts/${draft.id}/confirm`, confirmation(1))).data.fact;
    assert.equal(sharedFact.visibility, "family"); assert.equal(sharedFact.applicable, true);
    const otherView = (await request(caregiver, `${prefix}/memory/facts`)).data.items.find(item => item.id === draft.id);
    assert.equal(otherView.source.messageId, undefined);
    const familyView = await direct("context", owner.id, child.id, "family");
    assert.equal(familyView.facts.find(item => item.id === draft.id).source.messageId, undefined);
    assert.equal((await request(caregiver, `${prefix}/memory/facts/${draft.id}/history`)).data.revisions.length, 1);
    await request(viewer, `${prefix}/memory/facts/${draft.id}/deactivate`, { expectedVersion: 2, reason: "唯讀" }, 404);
    await request(caregiver, `${prefix}/memory/facts`, factCreate({ ...values, key: "外人聊天" }), 404);
  });
  await check("duplicate_key_and_concurrent_versions", async () => {
    const duplicate = (await request(owner, `${prefix}/memory/facts`, factCreate(manual(" 作息 ", "另一說法")), 201)).data.fact; count("facts");
    await request(owner, `${prefix}/memory/facts/${duplicate.id}/confirm`, confirmation(1), 409);
    deletedMemoryId = duplicate.id;
    await request(owner, `${prefix}/memory/facts/${duplicate.id}/delete`, { expectedVersion: 1, confirmDelete: true });
    const revision = { values: { key: sharedFact.key, content: "合成更新作息", source: sharedFact.source, validUntil: null },
      expectedVersion: sharedFact.version, confirm: true, confirmShared: true, reason: "並發更正" };
    const outcomes = await Promise.all([owner, owner].map(person => request(person, `${prefix}/memory/facts/${sharedFact.id}/revise`, revision, null)));
    assert.deepEqual(outcomes.map(item => item.status).sort(), [200, 409]);
    sharedFact = outcomes.find(item => item.status === 200).data.fact;
  });
  await check("care_source_version_and_invalidation", async () => {
    const care = { text: "合成睡眠觀察", details: emptyCareDetails("sleep"), source: "合成家長觀察", confirmShared: true };
    careRecord = (await request(owner, `${prefix}/care`, care, 201)).data.record; count("careRecords");
    const source = { kind: "care_record", description: "已確認合成記錄", recordId: careRecord.id, version: 1 };
    const draft = (await request(owner, `${prefix}/memory/facts`, factCreate({ key: "睡眠時段", content: "合成摘要", source, validUntil: null }), 201)).data.fact; count("facts");
    careFact = (await request(owner, `${prefix}/memory/facts/${draft.id}/confirm`, confirmation(1))).data.fact;
    await request(owner, `${prefix}/memory/facts`, factCreate({ key: "錯誤記錄版本", content: "合成", source: { ...source, version: 2 }, validUntil: null }), 409);
    const corrected = (await request(owner, `${prefix}/care/${careRecord.id}/revise`, { ...care, text: "合成修訂睡眠觀察", expectedVersion: 1, reason: "更正", confirmShared: true })).data.record;
    assert.equal(corrected.version, 2);
    const stale = (await request(owner, `${prefix}/memory/facts`)).data.items.find(item => item.id === careFact.id);
    assert.equal(stale.sourceState, "changed"); assert.equal(stale.applicable, false);
    assert.equal((await direct("context", owner.id, child.id, "family")).facts.some(item => item.id === careFact.id), false);
  });
  await check("expired_and_inactive_facts", async () => {
    const expired = (await request(owner, `${prefix}/memory/facts`, factCreate(manual("舊事項", "已過期", "2020-01-01T00:00:00Z")), 201)).data.fact; count("facts");
    const expiredSaved = (await request(owner, `${prefix}/memory/facts/${expired.id}/confirm`, confirmation(1))).data.fact;
    assert.equal(expiredSaved.applicable, false);
    const inactive = (await request(owner, `${prefix}/memory/facts`, factCreate(manual("停用事項", "應排除")), 201)).data.fact; count("facts");
    const confirmed = (await request(owner, `${prefix}/memory/facts/${inactive.id}/confirm`, confirmation(1))).data.fact;
    await request(owner, `${prefix}/memory/facts/${inactive.id}/deactivate`, { expectedVersion: confirmed.version, reason: "不再適用" });
    const keys = (await direct("context", owner.id, child.id, "family")).facts.map(item => item.key);
    assert.deepEqual(keys, [sharedFact.key]);
  });
  await check("terminal_topic_and_explicit_reopen", async () => {
    terminal = (await request(owner, `${prefix}/memory/topics`, { title: "已回答的合成問題", note: "合成", visibility: "family", confirmShared: true }, 201)).data.topic; count("topics");
    terminal = (await request(caregiver, `${prefix}/memory/topics/${terminal.id}/change`, { expectedVersion: 1, status: "resolved", note: "已有答案", resumeAfter: null })).data.topic;
    assert.equal(terminal.mayAsk, false);
    await request(owner, `${prefix}/memory/topics/${terminal.id}/change`, { expectedVersion: 2, status: "pending", note: "不應復活", resumeAfter: null }, 409);
    reopened = (await request(owner, `${prefix}/memory/topics/${terminal.id}/reopen`, { expectedVersion: 2, reason: "明確新問題" }, 200)).data.topic; count("topics");
    assert.notEqual(reopened.id, terminal.id); assert.equal(reopened.reopenedFrom, terminal.id);
    assert.equal((await request(viewer, `${prefix}/memory/topics`)).data.items.find(item => item.id === terminal.id).status, "resolved");
  });
  await check("snooze_suppresses_reasking", async () => {
    snoozed = (await request(owner, `${prefix}/memory/topics`, { title: "暫緩的合成問題", note: "合成", visibility: "family", confirmShared: true }, 201)).data.topic; count("topics");
    snoozed = (await request(owner, `${prefix}/memory/topics/${snoozed.id}/change`, {
      expectedVersion: 1, status: "snoozed", note: "下月再問", resumeAfter: new Date(Date.now() + 31 * 86400000).toISOString(),
    })).data.topic;
    assert.equal(snoozed.mayAsk, false);
    const context = await direct("context", caregiver.id, child.id, "family");
    assert.equal(context.topics.find(item => item.id === snoozed.id).mayAsk, false);
    assert.equal(context.topics.find(item => item.id === terminal.id).mayAsk, false);
  });
  let firstSummary, secondSummary;
  await check("summary_exact_first_batch", async () => {
    const second = (await request(owner, `${prefix}/messages`, { text: "合成聊天第二句" }, 201)).data.message; count("chatMessages");
    caregiverMessage = (await request(caregiver, `${prefix}/messages`, { text: "另一家庭成員私人聊天" }, 201)).data.message; count("chatMessages");
    const input = await direct("prepareSummary", owner.id, child.id);
    assert.equal(input.previous, null); assert.equal(input.moreUncovered, false);
    assert.deepEqual(input.messages.map(item => item.id), [ownerMessage.id, second.id]);
    const base = { previousVersion: input.previousVersion, basis: input.basis, coveredMessageIds: input.messages.map(item => item.id), text: "合成第一批摘要" };
    await expectStoreConflict("saveSummary", owner.id, child.id, { ...base, coveredMessageIds: [second.id] });
    await expectStoreConflict("saveSummary", owner.id, child.id, { ...base, coveredMessageIds: [ownerMessage.id, caregiverMessage.id] });
    await assert.rejects(direct("saveSummary", owner.id, child.id, { ...base, taskStatus: "completed" }), isInputError);
    firstSummary = await direct("saveSummary", owner.id, child.id, base); count("summaries");
    assert.deepEqual(firstSummary.coveredMessageIds, base.coveredMessageIds);
  });
  await check("summary_incremental_private_coverage", async () => {
    const third = (await request(owner, `${prefix}/messages`, { text: "合成聊天第三句" }, 201)).data.message; count("chatMessages");
    const fourth = (await request(owner, `${prefix}/messages`, { text: "合成聊天第四句" }, 201)).data.message; count("chatMessages");
    const input = await direct("prepareSummary", owner.id, child.id);
    assert.equal(input.previous.id, firstSummary.id);
    assert.deepEqual(input.messages.map(item => item.id), [third.id, fourth.id]);
    const base = { previousVersion: input.previousVersion, basis: input.basis, coveredMessageIds: input.messages.map(item => item.id), text: "合成第二批增量摘要" };
    await expectStoreConflict("saveSummary", owner.id, child.id, { ...base, previousVersion: 0 });
    const authorityBefore = { facts: (await direct("facts", owner.id, child.id)).items, topics: (await direct("topics", owner.id, child.id)).items };
    secondSummary = await direct("saveSummary", owner.id, child.id, base); count("summaries");
    assert.equal(secondSummary.previousId, firstSummary.id);
    assert.deepEqual((await direct("facts", owner.id, child.id)).items, authorityBefore.facts);
    assert.deepEqual((await direct("topics", owner.id, child.id)).items, authorityBefore.topics);
    assert.equal((await direct("summary", caregiver.id, child.id)).summary, null);
  });
  await check("family_context_and_restart", async () => {
    const family = await direct("context", owner.id, child.id, "family");
    assert.equal(family.summary, null); assert.deepEqual(family.recentMessages, []);
    const privateBefore = await direct("context", owner.id, child.id, "private");
    assert.equal(privateBefore.summary.id, secondSummary.id); assert.deepEqual(privateBefore.recentMessages, []);
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await pool.end(); pool = createPool(config); await start();
    assert.deepEqual(await direct("context", owner.id, child.id, "private"), privateBefore);
    assert.deepEqual(await direct("context", owner.id, child.id, "family"), family);
    assert.equal((await request(owner, `${prefix}/memory/summary`)).data.summary.id, secondSummary.id);
  });
  await check("authority_change_invalidates_summary", async () => {
    sharedFact = (await request(owner, `${prefix}/memory/facts/${sharedFact.id}/revise`, {
      values: { key: sharedFact.key, content: "合成再次更正", source: sharedFact.source, validUntil: null },
      expectedVersion: sharedFact.version, confirm: true, confirmShared: true, reason: "新確認資料",
    })).data.fact;
    assert.equal((await direct("summary", owner.id, child.id)).summary, null);
    assert.equal((await direct("context", owner.id, child.id, "private")).summary, null);
    const input = await direct("prepareSummary", owner.id, child.id);
    const messageIds = [...firstSummary.coveredMessageIds, ...secondSummary.coveredMessageIds];
    assert.equal(input.previous, null);
    assert.deepEqual(input.messages.map(item => item.id), messageIds);
    const rebuilt = await direct("saveSummary", owner.id, child.id, {
      previousVersion: input.previousVersion, basis: input.basis, coveredMessageIds: messageIds, text: "合成重建摘要",
    }); count("summaries");
    assert.equal(rebuilt.previousId, null); assert.equal(rebuilt.version, secondSummary.version + 1);
    assert.equal((await direct("summary", owner.id, child.id)).summary.id, rebuilt.id);
    const summaryRows = (await pool.query("SELECT id,version,invalidated,payload_encrypted FROM conversation_summaries WHERE child_id=$1 AND owner_user_id=$2 ORDER BY version", [child.id, owner.id])).rows;
    assert.deepEqual(summaryRows.map(row => [row.id, row.version, row.invalidated]), [
      [firstSummary.id, firstSummary.version, true], [secondSummary.id, secondSummary.version, true], [rebuilt.id, rebuilt.version, false],
    ]);
    const coverage = (await pool.query("SELECT message_id FROM summary_message_coverage WHERE summary_id=$1", [rebuilt.id])).rows;
    assert.equal(coverage.length, 4);
    assert.deepEqual(coverage.map(row => row.message_id).sort(), [...messageIds].sort());
    for (const sql of [
      "SELECT payload_encrypted FROM memory_facts WHERE child_id=$1",
      "SELECT r.payload_encrypted FROM memory_fact_revisions r JOIN memory_facts f ON f.id=r.fact_id WHERE f.child_id=$1",
      "SELECT payload_encrypted FROM memory_topics WHERE child_id=$1",
      "SELECT r.payload_encrypted FROM memory_topic_revisions r JOIN memory_topics t ON t.id=r.topic_id WHERE t.child_id=$1",
    ]) {
      const rows = (await pool.query(sql, [child.id])).rows;
      assert.ok(rows.length > 0);
      assert.ok(rows.every(row => row.payload_encrypted.startsWith("yb1.")));
    }
    assert.ok(summaryRows.every(row => row.payload_encrypted.startsWith("yb1.")));
  });
  await check("revoke_then_deny", async () => {
    const space = (await request(owner, "/families")).data.families.find(item => item.id === familyId);
    await request(owner, `/families/${familyId}/members/${caregiver.id}`, { role: "revoked", expectedVersion: space.version });
    await request(caregiver, `${prefix}/memory/facts`, undefined, 404);
    await request(caregiver, `${prefix}/messages`, undefined, 404);
    assert.equal(await direct("context", caregiver.id, child.id, "private"), null);
  });
  await check("new_child_cascade_and_prior_rows", async () => {
    assert.equal((await pool.query("SELECT 1 FROM deleted_memories WHERE id=$1 AND child_id=$2", [deletedMemoryId, child.id])).rowCount, 1);
    await request(owner, `${prefix}/delete`, { confirmChildId: child.id });
    assert.equal((await directOnline("lookup", owner.id, candidateOperation.operation.opId)).result, null);
    assert.equal((await directOnline("submit", owner.id, candidateOperation)).result, null);
    for (const table of ["memory_facts", "memory_topics", "conversation_summaries", "deleted_memories", "text_records", "chat_messages"]) {
      assert.equal((await pool.query(`SELECT 1 FROM ${table} WHERE child_id=$1`, [child.id])).rowCount, 0);
    }
    assert.equal((await pool.query("SELECT 1 FROM memory_fact_revisions WHERE fact_id=$1", [sharedFact.id])).rowCount, 0);
    assert.equal((await pool.query("SELECT 1 FROM memory_topic_revisions WHERE topic_id=$1", [terminal.id])).rowCount, 0);
    assert.equal((await pool.query("SELECT 1 FROM summary_message_coverage WHERE summary_id=$1", [secondSummary.id])).rowCount, 0);
    for (const table of ["children", "text_records", "chat_messages"]) {
      for (const row of (await pool.query(`SELECT * FROM ${table}`)).rows) {
        const key = `${table}:${row.id}`, old = prior.get(key);
        assert.ok(old); assert.deepEqual(row, old); prior.delete(key);
      }
    }
    assert.equal(prior.size, 0);
  });
  console.log(JSON.stringify({ result: "passed", checks, ...counts, accountsCreated: 3, childrenCreated: 1,
    migrations: ["008-long-term-memory", "011-memory-online"], existingRowsPreserved: true, deletedOnlyNewChild: true, serverRestarted: true,
    modelCalls: 0, notificationCalls: 0, bodiesLogged: false }));
} catch (error) {
  const code = error?.cause?.code ?? error?.code;
  console.error(JSON.stringify({ result: "failed", step, checks, ...counts,
    errorKind: ["AssertionError", "TypeError", "Error"].includes(error?.name) ? error.name : "OtherError",
    errorCode: typeof code === "string" && /^[A-Z_0-9]{1,40}$/u.test(code) ? code : null, bodiesLogged: false }));
  process.exitCode = 1;
} finally {
  if (server?.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  await pool?.end();
}
