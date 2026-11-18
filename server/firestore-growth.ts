import { randomUUID } from 'node:crypto';
import type { Query } from '@google-cloud/firestore';
import { z } from 'zod';
import { growthActionSchema, growthTopicActionSchema, growthTopicSchema, GROWTH_KNOWLEDGE_NOTICES,
  type GrowthAction, type GrowthAttention, type GrowthPage, type GrowthTopicAction, type GrowthTopicId } from '../src/shared/growth.ts';
import type { MemoryContext } from '../src/shared/memory.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, firestoreDomainUuid, firestoreTaskSchema, firestoreChangeSchema, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { createFirestoreAuthority, resourceAuthorityVersion, type FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import type { FirestoreMemoryStore } from './firestore-memory.ts';
import type { FirestoreCareStore } from './firestore-care.ts';
import type { FirestoreOnlineStore } from './firestore-online.ts';
import type { FirestoreKnowledgeStore } from './firestore-knowledge.ts';
import { growthImportPending } from './firestore-growth-import-guard.ts';
import { GROWTH_RULES, GROWTH_CATALOG_REVISION, GROWTH_HISTORY_PAGE_SIZE, canonicalGrowthTimestamp, compareGrowthHistoryDesc, growthProposals, growthInputs, growthBasisChanged, nextGrowthCheck, decodeGrowthHistoryCursor, selectGrowthHistoryWindow, type GrowthHistoryCursor } from './growth-rules.ts';
import { agentKnowledgeFilter } from './product-agent-tools.ts';
import { parseKnowledgeFilter } from './knowledge-inputs.ts';
import { profileIsApplicable } from './memory-policy.ts';
import { prepareContextChange } from './firestore-context-basis.ts';
import { prepareFirestoreBackgroundWork, type FirestoreBackgroundWork } from './firestore-background-work.ts';
import { createFirestoreSharingStore } from './firestore-sharing.ts';
import { assertClassImportAccess } from './firestore-class-handover.ts';
import { importProvenanceSchema } from '../src/shared/import-provenance.ts';
import type { HandoverImportRow } from './handover-import.ts';
import type { HandoverIntegrity } from '../src/shared/handover.ts';
import type { originalGrowthBlockReasonSchema } from '../src/shared/handover-imports.ts';
import { makeImportProvenance } from './handover-provenance.ts';

const uuid = z.uuid(), time = z.iso.datetime({ offset: true }), version = z.number().int().positive().max(2147483647);
const hash = z.string().regex(/^[a-f0-9]{64}$/u), text = (max: number) => z.string().max(max);
const itemSchema: z.ZodType<GrowthAttention> = z.object({ id: uuid, childId: uuid, topicId: growthTopicSchema, version,
  state: z.enum(['proposed', 'snoozed', 'accepted', 'dismissed', 'inapplicable']), title: text(200), kind: z.enum(['observe', 'arrange', 'consult']),
  whyNow: text(4000), advice: text(4000), limits: text(4000),
  basis: z.object({ stage: text(100), ruleRevision: text(100), sourceHash: hash, values: z.record(text(80), text(80)) }).strict(),
  evidence: z.object({ profileVersion: z.number().int().nonnegative(), facts: z.array(z.object({ id: uuid, version }).strict()).max(8) }).strict(),
  source: z.object({ sourceId: text(100), versionId: uuid, chunkId: uuid, contentHash: hash, url: z.url(), title: text(300),
    section: text(300), checkedAt: time, excerpt: text(24000) }).strict(),
  sourceAvailable: z.boolean(), createdAt: time, updatedAt: time, snoozeUntil: time.nullable(), previousId: uuid.nullable(),
  newReason: text(4000), taskId: uuid.nullable(), taskState: z.enum(['scheduled', 'completed', 'cancelled', 'needs_review']).nullable(),
  lastAction: text(80), actorUserId: text(256).nullable(), note: text(1000),
}).strict();
export const firestoreGrowthSchema = z.object({ item: itemSchema, lastRequest: growthActionSchema.nullable(), importedFrom: importProvenanceSchema.optional() }).strict();
export const firestoreGrowthTopicSchema = z.object({ topicId: growthTopicSchema, version, disabled: z.boolean(), actor: text(256),
  at: time, request: growthTopicActionSchema.nullable(), importedFrom: importProvenanceSchema.optional() }).strict();
const historyRefSchema = z.object({ id: uuid, version, createdAt: time }).strict();
// Existing sixteen-change guard bounds references; full attention content is never checkpointed.
const evaluationSchema = z.object({ authority: hash, changeSeq: text(100), basis: hash, at: time,
  after: z.tuple([time, uuid]).nullable(), invalid: z.array(historyRefSchema).max(16),
  groups: z.array(z.object({ topicId: growthTopicSchema, latest: historyRefSchema.nullable(), related: historyRefSchema.nullable(),
    hasBasis: z.boolean(), closed: z.boolean(), activeCount: z.number().int().nonnegative(),
    active: z.array(historyRefSchema).max(16), due: z.array(historyRefSchema).max(16), future: time.nullable(),
  }).strict()).length(GROWTH_RULES.length),
}).strict().refine(value => new Set(value.groups.map(group => group.topicId)).size === GROWTH_RULES.length);
const checkSchema = z.object({ childId: uuid, catalog: text(100), at: time, nextAt: time.nullable(), basis: hash,
  evaluation: evaluationSchema.optional() }).strict();
// Random partition labels are mapped only in the encrypted, scope-bound marker.
// Labels still reveal grouping/access patterns to a database reader; they are not anonymisation.
export const firestoreGrowthReadingIndexSchema = z.object({ childId: uuid, authority: hash, changeSeq: text(100),
  activeToken: uuid, historyToken: uuid, after: z.tuple([time, uuid]).nullable(), ready: z.boolean() }).strict();
type ReadingIndex = z.infer<typeof firestoreGrowthReadingIndexSchema>;
type HistoryRef = z.infer<typeof historyRefSchema>;
type Evaluation = z.infer<typeof evaluationSchema>;
type Saved = z.infer<typeof firestoreGrowthSchema>;
type Topic = z.infer<typeof firestoreGrowthTopicSchema>;
const same = (a: unknown, b: unknown) => firestoreDomainHash(a) === firestoreDomainHash(b);
const currentAuthority = resourceAuthorityVersion;
const active = (item: GrowthAttention) => ['proposed', 'snoozed'].includes(item.state);

/** Stable UUIDv8 address for the existing four per-child topic slots, not a new topic authority. */
export function growthTopicResourceId(childId: string, topicId: GrowthTopicId) {
  domainParse(uuid, childId); domainParse(growthTopicSchema, topicId);
  return firestoreDomainUuid(['growth-topic-resource:1', childId, topicId]);
}

/** Normalizes only source identity; the original archive payload remains the source hash. */
export function growthImportSourceRow(row: HandoverImportRow): HandoverImportRow {
  if (!row.childId) domainReject('invalid_package_scope', 400);
  if (row.section === 'growth_attention') {
    const source = domainParse(firestoreGrowthSchema, row.value, 'invalid_package_growth');
    if (source.item.childId !== row.childId) domainReject('invalid_package_scope', 400);
    return { ...row, value: { ...source.item, authorUserId: source.item.actorUserId, ...(source.importedFrom ? { importedFrom: source.importedFrom } : {}) } };
  }
  if (row.section === 'growth_topics') {
    const source = domainParse(firestoreGrowthTopicSchema, row.value, 'invalid_package_growth');
    return { ...row, value: { ...source, id: growthTopicResourceId(row.childId, source.topicId), childId: row.childId,
      authorUserId: source.actor, createdAt: source.at } };
  }
  return domainReject('invalid_package_scope', 400);
}

