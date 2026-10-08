import assert from "node:assert/strict";
import { installA05FetchGuard, extractA05PdfText } from "./p2-a05-resume.mjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createAuth } from "../server/auth.ts";
import { readServerConfig } from "../server/config.ts";
import { createPool } from "../server/database.ts";
import { createFamilyDocumentStore } from "../server/family-document-store.ts";
import { createCareStore } from "../server/care.ts";
import { createRecordStore } from "../server/records.ts";
import { emptyCareDetails } from "../src/shared/care.ts";
import { createStorageCipher, readSecretKey } from "../server/storage-crypto.ts";
import { FamilyError } from "../server/family-access.ts";

// One explicitly approved local batch. No migration, worker enablement, model,
// notification, browser or cloud operation. First failure preserves its fixtures.
const limits = { accounts: 2, children: 1, documents: 2, businessCalls: 40, pdfRenders: 1 };
const counts = { businessCalls: 0, poolRebuilds: 0, networkAttempts: 0, localDataFetches: 0, pdfRenders: 0 };
const diagnostics = [];
const fixtures = { users: [], emails: [], children: [], documents: [] }, passed = [];
let pool, config, cipher, documents, care, baseline, completed = false, step = "preflight";
const call = async fn => { assert.ok(counts.businessCalls < limits.businessCalls, "Business call cap exceeded"); counts.businessCalls++; return fn(); };
const check = async (name, fn) => { step = name; await fn(); passed.push(name); };
const install = () => { documents = createFamilyDocumentStore(pool, cipher); care = createCareStore(pool, cipher, true); };
const totals = async () => (await pool.query(`SELECT (SELECT count(*)::int FROM children) AS children,
  (SELECT count(*)::int FROM family_documents) AS documents,(SELECT count(*)::int FROM family_document_snapshots) AS snapshots,
  (SELECT count(*)::int FROM text_records) AS records,(SELECT count(*)::int FROM concerns) AS concerns,
  (SELECT count(*)::int FROM concern_events) AS events,(SELECT enabled FROM worker_control WHERE id=1) AS worker_enabled`)).rows[0];
