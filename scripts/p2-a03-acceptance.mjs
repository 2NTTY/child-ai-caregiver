import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createAuth } from "../server/auth.ts";
import { readServerConfig } from "../server/config.ts";
import { createPool } from "../server/database.ts";
import { createFamilyDocumentStore } from "../server/family-document-store.ts";
import { createProductAgentStore } from "../server/product-agent-store.ts";
import { createChatStore } from "../server/chat.ts";
import { createCareStore } from "../server/care.ts";
import { emptyCareDetails } from "../src/shared/care.ts";
import { createRecordStore } from "../server/records.ts";
import { createStorageCipher, readSecretKey } from "../server/storage-crypto.ts";
import { FamilyError } from "../server/family-access.ts";

// Prepared for one explicitly approved local SQL batch. No model, notification,
// browser, migration or cloud operation. First failure preserves only its new fixtures.
const limits = { accounts: 2, children: 1, documents: 3, businessCalls: 60 };
const counts = { accounts: 0, children: 0, documents: 0, businessCalls: 0, poolRebuilds: 0, networkAttempts: 0 };
const fixtures = { users: [], emails: [], children: [], documents: [] };
const passed = [];
let pool, config, cipher, stores, baseline, sourceRecord, step = "preflight", completed = false;
const snapshot = async () => (await pool.query(`SELECT (SELECT count(*)::int FROM children) AS children,
  (SELECT count(*)::int FROM family_documents) AS documents,(SELECT count(*)::int FROM family_document_snapshots) AS versions,
  (SELECT count(*)::int FROM chat_messages) AS messages,(SELECT count(*)::int FROM text_records) AS records,(SELECT enabled FROM worker_control WHERE id=1) AS worker_enabled`)).rows[0];
const call = async fn => { assert.ok(counts.businessCalls < limits.businessCalls, "Business call cap exceeded"); counts.businessCalls++; return fn(); };
const check = async (name, fn) => { step = name; await fn(); passed.push(name); };
const install = () => { stores = { documents: createFamilyDocumentStore(pool, cipher), records: createRecordStore(pool, cipher, true),
  care: createCareStore(pool, cipher, true), agent: createProductAgentStore(pool, cipher), chat: createChatStore(pool, cipher, true, true) }; };
