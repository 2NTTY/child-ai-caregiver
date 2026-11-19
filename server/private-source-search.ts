import { FieldPath, type DocumentSnapshot } from '@google-cloud/firestore';
import { z } from 'zod';
import { KNOWLEDGE_EMBEDDING } from '../src/shared/knowledge.ts';
import type { FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, firestoreDomainUuid } from './firestore-domain-data.ts';
import type { WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';
import type { PrivateSourceModelSession, PrivateSourceModelSessionOptions } from './private-source-model-session.ts';
import { PRIVATE_INDEX_COLLECTION, PRIVATE_INDEX_FAMILY, privateIndexId, privateIndexRecord, privateIndexTag } from './private-source-index-record.ts';

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const vectorSchema = z.array(z.number().finite()).length(KNOWLEDGE_EMBEDDING.dimensions)
  .refine(vector => vector.some(value => value !== 0));
const queryBase = { cardId: z.uuid(), operationId: z.uuid(), identity: digest, rootRunId: z.uuid(),
  deadlineAtMs: z.int().positive(), generation: z.uuid(), authorizationVersion: z.string().regex(/^(0|[1-9][0-9]*)$/u),
  grant: digest, accessRevision: z.int().positive() };
export const PRIVATE_QUERY_FAMILY = 'private-source-query';
export const PRIVATE_QUERY_COLLECTION = 'source_card_documents';
export const PRIVATE_QUERY_SLOTS = 16;
export const privateQueryRecord = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('receipt'), ...queryBase, state: z.enum(['unstarted', 'pending', 'ready']) }),
  z.strictObject({ kind: z.literal('vector'), ...queryBase, slot: z.int().min(0).lt(PRIVATE_QUERY_SLOTS), vector: vectorSchema }),
]);
export type PrivateQueryRecord = z.infer<typeof privateQueryRecord>;
export function privateQueryId(scope: WorkRecoveryScope, row: Pick<PrivateQueryRecord, 'kind' | 'operationId' | 'cardId'> & { slot?: number }) {
  return firestoreDomainHash(['private-source-query/v1', scope.ownerUserId, row.kind,
    ...(row.kind === 'receipt' ? [row.operationId] : [row.cardId, row.slot])]);
}

type Unit = Extract<z.infer<typeof privateIndexRecord>, { kind: 'unit' }>;
interface Head { cardId: string; documentId: string; version: string; title: string; url: string; grant: string;
  rag?: { incarnation: string; accessRevision: number } }
interface Documents {
  withIndexCard<T>(owner: string, cardId: string,
    fn: (binding: FirestoreAuthorityTransaction, grant: string, accessRevision: number) => Promise<T>): Promise<T>;
  readIndexHeadIn(binding: FirestoreAuthorityTransaction, cardId: string, grant: string, accessRevision: number, documentId: string): Promise<Head | null>;
}
export interface PrivateSourceSearchOptions {
  domain: FirestoreDomainData;
  documents: Documents;
  openSession(options: Omit<PrivateSourceModelSessionOptions, 'routing' | 'rootBudget'>): Promise<Pick<PrivateSourceModelSession, 'embed' | 'settingsVersion' | 'billingSource' | 'close'>>;
  currentAuth(owner: string): Promise<{ userId: string; disabled: boolean; emailVerified: boolean }>;
}
const cursorSchema = z.strictObject({ operationId: z.uuid(), after: digest });
const same = (left: unknown, right: unknown) => firestoreDomainHash(left) === firestoreDomainHash(right);
const expired = (): never => domainReject('private_query_expired');
const changed = (): never => domainReject('private_source_changed');
const invalid = (): never => domainReject('private_source_integrity', 503);

