import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import { documentChangeSchema, documentExportSchema, documentRequestSchema,
  documentListQuerySchema, documentContentQuerySchema, documentPatchSchema, type DocumentContentQuery, type DocumentContentPage, type DocumentVersionPage, type DocumentPatch, type DocumentListQuery, type DocumentChange, type DocumentExport, type DocumentPage, type DocumentRequest, type DocumentSnapshot, type FamilyDocument, type ReportProgress } from "../src/shared/family-documents.ts";
import { FamilyError, READ_ROLES, WRITE_ROLES, withChildAccess } from "./family-access.ts";
import type { StorageCipher } from "./storage-crypto.ts";
import { canonicalJson } from "./online-routing.ts";
import { appendOnlineChange } from "./online-change.ts";
import { buildFamilyDocumentSnapshot, emptyFamilyDocumentSources, documentSnapshotValid, documentSourceBasis, loadFamilyDocumentSources, supplementFamilyDocumentSources, type FamilyDocumentSources } from "./family-document-sources.ts";

import { applyFamilyDocumentPatch } from "./family-document-edits.ts";
import { advanceReportBatch, completeReportSnapshot, currentConcernScan, effectiveReportRequest, newReportAccumulator, reportPeriodKind, reportToday, type ReportAccumulator } from "./family-document-reports.ts";
import { decodeDocumentCursor, encodeDocumentCursor, documentManifest, sliceDocumentContent } from "./family-document-reading.ts";

interface Row { kind: DocumentRequest["kind"]; id: string; child_id: string; created_by: string; version: number; payload_encrypted: string;
  dirty: boolean; dirty_epoch: string | null; dirty_generation: string | null; source_revision: string; progress_encrypted: string | null; report_valid_until?: Date | null; report_day?: string | null }
interface Stored { request: DocumentRequest; currentId: string | null; status: FamilyDocument["status"]; archivedAt: string | null; autoRefresh: boolean }
const context = (row: Pick<Row, "id" | "child_id" | "created_by">) => `family-document:${row.child_id}:${row.id}:${row.created_by}`;
const receiptContext = (userId: string, childId: string, opId: string, field: string) => `family-document-operation:${userId}:${childId}:${opId}:${field}`;
const changed = () => new FamilyError(409, "document_changed"), missing = () => new FamilyError(404, "not_found");
const MAX_DOCUMENTS = 50, MAX_HISTORY = 10;

