import { prepareContentErasure } from './firestore-content-erasure.ts';
import { randomUUID } from 'node:crypto';
import type { DocumentSnapshot, Query } from '@google-cloud/firestore';
import { z } from 'zod';
import type { MemoryStore } from './memory.ts';
import type { MemoryFact, MemoryTopic, ConversationSummary, SummaryInput, FactSource } from '../src/shared/memory.ts';
import { factCreateSchema, factConfirmSchema, factReviseSchema, factDeactivateSchema, memoryDeleteSchema,
  topicCreateSchema, topicChangeSchema, topicReopenSchema, summarySaveSchema, factValuesSchema } from './memory-validation.ts';
import { factIsApplicable, normalizedFactKey, profileIsApplicable, requireTopicTransition, topicMayAsk } from './memory-policy.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { readContextBasis, prepareContextChange } from './firestore-context-basis.ts';
import { firestoreChatMessageSchema, type FirestoreChatStore } from './firestore-chat.ts';
import type { FirestoreCareStore } from './firestore-care.ts';
import type { FirestoreOnlineMutation } from './firestore-online.ts';

const uuid = z.uuid(), version = z.number().int().positive().max(2147483646), time = z.iso.datetime({ offset: true });
const user = z.string().min(1).max(256), visibility = z.enum(['private', 'family']), FAR_FUTURE = '9999-12-31T23:59:59.999Z';
export const firestoreFactSchema = factValuesSchema.extend({ id: uuid, childId: uuid, visibility, intendedVisibility: visibility,
  status: z.enum(['candidate', 'confirmed', 'inactive']), version, createdBy: user, confirmedBy: user.nullable(), confirmedAt: time.nullable(),
  reason: z.string().max(500), applicable: z.boolean(), sourceState: z.enum(['current', 'changed']), createdAt: time }).strict();
export const firestoreTopicSchema = z.object({ id: uuid, childId: uuid, visibility, title: z.string().min(1).max(200), note: z.string().max(2000),
  status: z.enum(['pending', 'answered', 'snoozed', 'resolved']), version, updatedBy: user, updatedAt: time,
  resumeAfter: time.nullable(), reopenReason: z.string().max(500).nullable(), reopenedFrom: uuid.nullable(), mayAsk: z.boolean() }).strict();
const summarySchema = z.object({ id: uuid, childId: uuid, version, text: z.string().min(1).max(6000), createdAt: time,
  previousId: uuid.nullable(), coveredMessageIds: z.array(uuid).min(1).max(50), lastCoveredMessageId: uuid }).strict();
const savedSummarySchema = z.object({ summary: summarySchema, basis: z.string().regex(/^[a-f0-9]{64}$/u),
  validUntil: time.nullable(), lastSortKey: z.string().regex(/^[0-9]{19}$/u) }).strict();
