import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { createFamilyDocumentsApi } from "../src/client/family-documents-api.ts";
import { createAuth } from "../server/auth.ts";
import { createCareStore } from "../server/care.ts";
import { createChatStore } from "../server/chat.ts";
import { createMemoryStore } from "../server/memory.ts";
import { readServerConfig } from "../server/config.ts";
import { createPool } from "../server/database.ts";
import { createFamilyDocumentStore } from "../server/family-document-store.ts";
import { FamilyError } from "../server/family-access.ts";
import { createRecordStore } from "../server/records.ts";
import { createProductAgentStore } from "../server/product-agent-store.ts";
import { createStorageCipher, readSecretKey } from "../server/storage-crypto.ts";
import { emptyCareDetails } from "../src/shared/care.ts";

// One primary-reviewed local scenario. No migration, consumer, cron, model, browser,
// embedding or notification is started. The primary owns the sole database executor.
const limits = { accounts: 2, children: 1, businessCalls: 35 };
const counts = { accounts: 0, children: 0, businessCalls: 0, networkAttempts: 0 };
const scene = { userIds: [], childId: null, workspaceId: null, documentIds: [], recordIds: [], runIds: [] };
let pool, step = "preflight", output, generation, workerEnabled = false;
const passed = [], call = async action => { assert.ok(++counts.businessCalls <= limits.businessCalls, "Business call cap exceeded"); return action(); };
const check = async (name, action) => { step = name; await action(); passed.push(name); };
globalThis.fetch = async () => { counts.networkAttempts++; throw new Error("External fetch is outside this scenario"); };
try {
  assert.deepEqual(process.argv.slice(2), ["--approved-local-int-w06"]);
  assert.equal(Number(process.versions.node.split(".")[0]), 24);
  assert.equal(process.env.INT_W06_SCRIPTED_WORKER_ONLY, "true");
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
    const sql = (await readFile(new URL("../server/migrations/028-family-documents.sql", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
    const hashes = [sql, sql.replace(/\n/g, "\r\n")].map(value => createHash("sha256").update(value).digest("hex"));
    const row = (await call(() => pool.query(`SELECT m.checksum,c.enabled,c.generation,
      EXISTS(SELECT 1 FROM family_documents WHERE dirty) AS other_pending FROM app_migrations m
      CROSS JOIN worker_control c WHERE m.id='028-family-documents' AND c.id=1`))).rows[0];
    assert.ok(row && hashes.includes(row.checksum)); assert.equal(row.enabled, false); assert.equal(row.other_pending, false); generation = row.generation;
  });
  const records = createRecordStore(pool, cipher, true), care = createCareStore(pool, cipher, true), memory = createMemoryStore(pool, cipher, true);
  const documents = createFamilyDocumentStore(pool, cipher), chat = createChatStore(pool, cipher, true, true), agent = createProductAgentStore(pool, cipher);
  await check("two_accounts_one_child_shared_and_private_sources", async () => {
    const auth = createAuth(config, pool);
    for (let index = 0; index < limits.accounts; index++) {
      const account = await call(() => auth.api.signUpEmail({ body: { name: `Synthetic INT-W06 ${index}`,
        email: `int-w06-${randomUUID()}@example.test`, password: randomBytes(24).toString("hex") }, headers: new Headers({ origin: config.publicOrigin }) }));
      assert.ok(account?.user?.id); scene.userIds.push(account.user.id); counts.accounts++;
    }
    const child = await call(() => records.createChildForUser(scene.userIds[0], { displayName: "INT-W06 合成驗收孩子" }));
    scene.childId = child.id; scene.workspaceId = child.workspaceId; counts.children++;
    const details = emptyCareDetails("measurement"); details.eventTime = { rawText: "合成已確認時間", at: new Date().toISOString(), timeZone: "Asia/Hong_Kong", precision: "exact" };
    const record = await call(() => care.create(scene.userIds[0], child.id, { text: "INT-W06 合成共享量度原文", source: "合成資料", details }));
    assert.ok(record); scene.recordIds.push(record.id);
    assert.ok(await call(() => memory.createFact(scene.userIds[0], child.id, { intendedVisibility: "private", values: {
      key: "private-only", content: "INT-W06 PRIVATE SENTINEL", source: { kind: "manual", description: "私人合成來源" }, validUntil: null } })));
    assert.equal((await call(() => pool.query("INSERT INTO family_members(workspace_id,user_id,role) VALUES($1,$2,'viewer') RETURNING user_id", [scene.workspaceId, scene.userIds[1]]))).rowCount, 1);
  });
  const [owner, viewer] = scene.userIds, childId = scene.childId, period = { from: "2000-01-01", to: "2100-12-31" };
  let item, authorityVersion, report, request, opId;
  await check("two_distinct_preparation_documents_replay_check_archive", async () => {
    request = { kind: "preparation", purpose: "appointment", title: "INT-W06 合成到診準備", eventDate: null, period }; opId = randomUUID();
    const sourceQuote = "請建立家庭共享到診準備文件";
    const message = await call(() => chat.createUserMessageForUser(owner, childId, "INT-W06 合成驗收：" + sourceQuote + "。")); assert.ok(message);
    const claim = await call(() => agent.claim(owner, childId, { kind: "interactive", reference: message.id }, "product-interactive"));
    assert.ok(claim?.created); scene.runIds.push(claim.runId);
    item = await call(() => agent.writeDocument(claim.scope, claim.runId, opId, sourceQuote, { request })); assert.ok(item); scene.documentIds.push(item.id);
    assert.equal(await call(() => agent.authorize(claim.scope, claim.runId)), true);
    assert.equal(await call(() => agent.finish(claim.scope, { runId: claim.runId, status: "completed", stopReason: null, provenance: null,
      countsKnown: true, text: "合成文件已寫入家庭共享台帳。", citations: [], retrievalMode: "not_used",
      tools: [{ name: "generate_family_document", status: "succeeded", reference: item.id }],
      counts: { modelCalls: 0, toolCalls: 1, queryEmbeddings: 0 }, proposals: [] })), true);
    const other = await call(() => documents.create(owner, childId, { ...request, purpose: "school", title: "INT-W06 合成返學準備" }, randomUUID()));
    assert.ok(other); scene.documentIds.push(other.id); assert.notEqual(other.id, item.id);
    const clientApi = createFamilyDocumentsApi("http://127.0.0.1:3099/api", async () =>
      new Response(JSON.stringify({page: await documents.list(viewer, childId)}), {headers:{"content-type":"application/json"}}));
    const page = await call(() => clientApi.getPage(childId, new AbortController().signal, viewer)); authorityVersion = page.authorityVersion;
    assert.equal(page.items.length, 2); assert.equal(page.canManage, false); assert.equal(page.hasMore, false); assert.equal(JSON.stringify(page).includes("PRIVATE SENTINEL"), false);
    const current = item.current;
    item = await call(() => documents.change(owner, childId, item.id, { action: "check_item", expectedVersion: item.version,
      authorityVersion, sectionId: "checklist", itemId: "template-0", checked: true }, randomUUID()));
    assert.equal(item.current.sections.find(section => section.id === "checklist").items[0].checked, true);
    assert.deepEqual(item.history[0], current); const checkedId = item.current.id;
    item = await call(() => documents.change(owner, childId, item.id, { action: "archive", expectedVersion: item.version, authorityVersion }, randomUUID()));
    assert.equal(item.status, "archived"); assert.equal(item.current.id, checkedId); assert.equal(item.version, 3);
  });
  await check("viewer_reads_cannot_write_revoked_isolation", async () => {
    assert.equal(await call(() => documents.create(viewer, childId, request, randomUUID())), null);
    const row = (await call(() => pool.query(`WITH removed AS (DELETE FROM family_members WHERE workspace_id=$1 AND user_id=$2 RETURNING workspace_id)
      UPDATE workspaces SET access_version=access_version+1 WHERE id IN(SELECT workspace_id FROM removed) RETURNING storage_epoch,access_version::text`, [scene.workspaceId, viewer]))).rows[0];
    assert.ok(row); authorityVersion = row.storage_epoch + ":" + row.access_version;
    assert.equal(await call(() => documents.get(viewer, childId, item.id)), null);
  });
  await check("report_stale_durable_pending_pause_then_refresh", async () => {
    report = await call(() => documents.create(owner, childId, { kind: "growth_report", purpose: "family", title: "INT-W06 合成成長報告", eventDate: null, period }, randomUUID()));
    assert.ok(report); scene.documentIds.push(report.id); assert.equal(report.autoRefresh, true); const oldSnapshot = report.current.id;
    const record = await call(() => care.create(owner, childId, { text: "INT-W06 合成新共享記事（時間未知）", source: "合成資料", details: emptyCareDetails() }));
    assert.ok(record); scene.recordIds.push(record.id);
    report = await call(() => documents.get(owner, childId, report.id)); assert.equal(report.readState, "stale");
    assert.equal(await call(() => documents.refreshPending(generation)), 0);
    assert.equal((await call(() => pool.query(`WITH older_dirty AS (
      UPDATE family_documents SET dirty_generation=gen_random_uuid() WHERE child_id=$2 AND dirty RETURNING id
    ) UPDATE worker_control SET enabled=true WHERE id=1 AND generation=$1 AND enabled=false
      AND NOT EXISTS(SELECT 1 FROM family_documents WHERE dirty AND child_id<>$2) RETURNING id`, [generation, childId]))).rowCount, 1); workerEnabled = true;
    assert.equal(await call(() => documents.refreshPending(generation)), 1);
    report = await call(() => documents.get(owner, childId, report.id)); assert.equal(report.readState, "ready"); assert.notEqual(report.current.id, oldSnapshot);
    assert.ok(report.current.sections.find(section => section.id === "unknown-time").items.some(value => value.sourceIds.includes("record:" + record.id)));
  });
  await check("corrected_source_masks_old_snapshot_and_receipt", async () => {
    const details = emptyCareDetails("measurement"); details.eventTime = { rawText: "合成已確認時間", at: new Date().toISOString(), timeZone: "Asia/Hong_Kong", precision: "exact" };
    assert.ok(await call(() => care.revise(owner, childId, scene.recordIds[0], { text: "INT-W06 合成已更正量度", source: "合成資料", details }, 1, "合成更正")));
    const masked = await call(() => documents.get(owner, childId, report.id)); assert.equal(masked.readState, "invalidated"); assert.equal(masked.current, null);
    assert.equal(JSON.stringify(masked).includes("合成共享量度原文"), false);
    const replay = await call(() => documents.create(owner, childId, request, opId)); assert.equal(replay.id, item.id); assert.equal(replay.current, null);
    assert.equal(JSON.stringify(replay).includes("合成共享量度原文"), false);
    report = await call(() => documents.change(owner, childId, report.id, { action: "refresh", expectedVersion: masked.version, authorityVersion }, randomUUID()));
    assert.equal(report.readState, "ready"); assert.ok(report.current.sources.some(source => source.resourceId === scene.recordIds[0] && source.version === 2));
  });
  await check("exact_export_snapshot_with_current_authority_and_revoked_denial", async () => {
    const input = { snapshotId: report.current.id, snapshotVersion: report.current.version, authorityVersion, purpose: "family", includeSources: true, includeRevision: true };
    assert.deepEqual(await call(() => documents.exportSnapshot(owner, childId, report.id, input)), report.current);
    assert.equal(await call(() => documents.exportSnapshot(viewer, childId, report.id, input)), null);
  });
  await check("encrypted_storage_no_network_and_cleanup", async () => {
    const row = (await call(() => pool.query(`SELECT d.payload_encrypted,
      (SELECT bool_and(payload_encrypted LIKE 'yb1.%') FROM family_document_snapshots WHERE document_id=d.id) AS snapshots_encrypted,
      (SELECT bool_and(request_encrypted LIKE 'yb1.%' AND result_encrypted LIKE 'yb1.%') FROM family_document_operations WHERE child_id=d.child_id) AS operations_encrypted,
      (SELECT state FROM agent_runs WHERE id=$2) AS agent_state
      FROM family_documents d WHERE d.id=$1`, [report.id, scene.runIds[0]]))).rows[0];
    assert.ok(row.payload_encrypted.startsWith("yb1.")); assert.equal(row.snapshots_encrypted, true); assert.equal(row.operations_encrypted, true);
    assert.equal(row.agent_state, "completed");
    assert.equal(counts.networkAttempts, 0);
    assert.equal((await call(() => pool.query("UPDATE worker_control SET enabled=false WHERE id=1 AND generation=$1 RETURNING id", [generation]))).rowCount, 1); workerEnabled = false;
    assert.equal(await call(() => records.deleteChildForUser(owner, childId)), true);
  });
  output = { result: "passed", checks: passed, counts, limits, scene, cleanedChild: true, syntheticAccountsRetained: true,
    realModelCalls: 0, embeddings: 0, externalNotifications: 0, migratedByThisScript: false, actualCronConsumerTested: false, pdfRenderedByThisScript: false };
} catch (error) {
  process.exitCode = 1;
  output = { result: "failed", step, errorKind: error instanceof FamilyError ? error.code : error?.name ?? "Error", checksPassed: passed, counts, limits, preservedScene: scene };
} finally {
  if (workerEnabled) {
    try { await pool.query("UPDATE worker_control SET enabled=false WHERE id=1 AND generation=$1", [generation]); }
    catch { process.exitCode = 1; output = { ...output, result: "failed", restoreDisabledWorkerFailed: true }; }
  }
  try { await pool?.end(); } catch { process.exitCode = 1; output = { ...output, result: "failed", closePoolFailed: true }; }
}
process.stdout.write(JSON.stringify(output) + "\n");