/** Family shared derived snapshots; canonical stores remain the sole source authority. */
export function createFamilyDocumentStore(pool: Pool, cipher: StorageCipher) {
  const access = <T>(userId: string, childId: string, write: boolean, operation: (client: PoolClient, workspaceId: string, canManage: boolean) => Promise<T>) =>
    withChildAccess(pool, userId, childId, write ? WRITE_ROLES : READ_ROLES,
      (client, role, workspaceId) => operation(client, workspaceId, WRITE_ROLES.includes(role)), true);
  async function authority(client: PoolClient, workspaceId: string) {
    const row = (await client.query<{ storage_epoch: string; access_version: string }>("SELECT storage_epoch,access_version::text FROM workspaces WHERE id=$1", [workspaceId])).rows[0];
    return { epoch: row.storage_epoch, version: row.storage_epoch + ":" + row.access_version };
  }
  const decode = (row: Row) => JSON.parse(cipher.decrypt(row.payload_encrypted, context(row) + ":" + row.version)) as Stored;
  async function find(client: PoolClient, childId: string, id: string) {
    return (await client.query<Row>("SELECT *,to_char(report_day,'YYYY-MM-DD') AS report_day FROM family_documents WHERE id=$1 AND child_id=$2", [id, childId])).rows[0];
  }
  async function revision(client: PoolClient, row: Row, id: string | null, version?: number): Promise<DocumentSnapshot | null> {
    if (!id) return null;
    const snapshot = (await client.query<{ id: string; version: number; payload_encrypted: string }>(
      "SELECT id,version,payload_encrypted FROM family_document_snapshots WHERE document_id=$1 AND id=$2 AND ($3::integer IS NULL OR version=$3)", [row.id, id, version ?? null])).rows[0];
    return snapshot ? JSON.parse(cipher.decrypt(snapshot.payload_encrypted, context(row) + ":snapshot:" + snapshot.id + ":" + snapshot.version)) : null;
  }
  async function snapshots(client: PoolClient, row: Row, currentId: string | null) {
    const current = await revision(client, row, currentId);
    const rows = (await client.query<{ id: string; version: number; payload_encrypted: string }>(
      "SELECT id,version,payload_encrypted FROM family_document_snapshots WHERE document_id=$1 AND id IS DISTINCT FROM $2 ORDER BY version DESC LIMIT $3", [row.id, currentId, MAX_HISTORY])).rows;
    const history = rows.map(snapshot => JSON.parse(cipher.decrypt(snapshot.payload_encrypted, context(row) + ":snapshot:" + snapshot.id + ":" + snapshot.version)) as DocumentSnapshot);
    return { current, history };
  }
  const progress = (row: Row): ReportAccumulator | null => row.progress_encrypted
    ? JSON.parse(cipher.decrypt(row.progress_encrypted, context(row) + ":progress")) : null;
  async function scopedSources(client: PoolClient, row: Row, loaded: FamilyDocumentSources): Promise<FamilyDocumentSources> {
    const scope = (await client.query<{ storage_epoch: string; access_version: string }>(
      "SELECT w.storage_epoch,w.access_version::text FROM children c JOIN workspaces w ON w.id=c.workspace_id WHERE c.id=$1", [row.child_id])).rows[0];
    return { ...loaded, sourceRevision: `${scope.storage_epoch}:${scope.access_version}:${row.source_revision}` };
  }
  function safe(item: FamilyDocument, stored: Stored, loaded: FamilyDocumentSources, state: ReportAccumulator | null): FamilyDocument {
    const valid = item.current && documentSnapshotValid(item.current, loaded);
    let report: ReportProgress | undefined;
    if (stored.request.kind === "growth_report") {
      const matching = state !== null && currentConcernScan(state) && state.sourceRevision === loaded.sourceRevision && (state.validUntil === null || Date.parse(state.validUntil) > Date.now());
      const effective = effectiveReportRequest(stored.request), period = matching ? state.request.period : effective.period;
      const due = stored.request.reportMode === "living" && period.to !== effective.period.to;
      report = { mode: stored.request.reportMode ?? "fixed", phase: matching && state.stage !== "done" && !state.blocked && !due ? "building"
        : valid && item.current?.reportCoverage && currentConcernScan(state) && !state?.blocked && !due ? "complete" : "needs_update",
        processedSources: matching && !due ? state.processedSources : 0, sourceRevision: loaded.sourceRevision!,
        periodKind: reportPeriodKind(period), period, title: valid ? item.current!.title : stored.request.title };
    }
    return { ...item, ...(report ? { report } : {}), current: valid ? item.current : null, ...(item.current ? { manifest: documentManifest(item.current, !valid) } : {}),
      history: item.history.filter(snapshot => documentSnapshotValid(snapshot, loaded)).slice(0, MAX_HISTORY),
      readState: !valid ? "invalidated" : item.current!.reportCoverage ? report?.phase === "complete" ? "ready" : "stale" : item.current!.sourceBasis !== documentSourceBasis(loaded, stored.request) ? "stale" : "ready" };
  }
  async function result(client: PoolClient, row: Row, loaded: FamilyDocumentSources, userId: string): Promise<FamilyDocument> {
    const stored = decode(row), revisions = await snapshots(client, row, stored.currentId), scoped = await scopedSources(client, row, loaded);
    await supplementFamilyDocumentSources(client, cipher, userId, row.child_id, scoped,
      [...(revisions.current ? [revisions.current] : []), ...revisions.history].filter(snapshot => !snapshot.reportCoverage));
    return safe({ id: row.id, childId: row.child_id, kind: stored.request.kind, purpose: stored.request.purpose, version: row.version,
      status: stored.status, archivedAt: stored.archivedAt, autoRefresh: stored.autoRefresh, ...revisions, readState: "ready" }, stored, scoped, progress(row));
  }
  async function reportBatch(client: PoolClient, workspaceId: string, userId: string, row: Row, stored: Stored,
    previous: DocumentSnapshot | null, loaded: FamilyDocumentSources): Promise<DocumentSnapshot | undefined> {
    const eligible = (await client.query("SELECT 1 FROM workspaces WHERE id=$1 AND (owner_user_id=$2 OR EXISTS(SELECT 1 FROM family_members WHERE workspace_id=$1 AND user_id=$2 AND role='caregiver'))", [workspaceId, row.created_by])).rowCount;
    if (!eligible) throw new FamilyError(409, "source_changed");
    const scoped = await scopedSources(client, row, loaded), request = effectiveReportRequest(stored.request);
    let state = progress(row);
    if (!state || !currentConcernScan(state) || state.blocked || state.stage === "done" || state.sourceRevision !== scoped.sourceRevision || state.request.period.to !== request.period.to
      || state.validUntil !== null && Date.parse(state.validUntil) <= Date.now()) state = newReportAccumulator(stored.request, scoped.sourceRevision!);
    await advanceReportBatch(client, cipher, userId, row.child_id, state);
    let snapshot: DocumentSnapshot | undefined;
    if (state.stage === "done") {
      await supplementFamilyDocumentSources(client, cipher, userId, row.child_id, scoped, previous ? [previous] : []);
      snapshot = completeReportSnapshot(state, row.version, previous, scoped); stored.currentId = snapshot.id;
    }
    row.progress_encrypted = cipher.encrypt(JSON.stringify(state), context(row) + ":progress");
    row.report_valid_until = state.validUntil ? new Date(state.validUntil) : null;
    row.report_day = stored.request.reportMode === "living" ? state.request.period.to : null;
    return snapshot;
  }
  async function save(client: PoolClient, workspaceId: string, row: Row, stored: Stored, snapshot?: DocumentSnapshot, insert = false) {
    const payload = cipher.encrypt(JSON.stringify(stored), context(row) + ":" + row.version);
    const state = progress(row), scope = await authority(client, workspaceId);
    const sourceRevision = `${scope.version}:${row.source_revision}`;
    const pending = stored.status === "active" && stored.autoRefresh && state !== null && (!state.blocked && state.stage !== "done"
      || state.sourceRevision !== sourceRevision || state.validUntil !== null && Date.parse(state.validUntil) <= Date.now());
    const generation = pending ? (await client.query<{ generation: string }>("SELECT generation FROM worker_control WHERE id=1")).rows[0]?.generation : null;
    if (insert) await client.query(`INSERT INTO family_documents(id,child_id,created_by,version,kind,status,auto_refresh,payload_encrypted,
      progress_encrypted,report_valid_until,report_day,dirty,dirty_epoch,dirty_generation) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [row.id, row.child_id, row.created_by, row.version, stored.request.kind, stored.status, stored.autoRefresh, payload,
        row.progress_encrypted, row.report_valid_until ?? null, row.report_day ?? null, pending, pending ? scope.epoch : null, generation]);
    else await client.query(`UPDATE family_documents SET version=$2,status=$3,auto_refresh=$4,payload_encrypted=$5,
      progress_encrypted=$6,report_valid_until=$7,report_day=$8,dirty=$9,dirty_epoch=$10,dirty_generation=$11,updated_at=now() WHERE id=$1`,
      [row.id, row.version, stored.status, stored.autoRefresh, payload, row.progress_encrypted, row.report_valid_until ?? null, row.report_day ?? null, pending, pending ? scope.epoch : null, generation]);
    row.dirty = pending; row.dirty_epoch = pending ? scope.epoch : null; row.dirty_generation = generation ?? null;
    row.payload_encrypted = payload;
    if (snapshot) await client.query("INSERT INTO family_document_snapshots(id,document_id,version,payload_encrypted) VALUES($1,$2,$3,$4)",
      [snapshot.id, row.id, snapshot.version, cipher.encrypt(JSON.stringify(snapshot), context(row) + ":snapshot:" + snapshot.id + ":" + snapshot.version)]);
    await appendOnlineChange(client, workspaceId, "documents", row.child_id);
  }
  async function requireNoActiveStandardReport(client: PoolClient, childId: string, request: DocumentRequest, exceptId?: string) {
    if (request.kind !== "growth_report" || request.purpose !== "family") return;
    // The caller holds the workspace UPDATE lock; another create/restore cannot race this check.
    // Purpose stays in the encrypted payload, and existing duplicates are never rewritten or removed.
    const rows = (await client.query<Row>("SELECT * FROM family_documents WHERE child_id=$1 AND kind='growth_report' AND status='active' ORDER BY created_at,id", [childId])).rows;
    if (rows.some(row => {
      const existing = decode(row).request;
      return row.id !== exceptId && existing.purpose === "family"
        && (existing.reportMode ?? "fixed") === (request.reportMode ?? "fixed")
        && (request.reportMode === "living" || existing.period.from === request.period.from && existing.period.to === request.period.to);
    }))
      throw new FamilyError(409, "standard_report_exists");
  }
  function originalReportFresh(original: FamilyDocument, stored: Stored, loaded: FamilyDocumentSources, state: ReportAccumulator | null): boolean {
    return original.report !== undefined && currentConcernScan(state) && original.report.sourceRevision === loaded.sourceRevision
      && original.report.period.to === effectiveReportRequest(stored.request).period.to
      && (state?.validUntil === null || state?.validUntil !== undefined && Date.parse(state.validUntil) > Date.now());
  }
  async function receipt(client: PoolClient, workspaceId: string, userId: string, childId: string, opId: string, request: unknown,
    loaded: FamilyDocumentSources, operation: () => Promise<FamilyDocument>): Promise<FamilyDocument> {
    z.uuid().parse(opId);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,178109))", [userId + ":" + opId]);
    const current = await authority(client, workspaceId), canonical = canonicalJson(request);
    const prior = (await client.query<{ child_id: string; storage_epoch: string; request_encrypted: string; result_encrypted: string }>(
      "SELECT * FROM family_document_operations WHERE user_id=$1 AND op_id=$2", [userId, opId])).rows[0];
    if (prior) {
      if (prior.child_id !== childId || prior.storage_epoch !== current.epoch ||
        cipher.decrypt(prior.request_encrypted, receiptContext(userId, childId, opId, "request")) !== canonical) throw new FamilyError(409, "operation_mismatch");
      const original = JSON.parse(cipher.decrypt(prior.result_encrypted, receiptContext(userId, childId, opId, "result"))) as FamilyDocument;
      const row = await find(client, childId, original.id);
      if (!row) throw missing();
      // A replay cannot reveal a superseded/deleted source through the old receipt.
      await supplementFamilyDocumentSources(client, cipher, userId, childId, loaded, [...(original.current ? [original.current] : []), ...original.history].filter(snapshot => !snapshot.reportCoverage));
      const stored = decode(row), scoped = await scopedSources(client, row, loaded), state = progress(row);
      const replay = safe(original, stored, scoped, state);
      // An unchanged original building receipt retains its own batch progress; replay never performs a later batch.
      if ((original.report?.phase === "building" || original.report?.phase === "complete" && replay.report?.phase === "complete" && replay.current !== null)
        && originalReportFresh(original, stored, scoped, state)) replay.report = original.report;
      return replay;
    }
    const item = await operation();
    await client.query("INSERT INTO family_document_operations(user_id,op_id,child_id,storage_epoch,request_encrypted,result_encrypted) VALUES($1,$2,$3,$4,$5,$6)",
      [userId, opId, childId, current.epoch, cipher.encrypt(canonical, receiptContext(userId, childId, opId, "request")),
        cipher.encrypt(JSON.stringify(item), receiptContext(userId, childId, opId, "result"))]);
    return item;
  }
  return {
    operationReceipt(userId: string, childId: string, opId: string) {
      z.uuid().parse(opId);
      return access(userId, childId, false, async (client, workspaceId): Promise<{
        operationId: string; documentId: string; savedVersion: number;
      } | null> => {
        const prior = (await client.query<{ child_id: string; storage_epoch: string; result_encrypted: string }>(
          "SELECT * FROM family_document_operations WHERE user_id=$1 AND op_id=$2", [userId, opId])).rows[0];
        if (!prior || prior.child_id !== childId || prior.storage_epoch !== (await authority(client, workspaceId)).epoch) return null;
        const original = JSON.parse(cipher.decrypt(prior.result_encrypted, receiptContext(userId, childId, opId, "result"))) as FamilyDocument;
        z.uuid().parse(original.id); z.number().int().min(1).parse(original.version);
        if (original.childId !== childId) return null;
        const row = await find(client, childId, original.id);
        if (!row) return null;
        const loaded = await scopedSources(client, row, row.kind === "growth_report"
          ? emptyFamilyDocumentSources(childId) : await loadFamilyDocumentSources(client, cipher, userId, childId));
        await supplementFamilyDocumentSources(client, cipher, userId, childId, loaded,
          original.current && !original.current.reportCoverage ? [original.current] : []);
        const stored = decode(row), state = progress(row), checked = safe(original, stored, loaded, state);
        const current = await result(client, row, loaded, userId);
        const readable = (item: FamilyDocument) => item.current !== null && item.readState === "ready"
          || item.report?.phase === "building" && item.report.sourceRevision === loaded.sourceRevision;
        const originalBuilding = original.report?.phase === "building" && originalReportFresh(original, stored, loaded, state);
        if ((!readable(checked) && !originalBuilding) || !readable(current)) return null;
        // Only committed metadata is projected. Historical bodies never leave this read path.
        return { operationId: opId, documentId: original.id, savedVersion: original.version };
      });
    },
    list(userId: string, childId: string, raw: Partial<DocumentListQuery> = {}) {
      const input = documentListQuerySchema.parse(raw);
      return access(userId, childId, false, async (client, workspaceId, canManage): Promise<DocumentPage> => {
        const cursor = input.cursor ? decodeDocumentCursor(input.cursor, "documents", userId, childId, input.status) : null;
        const rows = (await client.query<Row & { cursor_at: string }>(`SELECT *,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
          FROM family_documents WHERE child_id=$1 AND ($2='all' OR status=$2)
          AND ($3::timestamptz IS NULL OR (created_at,id)<=($3::timestamptz,$4::uuid))
          AND ($5::timestamptz IS NULL OR (created_at,id)<($5::timestamptz,$6::uuid))
          ORDER BY created_at DESC,id DESC LIMIT $7`, [childId, input.status, cursor?.high.at ?? null, cursor?.high.id ?? null,
          cursor?.after.at ?? null, cursor?.after.id ?? null, input.limit + 1])).rows;
        const loaded = rows.slice(0, input.limit).some(row => row.kind === "preparation") ? await loadFamilyDocumentSources(client, cipher, userId, childId) : emptyFamilyDocumentSources(childId), page = rows.slice(0, input.limit), items: FamilyDocument[] = [];
        for (const row of page) items.push(await result(client, row, loaded, userId));
        const last = page.at(-1), first = rows[0], hasMore = rows.length > input.limit;
        const nextCursor = hasMore && last && first ? encodeDocumentCursor({ v: 1, kind: "documents", userId, childId, status: input.status,
          high: cursor?.high ?? { at: first.cursor_at, id: first.id }, after: { at: last.cursor_at, id: last.id } }) : null;
        return { authorityVersion: (await authority(client, workspaceId)).version, canManage, items, hasMore, nextCursor };
      });
    },
    get(userId: string, childId: string, id: string) {
      return access(userId, childId, false, async client => {
        const row = await find(client, childId, id);
        return row ? result(client, row, row.kind === "growth_report" ? emptyFamilyDocumentSources(childId) : await loadFamilyDocumentSources(client, cipher, userId, childId), userId) : null;
      });
    },
    describe(userId: string, childId: string, id: string) {
      return access(userId, childId, false, async (client, workspaceId) => {
        const row = await find(client, childId, id);
        return row ? { authorityVersion: (await authority(client, workspaceId)).version,
          item: await result(client, row, row.kind === "growth_report" ? emptyFamilyDocumentSources(childId) : await loadFamilyDocumentSources(client, cipher, userId, childId), userId) } : null;
      });
    },
    readContent(userId: string, childId: string, id: string, raw: DocumentContentQuery) {
      const input = documentContentQuerySchema.parse(raw);
      return access(userId, childId, false, async (client, workspaceId): Promise<DocumentContentPage | null> => {
        const row = await find(client, childId, id); if (!row) return null;
        const snapshot = await revision(client, row, input.snapshotId, input.snapshotVersion); if (!snapshot) return null;
        const loaded = await scopedSources(client, row, row.kind === "growth_report" ? emptyFamilyDocumentSources(childId) : await loadFamilyDocumentSources(client, cipher, userId, childId));
        await supplementFamilyDocumentSources(client, cipher, userId, childId, loaded, snapshot.reportCoverage ? [] : [snapshot]);
        return { documentId: id, documentVersion: row.version, authorityVersion: (await authority(client, workspaceId)).version,
          ...sliceDocumentContent(snapshot, documentSnapshotValid(snapshot, loaded), input.offset) };
      });
    },
    listVersions(userId: string, childId: string, id: string, rawCursor: string | null = null) {
      return access(userId, childId, false, async (client, workspaceId): Promise<DocumentVersionPage | null> => {
        const row = await find(client, childId, id); if (!row) return null;
        const cursor = rawCursor ? decodeDocumentCursor(rawCursor, "versions", userId, childId, id) : null;
        const rows = (await client.query<{ id: string; version: number; payload_encrypted: string }>(`SELECT id,version,payload_encrypted FROM family_document_snapshots
          WHERE document_id=$1 AND ($2::integer IS NULL OR version<=$2) AND ($3::integer IS NULL OR version<$3) ORDER BY version DESC LIMIT 11`, [id, cursor?.high ?? null, cursor?.after ?? null])).rows;
        const snapshots = rows.slice(0, 10).map(snapshot => JSON.parse(cipher.decrypt(snapshot.payload_encrypted, context(row) + ":snapshot:" + snapshot.id + ":" + snapshot.version)) as DocumentSnapshot);
        const loaded = await scopedSources(client, row, row.kind === "growth_report" ? emptyFamilyDocumentSources(childId) : await loadFamilyDocumentSources(client, cipher, userId, childId));
        await supplementFamilyDocumentSources(client, cipher, userId, childId, loaded, snapshots.filter(snapshot => !snapshot.reportCoverage));
        const last = snapshots.at(-1);
        return { documentId: id, authorityVersion: (await authority(client, workspaceId)).version,
          items: snapshots.map(snapshot => ({ snapshotId: snapshot.id, snapshotVersion: snapshot.version, generatedAt: snapshot.generatedAt,
            invalidated: !documentSnapshotValid(snapshot, loaded) })),
          nextCursor: rows.length > 10 && last ? encodeDocumentCursor({ v: 1, kind: "versions", userId, childId, documentId: id, high: cursor?.high ?? rows[0].version, after: last.version }) : null };
      });
    },
    validatePatch(userId: string, childId: string, id: string, raw: DocumentPatch, appliedVersion?: number) {
      const patch = documentPatchSchema.parse(raw);
      return access(userId, childId, true, async (client, workspaceId) => {
        if ((await authority(client, workspaceId)).version !== patch.authorityVersion) throw changed();
        const row = await find(client, childId, id); if (!row) throw missing();
        const stored = decode(row);
        if (row.version !== (appliedVersion ?? patch.expectedVersion) || stored.status !== "active") throw changed();
        const previous = await revision(client, row, stored.currentId); if (!previous) throw changed();
        const loaded = await scopedSources(client, row, await loadFamilyDocumentSources(client, cipher, userId, childId));
        await supplementFamilyDocumentSources(client, cipher, userId, childId, loaded, [previous]);
        const preview = appliedVersion === undefined ? applyFamilyDocumentPatch(previous, patch, loaded, row.version + 1) : previous;
        if (appliedVersion !== undefined && !documentSnapshotValid(preview, loaded)) throw new FamilyError(409, "source_changed");
        const sourceBasis = createHash("sha256").update(canonicalJson({ basis: documentSourceBasis(loaded, stored.request),
          references: preview.sources.map(({ id, version, text }) => ({ id, version, text })).sort((a, b) => a.id.localeCompare(b.id)) })).digest("hex");
        return { id: row.id, version: row.version, sourceBasis, title: documentSnapshotValid(previous, loaded) ? previous.title : null };
      });
    },
    create(userId: string, childId: string, raw: DocumentRequest, opId: string) {
      const request = documentRequestSchema.parse(raw);
      return access(userId, childId, true, async (client, workspaceId) => {
        const loaded = request.kind === "growth_report" ? emptyFamilyDocumentSources(childId) : await loadFamilyDocumentSources(client, cipher, userId, childId);
        return receipt(client, workspaceId, userId, childId, opId, { action: "create", request }, loaded, async () => {
          await requireNoActiveStandardReport(client, childId, request);
          const count = (await client.query<{ count: number }>("SELECT count(*)::integer AS count FROM family_documents WHERE child_id=$1 AND status='active'", [childId])).rows[0].count;
          if (count >= MAX_DOCUMENTS) throw new FamilyError(400, "document_limit");
          const row: Row = { kind: request.kind, id: randomUUID(), child_id: childId, created_by: userId, version: 1, payload_encrypted: "", dirty: false, dirty_epoch: null, dirty_generation: null,
            source_revision: "0", progress_encrypted: null };
          const stored: Stored = { request, currentId: null, status: "active", archivedAt: null, autoRefresh: request.kind === "growth_report" };
          const snapshot = request.kind === "growth_report" ? await reportBatch(client, workspaceId, userId, row, stored, null, loaded)
            : buildFamilyDocumentSnapshot(loaded, request, 1, null);
          if (snapshot) stored.currentId = snapshot.id;
          await save(client, workspaceId, row, stored, snapshot, true);
          return result(client, row, loaded, userId);
        });
      });
    },
    change(userId: string, childId: string, id: string, raw: DocumentChange, opId: string) {
      const change = documentChangeSchema.parse(raw);
      return access(userId, childId, true, async (client, workspaceId) => {
        const loaded = emptyFamilyDocumentSources(childId);
        return receipt(client, workspaceId, userId, childId, opId, { id, change }, loaded, async () => {
          if ((await authority(client, workspaceId)).version !== change.authorityVersion) throw changed();
          const row = await find(client, childId, id); if (!row) throw missing();
          if (row.version !== change.expectedVersion || row.version >= 2147483647) throw changed();
          const stored = decode(row), prior = await snapshots(client, row, stored.currentId);
          if (stored.request.kind === "preparation" || change.action === "patch") Object.assign(loaded, await loadFamilyDocumentSources(client, cipher, userId, childId));
          Object.assign(loaded, await scopedSources(client, row, loaded));
          await supplementFamilyDocumentSources(client, cipher, userId, childId, loaded, prior.current && (change.action === "patch" || !prior.current.reportCoverage) ? [prior.current] : []);
          let snapshot: DocumentSnapshot | undefined;
          row.version++;
          if (change.action === "refresh") {
            if (stored.status !== "active") throw changed();
            snapshot = stored.request.kind === "growth_report" ? await reportBatch(client, workspaceId, userId, row, stored, prior.current, loaded)
              : buildFamilyDocumentSnapshot(loaded, stored.request, row.version, prior.current);
            if (snapshot) stored.currentId = snapshot.id;
          } else if (change.action === "patch") {
            if (stored.status !== "active" || !prior.current) throw changed();
            snapshot = applyFamilyDocumentPatch(prior.current, change, loaded, row.version);
            stored.currentId = snapshot.id;
            const state = progress(row);
            if (state?.blocked) { state.blocked = false; row.progress_encrypted = cipher.encrypt(JSON.stringify(state), context(row) + ":progress"); }
          } else if (change.action === "check_item") {
            if (stored.status !== "active" || !prior.current || !documentSnapshotValid(prior.current, loaded)
              || !prior.current.reportCoverage && prior.current.sourceBasis !== documentSourceBasis(loaded, stored.request)) throw new FamilyError(409, "source_changed");
            snapshot = structuredClone(prior.current);
            const section = snapshot.sections.find(section => section.id === change.sectionId && section.kind === "checklist");
            const item = section?.items.find(item => item.id === change.itemId);
            if (!item) throw new FamilyError(400, "invalid_input");
            item.checked = change.checked;
            snapshot.id = randomUUID(); snapshot.version = row.version; snapshot.generatedAt = new Date().toISOString();
            snapshot.changes = ["家長更新準備清單的完成標記。"];
            stored.currentId = snapshot.id;
          } else {
            if (change.action === "archive" && stored.status !== "active" || change.action === "restore" && stored.status !== "archived") throw changed();
            if (change.action === "archive" && stored.request.kind !== "growth_report" && (!prior.current || !documentSnapshotValid(prior.current, loaded)))
              throw new FamilyError(409, "source_changed");
            if (change.action === "restore") {
              const count = (await client.query<{ count: number }>("SELECT count(*)::integer AS count FROM family_documents WHERE child_id=$1 AND status='active'", [childId])).rows[0].count;
              if (count >= MAX_DOCUMENTS) throw new FamilyError(400, "document_limit");
              await requireNoActiveStandardReport(client, childId, stored.request, row.id);
            }
            stored.status = change.action === "archive" ? "archived" : "active";
            stored.archivedAt = change.action === "archive" ? new Date().toISOString() : null;
          }
          await save(client, workspaceId, row, stored, snapshot);
          // A restore must not silently regenerate archived content or drop pending source changes.
          if (stored.status === "active" && stored.autoRefresh && !snapshot && (!prior.current || !documentSnapshotValid(prior.current, loaded)
            || stored.request.kind !== "growth_report" && prior.current.sourceBasis !== documentSourceBasis(loaded, stored.request)))
            await client.query(`UPDATE family_documents d SET dirty=true,dirty_epoch=w.storage_epoch,dirty_generation=c.generation
              FROM children ch,workspaces w,worker_control c WHERE d.id=$1 AND ch.id=d.child_id AND w.id=ch.workspace_id AND c.id=1`, [id]);
          return result(client, row, loaded, userId);
        });
      });
    },
    exportSnapshot(userId: string, childId: string, id: string, raw: DocumentExport) {
      const input = documentExportSchema.parse(raw);
      return access(userId, childId, false, async (client, workspaceId) => {
        if ((await authority(client, workspaceId)).version !== input.authorityVersion) throw changed();
        const row = await find(client, childId, id); if (!row) return null;
        const snapshot = await revision(client, row, input.snapshotId, input.snapshotVersion);
        if (!snapshot) return null;
        const loaded = await scopedSources(client, row, row.kind === "growth_report" ? emptyFamilyDocumentSources(childId) : await loadFamilyDocumentSources(client, cipher, userId, childId));
        await supplementFamilyDocumentSources(client, cipher, userId, childId, loaded, snapshot.reportCoverage ? [] : [snapshot]);
        if (!documentSnapshotValid(snapshot, loaded)) throw new FamilyError(409, "source_changed");
        return snapshot;
      });
    },
    /** One cron batch, at most twenty short transactions. No model, notification, or network work. */
    async refreshPending(generation: string): Promise<number> {
      z.uuid().parse(generation);
      const candidates = (await pool.query<{ id: string; child_id: string; created_by: string }>(
        `SELECT id,child_id,created_by FROM family_documents WHERE auto_refresh AND status='active'
          AND (dirty OR report_valid_until<=now() OR report_day<(now() AT TIME ZONE 'Asia/Hong_Kong')::date) ORDER BY updated_at,id LIMIT 20`)).rows;
      let refreshed = 0;
      for (const candidate of candidates) {
        const owner = (await pool.query<{ owner_user_id: string }>("SELECT w.owner_user_id FROM children c JOIN workspaces w ON w.id=c.workspace_id WHERE c.id=$1", [candidate.child_id])).rows[0];
        if (!owner) continue;
        const done = await access(owner.owner_user_id, candidate.child_id, true, async (client, workspaceId) => {
          const control = (await client.query<{ enabled: boolean; generation: string }>("SELECT enabled,generation FROM worker_control WHERE id=1 FOR SHARE")).rows[0];
          if (!control?.enabled || control.generation !== generation) return false;
          const row = await find(client, candidate.child_id, candidate.id); if (!row) return false;
          const timeDue = row.report_valid_until !== null && row.report_valid_until !== undefined && row.report_valid_until.getTime() <= Date.now()
            || row.report_day !== null && row.report_day !== undefined && row.report_day < reportToday();
          if (!row.dirty && !timeDue) return false;
          const stored = decode(row), current = await authority(client, workspaceId);
          if (stored.status !== "active" || !stored.autoRefresh) return false;
          const eligible = (await client.query("SELECT 1 FROM workspaces WHERE id=$1 AND (owner_user_id=$2 OR EXISTS(SELECT 1 FROM family_members WHERE workspace_id=$1 AND user_id=$2 AND role='caregiver'))", [workspaceId, row.created_by])).rowCount;
          if ((row.dirty && row.dirty_epoch !== current.epoch) || !eligible || row.version >= 2147483647) {
            await client.query("UPDATE family_documents SET dirty=false,dirty_epoch=NULL,dirty_generation=NULL,report_valid_until=NULL,report_day=NULL WHERE id=$1", [row.id]); return false;
          }
          // Enable generations gate this job; source generations stay independent of online change_seq.
          const loaded = await scopedSources(client, row, emptyFamilyDocumentSources(row.child_id));
          const prior = await snapshots(client, row, stored.currentId);
          if (prior.current?.reportCoverage && documentSnapshotValid(prior.current, loaded) && !timeDue
            && progress(row)?.stage === "done" && currentConcernScan(progress(row))) {
            await client.query("UPDATE family_documents SET dirty=false,dirty_epoch=NULL,dirty_generation=NULL WHERE id=$1", [row.id]); return false;
          }
          row.version++;
          let snapshot: DocumentSnapshot | undefined;
          try { snapshot = await reportBatch(client, workspaceId, row.created_by, row, stored, prior.current, loaded); }
          catch (error) {
            if (!(error instanceof FamilyError) || !["document_edits_need_review", "document_capacity_exceeded"].includes(error.code)) throw error;
            const state = progress(row);
            if (state) { state.blocked = true; row.progress_encrypted = cipher.encrypt(JSON.stringify(state), context(row) + ":progress"); }
            await client.query(`UPDATE family_documents SET dirty=false,dirty_epoch=NULL,dirty_generation=NULL,
              progress_encrypted=$2,report_valid_until=NULL,report_day=NULL WHERE id=$1`, [row.id, row.progress_encrypted]);
            return false;
          }
          await save(client, workspaceId, row, stored, snapshot); return true;
        });
        if (done) refreshed++;
      }
      return refreshed;
    },
  };
}
export type FamilyDocumentStore = ReturnType<typeof createFamilyDocumentStore>;

