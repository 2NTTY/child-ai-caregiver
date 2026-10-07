import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import { documentChangeSchema, documentExportSchema, documentRequestSchema,
  documentListQuerySchema, documentContentQuerySchema, documentPatchSchema, type DocumentContentQuery, type DocumentContentPage, type DocumentVersionPage, type DocumentPatch, type DocumentListQuery, type DocumentChange, type DocumentExport, type DocumentPage, type DocumentRequest, type DocumentSnapshot, type FamilyDocument } from "../src/shared/family-documents.ts";
import { FamilyError, READ_ROLES, WRITE_ROLES, withChildAccess } from "./family-access.ts";
import type { StorageCipher } from "./storage-crypto.ts";
import { canonicalJson } from "./online-routing.ts";
import { appendOnlineChange } from "./online-change.ts";
import { buildFamilyDocumentSnapshot, documentSnapshotValid, documentSourceBasis, loadFamilyDocumentSources, supplementFamilyDocumentSources, type FamilyDocumentSources } from "./family-document-sources.ts";

import { applyFamilyDocumentPatch } from "./family-document-edits.ts";
import { decodeDocumentCursor, encodeDocumentCursor, documentManifest, sliceDocumentContent } from "./family-document-reading.ts";

interface Row { id: string; child_id: string; created_by: string; version: number; payload_encrypted: string;
  dirty: boolean; dirty_epoch: string | null; dirty_generation: string | null }