/** Reuses the reviewed four-rule catalogue. No model determines medical eligibility or topic suppression. */
export function createFirestoreGrowthStore(options: FirestoreDomainOptions & {
  care: FirestoreCareStore; memory: FirestoreMemoryStore; online: FirestoreOnlineStore; knowledge?: FirestoreKnowledgeStore;
}) {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options);
  const sharing = createFirestoreSharingStore(options);
  function sourceBinding(b: Binding, module: 'profile' | 'memory'): Binding {
    if (!b.sharedAccess) return b;
    if (b.sharedAccess.module !== 'growth') domainReject('shared_module_scope', 403);
    // Saved growth content is explicitly shared. These reads validate its basis only;
    // unshared current inputs are never returned as new source content or write capabilities.
    return { ...b, sharedAccess:{ ...b.sharedAccess, module, mode:'read' } };
  }
  function query(b: Binding, suffix: string): Query {
    let q: Query = data.collection(suffix); for (const [key, value] of Object.entries(data.tags(b.scope))) q = q.where(key, '==', value); return q;
  }
  const readingIndexes = new WeakMap<Binding, ReadingIndex>();
  const readingJournalAdvanced = new WeakSet<Binding>();
  const readingAuthority = (b: Binding) => firestoreDomainHash([b.scope, b.generation]);
  async function readingJournalUnchanged(b: Binding, old: ReadingIndex): Promise<boolean> {
    if (!/^\d+$/u.test(old.changeSeq) || BigInt(old.changeSeq) > BigInt(b.changeSeq)) return false;
    if (old.changeSeq === b.changeSeq) return true;
    // Bounded, contiguous verification: absent/pruned journal entries are NOT proof of no changes.
    // Legacy compound growth writers can journal as tasks/memory, so those remain conservative.
    if (BigInt(b.changeSeq) - BigInt(old.changeSeq) > 200n) return false;
    const tags = data.tags(b.scope);
    const q = data.collection('changes').where('workspaceTag', '==', tags.workspaceTag)
      .where('epochTag', '==', tags.epochTag).where('userTag', '==', tags.userTag)
      .where('sortKey', '>', data.sortKey(old.changeSeq)).where('sortKey', '<=', data.sortKey(b.changeSeq))
      .orderBy('sortKey', 'asc').limit(200);
    const rows = await b.transaction.get(q);
    let next = BigInt(old.changeSeq);
    for (const row of rows.docs) {
      next += 1n;
      if (row.get('sortKey') !== data.sortKey(next.toString())) return false;
      const childId = domainParse(uuid.nullable(), row.get('childId'), 'invalid_document', 500);
      const scope = { ...b.scope, childId: childId ?? '00000000-0000-0000-0000-000000000000' };
      const id = JSON.stringify([scope.workspaceId, scope.storageEpoch, next.toString()]);
      if (Object.entries(data.tags(scope)).some(([key, value]) => row.get(key) !== value)) domainReject('projection_binding', 500);
      const change = data.open('change-projection', id, scope, firestoreChangeSchema, row);
      if (change.childId !== childId || change.changeSeq !== next.toString()) domainReject('projection_binding', 500);
      if ((childId === b.scope.childId || childId === null) && ['growth', 'tasks', 'memory', 'children'].includes(change.kind)) return false;
    }
    return next === BigInt(b.changeSeq);
  }
  async function prepareReadingIndex(b: Binding): Promise<ReadingIndex> {
    const cached = readingIndexes.get(b); if (cached) return cached;
    const ref = data.ref('growth_checks', 'growth-reading-index', b.scope.childId);
    const snap = await b.transaction.get(ref);
    const old = snap.exists ? data.open('growth-reading-index', b.scope.childId, b.scope, firestoreGrowthReadingIndexSchema, snap) : null;
    if (old && old.childId !== b.scope.childId) domainReject('growth_binding', 500);
    // An old writer, restore, or unaccounted mutation may have omitted index metadata.
    // Never treat an earlier scan as complete in that case.
    const value: ReadingIndex = old && old.authority === readingAuthority(b) && await readingJournalUnchanged(b, old) ? { ...old, changeSeq: b.changeSeq } : {
      childId: b.scope.childId, authority: readingAuthority(b), changeSeq: b.changeSeq,
      activeToken: randomUUID(), historyToken: randomUUID(), after: null, ready: false,
    };
    if (old && value.activeToken === old.activeToken && value.changeSeq !== old.changeSeq) readingJournalAdvanced.add(b);
    readingIndexes.set(b, value); return value;
  }
  function saveReadingIndex(b: Binding, value: ReadingIndex) {
    b.transaction.set(data.ref('growth_checks', 'growth-reading-index', b.scope.childId), {
      ...data.tags(b.scope), ...data.seal('growth-reading-index', b.scope.childId, b.scope, firestoreGrowthReadingIndexSchema, value),
    });
  }
  function readingMetadata(index: ReadingIndex, item: GrowthAttention) {
    return { readingBucket: active(item) ? index.activeToken : index.historyToken,
      readingCreatedAt: canonicalGrowthTimestamp(item.createdAt) };
  }
  function openReadingRow(b: Binding, row: any): Saved {
    const saved = data.open('growth-attention', row.get('attentionId'), b.scope, firestoreGrowthSchema, row);
    if (saved.item.id !== row.get('attentionId') || saved.item.childId !== b.scope.childId
      || saved.item.version !== row.get('recordVersion') || saved.item.createdAt !== row.get('createdAt')) domainReject('growth_binding', 500);
    return saved;
  }
  async function indexedPageRecords(b: Binding, index: ReadingIndex, cursor: GrowthHistoryCursor | null, pageSize: number): Promise<Saved[]> {
    const result: Saved[] = [];
    const readBucket = async (token: string, isActive: boolean) => {
      let after: [string, string] | null = !isActive && cursor ? [canonicalGrowthTimestamp(cursor.createdAt), cursor.id] : null;
      while (true) {
        const limit = isActive ? 100 : pageSize + 1;
        let q = query(b, 'growth_attention').where('readingBucket', '==', token)
          .orderBy('readingCreatedAt', 'desc').orderBy('attentionId', 'desc').limit(limit);
        if (after) q = q.startAfter(...after);
        const rows = await b.transaction.get(q);
        for (const row of rows.docs) {
          const saved = openReadingRow(b, row), metadata = readingMetadata(index, saved.item);
          if (metadata.readingBucket !== row.get('readingBucket') || metadata.readingCreatedAt !== row.get('readingCreatedAt')
            || active(saved.item) !== isActive) domainReject('growth_binding', 500);
          result.push(saved);
        }
        if (!isActive || rows.size < limit) break;
        const tail = rows.docs.at(-1)!; after = [tail.get('readingCreatedAt'), tail.get('attentionId')];
      }
    };
    if (!cursor) await readBucket(index.activeToken, true);
    await readBucket(index.historyToken, false);
    return result;
  }
  async function advanceReadingIndex(u: string, c: string, expected?: FirestoreBackgroundWork) {
    return authority.runTransaction(u, c, async b => {
      if (expected && (!same(expected.scope, b.scope) || expected.generation !== b.generation || expected.authorizationVersion !== b.authorizationVersion)) return { state: 'stopped' as const };
      const index = await prepareReadingIndex(b);
      if (index.ready) {
        if (readingJournalAdvanced.has(b)) saveReadingIndex(b, index);
        return { state: 'completed' as const };
      }
      // Each committed page is recoverable. Never rewrite source ciphertext, versions, or timestamps.
      let q = query(b, 'growth_attention').orderBy('createdAt').orderBy('attentionId').limit(200);
      if (index.after) q = q.startAfter(...index.after);
      const rows = await b.transaction.get(q);
      const updates = rows.docs.map(row => ({ row, saved: openReadingRow(b, row) }));
      const tail = updates.at(-1)?.saved.item;
      if (tail) index.after = [tail.createdAt, tail.id];
      index.ready = rows.size < 200;
      for (const { row, saved } of updates) b.transaction.update(row.ref, readingMetadata(index, saved.item));
      saveReadingIndex(b, index);
      return index.ready ? { state: 'completed' as const } : { state: 'deferred' as const, nextAt: new Date(Date.now() + 30_000).toISOString() };
    });
  }
  async function readAttention(b: Binding, id: string): Promise<Saved | null> {
    domainParse(uuid, id);
    const snap = await b.transaction.get(data.ref('growth_attention', 'growth-attention', id));
    if (!snap.exists || Object.entries(data.tags(b.scope)).some(([key, value]) => snap.get(key) !== value)) return null;
    const saved = data.open('growth-attention', id, b.scope, firestoreGrowthSchema, snap);
    if (saved.item.id !== id || snap.get('attentionId') !== id || saved.item.childId !== b.scope.childId
      || saved.item.version !== snap.get('recordVersion') || saved.item.createdAt !== snap.get('createdAt')) domainReject('growth_binding', 500);
    return saved;
  }
  async function readImportAttention(b: Binding, id: string) {
    assertClassImportAccess(b, 'growth', 'read');
    return readAttention(b, id);
  }
  async function readTopicSlot(b: Binding, topicId: GrowthTopicId) {
    domainParse(growthTopicSchema, topicId);
    const id = JSON.stringify([b.scope.childId, topicId]), snap = await b.transaction.get(data.ref('growth_topics', 'growth-topic', id));
    if (!snap.exists || Object.entries(data.tags(b.scope)).some(([key, value]) => snap.get(key) !== value)) return null;
    const saved = data.open('growth-topic', id, b.scope, firestoreGrowthTopicSchema, snap);
    if (saved.topicId !== topicId || saved.version !== snap.get('recordVersion')) domainReject('growth_binding', 500);
    return saved;
  }
  /** Bounded pages, not a business-history quota. Visitors never retain the collection. */
  async function visitHistory(b: Binding, visit: (saved: Saved) => void | boolean | Promise<void | boolean>,
    options: { after?: [string, string] | null; pageBudget?: number } = {}) {
    let after = options.after ?? null;
    const batchSize = 200;
    for (let page = 0; page < (options.pageBudget ?? Infinity); page++) {
      let q = query(b, 'growth_attention').orderBy('createdAt').orderBy('attentionId').limit(batchSize);
      if (after) q = q.startAfter(...after);
      const rows = await b.transaction.get(q);
      for (const row of rows.docs) {
        const saved = data.open('growth-attention', row.get('attentionId'), b.scope, firestoreGrowthSchema, row);
        if (saved.item.id !== row.get('attentionId') || saved.item.childId !== b.scope.childId || saved.item.version !== row.get('recordVersion')
          || saved.item.createdAt !== row.get('createdAt')) domainReject('growth_binding', 500);
        after = [saved.item.createdAt, saved.item.id];
        if (await visit(saved) === false) return { complete: true, after };
      }
      if (rows.size < batchSize) return { complete: true, after };
    }
    return { complete: false, after };
  }
  async function topics(b: Binding): Promise<Topic[]> {
    const result: Topic[] = [];
    for (const rule of GROWTH_RULES) {
      const item = await readTopicSlot(b, rule.id);
      if (item) result.push(item);
    }
    return result;
  }
  async function task(b: Binding, id: string | null) {
    if (!id) return null;
    const row = await b.transaction.get(data.ref('tasks', 'task', id)); if (!row.exists) return null;
    if (Object.entries(data.tags(b.scope)).some(([k, v]) => row.get(k) !== v)) domainReject('not_found', 404);
    const value = data.open('task', id, b.scope, firestoreTaskSchema, row);
    if (value.id !== id || value.childId !== b.scope.childId || value.version !== row.get('recordVersion')) domainReject('task_binding', 500);
    return value;
  }
  async function load(b: Binding) {
    const profile = await options.care.readProfile(sourceBinding(b, 'profile'));
    const facts = await options.memory.readFamilyFacts(sourceBinding(b, 'memory'), GROWTH_RULES.flatMap(rule => rule.inputs.map(input => input.key)));
    const context: MemoryContext = { profile, profileApplicable: profileIsApplicable(profile.data), facts, topics: [], summary: null,
      recentMessages: [], conflictingKeys: [], unavailableFactKeys: facts.filter(f => !f.applicable).map(f => f.key.trim().toLowerCase()),
      truncated: { facts: false, topics: false, messages: false } };
    const filter = agentKnowledgeFilter(context, new Date()), applicable = context.profileApplicable ? profile.data : null;
    let notice: string | null = null;
    if (applicable?.age.kind === 'birth_date' && filter.age === null) notice = GROWTH_KNOWLEDGE_NOTICES.age;
    else if (!applicable?.region?.trim()) notice = GROWTH_KNOWLEDGE_NOTICES.region;
    else { try { parseKnowledgeFilter(filter); } catch (error) { if (!(error instanceof z.ZodError)) throw error; notice = GROWTH_KNOWLEDGE_NOTICES.region; } }
    const sources = !notice && options.knowledge ? await options.knowledge.ruleCandidates(b.transaction, GROWTH_RULES, filter) : [];
    const assessed = growthProposals(context, sources, new Date());
    return { context, sources, proposals: assessed.proposals, notices: notice ? [notice] : assessed.notices };
  }
  function importedSupported(item: GrowthAttention, next: Awaited<ReturnType<typeof load>>['proposals'][number] | undefined) {
    // A foreign hash/basis cannot attest to the prose. Compare with the locally reviewed rule and original source.
    return !!next && same(next.basis, item.basis)
      && ['title', 'kind', 'whyNow', 'advice', 'limits'].every(key => same(item[key as 'title'], next[key as 'title']))
      && ['sourceId', 'contentHash', 'url', 'title', 'section', 'excerpt'].every(key => same(item.source[key as 'sourceId'], next.source[key as 'sourceId']));
  }
  async function visible(b: Binding, item: GrowthAttention, loaded: Awaited<ReturnType<typeof load>>, imported = false) {
    const next = loaded.proposals.find(value => value.topicId === item.topicId);
    const mayReadTask = !b.sharedAccess || !!b.sharedAccess.modules?.includes('tasks');
    const linked = mayReadTask ? await task(b, item.taskId) : null;
    const sourceAvailable = imported ? importedSupported(item, next) : !!next && same(next.basis, item.basis);
    const view = { ...item, sourceAvailable, ...(imported && sourceAvailable && next ? { source: next.source, evidence: next.evidence } : {}),
      taskId:mayReadTask ? item.taskId : null, taskState: linked?.occurrence.state ?? null };
    if (!b.sharedAccess) return view;
    const modules = b.sharedAccess.modules ?? [];
    const facts = modules.includes('memory') ? loaded.context.facts.filter(fact => fact.applicable
      && view.evidence.facts.some(ref => ref.id === fact.id && ref.version === fact.version)) : [];
    const values = Object.fromEntries(Object.entries(view.basis.values).filter(([key, value]) => modules.includes('memory')
      && (value === 'unknown' || facts.some(fact => fact.key.trim().toLowerCase() === key && fact.content === value))));
    return { ...view, basis: { ...view.basis, values }, evidence: {
      profileVersion: modules.includes('profile') && loaded.context.profile.data
        && loaded.context.profile.version === view.evidence.profileVersion ? view.evidence.profileVersion : 0,
      facts: facts.map(({ id, version }) => ({ id, version })) } };
  }
  function write(b: Binding, saved: Saved) {
    domainParse(firestoreGrowthSchema, saved);
    const normalized: Saved = {
      ...saved,
      item: { ...saved.item, createdAt: canonicalGrowthTimestamp(saved.item.createdAt) },
    };
    const item = normalized.item, id = JSON.stringify([item.id, item.version]);
    const index = readingIndexes.get(b);
    if (!index) domainReject('growth_index_not_prepared', 500);
    const tags = { ...data.tags(b.scope), attentionId: item.id, createdAt: item.createdAt, entityVersion: item.version,
      ...readingMetadata(index, item) };
    // All existing mutation paths commit one owner journal change in this transaction.
    // A mismatch on the following read safely discards the index instead of trusting a stale view.
    index.changeSeq = (BigInt(b.changeSeq) + 1n).toString();
    saveReadingIndex(b, index);
    b.transaction.set(data.ref('growth_attention', 'growth-attention', item.id),
      { ...tags, ...data.seal('growth-attention', item.id, b.scope, firestoreGrowthSchema, normalized, item.version) });
    b.transaction.create(data.ref('growth_revisions', 'growth-revision', id),
      { ...tags, ...data.seal('growth-revision', id, b.scope, firestoreGrowthSchema, normalized, item.version) });
  }
  async function readPageRecords(b: Binding, cursor: GrowthHistoryCursor | null, pageSize = GROWTH_HISTORY_PAGE_SIZE): Promise<Saved[]> {
    const index = await prepareReadingIndex(b);
    if (index.ready) return indexedPageRecords(b, index, cursor, pageSize);
    const batchSize = cursor ? Math.min(100, Math.max(pageSize + 10, 40)) : 100;
    const activeRecords: Saved[] = [];
    let historyRecords: Saved[] = [];
    const cursorMs = cursor ? Date.parse(cursor.createdAt) : null;
    // Legacy/imported records may hold ISO offsets (-23:59..+23:59) or non-canonical precision;
    // start above cursorMs + 25h in Firestore lexical order so no instant <= cursorMs is skipped.
    let batchAfter: [string, string] | null = cursorMs !== null
      ? [new Date(cursorMs + 25 * 3600_000).toISOString(), '\uffff']
      : null;
    while (true) {
      let q = query(b, 'growth_attention')
        .orderBy('createdAt', 'desc')
        .orderBy('attentionId', 'desc')
        .limit(batchSize);
      if (batchAfter) q = q.startAfter(batchAfter[0], batchAfter[1]);
      const rows = await b.transaction.get(q);
      if (!rows.size) break;
      for (const row of rows.docs) {
        const saved = data.open('growth-attention', row.get('attentionId'), b.scope, firestoreGrowthSchema, row);
        if (saved.item.id !== row.get('attentionId') || saved.item.childId !== b.scope.childId
          || saved.item.version !== row.get('recordVersion') || saved.item.createdAt !== row.get('createdAt')) domainReject('growth_binding', 500);
        if (active(saved.item)) {
          if (!cursor) activeRecords.push(saved);
        } else {
          const itemMs = Date.parse(saved.item.createdAt);
          if (cursorMs === null || itemMs < cursorMs || (itemMs === cursorMs && saved.item.id < cursor!.id)) {
            historyRecords.push(saved);
          }
        }
      }
      if (historyRecords.length > pageSize + 1) {
        historyRecords.sort((x, y) => compareGrowthHistoryDesc(x.item, y.item));
        historyRecords = historyRecords.slice(0, pageSize + 1);
      }
      if (rows.size < batchSize) break;
      const tail = rows.docs.at(-1)!;
      const tailCreatedAt = tail.get('createdAt') as string;
      const tailMs = Date.parse(tailCreatedAt);
      if (cursor !== null && historyRecords.length >= pageSize + 1) {
        const cutoffMs = Date.parse(historyRecords[pageSize]!.item.createdAt);
        if (Number.isFinite(tailMs) && Number.isFinite(cutoffMs) && tailMs < cutoffMs - 48 * 3600_000) break;
      }
      batchAfter = [tailCreatedAt, tail.get('attentionId') as string];
    }
    return [...activeRecords, ...historyRecords];
  }
  async function page(b: Binding, options?: { historyCursor?: string | null }): Promise<GrowthPage> {
    let cursor: GrowthHistoryCursor | null = null;
    if (options?.historyCursor !== undefined && options.historyCursor !== null) {
      cursor = decodeGrowthHistoryCursor(options.historyCursor);
      if (!cursor) domainReject('invalid_input', 400);
    }
    const records = await readPageRecords(b, cursor), loaded = await load(b), states = await topics(b);
    const windowed = selectGrowthHistoryWindow(records, value => value.item, value => active(value.item), options);
    const items: GrowthAttention[] = []; for (const saved of windowed.selected) items.push(await visible(b, saved.item, loaded, !!saved.importedFrom));
    const mayReadInputs = !b.sharedAccess || !!b.sharedAccess.modules?.includes('memory');
    const reading = await prepareReadingIndex(b);
    if (!b.sharedAccess && !reading.ready) {
      // Serve the complete legacy view during construction, then continue derived indexing off the request path.
      const wake = await prepareFirestoreBackgroundWork(data, b.transaction, { kind: 'child-change', scope: b.scope,
        resourceId: b.scope.childId, basis: 'growth-reading-index:' + firestoreDomainHash([reading.activeToken, reading.historyToken]),
        generation: b.generation, authorizationVersion: b.authorizationVersion }, new Date().toISOString());
      saveReadingIndex(b, reading); wake.commit();
    } else if (!b.sharedAccess && readingJournalAdvanced.has(b)) saveReadingIndex(b, reading);
    return { authorityVersion: currentAuthority(b), items, historyHasMore: windowed.historyHasMore, historyNextCursor: windowed.historyNextCursor, canManage: !b.sharedAccess,
      eligibleAssignees: b.sharedAccess ? [] : [{ userId: b.scope.ownerUserId, name: '本人' }],
      notices: b.sharedAccess ? ['這是已共享的成長內容；共享修改仍未開放。',
        ...(!mayReadInputs ? ['即時近況未加入共享範圍。'] : []),
        ...(items.some(item => !item.sourceAvailable) ? ['部分成長內容的來源適用性已改變或尚未能確認。'] : [])] : loaded.notices,
      topics: GROWTH_RULES.map(rule => { const state = states.find(topic => topic.topicId === rule.id);
        const inputs = growthInputs(rule, loaded.context);
        return { id: rule.id, title: rule.title, version: state?.version ?? 1, disabled: state?.disabled ?? false,
          inputs: mayReadInputs ? inputs : inputs.map(input => ({ ...input, value:null, conflict:false, factRefs:[] })) }; }) };
  }
  const childWake = (b: Binding, basis: string, dueAt = new Date().toISOString()) => prepareFirestoreBackgroundWork(data, b.transaction,
    { kind: 'child-change', scope: b.scope, resourceId: b.scope.childId, basis, generation: b.generation, authorizationVersion: b.authorizationVersion }, dueAt);
  async function backgroundInputIn(b: Binding, job: FirestoreBackgroundWork) {
    if (job.kind !== 'growth' || !same(job.scope, b.scope) || job.generation !== b.generation || job.authorizationVersion !== b.authorizationVersion) return null;
    if (await growthImportPending(data, b)) return null;
    const saved = await readAttention(b, job.resourceId);
    if (!saved || saved.item.state !== 'proposed' || firestoreDomainHash(saved.item.basis) !== job.basis) return null;
    let closed = false;
    await visitHistory(b, other => {
      if (other.item.id !== saved.item.id && other.item.topicId === saved.item.topicId
        && ['accepted', 'dismissed'].includes(other.item.state) && same(other.item.basis, saved.item.basis)) { closed = true; return false; }
    });
    if (closed || (await topics(b)).some(value => value.topicId === saved.item.topicId && value.disabled)) return null;
    const item = await visible(b, saved.item, await load(b), !!saved.importedFrom); return item.sourceAvailable ? item : null;
  }
  async function prepareImportedAttention(b: Binding, opId: string, row: HandoverImportRow, integrity: HandoverIntegrity,
    expected?: { id: string; expectedVersion: number }, mapped?: { taskId?: string; taskVersion?: number; previousId?: string }) {
    await prepareReadingIndex(b);
    assertClassImportAccess(b, 'growth', 'write');
    domainParse(uuid, opId);
    if (row.section !== 'growth_attention') domainReject('invalid_package_scope', 400);
    const sourceRow = growthImportSourceRow(row), source = domainParse(firestoreGrowthSchema, row.value, 'invalid_package_growth');
    const current = expected ? await readAttention(b, expected.id) : null;
    if (expected && (!current || current.item.version !== expected.expectedVersion || current.item.version >= 2147483647)) domainReject('growth_changed');
    const loaded = await load(b), settings = await topics(b), next = loaded.proposals.find(item => item.topicId === source.item.topicId);
    const supported = importedSupported(source.item, next), now = new Date().toISOString();
    const origin = makeImportProvenance(sourceRow, integrity, b.actorUserId, now); origin.current.sourceHash = firestoreDomainHash(row.value);
    const linked = mapped?.taskId ? await task(b, mapped.taskId) : null;
    if (mapped?.taskId && (!source.item.taskId || !linked || linked.version !== mapped.taskVersion)) domainReject('growth_changed');
    const previous = mapped?.previousId ? await readAttention(b, mapped.previousId) : null;
    if (mapped?.previousId && (!source.item.previousId || !previous || previous.item.topicId !== source.item.topicId)) domainReject('growth_changed');
    const item: GrowthAttention = { ...source.item, id: current?.item.id ?? randomUUID(), childId: b.scope.childId,
      createdAt: canonicalGrowthTimestamp(source.item.createdAt),
      version: (current?.item.version ?? 0) + 1, updatedAt: now, sourceAvailable: supported,
      evidence: supported && next ? next.evidence : { profileVersion: 0, facts: [] },
      source: supported && next ? next.source : source.item.source,
      taskId: linked?.id ?? null, taskState: linked?.occurrence.state ?? null, previousId: previous?.item.id ?? null };
    let duplicateBasis = false;
    await visitHistory(b, saved => {
      if (saved.item.id !== item.id && saved.item.topicId === item.topicId
        && saved.item.state !== 'inapplicable' && same(saved.item.basis, item.basis)) { duplicateBasis = true; return false; }
    });
    if (active(item) && (!supported || settings.some(topic => topic.topicId === item.topicId && topic.disabled) || duplicateBasis)) {
      item.state = 'inapplicable'; item.snoozeUntil = null; item.lastAction = 'imported_context_unavailable';
    } else if (item.state === 'snoozed' && (!item.snoozeUntil || Date.parse(item.snoozeUntil) <= Date.now())) {
      item.state = 'proposed'; item.snoozeUntil = null;
    }
    // A classroom owns the record. It has no personal model or delivery authorisation.
    const job = b.sharedAccess ? null : item.state === 'proposed' ? await prepareFirestoreBackgroundWork(data, b.transaction,
      { kind: 'growth', scope: b.scope, resourceId: item.id, basis: firestoreDomainHash(item.basis), generation: b.generation,
        authorizationVersion: b.authorizationVersion }, now)
      : item.state === 'snoozed' && item.snoozeUntil ? await childWake(b, 'import:' + item.id + ':' + item.version, item.snoozeUntil) : null;
    const change = await b.prepareChange(opId, 'growth', false), context = b.sharedAccess ? null : await prepareContextChange(data, b);
    const value: Saved = { item, lastRequest: null, importedFrom: origin };
    return { value, changeSeq: change.changeSeq, commit() { change.commit(); context?.(); write(b, value); job?.commit(); } };
  }
  async function prepareImportedTopic(b: Binding, opId: string, row: HandoverImportRow, integrity: HandoverIntegrity,
    expected?: { expectedVersion: number }, restoreOriginal = false) {
    await prepareReadingIndex(b);
    assertClassImportAccess(b, 'growth', 'write');
    domainParse(uuid, opId);
    if (row.section !== 'growth_topics') domainReject('invalid_package_scope', 400);
    const sourceRow = growthImportSourceRow(row), source = domainParse(firestoreGrowthTopicSchema, row.value, 'invalid_package_growth');
    const current = (await topics(b)).find(topic => topic.topicId === source.topicId), currentVersion = current?.version ?? 1;
    if (currentVersion >= 2147483647 || expected && currentVersion !== expected.expectedVersion || !expected && current) domainReject('growth_changed');
    const removed: Saved[] = [];
    if (source.disabled) await visitHistory(b, saved => {
      if (saved.item.topicId === source.topicId && active(saved.item)) removed.push(saved);
      if (removed.length > 4) domainReject('growth_history_requires_review', 400);
    });
    const now = new Date().toISOString(), origin = makeImportProvenance(sourceRow, integrity, b.actorUserId, now);
    origin.current.sourceHash = firestoreDomainHash(row.value);
    const value: Topic = { ...source, version: currentVersion + 1, at: now, request: null, importedFrom: origin };
    const id = JSON.stringify([b.scope.childId, source.topicId]), revisionId = JSON.stringify([b.scope.childId, source.topicId, value.version]);
    const change = await b.prepareChange(opId, 'growth', false), context = b.sharedAccess ? null : await prepareContextChange(data, b);
    const wake = b.sharedAccess || restoreOriginal ? null : await childWake(b, 'import-topic:' + source.topicId + ':' + value.version);
    return { value, resourceId: growthTopicResourceId(b.scope.childId, source.topicId), changeSeq: change.changeSeq,
      commit() { change.commit(); context?.(); wake?.commit();
        b.transaction.set(data.ref('growth_topics', 'growth-topic', id), { ...data.tags(b.scope), ...data.seal('growth-topic', id, b.scope, firestoreGrowthTopicSchema, value, value.version) });
        b.transaction.create(data.ref('growth_topic_revisions', 'growth-topic-revision', revisionId),
          { ...data.tags(b.scope), ...data.seal('growth-topic-revision', revisionId, b.scope, firestoreGrowthTopicSchema, value, value.version) });
        for (const saved of removed) write(b, { ...saved, item: { ...saved.item, version: saved.item.version + 1, state: 'dismissed', snoozeUntil: null,
          updatedAt: now, actorUserId: b.actorUserId, lastAction: 'topic_disabled', note: '已停用此主題；只有明確重新啟用才可再評估。' }, lastRequest: null });
      } };
  }
  async function inspectOriginal(b: Binding, row: HandoverImportRow) {
    if (b.sharedAccess || b.actorUserId !== b.scope.ownerUserId || row.source.accountId !== b.actorUserId || row.childId !== b.scope.childId)
      domainReject('invalid_import_target', 403);
    type Reason = z.infer<typeof originalGrowthBlockReasonSchema>;
    if (row.section === 'growth_topics') {
      const source = domainParse(firestoreGrowthTopicSchema, row.value, 'invalid_package_growth');
      const live = await readTopicSlot(b, source.topicId);
      const reason: Reason | null = !live ? 'original_unavailable' : live.disabled && !source.disabled ? 'growth_topic_disabled' : null;
      return { section: row.section, id: growthTopicResourceId(b.scope.childId, source.topicId), topicId: source.topicId, at: source.at, backupVersion: source.version,
        localVersion: live?.version ?? null, reason, changedFields: live && live.disabled !== source.disabled ? ['disabled'] : [] } as const;
    }
    if (row.section !== 'growth_attention') domainReject('invalid_package_scope', 400);
    const source = domainParse(firestoreGrowthSchema, row.value, 'invalid_package_growth');
    const item = source.item;
    if (item.childId !== b.scope.childId) domainReject('invalid_package_scope', 400);
    const live = (await readImportAttention(b, item.id))?.item;
    const fields = ['title', 'kind', 'whyNow', 'advice', 'limits', 'basis', 'evidence', 'source',
      'state', 'snoozeUntil', 'previousId', 'newReason', 'taskId', 'lastAction', 'actorUserId', 'note'] as const;
    const changedFields = live ? fields.filter(key => !same(live[key], item[key])) : [];
    let reason: Reason | null = null;
    let linkedState: GrowthAttention['taskState'] = null;
    if (!live) reason = 'original_unavailable';
    else if (live.topicId !== item.topicId || (live.createdAt !== item.createdAt && Date.parse(live.createdAt) !== Date.parse(item.createdAt))) reason = 'original_unavailable';
    else if (!active(live) && live.state !== item.state) reason = 'growth_terminal_state';
    else if (live.previousId !== item.previousId || live.taskId && live.taskId !== item.taskId) reason = 'growth_link_changed';
    else if (changedFields.length) {
      if (item.taskId) {
        const linked = await task(b, item.taskId);
        if (!linked) reason = 'growth_link_changed';
        else linkedState = linked.occurrence.state;
      }
      if (!reason && item.previousId) {
        const previous = await readImportAttention(b, item.previousId);
        if (!previous || previous.item.id === item.id || previous.item.topicId !== item.topicId) reason = 'growth_link_changed';
      }
      if (!reason && active(item)) {
        if ((await readTopicSlot(b, item.topicId))?.disabled) reason = 'growth_topic_disabled';
        else if (live.state === 'snoozed' && item.state === 'proposed' || item.state === 'snoozed'
          && (!item.snoozeUntil || Date.parse(item.snoozeUntil) <= Date.now())) reason = 'growth_snooze_changed';
        else if (!(await visible(b, item, await load(b), !!source.importedFrom)).sourceAvailable) reason = 'growth_source_changed';
      }
    }
    return { section: row.section, id: item.id, topicId: item.topicId, at: item.createdAt, backupVersion: item.version, localVersion: live?.version ?? null,
      reason, changedFields, source, linkedState } as const;
  }
  async function prepareOriginal(b: Binding, opId: string, row: HandoverImportRow, integrity: HandoverIntegrity,
    expected: { id: string; expectedVersion: number }) {
    await prepareReadingIndex(b);
    const checked = await inspectOriginal(b, row);
    if (checked.reason) domainReject(checked.reason);
    if (checked.id !== expected.id || checked.localVersion !== expected.expectedVersion || expected.expectedVersion >= 2147483647)
      domainReject('growth_changed');
    if (!checked.changedFields.length) return null;
    if (checked.section === 'growth_topics') {
      const prepared = await prepareImportedTopic(b, opId, row, integrity, expected, true);
      return { resource: { id: checked.id, version: prepared.value.version }, changeSeq: prepared.changeSeq, commit: prepared.commit };
    }
    // Restore the record, never the historical accept request, task creation or delivery.
    const sourceAvailable = active(checked.source.item) || (await visible(b, checked.source.item, await load(b), !!checked.source.importedFrom)).sourceAvailable;
    const item = { ...checked.source.item, version: expected.expectedVersion + 1, updatedAt: new Date().toISOString(),
      taskState: checked.linkedState, sourceAvailable };
    const saved: Saved = { ...checked.source, item, lastRequest: null };
    const change = await b.prepareChange(opId, 'growth', false), context = await prepareContextChange(data, b);
    return { resource: { id: item.id, version: item.version }, changeSeq: change.changeSeq,
      commit() { change.commit(); context(); write(b, saved); } };
  }
  const store = {
    inspectOriginal, prepareOriginal, readImportAttention, advanceReadingIndex,
    advanceReadingIndexJob: (job: FirestoreBackgroundWork) => advanceReadingIndex(job.scope.ownerUserId, job.scope.childId, job),
    readImportTopic(b: Binding, topicId: GrowthTopicId) {
      assertClassImportAccess(b, 'growth', 'read'); return readTopicSlot(b, topicId);
    },
    prepareImportedAttention, prepareImportedTopic,
    async prepareExportView(b: Binding, modules: readonly string[]) {
      if (b.sharedAccess?.module !== 'growth') domainReject('shared_module_scope', 403);
      const readable = (b.sharedAccess.modules ?? []).filter(module => modules.includes(module));
      const scoped = { ...b, sharedAccess: { ...b.sharedAccess, modules: readable } };
      const loaded = await load(scoped);
      return async (saved: Saved) => {
        const item = await visible(scoped, saved.item, loaded, !!saved.importedFrom);
        return { ...item, taskId: item.taskState === null ? null : item.taskId };
      };
    },
    forSharedSpace(spaceId: string) {
      domainParse(uuid, spaceId);
      const unavailable = async (): Promise<never> => domainReject('shared_domain_read_only', 409);
      return {
        list: (u: string, c: string, options?: { historyCursor?: string | null }) => sharing.withResource(u, { spaceId, childId:c, module:'growth', mode:'read' }, access => page(access.binding, options)),
        decide: unavailable, topic: unavailable,
      };
    },
    list: (u: string, c: string, options?: { historyCursor?: string | null }) => authority.runTransaction(u, c, b => page(b, options)),
    decide: (u: string, c: string, id: string, raw: GrowthAction) => authority.runTransaction(u, c, async b => {
      await prepareReadingIndex(b);
      domainParse(uuid, id); const input = domainParse(growthActionSchema, raw);
      if (input.authorityVersion !== currentAuthority(b)) domainReject('growth_changed');
      const saved = await readAttention(b, id); if (!saved) domainReject('not_found', 404);
      const current = saved.item, loaded = await load(b);
      if (current.version === input.expectedVersion + 1 && current.actorUserId === u && same(saved.lastRequest, input)) return visible(b, current, loaded, !!saved.importedFrom);
      const disabled = (await topics(b)).find(topic => topic.topicId === current.topicId)?.disabled;
      if (current.version !== input.expectedVersion || !active(current) || disabled || !(await visible(b, current, loaded, !!saved.importedFrom)).sourceAvailable) domainReject('growth_changed');
      const now = new Date().toISOString(), item = { ...current, version: current.version + 1, updatedAt: now, actorUserId: u, lastAction: input.action };
      let linked: Awaited<ReturnType<FirestoreOnlineStore['prepareTask']>> | null = null;
      if (input.action === 'dismiss') { item.state = 'dismissed'; item.note = input.note; item.snoozeUntil = null; }
      else if (input.action === 'snooze') {
        if (Date.parse(input.until) <= Date.now() || Date.parse(input.until) > Date.now() + 366 * 86400_000) domainReject('invalid_input', 400);
        item.state = 'snoozed'; item.snoozeUntil = input.until;
      } else {
        item.state = 'accepted'; item.snoozeUntil = null;
        if (input.task.kind === 'existing') {
          const selected = await task(b, input.task.id);
          if (!selected || selected.version !== input.task.expectedVersion) domainReject('growth_changed');
          item.taskId = selected.id; item.taskState = selected.occurrence.state;
        } else if (input.task.kind === 'create') {
          const existing = await task(b, current.taskId);
          if (existing && ['scheduled', 'needs_review'].includes(existing.occurrence.state)) domainReject('growth_existing_task_requires_review');
          linked = await options.online.prepareTask(b, c, undefined, { values: input.task.values, confirm: true }, randomUUID());
          item.taskId = linked.task.id; item.taskState = linked.task.occurrence.state;
        }
      }
      const wake = await childWake(b, 'decision:' + item.id + ':' + item.version);
      const change = linked ? null : await b.prepareChange(randomUUID(), 'growth', false), context = await prepareContextChange(data, b);
      change?.commit(); linked?.commit(); context(); wake.commit(); write(b, { ...saved, item, lastRequest: input }); return item;
    }),
    async topic(u: string, c: string, rawTopic: GrowthTopicId, raw: GrowthTopicAction) {
      const topicId = domainParse(growthTopicSchema, rawTopic), input = domainParse(growthTopicActionSchema, raw);
      await authority.runTransaction(u, c, async b => {
        await prepareReadingIndex(b);
        if (currentAuthority(b) !== input.authorityVersion) domainReject('growth_changed');
        const previous = (await topics(b)).find(topic => topic.topicId === topicId), currentVersion = previous?.version ?? 1;
        if (previous && currentVersion === input.expectedVersion + 1 && previous.actor === u && same(previous.request, input)) return;
        if (currentVersion !== input.expectedVersion) domainReject('growth_changed');
        const loaded = await load(b), rule = GROWTH_RULES.find(value => value.id === topicId)!;
        const commits: (() => void)[] = [];
        // Compound context confirmation has one change sequence and one transaction, not multiple partial fact writes.
        const nested: Binding = { ...b, prepareChange: async () => ({ changeSeq: (BigInt(b.changeSeq) + 1n).toString(), commit() {} }) };
        if (input.action === 'confirm_context') {
          const facts = loaded.context.facts.filter(fact => rule.inputs.some(def => def.key === fact.key.trim().toLowerCase()));
          if (!same(facts.map(({ id, version }) => ({ id, version })).sort((a, x) => a.id.localeCompare(x.id)),
            [...input.expectedFacts].sort((a, x) => a.id.localeCompare(x.id)))) domainReject('growth_changed');
          const entries = Object.entries(input.values);
          if (!entries.length || entries.some(([key, value]) => !rule.inputs.some(def => def.key === key && def.choices.some(choice => choice.value === value)))) domainReject('invalid_input', 400);
          for (const [key, content] of entries) {
            const fact = facts.find(value => value.key.trim().toLowerCase() === key);
            if (fact && (!fact.applicable || fact.sourceState !== 'current')) domainReject('growth_fact_requires_review');
            const values = { key, content, source: { kind: 'manual' as const, description: '家長在成長關注明確確認，供家庭共同照護使用。' }, validUntil: null };
            if (fact?.content === content) continue;
            const update = fact ? await options.memory.prepareFactChange(nested, 'revise', fact.id,
              { values, expectedVersion: fact.version, confirm: true, confirmShared: true, reason: '家長更新成長關注近況。' }, randomUUID())
              : await options.memory.prepareConfirmedFact(nested, { values, intendedVisibility: 'family' }, true, randomUUID());
            commits.push(update.commit);
          }
        }
        const now = new Date().toISOString(), disabled = input.action === 'set_enabled' ? !input.enabled : previous?.disabled ?? false;
        const next: Topic = { ...(previous?.importedFrom ? { importedFrom: previous.importedFrom } : {}), topicId, version: currentVersion + 1, disabled, actor: u, at: now, request: input };
        const removed: Saved[] = [];
        if (disabled) await visitHistory(b, saved => {
          if (saved.item.topicId === topicId && active(saved.item)) removed.push(saved);
          if (removed.length > 4) domainReject('growth_history_requires_review', 400);
        });
        const wake = await childWake(b, 'topic:' + topicId + ':' + next.version), context = await prepareContextChange(data, b);
        const change = await b.prepareChange(randomUUID(), commits.length ? 'memory' : 'growth', false);
        const id = JSON.stringify([c, topicId]), revisionId = JSON.stringify([c, topicId, next.version]);
        change.commit(); context(); for (const commit of commits) commit(); wake.commit();
        b.transaction.set(data.ref('growth_topics', 'growth-topic', id), { ...data.tags(b.scope), ...data.seal('growth-topic', id, b.scope, firestoreGrowthTopicSchema, next, next.version) });
        b.transaction.create(data.ref('growth_topic_revisions', 'growth-topic-revision', revisionId),
          { ...data.tags(b.scope), ...data.seal('growth-topic-revision', revisionId, b.scope, firestoreGrowthTopicSchema, next, next.version) });
        for (const saved of removed) write(b, { ...saved, item: { ...saved.item, version: saved.item.version + 1, state: 'dismissed', snoozeUntil: null,
          updatedAt: now, actorUserId: u, lastAction: 'topic_disabled', note: '已永久停用此主題；只有明確重新啟用才可再評估。' }, lastRequest: null });
      });
      return store.list(u, c);
    },
    async evaluate(job: FirestoreBackgroundWork) {
      return authority.runTransaction(job.scope.ownerUserId, job.scope.childId, async b => {
        if (!same(job.scope, b.scope) || job.generation !== b.generation || job.authorizationVersion !== b.authorizationVersion) return { state: 'stopped' as const };
        if (await growthImportPending(data, b)) return { state: 'deferred' as const, nextAt: new Date(Date.now() + 30_000).toISOString() };
        await prepareReadingIndex(b);
        const loaded = await load(b), settings = await topics(b), scanAt = new Date().toISOString();
        const checkRef = data.ref('growth_checks', 'growth-check', b.scope.childId), checkSnapshot = await b.transaction.get(checkRef);
        const previousCheck = checkSnapshot.exists ? data.open('growth-check', b.scope.childId, b.scope, checkSchema, checkSnapshot) : null;
        if (previousCheck && previousCheck.childId !== b.scope.childId) domainReject('growth_binding', 500);
        const authorityKey = firestoreDomainHash([b.scope, b.generation, b.authorizationVersion, b.childAccessVersion]);
        const inputBasis = firestoreDomainHash([GROWTH_CATALOG_REVISION, loaded.context.profile, loaded.context.facts,
          loaded.proposals.map(value => [value.topicId, value.basis]),
          loaded.sources.map(source => [source.chunkId, source.contentHash, source.validUntil ?? null]), settings]);
        const savedProgress = previousCheck?.evaluation;
        const progress: Evaluation = savedProgress && savedProgress.authority === authorityKey
          && savedProgress.changeSeq === b.changeSeq && savedProgress.basis === inputBasis ? savedProgress : {
            authority: authorityKey, changeSeq: b.changeSeq, basis: inputBasis, at: scanAt, after: null, invalid: [],
            groups: GROWTH_RULES.map(rule => ({ topicId: rule.id, latest: null, related: null, hasBasis: false,
              closed: false, activeCount: 0, active: [], due: [], future: null })),
          };
        const proposal = (topicId: GrowthTopicId) => settings.some(value => value.topicId === topicId && value.disabled)
          ? undefined : loaded.proposals.find(value => value.topicId === topicId);
        const reference = (item: GrowthAttention): HistoryRef => ({ id: item.id, version: item.version, createdAt: item.createdAt });
        const retainChange = (refs: HistoryRef[], item: GrowthAttention) => {
          refs.push(reference(item));
          if (refs.length > 16) domainReject('growth_history_requires_review', 400);
        };
        const scanned = await visitHistory(b, saved => {
          const item = saved.item, group = progress.groups.find(value => value.topicId === item.topicId)!;
          const next = proposal(item.topicId), matches = !!next && same(item.basis, next.basis);
          if (!group.latest || compareGrowthHistoryDesc(item, group.latest) < 0) group.latest = reference(item);
          if (next && item.taskId && item.basis.stage === next.basis.stage
            && (!group.related || compareGrowthHistoryDesc(item, group.related) < 0)) group.related = reference(item);
          if (matches) {
            group.hasBasis = true;
            if (['accepted', 'dismissed'].includes(item.state)) group.closed = true;
          }
          if (!active(item)) return;
          if (!matches || saved.importedFrom && !importedSupported(item, next)) { retainChange(progress.invalid, item); return; }
          group.activeCount++;
          if (group.active.length < 16) group.active.push(reference(item));
          if (item.state === 'snoozed' && item.snoozeUntil) {
            if (Date.parse(item.snoozeUntil) <= Date.parse(progress.at)) retainChange(group.due, item);
            else if (!group.future || Date.parse(item.snoozeUntil) < Date.parse(group.future)) group.future = item.snoozeUntil;
          }
        }, { after: progress.after, pageBudget: 100 });
        const basis = firestoreDomainHash([loaded.context.profile, loaded.context.facts, loaded.sources.map(source => [source.chunkId, source.contentHash])]);
        if (!scanned.complete) {
          progress.after = scanned.after;
          const nextAt = new Date(Date.now() + 30_000).toISOString();
          const check = { childId: b.scope.childId, catalog: GROWTH_CATALOG_REVISION, at: previousCheck?.at ?? progress.at,
            nextAt, basis: previousCheck?.basis ?? basis, evaluation: progress };
          b.transaction.set(checkRef, { ...data.tags(b.scope), ...data.seal('growth-check', b.scope.childId, b.scope, checkSchema, check) });
          return { state: 'deferred' as const, nextAt };
        }
        // A snooze that matured between dispatches must be reclassified, not silently missed at EOF.
        if (progress.groups.some(group => !group.closed && group.future && Date.parse(group.future) <= Date.now())) {
          const nextAt = new Date(Date.now() + 30_000).toISOString();
          b.transaction.set(checkRef, { ...data.tags(b.scope), ...data.seal('growth-check', b.scope.childId, b.scope, checkSchema,
            { childId: b.scope.childId, catalog: GROWTH_CATALOG_REVISION, at: previousCheck?.at ?? progress.at, nextAt, basis }) });
          return { state: 'deferred' as const, nextAt };
        }
        const now = new Date(), at = now.toISOString(), changes: Saved[] = [];
        const jobs: Awaited<ReturnType<typeof prepareFirestoreBackgroundWork>>[] = [];
        const checks = [nextGrowthCheck(loaded.context, now), ...loaded.sources.map(source => source.validUntil ?? null)];
        const readReference = async (ref: HistoryRef) => {
          const saved = await readAttention(b, ref.id);
          if (!saved || saved.item.version !== ref.version || saved.item.createdAt !== ref.createdAt) domainReject('growth_changed');
          return saved;
        };
        const invalidate = async (ref: HistoryRef) => {
          const previous = await readReference(ref);
          changes.push({ ...previous, item: { ...previous.item, version: previous.item.version + 1,
            state: 'inapplicable', updatedAt: at, lastAction: 'basis_unavailable', actorUserId: null,
            note: '適用條件或已核對來源已改變。' }, lastRequest: null });
        };
        for (const ref of progress.invalid) await invalidate(ref);
        for (const rule of GROWTH_RULES) {
          const group = progress.groups.find(value => value.topicId === rule.id)!, next = proposal(rule.id);
          if (group.closed) {
            if (group.activeCount > 16) domainReject('growth_history_requires_review', 400);
            for (const ref of group.active) await invalidate(ref);
          } else {
            for (const ref of group.due) {
              const previous = await readReference(ref);
              changes.push({ ...previous, item: { ...previous.item, version: previous.item.version + 1, state: 'proposed',
                snoozeUntil: null, updatedAt: at, lastAction: 'snooze_due', actorUserId: null }, lastRequest: null });
            }
            if (group.future) checks.push(group.future);
          }
          const latest = group.latest ? await readReference(group.latest) : null;
          if (!next || group.hasBasis || latest && !growthBasisChanged(latest.item.basis, next.basis)) continue;
          const related = group.related ? await readReference(group.related) : null;
          const linked = await task(b, related?.item.taskId ?? null), reasons: string[] = [];
          if (latest) {
            if (latest.item.basis.stage !== next.basis.stage) reasons.push('孩子已進入此規則的新適用階段');
            if (latest.item.basis.ruleRevision !== next.basis.ruleRevision || latest.item.basis.sourceHash !== next.basis.sourceHash) reasons.push('官方依據或規則已重新核對並實質更新');
            for (const def of rule.inputs) if (next.basis.values[def.key] !== 'unknown' && next.basis.values[def.key] !== latest.item.basis.values[def.key]) reasons.push('新確認近況：' + def.label);
          }
          const item: GrowthAttention = { ...next, id: randomUUID(), childId: b.scope.childId, version: 1, state: 'proposed', createdAt: at, updatedAt: at,
            snoozeUntil: null, previousId: latest?.item.id ?? null, newReason: latest ? reasons.join('；') + '。舊事項的處理結果保留。' : '首次符合這項有限規則。',
            whyNow: next.whyNow + (linked ? ' 另有相關已確認任務，請先核對其實際狀態；沒有判定尚未安排。' : ''),
            taskId: linked?.id ?? null, taskState: linked?.occurrence.state ?? null, lastAction: 'proposed', actorUserId: null, note: '' };
          changes.push({ item, lastRequest: null });
          jobs.push(await prepareFirestoreBackgroundWork(data, b.transaction, { kind: 'growth', scope: b.scope, resourceId: item.id,
            basis: firestoreDomainHash(item.basis), generation: b.generation, authorizationVersion: b.authorizationVersion }, at));
        }
        if (changes.length > 16) domainReject('growth_history_requires_review', 400);
        const nextAt = checks.filter((value): value is string => !!value && Date.parse(value) > now.getTime()).sort((a, x) => Date.parse(a) - Date.parse(x))[0] ?? null;
        if (nextAt) jobs.push(await childWake(b, 'due:' + nextAt + ':' + GROWTH_CATALOG_REVISION, nextAt));
        const check = { childId: b.scope.childId, catalog: GROWTH_CATALOG_REVISION, at, nextAt, basis };
        const change = changes.length ? await b.prepareChange(randomUUID(), 'growth', false) : null;
        const context = changes.length ? await prepareContextChange(data, b) : null;
        change?.commit(); context?.(); for (const saved of changes) write(b, saved); for (const job of jobs) job.commit();
        b.transaction.set(checkRef, { ...data.tags(b.scope), ...data.seal('growth-check', b.scope.childId, b.scope, checkSchema, check) });
        return { state: 'completed' as const };
      });
    },
    backgroundInput: (job: FirestoreBackgroundWork) => authority.runTransaction(job.scope.ownerUserId, job.scope.childId, async b => {
      if (await growthImportPending(data, b)) domainReject('growth_import_pending', 409);
      return backgroundInputIn(b, job);
    }),
    authorizeBackground: async (b: Binding, job: FirestoreBackgroundWork) => !!await backgroundInputIn(b, job),
    async taskAllowedIn(b: Binding, taskId: string) {
        let loaded: Awaited<ReturnType<typeof load>> | undefined, settings: Topic[] | undefined, allowed = true;
        await visitHistory(b, async ({ item, importedFrom }) => {
          if (item.taskId !== taskId) return;
          loaded ??= await load(b); settings ??= await topics(b);
          if (settings.some(value => value.topicId === item.topicId && value.disabled)
            || ['dismissed', 'snoozed', 'inapplicable'].includes(item.state) || !(await visible(b, item, loaded, !!importedFrom)).sourceAvailable) {
            allowed = false; return false;
          }
        });
        return allowed;
    },
    async taskAllowed(u: string, c: string, taskId: string): Promise<boolean> {
      return authority.runTransaction(u, c, b => store.taskAllowedIn(b, taskId));
    },
  };
  return store;
}
export type FirestoreGrowthStore = ReturnType<typeof createFirestoreGrowthStore>;

/** Existing persisted formats, shared with isolated recovery. */
export const firestoreGrowthRecoverySchema = checkSchema;
