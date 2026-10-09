import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Pool } from "pg";
import type { DocumentRequest, DocumentSnapshot, DocumentSource } from "../src/shared/family-documents.ts";
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
  t.mock.module("../server/care.ts", { namedExports: { createCareStore: () => ({ reportSource: async () => ({ profile, records }) }) } });
  t.mock.module("../server/memory.ts", { namedExports: { createMemoryStore: () => ({ context: async (_user: string, _child: string, scope: string) => {
    scopes.push(scope); return { profileApplicable: true, facts: [] };
  } }) } });
  t.mock.module("../server/tasks.ts", { namedExports: { createTaskStore: () => ({ list: async () => ({ items: [] }) }) } });
  t.mock.module("../server/concern-store.ts", { namedExports: { createConcernStore: () => ({ list: async () => ({ items: concerns }) }) } });
  const { buildFamilyDocumentSnapshot, documentSnapshotValid, documentSourceBasis, loadFamilyDocumentSources } = await import("../server/family-document-sources.ts");
  const { createFamilyDocumentStore } = await import("../server/family-document-store.ts");
  let renderedSnapshot: DocumentSnapshot | null = null, afterRender = () => {};
  t.mock.module("../server/family-document-pdf.ts", { namedExports: { renderFamilyDocumentPdf: async (snapshot: DocumentSnapshot) => {
    renderedSnapshot = structuredClone(snapshot); afterRender(); return Buffer.from("synthetic-renderer");
  } } });
  const { handleFamilyDocumentRequest } = await import("../server/family-document-api.ts");
  const cipher = { encrypt: (text: string) => text, decrypt: (text: string) => text } as unknown as StorageCipher;
  const rows = new Map<string, any>(), snapshots = new Map<string, any>(), receipts = new Map<string, any>();
  const queries: string[] = [];
  let gate = Promise.resolve(), duplicateChecks = 0;
  async function query(sql: string, values: any[] = []) {
    queries.push(sql); let result: any[] = [];
    if (sql.includes("SELECT workspace_id FROM children")) result = [{ workspace_id: "synthetic-workspace" }];
    else if (sql.includes("SELECT owner_user_id, access_version")) result = [{ owner_user_id: allowed ? userId : "revoked-owner", access_version: 1 }];
    else if (sql.includes("SELECT 1 FROM children")) result = [{}];
    else if (sql.includes("SELECT storage_epoch")) result = [{ storage_epoch: "synthetic-epoch", access_version: "1" }];
    else if (sql.includes("SELECT * FROM family_document_operations")) result = [receipts.get(values[0] + ":" + values[1])].filter(Boolean);
    else if (sql.includes("SELECT count(*)")) result = [{ count: [...rows.values()].filter(row => row.child_id === values[0]).length }];
    else if (sql.startsWith("SELECT * FROM family_documents WHERE child_id=$1 AND kind=")) {
      duplicateChecks++;
      result = [...rows.values()].filter(row => row.child_id === values[0] && row.kind === "growth_report" && row.status === "active");
    } else if (sql.startsWith("SELECT * FROM family_documents WHERE id=")) result = [...rows.values()].filter(row => row.id === values[0] && row.child_id === values[1]);
    else if (sql.startsWith("SELECT * FROM family_documents WHERE child_id=")) result = [...rows.values()].filter(row => row.child_id === values[0]).slice(0, values[1]);
    else if (sql.startsWith("SELECT * FROM family_document_snapshots")) result = [...snapshots.values()].filter(row => row.document_id === values[0]).sort((a, b) => b.version - a.version).slice(0, values[1]);
    else if (sql.startsWith("SELECT payload_encrypted FROM family_document_snapshots")) result = [...snapshots.values()].filter(row => row.document_id === values[0] && row.id === values[1] && row.version === values[2]);
    else if (sql.startsWith("INSERT INTO family_documents(")) rows.set(values[0], { id: values[0], child_id: values[1], created_by: values[2], version: values[3], kind: values[4], status: values[5], auto_refresh: values[6], payload_encrypted: values[7] });
    else if (sql.startsWith("UPDATE family_documents SET version=")) Object.assign(rows.get(values[0]), { version: values[1], status: values[2], auto_refresh: values[3], payload_encrypted: values[4] });
    else if (sql.startsWith("INSERT INTO family_document_snapshots")) snapshots.set(values[0], { id: values[0], document_id: values[1], version: values[2], payload_encrypted: values[3] });
    else if (sql.startsWith("INSERT INTO family_document_operations")) receipts.set(values[0] + ":" + values[1], { child_id: values[2], storage_epoch: values[3], request_encrypted: values[4], result_encrypted: values[5] });
    else if (sql.startsWith("UPDATE workspaces SET change_seq")) result = [{ change_seq: "1" }];
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
  const load = () => loadFamilyDocumentSources({ query } as any, cipher, userId, childId);
  const change = (item: { id: string; version: number }, action: "archive" | "restore" | "refresh") => store.change(userId, childId, item.id, { action, expectedVersion: item.version, authorityVersion }, randomUUID());
  const exportInput = (snapshot: DocumentSnapshot) => ({ snapshotId: snapshot.id, snapshotVersion: snapshot.version, authorityVersion, purpose: "family" as const, includeSources: false, includeRevision: false });
  const source = (id: string, kind: DocumentSource["kind"], at: string | null): DocumentSource => ({ id, kind, at, resourceId: id, version: 1, label: id, text: id });

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

  await t.test("legacy aggregate snapshots remain exact and stale through read, history, receipt and same-version PDF", async () => {
    concerns = [{ id: "legacy", version: 3, title: "Legacy concern", status: "following", reason: "Synthetic context", events: [
      { id: "old", kind: "observation", at: "2026-09-30T00:00:00Z", text: "Historical prior-period observation" },
      { id: "current", kind: "observation", at: "2026-10-06T00:00:00Z", text: "Historical current-period observation" },
    ] }];
    const spec = request("growth_report", "handoff"), opId = randomUUID();
    const created = (await store.create(userId, childId, spec, opId))!;
    const loaded = await load(), current = created.current!;
    // Exact prior-format fixture; the compatibility path may validate it, never rewrite its stored body.
    const legacySource: DocumentSource = { id: "concern:legacy", resourceId: "legacy", kind: "concern", version: 3, label: "家庭持續關注",
      text: "Legacy concern（關注中）：Synthetic context\n最近最多5項共享觀察：\n2026-09-30T00:00:00Z：Historical prior-period observation\n2026-10-06T00:00:00Z：Historical current-period observation", at: "2026-10-06T00:00:00Z" };
    const oldLoaded = { ...loaded, entries: [...loaded.entries.filter(source => source.kind !== "concern"), legacySource] };
    const legacy = structuredClone(current);
    legacy.sourceBasis = documentSourceBasis(oldLoaded, spec);
    legacy.sources = oldLoaded.entries;
    legacy.sections.find(section => section.id === "concerns")!.items = [{ id: legacySource.id, text: legacySource.text, sourceIds: [legacySource.id] }];
    snapshots.get(legacy.id).payload_encrypted = JSON.stringify(legacy);
    const receipt = receipts.get(userId + ":" + opId);
    receipt.result_encrypted = JSON.stringify({ ...created, current: legacy });
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
    const refreshed = (await change(created, "refresh"))!;
    assert.deepEqual(refreshed.history.find(snapshot => snapshot.id === legacy.id), legacy);
    assert.ok(refreshed.current!.sources.filter(source => source.kind === "concern").every(source => source.id.includes(":observation:")));
    assert.ok(!refreshed.current!.sections.find(section => section.id === "concerns")!.items.some(item => item.text.includes("Historical prior-period")));
    assert.deepEqual(await store.exportSnapshot(userId, childId, created.id, input), legacy);
    (concerns[0] as any).version++;
    assert.equal(documentSnapshotValid(legacy, await load()), false);
    (concerns[0] as any).version--;
    (concerns[0] as any).events[0].text = "Corrected prior observation";
    assert.equal(documentSnapshotValid(legacy, await load()), false);
    concerns = [];
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

  await t.test("PDF route retains the selected old version and rechecks source access after rendering", async () => {
    concerns = [{ id: "pdf-concern", version: 1, title: "Synthetic PDF concern", status: "following", reason: "No observation date", events: [] }];
    const document = (await store.create(userId, childId, request("growth_report", "handoff"), randomUUID()))!;
    const original = document.current!, input = exportInput(original);
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
    afterRender = () => { concerns = []; };
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
    const successIndex = results.findIndex(item => item.status === "fulfilled"), standard = (results[successIndex] as PromiseFulfilledResult<any>).value;
    const checks = duplicateChecks;
    assert.equal((await store.create(userId, childId, request("growth_report", "family"), opIds[successIndex]))!.id, standard.id);
    assert.equal(duplicateChecks, checks, "same-op replay bypasses a new canonical creation check");
    await assert.rejects(store.create(userId, childId, { ...request("growth_report", "family"), title: "Changed" }, opIds[successIndex]), { code: "operation_mismatch" });
    const archived = (await change(standard, "archive"))!;
    const replacement = (await store.create(userId, childId, request("growth_report", "family"), randomUUID()))!;
    await assert.rejects(change(archived, "restore"), { code: "standard_report_exists" });
    assert.deepEqual((await store.get(userId, childId, archived.id))!.current, archived.current);
    assert.equal((await store.get(userId, childId, archived.id))!.status, "archived");
    const quarterly = (await store.create(userId, childId, { ...request("growth_report", "family"), period: { from: "2026-07-01", to: "2026-09-30" } }, randomUUID()))!;
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

