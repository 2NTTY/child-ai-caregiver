import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createFamilyDocumentStore } from "../server/family-document-store.ts";
import { createCareStore } from "../server/care.ts";
import { emptyCareDetails } from "../src/shared/care.ts";
import { canonicalJson } from "../server/online-routing.ts";
import { createStorageCipher, readSecretKey } from "../server/storage-crypto.ts";
import { FamilyError } from "../server/family-access.ts";

const safeFrames = (error, dependencyOnly = false) => String(error.stack ?? "").split("\n").slice(1).map(line =>
  /(?:\(|\bat\s+)((?:file:\/\/\/|[A-Za-z]:[\\/]|\/)[^()\r\n]*:\d+:\d+)\)?$/u.exec(line)?.[1])
  .filter(value => value && (!dependencyOnly || /node_modules[\\/]/u.test(value))).slice(0, 4);

/** data: WASM is an in-memory dependency asset; every actual/unknown network fetch remains blocked. */
export function installA05FetchGuard(counts, diagnostics) {
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const frames = safeFrames(new Error("fetch classification"), true);
    let protocol = "unknown", hostname = "";
    try { const parsed = new URL(typeof input === "string" || input instanceof URL ? input : input.url); protocol = parsed.protocol; hostname = parsed.hostname; } catch {}
    const localData = protocol === "data:" && hostname === "", localAsset = ["file:", "blob:"].includes(protocol);
    diagnostics.push({ protocol, hostname, classification: localData ? "local_data" : localAsset ? "blocked_local_asset" : "blocked_network", frames });
    if (localData) { counts.localDataFetches++; return nativeFetch(input, init); }
    if (localAsset) { counts.blockedLocalAssetFetches = (counts.blockedLocalAssetFetches ?? 0) + 1; throw new Error("Local files require the scoped filesystem loader"); }
    counts.networkAttempts++; throw new Error("Network is outside this acceptance");
  };
}

/** Match the established Node filesystem PDF reader, including resource traversal protection. */
export async function extractA05PdfText(bytes) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.resolve("pdfjs-dist"))), "..");
  const directories = { cMapUrl: resolve(packageRoot, "cmaps"), standardFontDataUrl: resolve(packageRoot, "standard_fonts"), wasmUrl: resolve(packageRoot, "wasm") };
  class LocalBinaryDataFactory {
    async fetch({ kind, filename }) {
      if (!Object.hasOwn(directories, kind) || !/^[a-zA-Z0-9_.-]+$/u.test(filename)) throw new Error("invalid_local_pdf_resource");
      const base = directories[kind], path = resolve(base, filename);
      if (!path.startsWith(base + sep)) throw new Error("invalid_local_pdf_resource");
      return new Uint8Array(await readFile(path));
    }
  }
  const task = getDocument({ data: new Uint8Array(bytes), stopAtErrors: true, useSystemFonts: false, disableFontFace: true,
    useWorkerFetch: false, useWasm: false, disableAutoFetch: true, disableStream: true, disableRange: true, enableXfa: false,
    isEvalSupported: false, verbosity: 0, cMapUrl: directories.cMapUrl + "/", cMapPacked: true,
    standardFontDataUrl: directories.standardFontDataUrl + "/", BinaryDataFactory: LocalBinaryDataFactory });
  try {
    const document = await task.promise; let text = "";
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      try { text += (await page.getTextContent()).items.map(value => value.str ?? "").join(""); } finally { page.cleanup(); }
    }
    return { text, pages: document.numPages };
  } finally { await task.destroy(); }
}

