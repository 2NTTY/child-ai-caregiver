import type { Firestore, Transaction } from '@google-cloud/firestore';
import { z } from 'zod';
import type { KnowledgeEvidence, KnowledgeFilter } from '../src/shared/knowledge.ts';
import type { FirestoreKnowledgeStore } from './firestore-knowledge.ts';
import { knowledgeHash, parseKnowledgeFilter } from './knowledge-inputs.ts';
import type { SourceWatchDefinition } from './knowledge-refresh-types.ts';
import { sourceFetchUrl } from './knowledge-source-fetch.ts';
import { knowledgeTokens } from './knowledge-ranking.ts';

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const instant = z.iso.datetime({ offset: true });
export const proactiveManagedPublicDaySchema = z.strictObject({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u), preparedAt: instant, complete: z.boolean(),
  events: z.array(z.strictObject({
    eventId: id, issuerId: id, sourceId: id, key: id, versionHash: hash.nullable(), contentHash: hash.nullable(),
    kind: z.enum(['guidance', 'announcement', 'deadline', 'recall']),
    state: z.enum(['active', 'withdrawn']), validFrom: instant.nullable(), validUntil: instant.nullable(),
  })).max(8),
}).superRefine((day, context) => {
  if (new Set(day.events.map(event => event.eventId)).size !== day.events.length)
    context.addIssue({ code: 'custom', message: 'Duplicate public event identity' });
  for (const event of day.events) if (event.validFrom && event.validUntil && Date.parse(event.validFrom) >= Date.parse(event.validUntil))
    context.addIssue({ code: 'custom', message: 'Invalid public event validity window' });
  for (const event of day.events) if (event.state === 'active' && (!event.versionHash || !event.contentHash))
    context.addIssue({ code: 'custom', message: 'Active public events require a published evidence binding' });
});
export type ProactiveManagedPublicDay = z.infer<typeof proactiveManagedPublicDaySchema>;
export interface ProactivePublicAudience {
  region: 'HK'; age: KnowledgeFilter['age']; topics: string[]; confirmedConditions: string[];
  topicTexts?: string[];
  ageBasisIdentity?: string;
  /** Monotonic authority-derived household/context revision, including changes away and back. */
  householdRevision: string;
}
export interface ProactivePublicCandidate {
  eventId: string; kind: ProactiveManagedPublicDay['events'][number]['kind'];
  semanticId: string; assessmentId: string; evidence: KnowledgeEvidence;
}
export interface ProactivePublicResult {
  state: 'ready' | 'unavailable'; reason: 'public_events_not_prepared' | 'public_events_stale' | null;
  day: string; preparedAt: string | null; complete: boolean; candidates: ProactivePublicCandidate[];
  excluded: { eventId: string; reason: 'inactive' | 'issuer_unbound' | 'source_unavailable' | 'source_changed' | 'not_applicable' | 'usage_restricted' }[];
}
export interface ProactivePublicOptions {
  knowledge: Pick<FirestoreKnowledgeStore, 'ruleCandidates'>;
  /** Trusted original institution definitions, never a media feed or model-selected URL. */
  institutions: readonly SourceWatchDefinition[];
  /** One shared, globally maintained daily projection; must not fetch, model-call or scan per household. */
  readManagedEvents(transaction: Transaction, day: string): Promise<ProactiveManagedPublicDay | null>;
}
const hkDay = (at: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
const within = (at: number, from: string | null | undefined, until: string | null | undefined) =>
  (!from || Date.parse(from) <= at) && (!until || Date.parse(until) > at);
function originalInstitution(evidence: KnowledgeEvidence, institution: SourceWatchDefinition | undefined): boolean {
  if (!institution) return false;
  try { return evidence.publisher === institution.publisher && sourceFetchUrl(evidence.url, institution).hostname === new URL(institution.url).hostname; }
  catch { return false; }
}

/** Read-only exact-source checks inside the family's transaction, before any family writes. */
export function createProactivePublicEvents(options: ProactivePublicOptions) {
  const institutions = new Map(options.institutions.map(definition => [definition.id, definition]));
  if (institutions.size !== options.institutions.length || institutions.size > 32) throw new Error('proactive_public_institutions_invalid');
  for (const definition of institutions.values()) {
    // Current maintained knowledge supports these official HK hosts; media remains a discovery lead.
    if (!new URL(definition.url).hostname.endsWith('.gov.hk')) throw new Error('proactive_public_original_institution_required');
    sourceFetchUrl(definition.url, definition);
  }
  return {
    async candidates(transaction: Transaction, audience: ProactivePublicAudience, asOf = new Date().toISOString()): Promise<ProactivePublicResult> {
      instant.parse(asOf);
      const at = Date.parse(asOf), day = hkDay(asOf);
      if (audience.region !== 'HK' || !audience.householdRevision || audience.householdRevision.length > 200
        || !Array.isArray(audience.confirmedConditions) || audience.confirmedConditions.length > 32
        || audience.confirmedConditions.some(condition => typeof condition !== 'string' || condition.length > 600)
        || audience.topicTexts && (audience.topicTexts.length > 8 || audience.topicTexts.some(text => typeof text !== 'string' || text.length > 200))
        || audience.ageBasisIdentity && audience.ageBasisIdentity.length > 200) throw new Error('proactive_public_audience_invalid');
      const filter = parseKnowledgeFilter({ region: audience.region, age: audience.age, topics: audience.topics,
        classification: 'official_guidance', ageMatch: 'contained' });
      const result: ProactivePublicResult = { state: 'unavailable', reason: 'public_events_not_prepared', day,
        preparedAt: null, complete: false, candidates: [], excluded: [] };
      const raw = await options.readManagedEvents(transaction, day);
      if (!raw) return result;
      const page = proactiveManagedPublicDaySchema.parse(raw);
      result.preparedAt = page.preparedAt;
      if (page.day !== day || Date.parse(page.preparedAt) > at || at - Date.parse(page.preparedAt) > 86400_000)
        return { ...result, reason: 'public_events_stale' };
      result.state = 'ready'; result.reason = null; result.complete = page.complete;
      // Elapsed age changes eligibility, not the identity of an already assessed event.
      const topicTokens = knowledgeTokens((audience.topicTexts ?? []).join(' '));
      for (const event of page.events) {
        const exclude = (reason: ProactivePublicResult['excluded'][number]['reason']) => result.excluded.push({ eventId: event.eventId, reason });
        if (event.state !== 'active' || !within(at, event.validFrom, event.validUntil)) { exclude('inactive'); continue; }
        const institution = institutions.get(event.issuerId);
        if (!institution) { exclude('issuer_unbound'); continue; }
        // Existing storage rechecks active edition, semantic review, observation, expiry and audience terms.
        const rows = await options.knowledge.ruleCandidates(transaction, [{ sourceId: event.sourceId, key: event.key }], filter);
        const evidence = rows.find(row => row.sourceId === event.sourceId && row.key === event.key);
        if (!evidence) { exclude('source_unavailable'); continue; }
        if (evidence.versionHash !== event.versionHash || evidence.contentHash !== event.contentHash) { exclude('source_changed'); continue; }
        if (evidence.usageScope !== 'public_noncommercial') { exclude('usage_restricted'); continue; }
        if (!originalInstitution(evidence, institution)) { exclude('issuer_unbound'); continue; }
        const applies = evidence.applicability;
        const sourceTopics = knowledgeTokens([evidence.title, evidence.section, ...evidence.keywords, ...applies.topics].join(' '));
        const matchedTopicTokens = [...topicTokens].filter(token => sourceTopics.has(token)).sort();
        const age = filter.age;
        const ageMatches = applies.ageBasis === 'any' || age !== null && age.basis === applies.ageBasis
          && applies.minAgeMonths !== null && applies.maxAgeMonths !== null && age.minMonths >= applies.minAgeMonths
          && (applies.maxAgeMonthsExclusive ? age.maxMonths < applies.maxAgeMonths : age.maxMonths <= applies.maxAgeMonths);
        if (applies.region !== 'HK' || !ageMatches || filter.topics.length && !filter.topics.some(topic => applies.topics.includes(topic))
          || topicTokens.size > 0 && !matchedTopicTokens.length
          || !applies.conditions.every(condition => audience.confirmedConditions.includes(condition))) { exclude('not_applicable'); continue; }
        if (!within(at, evidence.sourcePublishedAt, evidence.validUntil)) { exclude('inactive'); continue; }
        const normalized = (text: string) => text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
        const semanticId = knowledgeHash(['proactive-public-v1', event.eventId, event.kind, event.sourceId, event.key,
          normalized(evidence.title), normalized(evidence.section), normalized(evidence.text), {
            region: applies.region, ageBasis: applies.ageBasis, minAgeMonths: applies.minAgeMonths, maxAgeMonths: applies.maxAgeMonths,
            maxAgeMonthsExclusive: applies.maxAgeMonthsExclusive ?? false,
            topics: [...applies.topics].sort(), conditions: applies.conditions.map(normalized).sort(),
          }, event.validFrom, event.validUntil, evidence.validUntil ?? null]);
        const { distance: _distance, rankScore: _rankScore, ...boundedEvidence } = evidence;
        const household = knowledgeHash([audience.householdRevision, filter.region,
          applies.ageBasis === 'any' ? null : audience.ageBasisIdentity ?? null,
          filter.topics.filter(topic => applies.topics.includes(topic)).sort(), matchedTopicTokens]);
        result.candidates.push({ eventId: event.eventId, kind: event.kind, semanticId,
          assessmentId: knowledgeHash(['proactive-public-assessment-v1', semanticId, household]), evidence: boundedEvidence });
      }
      return result;
    },
  };
}

export type ProactivePublicSelection = Omit<ProactiveManagedPublicDay['events'][number], 'versionHash' | 'contentHash'>;
export interface FirestoreProactivePublicOptions extends Omit<ProactivePublicOptions, 'readManagedEvents'> {
  database: Firestore; projectId: string; namespace: string;
}

/** Shared daily projection; maintenance calls prepare once globally, never once for each family. */
export function createFirestoreProactivePublicStore(options: FirestoreProactivePublicOptions) {
  const { database, projectId, namespace } = options;
  if (!/^[a-z][a-z0-9-]{3,62}$/u.test(projectId) || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(namespace))
    throw new Error('proactive_public_configuration_invalid');
  const ref = (day: string) => database.collection(namespace + '_proactive_public_days').doc(day);
  const envelopeSchema = z.strictObject({ schemaVersion: z.literal(1), projectId: z.literal(projectId), namespace: z.literal(namespace),
    projectionHash: hash, page: proactiveManagedPublicDaySchema });
  const selectionSchema = proactiveManagedPublicDaySchema.shape.events.element.omit({ versionHash: true, contentHash: true });
  const institutions = new Map(options.institutions.map(row => [row.id, row]));
  const readManagedEvents = async (transaction: Transaction, day: string): Promise<ProactiveManagedPublicDay | null> => {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(day)) throw new Error('proactive_public_day_invalid');
    const snapshot = await transaction.get(ref(day));
    if (!snapshot.exists) return null;
    const envelope = envelopeSchema.parse(snapshot.data());
    if (envelope.page.day !== day || envelope.projectionHash !== knowledgeHash(envelope.page)) throw new Error('proactive_public_projection_binding_invalid');
    return envelope.page;
  };
  const reader = createProactivePublicEvents({ ...options, readManagedEvents });
  return {
    ...reader, readManagedEvents,
    async prepare(transaction: Transaction, input: { selections: readonly ProactivePublicSelection[]; complete: boolean }, asOf = new Date().toISOString()): Promise<ProactiveManagedPublicDay> {
      instant.parse(asOf);
      const selections = z.array(selectionSchema).max(8).parse(input.selections);
      z.boolean().parse(input.complete);
      if (new Set(selections.map(row => row.eventId)).size !== selections.length) throw new Error('proactive_public_duplicate_event');
      const day = hkDay(asOf), at = Date.parse(asOf);
      // Read the shared generation in this same transaction before producing its replacement.
      await readManagedEvents(transaction, day);
      const page: ProactiveManagedPublicDay = { day, preparedAt: asOf, complete: input.complete, events: [] };
      const filter = parseKnowledgeFilter({ region: 'HK', classification: 'official_guidance', age: null, topics: [], ageMatch: 'unknown' });
      for (const selection of selections) {
        const institution = institutions.get(selection.issuerId);
        const rows = selection.state === 'active' && institution && within(at, selection.validFrom, selection.validUntil)
          ? await options.knowledge.ruleCandidates(transaction, [{ sourceId: selection.sourceId, key: selection.key }], filter) : [];
        const evidence = rows.find(row => row.sourceId === selection.sourceId && row.key === selection.key);
        const active = evidence && originalInstitution(evidence, institution) && evidence.usageScope === 'public_noncommercial'
          && evidence.applicability.region === 'HK' && within(at, evidence.sourcePublishedAt, evidence.validUntil);
        page.events.push({ ...selection, state: active ? 'active' : 'withdrawn',
          versionHash: active ? evidence.versionHash : null, contentHash: active ? evidence.contentHash : null });
      }
      const checked = proactiveManagedPublicDaySchema.parse(page);
      transaction.set(ref(day), { schemaVersion: 1, projectId, namespace, projectionHash: knowledgeHash(checked), page: checked });
      return checked;
    },
  };
}
