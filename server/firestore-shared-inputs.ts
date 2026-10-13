import { createHash, randomUUID } from 'node:crypto';
import type { Query, DocumentSnapshot } from '@google-cloud/firestore';
import { z } from 'zod';
import { sharedInputCreateSchema, sourceManagementChangeSchema, sourceManagementSchema,
  type SharedInput, type SharedInputCreate, type SourceManagement, type SourceManagementChange } from '../src/shared/shared-inputs.ts';
import { photoDraftSchema } from '../src/shared/photos.ts';
import { emptyCareDetails } from '../src/shared/care.ts';
import { careValuesSchema } from './care-validation.ts';
import type { SharedInputStore } from './shared-input-store.ts';
import { SOURCE_WATCHES } from './knowledge-source-catalog.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { createFirestoreCareStore } from './firestore-care.ts';
import type { FirestoreOnlineMutation } from './firestore-online.ts';

const uuid = z.uuid(), version = z.number().int().positive().max(2147483646), time = z.iso.datetime({ offset: true });
const text = (max: number) => z.string().max(max).refine(value => !/[\u0000\uD800-\uDFFF]/u.test(value));
const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const leaseSchema = z.object({ runId: uuid, until: time, resourceVersion: version.optional(), authorizationVersion: z.string().min(1), generation: uuid }).strict();
const extractionSchema = z.object({ state: z.enum(['not_requested', 'running', 'available', 'failed', 'unknown']),
  runId: uuid.nullable(), excerpt: text(10000).nullable(), draft: photoDraftSchema.nullable(), stopReason: text(256).nullable(),
  processedAt: time.nullable(), model: text(256).nullable() }).strict();
export const firestoreSharedInputSchema = z.object({ id: uuid, childId: uuid, ownerUserId: z.string().min(1).max(256), version, createdAt: time,
  kind: z.enum(['paste', 'public_source', 'personal_source']), sourceNotes: text(1000), sourceId: text(80).nullable(), sourceLabel: text(200),
  sourceUrl: text(1000).nullable(), sourceDateText: text(200).nullable(), sha256: hash.nullable(), retrievedAt: time.nullable(),
  bodyHash: hash, parts: z.number().int().min(1).max(4), fetchState: z.enum(['not_requested', 'running', 'ready', 'failed', 'unknown']),
  fetchLease: leaseSchema.nullable(), extraction: extractionSchema, extractionLease: leaseSchema.nullable(),
  recordId: uuid.nullable(), confirmationKind: z.enum(['reference', 'family_record']).nullable(), management: sourceManagementSchema.nullable(),
}).strict();
export const firestoreSharedInputPartSchema = z.object({ inputId: uuid, index: z.number().int().min(0).max(3), version, text: text(16001) }).strict();
export const firestoreSourceManagementRevisionSchema = z.object({ inputId: uuid, childId: uuid, ownerUserId: z.string().min(1).max(256),
  version, previousVersion: version, changedAt: time, reason: text(500), previousManagement: sourceManagementSchema.nullable(),
  management: sourceManagementSchema }).strict();
export const firestoreSharedInputTombstoneSchema = z.object({ id: uuid, childId: uuid, version, operationId: uuid, deletedAt: time }).strict();
type Row = z.infer<typeof firestoreSharedInputSchema>;
type Loaded = { row: Row; text: string };
type Prepared<T> = { value: T; changeSeq: string; commit(): void };
type Phase = 'fetch' | 'extraction';
const pathPattern = /^\/api\/children\/([0-9a-f-]{36})\/inputs(?:\/([0-9a-f-]{36})\/(manage|confirm|delete))?$/iu;
const emptyExtraction = (): Row['extraction'] => ({ state: 'not_requested', runId: null, excerpt: null, draft: null,
  stopReason: null, processedAt: null, model: null });
const confirmationSchema = z.object({ expectedVersion: version, confirmShared: z.literal(true), kind: z.enum(['reference', 'family_record']),
  confirmChildFact: z.boolean(), values: careValuesSchema }).strict();