const mismatch = (fn, code) => assert.rejects(call(fn), error => error instanceof FamilyError && error.code === code);
try {
  assert.deepEqual(process.argv.slice(2), ["--approved-local-p2-a03"], "Explicit approved entry required");
  const url = new URL(process.env.TEST_DATABASE_URL);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname === "127.0.0.1" && url.port === "5434"
    && url.pathname === "/yuban_s06_test" && !url.search && !url.hash, "Assigned encrypted synthetic database required");
  assert.ok(process.env.STORAGE_KEY_FILE, "External key file required");
  cipher = createStorageCipher(await readSecretKey(process.env.STORAGE_KEY_FILE));
  config = readServerConfig({ ...process.env, DATABASE_URL: url.toString(), NODE_ENV: "test", AI_ENABLED: "false", BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    SERVER_ORIGIN: "http://127.0.0.1:3099", WEB_ORIGIN: "http://127.0.0.1:3099", PORT: "3099" });
  globalThis.fetch = async () => { counts.networkAttempts++; throw new Error("Network is outside this acceptance"); };
  pool = createPool(config); install();
  await check("existing_migration_and_paused_worker", async () => {
    const sql = (await readFile(new URL("../server/migrations/030-agent-work.sql", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
    const checksum = (await pool.query("SELECT checksum FROM app_migrations WHERE id='030-agent-work'")).rows[0]?.checksum;
    assert.ok([sql, sql.replace(/\n/g, "\r\n")].map(value => createHash("sha256").update(value).digest("hex")).includes(checksum), "Reviewed existing 030 migration is required");
    baseline = await snapshot(); assert.equal(baseline.worker_enabled, false, "Worker must remain paused");
  });
  await check("two_synthetic_accounts_one_child_and_three_documents", async () => {
    const auth = createAuth(config, pool);
    for (let i = 0; i < 2; i++) {
      const email = `p2-a03-${randomUUID()}@example.test`, account = await call(() => auth.api.signUpEmail({ body: { name: `Synthetic P2-A03 ${i}`, email, password: randomBytes(24).toString("hex") }, headers: new Headers({ origin: config.publicOrigin }) }));
      assert.ok(account?.user?.id); fixtures.users.push(account.user.id); fixtures.emails.push(email); counts.accounts++;
    }
    const child = await call(() => stores.records.createChildForUser(fixtures.users[0], { displayName: "P2-A03 合成孩子" })); fixtures.children.push(child.id); counts.children++;
    sourceRecord = await call(() => stores.care.create(fixtures.users[0], child.id, { text: "P2-A03 synthetic shared source before correction", details: emptyCareDetails(), source: "Synthetic parent seed" }));
    for (let i = 0; i < 3; i++) {
      const document = await call(() => stores.documents.create(fixtures.users[0], child.id, { kind: "preparation", purpose: "appointment", title: "P2-A03 合成準備 " + i,
        eventDate: null, period: { from: "2026-10-01", to: "2026-10-31" } }, randomUUID())); fixtures.documents.push(document.id); counts.documents++;
    }
  });
  const [owner, other] = fixtures.users, childId = fixtures.children[0], documentId = fixtures.documents[0];
  let original, changed, submitted, opId;
  await check("long_snapshot_partial_edit_and_fixed_version_continuation", async () => {
    let page = await call(() => stores.documents.describe(owner, childId, documentId));
    original = page.item;
    const longPatch = { action: "patch", expectedVersion: original.version, authorityVersion: page.authorityVersion, confirmShared: true,
      edits: [{ op: "upsert_section", sectionId: "synthetic-long", title: "合成長文", kind: "notes" },
        ...Array.from({ length: 3 }, (_, index) => ({ op: "upsert_item", sectionId: "synthetic-long", itemId: "synthetic-" + index, text: ("合成閱讀資料" + index + "；").repeat(450), sourceIds: [] }))] };
    original = await call(() => stores.documents.change(owner, childId, documentId, longPatch, randomUUID()));
    assert.ok(original.current); assert.ok(JSON.stringify(original.current).length > 7000);
    page = await call(() => stores.documents.describe(owner, childId, documentId));
    let offset = 0, text = "", fixed = original.current;
    do {
      const chunk = await call(() => stores.documents.readContent(owner, childId, documentId, { snapshotId: fixed.id, snapshotVersion: fixed.version, offset }));
      assert.equal(chunk.contentKind, "snapshot_json"); assert.equal(chunk.invalidated, false); assert.ok(chunk.text.length <= 4000); text += chunk.text; offset = chunk.nextOffset;
    } while (offset !== null);
    assert.deepEqual(JSON.parse(text), fixed);
    opId = randomUUID(); submitted = { action: "patch", expectedVersion: original.version, authorityVersion: page.authorityVersion, confirmShared: true,
      edits: [{ op: "upsert_item", sectionId: "synthetic-long", itemId: "synthetic-1", text: "只修改中間這一項", sourceIds: [] },
        { op: "set_metadata", eventDate: "2026-10-19" }] };
    changed = await call(() => stores.documents.change(owner, childId, documentId, submitted, opId));
    assert.equal(changed.id, original.id); assert.equal(changed.version, original.version + 1);
    const before = fixed.sections.find(section => section.id === "synthetic-long"), after = changed.current.sections.find(section => section.id === "synthetic-long");
    assert.deepEqual(after.items[0], before.items[0]); assert.deepEqual(after.items[2], before.items[2]); assert.equal(after.items[1].text, "只修改中間這一項");
    assert.deepEqual(changed.current.period, fixed.period); assert.equal(changed.current.ageLabel, fixed.ageLabel);
    const oldTail = await call(() => stores.documents.readContent(owner, childId, documentId, { snapshotId: fixed.id, snapshotVersion: fixed.version, offset: 4000 }));
    assert.equal(oldTail.text, JSON.stringify(fixed).slice(4000, 8000));
  });
  await check("pool_restart_original_receipt_conflict_and_scoped_pages", async () => {
    await pool.end(); pool = createPool(config); install(); counts.poolRebuilds++;
    assert.equal((await call(() => stores.documents.get(owner, childId, documentId))).version, changed.version);
    const replay = await call(() => stores.documents.change(owner, childId, documentId, submitted, opId)); assert.deepEqual(replay, changed);
    await mismatch(() => stores.documents.change(owner, childId, documentId, submitted, randomUUID()), "document_changed");
    await mismatch(() => stores.documents.change(owner, childId, documentId, { ...submitted, edits: [{ op: "set_metadata", title: "Wrong original operation" }] }, opId), "operation_mismatch");
    const first = await call(() => stores.documents.list(owner, childId, { limit: 2 })); assert.equal(first.items.length, 2); assert.ok(first.nextCursor);
    const second = await call(() => stores.documents.list(owner, childId, { limit: 2, cursor: first.nextCursor })); assert.equal(second.items.length, 1); assert.equal(second.nextCursor, null);
    await mismatch(() => stores.documents.list(owner, childId, { limit: 2, cursor: first.nextCursor, status: "archived" }), "invalid_input");
    assert.equal(await call(() => stores.documents.get(other, childId, documentId)), null);
    assert.equal(await call(() => stores.documents.readContent(other, childId, documentId, { snapshotId: changed.current.id, snapshotVersion: changed.current.version, offset: 0 })), null);
    const versions = await call(() => stores.documents.listVersions(owner, childId, documentId)); assert.equal(versions.items.length, 3);
    assert.ok(versions.items.some(item => item.snapshotId === original.current.id));
  });
  await check("shared_candidate_question_and_single_document_receipt", async () => {
    const message = await call(() => stores.chat.createUserMessageForUser(owner, childId, "請把第一項改為明天帶水樽。"));
    const claim = await call(() => stores.agent.claim(owner, childId, { kind: "interactive", reference: message.id }, "product-interactive"));
    let description = await call(() => stores.documents.describe(owner, childId, documentId));
    const obsolete = await call(() => stores.agent.propose(claim.scope, claim.runId, "obsolete-document-source", { kind: "family_document_change", documentId,
      change: { action: "patch", expectedVersion: changed.version, authorityVersion: description.authorityVersion,
        edits: [{ op: "upsert_item", sectionId: "synthetic-long", itemId: "synthetic-0", text: "Obsolete synthetic source wording", sourceIds: ["record:" + sourceRecord.id] }] } }));
    sourceRecord = await call(() => stores.care.revise(owner, childId, sourceRecord.id,
      { text: "P2-A03 synthetic shared source after correction", details: emptyCareDetails(), source: "Synthetic parent correction" }, sourceRecord.version, "Synthetic source correction"));
    await mismatch(() => stores.agent.decide(owner, childId, claim.runId, obsolete.id, { decision: "accept", expectedVersion: obsolete.version, confirmShared: true }), "source_changed");
    const staleRun = await call(() => stores.agent.get(owner, childId, claim.runId));
    const hidden = staleRun.proposals.find(item => item.id === obsolete.id); assert.equal(hidden.contentState, "invalidated"); assert.equal(hidden.targetLabel, null);
    assert.ok(!JSON.stringify(hidden.value).includes("Obsolete synthetic source wording"));
    await call(() => stores.agent.decide(owner, childId, claim.runId, obsolete.id, { decision: "dismiss", expectedVersion: obsolete.version, confirmShared: false }));
    changed = await call(() => stores.documents.change(owner, childId, documentId, { action: "refresh", expectedVersion: changed.version, authorityVersion: description.authorityVersion }, randomUUID()));
    description = await call(() => stores.documents.describe(owner, childId, documentId));
    const beforeAcceptVersion = changed.version;
    const proposal = await call(() => stores.agent.propose(claim.scope, claim.runId, "synthetic-document-edit", { kind: "family_document_change", documentId,
      change: { action: "patch", expectedVersion: changed.version, authorityVersion: description.authorityVersion,
        edits: [{ op: "upsert_item", sectionId: "synthetic-long", itemId: "synthetic-0", text: "明天帶水樽。", sourceIds: [] }] } }));
    const question = await call(() => stores.agent.requestConfirmation(claim.scope, claim.runId, { runId: claim.runId, proposalId: proposal.id, expectedVersion: proposal.version, workId: null }));
    assert.ok(question.question.includes("共用資料；其他有權照顧者可查看")); assert.ok(question.question.includes("明天帶水樽。"));
    const asked = await call(() => stores.chat.createModelMessageForUser(owner, childId, message.id, question.question));
    await call(() => stores.agent.bindConfirmationQuestion(owner, childId, asked.id));
    const response = await call(() => stores.chat.createUserMessageForUser(owner, childId, "確認"));
    const accepted = await call(() => stores.agent.consumeConfirmation(owner, childId, response.id)); assert.equal(accepted.result.kind, "family_document"); assert.equal(accepted.result.id, documentId);
    assert.deepEqual(await call(() => stores.agent.consumeConfirmation(owner, childId, response.id)), accepted);
    changed = await call(() => stores.documents.get(owner, childId, documentId)); assert.equal(changed.current.sections.find(section => section.id === "synthetic-long").items[0].text, "明天帶水樽。");
    assert.equal(changed.version, beforeAcceptVersion + 1);
  });
  await check("archive_lookup_and_restore_preserve_edits", async () => {
    const description = await call(() => stores.documents.describe(owner, childId, documentId)), fixed = changed.current;
    const archived = await call(() => stores.documents.change(owner, childId, documentId, { action: "archive", expectedVersion: changed.version, authorityVersion: description.authorityVersion }, randomUUID()));
    assert.equal(archived.status, "archived"); assert.deepEqual(archived.current, fixed);
    const history = await call(() => stores.documents.list(owner, childId, { status: "archived", limit: 2 })); assert.deepEqual(history.items.map(item => item.id), [documentId]);
    const restored = await call(() => stores.documents.change(owner, childId, documentId, { action: "restore", expectedVersion: archived.version, authorityVersion: description.authorityVersion }, randomUUID()));
    assert.equal(restored.status, "active"); assert.deepEqual(restored.current, fixed);
    const refreshed = await call(() => stores.documents.change(owner, childId, documentId, { action: "refresh", expectedVersion: restored.version, authorityVersion: description.authorityVersion }, randomUUID()));
    assert.deepEqual(refreshed.current.sections.find(section => section.id === "synthetic-long"), fixed.sections.find(section => section.id === "synthetic-long"));
    assert.equal(refreshed.current.eventDate, fixed.eventDate);
  });
  assert.equal(counts.networkAttempts, 0); assert.equal(counts.poolRebuilds, 1); completed = true;
} catch (error) {
  console.error(JSON.stringify({ status: "failed", step, passed, counts, limits, fixtures, code: error.code ?? error.name,
    message: error.name === "AssertionError" || error instanceof FamilyError ? error.message : "Acceptance stopped; inspect local diagnostics without exposing secrets." }));
  process.exitCode = 1;
} finally {
  if (completed && pool) {
    for (let i = 0; i < fixtures.users.length; i++) {
      const row = (await pool.query('SELECT email FROM "user" WHERE id=$1', [fixtures.users[i]])).rows[0];
      assert.equal(row?.email, fixtures.emails[i]); assert.ok(row.email.startsWith("p2-a03-") && row.email.endsWith("@example.test"));
      await pool.query('DELETE FROM "user" WHERE id=$1', [fixtures.users[i]]);
    }
    const afterCleanup = await snapshot(); assert.deepEqual(afterCleanup, baseline, "Pre-existing totals and paused worker must remain unchanged");
    console.log(JSON.stringify({ status: "passed", baseline, afterCleanup, node: process.versions.node, passed, counts, limits,
      cleanup: "Only newly created synthetic users and their cascading rows removed." }));
  }
  await pool?.end();
}
