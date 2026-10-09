import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Pool } from "pg";
import type { DocumentRequest, DocumentSnapshot, DocumentSource, FamilyDocument } from "../src/shared/family-documents.ts";
import type { StorageCipher } from "../server/storage-crypto.ts";

const childId = "00000000-0000-4000-8000-000000000001", otherChildId = "00000000-0000-4000-8000-000000000002";
const userId = "synthetic-parent", authorityVersion = "synthetic-epoch:1";
const request = (kind: DocumentRequest["kind"] = "preparation", purpose: DocumentRequest["purpose"] = "appointment"): DocumentRequest => ({
  kind, purpose, title: "Synthetic document", eventDate: null, period: { from: "2026-10-01", to: "2026-10-07" },
});

test("document workflow integrity with synthetic sources and a serialized fake Pool", async t => {
  const profile = { childId, version: 1, data: null, confirmedBy: null, confirmedAt: null, reason: null };
  let records: unknown[] = [], concerns: unknown[] = [], allowed = true;
  const scopes: string[] = [];
  const workerGeneration = "00000000-0000-4000-8000-000000000003";
  const checkSourceScope = (actor: string, child: string) => {
    assert.equal(actor, userId); assert.ok([childId, otherChildId].includes(child)); return allowed;
  };
  t.mock.module("../server/care.ts", { namedExports: { createCareStore: () => ({
    profile: async (actor: string, child: string) => checkSourceScope(actor, child) ? { ...profile, childId: child } : null,
    search: async (actor: string, child: string, input: { cursor?: unknown }) => {
      assert.ok(input.cursor == null); assert.ok(records.length <= 50);
      return checkSourceScope(actor, child) ? { records, nextCursor: null, scanned: records.length } : null;
    },
    get: async (actor: string, child: string, id: string) => checkSourceScope(actor, child) ? records.find(value => (value as { id: string }).id === id) ?? null : null,
  }) } });
  t.mock.module("../server/memory.ts", { namedExports: { createMemoryStore: () => ({
    reportFacts: async (actor: string, child: string, after?: string) => {
      assert.equal(after, undefined); scopes.push("family"); return checkSourceScope(actor, child) ? { items: [], nextAfterId: null } : null;
    },
    getFact: async (actor: string, child: string) => { checkSourceScope(actor, child); return null; },
  }) } });
  t.mock.module("../server/tasks.ts", { namedExports: { createTaskStore: () => ({
    list: async (actor: string, child: string, after?: string) => { assert.equal(after, undefined); return checkSourceScope(actor, child) ? { items: [], nextAfterId: null } : null; },
    get: async (actor: string, child: string) => { checkSourceScope(actor, child); return null; },
  }) } });
  t.mock.module("../server/concern-store.ts", { namedExports: { createConcernStore: () => ({
    reportPage: async (actor: string, child: string, after?: { id: string; sequence: number }) => {
      if (!checkSourceScope(actor, child)) return null;
      // Match the real (id, sequence) producer, including headers for concerns with any event kind.
      const all = concerns.flatMap(concern => {
        const value = concern as { id: string; events: unknown[] };
        return [{ concern, event: null as unknown, hasEvents: value.events.length > 0, id: value.id, sequence: 0 },
          ...value.events.map((event, index) => ({ concern, event, hasEvents: true, id: value.id, sequence: index + 1 }))];
      }).sort((a, b) => a.id.localeCompare(b.id) || a.sequence - b.sequence)
        .filter(value => !after || value.id > after.id || value.id === after.id && value.sequence > after.sequence);
      const page = all.slice(0, 100), last = page.at(-1);
      return { items: page.map(({ concern, event, hasEvents }) => ({ concern, event, hasEvents })),
        next: all.length > 100 && last ? { id: last.id, sequence: last.sequence } : null };
    },
    reportReference: async (actor: string, child: string, id: string, eventId?: string) => {
      if (!checkSourceScope(actor, child)) return null;
      const concern = concerns.find(value => (value as { id: string }).id === id);
      if (!concern) return null;
      const events = (concern as { events: { id: string }[] }).events.filter(event => !eventId || event.id === eventId);
      return { concern, events: events.slice(-200), complete: events.length <= 200 };
    },
  }) } });
  const { buildFamilyDocumentSnapshot, documentSnapshotValid, documentSourceBasis, loadFamilyDocumentSources, supplementFamilyDocumentSources } = await import("../server/family-document-sources.ts");
  const { createFamilyDocumentStore } = await import("../server/family-document-store.ts");
  let renderedSnapshot: DocumentSnapshot | null = null, afterRender = () => {};
  t.mock.module("../server/family-document-pdf.ts", { namedExports: { renderFamilyDocumentPdf: async (snapshot: DocumentSnapshot) => {
    renderedSnapshot = structuredClone(snapshot); afterRender(); return Buffer.from("synthetic-renderer");
  } } });
  const { handleFamilyDocumentRequest } = await import("../server/family-document-api.ts");
  const cipher = { encrypt: (text: string) => text, decrypt: (text: string) => text } as unknown as StorageCipher;
  const rows = new Map<string, any>(), snapshots = new Map<string, any>(), receipts = new Map<string, any>();
  const queries: string[] = [];
  let gate = Promise.resolve(), duplicateChecks = 0, changeSequence = 0;
  async function query(sql: string, values: any[] = []) {
    queries.push(sql); let result: any[] = [];
    const text = sql.replace(/\s+/gu, " ").trim();
    switch (text) {
      case "BEGIN": case "COMMIT": case "ROLLBACK":
      case "SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='5s'": break;
      case "SELECT workspace_id FROM children WHERE id=$1":
        result = [childId, otherChildId].includes(values[0]) ? [{ workspace_id: "synthetic-workspace" }] : []; break;
      case "SELECT owner_user_id, access_version FROM workspaces WHERE id=$1 FOR UPDATE":
      case "SELECT owner_user_id, access_version FROM workspaces WHERE id=$1 FOR SHARE":
        assert.equal(values[0], "synthetic-workspace"); result = [{ owner_user_id: allowed ? userId : "revoked-owner", access_version: 1 }]; break;
      case "SELECT role FROM family_members WHERE workspace_id=$1 AND user_id=$2": break;
      case "SELECT 1 FROM children WHERE id=$1 AND workspace_id=$2":
        result = [childId, otherChildId].includes(values[0]) && values[1] === "synthetic-workspace" ? [{}] : []; break;
      case "SELECT storage_epoch,access_version::text FROM workspaces WHERE id=$1":
      case "SELECT w.storage_epoch,w.access_version::text FROM children c JOIN workspaces w ON w.id=c.workspace_id WHERE c.id=$1":
        result = [{ storage_epoch: "synthetic-epoch", access_version: "1" }]; break;
      case "SELECT 1 FROM workspaces WHERE id=$1 AND (owner_user_id=$2 OR EXISTS(SELECT 1 FROM family_members WHERE workspace_id=$1 AND user_id=$2 AND role='caregiver'))":
        result = allowed && values[0] === "synthetic-workspace" && values[1] === userId ? [{}] : []; break;
      case "SELECT pg_advisory_xact_lock(hashtextextended($1,178109))": assert.match(values[0], /^synthetic-parent:/u); break;
      case "SELECT * FROM family_document_operations WHERE user_id=$1 AND op_id=$2": result = [receipts.get(values[0] + ":" + values[1])].filter(Boolean); break;
      case "SELECT count(*)::integer AS count FROM family_documents WHERE child_id=$1 AND status='active'":
        result = [{ count: [...rows.values()].filter(row => row.child_id === values[0] && row.status === "active").length }]; break;
      case "SELECT * FROM family_documents WHERE child_id=$1 AND kind='growth_report' AND status='active' ORDER BY created_at,id":
        duplicateChecks++; result = [...rows.values()].filter(row => row.child_id === values[0] && row.kind === "growth_report" && row.status === "active"); break;
      case "SELECT *,to_char(report_day,'YYYY-MM-DD') AS report_day FROM family_documents WHERE id=$1 AND child_id=$2":
        result = [...rows.values()].filter(row => row.id === values[0] && row.child_id === values[1]); break;
      case "SELECT id,version,payload_encrypted FROM family_document_snapshots WHERE document_id=$1 AND id=$2 AND ($3::integer IS NULL OR version=$3)":
        result = [...snapshots.values()].filter(row => row.document_id === values[0] && row.id === values[1] && (values[2] === null || row.version === values[2])); break;
      case "SELECT id,version,payload_encrypted FROM family_document_snapshots WHERE document_id=$1 AND id IS DISTINCT FROM $2 ORDER BY version DESC LIMIT $3":
        result = [...snapshots.values()].filter(row => row.document_id === values[0] && row.id !== values[1]).sort((a, b) => b.version - a.version).slice(0, values[2]); break;
      case "INSERT INTO family_documents(id,child_id,created_by,version,kind,status,auto_refresh,payload_encrypted, progress_encrypted,report_valid_until,report_day,dirty,dirty_epoch,dirty_generation) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)":
        assert.ok(!rows.has(values[0])); rows.set(values[0], { id: values[0], child_id: values[1], created_by: values[2], version: values[3], kind: values[4], status: values[5], auto_refresh: values[6], payload_encrypted: values[7], progress_encrypted: values[8], report_valid_until: values[9], report_day: values[10], dirty: values[11], dirty_epoch: values[12], dirty_generation: values[13], source_revision: "0" }); break;
      case "UPDATE family_documents SET version=$2,status=$3,auto_refresh=$4,payload_encrypted=$5, progress_encrypted=$6,report_valid_until=$7,report_day=$8,dirty=$9,dirty_epoch=$10,dirty_generation=$11,updated_at=now() WHERE id=$1":
        assert.ok(rows.has(values[0])); Object.assign(rows.get(values[0]), { version: values[1], status: values[2], auto_refresh: values[3], payload_encrypted: values[4], progress_encrypted: values[5], report_valid_until: values[6], report_day: values[7], dirty: values[8], dirty_epoch: values[9], dirty_generation: values[10] }); break;
      case "INSERT INTO family_document_snapshots(id,document_id,version,payload_encrypted) VALUES($1,$2,$3,$4)":
        assert.ok(!snapshots.has(values[0])); snapshots.set(values[0], { id: values[0], document_id: values[1], version: values[2], payload_encrypted: values[3] }); break;
      case "INSERT INTO family_document_operations(user_id,op_id,child_id,storage_epoch,request_encrypted,result_encrypted) VALUES($1,$2,$3,$4,$5,$6)":
        assert.ok(!receipts.has(values[0] + ":" + values[1])); receipts.set(values[0] + ":" + values[1], { child_id: values[2], storage_epoch: values[3], request_encrypted: values[4], result_encrypted: values[5] }); break;
      case "UPDATE workspaces SET change_seq=change_seq+1 WHERE id=$1 RETURNING change_seq::text": result = [{ change_seq: String(++changeSequence) }]; break;
      case "INSERT INTO online_changes(workspace_id,change_seq,kind,child_id,private_user_id,owner_only,deleted) VALUES($1,$2,$3,$4,$5,$6,$7)": assert.equal(values[2], "documents"); break;
      // Unrelated agent-work wakeups are outside this synthetic document-store fixture.
      case "SELECT 1 FROM app_migrations WHERE id='033-agent-work-continuation'": break;
      case "SELECT generation FROM worker_control WHERE id=1": result = [{ generation: workerGeneration }]; break;
      case "UPDATE family_documents d SET dirty=true,dirty_epoch=w.storage_epoch,dirty_generation=c.generation FROM children ch,workspaces w,worker_control c WHERE d.id=$1 AND ch.id=d.child_id AND w.id=ch.workspace_id AND c.id=1":
        Object.assign(rows.get(values[0]), { dirty: true, dirty_epoch: "synthetic-epoch", dirty_generation: workerGeneration }); break;
      case "SELECT id,child_id,created_by FROM family_documents WHERE auto_refresh AND status='active' AND (dirty OR report_valid_until<=now() OR report_day<(now() AT TIME ZONE 'Asia/Hong_Kong')::date) ORDER BY updated_at,id LIMIT 20":
        result = [...rows.values()].filter(row => row.auto_refresh && row.status === "active" && row.dirty).slice(0, 20); break;
      case "SELECT w.owner_user_id FROM children c JOIN workspaces w ON w.id=c.workspace_id WHERE c.id=$1": result = [{ owner_user_id: userId }]; break;
      case "SELECT enabled,generation FROM worker_control WHERE id=1 FOR SHARE": result = [{ enabled: true, generation: workerGeneration }]; break;
      case "UPDATE family_documents SET dirty=false,dirty_epoch=NULL,dirty_generation=NULL WHERE id=$1":
        Object.assign(rows.get(values[0]), { dirty: false, dirty_epoch: null, dirty_generation: null }); break;
      case "UPDATE family_documents SET dirty=false,dirty_epoch=NULL,dirty_generation=NULL,report_valid_until=NULL,report_day=NULL WHERE id=$1":
        Object.assign(rows.get(values[0]), { dirty: false, dirty_epoch: null, dirty_generation: null, report_valid_until: null, report_day: null }); break;
      default: throw new Error("Unexpected synthetic document SQL: " + sql);
    }
    return { rows: structuredClone(result), rowCount: result.length };
  }
  const pool = { query, async connect() {
    let unlock: (() => void) | null = null;
    return { async query(sql: string, values?: any[]) {
      if (sql.includes("FROM workspaces WHERE id=$1 FOR UPDATE")) {
        const previous = gate; gate = new Promise<void>(resolve => { unlock = resolve; }); await previous;
      }
      if (sql.startsWith("SELECT * FROM family_documents WHERE child_id=$1 AND kind=")) assert.ok(unlock, "canonical guard must run under the workspace UPDATE lock");
      try { return await query(sql, values); }
      finally { if (sql === "COMMIT" || sql === "ROLLBACK") { unlock?.(); unlock = null; } }
    }, release() { assert.equal(unlock, null); } };
  } } as unknown as Pool;
  const store = createFamilyDocumentStore(pool, cipher);
  const client = { query } as unknown as import("pg").PoolClient;
  const load = () => loadFamilyDocumentSources(client, cipher, userId, childId);
  const loadReferences = async (snapshot: DocumentSnapshot) => {
    const loaded = await load(); await supplementFamilyDocumentSources(client, cipher, userId, childId, loaded, [snapshot]); return loaded;
  };
  const change = (item: { id: string; version: number }, action: "archive" | "restore" | "refresh") => store.change(userId, childId, item.id, { action, expectedVersion: item.version, authorityVersion }, randomUUID());
  const exportInput = (snapshot: DocumentSnapshot) => ({ snapshotId: snapshot.id, snapshotVersion: snapshot.version, authorityVersion, purpose: "family" as const, includeSources: false, includeRevision: false });
  const source = (id: string, kind: DocumentSource["kind"], at: string | null): DocumentSource => ({ id, kind, at, resourceId: id, version: 1, label: id, text: id });
  const writes = () => queries.filter(sql => /^\s*(INSERT|UPDATE|DELETE)\b/u.test(sql)).length;
  // Synthetic source stores stand in for their already-committed shared-source revision hook.
  const sourceChanged = () => { for (const row of rows.values()) if (row.child_id === childId) row.source_revision = String(Number(row.source_revision) + 1); };
  async function completeReport(item: FamilyDocument | null): Promise<FamilyDocument> {
    assert.ok(item); const id = item.id, child = item.childId;
    for (let batch = 0; batch < 8 && item.report?.phase !== "complete"; batch++) {
      const version: number = item.version, opId = randomUUID();
      // Recreate the store so continuation relies on serialized progress, not an in-memory accumulator.
      const next = await createFamilyDocumentStore(pool, cipher).change(userId, child, id,
        { action: "refresh", expectedVersion: version, authorityVersion }, opId);
      assert.ok(next); assert.equal(next.id, id); assert.equal(next.version, version + 1);
      if (next.current?.reportCoverage && next.report?.phase !== "complete") assert.equal(next.readState, "stale");
      const readWrites = writes(); assert.deepEqual(await store.get(userId, child, id), next); assert.equal(writes(), readWrites);
      item = next;
    }
    assert.equal(item.report?.phase, "complete", "The bounded public continuation must finish");
    assert.equal(item.current?.reportCoverage?.status, "complete"); assert.ok(item.current);
    assert.equal(item.current.version, item.version); assert.equal(item.current.reportCoverage!.sourceRevision, item.report!.sourceRevision); assert.equal(item.readState, "ready");
    return item;
  }
  function seedLegacySnapshot(item: FamilyDocument, snapshot: DocumentSnapshot, opId?: string) {
    assert.ok(item.current); assert.equal(item.report?.phase, "complete");
    assert.equal(snapshot.id, item.current.id); assert.equal(snapshot.version, item.current.version); assert.equal(snapshot.reportCoverage, undefined);
    snapshots.get(snapshot.id).payload_encrypted = JSON.stringify(snapshot);
    if (opId) {
      const receipt = receipts.get(userId + ":" + opId); assert.ok(receipt);
      const { report: _report, ...legacyItem } = item;
      receipt.result_encrypted = JSON.stringify({ ...legacyItem, current: snapshot });
    }
  }

  await t.test("public report creation completes through bounded authorized batches without advancing original receipts", async () => {
    const spec = request("growth_report", "handoff"), opId = randomUUID();
    const created = await store.create(userId, childId, spec, opId);
    assert.ok(created); assert.equal(created.version, 1); assert.equal(created.current, null); assert.equal(created.report?.phase, "building");
    assert.equal(created.report.processedSources, 1);
    assert.deepEqual(await store.operationReceipt(userId, childId, opId), { operationId: opId, documentId: created.id, savedVersion: 1 });
    const writeCount = writes(); assert.deepEqual(await store.create(userId, childId, spec, opId), created); assert.equal(writes(), writeCount);
    const completed = await completeReport(created);
    assert.equal(completed.id, created.id); assert.equal(completed.version, 5); assert.equal(completed.current!.reportCoverage!.scanned, 1);
    const afterCompletion = writes(), replay = await store.create(userId, childId, spec, opId);
    assert.deepEqual(replay, created); assert.equal(writes(), afterCompletion);
    assert.deepEqual(await store.operationReceipt(userId, childId, opId), { operationId: opId, documentId: created.id, savedVersion: 1 });
    assert.equal(await store.operationReceipt(userId, otherChildId, opId), null);
    const receipt = receipts.get(userId + ":" + opId), row = rows.get(created.id);
    receipt.storage_epoch = "previous-epoch"; assert.equal(await store.operationReceipt(userId, childId, opId), null); receipt.storage_epoch = "synthetic-epoch";
    allowed = false;
    assert.equal(await store.get(userId, childId, created.id), null); assert.equal(await store.operationReceipt(userId, childId, opId), null);
    allowed = true;
    row.source_revision = "1"; assert.equal(await store.operationReceipt(userId, childId, opId), null); row.source_revision = "0";
    const validProgress = row.progress_encrypted, snapshotRow = snapshots.get(completed.current!.id), validSnapshot = snapshotRow.payload_encrypted;
    const expired = "2020-01-01T00:00:00Z", progress = JSON.parse(validProgress), snapshot = JSON.parse(validSnapshot);
    progress.validUntil = expired; snapshot.reportCoverage.validUntil = expired;
    row.progress_encrypted = JSON.stringify(progress); snapshotRow.payload_encrypted = JSON.stringify(snapshot);
    assert.equal(await store.operationReceipt(userId, childId, opId), null);
    assert.equal((await store.create(userId, childId, spec, opId))?.report?.phase, "needs_update");
    assert.equal(writes(), afterCompletion);
    row.progress_encrypted = validProgress; snapshotRow.payload_encrypted = validSnapshot;
    assert.equal((await store.get(userId, childId, created.id))?.version, completed.version);
  });

  await t.test("bounded source prefixes distinguish complete action-only groups from unfinished concern headers", async () => {
    const action = (id: string) => ({ id, kind: "confirmed_action", at: "2026-10-06T00:00:00Z", text: "Synthetic action" });
    concerns = [
      { id: "a-action", version: 1, title: "Action only", status: "following", reason: "Synthetic", events: [action("a")] },
      { id: "b-dated", version: 1, title: "Dated", status: "following", reason: "Synthetic", events: [{ id: "observed", kind: "observation", at: "2026-10-06T00:00:00Z", text: "Observed" }] },
      { id: "c-closed", version: 1, title: "Closed", status: "closed", reason: "Synthetic", events: [] },
      { id: "z-next-page", version: 1, title: "Observation on next page", status: "following", reason: "Synthetic", events: [
        ...Array.from({ length: 99 }, (_, i) => action("action-" + i)), { id: "late", kind: "observation", at: "2026-10-06T00:00:00Z", text: "Later page" },
      ] },
    ];
    const loaded = await load(), snapshot = buildFamilyDocumentSnapshot(loaded, request("growth_report", "handoff"), 1, null);
    assert.equal(loaded.limited, true);
    assert.deepEqual(snapshot.sections.find(section => section.id === "undated-concerns")!.items.map(item => item.id), ["concern:a-action"]);
    assert.ok(!loaded.entries.some(source => ["concern:b-dated", "concern:c-closed", "concern:z-next-page"].includes(source.id)));
    assert.deepEqual(snapshot.sections.find(section => section.id === "concerns")!.items.map(item => item.id), ["concern:b-dated:observation:observed"]);
    assert.match(snapshot.coverageNote, /另有共享來源未納入/u); concerns = [];
  });

  async function reachConcernTail(item: FamilyDocument | null): Promise<FamilyDocument> {
    assert.ok(item);
    for (let batch = 0; batch < 6 && !JSON.parse(rows.get(item.id).progress_encrypted).concernAfter; batch++) {
      const previous: FamilyDocument = item;
      item = await createFamilyDocumentStore(pool, cipher).change(userId, item.childId, item.id,
        { action: "refresh", expectedVersion: item.version, authorityVersion }, randomUUID());
      assert.ok(item); assert.equal(item.id, previous.id); assert.equal(item.version, previous.version + 1);
    }
    assert.ok(JSON.parse(rows.get(item.id).progress_encrypted).concernAfter, "The fixture must reach its persisted cross-page boundary");
    assert.equal(item.report?.phase, "building"); return item;
  }

  for (const [kind, observedAt] of [["actions", null], ["later observation", "2026-10-06T00:00:00Z"], ["out-of-period observation", "2026-09-01T00:00:00Z"]] as const) {
    await t.test(`report concern groups resume across pages: ${kind}`, async () => {
      const events = Array.from({ length: 99 }, (_, i) => ({ id: "action-" + i, kind: "confirmed_action", at: "2026-10-06T00:00:00Z", text: "Synthetic action" }));
      events.push({ id: "last-event", kind: observedAt ? "observation" : "confirmed_action", at: observedAt ?? "2026-10-06T00:00:00Z", text: "Last event" });
      concerns = [
        { id: "cross-page", version: 1, title: "Cross-page concern", status: "following", reason: "Synthetic", events },
        { id: "y-closed", version: 1, title: "Closed", status: "closed", reason: "Synthetic", events: [] },
        { id: "z-last", version: 1, title: "Last complete group", status: "following", reason: "Synthetic", events: [] },
      ];
      const partial = await reachConcernTail(await store.create(userId, childId, request("growth_report", "handoff"), randomUUID()));
      const checkpoint = JSON.parse(rows.get(partial.id).progress_encrypted);
      assert.equal(checkpoint.concernScanVersion, 1); assert.equal(checkpoint.pendingConcern.id, "cross-page");
      assert.equal(checkpoint.pendingConcern.sawObservation, false); assert.equal(checkpoint.concernAfter.sequence, 99);
      assert.ok(!checkpoint.selected.some((input: { source: DocumentSource }) => input.source.id === "concern:cross-page"));
      const completed = await completeReport(partial), current = completed.current!;
      assert.deepEqual(current.sections.find(section => section.id === "undated-concerns")!.items.map(item => item.id),
        observedAt ? ["concern:z-last"] : ["concern:cross-page", "concern:z-last"]);
      assert.equal(current.reportCoverage!.scanned, 104);
      assert.equal(current.reportCoverage!.counts.observationsInPeriod, kind === "later observation" ? 1 : 0);
      assert.ok(!current.sources.some(source => source.id === "concern:y-closed"));
      assert.equal(JSON.parse(rows.get(partial.id).progress_encrypted).pendingConcern, undefined);
      concerns = [];
    });
  }

  for (const mode of ["legacy pending", "legacy complete", "inconsistent pending"] as const) {
    await t.test(`${mode} report checkpoints rebuild only in an authorized refresh and retain original receipts`, async () => {
      concerns = [{ id: "old-cross-page", version: 1, title: "Old checkpoint source", status: "following", reason: "Synthetic", events: [
        ...Array.from({ length: 99 }, (_, i) => ({ id: "action-" + i, kind: "confirmed_action", at: "2026-10-06T00:00:00Z", text: "Synthetic action" })),
        { id: "later-observation", kind: "observation", at: "2026-10-06T00:00:00Z", text: "Observed after checkpoint" },
      ] }];
      let item = await reachConcernTail(await store.create(userId, childId, request("growth_report", "handoff"), randomUUID()));
      if (mode === "legacy complete") item = await completeReport(item);
      const completedReceipt = mode === "legacy complete" ? [...receipts.entries()].find(([, value]) => {
        const saved = JSON.parse(value.result_encrypted); return saved.id === item.id && saved.version === item.version;
      }) : undefined;
      const replayComplete = async () => {
        assert.ok(completedReceipt);
        const originalRequest = JSON.parse(completedReceipt[1].request_encrypted);
        return store.change(userId, childId, item.id, originalRequest.change, completedReceipt[0].slice(userId.length + 1));
      };
      const row = rows.get(item.id), legacy = JSON.parse(row.progress_encrypted);
      if (mode === "inconsistent pending") legacy.pendingConcern.id = "different-group";
      else {
        delete legacy.concernScanVersion;
        if (legacy.pendingConcern?.header) legacy.selected.push({ source: legacy.pendingConcern.header, domain: "concerns", activeConcern: true });
        delete legacy.pendingConcern;
      }
      row.progress_encrypted = JSON.stringify(legacy);
      const beforeRead = JSON.stringify(row), previousSnapshot = structuredClone(item.current), readWrites = writes();
      const read = await store.get(userId, childId, item.id);
      assert.ok(read); assert.equal(read.report?.phase, "needs_update"); assert.equal(writes(), readWrites); assert.equal(JSON.stringify(row), beforeRead);
      if (mode === "legacy complete") {
        assert.equal(read.readState, "stale"); assert.deepEqual(read.current, previousSnapshot);
        const replay = await replayComplete(); assert.ok(replay);
        assert.equal(replay.report?.phase, "needs_update"); assert.equal(replay.readState, "stale"); assert.deepEqual(replay.current, previousSnapshot);
        assert.equal(writes(), readWrites); assert.equal(JSON.stringify(row), beforeRead);
      }
      const opId = randomUUID(), input = { action: "refresh" as const, expectedVersion: item.version, authorityVersion };
      const next = await store.change(userId, childId, item.id, input, opId); assert.ok(next);
      assert.equal(next.id, item.id); assert.equal(next.version, item.version + 1);
      if (mode === "legacy complete") {
        assert.equal(next.readState, "stale"); assert.deepEqual(next.current, previousSnapshot);
        const replayWrites = writes(), progressBeforeReplay = row.progress_encrypted, replay = await replayComplete(); assert.ok(replay);
        assert.equal(replay.report?.phase, "building"); assert.equal(replay.readState, "stale"); assert.deepEqual(replay.current, previousSnapshot);
        assert.equal(writes(), replayWrites); assert.equal(row.progress_encrypted, progressBeforeReplay);
      }
      const restarted = JSON.parse(row.progress_encrypted);
      assert.equal(restarted.concernScanVersion, 1); assert.equal(restarted.stage, "records"); assert.equal(restarted.processedSources, 1);
      assert.equal(restarted.concernAfter, undefined); assert.equal(restarted.pendingConcern, undefined);
      assert.ok(restarted.selected.every((value: { source: DocumentSource }) => value.source.kind === "profile"));
      const savedProgress = row.progress_encrypted, replayWrites = writes();
      assert.deepEqual(await store.change(userId, childId, item.id, input, opId), next);
      assert.equal(row.progress_encrypted, savedProgress); assert.equal(row.version, next.version); assert.equal(writes(), replayWrites);
      item = await completeReport(next);
      assert.equal(item.current!.reportCoverage!.scanned, 102); assert.equal(item.current!.reportCoverage!.counts.observationsInPeriod, 1);
      assert.ok(!item.current!.sources.some(source => source.id === "concern:old-cross-page"));
      if (mode === "legacy complete") {
        const oldDone = JSON.parse(row.progress_encrypted); delete oldDone.concernScanVersion;
        Object.assign(row, { progress_encrypted: JSON.stringify(oldDone), dirty: true, dirty_epoch: "synthetic-epoch", dirty_generation: workerGeneration });
        assert.equal(await store.refreshPending(workerGeneration), 1, "Old complete checkpoints cannot take the current-version worker shortcut");
        assert.equal(row.version, item.version + 1); assert.equal(JSON.parse(row.progress_encrypted).stage, "records");
        await completeReport(await store.get(userId, childId, item.id));
      }
      concerns = [];
    });
  }

  await t.test("refresh preserves only matching checklist identity, text and source provenance", async () => {
    const loaded = await load(), first = buildFamilyDocumentSnapshot(loaded, request(), 1, null);
    const items = first.sections.find(section => section.kind === "checklist")!.items;
    items[0].checked = items[1].checked = items[2].checked = true;
    items[1].text = "An older template with a different meaning";
    items[2].sourceIds = ["changed-source"];
    const refreshed = buildFamilyDocumentSnapshot(loaded, request(), 2, first);
    assert.deepEqual(refreshed.sections.find(section => section.kind === "checklist")!.items.map(item => item.checked), [true, false, false]);
    assert.equal(items[0].checked, true); assert.equal(first.version, 1);
    const differentPurpose = buildFamilyDocumentSnapshot(loaded, request("preparation", "school"), 3, first);
    assert.ok(differentPurpose.sections.find(section => section.kind === "checklist")!.items.every(item => !item.checked));
  });

  await t.test("undated active concerns are honest body content while closed and dated out-of-period concerns stay out", async () => {
    concerns = [
      { id: "active", version: 1, title: "Synthetic active concern", status: "following", reason: "No observation yet", events: [] },
      { id: "closed", version: 1, title: "Synthetic closed concern", status: "closed", reason: "No observation", events: [] },
      { id: "outside", version: 1, title: "Synthetic old concern", status: "following", reason: "Outside period", events: [{ id: "outside-event", kind: "observation", at: "2026-09-01T00:00:00Z", text: "Old observation" }] },
      { id: "inside", version: 1, title: "Synthetic current concern", status: "following", reason: "In period", events: [{ id: "inside-event", kind: "observation", at: "2026-10-06T00:00:00Z", text: "Current observation" }] },
    ];
    const loaded = await load();
    loaded.entries.push(source("unknown-record", "record", null));
    const report = buildFamilyDocumentSnapshot(loaded, request("growth_report", "family"), 1, null);
    const undated = report.sections.find(section => section.id === "undated-concerns")!;
    assert.match(undated.title, /未提供觀察日期.*未計入期間/u);
    assert.deepEqual(undated.items.map(item => item.id), ["concern:active"]);
    assert.equal(report.sources.find(item => item.id === "concern:active")!.at, null);
    assert.deepEqual(report.sections.find(section => section.id === "concerns")!.items.map(item => item.id), ["concern:inside:observation:inside-event"]);
    assert.ok(!report.sources.some(item => ["concern:closed", "concern:outside"].includes(item.id)));
    assert.equal(report.sections.find(section => section.id === "unknown-time")!.items[0].id, "unknown-record");
    assert.ok(scopes.every(scope => scope === "family"));
    const revoked = { ...loaded, entries: loaded.entries.filter(item => item.id !== "concern:active") };
    assert.equal(documentSnapshotValid(report, revoked), false);
    concerns = [];
  });

  await t.test("concern observations stay in their own Hong Kong quarter beyond the previous last-five limit", async () => {
    const period = { from: "2026-01-01", to: "2026-03-31" };
    const spec = { ...request("growth_report", "handoff"), period };
    const observation = (id: string, at: string, text = id) => ({ id, kind: "observation", at, text });
    const events = [
      observation("before-quarter", "2025-12-31T15:59:59Z"),
      observation("quarter-start", "2025-12-31T16:00:00Z"),
      observation("february", "2026-02-01T00:00:00Z"),
      observation("quarter-end", "2026-03-31T15:59:59Z"),
      observation("next-quarter", "2026-03-31T16:00:00Z"),
      ...Array.from({ length: 6 }, (_, index) => observation(`april-${index}`, `2026-04-0${index + 1}T00:00:00Z`)),
      { id: "action", kind: "confirmed_action", at: "2026-03-01T00:00:00Z", text: "Not an observation" },
    ];
    concerns = [{ id: "quarter", version: 1, title: "Synthetic concern", status: "following", reason: "Background has no event date", events: events.slice(0, 4) }];
    const first = buildFamilyDocumentSnapshot(await load(), spec, 1, null);
    concerns = [{ ...(concerns[0] as object), version: 2, events }];
    const loaded = await load(), current = buildFamilyDocumentSnapshot(loaded, spec, 2, first);
    const items = current.sections.find(section => section.id === "concerns")!.items;
    assert.deepEqual(items.map(item => item.id), ["quarter-end", "february", "quarter-start"].map(id => `concern:quarter:observation:${id}`));
    assert.deepEqual(items.map(item => item.text), first.sections.find(section => section.id === "concerns")!.items.map(item => item.text));
    assert.ok(items.every(item => item.text.startsWith("關注背景：") && item.text.includes("共享觀察（")));
    assert.ok(!items.some(item => /before-quarter|next-quarter|april-|Not an observation/u.test(item.text)));
    assert.equal(current.sections.find(section => section.id === "undated-concerns")!.items.length, 0);
    assert.ok(!loaded.entries.some(source => source.id === "concern:quarter"));
    assert.deepEqual(current.sources.filter(source => source.kind === "concern").map(source => [source.resourceId, source.version]), [["quarter", 2], ["quarter", 2], ["quarter", 2]]);
    assert.equal(documentSnapshotValid(first, loaded), false, "concern authority versions remain conservative");
    assert.equal(documentSnapshotValid(current, loaded), true);
    const corrected = structuredClone(concerns) as any[];
    corrected[0].events.find((event: any) => event.id === "february").at = "2026-04-01T00:00:00Z";
    concerns = corrected;
    assert.equal(documentSnapshotValid(current, await load()), false, "changed observation dates cannot expose the previous body even without a version bump");
    concerns = [];
    assert.equal(documentSnapshotValid(current, await load()), false);
  });

  await t.test("global 80-source cap selects latest instants across concerns after period filtering", async () => {
    const spec = { ...request("growth_report", "handoff"), period: { from: "2026-01-01", to: "2026-03-31" } };
    const early = Array.from({ length: 85 }, (_, index) => ({ id: `old-${String(index).padStart(2, "0")}`, kind: "observation", at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(), text: `Older observation ${index}` }));
    concerns = [
      { id: "many", version: 1, title: "Many observations", status: "following", reason: "Synthetic", events: early },
      { id: "newer", version: 1, title: "Newer observations", status: "closed", reason: "Synthetic", events: [
        { id: "a", kind: "observation", at: "2026-03-30T23:00:00+08:00", text: "Earlier instant" },
        { id: "b", kind: "observation", at: "2026-03-30T16:00:00Z", text: "Later instant" },
        { id: "c", kind: "observation", at: "2026-03-31T00:00:00+08:00", text: "Equal later instant" },
      ] },
    ];
    const loaded = await load(), snapshot = buildFamilyDocumentSnapshot(loaded, spec, 1, null);
    const selected = snapshot.sources.filter(source => source.at !== null);
    assert.equal(selected.length, 80);
    assert.deepEqual(selected.slice(0, 3).map(source => source.id), ["concern:newer:observation:b", "concern:newer:observation:c", "concern:newer:observation:a"]);
    assert.equal(selected.at(-1)!.id, "concern:many:observation:old-08");
    assert.match(snapshot.coverageNote, /最近80項/u);
    assert.equal(snapshot.sections.find(section => section.id === "concerns")!.items.length, 80);
    const reversed = { ...loaded, entries: [...loaded.entries].reverse() };
    assert.deepEqual(buildFamilyDocumentSnapshot(reversed, spec, 2, null).sources, snapshot.sources);
    concerns = [];
  });

  await t.test("legacy-seeded aggregate snapshots remain exact and stale through read, history, receipt and same-version PDF", async () => {
    concerns = [{ id: "legacy", version: 3, title: "Legacy concern", status: "following", reason: "Synthetic context", events: [
      { id: "old", kind: "observation", at: "2026-09-30T00:00:00Z", text: "Historical prior-period observation" },
      { id: "current", kind: "observation", at: "2026-10-06T00:00:00Z", text: "Historical current-period observation" },
    ] }];
    const spec = request("growth_report", "handoff"), opId = randomUUID();
    const created = await completeReport(await store.create(userId, childId, spec, opId));
    const loaded = await load(), current = { ...buildFamilyDocumentSnapshot(loaded, spec, created.current!.version, null), id: created.current!.id };
    // Exact prior-format fixture; the compatibility path may validate it, never rewrite its stored body.
    const legacySource: DocumentSource = { id: "concern:legacy", resourceId: "legacy", kind: "concern", version: 3, label: "家庭持續關注",
      text: "Legacy concern（關注中）：Synthetic context\n最近最多5項共享觀察：\n2026-09-30T00:00:00Z：Historical prior-period observation\n2026-10-06T00:00:00Z：Historical current-period observation", at: "2026-10-06T00:00:00Z" };
    const oldLoaded = { ...loaded, entries: [...loaded.entries.filter(source => source.kind !== "concern"), legacySource] };
    const legacy = structuredClone(current);
    legacy.sourceBasis = documentSourceBasis(oldLoaded, spec);
    legacy.sources = oldLoaded.entries;
    legacy.sections.find(section => section.id === "concerns")!.items = [{ id: legacySource.id, text: legacySource.text, sourceIds: [legacySource.id] }];
    seedLegacySnapshot(created, legacy, opId);
    assert.equal(legacy.version, created.version); assert.deepEqual(legacy.period, spec.period);
    assert.equal(legacy.sources.find(value => value.id === "concern:legacy")?.text, legacySource.text);
    await supplementFamilyDocumentSources(client, cipher, userId, childId, loaded, [legacy]);
    assert.equal(documentSnapshotValid(legacy, loaded), true);
    assert.notEqual(legacy.sourceBasis, documentSourceBasis(loaded, spec));
    assert.equal(documentSourceBasis({ ...loaded, legacyConcernSources: new Map() }, spec), current.sourceBasis);
    const readable = (await store.get(userId, childId, created.id))!;
    assert.equal(readable.readState, "stale"); assert.deepEqual(readable.current, legacy); assert.deepEqual(readable.history, []);
    assert.deepEqual((await store.create(userId, childId, spec, opId))!.current, legacy);
    const input = exportInput(legacy);
    const pdfRequest = () => new Request(`https://synthetic.invalid/api/children/${childId}/documents/${created.id}/pdf`, {
      method: "POST", headers: { "content-type": "application/json", "x-expected-user-id": userId }, body: JSON.stringify(input),
    });
    assert.equal((await handleFamilyDocumentRequest(pdfRequest(), userId, store, async () => true)).status, 200);
    assert.deepEqual(renderedSnapshot, legacy);
    const refreshed = await completeReport(await change(created, "refresh"));
    assert.deepEqual(refreshed.history.find(snapshot => snapshot.id === legacy.id), legacy);
    assert.ok(refreshed.current!.sources.filter(source => source.kind === "concern").every(source => source.id.includes(":observation:")));
    assert.ok(!refreshed.current!.sections.find(section => section.id === "concerns")!.items.some(item => item.text.includes("Historical prior-period")));
    assert.deepEqual(await store.exportSnapshot(userId, childId, created.id, input), legacy);
    (concerns[0] as any).version++;
    assert.equal(documentSnapshotValid(legacy, await loadReferences(legacy)), false);
    (concerns[0] as any).version--;
    (concerns[0] as any).events[0].text = "Corrected prior observation";
    assert.equal(documentSnapshotValid(legacy, await loadReferences(legacy)), false);
    concerns = []; sourceChanged();
    const invalid = (await store.get(userId, childId, created.id))!;
    assert.equal(invalid.current, null); assert.deepEqual(invalid.history, []);
    assert.equal((await store.create(userId, childId, spec, opId))!.current, null);
    await assert.rejects(store.exportSnapshot(userId, childId, created.id, input), { code: "source_changed" });
    assert.equal((await handleFamilyDocumentRequest(pdfRequest(), userId, store, async () => true)).status, 409);
  });

  await t.test("checked stale preparation archives the exact used snapshot without refresh and stays stale", async () => {
    const created = (await store.create(userId, childId, request(), randomUUID()))!;
    const checked = (await store.change(userId, childId, created.id, { action: "check_item", expectedVersion: created.version, authorityVersion, sectionId: "checklist", itemId: "template-0", checked: true }, randomUUID()))!;
    records = [{ id: "new-record", version: 1, text: "Synthetic added record", details: { kind: "note", eventTime: { at: "2026-10-06T00:00:00Z", precision: "exact" } } }];
    assert.equal((await store.get(userId, childId, created.id))!.readState, "stale");
    await assert.rejects(store.change(userId, childId, checked.id, { action: "check_item", expectedVersion: checked.version, authorityVersion, sectionId: "checklist", itemId: "template-0", checked: false }, randomUUID()), { code: "source_changed" });
    const originalSnapshot = structuredClone(checked.current), snapshotCount = snapshots.size;
    const archived = (await change(checked, "archive"))!;
    assert.equal(archived.status, "archived"); assert.equal(archived.readState, "stale");
    assert.deepEqual(archived.current, originalSnapshot); assert.equal(snapshots.size, snapshotCount);
    assert.equal(archived.current!.sections.find(section => section.kind === "checklist")!.items[0].checked, true);
    const restored = (await change(archived, "restore"))!;
    const refreshed = (await change(restored, "refresh"))!;
    assert.equal(refreshed.readState, "ready");
    assert.equal(refreshed.current!.sections.find(section => section.kind === "checklist")!.items[0].checked, true);
    assert.ok(refreshed.history.some(snapshot => snapshot.id === originalSnapshot!.id));
  });

  await t.test("legacy-seeded PDF route retains the selected old version and rechecks source access after rendering", async () => {
    concerns = [{ id: "pdf-concern", version: 1, title: "Synthetic PDF concern", status: "following", reason: "No observation date", events: [] }];
    const spec = request("growth_report", "handoff");
    const document = await completeReport(await store.create(userId, childId, spec, randomUUID()));
    const original = { ...buildFamilyDocumentSnapshot(await load(), spec, document.current!.version, null), id: document.current!.id };
    seedLegacySnapshot(document, original);
    const input = exportInput(original);
    assert.equal(original.version, document.version); assert.deepEqual(original.period, spec.period);
    const pdfRequest = () => new Request(`https://synthetic.invalid/api/children/${childId}/documents/${document.id}/pdf`, {
      method: "POST", headers: { "content-type": "application/json", "x-expected-user-id": userId }, body: JSON.stringify(input),
    });
    // Added sources leave an exact historical snapshot readable; never silently swap it for the latest.
    concerns.push({ id: "added-concern", version: 1, title: "Synthetic new concern", status: "following", reason: "Added later", events: [] });
    assert.equal((await store.get(userId, childId, document.id))!.readState, "stale");
    const response = await handleFamilyDocumentRequest(pdfRequest(), userId, store, async () => true);
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(renderedSnapshot, original);
    assert.equal(renderedSnapshot!.sections.find(section => section.id === "undated-concerns")!.items[0].id, "concern:pdf-concern");
    afterRender = () => { concerns = []; sourceChanged(); };
    const revoked = await handleFamilyDocumentRequest(pdfRequest(), userId, store, async () => true);
    assert.equal(revoked.status, 409); assert.equal((await revoked.json()).error.code, "source_changed");
    afterRender = () => {};
  });

  await t.test("changed or revoked sources cannot be archived, read through history, receipt or exported", async () => {
    records = [{ id: "revoked-record", version: 1, text: "Synthetic revoked record", details: { kind: "note", eventTime: { at: "2026-10-06T00:00:00Z", precision: "exact" } } }];
    const opId = randomUUID(), created = (await store.create(userId, childId, request(), opId))!;
    const prior = structuredClone(created.current!);
    records = [];
    const invalid = (await store.get(userId, childId, created.id))!;
    assert.equal(invalid.readState, "invalidated"); assert.equal(invalid.current, null); assert.deepEqual(invalid.history, []);
    await assert.rejects(change(created, "archive"), { code: "source_changed" });
    assert.equal((await store.create(userId, childId, request(), opId))!.current, null);
    await assert.rejects(store.exportSnapshot(userId, childId, created.id, exportInput(prior)), { code: "source_changed" });
    assert.equal(await store.exportSnapshot(userId, otherChildId, created.id, exportInput(prior)), null);
    allowed = false; assert.equal(await store.get(userId, childId, created.id), null); allowed = true;
  });

  await t.test("concurrent standard creates with different opIds allow exactly one without deleting existing rows", async () => {
    const opIds = [randomUUID(), randomUUID()], initialCount = rows.size;
    const results = await Promise.allSettled(opIds.map(opId => store.create(userId, childId, request("growth_report", "family"), opId)));
    assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
    const failed = results.find(item => item.status === "rejected") as PromiseRejectedResult;
    assert.equal(failed.reason.code, "standard_report_exists"); assert.equal(rows.size, initialCount + 1);
    const conflict = await handleFamilyDocumentRequest(new Request(`https://synthetic.invalid/api/children/${childId}/documents`, {
      method: "POST", headers: { "content-type": "application/json", "x-expected-user-id": userId },
      body: JSON.stringify({ opId: randomUUID(), request: request("growth_report", "family") }),
    }), userId, store, async () => true);
    assert.equal(conflict.status, 409); assert.equal((await conflict.json()).error.code, "standard_report_exists");
    const successIndex = results.findIndex(item => item.status === "fulfilled"), standard = await completeReport((results[successIndex] as PromiseFulfilledResult<FamilyDocument>).value);
    const checks = duplicateChecks;
    assert.equal((await store.create(userId, childId, request("growth_report", "family"), opIds[successIndex]))!.id, standard.id);
    assert.equal(duplicateChecks, checks, "same-op replay bypasses a new canonical creation check");
    await assert.rejects(store.create(userId, childId, { ...request("growth_report", "family"), title: "Changed" }, opIds[successIndex]), { code: "operation_mismatch" });
    const archived = (await change(standard, "archive"))!;
    const replacement = await completeReport(await store.create(userId, childId, request("growth_report", "family"), randomUUID()));
    await assert.rejects(change(archived, "restore"), { code: "standard_report_exists" });
    assert.deepEqual((await store.get(userId, childId, archived.id))!.current, archived.current);
    assert.equal((await store.get(userId, childId, archived.id))!.status, "archived");
    const quarterly = await completeReport(await store.create(userId, childId, { ...request("growth_report", "family"), period: { from: "2026-07-01", to: "2026-09-30" } }, randomUUID()));
    assert.deepEqual(quarterly.current!.period, { from: "2026-07-01", to: "2026-09-30" });
    await change(replacement, "archive");
    assert.equal((await change(archived, "restore"))!.status, "active");
    assert.deepEqual((await store.get(userId, childId, quarterly.id))!.current!.period, quarterly.current!.period);
    const anotherChild = (await store.create(userId, otherChildId, request("growth_report", "family"), randomUUID()))!;
    assert.notEqual(anotherChild.id, replacement.id);
    for (const spec of [request(), request(), request("growth_report", "handoff"), request("growth_report", "handoff")]) assert.ok(await store.create(userId, childId, spec, randomUUID()));
    assert.ok(!queries.some(sql => /^DELETE /u.test(sql)));
  });
});