const publicSources = SOURCE_WATCHES.filter(source => source.kind === 'page' && source.audience === 'public_noncommercial');
export interface FirestoreSharedInputStore extends SharedInputStore {
  claim(...args:Parameters<SharedInputStore['claim']>):Promise<Awaited<ReturnType<SharedInputStore['claim']>> & {claimedRun?: import('./product-agent-store.ts').AgentRunClaim}>;
  mutation: FirestoreOnlineMutation;
  read(binding: Binding, id: string): Promise<SharedInput>;
  prepareCreate(binding: Binding, opId: string, input: SharedInputCreate, management?: SourceManagement): Promise<Prepared<SharedInput>>;
  prepareManage(binding: Binding, opId: string, id: string, change: SourceManagementChange): Promise<Prepared<SharedInput>>;
}

/** Private source text never enters the public knowledge index. Writes share original online/Agent receipts. */
export function createFirestoreSharedInputStore(options: FirestoreDomainOptions): FirestoreSharedInputStore {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options), care = createFirestoreCareStore(options);
  const rowRef = (id: string) => data.ref('shared_inputs', 'shared-input', id);
  const partId = (id: string, index: number) => JSON.stringify([id, index]);
  const partRef = (id: string, index: number) => data.ref('shared_input_parts', 'shared-input-part', partId(id, index));
  const query = (b: Binding, suffix: string) => {
    let q: Query = data.collection(suffix); for (const [key, value] of Object.entries(data.tags(b.scope))) q = q.where(key, '==', value); return q;
  };
  function open<T>(b: Binding, kind: string, id: string, schema: z.ZodType<T>, snap: DocumentSnapshot) {
    if (!snap.exists || Object.entries(data.tags(b.scope)).some(([key, value]) => snap.get(key) !== value)) domainReject('not_found', 404);
    return data.open(kind, id, b.scope, schema, snap);
  }
  async function load(b: Binding, id: string): Promise<Loaded> {
    domainParse(uuid, id); const snap = await b.transaction.get(rowRef(id));
    if (!snap.exists || snap.get('live') !== true) domainReject('not_found', 404);
    const row = open(b, 'shared-input', id, firestoreSharedInputSchema, snap);
    if (row.id !== id || row.childId !== b.scope.childId || row.ownerUserId !== b.scope.ownerUserId
      || row.version !== snap.get('recordVersion') || row.createdAt !== snap.get('createdAt') || row.id !== snap.get('entityId')) domainReject('input_binding', 500);
    const parts = await Promise.all(Array.from({ length: row.parts }, (_, index) => b.transaction.get(partRef(id, index))));
    const body = parts.map((snap, index) => {
      const part = open(b, 'shared-input-part', partId(id, index), firestoreSharedInputPartSchema, snap);
      if (part.inputId !== id || part.index !== index || part.version !== row.version || part.version !== snap.get('recordVersion')) domainReject('input_binding', 500);
      return part.text;
    }).join('');
    if (body.length > 64000 || digest(body) !== row.bodyHash || row.sha256 !== (body.trim() ? digest(body) : null)) domainReject('input_binding', 500);
    return { row, text: body };
  }
  function view(item: Loaded): SharedInput {
    const { bodyHash: _hash, parts: _parts, fetchLease, extractionLease, ...row } = item.row;
    return { ...row, canManage: true, text: item.text,
      fetchState: row.fetchState === 'running' && (!fetchLease || Date.parse(fetchLease.until) <= Date.now()) ? 'unknown' : row.fetchState,
      extraction: { ...row.extraction, state: row.extraction.state === 'running' && (!extractionLease || Date.parse(extractionLease.until) <= Date.now()) ? 'unknown' : row.extraction.state } };
  }
  function write(b: Binding, item: Loaded, oldParts = 0) {
    const pieces: string[] = [];
    for (let start = 0; start < item.text.length || start === 0;) {
      let end = Math.min(item.text.length, start + 16000);
      if (end < item.text.length && /[\uD800-\uDBFF]/u.test(item.text[end - 1])) end++;
      pieces.push(item.text.slice(start, end)); if (end === item.text.length) break; start = end;
    }
    item.row.parts = pieces.length; item.row.bodyHash = digest(item.text);
    const row = domainParse(firestoreSharedInputSchema, item.row, 'input_binding', 500);
    const envelope = { ...data.tags(b.scope), live: true, entityId: row.id, createdAt: row.createdAt,
      ...data.seal('shared-input', row.id, b.scope, firestoreSharedInputSchema, row, row.version) };
    const parts = pieces.map((body, index) => ({ ...data.tags(b.scope), entityId: row.id,
      ...data.seal('shared-input-part', partId(row.id, index), b.scope, firestoreSharedInputPartSchema,
        { inputId: row.id, index, text: body, version: row.version }, row.version) }));
    return () => {
      b.transaction.set(rowRef(row.id), envelope);
      parts.forEach((part, index) => b.transaction.set(partRef(row.id, index), part));
      for (let index = parts.length; index < oldParts; index++) b.transaction.delete(partRef(row.id, index));
    };
  }
  function versionMatches(row: Row, expected: number) { if (row.version !== domainParse(version, expected)) domainReject('version_conflict'); }
  function managementFor(raw: SourceManagement, body: string) {
    const management = domainParse(sourceManagementSchema, raw);
    if (!management.enabled) management.modelExcerpt = null;
    if (management.modelExcerpt !== null && (!management.modelExcerpt.trim() || !body.includes(management.modelExcerpt))) domainReject('invalid_input', 400);
    return management;
  }
  function revision(b: Binding, item: Loaded, previous: SourceManagement | null, reason: string) {
    const row = item.row, id = JSON.stringify([row.id, row.version]);
    const value = { inputId: row.id, childId: row.childId, ownerUserId: row.ownerUserId, version: row.version, previousVersion: row.version - 1,
      changedAt: new Date().toISOString(), reason, previousManagement: previous, management: row.management! };
    const envelope = { ...data.tags(b.scope), entityId: row.id, entityVersion: row.version,
      ...data.seal('shared-input-management', id, b.scope, firestoreSourceManagementRevisionSchema, value, row.version) };
    return () => b.transaction.create(data.ref('shared_input_management_revisions', 'shared-input-management', id), envelope);
  }
  async function prepareCreate(b: Binding, opId: string, raw: SharedInputCreate, management?: SourceManagement): Promise<Prepared<SharedInput>> {
    const input = domainParse(sharedInputCreateSchema, raw);
    const count = await b.transaction.get(query(b, 'shared_inputs').where('live', '==', true).limit(50));
    if (count.size >= 50) domainReject('inputs_capacity');
    const source = input.kind === 'public_source' ? publicSources.find(source => source.id === input.sourceId) : null;
    if (input.kind === 'public_source' && !source) domainReject('invalid_input', 400);
    const id = randomUUID(), body = input.kind === 'public_source' ? '' : input.text;
    if ((await b.transaction.get(rowRef(id))).exists) domainReject('input_conflict');
    const row: Row = { id, childId: b.scope.childId, ownerUserId: b.scope.ownerUserId, version: management ? 2 : 1, createdAt: new Date().toISOString(),
      kind: input.kind, sourceNotes: input.kind === 'personal_source' ? input.sourceNotes : '', sourceId: source?.id ?? null,
      sourceLabel: input.kind === 'public_source' ? source!.publisher : input.sourceLabel,
      sourceUrl: input.kind === 'public_source' ? source!.url : input.sourceUrl, sourceDateText: input.kind === 'public_source' ? null : input.sourceDateText,
      sha256: body.trim() ? digest(body) : null, retrievedAt: null, bodyHash: digest(body), parts: 1,
      fetchState: body.trim() ? 'ready' : 'not_requested', fetchLease: null, extraction: emptyExtraction(), extractionLease: null,
      recordId: null, confirmationKind: null, management: management ? managementFor(management, body) : null };
    const item = { row, text: body }, save = write(b, item);
    const history = management ? revision(b, item, null, '本人在對話核對私人來源用途及模型片段授權') : () => {};
    const change = await b.prepareChange(opId, 'care', false);
    return { value: view(item), changeSeq: change.changeSeq, commit() { change.commit(); save(); history(); } };
  }
  async function prepareManage(b: Binding, opId: string, id: string, raw: SourceManagementChange): Promise<Prepared<SharedInput>> {
    const input = domainParse(sourceManagementChangeSchema, raw), item = await load(b, id), row = item.row;
    versionMatches(row, input.expectedVersion);
    if ([row.fetchState, row.extraction.state].some(state => state === 'running' || state === 'unknown')) domainReject('input_processing');
    if (input.content && (row.kind !== 'personal_source' || row.recordId)) domainReject('invalid_input', 400);
    const previous = row.management, content = input.content, oldParts = row.parts;
    const changed = content !== null && (content.sourceLabel !== row.sourceLabel || content.sourceUrl !== row.sourceUrl
      || content.sourceDateText !== row.sourceDateText || content.sourceNotes !== row.sourceNotes || content.text !== item.text);
    if (changed && content) {
      Object.assign(row, { sourceLabel: content.sourceLabel, sourceUrl: content.sourceUrl, sourceDateText: content.sourceDateText, sourceNotes: content.sourceNotes,
        sha256: content.text.trim() ? digest(content.text) : null, retrievedAt: null, fetchState: content.text.trim() ? 'ready' : 'not_requested', fetchLease: null });
      item.text = content.text;
    }
    row.management = managementFor({ ...input.management, modelExcerpt: changed ? null : input.management.modelExcerpt }, item.text);
    if (changed || !row.management.enabled) { row.extraction = emptyExtraction(); row.extractionLease = null; }
    row.version++;
    const save = write(b, item, oldParts), history = revision(b, item, previous, input.reason), change = await b.prepareChange(opId, 'care', false);
    return { value: view(item), changeSeq: change.changeSeq, commit() { change.commit(); save(); history(); } };
  }
  async function prepareConfirm(b: Binding, opId: string, id: string, raw: unknown) {
    const input = domainParse(confirmationSchema, raw), item = await load(b, id), row = item.row;
    versionMatches(row, input.expectedVersion);
    if (row.recordId || row.fetchState !== 'ready') domainReject('not_found', 404);
    if (row.extraction.state === 'running' && Date.parse(row.extractionLease!.until) > Date.now()) domainReject('input_processing');
    if (input.kind === 'family_record' && !input.confirmChildFact) domainReject('invalid_input', 400);
    const reference = input.kind === 'reference';
    const source = (reference ? '外部參考（不是孩子事實）' : '家長確認與孩子有關') + ' · 輸入 ' + id + ' · SHA-256 ' + row.sha256 + ' · 保存 ' + row.createdAt + ' · ' + row.sourceLabel;
    const record = await care.prepareRecord(b, opId, { ...input.values, details: reference ? emptyCareDetails() : input.values.details, source });
    row.recordId = record.value.id; row.confirmationKind = input.kind; row.version++;
    const save = write(b, item, row.parts);
    return { value: { input: view(item), recordId: row.recordId }, changeSeq: record.changeSeq, commit() { record.commit(); save(); } };
  }
  async function prepareDelete(b: Binding, opId: string, id: string, expected: number) {
    const item = await load(b, id); versionMatches(item.row, expected);
    const record = item.row.recordId ? await care.readRecord(b, item.row.recordId) : null;
    const change = record ? await care.prepareDeletion(b, record.id, record.version, opId) : await b.prepareChange(opId, 'care', true);
    const deleted = { id, childId: b.scope.childId, version: expected + 1, operationId: opId, deletedAt: new Date().toISOString() };
    const envelope = { ...data.tags(b.scope), entityId: id, createdAt: item.row.createdAt, live: false,
      ...data.seal('shared-input-tombstone', id, b.scope, firestoreSharedInputTombstoneSchema, deleted, deleted.version) };
    return { value: { deleted: true as const }, changeSeq: change.changeSeq, commit() {
      change.commit(); b.transaction.set(rowRef(id), envelope);
      for (let i = 0; i < item.row.parts; i++) b.transaction.delete(partRef(id, i));
    } };
  }
  async function direct<T>(owner: string, child: string, fn: (b: Binding, opId: string) => Promise<Prepared<T>>) {
    const opId = randomUUID(); return authority.runTransaction(owner, child, async b => { const result = await fn(b, opId); result.commit(); return result.value; });
  }
  const authorized = (b: Binding, row: Row, phase: Phase, runId: string) => {
    const lease = phase === 'fetch' ? row.fetchLease : row.extractionLease, state = phase === 'fetch' ? row.fetchState : row.extraction.state;
    return !row.recordId && row.management?.enabled !== false && state === 'running' && lease?.runId === runId
      && (lease.resourceVersion === undefined || lease.resourceVersion === row.version) && lease.authorizationVersion === b.authorizationVersion && lease.generation === b.generation && Date.parse(lease.until) > Date.now();
  };
  const store: FirestoreSharedInputStore = {
    prepareCreate, prepareManage, read: async (b, id) => view(await load(b, id)),
    async list(owner, child) {
      return authority.runTransaction(owner, child, async b => {
        const rows = await b.transaction.get(query(b, 'shared_inputs').where('live', '==', true).orderBy('createdAt', 'desc').orderBy('entityId', 'asc').limit(50));
        const inputs: SharedInput[] = []; for (const snap of rows.docs) inputs.push(view(await load(b, domainParse(uuid, snap.get('entityId'), 'input_binding', 500))));
        return { inputs, sources: publicSources.map(({ id, url, publisher }) => ({ id, url, publisher })), canCreate: true };
      });
    },
    get: (owner, child, id) => authority.runTransaction(owner, child, async b => view(await load(b, id))),
    async managementHistory(owner, child, id) {
      return authority.runTransaction(owner, child, async b => {
        const item = await load(b, id), rows = await b.transaction.get(query(b, 'shared_input_management_revisions').where('entityId', '==', id).orderBy('entityVersion', 'desc').limit(21));
        return { inputId: id, childId: child, ownerUserId: owner, version: item.row.version, hasMore: rows.size > 20,
          revisions: rows.docs.slice(0, 20).map(snap => {
            const revision = open(b, 'shared-input-management', JSON.stringify([id, snap.get('entityVersion')]), firestoreSourceManagementRevisionSchema, snap);
            if (revision.inputId !== id || revision.childId !== child || revision.ownerUserId !== owner || revision.version !== snap.get('recordVersion')) domainReject('input_binding', 500);
            return { version: revision.version, changedAt: revision.changedAt, reason: revision.reason, management: revision.management };
          }) };
      });
    },
    create: (owner, child, input) => direct(owner, child, (b, op) => prepareCreate(b, op, input)),
    manage: (owner, child, id, input) => direct(owner, child, (b, op) => prepareManage(b, op, id, input)),
    confirm: (owner, child, id, input) => direct(owner, child, (b, op) => prepareConfirm(b, op, id, input)),
    delete: (owner, child, id, expected) => direct(owner, child, (b, op) => prepareDelete(b, op, id, expected)),
    async claim(owner, child, id, phase, expected, excerpt) {
      const runId = randomUUID();
      return authority.runTransaction(owner, child, async b => {
        const item = await load(b, id), row = item.row;
        if (row.management?.enabled === false || row.recordId || phase === 'fetch' && !['public_source', 'personal_source'].includes(row.kind)
          || phase === 'extraction' && row.fetchState !== 'ready') domainReject('not_found', 404);
        const state = phase === 'fetch' ? row.fetchState : row.extraction.state;
        if (state !== 'not_requested' && (state !== 'failed' || row.version !== expected)) return { created: false, input: view(item), scope: null, runId: null };
        versionMatches(row, expected);
        const lease = { runId, resourceVersion: row.version + 1, until: new Date(Date.now() + (phase === 'fetch' ? 25000 : 95000)).toISOString(), authorizationVersion: b.authorizationVersion, generation: b.generation };
        if (phase === 'extraction') {
          if (!excerpt?.trim() || excerpt.length > 10000 || !item.text.includes(excerpt)) domainReject('invalid_input', 400);
          row.extraction = { ...emptyExtraction(), state: 'running', runId, excerpt }; row.extractionLease = lease;
        } else {
          if (!row.sourceUrl || row.kind === 'public_source' && !publicSources.some(source => source.id === row.sourceId)) domainReject('not_found', 404);
          row.fetchState = 'running'; row.fetchLease = lease;
          if (row.management) row.management = { ...row.management, modelExcerpt: null };
        }
        row.version++; const save = write(b, item, row.parts), change = await b.prepareChange(runId, 'care', false);
        save(); change.commit();
        const scope = { userId: owner, childId: child, workspaceId: b.scope.workspaceId,
          authorizationVersion: b.authorizationVersion, dataVersion: b.scope.storageEpoch + ':' + change.changeSeq };
        const claimedRun: import('./product-agent-store.ts').AgentRunClaim | undefined = phase === 'extraction' ? {
          runId,scope,created:true,sourceMessageId:null,state:'running',expiresAt:lease.until,storageEpoch:b.scope.storageEpoch,
          trigger:{kind:'interactive',reference:id},recipeId:'shared-capture',purpose:'shared-extraction',sourceResource:{kind:'shared-input',id,version:row.version}} : undefined;
        return { created: true, input: view(item), runId, scope, claimedRun };
      });
    },
    authorized: (owner, child, id, phase, runId) => authority.runTransaction(owner, child, async b => authorized(b, (await load(b, id)).row, phase, runId)),
    async finishFetch(owner, child, id, runId, content, uncertain) {
      return direct(owner, child, async (b, op) => {
        const item = await load(b, id), row = item.row, oldParts = row.parts;
        if (row.fetchLease?.runId !== runId || row.recordId) domainReject('not_found', 404);
        if (row.fetchState !== 'running') return { value: view(item), changeSeq: b.changeSeq, commit() {} };
        const allowed = authorized(b, row, 'fetch', runId);
        if (content && allowed) {
          if (!content.text.trim() || !text(64000).safeParse(content.text).success || content.url !== row.sourceUrl) domainReject('invalid_input', 400);
          item.text = content.text; row.sha256 = digest(content.text); row.retrievedAt = new Date().toISOString(); row.sourceDateText = content.sourceDateText ?? row.sourceDateText;
          row.extraction = emptyExtraction(); row.extractionLease = null;
          if (row.management) row.management = { ...row.management, modelExcerpt: null };
        }
        row.fetchState = allowed && content ? 'ready' : !allowed || uncertain ? 'unknown' : 'failed'; row.version++;
        const save = write(b, item, oldParts), change = await b.prepareChange(op, 'care', false);
        return { value: view(item), changeSeq: change.changeSeq, commit() { change.commit(); save(); } };
      });
    },
    async finishExtraction(owner, child, id, runId, draft, stopReason, model) {
      return direct(owner, child, async (b, op) => {
        const item = await load(b, id), row = item.row;
        if (row.extraction.runId !== runId || row.recordId) domainReject('not_found', 404);
        if (row.extraction.state !== 'running') return { value: view(item), changeSeq: b.changeSeq, commit() {} };
        const allowed = authorized(b, row, 'extraction', runId);
        row.extraction.draft = allowed && draft ? domainParse(photoDraftSchema, draft) : null;
        row.extraction.state = row.extraction.draft ? 'available' : !allowed || stopReason === 'cancelled' || stopReason === 'deadline' ? 'unknown' : 'failed';
        row.extraction.stopReason = allowed ? stopReason : 'unauthorized_or_expired'; row.extraction.model = model; row.extraction.processedAt = new Date().toISOString(); row.version++;
        const save = write(b, item, row.parts), change = await b.prepareChange(op, 'care', false);
        return { value: view(item), changeSeq: change.changeSeq, commit() { change.commit(); save(); } };
      });
    },
    mutation: {
      supports: path => pathPattern.test(path),
      async prepare(root, submission) {
        const match = pathPattern.exec(submission.path); if (!match) domainReject('not_found', 404);
        const childId = domainParse(uuid, match[1].toLowerCase()); if (!await root.readChild(childId)) domainReject('not_found', 404);
        const b: Binding = { ...root, scope: { ...root.scope, childId }, prepareChange: (op, kind, deleted) => root.prepareChange(op, kind, deleted, childId) };
        const id = match[2]?.toLowerCase(), action = match[3], op = submission.operation.opId;
        let result: Prepared<unknown>, wrap = false;
        if (!id) { result = await prepareCreate(b, op, domainParse(sharedInputCreateSchema, submission.payload)); wrap = true; }
        else if (action === 'manage') { result = await prepareManage(b, op, id, domainParse(sourceManagementChangeSchema, submission.payload)); wrap = true; }
        else if (action === 'confirm') result = await prepareConfirm(b, op, id, submission.payload);
        else { const input = domainParse(z.object({ expectedVersion: version, confirmDelete: z.literal(true) }).strict(), submission.payload);
          result = await prepareDelete(b, op, id, input.expectedVersion); }
        return { childId, changeSeq: result.changeSeq, statusCode: id ? 200 : 201, result: wrap ? { input: result.value } : result.value, commit: result.commit };
      },
    },
  };
  return store;
}
