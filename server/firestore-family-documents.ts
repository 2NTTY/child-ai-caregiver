import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { documentRequestSchema, documentChangeSchema, documentPatchSchema, documentExportSchema, documentListQuerySchema, documentContentQuerySchema,
  type FamilyDocument, type DocumentSnapshot } from '../src/shared/family-documents.ts';
import type { FamilyDocumentStore } from './family-document-store.ts';
import { FamilyError } from './family-access.ts';
import { canonicalJson } from './online-routing.ts';
import { createFirestoreAuthority, FirestoreAuthorityError, type FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreTaskSchema, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import type { WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';
import { FirestoreFamilyDocumentSnapshots } from './firestore-family-document-snapshots.ts';
import { emptyFamilyDocumentSources, taskDocumentSource, buildFamilyDocumentSnapshot, documentSnapshotValid, documentSourceBasis,
  type FamilyDocumentSources } from './family-document-snapshot.ts';
import { applyFamilyDocumentPatch } from './family-document-edits.ts';
import { documentManifest, sliceDocumentContent, decodeDocumentCursor, encodeDocumentCursor } from './family-document-reading.ts';
import { createFirestoreDocumentSources } from './firestore-document-sources.ts';
import { firestoreDocumentReportSchema } from './firestore-document-report-schema.ts';
import { newReportAccumulator, completeReportSnapshot, effectiveReportRequest, reportPeriodKind, currentConcernScan } from './family-document-report-core.ts';
import { createFirestoreCareStore } from './firestore-care.ts';
import { createFirestoreMemoryStore } from './firestore-memory.ts';
import { createFirestoreChatStore } from './firestore-chat.ts';

const uuid = z.uuid(), version = z.number().int().positive().max(2147483647), datetime = z.iso.datetime({ offset: true });
const metadataSchema = z.object({ id: uuid, childId: uuid, ownerUserId: z.string().min(1).max(256), version, request: documentRequestSchema,
  currentId: uuid.nullable(), historyIds: z.array(uuid).max(10), status: z.enum(['active', 'archived']), archivedAt: datetime.nullable(),
  autoRefresh: z.boolean(), createdAt: z.iso.datetime({ precision: 6 }), progress: firestoreDocumentReportSchema.nullable().optional() }).strict();
type Metadata = z.infer<typeof metadataSchema>;
const operationSchema = z.object({ ownerUserId: z.string().min(1).max(256), childId: uuid, storageEpoch: uuid, operationId: uuid,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u), document: metadataSchema }).strict();
function reject(code: string, status: 400 | 404 | 409 = 409): never { throw new FamilyError(status, code); }
const fingerprint = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');

/** Versioned documents reuse the same care, fact, task and concern authority as product tools. */
export function createFirestoreFamilyDocumentStore(options: FirestoreDomainOptions & {
  /** Internal Agent transaction only. Never supplied by an HTTP request. */
  transaction?: FirestoreAuthorityTransaction;
  deferCommit?: (commit: () => void) => void;
}): FamilyDocumentStore {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options), snapshots = new FirestoreFamilyDocumentSnapshots(options);
  const care = createFirestoreCareStore(options), chat = createFirestoreChatStore(options);
  const reader = createFirestoreDocumentSources({ ...options, care, memory: createFirestoreMemoryStore({ ...options, care, chat }) });
  async function runDocumentTransaction<T>(userId: string, childId: string | null,
    operation: (binding: FirestoreAuthorityTransaction) => Promise<T>): Promise<T> {
    try {
      if (options.transaction) {
        const binding = options.transaction;
        if (binding.scope.ownerUserId !== userId || childId !== null && childId !== binding.scope.childId) reject('not_found', 404);
        return await operation({ ...binding, scope: { ...binding.scope, childId: childId ?? '00000000-0000-0000-0000-000000000000' } });
      }
      return await authority.runTransaction(userId, childId, operation);
    }
    catch (error) {
      if (error instanceof FirestoreAuthorityError
        && (error.status === 403 && ['binding', 'account_inactive', 'account_not_ready', 'service_disabled'].includes(error.code)
          || error.status === 404 && error.code === 'not_found')) reject('not_found', 404);
      throw error;
    }
  }
  const scoped = (binding: FirestoreAuthorityTransaction, childId: string): WorkRecoveryScope => ({ ...binding.scope, childId });
  const authorityVersion = (binding: FirestoreAuthorityTransaction) => `${binding.scope.storageEpoch}:${binding.authorizationVersion}`;
  const operationId = (ownerUserId: string, opId: string) => JSON.stringify([ownerUserId, opId]);
  function checkTags(raw: any, scope: WorkRecoveryScope) {
    if (Object.entries(data.tags(scope)).some(([key, value]) => raw?.[key] !== value)) domainReject('document_binding', 500);
  }
  async function child(binding: FirestoreAuthorityTransaction, childId: string) {
    if (!await binding.readChild(childId)) reject('not_found', 404); return scoped(binding, childId);
  }
  function query(suffix: string, scope: WorkRecoveryScope) {
    let q: ReturnType<FirestoreDomainData['collection']> | import('@google-cloud/firestore').Query = data.collection(suffix);
    for (const [key, value] of Object.entries(data.tags(scope))) q = q.where(key, '==', value);
    return q;
  }
  async function find(binding: FirestoreAuthorityTransaction, scope: WorkRecoveryScope, id: string): Promise<Metadata | null> {
    const row = await binding.transaction.get(data.ref('documents', 'family-document', id)); if (!row.exists) return null;
    checkTags(row.data(), scope);
    const result = data.open('family-document', id, scope, metadataSchema, row);
    if (result.id !== id || result.childId !== scope.childId || result.ownerUserId !== scope.ownerUserId || result.version !== row.get('recordVersion')
      || result.status !== row.get('status') || result.createdAt !== row.get('createdAt')) domainReject('document_binding', 500);
    return result;
  }
  async function sources(binding: FirestoreAuthorityTransaction, scope: WorkRecoveryScope) {
    return reader.load({ ...binding, scope });
  }
  async function supplement(binding: FirestoreAuthorityTransaction, scope: WorkRecoveryScope, loaded: FamilyDocumentSources, values: DocumentSnapshot[]) {
    await reader.supplement({ ...binding, scope }, loaded, values);
  }
  async function reportBatch(binding: FirestoreAuthorityTransaction, scope: WorkRecoveryScope, row: Metadata,
    loaded: FamilyDocumentSources, previous: DocumentSnapshot | null): Promise<DocumentSnapshot | undefined> {
    const effective = effectiveReportRequest(row.request);
    let state = row.progress;
    if (!state || !currentConcernScan(state) || state.blocked || state.stage === 'done' || state.sourceRevision !== loaded.sourceRevision
      || state.request.period.to !== effective.period.to || state.validUntil !== null && Date.parse(state.validUntil) <= Date.now())
      state = newReportAccumulator(row.request, loaded.sourceRevision!);
    await reader.advance({ ...binding, scope }, state);
    row.progress = state;
    if (state.stage !== 'done') return undefined;
    if (previous) await supplement(binding, scope, loaded, [previous]);
    return completeReportSnapshot(state, row.version, previous, loaded);
  }
  async function bodies(binding: FirestoreAuthorityTransaction, scope: WorkRecoveryScope, row: Metadata) {
    const current = row.currentId ? await snapshots.read(binding.transaction, scope, row.id, row.currentId) : null;
    if (row.currentId && !current) domainReject('snapshot_binding', 500);
    const history: DocumentSnapshot[] = [];
    for (const id of row.historyIds) {
      const item = await snapshots.read(binding.transaction, scope, row.id, id); if (!item) domainReject('snapshot_binding', 500); history.push(item);
    }
    return { current, history };
  }
  function safe(row: Metadata, loaded: FamilyDocumentSources, values: { current: DocumentSnapshot | null; history: DocumentSnapshot[] }): FamilyDocument {
    const valid = values.current !== null && documentSnapshotValid(values.current, loaded);
    const item: FamilyDocument = { id: row.id, childId: row.childId, kind: row.request.kind, purpose: row.request.purpose, version: row.version,
      status: row.status, archivedAt: row.archivedAt, autoRefresh: row.autoRefresh, current: valid ? values.current : null,
      ...(values.current ? { manifest: documentManifest(values.current, !valid) } : {}), history: values.history.filter(value => documentSnapshotValid(value, loaded)),
      readState: !valid ? 'invalidated' : !values.current!.reportCoverage && values.current!.sourceBasis !== documentSourceBasis(loaded, row.request) ? 'stale' : 'ready' };
    if (row.request.kind === 'growth_report') {
      const effective = effectiveReportRequest(row.request), state = row.progress;
      const current = state && currentConcernScan(state) && !state.blocked && state.sourceRevision === loaded.sourceRevision && state.request.period.to === effective.period.to
        && (state.validUntil === null || Date.parse(state.validUntil) > Date.now());
      item.report = { mode: row.request.reportMode ?? 'fixed', phase: current && state.stage !== 'done' ? 'building'
        : current && valid ? 'complete' : 'needs_update', processedSources: state?.processedSources ?? 0,
        sourceRevision: loaded.sourceRevision!, periodKind: reportPeriodKind(effective.period), period: effective.period, title: row.request.title };
      if (item.report.phase !== 'complete') item.readState = 'stale';
    }
    return item;
  }
  async function result(binding: FirestoreAuthorityTransaction, scope: WorkRecoveryScope, row: Metadata, loaded: FamilyDocumentSources) {
    const values = await bodies(binding, scope, row); await supplement(binding, scope, loaded, [...(values.current ? [values.current] : []), ...values.history]);
    return safe(row, loaded, values);
  }
  async function prior(binding: FirestoreAuthorityTransaction, opId: string) {
    const id = operationId(binding.scope.ownerUserId, opId), row = await binding.transaction.get(data.ref('document_operations', 'document-operation', id));
    if (!row.exists) return null;
    const tags = data.tags(binding.scope);
    if (row.get('workspaceTag') !== tags.workspaceTag || row.get('epochTag') !== tags.epochTag) reject('operation_mismatch');
    checkTags(row.data(), binding.scope);
    const receipt = data.open('document-operation', id, binding.scope, operationSchema, row);
    if (receipt.ownerUserId !== binding.scope.ownerUserId || receipt.operationId !== opId || receipt.storageEpoch !== binding.scope.storageEpoch
      || receipt.document.ownerUserId !== binding.scope.ownerUserId || receipt.document.childId !== receipt.childId) domainReject('document_binding', 500);
    return receipt;
  }
  async function activeCount(binding: FirestoreAuthorityTransaction, scope: WorkRecoveryScope, request?: Metadata['request'], except?: string) {
    const rows = await binding.transaction.get(query('documents', scope).where('status', '==', 'active').limit(50));
    for (const row of rows.docs) {
      const item = await find(binding, scope, domainParse(uuid, row.get('documentId'), 'invalid_document', 500));
      if (!item) domainReject('document_binding', 500);
      if (request?.kind === 'growth_report' && item.id !== except && item.request.kind === 'growth_report'
        && (item.request.reportMode ?? 'fixed') === (request.reportMode ?? 'fixed')
        && (request.reportMode === 'living' || canonicalJson(item.request.period) === canonicalJson(request.period))) reject('report_exists');
    }
    if (rows.docs.length >= 50) reject('document_limit', 400);
  }
  async function mutate(userId: string, childId: string, opId: string, payload: unknown,
    prepare: (binding: FirestoreAuthorityTransaction, scope: WorkRecoveryScope, loaded: FamilyDocumentSources) => Promise<{ row: Metadata; snapshot?: DocumentSnapshot }>) {
    uuid.parse(childId); uuid.parse(opId);
    const requestHash = fingerprint({ childId, payload });
    return runDocumentTransaction(userId, null, async binding => {
      const old = await prior(binding, opId);
      if (old && (old.childId !== childId || old.fingerprint !== requestHash)) reject('operation_mismatch');
      const scope = await child(binding, childId), loaded = await sources(binding, scope);
      if (old) {
        if (!await find(binding, scope, old.document.id)) reject('not_found', 404);
        return result(binding, scope, old.document, loaded);
      }
      const prepared = await prepare(binding, scope, loaded), oldBodies = await bodiesIfExisting(binding, scope, prepared.row, prepared.snapshot);
      await supplement(binding, scope, loaded, [...(oldBodies.current ? [oldBodies.current] : []), ...oldBodies.history]);
      const item = safe(prepared.row, loaded, oldBodies);
      const preparedSnapshot = prepared.snapshot ? snapshots.prepare(scope, prepared.row.id, prepared.snapshot) : null;
      const change = await binding.prepareChange(opId, 'documents', false, childId);
      const envelope = { ...data.tags(scope), documentId: prepared.row.id, status: prepared.row.status, createdAt: prepared.row.createdAt,
        ...data.seal('family-document', prepared.row.id, scope, metadataSchema, prepared.row, prepared.row.version) };
      const id = operationId(userId, opId), receipt = { ownerUserId: userId, childId, storageEpoch: scope.storageEpoch,
        operationId: opId, fingerprint: requestHash, document: prepared.row };
      const sealed = { ...data.tags(binding.scope), ...data.seal('document-operation', id, binding.scope, operationSchema, receipt) };
      const commit = () => {
        change.commit(); binding.transaction.set(data.ref('documents', 'family-document', prepared.row.id), envelope);
        preparedSnapshot?.commit(binding.transaction); binding.transaction.create(data.ref('document_operations', 'document-operation', id), sealed);
      };
      if (options.deferCommit) options.deferCommit(commit); else commit();
      return item;
    });
  }
  async function bodiesIfExisting(binding: FirestoreAuthorityTransaction, scope: WorkRecoveryScope, row: Metadata, next?: DocumentSnapshot) {
    if (!next) return bodies(binding, scope, row);
    const history: DocumentSnapshot[] = [];
    for (const id of row.historyIds) {
      const item = await snapshots.read(binding.transaction, scope, row.id, id); if (!item) domainReject('snapshot_binding', 500); history.push(item);
    }
    return { current: next, history };
  }
  async function read<T>(userId: string, childId: string, operation: (binding: FirestoreAuthorityTransaction, scope: WorkRecoveryScope) => Promise<T>) {
    uuid.parse(childId); return runDocumentTransaction(userId, childId, binding => operation(binding, { ...binding.scope }));
  }
  return {
    async operationReceipt(userId, childId, opId) {
      uuid.parse(childId); uuid.parse(opId);
      return runDocumentTransaction(userId, null, async binding => {
        const receipt = await prior(binding, opId); if (!receipt || receipt.childId !== childId) return null;
        const scope = await child(binding, childId), row = await find(binding, scope, receipt.document.id); if (!row) return null;
        const loaded = await sources(binding, scope), original = await result(binding, scope, receipt.document, loaded), current = await result(binding, scope, row, loaded);
        return original.current && original.readState === 'ready' && current.current && current.readState === 'ready'
          ? { operationId: opId, documentId: receipt.document.id, savedVersion: receipt.document.version } : null;
      });
    },
    async list(userId, childId, raw = {}) {
      const input = documentListQuerySchema.parse(raw);
      return read(userId, childId, async (binding, scope) => {
        const cursor = input.cursor ? decodeDocumentCursor(input.cursor, 'documents', userId, childId, input.status) : null;
        let q = query('documents', scope).orderBy('createdAt', 'desc').orderBy('documentId', 'desc');
        if (input.status !== 'all') q = q.where('status', '==', input.status);
        if (cursor) q = q.where('createdAt', '<=', cursor.high.at).startAfter(cursor.after.at, cursor.after.id);
        const rows = await binding.transaction.get(q.limit(input.limit + 1)), loaded = await sources(binding, scope), items: FamilyDocument[] = [];
        for (const row of rows.docs.slice(0, input.limit)) {
          const metadata = await find(binding, scope, domainParse(uuid, row.get('documentId'), 'invalid_document', 500));
          if (!metadata) domainReject('document_binding', 500); items.push(await result(binding, scope, metadata, loaded));
        }
        const hasMore = rows.docs.length > input.limit, first = rows.docs[0], last = rows.docs[Math.min(rows.docs.length, input.limit) - 1];
        return { authorityVersion: authorityVersion(binding), canManage: true, items, hasMore,
          nextCursor: hasMore ? encodeDocumentCursor({ v: 1, kind: 'documents', userId, childId, status: input.status,
            high: cursor?.high ?? { at: first.get('createdAt'), id: first.get('documentId') }, after: { at: last.get('createdAt'), id: last.get('documentId') } }) : null };
      });
    },
    async get(userId, childId, id) {
      uuid.parse(id); return read(userId, childId, async (binding, scope) => {
        const row = await find(binding, scope, id); return row ? result(binding, scope, row, await sources(binding, scope)) : null;
      });
    },
    async describe(userId, childId, id) {
      uuid.parse(id); return read(userId, childId, async (binding, scope) => {
        const row = await find(binding, scope, id); return row ? { authorityVersion: authorityVersion(binding), item: await result(binding, scope, row, await sources(binding, scope)) } : null;
      });
    },
    async readContent(userId, childId, id, raw) {
      uuid.parse(id); const input = documentContentQuerySchema.parse(raw);
      return read(userId, childId, async (binding, scope) => {
        const row = await find(binding, scope, id); if (!row) return null;
        const snapshot = await snapshots.read(binding.transaction, scope, id, input.snapshotId, input.snapshotVersion); if (!snapshot) return null;
        const loaded = await sources(binding, scope); await supplement(binding, scope, loaded, [snapshot]);
        return { documentId: id, documentVersion: row.version, authorityVersion: authorityVersion(binding),
          ...sliceDocumentContent(snapshot, documentSnapshotValid(snapshot, loaded), input.offset) };
      });
    },
    async listVersions(userId, childId, id, rawCursor = null) {
      uuid.parse(id); return read(userId, childId, async (binding, scope) => {
        if (!await find(binding, scope, id)) return null;
        const cursor = rawCursor ? decodeDocumentCursor(rawCursor, 'versions', userId, childId, id) : null;
        let q = query('document_snapshots', scope).where('documentId', '==', id).orderBy('snapshotVersion', 'desc');
        if (cursor) q = q.where('snapshotVersion', '<=', cursor.high).where('snapshotVersion', '<', cursor.after);
        const rows = await binding.transaction.get(q.limit(11)), loaded = await sources(binding, scope), values: DocumentSnapshot[] = [];
        for (const row of rows.docs.slice(0, 10)) {
          const value = await snapshots.read(binding.transaction, scope, id, domainParse(uuid, row.get('snapshotId'), 'invalid_document', 500), row.get('snapshotVersion'));
          if (!value) domainReject('snapshot_binding', 500); values.push(value);
        }
        await supplement(binding, scope, loaded, values);
        return { documentId: id, authorityVersion: authorityVersion(binding), items: values.map(value => ({ snapshotId: value.id, snapshotVersion: value.version,
          generatedAt: value.generatedAt, invalidated: !documentSnapshotValid(value, loaded) })),
          nextCursor: rows.docs.length > 10 ? encodeDocumentCursor({ v: 1, kind: 'versions', userId, childId, documentId: id,
            high: cursor?.high ?? values[0].version, after: values.at(-1)!.version }) : null };
      });
    },
    async validatePatch(userId, childId, id, raw, appliedVersion) {
      uuid.parse(id); const patch = documentPatchSchema.parse(raw), seed = { id: randomUUID(), generatedAt: new Date().toISOString() };
      return read(userId, childId, async (binding, scope) => {
        if (authorityVersion(binding) !== patch.authorityVersion) reject('document_changed');
        const row = await find(binding, scope, id); if (!row) reject('not_found', 404);
        if (row.version !== (appliedVersion ?? patch.expectedVersion) || row.status !== 'active') reject('document_changed');
        const previous = row.currentId ? await snapshots.read(binding.transaction, scope, id, row.currentId) : null; if (!previous) reject('document_changed');
        const loaded = await sources(binding, scope); await supplement(binding, scope, loaded, [previous]);
        const preview = appliedVersion === undefined ? applyFamilyDocumentPatch(previous, patch, loaded, row.version + 1, seed) : previous;
        if (appliedVersion !== undefined && !documentSnapshotValid(preview, loaded)) reject('source_changed');
        const sourceBasis = fingerprint({ basis: documentSourceBasis(loaded, row.request), references: preview.sources.map(({ id, version, text }) => ({ id, version, text })).sort((a, b) => a.id.localeCompare(b.id)) });
        return { id, version: row.version, sourceBasis, title: documentSnapshotValid(previous, loaded) ? previous.title : null };
      });
    },
    async create(userId, childId, raw, opId) {
      const request = documentRequestSchema.parse(raw), id = randomUUID(), seed = { id: randomUUID(), generatedAt: new Date().toISOString() };
      return mutate(userId, childId, opId, { action: 'create', request: raw }, async (binding, scope, loaded) => {
        await activeCount(binding, scope, request);
        if ((await binding.transaction.get(data.ref('documents', 'family-document', id))).exists) reject('document_changed');
        const row: Metadata = { id, childId, ownerUserId: userId, request, version: 1, currentId: null, historyIds: [], status: 'active',
          archivedAt: null, autoRefresh: request.kind === 'growth_report', progress: null, createdAt: seed.generatedAt.replace(/(\.\d{3})Z$/u, '$1000Z') };
        const snapshot = request.kind === 'growth_report' ? await reportBatch(binding, scope, row, loaded, null)
          : buildFamilyDocumentSnapshot(loaded, request, 1, null, seed);
        if (snapshot) row.currentId = snapshot.id;
        return { row, snapshot };
      });
    },
    async change(userId, childId, id, raw, opId) {
      uuid.parse(id); const input = documentChangeSchema.parse(raw), seed = { id: randomUUID(), generatedAt: new Date().toISOString() };
      return mutate(userId, childId, opId, { action: 'change', id, change: raw }, async (binding, scope, loaded) => {
        if (authorityVersion(binding) !== input.authorityVersion) reject('document_changed');
        const original = await find(binding, scope, id); if (!original) reject('not_found', 404);
        if (original.version !== input.expectedVersion || original.version >= 2147483647) reject('document_changed');
        const values = await bodies(binding, scope, original); await supplement(binding, scope, loaded, [...(values.current ? [values.current] : []), ...values.history]);
        const row = { ...original, version: original.version + 1 }; let snapshot: DocumentSnapshot | undefined;
        if (input.action === 'refresh') {
          if (row.status !== 'active') reject('document_changed');
          snapshot = row.request.kind === 'growth_report' ? await reportBatch(binding, scope, row, loaded, values.current)
            : buildFamilyDocumentSnapshot(loaded, row.request, row.version, values.current, seed);
        } else if (input.action === 'patch') {
          if (row.status !== 'active' || !values.current) reject('document_changed'); snapshot = applyFamilyDocumentPatch(values.current, input, loaded, row.version, seed);
          if (row.progress?.blocked) row.progress.blocked = false;
        } else if (input.action === 'check_item') {
          if (row.status !== 'active' || !values.current || !documentSnapshotValid(values.current, loaded)
            || !values.current.reportCoverage && values.current.sourceBasis !== documentSourceBasis(loaded, row.request)) reject('source_changed');
          snapshot = structuredClone(values.current); const section = snapshot.sections.find(value => value.id === input.sectionId && value.kind === 'checklist');
          const item = section?.items.find(value => value.id === input.itemId); if (!item) reject('invalid_input', 400);
          item.checked = input.checked; snapshot.id = seed.id; snapshot.version = row.version; snapshot.generatedAt = seed.generatedAt;
          snapshot.changes = ['家長更新準備清單的完成標記。'];
        } else {
          if (input.action === 'archive' && row.status !== 'active' || input.action === 'restore' && row.status !== 'archived') reject('document_changed');
          if (input.action === 'archive' && row.request.kind !== 'growth_report' && (!values.current || !documentSnapshotValid(values.current, loaded))) reject('source_changed');
          if (input.action === 'restore') await activeCount(binding, scope, row.request, row.id);
          row.status = input.action === 'archive' ? 'archived' : 'active'; row.archivedAt = input.action === 'archive' ? seed.generatedAt : null;
        }
        if (snapshot) { row.historyIds = [...(row.currentId ? [row.currentId] : []), ...row.historyIds].slice(0, 10); row.currentId = snapshot.id; }
        return { row, snapshot };
      });
    },
    async exportSnapshot(userId, childId, id, raw) {
      uuid.parse(id); const input = documentExportSchema.parse(raw);
      return read(userId, childId, async (binding, scope) => {
        if (authorityVersion(binding) !== input.authorityVersion) reject('document_changed');
        if (!await find(binding, scope, id)) return null;
        const snapshot = await snapshots.read(binding.transaction, scope, id, input.snapshotId, input.snapshotVersion); if (!snapshot) return null;
        const loaded = await sources(binding, scope); await supplement(binding, scope, loaded, [snapshot]);
        if (!documentSnapshotValid(snapshot, loaded)) reject('source_changed'); return snapshot;
      });
    },
    async refreshPending(generation) { uuid.parse(generation); domainReject('domain_not_ready', 503); },
  };
}

export const firestoreFamilyDocumentSchemas = { metadata: metadataSchema, operation: operationSchema } as const;