async function resume() {
  const limits = { additionalBusinessCalls: 25, combinedBusinessCalls: 40, additionalPdfRenders: 1, newAccounts: 0, newChildren: 0, newLivingDocuments: 1 };
  const counts = { previousBusinessCalls: 15, businessCalls: 0, previousPdfRenders: 1, pdfRenders: 0, localDataFetches: 0, networkAttempts: 0 };
  const diagnostics = [], passed = [], fixtures = { users: ["Q8aZq59eT6PmgZVqaqtEloU9kl6Vx8fr", "ObQDHGEzl5kfztNhLdCpe9JSlAJQLPtp"],
    child: "7fa6d2cc-2081-4255-ae6e-d4489400f8a0", document: "0b6c2c90-f3db-4ac9-8e1c-0d43b46f91c9", record: "d5decf78-95f6-4894-88be-9393ceb5ddf4" };
  let pool, cipher, documents, care, item, fixed, authorityVersion, originalChange, originalOp, emails, baseline, completed = false, step = "fixture_recovery", pdfEvidence;
  const call = async fn => { assert.ok(counts.businessCalls < limits.additionalBusinessCalls); counts.businessCalls++; return fn(); };
  const check = async (name, fn) => { step = name; await fn(); passed.push(name); };
  const rejects = (fn, code) => assert.rejects(call(fn), error => error instanceof FamilyError && error.code === code);
  const [owner, other] = fixtures.users, childId = fixtures.child, documentId = fixtures.document;
  const nonFixtureTotals = async () => (await pool.query(`SELECT
    (SELECT count(*)::int FROM "user" WHERE id<>ALL($1::text[])) AS users,
    (SELECT count(*)::int FROM workspaces WHERE owner_user_id<>ALL($1::text[])) AS workspaces,
    (SELECT count(*)::int FROM children WHERE id<>$2) AS children,
    (SELECT count(*)::int FROM family_documents WHERE child_id<>$2) AS documents,
    (SELECT count(*)::int FROM family_document_snapshots s JOIN family_documents d ON d.id=s.document_id WHERE d.child_id<>$2) AS snapshots,
    (SELECT count(*)::int FROM family_document_operations WHERE child_id<>$2) AS operations,
    (SELECT count(*)::int FROM text_records WHERE child_id<>$2) AS records,
    (SELECT count(*)::int FROM text_record_revisions r JOIN text_records t ON t.id=r.record_id WHERE t.child_id<>$2) AS record_revisions,
    (SELECT count(*)::int FROM concerns WHERE child_id<>$2) AS concerns,
    (SELECT count(*)::int FROM concern_events e JOIN concerns c ON c.id=e.concern_id WHERE c.child_id<>$2) AS events,
    (SELECT count(*)::int FROM online_changes o JOIN workspaces w ON w.id=o.workspace_id WHERE w.owner_user_id<>ALL($1::text[])) AS online_changes,
    (SELECT enabled FROM worker_control WHERE id=1) AS worker_enabled,
    (SELECT generation FROM worker_control WHERE id=1) AS worker_generation`, [fixtures.users, childId])).rows[0];
  try {
    assert.deepEqual(process.argv.slice(2), ["--approved-local-p2-a05-resume"]); assert.equal(process.versions.node, "24.11.0");
    const log = await readFile(resolve("artifacts/verification/P2_A05_ACCEPTANCE_2026-10-07T22-30-02-570Z.log"), "utf8");
    const previous = JSON.parse(log.split("\n").find(line => line.startsWith('{"status":"failed"')));
    assert.equal(previous.step, "same_snapshot_content_pdf_and_isolation"); assert.equal(previous.counts.businessCalls, 15); assert.equal(previous.counts.pdfRenders, 1);
    assert.deepEqual(previous.fixtures.users, fixtures.users); assert.deepEqual(previous.fixtures.children, [childId]); assert.deepEqual(previous.fixtures.documents, [documentId]);
    assert.equal(previous.fixtures.sourceRecords[0], fixtures.record); emails = previous.fixtures.emails;
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname === "127.0.0.1" && url.port === "5434" && url.pathname === "/yuban_s06_test" && !url.search && !url.hash);
    cipher = createStorageCipher(await readSecretKey(process.env.STORAGE_KEY_FILE)); pool = new pg.Pool({ connectionString: url.toString(), max: 3 });
    pool.on("error", () => console.error("database_connection_error"));
    documents = createFamilyDocumentStore(pool, cipher); care = createCareStore(pool, cipher, true);
    // Recovery is read-only and scoped to the exact original synthetic fixture.
    const accounts = (await pool.query('SELECT id,email FROM "user" WHERE id=ANY($1::text[])', [fixtures.users])).rows;
    assert.equal(accounts.length, 2);
    for (let i = 0; i < fixtures.users.length; i++) { assert.equal(accounts.find(row => row.id === fixtures.users[i])?.email, emails[i]); assert.ok(emails[i].startsWith("p2-a05-") && emails[i].endsWith("@example.test")); }
    const scope = (await pool.query("SELECT w.owner_user_id,w.storage_epoch,w.access_version::text FROM children c JOIN workspaces w ON w.id=c.workspace_id WHERE c.id=$1", [childId])).rows[0];
    assert.equal(scope.owner_user_id, owner); authorityVersion = `${scope.storage_epoch}:${scope.access_version}`;
    const row = (await pool.query("SELECT * FROM family_documents WHERE id=$1 AND child_id=$2 AND created_by=$3", [documentId, childId, owner])).rows[0];
    assert.equal(row.status, "active"); const stored = JSON.parse(cipher.decrypt(row.payload_encrypted, `family-document:${childId}:${documentId}:${owner}:${row.version}`));
    const revisions = (await pool.query("SELECT id,version,payload_encrypted FROM family_document_snapshots WHERE document_id=$1 AND id=$2", [documentId, stored.currentId])).rows;
    assert.equal(revisions.length, 1); const snapshotRow = revisions[0];
    fixed = JSON.parse(cipher.decrypt(snapshotRow.payload_encrypted, `family-document:${childId}:${documentId}:${owner}:snapshot:${snapshotRow.id}:${snapshotRow.version}`));
    assert.equal(fixed.reportCoverage.counts.recordsInPeriod, 105); assert.equal(fixed.reportCoverage.counts.observationsInPeriod, 101);
    assert.equal(fixed.reportCoverage.scanned, 209); assert.equal(fixed.sources.some(source => source.id === "record:" + fixtures.record), false);
    const receipts = (await pool.query("SELECT op_id,storage_epoch,request_encrypted,result_encrypted FROM family_document_operations WHERE user_id=$1 AND child_id=$2 LIMIT 20", [owner, childId])).rows;
    for (const receipt of receipts) {
      const canonical = cipher.decrypt(receipt.request_encrypted, `family-document-operation:${owner}:${childId}:${receipt.op_id}:request`), request = JSON.parse(canonical);
      assert.equal(canonicalJson(request), canonical);
      if (request.id !== documentId || request.change?.action !== "refresh") continue;
      const saved = JSON.parse(cipher.decrypt(receipt.result_encrypted, `family-document-operation:${owner}:${childId}:${receipt.op_id}:result`));
      if (saved.version !== row.version || saved.current?.id !== fixed.id) continue;
      assert.equal(receipt.storage_epoch, scope.storage_epoch); assert.equal(originalOp, undefined);
      originalOp = receipt.op_id; originalChange = request.change; item = saved;
    }
    assert.ok(originalOp && item); assert.deepEqual(item.current, fixed);
    const source = (await pool.query("SELECT child_id,author_user_id,version FROM text_records WHERE id=$1", [fixtures.record])).rows[0];
    assert.deepEqual(source, { child_id: childId, author_user_id: owner, version: 1 });
    baseline = await nonFixtureTotals(); assert.equal(baseline.worker_enabled, false); passed.push("original_fixture_and_successful_receipt_recovered");
    installA05FetchGuard(counts, diagnostics);
    await check("same_snapshot_pdf_and_current_isolation", async () => {
      const options = { snapshotId: fixed.id, snapshotVersion: fixed.version, authorityVersion, purpose: "family", includeSources: false, includeRevision: true };
      const snapshot = await call(() => documents.exportSnapshot(owner, childId, documentId, options)); assert.deepEqual(snapshot, fixed);
      const { renderFamilyDocumentPdf } = await import("../server/family-document-pdf.ts");
      const bytes = await renderFamilyDocumentPdf(snapshot, options); counts.pdfRenders++; assert.ok(bytes.length > 1000);
      const extracted = await extractA05PdfText(bytes); assert.ok(extracted.text.replace(/\s/gu, "").includes("期間內記錄105筆"));
      pdfEvidence = { snapshotId: snapshot.id, snapshotVersion: snapshot.version, bytes: bytes.length, pages: extracted.pages, sha256: createHash("sha256").update(bytes).digest("hex"), countConfirmed: 105 };
      assert.deepEqual(await call(() => documents.exportSnapshot(owner, childId, documentId, options)), snapshot);
      assert.equal(await call(() => documents.get(other, childId, documentId)), null);
      assert.equal(await call(() => documents.readContent(other, childId, documentId, { snapshotId: fixed.id, snapshotVersion: fixed.version, offset: 0 })), null);
    });
    const request = stored.request;
    await check("fixed_living_coexist_and_one_active_living", async () => {
      const living = await call(() => documents.create(owner, childId, { ...request, reportMode: "living" }, randomUUID())); fixtures.livingDocument = living.id;
      assert.equal(living.report.mode, "living"); assert.equal(living.report.period.to, new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
      await rejects(() => documents.create(owner, childId, { ...request, reportMode: "living", period: { from: "2026-08-01", to: "2026-09-30" } }, randomUUID()), "standard_report_exists");
    });
    await check("unselected_correction_hides_archive_content_history_pdf_and_original_receipt", async () => {
      item = await call(() => documents.change(owner, childId, documentId, { action: "archive", expectedVersion: item.version, authorityVersion }, randomUUID()));
      const details = emptyCareDetails("feeding"); details.eventTime = { rawText: "Corrected synthetic date", at: "2026-09-30T16:00:00Z", timeZone: "Asia/Hong_Kong", precision: "approximate" };
      await call(() => care.revise(owner, childId, fixtures.record, { text: "Corrected synthetic saved feeding", details, source: "Synthetic correction" }, 1, "Synthetic date correction"));
      item = await call(() => documents.get(owner, childId, documentId)); assert.equal(item.current, null); assert.equal(item.report.phase, "needs_update"); assert.deepEqual(item.history, []);
      const content = await call(() => documents.readContent(owner, childId, documentId, { snapshotId: fixed.id, snapshotVersion: fixed.version, offset: 0 }));
      assert.equal(content.contentKind, "redacted_manifest_json"); assert.equal(content.invalidated, true); assert.equal(content.text.includes("105"), false);
      const versions = await call(() => documents.listVersions(owner, childId, documentId)); assert.ok(versions.items.every(value => value.invalidated));
      await rejects(() => documents.exportSnapshot(owner, childId, documentId, { snapshotId: fixed.id, snapshotVersion: fixed.version, authorityVersion, purpose: "family", includeSources: false, includeRevision: false }), "source_changed");
      const replay = await call(() => documents.change(owner, childId, documentId, originalChange, originalOp)); assert.equal(replay.current, null); assert.deepEqual(replay.history, []);
      item = await call(() => documents.change(owner, childId, documentId, { action: "restore", expectedVersion: item.version, authorityVersion }, randomUUID()));
      do { item = await call(() => documents.change(owner, childId, documentId, { action: "refresh", expectedVersion: item.version, authorityVersion }, randomUUID())); } while (item.report.phase === "building");
      assert.equal(item.report.phase, "complete"); assert.equal(item.current.reportCoverage.counts.recordsInPeriod, 104);
    });
    assert.equal(counts.networkAttempts, 0); assert.equal(counts.pdfRenders, 1); assert.ok(counts.previousBusinessCalls + counts.businessCalls <= 40);
    step = "exact_original_fixture_cleanup";
    const cleanup = await pool.connect();
    try {
      await cleanup.query("BEGIN");
      for (let i = 0; i < fixtures.users.length; i++) {
        const row = (await cleanup.query('SELECT email FROM "user" WHERE id=$1 FOR UPDATE', [fixtures.users[i]])).rows[0];
        assert.equal(row?.email, emails[i]); await cleanup.query('DELETE FROM "user" WHERE id=$1', [fixtures.users[i]]);
      }
      await cleanup.query("COMMIT");
    } catch (error) { await cleanup.query("ROLLBACK"); throw error; } finally { cleanup.release(); }
    const afterCleanup = await nonFixtureTotals(); assert.deepEqual(afterCleanup, baseline);
    assert.equal((await pool.query("SELECT 1 FROM children WHERE id=$1", [childId])).rowCount, 0); passed.push("exact_original_fixture_cleanup"); completed = true;
    console.log(JSON.stringify({ status: "passed", node: process.versions.node, passed, counts, combinedBusinessCalls: counts.previousBusinessCalls + counts.businessCalls,
      combinedPdfRenders: counts.previousPdfRenders + counts.pdfRenders, limits, diagnostics, pdfEvidence, baseline, afterCleanup,
      cleanup: "Exact original synthetic users and their cascading rows removed; nonfixture totals and paused worker unchanged." }));
  } catch (error) {
    console.error(JSON.stringify({ status: "failed", step, passed, counts, limits, fixtures, diagnostics, code: error.code ?? error.name, frames: safeFrames(error),
      message: error instanceof FamilyError ? error.code : error.name === "AssertionError" ? "Assertion failed; see the exact step and frames." : "Resume stopped; inspect scoped local diagnostics without exposing secrets.", cleanupCompleted: completed }));
    process.exitCode = 1;
  } finally { await pool?.end(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await resume();