interface Stored { request: DocumentRequest; currentId: string; status: FamilyDocument["status"]; archivedAt: string | null; autoRefresh: boolean }
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
    return (await client.query<Row>("SELECT * FROM family_documents WHERE id=$1 AND child_id=$2", [id, childId])).rows[0];
  }
  async function revision(client: PoolClient, row: Row, id: string, version?: number): Promise<DocumentSnapshot | null> {
    const snapshot = (await client.query<{ id: string; version: number; payload_encrypted: string }>(
      "SELECT id,version,payload_encrypted FROM family_document_snapshots WHERE document_id=$1 AND id=$2 AND ($3::integer IS NULL OR version=$3)", [row.id, id, version ?? null])).rows[0];
    return snapshot ? JSON.parse(cipher.decrypt(snapshot.payload_encrypted, context(row) + ":snapshot:" + snapshot.id + ":" + snapshot.version)) : null;
  }
  async function snapshots(client: PoolClient, row: Row, currentId: string) {
    const current = await revision(client, row, currentId);
    const rows = (await client.query<{ id: string; version: number; payload_encrypted: string }>(
      "SELECT id,version,payload_encrypted FROM family_document_snapshots WHERE document_id=$1 AND id<>$2 ORDER BY version DESC LIMIT $3", [row.id, currentId, MAX_HISTORY])).rows;
    const history = rows.map(snapshot => JSON.parse(cipher.decrypt(snapshot.payload_encrypted, context(row) + ":snapshot:" + snapshot.id + ":" + snapshot.version)) as DocumentSnapshot);
    return { current, history };
  }
  function safe(item: FamilyDocument, request: DocumentRequest, loaded: FamilyDocumentSources): FamilyDocument {
    const valid = item.current && documentSnapshotValid(item.current, loaded);
    return { ...item, current: valid ? item.current : null, ...(item.current ? { manifest: documentManifest(item.current, !valid) } : {}),
      history: item.history.filter(snapshot => documentSnapshotValid(snapshot, loaded)).slice(0, MAX_HISTORY),
      readState: !valid ? "invalidated" : item.current!.sourceBasis !== documentSourceBasis(loaded, request) ? "stale" : "ready" };
  }
  async function result(client: PoolClient, row: Row, loaded: FamilyDocumentSources, userId: string): Promise<FamilyDocument> {
    const stored = decode(row), revisions = await snapshots(client, row, stored.currentId);
    await supplementFamilyDocumentSources(client, cipher, userId, row.child_id, loaded, [...(revisions.current ? [revisions.current] : []), ...revisions.history]);
    return safe({ id: row.id, childId: row.child_id, kind: stored.request.kind, purpose: stored.request.purpose, version: row.version,
      status: stored.status, archivedAt: stored.archivedAt, autoRefresh: stored.autoRefresh, ...revisions, readState: "ready" }, stored.request, loaded);
  }
  async function save(client: PoolClient, workspaceId: string, row: Row, stored: Stored, snapshot?: DocumentSnapshot, insert = false) {
    const payload = cipher.encrypt(JSON.stringify(stored), context(row) + ":" + row.version);
    if (insert) await client.query("INSERT INTO family_documents(id,child_id,created_by,version,kind,status,auto_refresh,payload_encrypted) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [row.id, row.child_id, row.created_by, row.version, stored.request.kind, stored.status, stored.autoRefresh, payload]);
    else await client.query("UPDATE family_documents SET version=$2,status=$3,auto_refresh=$4,payload_encrypted=$5,dirty=false,dirty_epoch=NULL,dirty_generation=NULL,updated_at=now() WHERE id=$1",
      [row.id, row.version, stored.status, stored.autoRefresh, payload]);
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
        && existing.period.from === request.period.from && existing.period.to === request.period.to;
    }))
      throw new FamilyError(409, "standard_report_exists");
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
      await supplementFamilyDocumentSources(client, cipher, userId, childId, loaded, [...(original.current ? [original.current] : []), ...original.history]);
      return safe(original, decode(row).request, loaded);
    }
    const item = await operation();
    await client.query("INSERT INTO family_document_operations(user_id,op_id,child_id,storage_epoch,request_encrypted,result_encrypted) VALUES($1,$2,$3,$4,$5,$6)",
      [userId, opId, childId, current.epoch, cipher.encrypt(canonical, receiptContext(userId, childId, opId, "request")),
        cipher.encrypt(JSON.stringify(item), receiptContext(userId, childId, opId, "result"))]);
    return item;
  }
  return {
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
        const loaded = await loadFamilyDocumentSources(client, cipher, userId, childId), page = rows.slice(0, input.limit), items: FamilyDocument[] = [];
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
        return row ? result(client, row, await loadFamilyDocumentSources(client, cipher, userId, childId), userId) : null;
      });
    },
    describe(userId: string, childId: string, id: string) {
      return access(userId, childId, false, async (client, workspaceId) => {
        const row = await find(client, childId, id);
        return row ? { authorityVersion: (await authority(client, workspaceId)).version,
          item: await result(client, row, await loadFamilyDocumentSources(client, cipher, userId, childId), userId) } : null;
      });
    },
    readContent(userId: string, childId: string, id: string, raw: DocumentContentQuery) {
      const input = documentContentQuerySchema.parse(raw);
      return access(userId, childId, false, async (client, workspaceId): Promise<DocumentContentPage | null> => {
        const row = await find(client, childId, id); if (!row) return null;
        const snapshot = await revision(client, row, input.snapshotId, input.snapshotVersion); if (!snapshot) return null;
        const loaded = await loadFamilyDocumentSources(client, cipher, userId, childId);
        await supplementFamilyDocumentSources(client, cipher, userId, childId, loaded, [snapshot]);
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
        const loaded = await loadFamilyDocumentSources(client, cipher, userId, childId);
        await supplementFamilyDocumentSources(client, cipher, userId, childId, loaded, snapshots);
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
        const loaded = await loadFamilyDocumentSources(client, cipher, userId, childId);
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
        const loaded = await loadFamilyDocumentSources(client, cipher, userId, childId);
        return receipt(client, workspaceId, userId, childId, opId, { action: "create", request }, loaded, async () => {
          await requireNoActiveStandardReport(client, childId, request);
          const count = (await client.query<{ count: number }>("SELECT count(*)::integer AS count FROM family_documents WHERE child_id=$1 AND status='active'", [childId])).rows[0].count;
          if (count >= MAX_DOCUMENTS) throw new FamilyError(400, "document_limit");
          const snapshot = buildFamilyDocumentSnapshot(loaded, request, 1, null);
          const row: Row = { id: randomUUID(), child_id: childId, created_by: userId, version: 1, payload_encrypted: "", dirty: false, dirty_epoch: null, dirty_generation: null };
          await save(client, workspaceId, row, { request, currentId: snapshot.id, status: "active", archivedAt: null, autoRefresh: request.kind === "growth_report" }, snapshot, true);
          return result(client, row, loaded, userId);
        });
      });
    },
    change(userId: string, childId: string, id: string, raw: DocumentChange, opId: string) {
      const change = documentChangeSchema.parse(raw);
      return access(userId, childId, true, async (client, workspaceId) => {
        const loaded = await loadFamilyDocumentSources(client, cipher, userId, childId);
        return receipt(client, workspaceId, userId, childId, opId, { id, change }, loaded, async () => {
          if ((await authority(client, workspaceId)).version !== change.authorityVersion) throw changed();
          const row = await find(client, childId, id); if (!row) throw missing();
          if (row.version !== change.expectedVersion || row.version >= 2147483647) throw changed();
          const stored = decode(row), prior = await snapshots(client, row, stored.currentId);
          await supplementFamilyDocumentSources(client, cipher, userId, childId, loaded, prior.current ? [prior.current] : []);
          let snapshot: DocumentSnapshot | undefined;
          row.version++;
          if (change.action === "refresh") {
            if (stored.status !== "active") throw changed();
            snapshot = buildFamilyDocumentSnapshot(loaded, stored.request, row.version, prior.current);
            stored.currentId = snapshot.id;
          } else if (change.action === "patch") {
            if (stored.status !== "active" || !prior.current) throw changed();
            snapshot = applyFamilyDocumentPatch(prior.current, change, loaded, row.version);
            stored.currentId = snapshot.id;
          } else if (change.action === "check_item") {
            if (stored.status !== "active" || !prior.current || !documentSnapshotValid(prior.current, loaded)
              || prior.current.sourceBasis !== documentSourceBasis(loaded, stored.request)) throw new FamilyError(409, "source_changed");
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
            if (change.action === "archive" && (!prior.current || !documentSnapshotValid(prior.current, loaded)))
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
          if (stored.status === "active" && stored.autoRefresh && !snapshot && prior.current?.sourceBasis !== documentSourceBasis(loaded, stored.request))
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
        const loaded = await loadFamilyDocumentSources(client, cipher, userId, childId);
        await supplementFamilyDocumentSources(client, cipher, userId, childId, loaded, [snapshot]);
        if (!documentSnapshotValid(snapshot, loaded)) throw new FamilyError(409, "source_changed");
        return snapshot;
      });
    },
    /** One cron batch, at most twenty short transactions. No model, notification, or network work. */
    async refreshPending(generation: string): Promise<number> {
      z.uuid().parse(generation);
      const candidates = (await pool.query<{ id: string; child_id: string; created_by: string }>(
        "SELECT id,child_id,created_by FROM family_documents WHERE dirty AND auto_refresh AND status='active' ORDER BY updated_at,id LIMIT 20")).rows;
      let refreshed = 0;
      for (const candidate of candidates) {
        const owner = (await pool.query<{ owner_user_id: string }>("SELECT w.owner_user_id FROM children c JOIN workspaces w ON w.id=c.workspace_id WHERE c.id=$1", [candidate.child_id])).rows[0];
        if (!owner) continue;
        const done = await access(owner.owner_user_id, candidate.child_id, true, async (client, workspaceId) => {
          const control = (await client.query<{ enabled: boolean; generation: string }>("SELECT enabled,generation FROM worker_control WHERE id=1 FOR SHARE")).rows[0];
          if (!control?.enabled || control.generation !== generation) return false;
          const row = await find(client, candidate.child_id, candidate.id); if (!row?.dirty) return false;
          const stored = decode(row), current = await authority(client, workspaceId);
          if (stored.status !== "active" || !stored.autoRefresh) return false;
          const eligible = (await client.query("SELECT 1 FROM workspaces WHERE id=$1 AND (owner_user_id=$2 OR EXISTS(SELECT 1 FROM family_members WHERE workspace_id=$1 AND user_id=$2 AND role='caregiver'))", [workspaceId, row.created_by])).rowCount;
          if (row.dirty_epoch !== current.epoch || !eligible || row.version >= 2147483647) {
            await client.query("UPDATE family_documents SET dirty=false,dirty_epoch=NULL,dirty_generation=NULL WHERE id=$1", [row.id]); return false;
          }
          // A new enable-generation must retain source changes collected while paused.
          // This job already matches current control; only deterministic shared snapshots are rebuilt.
          const loaded = await loadFamilyDocumentSources(client, cipher, row.created_by, row.child_id), prior = await snapshots(client, row, stored.currentId);
          await supplementFamilyDocumentSources(client, cipher, row.created_by, row.child_id, loaded, prior.current ? [prior.current] : []);
          if (prior.current?.sourceBasis === documentSourceBasis(loaded, stored.request)) {
            await client.query("UPDATE family_documents SET dirty=false,dirty_epoch=NULL,dirty_generation=NULL WHERE id=$1", [row.id]); return false;
          }
          row.version++;
          let snapshot: DocumentSnapshot;
          try { snapshot = buildFamilyDocumentSnapshot(loaded, stored.request, row.version, prior.current); }
          catch (error) {
            if (!(error instanceof FamilyError) || error.code !== "document_edits_need_review") throw error;
            // Keep the encrypted snapshot untouched while waiting for an explicit parent repair.
            // A later source event can mark it dirty again; this document must not block its batch.
            await client.query("UPDATE family_documents SET dirty=false,dirty_epoch=NULL,dirty_generation=NULL WHERE id=$1", [row.id]);
            return false;
          }
          stored.currentId = snapshot.id;
          await save(client, workspaceId, row, stored, snapshot); return true;
        });
        if (done) refreshed++;
      }
      return refreshed;
    },
  };
}
export type FamilyDocumentStore = ReturnType<typeof createFamilyDocumentStore>;