const keySchema = z.object({ id: uuid }).strict();
const tombstoneSchema = z.object({ id: uuid, childId: uuid, version, operationId: uuid, deletedAt: time }).strict();
const pathPattern = /^\/api\/children\/([0-9a-f-]{36})\/memory\/(facts|topics)(?:\/([0-9a-f-]{36})\/(confirm|revise|deactivate|delete|change|reopen))?$/iu;
type Binding = FirestoreAuthorityTransaction;
type Kind = 'facts' | 'topics';
type SavedSummary = z.infer<typeof savedSummarySchema>;
type Prepared<T> = { value: T; changeSeq: string; commit(): void };
export interface FirestoreMemoryStore extends MemoryStore {
  mutation: FirestoreOnlineMutation;
  prepareSummaryWrite(binding: Binding, raw: unknown, operationId: string): Promise<Prepared<ConversationSummary>>;
  readFact(binding: Binding, id: string): Promise<MemoryFact | null>;
  /** Current confirmed family facts by their existing uniqueness keys; no private corpus scan. */
  readFamilyFacts(binding: Binding, keys: readonly string[]): Promise<MemoryFact[]>;
  prepareFactChange(binding: Binding, action: 'revise' | 'deactivate', id: string, raw: unknown, operationId: string): Promise<Prepared<MemoryFact>>;
  /** Server-confirmed proposal only; never exposed as a model-supplied confirmation flag. */
  prepareConfirmedFact(binding: Binding, raw: unknown, confirmShared: boolean, operationId: string): Promise<Prepared<MemoryFact>>;
}
export function createFirestoreMemoryStore(options: FirestoreDomainOptions & { chat: FirestoreChatStore; care: FirestoreCareStore }): FirestoreMemoryStore {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options);
  const singular = (kind: Kind) => kind === 'facts' ? 'fact' : 'topic';
  function scoped(binding: Binding, collection: string): Query {
    const tags = data.tags(binding.scope);
    return data.collection(collection).where('workspaceTag', '==', tags.workspaceTag).where('epochTag', '==', tags.epochTag)
      .where('userTag', '==', tags.userTag).where('childTag', '==', tags.childTag);
  }
  function open<T>(binding: Binding, kind: string, id: string, schema: z.ZodType<T>, row: DocumentSnapshot) {
    if (Object.entries(data.tags(binding.scope)).some(([key, value]) => row.get(key) !== value)) domainReject('not_found', 404);
    return data.open(kind, id, binding.scope, schema, row);
  }
  const refFor = (kind: Kind, id: string) => data.ref('memory_' + kind, 'memory-' + singular(kind), id);
  async function read(binding: Binding, kind: Kind, id: string): Promise<MemoryFact | MemoryTopic | null> {
    domainParse(uuid, id);
    const row = await binding.transaction.get(refFor(kind, id)); if (!row.exists) return null;
    if (row.get('live') === false) { open(binding, 'memory-tombstone', id, tombstoneSchema, row); return null; }
    const value = kind === 'facts' ? open(binding, 'memory-fact', id, firestoreFactSchema, row) : open(binding, 'memory-topic', id, firestoreTopicSchema, row);
    if (value.id !== id || value.childId !== binding.scope.childId || value.version !== row.get('recordVersion') || row.get('live') !== true)
      domainReject('memory_binding', 500);
    return value;
  }
  async function sourceCurrent(binding: Binding, source: FactSource) {
    if (source.kind === 'care_record') return (await options.care.readRecord(binding, source.recordId))?.version === source.version;
    if (source.kind === 'private_chat') return !!source.messageId && await options.chat.readMessage(binding, binding.scope.childId, source.messageId) !== null;
    return true;
  }
  async function factResult(binding: Binding, value: MemoryFact): Promise<MemoryFact> {
    const sourceState = await sourceCurrent(binding, value.source) ? 'current' : 'changed';
    return { ...value, sourceState, applicable: factIsApplicable({ ...value, sourceState }) };
  }
  const topicResult = (value: MemoryTopic) => ({ ...value, mayAsk: topicMayAsk(value) });
  async function checkSource(binding: Binding, source: FactSource) {
    if (!await sourceCurrent(binding, source)) domainReject('source_changed');
  }
  function confirmShared(value: 'private' | 'family', confirmed: boolean) {
    if (value === 'family' && !confirmed) domainReject('sharing_confirmation_required', 400);
  }
  const keyId = (binding: Binding, kind: Kind, value: MemoryFact | MemoryTopic) => JSON.stringify([
    binding.scope.ownerUserId, binding.scope.childId, kind, value.visibility,
    normalizedFactKey(kind === 'facts' ? (value as MemoryFact).key : (value as MemoryTopic).title),
  ]);
  async function uniqueness(binding: Binding, kind: Kind, current: MemoryFact | MemoryTopic | null, next: MemoryFact | MemoryTopic | null) {
    const commits: (() => void)[] = [], oldKey = current ? keyId(binding, kind, current) : null, newKey = next ? keyId(binding, kind, next) : null;
    const needsKey = next && (kind === 'topics' || (next as MemoryFact).status === 'confirmed');
    if (oldKey && (oldKey !== newKey || !needsKey)) {
      const ref = data.ref('memory_keys', 'memory-key', oldKey), row = await binding.transaction.get(ref);
      if (row.exists && open(binding, 'memory-key', oldKey, keySchema, row).id === current!.id) commits.push(() => binding.transaction.delete(ref));
    }
    if (newKey && needsKey) {
      const ref = data.ref('memory_keys', 'memory-key', newKey), row = await binding.transaction.get(ref);
      if (row.exists) {
        const otherId = open(binding, 'memory-key', newKey, keySchema, row).id;
        if (otherId !== next!.id) {
          const other = await read(binding, kind, otherId);
          const conflict = other && (kind === 'topics' || factIsApplicable(await factResult(binding, other as MemoryFact)));
          // Reopening creates a new topic, with the old terminal topic kept as history.
          if (conflict && !(kind === 'topics' && (next as MemoryTopic).reopenedFrom === otherId))
            domainReject(kind === 'facts' ? 'fact_key_conflict' : 'topic_exists');
        }
      }
      const envelope = { ...data.tags(binding.scope), ...data.seal('memory-key', newKey, binding.scope, keySchema, { id: next!.id }) };
      commits.push(() => binding.transaction.set(ref, envelope));
    }
    return () => commits.forEach(commit => commit());
  }
  async function write(binding: Binding, kind: Kind, current: MemoryFact | MemoryTopic | null,
    next: MemoryFact | MemoryTopic | null, operationId: string): Promise<Prepared<MemoryFact | MemoryTopic | boolean>> {
    const id = next?.id ?? current!.id, nextVersion = next?.version ?? current!.version + 1, deleted = next === null;
    if (!current && (await binding.transaction.get(refFor(kind, id))).exists) domainReject('memory_conflict');
    const revisionId = JSON.stringify([id, nextVersion]), revisionRef = data.ref('memory_' + singular(kind) + '_revisions', 'memory-' + singular(kind) + '-revision', revisionId);
    if (!deleted && (await binding.transaction.get(revisionRef)).exists) domainReject('revision_conflict');
    const commitKeys = await uniqueness(binding, kind, current, next), contextChange = await prepareContextChange(data, binding);
    const change = await binding.prepareChange(operationId, 'memory', deleted);
    const tags = data.tags(binding.scope);
    let envelope: Record<string, unknown>, revision: Record<string, unknown> | undefined;
    if (next) {
      const metadata = { ...tags, entityId: id, entityVersion: nextVersion, live: true, visibility: next.visibility, status: next.status,
        validUntil: kind === 'facts' ? (next as MemoryFact).validUntil === null ? FAR_FUTURE : new Date((next as MemoryFact).validUntil!).toISOString() : FAR_FUTURE };
      if (kind === 'facts') {
        const fact = domainParse(firestoreFactSchema, { ...next,
          createdAt: current ? (current as z.infer<typeof firestoreFactSchema>).createdAt : new Date().toISOString() }, 'memory_binding', 500);
        envelope = { ...metadata, createdAt: fact.createdAt, ...data.seal('memory-fact', id, binding.scope, firestoreFactSchema, fact, nextVersion) };
        revision = { ...metadata, createdAt: fact.createdAt, ...data.seal('memory-fact-revision', revisionId, binding.scope, firestoreFactSchema, fact, nextVersion) };
      } else {
        const topic = domainParse(firestoreTopicSchema, next, 'memory_binding', 500);
        envelope = { ...metadata, ...data.seal('memory-topic', id, binding.scope, firestoreTopicSchema, topic, nextVersion) };
        revision = { ...metadata, ...data.seal('memory-topic-revision', revisionId, binding.scope, firestoreTopicSchema, topic, nextVersion) };
      }
    } else {
      envelope = { ...tags, entityId: id, entityVersion: nextVersion, live: false,
        ...data.seal('memory-tombstone', id, binding.scope, tombstoneSchema, {
          id, childId: binding.scope.childId, version: nextVersion, operationId, deletedAt: new Date().toISOString(),
        }, nextVersion) };
    }
    const erase = deleted ? prepareContentErasure(data, binding, kind === 'facts' ? 'fact' : 'topic', id, current!.version, operationId) : null;
    return { value: next ?? true, changeSeq: change.changeSeq, commit() {
      erase?.();
      change.commit(); contextChange(); commitKeys(); binding.transaction.set(refFor(kind, id), envelope);
      if (revision) binding.transaction.create(revisionRef, revision);
    } };
  }
  async function prepare(binding: Binding, kind: Kind, action: string | undefined, id: string | undefined,
    raw: unknown, operationId: string) {
    const old = id ? await read(binding, kind, id) : null;
    if (id && !old) domainReject('not_found', 404);
    const expect = (expectedVersion: number) => { if (!old || old.version !== expectedVersion) domainReject('version_conflict'); };
    const userId = binding.scope.ownerUserId, childId = binding.scope.childId, at = new Date().toISOString();
    let next: MemoryFact | MemoryTopic | null;
    if (action === 'delete') { const input = domainParse(memoryDeleteSchema, raw); expect(input.expectedVersion); next = null; }
    else if (kind === 'facts') {
      const fact = old as MemoryFact | null;
      if (!id) {
        const input = domainParse(factCreateSchema, raw); await checkSource(binding, input.values.source);
        next = { ...input.values, id: randomUUID(), childId, visibility: 'private', intendedVisibility: input.intendedVisibility,
          status: 'candidate', version: 1, createdBy: userId, confirmedBy: null, confirmedAt: null,
          reason: '候選，尚未確認', applicable: false, sourceState: 'current' };
      } else if (action === 'confirm') {
        const input = domainParse(factConfirmSchema, raw); expect(input.expectedVersion);
        if (fact!.status === 'confirmed') domainReject('already_confirmed');
        confirmShared(fact!.intendedVisibility, input.confirmShared); await checkSource(binding, fact!.source);
        next = { ...fact!, visibility: fact!.intendedVisibility, status: 'confirmed', version: fact!.version + 1,
          confirmedBy: userId, confirmedAt: at, reason: '使用者確認', sourceState: 'current' };
        next.applicable = factIsApplicable(next);
      } else if (action === 'revise') {
        const input = domainParse(factReviseSchema, raw); expect(input.expectedVersion);
        confirmShared(fact!.visibility, input.confirmShared); await checkSource(binding, input.values.source);
        next = { ...fact!, ...input.values, version: fact!.version + 1, reason: input.reason, sourceState: 'current',
          confirmedBy: fact!.status === 'confirmed' ? userId : fact!.confirmedBy, confirmedAt: fact!.status === 'confirmed' ? at : fact!.confirmedAt };
        next.applicable = factIsApplicable(next);
      } else if (action === 'deactivate') {
        const input = domainParse(factDeactivateSchema, raw); expect(input.expectedVersion);
        next = await factResult(binding, { ...fact!, version: fact!.version + 1, status: 'inactive', reason: input.reason, applicable: false });
      } else domainReject('invalid_input', 400);
    } else {
      const topic = old as MemoryTopic | null;
      if (!id) {
        const input = domainParse(topicCreateSchema, raw); confirmShared(input.visibility, input.confirmShared);
        next = { id: randomUUID(), childId, title: input.title, note: input.note, visibility: input.visibility, status: 'pending',
          version: 1, updatedBy: userId, updatedAt: at, resumeAfter: null, reopenReason: null, reopenedFrom: null, mayAsk: true };
      } else if (action === 'change') {
        const input = domainParse(topicChangeSchema, raw); expect(input.expectedVersion);
        requireTopicTransition(topic!.status, input.status, input.resumeAfter);
        next = topicResult({ ...topic!, status: input.status, note: input.note, resumeAfter: input.resumeAfter,
          version: topic!.version + 1, updatedBy: userId, updatedAt: at });
      } else if (action === 'reopen') {
        const input = domainParse(topicReopenSchema, raw); expect(input.expectedVersion);
        if (!['answered', 'resolved'].includes(topic!.status)) domainReject('topic_reopen_conflict');
        const key = data.ref('memory_reopened', 'memory-reopened', id!);
        if ((await binding.transaction.get(key)).exists) domainReject('topic_reopen_conflict');
        next = { ...topic!, id: randomUUID(), version: 1, status: 'pending', resumeAfter: null, reopenReason: input.reason,
          reopenedFrom: id!, updatedBy: userId, updatedAt: at, mayAsk: true };
        const prepared = await write(binding, kind, null, next, operationId);
        const envelope = { ...data.tags(binding.scope), ...data.seal('memory-reopened', id!, binding.scope, keySchema, { id: next.id }) };
        return { ...prepared, commit() { prepared.commit(); binding.transaction.create(key, envelope); } };
      } else domainReject('invalid_input', 400);
    }
    return write(binding, kind, old, next, operationId);
  }
  async function page(binding: Binding, kind: Kind, after: string | undefined, limit: number, familyOnly = false, confirmedOnly = false) {
    if (after) domainParse(uuid, after); domainParse(z.number().int().min(1).max(50), limit);
    let query = scoped(binding, 'memory_' + kind).where('live', '==', true);
    if (familyOnly) query = query.where('visibility', '==', 'family');
    if (confirmedOnly) query = query.where('status', '==', 'confirmed');
    query = query.orderBy('entityId', 'asc').limit(limit + 1);
    if (after) query = query.startAfter(after);
    const rows = await binding.transaction.get(query), items: (MemoryFact | MemoryTopic)[] = [];
    for (const row of rows.docs.slice(0, limit)) {
      const id = domainParse(uuid, row.get('entityId'), 'memory_binding', 500);
      const value = kind === 'facts' ? open(binding, 'memory-fact', id, firestoreFactSchema, row) : open(binding, 'memory-topic', id, firestoreTopicSchema, row);
      if (value.id !== id || value.childId !== binding.scope.childId || value.version !== row.get('recordVersion')) domainReject('memory_binding', 500);
      items.push(kind === 'facts' ? await factResult(binding, value as MemoryFact) : topicResult(value as MemoryTopic));
    }
    return { items, nextAfterId: rows.size > limit ? items.at(-1)!.id : null };
  }
  const summaryId = (binding: Binding) => JSON.stringify([binding.scope.ownerUserId, binding.scope.childId]);
  async function summaryBasis(binding: Binding) {
    const revision = await readContextBasis(data, binding), now = new Date().toISOString(), profile = await options.care.readProfile(binding);
    const query = scoped(binding, 'memory_facts').where('live', '==', true).where('status', '==', 'confirmed');
    const expired = await binding.transaction.get(query.where('validUntil', '<=', now).orderBy('validUntil', 'desc').limit(1));
    const future = await binding.transaction.get(query.where('validUntil', '>', now).orderBy('validUntil', 'asc').limit(1));
    let validUntil: string | null = future.docs[0]?.get('validUntil') ?? null;
    if (validUntil === FAR_FUTURE) validUntil = null;
    const applicable = profileIsApplicable(profile.data);
    if (applicable && profile.data?.validUntil) {
      const profileExpiry = new Date(Date.parse(profile.data.validUntil + 'T00:00:00Z') + 16 * 60 * 60 * 1000).toISOString();
      if (!validUntil || profileExpiry < validUntil) validUntil = profileExpiry;
    }
    return { basis: firestoreDomainHash([revision.basis, applicable, expired.docs[0]?.get('validUntil') ?? null]), validUntil };
  }
  async function summaryInput(binding: Binding) {
    const id = summaryId(binding), row = await binding.transaction.get(data.ref('conversation_summary_heads', 'conversation-summary-head', id));
    const saved = row.exists ? open(binding, 'conversation-summary-head', id, savedSummarySchema, row) : null;
    const current = await summaryBasis(binding);
    const usable = saved !== null && saved.basis === current.basis && (saved.validUntil === null || Date.parse(saved.validUntil) > Date.now());
    let query = scoped(binding, 'chat_messages').orderBy('sortKey', 'asc').limit(51);
    if (usable) query = query.startAfter(saved.lastSortKey);
    const rows = await binding.transaction.get(query);
    const messages = rows.docs.slice(0, 50).map(row => open(binding, 'chat-message', row.get('messageId'), firestoreChatMessageSchema, row));
    const input: SummaryInput = { previous: usable ? saved.summary : null, previousVersion: saved?.summary.version ?? 0,
      basis: current.basis, messages, moreUncovered: rows.size > 50 };
    return { input, current, rows, saved, usable };
  }
  async function prepareSummaryWrite(binding: Binding, raw: unknown, operationId: string): Promise<Prepared<ConversationSummary>> {
    const input = domainParse(summarySaveSchema, raw), expected = await summaryInput(binding);
    if (input.previousVersion !== expected.input.previousVersion || input.basis !== expected.input.basis ||
      JSON.stringify(input.coveredMessageIds) !== JSON.stringify(expected.input.messages.slice(0, input.coveredMessageIds.length).map(value => value.id)))
      domainReject('summary_coverage_changed');
    const value: ConversationSummary = { id: randomUUID(), childId: binding.scope.childId, version: expected.input.previousVersion + 1,
      text: input.text, createdAt: new Date().toISOString(), previousId: expected.input.previous?.id ?? null,
      coveredMessageIds: input.coveredMessageIds, lastCoveredMessageId: input.coveredMessageIds.at(-1)! };
    const saved: SavedSummary = { summary: value, basis: input.basis, validUntil: expected.current.validUntil,
      lastSortKey: expected.rows.docs[input.coveredMessageIds.length - 1].get('sortKey') };
    const change = await binding.prepareChange(operationId, 'memory', false), id = summaryId(binding);
    const head = { ...data.tags(binding.scope), ...data.seal('conversation-summary-head', id, binding.scope, savedSummarySchema, saved, value.version) };
    const revision = { ...data.tags(binding.scope), entityId: value.id, entityVersion: value.version,
      ...data.seal('conversation-summary', value.id, binding.scope, savedSummarySchema, saved, value.version) };
    return { value, changeSeq: change.changeSeq, commit() {
      change.commit(); binding.transaction.set(data.ref('conversation_summary_heads', 'conversation-summary-head', id), head);
      binding.transaction.create(data.ref('conversation_summaries', 'conversation-summary', value.id), revision);
    } };
  }
  async function direct(userId: string, childId: string, kind: Kind, action: string | undefined, id: string | undefined, raw: unknown) {
    const operationId = randomUUID();
    return authority.runTransaction(userId, childId, async binding => {
      const prepared = await prepare(binding, kind, action, id, raw, operationId); prepared.commit(); return prepared.value;
    });
  }
  const mutation: FirestoreOnlineMutation = {
    supports: path => pathPattern.test(path),
    async prepare(root, submission) {
      const match = pathPattern.exec(submission.path); if (!match) domainReject('invalid_input', 400);
      const childId = domainParse(uuid, match[1].toLowerCase()), kind = match[2] as Kind, action = match[4];
      if (!await root.readChild(childId)) domainReject('not_found', 404);
      const binding: Binding = { ...root, scope: { ...root.scope, childId },
        prepareChange: (op, type, deleted) => root.prepareChange(op, type, deleted, childId) };
      const prepared = await prepare(binding, kind, action, match[3]?.toLowerCase(), submission.payload, submission.operation.opId);
      return { childId, changeSeq: prepared.changeSeq, statusCode: !match[3] || action === 'reopen' ? 201 : 200,
        result: { [action === 'delete' ? 'deleted' : singular(kind)]: prepared.value }, commit: prepared.commit };
    },
  };
  const store: FirestoreMemoryStore = {
    mutation, prepareSummaryWrite,
    async readFamilyFacts(binding, keys) {
      domainParse(z.array(z.string().min(1).max(80)).max(8), keys);
      const facts: MemoryFact[] = [];
      for (const raw of new Set(keys.map(normalizedFactKey))) {
        const key = JSON.stringify([binding.scope.ownerUserId, binding.scope.childId, 'facts', 'family', raw]);
        const row = await binding.transaction.get(data.ref('memory_keys', 'memory-key', key)); if (!row.exists) continue;
        const id = open(binding, 'memory-key', key, keySchema, row).id, fact = await read(binding, 'facts', id) as MemoryFact | null;
        if (!fact || fact.visibility !== 'family' || normalizedFactKey(fact.key) !== raw || fact.status !== 'confirmed') domainReject('memory_key_binding', 500);
        facts.push(await factResult(binding, fact));
      }
      return facts;
    },
    readFact: async (binding, id) => {
      const fact = await read(binding, 'facts', id); return fact ? factResult(binding, fact as MemoryFact) : null;
    },
    prepareFactChange: async (binding, action, id, raw, operationId) =>
      await prepare(binding, 'facts', action, id, raw, operationId) as Prepared<MemoryFact>,
    prepareConfirmedFact: async (binding, raw, sharing, operationId) => {
      const input = domainParse(factCreateSchema, raw);
      confirmShared(input.intendedVisibility, sharing); await checkSource(binding, input.values.source);
      const value: MemoryFact = { ...input.values, id: randomUUID(), childId: binding.scope.childId,
        visibility: input.intendedVisibility, intendedVisibility: input.intendedVisibility, status: 'confirmed', version: 1,
        createdBy: binding.scope.ownerUserId, confirmedBy: binding.scope.ownerUserId, confirmedAt: new Date().toISOString(),
        reason: '使用者在對話核對並確認', applicable: false, sourceState: 'current' };
      value.applicable = factIsApplicable(value);
      return await write(binding, 'facts', null, value, operationId) as Prepared<MemoryFact>;
    },
    facts: (u, c, after, limit = 50) => authority.runTransaction(u, c, async binding => {
      const result = await page(binding, 'facts', after, limit); return { ...result, items: result.items as MemoryFact[] };
    }),
    getFact: (u, c, id) => authority.runTransaction(u, c, async binding => {
      const value = await read(binding, 'facts', id); return value ? factResult(binding, value as MemoryFact) : null;
    }),
    topics: (u, c, after) => authority.runTransaction(u, c, async binding => {
      const result = await page(binding, 'topics', after, 50); return { ...result, items: result.items as MemoryTopic[] };
    }),
    createFact: async (u, c, raw) => await direct(u, c, 'facts', undefined, undefined, raw) as MemoryFact,
    confirmFact: async (u, c, id, raw) => await direct(u, c, 'facts', 'confirm', id, raw) as MemoryFact,
    reviseFact: async (u, c, id, raw) => await direct(u, c, 'facts', 'revise', id, raw) as MemoryFact,
    deactivateFact: async (u, c, id, raw) => await direct(u, c, 'facts', 'deactivate', id, raw) as MemoryFact,
    createTopic: async (u, c, raw) => await direct(u, c, 'topics', undefined, undefined, raw) as MemoryTopic,
    changeTopic: async (u, c, id, raw) => await direct(u, c, 'topics', 'change', id, raw) as MemoryTopic,
    reopenTopic: async (u, c, id, raw) => await direct(u, c, 'topics', 'reopen', id, raw) as MemoryTopic,
    delete: async (u, c, kind, id, expectedVersion) => await direct(u, c, kind, 'delete', id, { expectedVersion, confirmDelete: true }) as true,
    history: (u, c, kind, id, before = 2147483647) => authority.runTransaction(u, c, async binding => {
      if (!await read(binding, kind, id)) return null;
      const rows = await binding.transaction.get(scoped(binding, 'memory_' + singular(kind) + '_revisions')
        .where('entityId', '==', id).where('entityVersion', '<', before).orderBy('entityVersion', 'desc').limit(51));
      const revisions: (MemoryFact | MemoryTopic)[] = [];
      for (const row of rows.docs.slice(0, 50)) {
        const revisionId = JSON.stringify([id, row.get('entityVersion')]);
        revisions.push(kind === 'facts'
          ? await factResult(binding, open(binding, 'memory-fact-revision', revisionId, firestoreFactSchema, row))
          : topicResult(open(binding, 'memory-topic-revision', revisionId, firestoreTopicSchema, row)));
      }
      return { revisions, nextBeforeVersion: rows.size > 50 ? rows.docs[49].get('entityVersion') as number : null };
    }),
    summary: (u, c) => authority.runTransaction(u, c, async binding => ({ summary: (await summaryInput(binding)).input.previous })),
    initialConversationSummary: (u, c) => authority.runTransaction(u, c, async binding => {
      const result = await summaryInput(binding); if (!result.input.previous) return null;
      const { id, version, text, createdAt, lastCoveredMessageId } = result.input.previous;
      return { summary: { id, version, text, createdAt, lastCoveredMessageId }, basis: result.current.basis, validUntil: result.current.validUntil };
    }),
    prepareSummary: (u, c) => authority.runTransaction(u, c, async binding => (await summaryInput(binding)).input),
    saveSummary: (u, c, raw) => authority.runTransaction(u, c, async binding => {
      const prepared = await prepareSummaryWrite(binding, raw, randomUUID()); prepared.commit(); return prepared.value;
    }),
    reportFacts: (u, c, after) => authority.runTransaction(u, c, async binding => {
      const result = await page(binding, 'facts', after, 20, true, true); return { ...result, items: result.items as MemoryFact[] };
    }),
    context: (u, c, scope, pages = {}) => authority.runTransaction(u, c, async binding => {
      const profile = await options.care.readProfile(binding), facts = await page(binding, 'facts', pages.factsAfterId, 20, scope === 'family', true);
      const topics = await page(binding, 'topics', pages.topicsAfterId, 20, scope === 'family'), summary = scope === 'private' ? await summaryInput(binding) : null;
      const allFacts = facts.items as MemoryFact[], applicable = allFacts.filter(fact => fact.applicable), values = new Map<string, Set<string>>();
      for (const fact of applicable) { const key = normalizedFactKey(fact.key), contents = values.get(key) ?? new Set<string>(); contents.add(fact.content); values.set(key, contents); }
      return { profile, profileApplicable: profileIsApplicable(profile.data), facts: applicable, topics: topics.items as MemoryTopic[],
        summary: summary?.input.previous ?? null, recentMessages: summary?.input.messages ?? [],
        conflictingKeys: [...values].filter(([, contents]) => contents.size > 1).map(([key]) => key),
        unavailableFactKeys: allFacts.filter(fact => !fact.applicable).map(fact => normalizedFactKey(fact.key)),
        nextFactsAfterId: facts.nextAfterId, nextTopicsAfterId: topics.nextAfterId, summaryUnavailable: null,
        truncated: { facts: !!facts.nextAfterId, topics: !!topics.nextAfterId, messages: summary?.input.moreUncovered ?? false } };
    }),
  };
  return store;
}

/** Persisted schemas reused by isolated recovery; not a second domain model. */
export const firestoreMemoryRecoverySchemas = { summary: savedSummarySchema, key: keySchema, tombstone: tombstoneSchema };
