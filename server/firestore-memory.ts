import { makeSummaryChatSource, makeSummaryCorrectionSource, summaryManifestSchema, summarySourceRevisionSchema,
  type SummarySourceReader, type SummarySourceDecision, type SummaryDependency, type SummaryResolvedSource,
  type PrivateSummarySourceRevision, type SummaryCoverageProof, summaryLineageKeyForTarget, type SummaryLineageTarget, type SummaryFastTarget, type SummaryFastSource } from './private-summary-work.ts';
import { summaryDependencySchema, summaryBatchSchema } from './memory-validation.ts';
import { prepareContentErasure } from './firestore-content-erasure.ts';
import { factContentDate, summarySourcePeriod, summarySourcePeriodSchema, memoryUpdateDate } from './handover-memory-dates.ts';
import { randomUUID } from 'node:crypto';
import type { DocumentSnapshot, Query } from '@google-cloud/firestore';
import { z } from 'zod';
import type { MemoryStore } from './memory.ts';
import type { MemoryFact, MemoryTopic, ConversationSummary, SummaryInput, FactSource } from '../src/shared/memory.ts';
import { factCreateSchema, factConfirmSchema, factReviseSchema, factDeactivateSchema, memoryDeleteSchema,
  topicCreateSchema, topicChangeSchema, topicReopenSchema, summarySaveSchema, factValuesSchema, sharedFactCreateSchema } from './memory-validation.ts';
import { factIsApplicable, normalizedFactKey, profileIsApplicable, requireTopicTransition, topicMayAsk } from './memory-policy.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { readContextBasis, prepareContextChange } from './firestore-context-basis.ts';
import { firestoreChatMessageSchema, type FirestoreChatStore } from './firestore-chat.ts';
import type { FirestoreCareStore } from './firestore-care.ts';
import type { FirestoreOnlineMutation } from './firestore-online.ts';
import { readImportMapping, type HandoverImportResolution } from './handover-import-records.ts';
import { createFirestoreSharingStore } from './firestore-sharing.ts';
import { contentVisible } from './firestore-disclosure.ts';
import { sharedWriteAttributionSchema, sharedWriteAttribution, validSharedAttribution } from './shared-write-attribution.ts';
import { importProvenanceSchema } from '../src/shared/import-provenance.ts';
import { importConfirmationActor, makeImportProvenance } from './handover-provenance.ts';
import type { HandoverImportRow } from './handover-import.ts';
import type { HandoverIntegrity } from '../src/shared/handover.ts';
import { selectSummaryBatchMessages } from './summary-window-helper.ts';
import { historicalSummaryText, summaryExpiry } from './summary-projection.ts';
import { preparePrivateSummaryScanProgress } from './firestore-private-summary-scan.ts';

export const SUMMARY_PROJECTION_MAX_CHARS = 3000;

const uuid = z.uuid(), version = z.number().int().positive().max(2147483646), time = z.iso.datetime({ offset: true });
const user = z.string().min(1).max(256), visibility = z.enum(['private', 'family']), FAR_FUTURE = '9999-12-31T23:59:59.999Z';
export const firestoreFactStorageSchema = factValuesSchema.extend({ id: uuid, childId: uuid, visibility, intendedVisibility: visibility,
  status: z.enum(['candidate', 'confirmed', 'inactive']), version, createdBy: user, confirmedBy: user.nullable(), confirmedAt: time.nullable(),
  reason: z.string().max(500), applicable: z.boolean(), sourceState: z.enum(['current', 'changed']), createdAt: time, contentUpdatedAt: time.nullable().optional(),
  importedFrom: importProvenanceSchema.optional(), confirmationBasis: z.literal('imported_source').optional(),
  createdViaShare: sharedWriteAttributionSchema.optional(), confirmedViaShare: sharedWriteAttributionSchema.optional(),
  changedViaShare: sharedWriteAttributionSchema.optional() }).strict();
export const firestoreFactSchema = firestoreFactStorageSchema.transform(({ createdViaShare, confirmedViaShare, changedViaShare, ...fact }) => fact);
export function hasPrivateMessageReference(source: FactSource) {
  const original = source.kind === 'imported' ? source.original : source;
  return original.kind === 'private_chat' && original.messageId !== undefined;
}
export const firestoreTopicStorageSchema = z.object({ id: uuid, childId: uuid, visibility, title: z.string().min(1).max(200), note: z.string().max(2000),
  status: z.enum(['pending', 'answered', 'snoozed', 'resolved']), version, updatedBy: user, updatedAt: time,
  resumeAfter: time.nullable(), reopenReason: z.string().max(500).nullable(), reopenedFrom: uuid.nullable(), mayAsk: z.boolean(),
  importedFrom: importProvenanceSchema.optional(),
  changedViaShare: sharedWriteAttributionSchema.optional() }).strict();
export const firestoreTopicSchema = firestoreTopicStorageSchema.transform(({ changedViaShare, ...topic }) => topic);
export function validMemoryFactAttribution(value: z.infer<typeof firestoreFactStorageSchema>, scope: Binding['scope']) {
  const proof = value.confirmedViaShare;
  const confirmer = importConfirmationActor(value, 'memory_facts');
  if (confirmer === undefined || value.source.kind === 'imported' && value.importedFrom?.current.source.section !== 'memory_facts') return false;
  return validSharedAttribution(value.createdViaShare, scope, value.id, value.version, value.createdBy, true)
    && (value.confirmedBy === null ? proof === undefined : (!proof || proof.resourceVersion <= value.version)
      && validSharedAttribution(proof, scope, value.id, proof?.resourceVersion ?? value.version, confirmer!))
    && (!value.changedViaShare || validSharedAttribution(value.changedViaShare, scope, value.id, value.version, value.changedViaShare.actorUserId));
}
const summarySchema = z.object({ id: uuid, childId: uuid, version, text: z.string().min(1).max(6000), createdAt: time,
  previousId: uuid.nullable(), coveredMessageIds: z.array(uuid).min(1).max(50), lastCoveredMessageId: uuid,
  coverageScope: z.literal('imported_source').optional(), importedFrom: importProvenanceSchema.optional(), sourcePeriod: summarySourcePeriodSchema.optional(),
}).strict().refine(value => value.coverageScope === 'imported_source' ? value.importedFrom?.current.source.section === 'summary_history'
  : value.importedFrom === undefined);
export { summarySchema as firestoreSummarySchema };
const savedSummarySchema = z.object({ summary: summarySchema, basis: z.string().regex(/^[a-f0-9]{64}$/u),
  validUntil: time.nullable(), lastSortKey: z.string().regex(/^[0-9]{19}$/u), batch: summaryBatchSchema.optional() }).strict();
export { savedSummarySchema as firestoreSavedSummarySchema };
const keySchema = z.object({ id: uuid }).strict();
const tombstoneSchema = z.object({ id: uuid, childId: uuid, version, operationId: uuid, deletedAt: time }).strict();
const pathPattern = /^\/api\/children\/([0-9a-f-]{36})\/memory\/(facts|topics)(?:\/([0-9a-f-]{36})\/(confirm|revise|deactivate|delete|change|reopen)|\/(confirmed))?$/iu;
type Binding = FirestoreAuthorityTransaction;
type Kind = 'facts' | 'topics';
type SavedSummary = z.infer<typeof savedSummarySchema>;
type Prepared<T> = { value: T; changeSeq: string; commit(): void };
/** Bounded Server-only alternatives; none are covered until the selected batch is saved. */
export interface SummaryMaintenanceInput extends SummaryInput { alternatives?: SummaryInput[] }
export type PreparedCompletedSummary = ({ kind: 'prepared' } & Prepared<ConversationSummary>)
  | Exclude<SummarySourceDecision, { kind: 'eligible' | 'no_work' }>;
