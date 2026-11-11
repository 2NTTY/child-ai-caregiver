import { z } from 'zod';
import type { Query } from '@google-cloud/firestore';
import type { FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { createFirestoreAuthority } from './firestore-authority.ts';
import { FirestoreDomainData, firestoreDomainHash, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import type { FirestoreCareStore } from './firestore-care.ts';
import type { FirestoreKnowledgeStore } from './firestore-knowledge.ts';
import { SOURCE_WATCHES } from './knowledge-source-catalog.ts';
import { profileKnowledgeAge } from './knowledge-query-context.ts';
import { createFirestoreProactivePublicStore, proactiveManagedPublicDaySchema,
  type ProactivePublicSelection, type ProactivePublicResult } from './firestore-proactive-public.ts';
import { sourceFetchUrl } from './knowledge-source-fetch.ts';
import { firestoreTopicStorageSchema } from './firestore-memory.ts';
import { validSharedAttribution } from './shared-write-attribution.ts';
import { topicMayAsk } from './memory-policy.ts';

const selectionSchema = proactiveManagedPublicDaySchema.shape.events.element.omit({ versionHash: true, contentHash: true });
/** Operator deployment configuration, never model arguments or a family request. */
export function parseProactivePublicSelections(value: string | undefined): ProactivePublicSelection[] {
  if (!value?.trim()) return [];
  return z.array(selectionSchema).max(8).parse(JSON.parse(value));
}
export interface ProactiveEventSourceOptions extends FirestoreDomainOptions {
  serverClock?: () => number;
  knowledge?: Pick<FirestoreKnowledgeStore, 'publishedEdition' | 'ruleCandidates'>;
  care: Pick<FirestoreCareStore, 'readProfile'>;
  sourceIds: readonly string[];
  managedSelections?: readonly ProactivePublicSelection[];
}
export interface ProactiveEventCandidates extends Omit<ProactivePublicResult, 'reason'> {
  reason: ProactivePublicResult['reason'] | 'knowledge_unavailable' | 'profile_unavailable' | 'region_unconfirmed' | 'age_unconfirmed';
  coverage: string[];
}
const hkDay = (at: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
const clock = (options: ProactiveEventSourceOptions) => new Date(options.serverClock?.() ?? Date.now()).toISOString();

/** Finite global discovery and exact family profile resolution; no private scans or per-family ingestion. */
export function createProactiveEventSources(options: ProactiveEventSourceOptions) {
  const authority = createFirestoreAuthority(options);
  const data = new FirestoreDomainData(options);
  const sources = z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/u)).max(10).parse([...options.sourceIds]);
  if (new Set(sources).size !== sources.length) throw new Error('proactive_public_duplicate_source');
  const managed = z.array(selectionSchema).max(8).parse(options.managedSelections ?? []);
  const institutions = SOURCE_WATCHES.filter(definition => new URL(definition.url).hostname.endsWith('.gov.hk'));
  const knowledge = options.knowledge;
  const store = knowledge ? createFirestoreProactivePublicStore({ ...options, knowledge, institutions }) : null;
  const stateRef = options.database.collection(options.namespace + '_proactive_public_source_state').doc('current');
  const checkpointSchema = z.strictObject({ schemaVersion: z.literal(1), projectId: z.literal(options.projectId), namespace: z.literal(options.namespace),
    day: z.string(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/u), preparedAt: z.iso.datetime(),
    nextCheckAt: z.iso.datetime().optional(), coverage: z.array(z.string()).max(32) });
  const pointerSchema = z.object({ schemaVersion: z.literal(1), projectId: z.literal(options.projectId), namespace: z.literal(options.namespace),
    sourceId: z.string(), activeVersionId: z.uuid().nullable(), enabled: z.boolean(), revision: z.string() });
  const configured = [...new Set([...sources, ...managed.map(event => event.sourceId)])].sort();
  if (configured.length > 18) throw new Error('proactive_public_source_limit');
  const pointers = async (transaction: Binding['transaction']) => {
    const snapshots = configured.length ? await transaction.getAll(...configured.map(id => options.database.collection(options.namespace + '_knowledge_sources').doc(id))) : [];
    return snapshots.map((snapshot, index) => {
      if (!snapshot.exists) return [configured[index], null];
      const row = pointerSchema.parse(snapshot.data());
      if (row.sourceId !== configured[index] || snapshot.id !== row.sourceId) throw new Error('proactive_public_source_binding_invalid');
      return [row.sourceId, row.activeVersionId, row.enabled, row.revision];
    });
  };
  const fingerprint = (rows: unknown) => firestoreDomainHash(['proactive-public-discovery-v1', sources, configured, managed, rows]);
  const unavailable = (reason: ProactiveEventCandidates['reason'], at: string, coverage: string[] = []): ProactiveEventCandidates => ({
    state: 'unavailable', reason, day: hkDay(at), preparedAt: null, complete: false, candidates: [], excluded: [], coverage,
  });
  const ready = (prior: z.infer<typeof checkpointSchema>) => ({ state: 'ready' as const, reason: null,
    complete: prior.coverage.length === 0, coverage: prior.coverage, preparedAt: prior.preparedAt });
  let cached: ReturnType<typeof ready> | null = null, nextProbeAt = 0;
  async function familyTopics(binding: Binding, asOf: string) {
    const tags = data.tags(binding.scope);
    let query: Query = data.collection('memory_topics');
    for (const [key, value] of Object.entries(tags)) query = query.where(key, '==', value);
    const rows = await binding.transaction.get(query.where('live', '==', true).where('visibility', '==', 'family').orderBy('entityId', 'asc').limit(9));
    const titles: string[] = [];
    for (const row of rows.docs.slice(0, 8)) {
      const id = z.uuid().parse(row.get('entityId'));
      if (Object.entries(tags).some(([key, value]) => row.get(key) !== value) || row.ref.path !== data.ref('memory_topics', 'memory-topic', id).path)
        throw new Error('proactive_family_topic_binding_invalid');
      const topic = data.open('memory-topic', id, binding.scope, firestoreTopicStorageSchema, row);
      if (topic.id !== id || topic.childId !== binding.scope.childId || topic.visibility !== 'family' || topic.version !== row.get('recordVersion')
        || !validSharedAttribution(topic.changedViaShare, binding.scope, id, topic.version, topic.updatedBy)) throw new Error('proactive_family_topic_binding_invalid');
      if (topicMayAsk(topic, Date.parse(asOf))) titles.push(topic.title);
    }
    return { titles, complete: rows.size <= 8 };
  }
  return {
    async prepareGlobal(input: { force?: boolean } = {}) {
      const asOf = clock(options), day = hkDay(asOf);
      if (!store || !knowledge) return { state: 'unavailable' as const, reason: 'knowledge_unavailable', complete: false, coverage: ['knowledge_unavailable'] };
      if (!input.force && cached && Date.parse(asOf) < nextProbeAt && hkDay(cached.preparedAt) === day) return cached;
      const nextCheckAt = new Date(Date.parse(asOf) + 15 * 60000).toISOString();
      const before = await options.database.runTransaction(async transaction => {
        if (!(await authority.readControl(transaction)).enabled) return null;
        const row = await transaction.get(stateRef), prior = row.exists ? checkpointSchema.parse(row.data()) : null;
        if (!input.force && prior?.day === day && prior.nextCheckAt && prior.nextCheckAt > asOf) return { reuse: prior };
        const currentFingerprint = fingerprint(await pointers(transaction));
        if (!input.force && prior?.day === day && prior.fingerprint === currentFingerprint) {
          transaction.set(stateRef, { ...prior, nextCheckAt });
          return { reuse: { ...prior, nextCheckAt } };
        }
        return { fingerprint: currentFingerprint };
      });
      if (!before) return { state: 'unavailable' as const, reason: 'worker_paused', complete: false, coverage: ['worker_paused'] };
      if ('reuse' in before && before.reuse) { cached = ready(before.reuse); nextProbeAt = Date.parse(before.reuse.nextCheckAt ?? nextCheckAt); return cached; }
      const selections = [...managed], automatic: ProactivePublicSelection[] = [], coverage: string[] = [];
      for (const sourceId of sources) {
        if (managed.some(event => event.sourceId === sourceId)) continue;
        const edition = await knowledge.publishedEdition(sourceId);
        if (!edition?.enabled) { coverage.push('source_unavailable:' + sourceId); continue; }
        const institution = institutions.find(definition => {
          try { return definition.publisher === edition.source.publisher && sourceFetchUrl(edition.source.url, definition).hostname === new URL(definition.url).hostname; }
          catch { return false; }
        });
        if (!institution) { coverage.push('original_institution_unconfirmed:' + sourceId); continue; }
        const recent = edition.source.classification === 'recent_information';
        if (recent && !edition.source.sourcePublishedAt) { coverage.push('publication_date_unconfirmed:' + sourceId); continue; }
        if (edition.source.chunks.length > 8) coverage.push('bounded_projection_truncated');
        // Reviewed recent editions can generate ordinary notices; importance comes only from an explicit selection.
        for (const chunk of edition.source.chunks.slice(0, 8)) {
          const kind = recent ? 'announcement' : 'guidance';
          automatic.push({ eventId: kind + '-' + firestoreDomainHash([sourceId, chunk.key]).slice(0, 48), issuerId: institution.id,
            sourceId, key: chunk.key, kind, state: 'active', validFrom: recent ? edition.source.sourcePublishedAt : null,
            validUntil: edition.source.validUntil ?? null });
        }
      }
      if (!managed.length && !automatic.some(event => event.kind === 'announcement')) coverage.push('managed_recent_events_not_configured');
      automatic.sort((left, right) => Number(right.kind === 'announcement') - Number(left.kind === 'announcement')
        || (right.validFrom ?? '').localeCompare(left.validFrom ?? ''));
      if (selections.length + automatic.length > 8) coverage.push('bounded_projection_truncated');
      selections.push(...automatic.slice(0, 8 - selections.length));
      const boundedCoverage = [...new Set(coverage)].slice(0, 32);
      const prepared = await options.database.runTransaction(async transaction => {
        if (!(await authority.readControl(transaction)).enabled) return { state: 'unavailable' as const, reason: 'worker_paused', complete: false, coverage: ['worker_paused'] };
        if (fingerprint(await pointers(transaction)) !== before.fingerprint)
          return { state: 'unavailable' as const, reason: 'publication_changed', complete: false, coverage: ['publication_changed'] };
        // Every current source and day-page read precedes both global writes.
        const page = await store.prepare(transaction, { selections, complete: boundedCoverage.length === 0 }, asOf);
        transaction.set(stateRef, { schemaVersion: 1, projectId: options.projectId, namespace: options.namespace,
          day, fingerprint: before.fingerprint, preparedAt: asOf, nextCheckAt, coverage: boundedCoverage });
        return { state: 'ready' as const, reason: null, complete: page.complete, preparedAt: asOf, coverage: boundedCoverage };
      });
      if (prepared.state === 'ready') { cached = prepared; nextProbeAt = Date.parse(nextCheckAt); }
      return prepared;
    },
    async readCandidates(binding: Binding): Promise<ProactiveEventCandidates> {
      const asOf = clock(options);
      if (!store) return unavailable('knowledge_unavailable', asOf);
      if (binding.sharedAccess || binding.actorUserId !== binding.scope.ownerUserId || !await binding.readChild(binding.scope.childId))
        return unavailable('profile_unavailable', asOf, ['owned_child_required']);
      const profile = await options.care.readProfile(binding), detail = profile.data;
      if (!detail || !profile.confirmedAt || !profile.confirmedBy || profile.version < 1
        || detail.validUntil && detail.validUntil < hkDay(asOf)) return unavailable('profile_unavailable', asOf);
      if (!detail.region || !/^(?:HK|香港|Hong Kong)$/iu.test(detail.region.trim())) return unavailable('region_unconfirmed', asOf);
      const age = profileKnowledgeAge({ profileApplicable: true, profile }, new Date(asOf));
      const topics = await familyTopics(binding, asOf);
      const result = await store.candidates(binding.transaction, { region: 'HK', age: age.precision === 'confirmed' ? age.age : null,
        ageBasisIdentity: age.precision === 'confirmed' ? firestoreDomainHash(detail.age) : undefined,
        topics: [], topicTexts: topics.titles, confirmedConditions: [],
        householdRevision: firestoreDomainHash([binding.scope.ownerUserId, binding.scope.childId, binding.scope.storageEpoch,
          'public-household']) }, asOf);
      return { ...result, coverage: [
        ...(age.precision !== 'confirmed' ? ['age_specific_events_excluded'] : []),
        ...(!topics.complete ? ['family_topics_truncated'] : []),
        ...(!result.complete ? ['public_event_coverage_incomplete'] : []),
        ...(detail.dueDate || detail.gestationalWeeksRaw ? ['corrected_age_not_inferred'] : []),
        ...(result.excluded.some(event => event.reason === 'not_applicable') ? ['unconfirmed_conditions_or_age_excluded'] : []),
      ] };
    },
  };
}