/** Owner-only, bounded pages of reviewed source units. The vector is never a source-authority cache. */
export function createPrivateSourceSearch(options: PrivateSourceSearchOptions) {
  const { domain: data, documents } = options;
  const queryRef = (id: string) => data.ref(PRIVATE_QUERY_COLLECTION, PRIVATE_QUERY_FAMILY, id);
  const indexRef = (id: string) => data.ref(PRIVATE_INDEX_COLLECTION, PRIVATE_INDEX_FAMILY, id);
  const identity = (b: FirestoreAuthorityTransaction, cardId: string, grant: string, revision: number, query: string) =>
    firestoreDomainHash(['private-source-query-identity/v1', b.scope, b.generation, b.authorizationVersion, cardId, grant, revision, query]);
  function openQuery(b: FirestoreAuthorityTransaction, id: string, snap: DocumentSnapshot) {
    if (!snap.exists) return null;
    const row = data.open(PRIVATE_QUERY_FAMILY, id, b.scope, privateQueryRecord, snap);
    if (privateQueryId(b.scope, row) !== id || snap.ref.path !== queryRef(id).path) return invalid();
    return row;
  }
  function saveQuery(b: FirestoreAuthorityTransaction, row: PrivateQueryRecord) {
    const id = privateQueryId(b.scope, row);
    b.transaction.set(queryRef(id), { ...data.tags(b.scope), ...data.seal(PRIVATE_QUERY_FAMILY, id, b.scope, privateQueryRecord, row) });
  }
  async function authenticated(owner: string) {
    const auth = await options.currentAuth(owner);
    return !!auth && auth.userId === owner && !auth.disabled && auth.emailVerified;
  }
  function assertBinding(b: FirestoreAuthorityTransaction, owner: string) {
    if (b.actorUserId !== owner || b.scope.ownerUserId !== owner || b.sharedAccess) return changed();
  }
  function headMatches(head: Head | null, unit: Unit) {
    return !!head && head.cardId === unit.cardId && head.documentId === unit.documentId && head.version === unit.version
      && head.grant === unit.grant && head.rag?.incarnation === unit.incarnation && head.rag.accessRevision === unit.accessRevision;
  }
  async function currentHeads(b: FirestoreAuthorityTransaction, cardId: string, grant: string, revision: number, units: Unit[]) {
    const ids = [...new Set(units.map(unit => unit.documentId))];
    return new Map(await Promise.all(ids.map(async id =>
      [id, await documents.readIndexHeadIn(b, cardId, grant, revision, id)] as const)));
  }
  async function readPage(b: FirestoreAuthorityTransaction, cardId: string, grant: string, revision: number, after: string | null) {
    const tag = privateIndexTag(b.scope, b.generation, b.authorizationVersion, cardId, grant, revision);
    let query = data.collection(PRIVATE_INDEX_COLLECTION).where('targetTag', '==', tag).orderBy(FieldPath.documentId()).limit(33);
    if (after) query = query.startAfter(after);
    const rows = await b.transaction.get(query);
    const units = rows.docs.slice(0, 32).map(snap => {
      const id = domainParse(digest, snap.get('id'), 'private_source_integrity', 503);
      const unit = data.open(PRIVATE_INDEX_FAMILY, id, b.scope, privateIndexRecord, snap);
      if (unit.kind !== 'unit' || privateIndexId(b.scope, unit) !== id || snap.ref.path !== indexRef(id).path
        || unit.cardId !== cardId || unit.grant !== grant || unit.accessRevision !== revision
        || unit.generation !== b.generation || unit.authorizationVersion !== b.authorizationVersion) return invalid();
      return unit;
    });
    const heads = await currentHeads(b, cardId, grant, revision, units);
    const candidates = units.filter(unit => headMatches(heads.get(unit.documentId) ?? null, unit));
    return { candidates, after: rows.size > 32 ? rows.docs[31]!.id : null };
  }
  async function searchPage(owner: string, rawCardId: string, rawQuery: string,
    input: { operationId: string; cursor?: string | null; signal?: AbortSignal }) {
    const cardId = domainParse(z.uuid(), rawCardId), operationId = domainParse(z.uuid(), input.operationId);
    const query = domainParse(z.string().trim().min(1).max(2000).refine(value => value.isWellFormed() && !value.includes('\0')), rawQuery);
    const signal = input.signal ?? new AbortController().signal;
    signal.throwIfAborted();
    if (!await authenticated(owner)) return changed();
    let after: string | null = null;
    if (input.cursor != null) {
      let parsed: unknown;
      try {
        if (input.cursor.length > 600) throw new Error();
        parsed = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'));
      } catch { domainReject('invalid_cursor', 400); }
      const cursor = domainParse(cursorSchema, parsed, 'invalid_cursor');
      if (cursor.operationId !== operationId) domainReject('invalid_cursor', 400);
      after = cursor.after;
    }
    const slot = Number.parseInt(firestoreDomainHash(operationId).slice(0, 8), 16) % PRIVATE_QUERY_SLOTS;
    const admitted = await documents.withIndexCard(owner, cardId, async (b, grant, revision) => {
      assertBinding(b, owner);
      const expected = identity(b, cardId, grant, revision, query);
      const receiptId = privateQueryId(b.scope, { kind: 'receipt', cardId, operationId });
      const cacheId = privateQueryId(b.scope, { kind: 'vector', cardId, operationId, slot });
      const [receiptSnap, cacheSnap] = await b.transaction.getAll(queryRef(receiptId), queryRef(cacheId));
      const receipt = openQuery(b, receiptId, receiptSnap!), cached = openQuery(b, cacheId, cacheSnap!);
      if (receipt && (receipt.kind !== 'receipt' || receipt.identity !== expected)) return changed();
      if (receipt && receipt.deadlineAtMs <= Date.now()) return expired();
      if (receipt?.kind === 'receipt' && receipt.state === 'pending') domainReject('private_query_unknown');
      if (after && !receipt) domainReject('invalid_cursor', 400);
      const page = await readPage(b, cardId, grant, revision, after);
      if (receipt?.kind === 'receipt' && receipt.state === 'ready') {
        if (cached?.kind !== 'vector' || !same(cached.identity, receipt.identity) || cached.operationId !== operationId
          || cached.rootRunId !== receipt.rootRunId || cached.deadlineAtMs !== receipt.deadlineAtMs) return expired();
        return { page, receipt, vector: cached.vector, scope: b.scope, fresh: false as const };
      }
      const fresh: Extract<PrivateQueryRecord, { kind: 'receipt' }> = receipt ?? { kind: 'receipt', cardId, operationId, identity: expected,
        rootRunId: firestoreDomainUuid(['private-source-query-root/v1', b.scope, operationId]), deadlineAtMs: Date.now() + 120_000,
        generation: b.generation, authorizationVersion: b.authorizationVersion, grant, accessRevision: revision, state: 'unstarted' };
      const pending = { ...fresh, state: page.candidates.length ? 'pending' as const : 'unstarted' as const };
      signal.throwIfAborted();
      saveQuery(b, pending);
      return { page, receipt: pending, vector: null, scope: b.scope, fresh: page.candidates.length > 0 };
    });
    let vector = admitted.vector;
    const receipt = admitted.receipt;
    if (admitted.fresh && receipt) {
      const authorize = async () => {
        signal.throwIfAborted();
        if (Date.now() >= receipt.deadlineAtMs || !await authenticated(owner)) return false;
        return documents.withIndexCard(owner, cardId, async (b, grant, revision) => {
          assertBinding(b, owner);
          return identity(b, cardId, grant, revision, query) === receipt.identity && same(b.scope, admitted.scope);
        });
      };
      const session = await options.openSession({ owner, scope: admitted.scope, authorizationVersion: receipt.authorizationVersion,
        rootRunId: receipt.rootRunId, reference: operationId, signal, authorize, interactive: true, deadlineAtMs: receipt.deadlineAtMs });
      try {
        vector = domainParse(vectorSchema, await session.embed({ task: 'RETRIEVAL_QUERY', text: query }, 'embedding:private-source-query'), 'private_query_vector_invalid', 503);
        if (!await authorize()) return changed();
        await documents.withIndexCard(owner, cardId, async (b, grant, revision) => {
          assertBinding(b, owner);
          if (identity(b, cardId, grant, revision, query) !== receipt.identity || !same(b.scope, admitted.scope)) return changed();
          const key = privateQueryId(b.scope, receipt), current = openQuery(b, key, await b.transaction.get(queryRef(key)));
          if (current?.kind !== 'receipt' || current.state !== 'pending' || !same(current, receipt)) return changed();
          signal.throwIfAborted();
          saveQuery(b, { ...receipt, state: 'ready' });
          const { state: _state, ...base } = receipt;
          saveQuery(b, { ...base, kind: 'vector', slot, vector: vector! });
        });
      } finally { session.close(); }
    }
    const matches = admitted.page.candidates.map(unit => ({unit,score:vector ? cosine(vector,unit.vector) : 0})).filter(hit => hit.score > 0);
    return { matches, receipt, nextCursor: admitted.page.after
      ? Buffer.from(JSON.stringify({operationId,after:admitted.page.after})).toString('base64url') : null };
  }
  return async function searchPrivate(owner: string, cardId: string, rawQuery: string, input: Parameters<typeof searchPage>[3]) {
    let page = await searchPage(owner,cardId,rawQuery,input);
    const original = page.receipt;
    const sliceUntil = Math.min(original.deadlineAtMs, Date.now()+15_000);
    const best: typeof page.matches = [];
    for (let batches = 1; ; batches++) {
      if (page.receipt.identity !== original.identity) return changed();
      best.push(...page.matches);
      best.sort((a,b) => b.score-a.score || a.unit.documentId.localeCompare(b.unit.documentId) || a.unit.ordinal-b.unit.ordinal);
      best.splice(6);
      if (!page.nextCursor || batches >= 16 || Date.now() >= sliceUntil) break;
      page = await searchPage(owner,cardId,rawQuery,{...input,cursor:page.nextCursor});
    }
    input.signal?.throwIfAborted();
    if (!await authenticated(owner)) return changed();
    return documents.withIndexCard(owner,cardId,async (b,grant,revision) => {
      assertBinding(b,owner);
      if (identity(b,cardId,grant,revision,rawQuery.trim()) !== original.identity) return changed();
      const heads = await currentHeads(b,cardId,grant,revision,best.map(hit => hit.unit));
      const items = best.flatMap(({unit,score}) => {
        const head = heads.get(unit.documentId);
        if (!head || !headMatches(head,unit)) return [];
        return [{incarnation:unit.incarnation,source:{cardId,documentId:head.documentId,version:head.version,title:head.title,url:head.url},
          page:unit.page,offset:unit.offset,facts:unit.facts,score}];
      });
      input.signal?.throwIfAborted();
      return {items,nextCursor:page.nextCursor};
    });
  };
}

function cosine(left: readonly number[], right: readonly number[]) {
  if (left.length !== right.length || !right.length || right.some(value => !Number.isFinite(value))) return invalid();
  let dot = 0, a = 0, b = 0;
  for (let index = 0; index < left.length; index++) { dot += left[index]! * right[index]!; a += left[index]! ** 2; b += right[index]! ** 2; }
  if (!Number.isFinite(dot) || !Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return invalid();
  return Math.max(-1, Math.min(1, dot / Math.sqrt(a) / Math.sqrt(b)));
}