export interface FirestoreMemoryStore extends MemoryStore, SummarySourceReader {
  readFreshMaintenance(binding: Binding): Promise<SummaryInput | null>;
  /** Bounded private scan readers; never advance coverage or change source admission. */
  readSummaryScanHead(binding: Binding): Promise<{ basis: string; freshCaughtUp: boolean; upperSortKey: string | null }>;
  readSummaryScanPage(binding: Binding, input: { upperSortKey: string; after: { sortKey: string; id: string } | null; limit: number }):
    Promise<{ items: { id: string; sortKey: string; version: number }[]; exhausted: boolean }>;
  forSharedSpace(spaceId: string): MemoryStore;
  mutation: FirestoreOnlineMutation;
  readSummaryRevision(binding: Binding, raw: unknown, includePeriod?: boolean): Promise<ConversationSummary | null>;
  readImportedSummary(binding: Binding, id: string): Promise<ConversationSummary | null>;
  prepareImportedSummaryPeriod(binding: Binding, id: string, expectedVersion: number, period: NonNullable<ConversationSummary['sourcePeriod']>): Promise<() => void>;
  prepareImportedSummary(binding: Binding, operationId: string, row: HandoverImportRow, integrity: HandoverIntegrity,
    current?: { id: string; expectedVersion: number }): Promise<Prepared<ConversationSummary>>;
  prepareMaintenance(userId: string, childId: string): Promise<SummaryMaintenanceInput | null>;
  prepareCompletedWorkWrite(binding: Binding, input: { revision: PrivateSummarySourceRevision; text: string }, operationId: string): Promise<PreparedCompletedSummary>;
  prepareSummaryWrite(binding: Binding, raw: unknown, operationId: string): Promise<Prepared<ConversationSummary>>;
  readFact(binding: Binding, id: string): Promise<MemoryFact | null>;
  readTopic(binding: Binding, id: string): Promise<MemoryTopic | null>;
  readExportRevision(binding: Binding, kind: Kind, row: DocumentSnapshot): Promise<MemoryFact | MemoryTopic | null>;
  /** Current confirmed family facts by their existing uniqueness keys; no private corpus scan. */
  readFamilyFacts(binding: Binding, keys: readonly string[]): Promise<MemoryFact[]>;
  prepareFactChange(binding: Binding, action: 'revise' | 'deactivate', id: string, raw: unknown, operationId: string): Promise<Prepared<MemoryFact>>;
  /** Server-confirmed proposal only; never exposed as a model-supplied confirmation flag. */
  prepareConfirmedFact(binding: Binding, raw: unknown, confirmShared: boolean, operationId: string): Promise<Prepared<MemoryFact>>;
  readImportState(binding: Binding, kind: 'facts' | 'topics', id: string): Promise<{ value: MemoryFact | MemoryTopic | null; version: number }>;
  prepareOriginalMemory(binding: Binding, operationId: string, row: HandoverImportRow, integrity: HandoverIntegrity,
    resolution: HandoverImportResolution): Promise<Prepared<MemoryFact | MemoryTopic>>;
  prepareImportedFact(binding: Binding, operationId: string, row: HandoverImportRow, integrity: HandoverIntegrity,
    current?: { id: string; expectedVersion: number }): Promise<Prepared<MemoryFact>>;
  prepareImportedTopic(binding: Binding, operationId: string, row: HandoverImportRow, integrity: HandoverIntegrity,
    current?: { id: string; expectedVersion: number }): Promise<Prepared<MemoryTopic>>;
}
export function createFirestoreMemoryStore(options: FirestoreDomainOptions & { chat: FirestoreChatStore; care: FirestoreCareStore; maxSummaryProjectionCharacters?: number }): FirestoreMemoryStore {
  const maxSummaryProjectionCharacters = options.maxSummaryProjectionCharacters ?? SUMMARY_PROJECTION_MAX_CHARS;
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options), sharing = createFirestoreSharingStore(options);
  const requireMemory = (binding: Binding) => { if (binding.sharedAccess && binding.sharedAccess.module !== 'memory') domainReject('shared_module_scope', 403); };
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
  function readRow(binding: Binding, kind: Kind, id: string, row: DocumentSnapshot): MemoryFact | MemoryTopic | null {
    requireMemory(binding);
    if (!row.exists) return null;
    if (row.get('live') === false) { open(binding, 'memory-tombstone', id, tombstoneSchema, row); return null; }
    const value = kind === 'facts' ? open(binding, 'memory-fact', id, firestoreFactStorageSchema, row) : open(binding, 'memory-topic', id, firestoreTopicStorageSchema, row);
    if (value.id !== id || value.childId !== binding.scope.childId || value.version !== row.get('recordVersion') || row.get('live') !== true)
      domainReject('memory_binding', 500);
    if (kind === 'facts' ? !validMemoryFactAttribution(value as z.infer<typeof firestoreFactStorageSchema>, binding.scope)
      : !validSharedAttribution((value as z.infer<typeof firestoreTopicStorageSchema>).changedViaShare, binding.scope, id, value.version, (value as MemoryTopic).updatedBy)) domainReject('memory_binding', 500);
    if (binding.sharedAccess && value.visibility !== 'family') return null;
    return value;
  }
  async function read(binding: Binding, kind: Kind, id: string) {
    domainParse(uuid, id);
    return readRow(binding, kind, id, await binding.transaction.get(refFor(kind, id)));
  }
  async function sourceCurrent(binding: Binding, source: FactSource) {
    if (source.kind === 'imported') return source.sourceState === 'current';
    if (source.kind === 'care_record') return contentVisible(data, binding, 'care', source.recordId, source.version, true);
    if (source.kind === 'private_chat') return !!source.messageId && await options.chat.readMessage(binding, binding.scope.childId, source.messageId) !== null;
    return true;
  }
  async function factResult(binding: Binding, value: MemoryFact): Promise<MemoryFact> {
    const sourceState = await sourceCurrent(binding, value.source) ? 'current' : 'changed';
    const clean = firestoreFactSchema.parse(value);
    const source = binding.scope.ownerUserId !== binding.actorUserId ? publicSource(value.source) : value.source;
    return { ...clean, source, sourceState, applicable: factIsApplicable({ ...value, sourceState }) };
  }
  const topicResult = (value: MemoryTopic) => ({ ...firestoreTopicSchema.parse(value), mayAsk: topicMayAsk(value) });
  async function checkSource(binding: Binding, source: FactSource, retained = false) {
    if (source.kind === 'imported' && !retained) domainReject('imported_source_not_retained', 400);
    if (binding.sharedAccess && binding.actorUserId !== binding.scope.ownerUserId && source.kind === 'private_chat' && !retained) domainReject('private_source_unavailable', 403);
    if (!await sourceCurrent(binding, source)) domainReject('source_changed');
  }
  function publicSource(source: FactSource): FactSource {
    if (!hasPrivateMessageReference(source)) return source;
    if (source.kind === 'private_chat') return { kind: 'private_chat', description: source.description };
    if (source.kind === 'imported' && source.original.kind === 'private_chat')
      return { ...source, original: { kind: 'private_chat', description: source.original.description } };
    return source;
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
    next: MemoryFact | MemoryTopic | null, operationId: string, factSnapshotAt: string | null = new Date().toISOString()): Promise<Prepared<MemoryFact | MemoryTopic | boolean>> {
    requireMemory(binding);
    if (binding.sharedAccess && next && next.visibility !== 'family') domainReject('shared_private_scope', 403);
    const id = next?.id ?? current!.id, nextVersion = next?.version ?? current!.version + 1, deleted = next === null;
    if (!current && (await binding.transaction.get(refFor(kind, id))).exists) domainReject('memory_conflict');
    const revisionId = JSON.stringify([id, nextVersion]), revisionRef = data.ref('memory_' + singular(kind) + '_revisions', 'memory-' + singular(kind) + '-revision', revisionId);
    if (!deleted && (await binding.transaction.get(revisionRef)).exists) domainReject('revision_conflict');
    const commitKeys = await uniqueness(binding, kind, current, next), contextChange = await prepareContextChange(data, binding);
    const change = await binding.prepareChange(operationId, 'memory', deleted);
    const tags = data.tags(binding.scope);
    let envelope: Record<string, unknown>, revision: Record<string, unknown> | undefined, publicValue: MemoryFact | MemoryTopic | boolean = true;
    if (next) {
      const metadata = { ...tags, entityId: id, entityVersion: nextVersion, live: true, visibility: next.visibility, status: next.status,
        validUntil: kind === 'facts' ? (next as MemoryFact).validUntil === null ? FAR_FUTURE : new Date((next as MemoryFact).validUntil!).toISOString() : FAR_FUTURE };
      if (kind === 'facts') {
        const old = current as z.infer<typeof firestoreFactStorageSchema> | null, value = next as MemoryFact;
        const changed = sharedWriteAttribution(binding, id, nextVersion), created = old?.createdViaShare ?? (!old ? changed : undefined);
        const confirmed = value.confirmedBy === null ? undefined : value.confirmedBy === old?.confirmedBy && value.confirmedAt === old?.confirmedAt
          && importConfirmationActor(value, 'memory_facts') === (old ? importConfirmationActor(old, 'memory_facts') : undefined) ? old?.confirmedViaShare : changed;
        const fact = domainParse(firestoreFactStorageSchema, { ...firestoreFactSchema.parse({ ...next, createdAt: old?.createdAt ?? new Date().toISOString() }),
          ...(created ? { createdViaShare: created } : {}), ...(confirmed ? { confirmedViaShare: confirmed } : {}), ...(changed ? { changedViaShare: changed } : {}),
          createdAt: old?.createdAt ?? new Date().toISOString(), contentUpdatedAt: factSnapshotAt }, 'memory_binding', 500);
        // Canonical storage omits absent optional fields instead of serializing undefined.
        if (fact.confirmationBasis === undefined) delete fact.confirmationBasis;
        envelope = { ...metadata, createdAt: fact.createdAt, ...data.seal('memory-fact', id, binding.scope, firestoreFactStorageSchema, fact, nextVersion) };
        revision = { ...metadata, createdAt: fact.createdAt, ...data.seal('memory-fact-revision', revisionId, binding.scope, firestoreFactStorageSchema, fact, nextVersion) };
        publicValue = await factResult(binding, fact);
      } else {
        const changed = sharedWriteAttribution(binding, id, nextVersion);
        const topic = domainParse(firestoreTopicStorageSchema, { ...firestoreTopicSchema.parse(next), ...(changed ? { changedViaShare: changed } : {}) }, 'memory_binding', 500);
        envelope = { ...metadata, ...data.seal('memory-topic', id, binding.scope, firestoreTopicStorageSchema, topic, nextVersion) };
        revision = { ...metadata, ...data.seal('memory-topic-revision', revisionId, binding.scope, firestoreTopicStorageSchema, topic, nextVersion) };
        publicValue = topicResult(topic);
      }
    } else {
      envelope = { ...tags, entityId: id, entityVersion: nextVersion, live: false,
        ...data.seal('memory-tombstone', id, binding.scope, tombstoneSchema, {
          id, childId: binding.scope.childId, version: nextVersion, operationId, deletedAt: new Date().toISOString(),
        }, nextVersion) };
    }
    const erase = deleted ? prepareContentErasure(data, binding, kind === 'facts' ? 'fact' : 'topic', id, current!.version, operationId) : null;
    return { value: publicValue, changeSeq: change.changeSeq, commit() {
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
    const userId = binding.actorUserId, childId = binding.scope.childId, at = new Date().toISOString();
    let next: MemoryFact | MemoryTopic | null;
    if (action === 'delete') { const input = domainParse(memoryDeleteSchema, raw); expect(input.expectedVersion); next = null; }
    else if (kind === 'facts') {
      const fact = old as MemoryFact | null;
      if (!id) {
        if (action === 'confirmed') {
          const input = domainParse(sharedFactCreateSchema, raw);
          return store.prepareConfirmedFact(binding, { values: input.values, intendedVisibility: input.intendedVisibility }, input.confirmShared, operationId);
        }
        if (binding.sharedAccess) domainReject('shared_candidate_private', 400);
        const input = domainParse(factCreateSchema, raw); await checkSource(binding, input.values.source);
        next = { ...input.values, id: randomUUID(), childId, visibility: 'private', intendedVisibility: input.intendedVisibility,
          status: 'candidate', version: 1, createdBy: userId, confirmedBy: null, confirmedAt: null,
          reason: '候選，尚未確認', applicable: false, sourceState: 'current' };
      } else if (action === 'confirm') {
        const input = domainParse(factConfirmSchema, raw); expect(input.expectedVersion);
        if (fact!.status === 'confirmed') domainReject('already_confirmed');
        confirmShared(fact!.intendedVisibility, input.confirmShared); await checkSource(binding, fact!.source, true);
        next = { ...fact!, visibility: fact!.intendedVisibility, status: 'confirmed', version: fact!.version + 1,
          confirmedBy: userId, confirmedAt: at, reason: '使用者確認', sourceState: 'current', confirmationBasis: undefined };
        next.applicable = factIsApplicable(next);
      } else if (action === 'revise') {
        const input = domainParse(factReviseSchema, raw); expect(input.expectedVersion);
        const source = input.values.source, previous = fact!.source;
        const retained = source.kind === 'private_chat' && previous.kind === 'private_chat'
          && source.description === previous.description && (source.messageId === undefined || source.messageId === previous.messageId)
          || source.kind === 'imported' && previous.kind === 'imported' && firestoreDomainHash(publicSource(source)) === firestoreDomainHash(publicSource(previous));
        if (retained) input.values.source = previous;
        confirmShared(fact!.visibility, input.confirmShared); await checkSource(binding, input.values.source, retained);
        next = { ...fact!, ...input.values, version: fact!.version + 1, reason: input.reason, sourceState: 'current',
          confirmedBy: fact!.status === 'confirmed' ? userId : fact!.confirmedBy, confirmedAt: fact!.status === 'confirmed' ? at : fact!.confirmedAt,
          confirmationBasis: fact!.status === 'confirmed' ? undefined : fact!.confirmationBasis };
        next.applicable = factIsApplicable(next);
      } else if (action === 'deactivate') {
        const input = domainParse(factDeactivateSchema, raw); expect(input.expectedVersion);
        next = { ...fact!, version: fact!.version + 1, status: 'inactive', reason: input.reason, applicable: false };
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
    requireMemory(binding); familyOnly ||= !!binding.sharedAccess;
    if (after) domainParse(uuid, after); domainParse(z.number().int().min(1).max(50), limit);
    let query = scoped(binding, 'memory_' + kind).where('live', '==', true);
    if (familyOnly) query = query.where('visibility', '==', 'family');
    if (confirmedOnly) query = query.where('status', '==', 'confirmed');
    query = query.orderBy('entityId', 'asc').limit(limit + 1);
    if (after) query = query.startAfter(after);
    const rows = await binding.transaction.get(query), items: (MemoryFact | MemoryTopic)[] = [];
    for (const row of rows.docs.slice(0, limit)) {
      const id = domainParse(uuid, row.get('entityId'), 'memory_binding', 500);
      const value = readRow(binding, kind, id, row); if (!value) domainReject('memory_binding', 500);
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
  async function batchValid(binding: Binding, saved: SavedSummary, cache = new Map<string, DocumentSnapshot>()) {
    if (!saved.batch || saved.batch.authorizationVersion !== binding.authorizationVersion) return false;
    // Bounded dependency discovery must not silently treat a partial page as a complete invalidation graph.
    if (!saved.batch.sourceCoverageComplete && saved.basis !== (await summaryBasis(binding)).basis) return false;
    if (!(Date.now() < summaryExpiry([saved.validUntil, ...saved.batch.dependencies.map(item => item.validUntil)]))) return false;
    for (const dependency of saved.batch.dependencies) {
      const [collection, kind] = dependency.kind === 'profile' ? ['child_profiles', 'child-profile']
        : dependency.kind === 'fact' ? ['memory_facts', 'memory-fact'] : dependency.kind === 'topic'
          ? ['memory_topics', 'memory-topic'] : ['care_records', 'care-record'];
      const key = kind + ':' + dependency.id;
      let row = cache.get(key);
      if (!row) { row = await binding.transaction.get(data.ref(collection, kind, dependency.id)); cache.set(key, row); }
      if (dependency.kind === 'profile' && dependency.version === 0 && !row.exists) continue;
      if (!row.exists || row.get('live') === false || row.get('recordVersion') !== dependency.version
        || Object.entries(data.tags(binding.scope)).some(([key, value]) => row.get(key) !== value)) return false;
    }
    // Chat rows are immutable and removed with child/account access; the authority transaction already checked that scope.
    // No per-message existence scan is needed on every model request.
    return true;
  }
  async function readSummaryRevision(binding: Binding, raw: unknown, includePeriod = false) {
    const saved = domainParse(savedSummarySchema, raw);
    if (saved.summary.coverageScope === 'imported_source') {
      if (saved.summary.childId !== binding.scope.childId || binding.sharedAccess || saved.batch) domainReject('summary_binding', 500);
      return saved.summary;
    }
    if (saved.batch) {
      if (!await batchValid(binding, saved)) return null;
    } else {
      const current = await summaryBasis(binding);
      if (saved.basis !== current.basis || saved.validUntil && Date.parse(saved.validUntil) <= Date.now()) return null;
    }
    if (!includePeriod || saved.summary.sourcePeriod || saved.summary.previousId || saved.batch?.replaces) return saved.summary;
    const messages = [];
    for (const id of saved.summary.coveredMessageIds) {
      const message = await options.chat.readMessage(binding, binding.scope.childId, id);
      if (!message) return saved.summary;
      messages.push(message);
    }
    const period = summarySourcePeriod(messages);
    return period ? { ...saved.summary, sourcePeriod: period } : saved.summary;
  }
  async function recentBatches(binding: Binding) {
    const rows = await binding.transaction.get(scoped(binding, 'conversation_summaries').where('currentBatch', '==', true)
      .orderBy('lastMessageSortKey', 'desc').limit(5));
    const batches: { saved: SavedSummary; valid: boolean; row: DocumentSnapshot }[] = [], cache = new Map<string, DocumentSnapshot>();
    for (const row of rows.docs.slice(0, 4)) {
      const saved = open(binding, 'conversation-summary', row.get('entityId'), savedSummarySchema, row);
      if (saved.summary.coverageScope || !saved.batch || row.get('lastMessageSortKey') !== saved.batch.lastMessageSortKey) domainReject('summary_binding', 500);
      batches.push({ saved, row, valid: await batchValid(binding, saved, cache) });
    }
    return { batches, more: rows.size > 4 };
  }
  async function summaryInput(binding: Binding) {
    const id = summaryId(binding), row = await binding.transaction.get(data.ref('conversation_summary_heads', 'conversation-summary-head', id));
    const saved = row.exists ? open(binding, 'conversation-summary-head', id, savedSummarySchema, row) : null;
    if (saved?.summary.coverageScope) domainReject('summary_binding', 500);
    const current = await summaryBasis(binding);
    const usable = saved !== null && (saved.batch ? await batchValid(binding, saved)
      : saved.basis === current.basis && (saved.validUntil === null || Date.parse(saved.validUntil) > Date.now()));
    // New batches never rewind their coverage watermark after a source edit. Legacy cumulative summaries remain conservative.
    let query = scoped(binding, 'chat_messages').orderBy('sortKey', 'asc').limit(51);
    if (saved && (saved.batch || usable)) query = query.startAfter(saved.lastSortKey);
    const rows = await binding.transaction.get(query);
    const messages = rows.docs.slice(0, 50).map(row => open(binding, 'chat-message', row.get('messageId'), firestoreChatMessageSchema, row));
    const input: SummaryInput = { previous: usable ? saved.summary : null, previousVersion: saved?.summary.version ?? 0,
      basis: current.basis, messages, moreUncovered: rows.size > 50, summaryMode: 'isolated_batch' };
    return { input, current, rows, saved, usable };
  }
  async function summaryDependencies(binding: Binding) {
    const profile = await options.care.readProfile(binding), facts = await page(binding, 'facts', undefined, 20, false, true),
      topics = await page(binding, 'topics', undefined, 20);
    const dependencies: z.infer<typeof summaryDependencySchema>[] = [{ kind: 'profile', id: binding.scope.childId, version: profile.version, validUntil: profile.data?.validUntil
        ? new Date(Date.parse(profile.data.validUntil + 'T00:00:00Z') + 16 * 60 * 60 * 1000).toISOString() : null }];
    for (const fact of facts.items as MemoryFact[]) {
      dependencies.push({ kind: 'fact', id: fact.id, version: fact.version, validUntil: fact.validUntil });
      if (fact.source.kind === 'care_record') dependencies.push({ kind: 'care', id: fact.source.recordId, version: fact.source.version, validUntil: null });
    }
    for (const topic of topics.items) dependencies.push({ kind: 'topic', id: topic.id, version: topic.version, validUntil: null });
    return { dependencies: [...new Map(dependencies.map(item => [item.kind + ':' + item.id, item])).values()],
      sourceCoverageComplete: !facts.nextAfterId && !topics.nextAfterId };
  }
  async function repairInput(binding: Binding, id: string) {
    const row = await binding.transaction.get(data.ref('conversation_summaries', 'conversation-summary', id));
    if (!row.exists || row.get('currentBatch') !== true) return null;
    const saved = open(binding, 'conversation-summary', id, savedSummarySchema, row);
    if (!saved.batch?.sourceCoverageComplete || await batchValid(binding, saved) || saved.batch.authorizationVersion !== binding.authorizationVersion) return null;
    const sources: unknown[] = [], dependencies: z.infer<typeof summaryDependencySchema>[] = [];
    for (const old of saved.batch.dependencies) {
      let value: { version: number; validUntil?: string | null } | null;
      if (old.kind === 'profile') {
        const profile = await options.care.readProfile(binding);
        value = { ...profile, validUntil: profile.data?.validUntil
          ? new Date(Date.parse(profile.data.validUntil + 'T00:00:00Z') + 16 * 60 * 60 * 1000).toISOString() : null };
      } else if (old.kind === 'fact') {
        const fact = await read(binding, 'facts', old.id) as MemoryFact | null;
        value = fact ? await factResult(binding, fact) : null;
        // Permanently removed, inactive or expired claims must not be regenerated from their old chat text.
        if (value && !(value as MemoryFact).applicable) return null;
        const source = (value as MemoryFact | null)?.source;
        if (source?.kind === 'care_record') dependencies.push({ kind: 'care', id: source.recordId, version: source.version, validUntil: null });
      } else if (old.kind === 'topic') value = await read(binding, 'topics', old.id);
      else value = await options.care.readRecord(binding, old.id);
      if (!value || value.validUntil && Date.parse(value.validUntil) <= Date.now()) return null;
      if (value.version !== old.version) sources.push({ kind: old.kind, id: old.id, current: value });
      dependencies.push({ ...old, version: value.version, validUntil: value.validUntil ?? null });
    }
    const messages = [];
    for (const messageId of saved.summary.coveredMessageIds) {
      const message = await options.chat.readMessage(binding, binding.scope.childId, messageId);
      if (!message) return null;
      messages.push(message);
    }
    // Capacity is checked against the actual worker request. A repair is still pending when it does not fit.
    const head = await summaryInput(binding);
    const input: SummaryInput = { previous: null, previousVersion: head.input.previousVersion, basis: head.input.basis,
      messages, moreUncovered: head.input.moreUncovered || head.input.messages.length > 0, summaryMode: 'isolated_batch', repairOf: id, currentSources: sources };
    const unique = [...new Map(dependencies.map(item => [item.kind + ':' + item.id, item])).values()];
    if (unique.length > 64) return null; // Keep the invalidated batch hidden instead of dropping dependency evidence.
    return { input, saved, dependencies: unique, sourceCoverageComplete: true };
  }
  function requirePrivateSummary(binding: Binding) {
    if (binding.sharedAccess || binding.actorUserId !== binding.scope.ownerUserId) domainReject('private_scope_unavailable', 403);
  }
  async function resolvedChat(binding: Binding, messageId: string): Promise<SummaryResolvedSource | null> {
    const message = await options.chat.readMessage(binding, binding.scope.childId, messageId);
    if (!message) return null;
    const row = await binding.transaction.get(data.ref('chat_messages', 'chat-message', messageId));
    const built = makeSummaryChatSource(message, domainParse(z.string().regex(/^[0-9]{19}$/u), row.get('sortKey'), 'chat_binding', 500));
    const { text: _text, childId: _child, authorUserId: _author, ...modelMetadata } = message;
    return { ...built, modelMetadata };
  }
  async function currentDependency(binding: Binding, expected: SummaryDependency): Promise<
    { kind: 'current'; value: { version: number; validUntil?: string | null }; dependency: SummaryDependency }
    | { kind: 'suppressed' | 'source_changed'; reason: 'dependency_suppressed' | 'dependency_expired' | 'source_changed' }> {
    let value: { version: number; validUntil?: string | null } | null;
    if (expected.kind === 'profile') {
      if (expected.id !== binding.scope.childId) return { kind: 'source_changed', reason: 'source_changed' };
      const profile = await options.care.readProfile(binding);
      value = { ...profile, validUntil: profile.data?.validUntil
        ? new Date(Date.parse(profile.data.validUntil + 'T00:00:00Z') + 16 * 60 * 60 * 1000).toISOString() : null };
    } else if (expected.kind === 'fact') {
      const fact = await read(binding, 'facts', expected.id) as MemoryFact | null;
      value = fact ? await factResult(binding, fact) : null;
      if (value && !(value as MemoryFact).applicable) return { kind: 'suppressed', reason: 'dependency_suppressed' };
    } else if (expected.kind === 'topic') value = await read(binding, 'topics', expected.id);
    else value = await options.care.readRecord(binding, expected.id);
    if (!value) return { kind: 'suppressed', reason: 'dependency_suppressed' };
    if (value.validUntil && Date.parse(value.validUntil) <= Date.now()) return { kind: 'suppressed', reason: 'dependency_expired' };
    return { kind: 'current', value, dependency: { ...expected, version: value.version, validUntil: value.validUntil ?? null } };
  }
  /** Bounded structural proof for a complete current batch, independent of the pending revision's old graph. */
  async function coveredBatch(binding: Binding, row: DocumentSnapshot, head: Awaited<ReturnType<typeof summaryInput>>): Promise<SavedSummary | null> {
    if (!row.exists || row.get('currentBatch') !== true) return null;
    const saved = open(binding, 'conversation-summary', row.get('entityId'), savedSummarySchema, row), summary = saved.summary;
    if (!saved.batch || summary.coverageScope || summary.previousId !== null || summary.childId !== binding.scope.childId
      || summary.id !== row.get('entityId') || summary.version !== row.get('entityVersion')
      || row.ref.path !== data.ref('conversation_summaries', 'conversation-summary', summary.id).path
      || saved.batch.lastMessageSortKey !== row.get('lastMessageSortKey')
      || !head.saved || head.saved.lastSortKey < saved.batch.lastMessageSortKey || saved.lastSortKey < saved.batch.lastMessageSortKey
      || summary.lastCoveredMessageId !== summary.coveredMessageIds.at(-1)
      || new Set(summary.coveredMessageIds).size !== summary.coveredMessageIds.length) return null;
    const peers = await binding.transaction.get(scoped(binding, 'conversation_summaries').where('currentBatch', '==', true)
      .where('lastMessageSortKey', '==', saved.batch.lastMessageSortKey).limit(2));
    if (peers.size !== 1 || peers.docs[0].ref.path !== row.ref.path) return null;
    let first: string | null = null, last: string | null = null;
    for (const id of summary.coveredMessageIds) {
      const message = await resolvedChat(binding, id);
      if (!message || message.source.kind !== 'chat_text' || last !== null && message.source.sortKey <= last) return null;
      first ??= message.source.sortKey;
      last = message.source.sortKey;
    }
    if (first === null || last !== saved.batch.lastMessageSortKey) return null;
    // Use the existing full-summary bound (50 plus one overflow row), not a new scan policy.
    const complete = await binding.transaction.get(scoped(binding, 'chat_messages').where('sortKey', '>=', first)
      .where('sortKey', '<=', last).orderBy('sortKey', 'asc').limit(51));
    if (complete.size !== summary.coveredMessageIds.length || complete.docs.some((row, index) =>
      row.get('messageId') !== summary.coveredMessageIds[index]
      || row.ref.path !== data.ref('chat_messages', 'chat-message', summary.coveredMessageIds[index]).path)) return null;
    return saved;
  }
  async function authoritativeCoverage(binding: Binding, manifest: PrivateSummarySourceRevision['manifest'], head: Awaited<ReturnType<typeof summaryInput>>):
    Promise<Exclude<SummarySourceDecision, { kind: 'eligible' | 'no_work' }> | null> {
    const blocked = { kind: 'blocked' as const, reason: 'coverage_unverifiable' as const };
    if (manifest.kind === 'fresh_message') {
      const unit = manifest.units[0];
      if (unit.kind !== 'chat_text') return blocked;
      const actual = await resolvedChat(binding, unit.messageId);
      if (!actual) return { kind: 'suppressed', reason: 'source_missing' };
      if (actual.source.kind !== 'chat_text' || actual.source.sortKey !== unit.sortKey) return blocked;
      const watermark = head.saved && (head.saved.batch || head.usable) ? head.saved.lastSortKey : null;
      if (watermark === null || unit.sortKey > watermark) return null;
      // Locate one candidate, then separately prove endpoint uniqueness and exact bounded membership.
      const rows = await binding.transaction.get(scoped(binding, 'conversation_summaries').where('currentBatch', '==', true)
        .where('lastMessageSortKey', '>=', unit.sortKey).orderBy('lastMessageSortKey', 'asc').limit(1));
      if (rows.size !== 1) return blocked;
      const candidate = await coveredBatch(binding, rows.docs[0], head);
      if (!candidate || !candidate.summary.coveredMessageIds.includes(unit.messageId) || !await batchValid(binding, candidate)) return blocked;
      return { kind: 'already_covered', proof: { kind: 'fresh_watermark', coveredMessageIds: manifest.coveredMessageIds,
        headVersion: head.input.previousVersion, lastCoveredSortKey: watermark, replacementSummaryId: candidate.summary.id } };
    }
    const row = await binding.transaction.get(data.ref('conversation_summaries', 'conversation-summary', manifest.repairOf));
    if (!row.exists) return { kind: 'suppressed', reason: 'source_missing' };
    const original = open(binding, 'conversation-summary', manifest.repairOf, savedSummarySchema, row);
    if (!original.batch || original.summary.coverageScope || original.summary.id !== manifest.repairOf
      || original.summary.childId !== binding.scope.childId || row.get('lastMessageSortKey') !== original.batch.lastMessageSortKey
      || row.get('entityVersion') !== original.summary.version
      || JSON.stringify(original.summary.coveredMessageIds) !== JSON.stringify(manifest.coveredMessageIds)) return blocked;
    if (original.batch.authorizationVersion !== binding.authorizationVersion) return { kind: 'blocked', reason: 'source_authority_changed' };
    if (row.get('currentBatch') !== true) {
      const proof = await replacementProof(binding, original);
      return proof ? { kind: 'already_covered', proof } : blocked;
    }
    const candidate = await coveredBatch(binding, row, head);
    if (!candidate) return blocked;
    if (!await batchValid(binding, candidate)) return null; // A real invalid whole batch is the repair source, not completion.
    return { kind: 'already_covered', proof: { kind: 'repair_replacement', coveredMessageIds: manifest.coveredMessageIds,
      headVersion: head.input.previousVersion, lastCoveredSortKey: head.saved?.lastSortKey ?? null, replacementSummaryId: candidate.summary.id } };
  }
  async function replacementProof(binding: Binding, original: SavedSummary): Promise<SummaryCoverageProof | null> {
    if (!original.batch) return null;
    const rows = await binding.transaction.get(scoped(binding, 'conversation_summaries').where('currentBatch', '==', true)
      .where('lastMessageSortKey', '==', original.batch.lastMessageSortKey).limit(2));
    if (rows.size !== 1) return null;
    const head = await summaryInput(binding), replacement = await coveredBatch(binding, rows.docs[0], head);
    if (!replacement || JSON.stringify(replacement.summary.coveredMessageIds) !== JSON.stringify(original.summary.coveredMessageIds)
      || !await batchValid(binding, replacement)) return null;
    return { kind: 'repair_replacement', coveredMessageIds: original.summary.coveredMessageIds,
      headVersion: head.input.previousVersion, lastCoveredSortKey: head.saved?.lastSortKey ?? null,
      replacementSummaryId: replacement.summary.id };
  }
  async function selectSource(binding: Binding, rawTarget: Parameters<SummarySourceReader['selectSource']>[1]): Promise<SummarySourceDecision> {
    requirePrivateSummary(binding);
    const target = domainParse(z.discriminatedUnion('kind', [z.object({ kind: z.literal('next_fresh') }).strict(),
      z.object({ kind: z.literal('repair_batch'), summaryId: uuid }).strict()]), rawTarget);
    const head = await summaryInput(binding);
    if (target.kind === 'next_fresh') {
      const first = head.input.messages[0]; if (!first) return { kind: 'no_work' };
      const resolved = await resolvedChat(binding, first.id); if (!resolved) return { kind: 'suppressed', reason: 'source_missing' };
      const sourceRow = await binding.transaction.get(data.ref('chat_messages', 'chat-message', first.id));
      const observation = { target: { kind: 'fresh_message' as const, messageId: first.id },
        sourceVersion: sourceRow.get('recordVersion') as number, sourceBasis: head.current.basis };
      const sourceState = await summaryDependencies(binding);
      for (const dependency of sourceState.dependencies) {
        const current = await currentDependency(binding, dependency);
        if (current.kind !== 'current') return current.kind === 'suppressed' ? { ...current, observation } : current;
      }
      const manifest = summaryManifestSchema.parse({ format: 'private-summary-manifest/v1', kind: 'fresh_message', mode: 'private',
        coveredMessageIds: [first.id], repairOf: null, appendAfterSortKey: head.saved && (head.saved.batch || head.usable) ? head.saved.lastSortKey : null,
        sourceBasis: head.current.basis, sourceCoverageComplete: sourceState.sourceCoverageComplete,
        dependencies: sourceState.dependencies, units: [resolved.source] });
      return { kind: 'eligible', manifest, resolvedSources: [resolved] };
    }
    const row = await binding.transaction.get(data.ref('conversation_summaries', 'conversation-summary', target.summaryId));
    if (!row.exists) return { kind: 'suppressed', reason: 'source_missing' };
    const saved = open(binding, 'conversation-summary', target.summaryId, savedSummarySchema, row);
    if (!saved.batch || saved.summary.coverageScope || saved.summary.id !== target.summaryId
      || saved.summary.childId !== binding.scope.childId || row.get('lastMessageSortKey') !== saved.batch.lastMessageSortKey
      || saved.summary.version !== row.get('recordVersion') || saved.summary.version !== row.get('entityVersion')
      || saved.summary.id !== row.get('entityId') || row.ref.path !== data.ref('conversation_summaries', 'conversation-summary', target.summaryId).path)
      return { kind: 'blocked', reason: 'coverage_unverifiable' };
    if (saved.batch.authorizationVersion !== binding.authorizationVersion) return { kind: 'blocked', reason: 'source_authority_changed' };
    if (row.get('currentBatch') !== true) {
      const proof = await replacementProof(binding, saved);
      return proof ? { kind: 'already_covered', proof } : { kind: 'blocked', reason: 'coverage_unverifiable' };
    }
    if (await batchValid(binding, saved)) return { kind: 'no_work' };
    if (!saved.batch.sourceCoverageComplete) return { kind: 'blocked', reason: 'incomplete_dependencies' };
    const observation = { target: { kind: 'repair_batch' as const, summaryId: target.summaryId },
      sourceVersion: saved.summary.version, sourceBasis: head.current.basis };
    const dependencies: SummaryDependency[] = [], corrections: SummaryResolvedSource[] = [];
    for (const old of saved.batch.dependencies) {
      const current = await currentDependency(binding, old);
      if (current.kind !== 'current') return current.kind === 'suppressed' ? { ...current, observation } : current;
      if (old.kind === 'fact') {
        const source = (current.value as MemoryFact).source;
        if (source.kind === 'care_record') dependencies.push({ kind: 'care', id: source.recordId, version: source.version, validUntil: null });
      }
      dependencies.push(current.dependency);
      if (current.value.version !== old.version) corrections.push({ ...makeSummaryCorrectionSource(current.dependency, current.value),
        modelMetadata: { kind: old.kind, id: old.id, version: current.value.version } });
    }
    const unique = [...new Map(dependencies.map(item => [item.kind + ':' + item.id, item])).values()];
    if (!summaryBatchSchema.shape.dependencies.safeParse(unique).success) return { kind: 'blocked', reason: 'incomplete_dependencies' };
    const resolvedSources: SummaryResolvedSource[] = [];
    for (const messageId of saved.summary.coveredMessageIds) {
      const resolved = await resolvedChat(binding, messageId); if (!resolved) return { kind: 'suppressed', reason: 'source_missing', observation };
      resolvedSources.push(resolved);
    }
    resolvedSources.push(...corrections);
    const manifest = summaryManifestSchema.parse({ format: 'private-summary-manifest/v1', kind: 'repair_batch', mode: 'private',
      coveredMessageIds: saved.summary.coveredMessageIds, repairOf: target.summaryId, appendAfterSortKey: head.saved?.lastSortKey ?? null,
      sourceBasis: head.current.basis, sourceCoverageComplete: true, dependencies: unique, units: resolvedSources.map(item => item.source) });
    return { kind: 'eligible', manifest, resolvedSources };
  }
  async function readFastSource(binding: Binding, rawTarget: SummaryFastTarget): Promise<SummaryFastSource> {
    requirePrivateSummary(binding);
    const target = domainParse(z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('fresh_prefix'), firstMessageId: uuid,
        messageCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict(),
      z.object({ kind: z.literal('repair_batch'), summaryId: uuid }).strict(),
    ]), rawTarget);
    if (target.kind === 'repair_batch') {
      const source = await selectSource(binding, target);
      if (source.kind !== 'eligible') return source;
      const repair = await repairInput(binding, target.summaryId);
      if (!repair || firestoreDomainHash(repair.input.messages.map(message => message.id)) !== firestoreDomainHash(source.manifest.coveredMessageIds))
        return { kind: 'blocked', reason: 'repair_unavailable' };
      return { kind: 'eligible', input: repair.input,
        sourceHash: firestoreDomainHash(['private-summary-fast/v1', binding.scope, repair.input, source.manifest]),
        lineageKeys: [summaryLineageKeyForTarget(binding.scope, { kind: 'repair_batch', repairOf: target.summaryId })] };
    }
    const head = await summaryInput(binding);
    if (head.input.messages[0]?.id !== target.firstMessageId || target.messageCount > head.input.messages.length)
      return { kind: 'source_changed', reason: 'source_changed' };
    const source = await selectSource(binding, { kind: 'next_fresh' });
    if (source.kind !== 'eligible') return source;
    const messages = head.input.messages.slice(0, target.messageCount);
    // Reuse the existing full-message coverage bound, not a new fast-path policy limit.
    domainParse(summarySaveSchema.shape.coveredMessageIds, messages.map(message => message.id));
    const units = [];
    for (const message of messages) {
      const resolved = await resolvedChat(binding, message.id);
      if (!resolved) return { kind: 'suppressed', reason: 'source_missing' };
      units.push(resolved.source);
    }
    const input: SummaryInput = { ...head.input, messages,
      moreUncovered: head.input.moreUncovered || target.messageCount < head.input.messages.length };
    return { kind: 'eligible', input,
      sourceHash: firestoreDomainHash(['private-summary-fast/v1', binding.scope, input, source.manifest, units]),
      lineageKeys: messages.map(message => summaryLineageKeyForTarget(binding.scope, { kind: 'fresh_message', messageId: message.id })) };
  }
  async function revalidateSource(binding: Binding, rawRevision: PrivateSummarySourceRevision): Promise<Exclude<SummarySourceDecision, { kind: 'no_work' }>> {
    requirePrivateSummary(binding);
    const revision = domainParse(summarySourceRevisionSchema, rawRevision), manifest = revision.manifest;
    if (firestoreDomainHash(revision.scope) !== firestoreDomainHash(binding.scope)
      || revision.authorizationVersion !== binding.authorizationVersion || revision.workerGeneration !== binding.generation)
      return { kind: 'blocked', reason: 'source_authority_changed' };
    const head = await summaryInput(binding), covered = await authoritativeCoverage(binding, manifest, head);
    if (covered) return covered;
    if (!manifest.sourceCoverageComplete && manifest.sourceBasis !== head.current.basis)
      return { kind: 'blocked', reason: 'incomplete_dependencies_changed' };
    const current = new Map<string, Awaited<ReturnType<typeof currentDependency>> & { kind: 'current' }>();
    for (const dependency of manifest.dependencies) {
      const source = await currentDependency(binding, dependency); if (source.kind !== 'current') return source;
      if (firestoreDomainHash(source.dependency) !== firestoreDomainHash(dependency)) return { kind: 'source_changed', reason: 'dependency_changed' };
      current.set(dependency.kind + ':' + dependency.id, source);
    }
    const resolvedSources: SummaryResolvedSource[] = [];
    for (const unit of manifest.units) {
      let resolved: SummaryResolvedSource | null;
      if (unit.kind === 'chat_text') resolved = await resolvedChat(binding, unit.messageId);
      else {
        const source = current.get(unit.dependency.kind + ':' + unit.dependency.id);
        if (!source) return { kind: 'blocked', reason: 'incomplete_dependencies' };
        resolved = { ...makeSummaryCorrectionSource(source.dependency, source.value),
          modelMetadata: { kind: unit.dependency.kind, id: unit.dependency.id, version: source.value.version } };
      }
      if (!resolved) return { kind: 'suppressed', reason: 'source_missing' };
      if (firestoreDomainHash(resolved.source) !== firestoreDomainHash(unit)) return { kind: 'source_changed', reason: 'source_changed' };
      resolvedSources.push(resolved);
    }
    if (manifest.kind === 'fresh_message') {
      const source = manifest.units[0]; if (source.kind !== 'chat_text') return { kind: 'blocked', reason: 'coverage_unverifiable' };
      const watermark = head.saved && (head.saved.batch || head.usable) ? head.saved.lastSortKey : null;
      if (watermark !== manifest.appendAfterSortKey || head.input.messages[0]?.id !== source.messageId)
        return { kind: 'blocked', reason: 'coverage_unverifiable' };
    } else {
      const row = await binding.transaction.get(data.ref('conversation_summaries', 'conversation-summary', manifest.repairOf));
      if (!row.exists) return { kind: 'suppressed', reason: 'source_missing' };
      const saved = open(binding, 'conversation-summary', manifest.repairOf, savedSummarySchema, row);
      if (!saved.batch || saved.summary.coverageScope || saved.summary.id !== manifest.repairOf
        || saved.summary.childId !== binding.scope.childId || row.get('lastMessageSortKey') !== saved.batch.lastMessageSortKey
        || JSON.stringify(saved.summary.coveredMessageIds) !== JSON.stringify(manifest.coveredMessageIds))
        return { kind: 'blocked', reason: 'coverage_unverifiable' };
      if (saved.batch.authorizationVersion !== binding.authorizationVersion)
        return { kind: 'blocked', reason: 'source_authority_changed' };
      if (row.get('currentBatch') !== true) {
        const proof = await replacementProof(binding, saved);
        return proof ? { kind: 'already_covered', proof } : { kind: 'blocked', reason: 'coverage_unverifiable' };
      }
    }
    return { kind: 'eligible', manifest, resolvedSources };
  }
  async function rebuildSummarySource(binding: Binding, rawRevision: PrivateSummarySourceRevision): Promise<Exclude<SummarySourceDecision, { kind: 'no_work' }>> {
    requirePrivateSummary(binding);
    const revision = domainParse(summarySourceRevisionSchema, rawRevision), original = revision.manifest;
    const old = await revalidateSource(binding, revision);
    if (old.kind !== 'source_changed') return old;
    const head = await summaryInput(binding);
    type Current = Extract<Awaited<ReturnType<typeof currentDependency>>, { kind: 'current' }>;
    const graph = new Map<string, Current>(), corrections = new Set<string>();
    const keyOf = (value: SummaryDependency) => value.kind + ':' + value.id;
    const oldGraph = new Map(original.dependencies.map(value => [keyOf(value), value]));
    const priorCorrections = new Set(original.units.flatMap(unit => unit.kind === 'correction_json' ? [keyOf(unit.dependency)] : []));
    const add = (value: Current, correction: boolean) => {
      const key = keyOf(value.dependency), prior = graph.get(key);
      if (prior && firestoreDomainHash(prior.dependency) !== firestoreDomainHash(value.dependency)) return false;
      graph.set(key, value); if (correction || priorCorrections.has(key)) corrections.add(key); return true;
    };
    for (const declared of original.dependencies) {
      const current = await currentDependency(binding, declared); if (current.kind !== 'current') return current;
      const changed = firestoreDomainHash(current.dependency) !== firestoreDomainHash(declared);
      if (!add(current, changed)) return { kind: 'blocked', reason: 'incomplete_dependencies' };
      if (declared.kind === 'fact') {
        const source = (current.value as MemoryFact).source;
        if (source.kind === 'care_record') {
          const dependency: SummaryDependency = { kind: 'care', id: source.recordId, version: source.version, validUntil: null };
          const care = await currentDependency(binding, dependency); if (care.kind !== 'current') return care;
          if (care.dependency.version !== dependency.version || !add(care, !oldGraph.has(keyOf(dependency))))
            return { kind: 'blocked', reason: 'incomplete_dependencies' };
        }
      }
    }
    const dependencies = [...graph.values()].map(value => value.dependency);
    if (!summaryBatchSchema.shape.dependencies.safeParse(dependencies).success) return { kind: 'blocked', reason: 'incomplete_dependencies' };
    const resolvedSources: SummaryResolvedSource[] = [];
    for (const messageId of original.coveredMessageIds) {
      const resolved = await resolvedChat(binding, messageId); if (!resolved) return { kind: 'suppressed', reason: 'source_missing' };
      resolvedSources.push(resolved);
    }
    if (original.kind === 'fresh_message') {
      const watermark = head.saved && (head.saved.batch || head.usable) ? head.saved.lastSortKey : null;
      if (watermark !== original.appendAfterSortKey || head.input.messages[0]?.id !== original.coveredMessageIds[0])
        return { kind: 'blocked', reason: 'coverage_unverifiable' };
    }
    for (const [key, current] of graph) if (corrections.has(key)) resolvedSources.push({
      ...makeSummaryCorrectionSource(current.dependency, current.value),
      modelMetadata: { kind: current.dependency.kind, id: current.dependency.id, version: current.value.version } });
    const units = resolvedSources.map(value => value.source);
    // Incidental head/global-basis movement is not a source revision.
    if (firestoreDomainHash(units) === firestoreDomainHash(original.units)
      && firestoreDomainHash(dependencies) === firestoreDomainHash(original.dependencies)) return { kind: 'eligible', manifest: original, resolvedSources };
    const manifest = summaryManifestSchema.parse({ ...original, sourceBasis: head.current.basis, dependencies, units });
    return { kind: 'eligible', manifest, resolvedSources };
  }
  /** Store-only serializer for a completed immutable source. The work coordinator proves the terminal chain. */
  async function prepareCompletedWorkWrite(binding: Binding, input: { revision: PrivateSummarySourceRevision; text: string }, operationId: string): Promise<PreparedCompletedSummary> {
    requirePrivateSummary(binding);
    const revision = domainParse(summarySourceRevisionSchema, input.revision), text = domainParse(summarySaveSchema.shape.text, input.text);
    const row = await binding.transaction.get(data.ref('private_summary_revisions', 'private-summary-revision', revision.id));
    if (!row.exists) domainReject('private_summary_source_missing');
    const persisted = open(binding, 'private-summary-revision', revision.id, summarySourceRevisionSchema, row);
    if (firestoreDomainHash(persisted) !== firestoreDomainHash(revision)) domainReject('private_summary_source_binding');
    const source = await revalidateSource(binding, persisted);
    if (source.kind !== 'eligible') return source;
    const manifest = persisted.manifest, id = summaryId(binding);
    const headRow = await binding.transaction.get(data.ref('conversation_summary_heads', 'conversation-summary-head', id));
    const head = headRow.exists ? open(binding, 'conversation-summary-head', id, savedSummarySchema, headRow) : null;
    if (head?.summary.coverageScope) domainReject('summary_binding', 500);
    const lastUnit = manifest.units[manifest.coveredMessageIds.length - 1];
    if (lastUnit.kind !== 'chat_text') domainReject('private_summary_source_binding');
    const lastMessageSortKey = lastUnit.sortKey;
    if (manifest.kind === 'repair_batch') {
      if (!head || head.lastSortKey < lastMessageSortKey) return { kind: 'blocked', reason: 'coverage_unverifiable' };
      const originalRow = await binding.transaction.get(data.ref('conversation_summaries', 'conversation-summary', manifest.repairOf));
      const original = open(binding, 'conversation-summary', manifest.repairOf, savedSummarySchema, originalRow);
      if (!original.batch || original.batch.lastMessageSortKey !== lastMessageSortKey) return { kind: 'blocked', reason: 'coverage_unverifiable' };
    }
    const value: ConversationSummary = { id: randomUUID(), childId: binding.scope.childId, version: (head?.summary.version ?? 0) + 1,
      text, createdAt: new Date().toISOString(), previousId: null, coveredMessageIds: manifest.coveredMessageIds,
      lastCoveredMessageId: manifest.coveredMessageIds.at(-1)! };
    const messages = source.resolvedSources.flatMap(unit => unit.source.kind === 'chat_text'
      ? [domainParse(z.object({ createdAt: time }), unit.modelMetadata, 'private_summary_source_binding')] : []);
    const corrections = source.resolvedSources.flatMap(unit => unit.source.kind === 'correction_json'
      ? [{ kind: unit.source.dependency.kind, current: JSON.parse(unit.sourceText) }] : []);
    const period = summarySourcePeriod(messages, corrections);
    if (period) value.sourcePeriod = period;
    const dependencies = manifest.dependencies;
    const expiry = summaryExpiry(dependencies.map(item => item.validUntil));
    if (Number.isNaN(expiry)) domainReject('summary_validity_unknown');
    const saved: SavedSummary = { summary: value, basis: manifest.sourceBasis,
      validUntil: expiry === Infinity ? null : new Date(expiry).toISOString(),
      lastSortKey: manifest.kind === 'repair_batch' ? head!.lastSortKey : lastMessageSortKey,
      batch: { dependencies, sourceCoverageComplete: manifest.sourceCoverageComplete, authorizationVersion: persisted.authorizationVersion,
        lastMessageSortKey, replaces: manifest.repairOf } };
    return { kind: 'prepared', ...await prepareSavedSummaryWrite(binding, saved, operationId) };
  }
  async function prepareSavedSummaryWrite(binding: Binding, saved: SavedSummary, operationId: string): Promise<Prepared<ConversationSummary>> {
    const value = saved.summary, batch = saved.batch;
    if (!batch) domainReject('summary_binding', 500);
    const change = await binding.prepareChange(operationId, 'memory', false), id = summaryId(binding);
    const headEnvelope = { ...data.tags(binding.scope), ...data.seal('conversation-summary-head', id, binding.scope, savedSummarySchema, saved, value.version) };
    const revision = { ...data.tags(binding.scope), entityId: value.id, entityVersion: value.version, currentBatch: true, lastMessageSortKey: batch.lastMessageSortKey,
      ...data.seal('conversation-summary', value.id, binding.scope, savedSummarySchema, saved, value.version) };
    return { value, changeSeq: change.changeSeq, commit() {
      change.commit(); binding.transaction.set(data.ref('conversation_summary_heads', 'conversation-summary-head', id), headEnvelope);
      binding.transaction.create(data.ref('conversation_summaries', 'conversation-summary', value.id), revision);
      if (batch.replaces) binding.transaction.update(data.ref('conversation_summaries', 'conversation-summary', batch.replaces), { currentBatch: false });
    } };
  }
  async function prepareSummaryWrite(binding: Binding, raw: unknown, operationId: string): Promise<Prepared<ConversationSummary>> {
    const input = domainParse(summarySaveSchema, raw), head = await summaryInput(binding);
    const repair = input.repairOf ? await repairInput(binding, input.repairOf) : null;
    if (input.repairOf && !repair) domainReject('summary_coverage_changed');
    const expected = repair ? { ...head, input: repair.input } : head;
    if (input.previousVersion !== expected.input.previousVersion || input.basis !== expected.input.basis ||
      JSON.stringify(input.coveredMessageIds) !== JSON.stringify(expected.input.messages.slice(0, input.coveredMessageIds.length).map(value => value.id)))
      domainReject('summary_coverage_changed');
    const value: ConversationSummary = { id: randomUUID(), childId: binding.scope.childId, version: expected.input.previousVersion + 1,
      text: input.text, createdAt: new Date().toISOString(), previousId: null,
      coveredMessageIds: input.coveredMessageIds, lastCoveredMessageId: input.coveredMessageIds.at(-1)! };
    if (repair && input.coveredMessageIds.length !== repair.input.messages.length) domainReject('summary_coverage_changed');
    const period = summarySourcePeriod(expected.input.messages.slice(0, input.coveredMessageIds.length), expected.input.currentSources);
    if (period) value.sourcePeriod = period;
    const lastMessageSortKey = repair?.saved.batch!.lastMessageSortKey ?? expected.rows.docs[input.coveredMessageIds.length - 1].get('sortKey');
    const lastSortKey = repair ? head.saved!.lastSortKey : lastMessageSortKey;
    const sourceState = repair ?? await summaryDependencies(binding), dependencies = sourceState.dependencies;
    const expiry = summaryExpiry(dependencies.map(item => item.validUntil));
    if (Number.isNaN(expiry)) domainReject('summary_validity_unknown');
    const saved: SavedSummary = { summary: value, basis: input.basis, validUntil: expiry === Infinity ? null : new Date(expiry).toISOString(), lastSortKey,
      batch: { dependencies, sourceCoverageComplete: sourceState.sourceCoverageComplete, authorizationVersion: binding.authorizationVersion, lastMessageSortKey, replaces: input.repairOf ?? null } };
    const prepared = await prepareSavedSummaryWrite(binding, saved, operationId);
    const progress = await preparePrivateSummaryScanProgress(data, binding, input.repairOf ? 'repair' : 'fresh');
    return { ...prepared, commit() { prepared.commit(); progress(); } };
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
      const childId = domainParse(uuid, match[1].toLowerCase()), kind = match[2] as Kind, action = match[4] ?? match[5];
      if (action === 'confirmed' && kind !== 'facts') domainReject('invalid_input', 400);
      if (!await root.readChild(childId)) domainReject('not_found', 404);
      const binding: Binding = { ...root, scope: { ...root.scope, childId },
        prepareChange: (op, type, deleted) => root.prepareChange(op, type, deleted, childId) };
      const prepared = await prepare(binding, kind, action, match[3]?.toLowerCase(), submission.payload, submission.operation.opId);
      return { childId, changeSeq: prepared.changeSeq, statusCode: !match[3] || action === 'reopen' ? 201 : 200,
        result: { [action === 'delete' ? 'deleted' : singular(kind)]: prepared.value }, commit: prepared.commit };
    },
  };
  async function recall(binding: Binding, keys: string[]) {
    domainParse(z.array(z.string().min(1).max(100)).min(1).max(4), keys);
    const facts: MemoryFact[] = [], topics: MemoryTopic[] = [], missingKeys: string[] = [];
    for (const raw of new Set(keys.map(normalizedFactKey))) {
      let found = false;
      for (const kind of ['facts', 'topics'] as const) for (const visibility of binding.sharedAccess ? ['family'] as const : ['private', 'family'] as const) {
        const key = JSON.stringify([binding.scope.ownerUserId, binding.scope.childId, kind, visibility, raw]);
        const row = await binding.transaction.get(data.ref('memory_keys', 'memory-key', key));
        if (!row.exists) continue;
        const id = open(binding, 'memory-key', key, keySchema, row).id;
        const value = await read(binding, kind, id); if (!value) continue;
        if (value.visibility !== visibility || normalizedFactKey(kind === 'facts' ? (value as MemoryFact).key : (value as MemoryTopic).title) !== raw) domainReject('memory_key_binding', 500);
        found = true;
        if (kind === 'facts') facts.push(await factResult(binding, value as MemoryFact)); else topics.push(topicResult(value as MemoryTopic));
      }
      if (!found) missingKeys.push(raw);
    }
    return { facts, topics, missingKeys };
  }
  async function revisionResult(binding: Binding, kind: Kind, id: string, row: DocumentSnapshot) {
    const revisionId = JSON.stringify([id, row.get('entityVersion')]);
    const value = kind === 'facts' ? open(binding, 'memory-fact-revision', revisionId, firestoreFactStorageSchema, row)
      : open(binding, 'memory-topic-revision', revisionId, firestoreTopicStorageSchema, row);
    if (value.id !== id || value.childId !== binding.scope.childId || value.version !== row.get('recordVersion')
      || value.version !== row.get('entityVersion')) domainReject('memory_binding', 500);
    if (kind === 'facts' ? !validMemoryFactAttribution(value as z.infer<typeof firestoreFactStorageSchema>, binding.scope)
      : !validSharedAttribution((value as z.infer<typeof firestoreTopicStorageSchema>).changedViaShare, binding.scope, id, value.version, (value as MemoryTopic).updatedBy)) domainReject('memory_binding', 500);
    if (binding.sharedAccess && value.visibility !== 'family') return null;
    return kind === 'facts' ? factResult(binding, value as MemoryFact) : topicResult(value as MemoryTopic);
  }
  async function history(binding: Binding, kind: Kind, id: string, before: number) {
    if (!await read(binding, kind, id)) return null;
    let query = scoped(binding, 'memory_' + singular(kind) + '_revisions').where('entityId', '==', id).where('entityVersion', '<', before);
    if (binding.sharedAccess) query = query.where('visibility', '==', 'family');
    const rows = await binding.transaction.get(query.orderBy('entityVersion', 'desc').limit(51));
    const revisions: (MemoryFact | MemoryTopic)[] = [];
    for (const row of rows.docs.slice(0, 50)) {
      const revision = await revisionResult(binding, kind, id, row);
      if (!revision) domainReject('memory_binding', 500);
      revisions.push(revision);
    }
    return { revisions, nextBeforeVersion: rows.size > 50 ? rows.docs[49].get('entityVersion') as number : null };
  }
  async function importedSummaryRecord(binding: Binding, id: string) {
    domainParse(uuid, id);
    if (binding.sharedAccess || binding.actorUserId !== binding.scope.ownerUserId) domainReject('private_scope_unavailable', 403);
    const ref = data.ref('conversation_summaries', 'conversation-summary', id);
    const row = await binding.transaction.get(ref);
    if (!row.exists) return null;
    const saved = open(binding, 'conversation-summary', id, savedSummarySchema, row);
    if (saved.summary.id !== id || saved.summary.childId !== binding.scope.childId || saved.summary.version !== row.get('recordVersion')
      || saved.summary.coverageScope !== 'imported_source' || saved.batch || row.get('currentBatch') === true) domainReject('summary_binding', 500);
    return { ref, saved, row };
  }
  const store: FirestoreMemoryStore = {
    async readFreshMaintenance(binding) {
      requirePrivateSummary(binding);
      const state = await summaryInput(binding), selected = selectSummaryBatchMessages(state.input.messages);
      return selected.messages.length ? { ...state.input, previous: null, messages: selected.messages,
        moreUncovered: state.input.moreUncovered || selected.moreUncovered } : null;
    },
    forSharedSpace(spaceId) {
      domainParse(uuid, spaceId);
      const access = <T>(u: string, c: string, read: (b: Binding) => Promise<T>) =>
        sharing.withResource(u, { spaceId, childId: c, module: 'memory', mode: 'read' }, value => read(value.binding));
      const mutationDenied = async (): Promise<never> => domainReject('sharing_receipt_required', 428);
      const privateDenied = async (): Promise<never> => domainReject('shared_private_scope', 403);
      return { ...store,
        facts: (u, c, after, limit = 50) => access(u, c, async b => {
          const result = await page(b, 'facts', after, limit); return { ...result, items: result.items as MemoryFact[] };
        }),
        getFact: (u, c, id) => access(u, c, b => store.readFact(b, id)),
        topics: (u, c, after) => access(u, c, async b => {
          const result = await page(b, 'topics', after, 50); return { ...result, items: result.items as MemoryTopic[] };
        }),
        history: (u, c, kind, id, before = 2147483647) => access(u, c, b => history(b, kind, id, before)),
        summary: (u, c) => access(u, c, async () => ({ summary: null })),
        reportFacts: (u, c, after) => access(u, c, async b => {
          const result = await page(b, 'facts', after, 20, true, true); return { ...result, items: result.items as MemoryFact[] };
        }),
        recall: (u, c, keys) => access(u, c, b => recall(b, keys)),
        context: privateDenied, prepareSummary: privateDenied, initialConversationSummary: privateDenied, saveSummary: privateDenied,
        createFact: mutationDenied, confirmFact: mutationDenied, reviseFact: mutationDenied, deactivateFact: mutationDenied,
        createTopic: mutationDenied, changeTopic: mutationDenied, reopenTopic: mutationDenied, delete: mutationDenied,
      };
    },
    async readSummaryScanHead(binding) {
      requirePrivateSummary(binding);
      const head = await summaryInput(binding);
      const rows = await binding.transaction.get(scoped(binding, 'conversation_summaries').where('currentBatch', '==', true)
        .orderBy('lastMessageSortKey', 'desc').orderBy('__name__', 'desc').limit(1));
      let upperSortKey: string | null = null;
      if (rows.docs[0]) {
        const row = rows.docs[0], id = row.get('entityId');
        const saved = open(binding, 'conversation-summary', id, savedSummarySchema, row);
        if (saved.summary.id !== id || saved.summary.childId !== binding.scope.childId || saved.summary.coverageScope || !saved.batch
          || saved.summary.version !== row.get('recordVersion') || row.id !== data.ref('conversation_summaries', 'conversation-summary', id).id
          || row.get('lastMessageSortKey') !== saved.batch.lastMessageSortKey) domainReject('summary_binding', 500);
        upperSortKey = saved.batch.lastMessageSortKey;
      }
      return { basis: head.input.basis, freshCaughtUp: head.input.messages.length === 0 && !head.input.moreUncovered, upperSortKey };
    },
    async readSummaryScanPage(binding, input) {
      requirePrivateSummary(binding);
      domainParse(z.object({ upperSortKey: z.string().regex(/^[0-9]{19}$/u), after: z.object({
        sortKey: z.string().regex(/^[0-9]{19}$/u), id: uuid }).strict().nullable(), limit: z.number().int().min(1).max(4) }).strict(), input);
      let query = scoped(binding, 'conversation_summaries').where('currentBatch', '==', true)
        .where('lastMessageSortKey', '<=', input.upperSortKey).orderBy('lastMessageSortKey', 'desc').orderBy('__name__', 'desc').limit(input.limit);
      if (input.after) query = query.startAfter(input.after.sortKey, data.ref('conversation_summaries', 'conversation-summary', input.after.id).id);
      const rows = await binding.transaction.get(query);
      const items = rows.docs.map(row => {
        const id = row.get('entityId'), saved = open(binding, 'conversation-summary', id, savedSummarySchema, row);
        if (saved.summary.id !== id || saved.summary.childId !== binding.scope.childId || saved.summary.coverageScope || !saved.batch
          || row.id !== data.ref('conversation_summaries', 'conversation-summary', id).id || saved.summary.version !== row.get('recordVersion')
          || row.get('lastMessageSortKey') !== saved.batch.lastMessageSortKey) domainReject('summary_binding', 500);
        return { id: saved.summary.id, sortKey: saved.batch.lastMessageSortKey, version: saved.summary.version };
      });
      return { items, exhausted: rows.size < input.limit };
    },
    mutation, prepareSummaryWrite, prepareCompletedWorkWrite, readSummaryRevision,
    selectSource, revalidateSource, readFastSource,
    rebuildSummarySource,
    async readSummaryLineageTargets(binding, rawTarget) {
      requirePrivateSummary(binding);
      const input = domainParse(z.discriminatedUnion('kind', [z.object({ kind: z.literal('next_fresh') }).strict(),
        z.object({ kind: z.literal('repair_batch'), summaryId: uuid }).strict()]), rawTarget);
      let target: SummaryLineageTarget;
      if (input.kind === 'next_fresh') {
        const first = (await summaryInput(binding)).input.messages[0];
        if (!first) return [];
        target = { kind: 'fresh_message', messageId: first.id };
      } else {
        // A deleted/replaced repair source can still have original work and usage. This private,
        // scoped identity lookup is not source admission; the full reader revalidates afterwards.
        target = { kind: 'repair_batch', repairOf: input.summaryId };
      }
      return [{ target, lineageKey: summaryLineageKeyForTarget(binding.scope, target) }];
    },
    readImportedSummary: async (binding, id) => (await importedSummaryRecord(binding, id))?.saved.summary ?? null,
    prepareImportedSummaryPeriod: async (binding, id, expectedVersion, period) => {
      const entry = await importedSummaryRecord(binding, id);
      if (!entry || entry.saved.summary.version !== expectedVersion || entry.saved.summary.sourcePeriod) domainReject('version_conflict');
      const summary = { ...entry.saved.summary, sourcePeriod: domainParse(summarySourcePeriodSchema, period) };
      const envelope = data.seal('conversation-summary', id, binding.scope, savedSummarySchema, { ...entry.saved, summary }, expectedVersion);
      return () => { binding.transaction.set(entry.ref, { ...entry.row.data(), ...envelope }); };
    },
    prepareImportedSummary: async (binding, operationId, row, integrity, current) => {
      if (binding.sharedAccess || binding.actorUserId !== binding.scope.ownerUserId) domainReject('private_scope_unavailable', 403);
      if (row.section !== 'summary_history') domainReject('invalid_package_data', 400);
      const source = domainParse(summarySchema, row.value, 'invalid_package_data', 400);
      const previous = current ? await store.readImportedSummary(binding, current.id) : null;
      if (current && (!previous || previous.version !== current.expectedVersion)) domainReject('version_conflict');
      const importedFrom = makeImportProvenance(row, integrity, binding.actorUserId, new Date().toISOString());
      const value: ConversationSummary = { ...source, id: randomUUID(), childId: binding.scope.childId,
        version: (previous?.version ?? 0) + 1, previousId: previous?.id ?? null, coverageScope: 'imported_source', importedFrom };
      const ref = data.ref('conversation_summaries', 'conversation-summary', value.id);
      if ((await binding.transaction.get(ref)).exists) domainReject('version_conflict');
      const saved = { summary: value, basis: '0'.repeat(64), validUntil: null, lastSortKey: '0'.repeat(19) };
      const envelope = { ...data.tags(binding.scope), entityId: value.id, entityVersion: value.version, currentBatch: false,
        ...data.seal('conversation-summary', value.id, binding.scope, savedSummarySchema, saved, value.version) };
      const change = await binding.prepareChange(operationId, 'memory', false);
      return { value, changeSeq: change.changeSeq, commit() { change.commit(); binding.transaction.create(ref, envelope); } };
    },
    prepareMaintenance: (u, c) => authority.runTransaction(u, c, async binding => {
      const state = await summaryInput(binding);
      const candidates: SummaryInput[] = [];
      if (state.saved?.batch) {
        const recent = await recentBatches(binding);
        for (const item of recent.batches) if (!item.valid) {
          const repair = await repairInput(binding, item.saved.summary.id); if (repair) candidates.push(repair.input);
        }
      }
      // Bound normal accumulation, then fit the complete request before any model admission.
      const selected = selectSummaryBatchMessages(state.input.messages);
      if (selected.messages.length) candidates.push({ ...state.input, previous: null, messages: selected.messages,
        moreUncovered: state.input.moreUncovered || selected.moreUncovered });
      // The existing four-batch repair window plus one append prefix is a bounded choice,
      // not permission to clear or skip an invalidated batch that cannot fit this request.
      return candidates.length ? { ...candidates[0], alternatives: candidates.slice(1) } : null;
    }),
    recall: (u, c, keys) => authority.runTransaction(u, c, binding => recall(binding, keys)),
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
    readTopic: async (binding, id) => {
      const value = await read(binding, 'topics', id); return value ? topicResult(value as MemoryTopic) : null;
    },
    readExportRevision: async (binding, kind, row) => {
      const id = domainParse(uuid, row.get('entityId'));
      const current = await read(binding, kind, id);
      if (!current || current.version < row.get('recordVersion')) return null;
      return revisionResult(binding, kind, id, row);
    },
    prepareFactChange: async (binding, action, id, raw, operationId) =>
      await prepare(binding, 'facts', action, id, raw, operationId) as Prepared<MemoryFact>,
    readImportState: async (binding, kind, id) => {
      const snapshot = await binding.transaction.get(refFor(kind, domainParse(uuid, id)));
      const value = readRow(binding, kind, id, snapshot);
      if (snapshot.exists && snapshot.get('live') !== false && !value) domainReject('not_found', 404);
      return { value, version: value?.version ?? (snapshot.exists ? open(binding, 'memory-tombstone', id, tombstoneSchema, snapshot).version : 0) };
    },
    prepareOriginalMemory: async (binding, operationId, row, integrity, resolution) => {
      if (row.section !== 'memory_facts' && row.section !== 'memory_topics') domainReject('invalid_package_data', 400);
      const kind = row.section === 'memory_facts' ? 'facts' : 'topics';
      const source = kind === 'facts' ? domainParse(firestoreFactSchema, row.value, 'invalid_package_data', 400)
        : domainParse(firestoreTopicSchema, row.value, 'invalid_package_data', 400);
      if (binding.sharedAccess || binding.actorUserId !== binding.scope.ownerUserId || row.source.accountId !== binding.actorUserId
        || row.childId !== binding.scope.childId || source.childId !== binding.scope.childId) domainReject('invalid_import_target', 403);
      const { mapping } = await readImportMapping(data, binding, { serverId: row.source.serverId, accountId: row.source.accountId,
        childId: row.childId, section: row.section, resourceId: source.id }, true);
      const targetId = mapping?.target.id ?? source.id;
      const snapshot = await binding.transaction.get(refFor(kind, targetId)), prior = readRow(binding, kind, targetId, snapshot);
      if (snapshot.exists && snapshot.get('live') !== false && !prior) domainReject('not_found', 404);
      const currentVersion = prior?.version ?? (snapshot.exists ? open(binding, 'memory-tombstone', targetId, tombstoneSchema, snapshot).version : 0);
      if (resolution.mode === 'preserve' || resolution.targetId !== targetId || resolution.expectedVersion !== currentVersion
        || currentVersion === 0 || (resolution.mode === 'restore_deleted') !== (prior === null)) domainReject('version_conflict');
      const at = new Date().toISOString(), importedFrom = makeImportProvenance(row, integrity, binding.actorUserId, at);
      if (kind === 'facts') {
        const fact = source as z.infer<typeof firestoreFactSchema>, previous = prior as MemoryFact | null;
        if ((fact.confirmedBy === null) !== (fact.confirmedAt === null)
          || fact.status === 'confirmed' && !fact.confirmedBy
          || fact.status === 'candidate' && (fact.visibility !== 'private' || fact.confirmedBy !== null)) domainReject('invalid_package_data', 400);
        // Retain live local evidence. Restoring a backup is not a new confirmation of its assertions.
        const value: MemoryFact = { ...fact, id: previous?.id ?? randomUUID(), version: (previous?.version ?? 0) + 1,
          createdBy: previous?.createdBy ?? binding.actorUserId, importedFrom,
          confirmationBasis: fact.confirmedBy === null ? undefined : 'imported_source', applicable: false };
        return await write(binding, kind, previous, value, operationId, factContentDate(fact)) as Prepared<MemoryFact>;
      }
      const topic = source as MemoryTopic, previous = prior as MemoryTopic | null;
      if (previous && ['answered', 'resolved'].includes(previous.status) && ['pending', 'snoozed'].includes(topic.status)) domainReject('terminal_topic');
      const value: MemoryTopic = { ...topic, id: previous?.id ?? randomUUID(), version: (previous?.version ?? 0) + 1,
        updatedBy: binding.actorUserId, updatedAt: memoryUpdateDate('memory_topics', topic) ?? at, importedFrom, mayAsk: false };
      return await write(binding, kind, previous, value, operationId) as Prepared<MemoryTopic>;
    },
    prepareImportedFact: async (binding, operationId, row, integrity, current) => {
      if (row.section !== 'memory_facts') domainReject('invalid_package_data', 400);
      const source = domainParse(firestoreFactSchema, row.value, 'invalid_package_data', 400);
      const prior = current ? await read(binding, 'facts', current.id) as MemoryFact | null : null;
      if (current && (!prior || prior.version !== current.expectedVersion)) domainReject('version_conflict');
      const importedFrom = makeImportProvenance(row, integrity, binding.actorUserId, new Date().toISOString());
      const shared = !!binding.sharedAccess;
      if (source.status === 'candidate' && (source.visibility !== 'private' || source.confirmedBy !== null || source.confirmedAt !== null)) domainReject('invalid_package_data', 400);
      if ((source.confirmedBy === null) !== (source.confirmedAt === null)) domainReject('invalid_package_data', 400);
      if (shared && (source.visibility !== 'family' || source.status === 'candidate')) domainReject('shared_private_scope', 403);
      if (source.status === 'confirmed' && (!source.confirmedBy || !source.confirmedAt)) domainReject('invalid_package_data', 400);
      const value: MemoryFact = { ...source, id: prior?.id ?? randomUUID(), childId: binding.scope.childId,
        version: (prior?.version ?? 0) + 1, createdBy: prior?.createdBy ?? binding.actorUserId,
        source: { kind: 'imported', description: source.source.description,
          original: source.source.kind === 'imported' ? source.source.original : source.source, sourceState: source.sourceState },
        importedFrom, confirmationBasis: source.confirmedBy === null ? undefined : 'imported_source',
        applicable: false };
      return await write(binding, 'facts', prior, value, operationId, factContentDate(source)) as Prepared<MemoryFact>;
    },
    prepareImportedTopic: async (binding, operationId, row, integrity, current) => {
      if (row.section !== 'memory_topics') domainReject('invalid_package_data', 400);
      const source = domainParse(firestoreTopicSchema, row.value, 'invalid_package_data', 400);
      const prior = current ? await read(binding, 'topics', current.id) as MemoryTopic | null : null;
      if (current && (!prior || prior.version !== current.expectedVersion)) domainReject('version_conflict');
      if (prior && ['answered', 'resolved'].includes(prior.status) && ['pending', 'snoozed'].includes(source.status)) domainReject('terminal_topic');
      const at = new Date().toISOString(), importedFrom = makeImportProvenance(row, integrity, binding.actorUserId, at);
      const value: MemoryTopic = { ...source, id: prior?.id ?? randomUUID(), childId: binding.scope.childId, version: (prior?.version ?? 0) + 1,
        updatedBy: binding.actorUserId, updatedAt: memoryUpdateDate('memory_topics', source) ?? at, importedFrom, reopenedFrom: null, mayAsk: false };
      return await write(binding, 'topics', prior, value, operationId) as Prepared<MemoryTopic>;
    },
    prepareConfirmedFact: async (binding, raw, sharing, operationId) => {
      const input = domainParse(factCreateSchema, raw);
      confirmShared(input.intendedVisibility, sharing); await checkSource(binding, input.values.source);
      const value: MemoryFact = { ...input.values, id: randomUUID(), childId: binding.scope.childId,
        visibility: input.intendedVisibility, intendedVisibility: input.intendedVisibility, status: 'confirmed', version: 1,
        createdBy: binding.actorUserId, confirmedBy: binding.actorUserId, confirmedAt: new Date().toISOString(),
        reason: '使用者核對並確認', applicable: false, sourceState: 'current' };
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
    history: (u, c, kind, id, before = 2147483647) => authority.runTransaction(u, c, binding => history(binding, kind, id, before)),
    summary: (u, c) => authority.runTransaction(u, c, async binding => ({ summary: (await summaryInput(binding)).input.previous })),
    initialConversationSummary: (u, c) => authority.runTransaction(u, c, async binding => {
      const result = await summaryInput(binding);
      if (!result.saved?.batch) {
        if (!result.input.previous) return null;
        const { id, version, text, createdAt, lastCoveredMessageId } = result.input.previous;
        return { summary: { id, version, text, createdAt, lastCoveredMessageId }, basis: result.current.basis, validUntil: result.current.validUntil };
      }
      const recent = await recentBatches(binding), valid = recent.batches.filter(batch => batch.valid).reverse();
      if (!valid.length) return null;
      const head = valid.at(-1)!.saved;
      const selected: SavedSummary[] = [];
      // Whole batches only; contiguous suffix from the head backwards.
      // Older history remains available through authorized search, not a growing prompt.
      for (const item of [...valid].reverse()) {
        const candidate = [item.saved, ...selected];
        const candidateLength = JSON.stringify(candidate.map(value => ({ id: value.summary.id, sourceMessageIds: value.summary.coveredMessageIds, text: value.summary.text }))).length;
        if (candidateLength > maxSummaryProjectionCharacters) {
          // Contiguous window reached; cannot include this or older batches without creating a gap.
          break;
        }
        selected.unshift(item.saved);
      }
      const latest = selected.at(-1) ?? head;
      const { id, version, createdAt, lastCoveredMessageId } = latest.summary;
      const batchProjection = { batches: selected.map(value => {
        // Recompute from dependencies too: old stored heads may have a lexically sorted expiry.
        const expiry = summaryExpiry([value.validUntil, ...value.batch!.dependencies.map(item => item.validUntil)]);
        return { id: value.summary.id, sourceMessageIds: value.summary.coveredMessageIds, text: value.summary.text,
          validUntil: expiry === Infinity ? null : new Date(expiry).toISOString() };
      }), omittedOrInvalidatedBatches: recent.batches.length - selected.length };
      const expiry = summaryExpiry(batchProjection.batches.map(batch => batch.validUntil));
      return { summary: { id, version, text: historicalSummaryText(batchProjection), createdAt, lastCoveredMessageId }, basis: result.current.basis,
        validUntil: expiry === Infinity ? null : new Date(expiry).toISOString(), batchProjection };
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