const rejects = (fn, code) => assert.rejects(call(fn), error => error instanceof FamilyError && error.code === code);
async function insertRecords(owner, childId, count, dated) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const workspace = (await client.query("SELECT workspace_id FROM children WHERE id=$1", [childId])).rows[0].workspace_id;
    await client.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [workspace]);
    const ids = [];
    for (let i = 0; i < count; i++) {
      const id = randomUUID(), details = emptyCareDetails("feeding");
      if (dated) details.eventTime = { rawText: "Synthetic Hong Kong event time", at: "2026-07-01T01:00:00Z", timeZone: "Asia/Hong_Kong", precision: "approximate" };
      await client.query(`INSERT INTO text_records(id,child_id,author_user_id,text_encrypted,details_encrypted,confirmed_by,confirmed_at)
        VALUES($1,$2,$3,$4,$5,$3,now())`, [id, childId, owner,
        cipher.encrypt("Synthetic saved feeding " + i, `text_records:${id}:${childId}:${owner}:text`),
        cipher.encrypt(JSON.stringify({ details, source: "Synthetic shared fixture", reason: "Synthetic fixture" }), `care-details:${childId}:${id}:1`)]);
      ids.push(id);
    }
    // Fixture insertion follows the same locked shared-source invalidation path as production stores.
    const { appendOnlineChange } = await import("../server/online-change.ts");
    await appendOnlineChange(client, workspace, "care", childId);
    await client.query("COMMIT"); return ids;
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
try {
  assert.deepEqual(process.argv.slice(2), ["--approved-local-p2-a05"], "Explicit approved entry required");
  const url = new URL(process.env.TEST_DATABASE_URL);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname === "127.0.0.1" && url.port === "5434"
    && url.pathname === "/yuban_s06_test" && !url.search && !url.hash, "Assigned encrypted synthetic database required");
  cipher = createStorageCipher(await readSecretKey(process.env.STORAGE_KEY_FILE));
  config = readServerConfig({ ...process.env, DATABASE_URL: url.toString(), NODE_ENV: "test", AI_ENABLED: "false", BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    SERVER_ORIGIN: "http://127.0.0.1:3099", WEB_ORIGIN: "http://127.0.0.1:3099", PORT: "3099" });
  installA05FetchGuard(counts, diagnostics);
  pool = createPool(config); install();
  await check("reviewed_032_and_paused_worker", async () => {
    const sql = (await readFile(new URL("../server/migrations/032-growth-report-progress.sql", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
    const checksum = (await pool.query("SELECT checksum FROM app_migrations WHERE id='032-growth-report-progress'")).rows[0]?.checksum;
    assert.ok([sql, sql.replace(/\n/g, "\r\n")].map(value => createHash("sha256").update(value).digest("hex")).includes(checksum), "Reviewed 032 must already be applied");
    baseline = await totals(); assert.equal(baseline.worker_enabled, false);
  });
  await check("encrypted_synthetic_sources", async () => {
    const auth = createAuth(config, pool);
    for (let i = 0; i < 2; i++) {
      const email = `p2-a05-${randomUUID()}@example.test`, account = await call(() => auth.api.signUpEmail({ body: { name: `Synthetic P2-A05 ${i}`, email, password: randomBytes(24).toString("hex") }, headers: new Headers({ origin: config.publicOrigin }) }));
      assert.ok(account?.user?.id); fixtures.users.push(account.user.id); fixtures.emails.push(email);
    }
    const child = await call(() => createRecordStore(pool, cipher, true).createChildForUser(fixtures.users[0], { displayName: "P2-A05 合成孩子" })); fixtures.children.push(child.id);
    fixtures.sourceRecords = await insertRecords(fixtures.users[0], child.id, 105, true);
    await insertRecords(fixtures.users[0], child.id, 1, false);
    const id = randomUUID(), owner = fixtures.users[0], at = "2026-09-01T01:00:00Z";
    const concern = { id, childId: child.id, title: "合成持續關注", reason: "Synthetic shared background", status: "following", version: 1,
      createdAt: at, updatedAt: at, archivedAt: null, attentionIds: [] };
    await pool.query("INSERT INTO concerns(id,child_id,created_by,version,status,payload_encrypted,created_at,updated_at) VALUES($1,$2,$3,1,'following',$4,$5,$5)",
      [id, child.id, owner, cipher.encrypt(JSON.stringify(concern), `concern:${child.id}:${id}:${owner}:1`), at]);
    for (let i = 1; i <= 101; i++) {
      const eventId = randomUUID(), event = { id: eventId, actorUserId: owner, at, kind: "observation", title: "Synthetic shared observation", text: "合成觀察 " + i, sourceLabel: "Synthetic shared observation" };
      await pool.query("INSERT INTO concern_events(id,concern_id,sequence,actor_user_id,payload_encrypted) VALUES($1,$2,$3,$4,$5)",
        [eventId, id, i, owner, cipher.encrypt(JSON.stringify(event), `concern:${child.id}:${id}:${owner}:event:${eventId}:${owner}`)]);
    }
  });
  const [owner, other] = fixtures.users, childId = fixtures.children[0];
  const request = { kind: "growth_report", purpose: "family", title: "P2-A05 合成季度", eventDate: null, period: { from: "2026-07-01", to: "2026-09-30" } };
  let item, fixed, authorityVersion, originalChange, originalOp;
  const refresh = async () => {
    originalChange = { action: "refresh", expectedVersion: item.version, authorityVersion }; originalOp = randomUUID();
    item = await call(() => documents.change(owner, childId, item.id, originalChange, originalOp));
  };
  await check("checkpoint_replay_restart_and_complete_period", async () => {
    const opId = randomUUID(); item = await call(() => documents.create(owner, childId, request, opId)); fixtures.documents.push(item.id);
    assert.equal(item.current, null); assert.equal(item.report.phase, "building");
    const checkpoint = (await pool.query("SELECT version,progress_encrypted FROM family_documents WHERE id=$1", [item.id])).rows[0];
    assert.ok(checkpoint.progress_encrypted.startsWith("yb1."));
    assert.deepEqual(await call(() => documents.create(owner, childId, request, opId)), item);
    assert.deepEqual((await pool.query("SELECT version,progress_encrypted FROM family_documents WHERE id=$1", [item.id])).rows[0], checkpoint);
    const workspace = (await pool.query("SELECT w.storage_epoch,w.access_version::text FROM children c JOIN workspaces w ON w.id=c.workspace_id WHERE c.id=$1", [childId])).rows[0];
    authorityVersion = `${workspace.storage_epoch}:${workspace.access_version}`;
    await refresh(); assert.equal(item.report.processedSources, 51);
    await pool.end(); pool = createPool(config); install(); counts.poolRebuilds++;
    while (item.report.phase === "building") await refresh();
    assert.equal(item.report.phase, "complete"); fixed = item.current; assert.ok(fixed);
    assert.equal(fixed.reportCoverage.counts.recordsInPeriod, 105); assert.equal(fixed.reportCoverage.counts.recordsUnknownTime, 1);
    assert.equal(fixed.reportCoverage.counts.observationsInPeriod, 101); assert.equal(fixed.reportCoverage.scanned, 209);
    assert.equal(fixed.reportCoverage.periodKind, "quarter"); assert.ok(fixed.sources.length <= 120);
    assert.equal(fixed.sources.some(source => source.id === "record:" + fixtures.sourceRecords[0]), false, "Correcting an unselected record must still invalidate counts");
    await rejects(() => documents.create(owner, childId, request, randomUUID()), "standard_report_exists");
  });
  await check("same_snapshot_content_pdf_and_isolation", async () => {
    const options = { snapshotId: fixed.id, snapshotVersion: fixed.version, authorityVersion, purpose: "family", includeSources: false, includeRevision: true };
    const snapshot = await call(() => documents.exportSnapshot(owner, childId, item.id, options)); assert.deepEqual(snapshot, fixed);
    const content = await call(() => documents.readContent(owner, childId, item.id, { snapshotId: fixed.id, snapshotVersion: fixed.version, offset: 0 }));
    assert.equal(content.contentKind, "snapshot_json"); assert.equal(content.text, JSON.stringify(fixed).slice(0, 4000));
    const { renderFamilyDocumentPdf } = await import("../server/family-document-pdf.ts");
    const bytes = await renderFamilyDocumentPdf(snapshot, options); counts.pdfRenders++; assert.ok(bytes.length > 1000);
    const extracted = await extractA05PdfText(bytes); assert.ok(extracted.text.replace(/\s/gu, "").includes("期間內記錄105筆"));
    assert.deepEqual(await call(() => documents.exportSnapshot(owner, childId, item.id, options)), snapshot);
    assert.equal(await call(() => documents.get(other, childId, item.id)), null);
    assert.equal(await call(() => documents.readContent(other, childId, item.id, { snapshotId: fixed.id, snapshotVersion: fixed.version, offset: 0 })), null);
  });
  await check("fixed_living_coexist_and_one_active_living", async () => {
    const living = await call(() => documents.create(owner, childId, { ...request, reportMode: "living" }, randomUUID())); fixtures.documents.push(living.id);
    assert.equal(living.report.mode, "living"); assert.equal(living.report.period.to, new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
    await rejects(() => documents.create(owner, childId, { ...request, reportMode: "living", period: { from: "2026-08-01", to: "2026-09-30" } }, randomUUID()), "standard_report_exists");
  });
  await check("unselected_source_correction_hides_archived_aggregate_everywhere", async () => {
    item = await call(() => documents.change(owner, childId, item.id, { action: "archive", expectedVersion: item.version, authorityVersion }, randomUUID()));
    const details = emptyCareDetails("feeding"); details.eventTime = { rawText: "Corrected synthetic date", at: "2026-09-30T16:00:00Z", timeZone: "Asia/Hong_Kong", precision: "approximate" };
    await call(() => care.revise(owner, childId, fixtures.sourceRecords[0], { text: "Corrected synthetic saved feeding", details, source: "Synthetic correction" }, 1, "Synthetic date correction"));
    item = await call(() => documents.get(owner, childId, item.id)); assert.equal(item.current, null); assert.equal(item.report.phase, "needs_update"); assert.deepEqual(item.history, []);
    const content = await call(() => documents.readContent(owner, childId, item.id, { snapshotId: fixed.id, snapshotVersion: fixed.version, offset: 0 }));
    assert.equal(content.contentKind, "redacted_manifest_json"); assert.equal(content.invalidated, true); assert.equal(content.text.includes("105"), false);
    const versions = await call(() => documents.listVersions(owner, childId, item.id)); assert.ok(versions.items.every(value => value.invalidated));
    await rejects(() => documents.exportSnapshot(owner, childId, item.id, { snapshotId: fixed.id, snapshotVersion: fixed.version, authorityVersion, purpose: "family", includeSources: false, includeRevision: false }), "source_changed");
    const replay = await call(() => documents.change(owner, childId, item.id, originalChange, originalOp)); assert.equal(replay.current, null); assert.deepEqual(replay.history, []);
    item = await call(() => documents.change(owner, childId, item.id, { action: "restore", expectedVersion: item.version, authorityVersion }, randomUUID()));
    do { await refresh(); } while (item.report.phase === "building");
    assert.equal(item.report.phase, "complete"); assert.equal(item.current.reportCoverage.counts.recordsInPeriod, 104);
  });
  assert.equal(counts.networkAttempts, 0); assert.equal(counts.pdfRenders, 1); completed = true;
} catch (error) {
  const frames = String(error.stack ?? "").split("\n").slice(1).map(line =>
    /(?:\(|\bat\s+)((?:file:\/\/\/|[A-Za-z]:[\\/]|\/)[^()\r\n]*:\d+:\d+)\)?$/u.exec(line)?.[1]).filter(Boolean).slice(0, 4);
  console.error(JSON.stringify({ status: "failed", step, passed, counts, limits, fixtures, diagnostics, code: error.code ?? error.name, frames,
    message: error instanceof FamilyError ? error.code : error.name === "AssertionError" ? "Assertion failed; see the exact step and frames." : "Acceptance stopped; inspect local diagnostics without exposing secrets." }));
  process.exitCode = 1;
} finally {
  if (completed && pool) {
    for (let i = 0; i < fixtures.users.length; i++) {
      const row = (await pool.query('SELECT email FROM "user" WHERE id=$1', [fixtures.users[i]])).rows[0];
      assert.equal(row?.email, fixtures.emails[i]); assert.ok(row.email.startsWith("p2-a05-") && row.email.endsWith("@example.test"));
      await pool.query('DELETE FROM "user" WHERE id=$1', [fixtures.users[i]]);
    }
    const afterCleanup = await totals(); assert.deepEqual(afterCleanup, baseline);
    console.log(JSON.stringify({ status: "passed", node: process.versions.node, passed, counts, limits, diagnostics, baseline, afterCleanup,
      cleanup: "Only newly created synthetic users and cascading rows removed." }));
  }
  await pool?.end();
}
