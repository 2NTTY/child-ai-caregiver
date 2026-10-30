import { z } from 'zod';
import { importProvenanceSchema } from '../src/shared/import-provenance.ts';
import type { Query } from '@google-cloud/firestore';
import type { DocumentSnapshot, DocumentSource } from '../src/shared/family-documents.ts';
import type { ConcernEvent } from '../src/shared/concerns.ts';
import type { FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import type { FirestoreCareStore } from './firestore-care.ts';
import type { FirestoreMemoryStore } from './firestore-memory.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreTaskSchema, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { readContextBasis } from './firestore-context-basis.ts';
import { profileIsApplicable } from './memory-policy.ts';
import { emptyFamilyDocumentSources, profileText, recordDocumentSource, factDocumentSource, taskDocumentSource,
  concernDocumentSource, type FamilyDocumentSources } from './family-document-snapshot.ts';
import { accumulateReportInputs, type ReportAccumulator, type ReportInput } from './family-document-report-core.ts';

const uuid = z.uuid(), time = z.iso.datetime({ offset: true }), version = z.number().int().positive();
// Shared storage read contract. F06 writes these heads/events and increments the same context basis.
export const firestoreDocumentConcernSchema = z.object({ id: uuid, childId: uuid, version,
  title: z.string().max(160), reason: z.string().max(2000), status: z.enum(['following', 'closed']), timelineId: uuid.optional() }).passthrough();
export const firestoreDocumentConcernEventSchema = z.object({ concernId: uuid, childId: uuid, sequence: z.number().int().positive(),
  timelineId: uuid.optional(),
  importedFrom: importProvenanceSchema.optional(),
  id: uuid, at: time, kind: z.enum(['observation', 'confirmed_action']), title: z.string().max(160), text: z.string().max(2000),
  sourceLabel: z.string().max(256), actorUserId: z.string().max(256), recordId: uuid.optional(), taskId: uuid.optional(),
  attentionId: uuid.optional(), attentionVersion: version.optional(), runId: uuid.optional() }).strict();

export interface FirestoreDocumentReport extends ReportAccumulator { pageAfter?: string }

/** All reads use the caller's transaction and scope; there are no nested authority transactions. */
export function createFirestoreDocumentSources(options: FirestoreDomainOptions & { care: FirestoreCareStore; memory: FirestoreMemoryStore }) {
  const data = new FirestoreDomainData(options), pageSize = 25;
  const sourceModule = { profile: 'profile', record: 'care', fact: 'memory', task: 'tasks', concern: 'concerns' } as const;
  function sourceBinding(b: Binding, kind: keyof typeof sourceModule, published = false): Binding | null {
    if (!b.sharedAccess) return b;
    const access = b.sharedAccess, module = sourceModule[kind];
    if (access.module !== 'documents') domainReject('shared_module_scope', 403);
    if (!published && !(access.modules ?? [access.module]).includes(module)) return null;
    // Published excerpts are already part of the shared document. This internal read only checks
    // their currentness; it is never a source-list endpoint or a capability for writes.
    return { ...b, sharedAccess: { ...access, module, mode: 'read' } };
  }
  function query(b: Binding, suffix: string): Query {
    let q: Query = data.collection(suffix);
    for (const [key, value] of Object.entries(data.tags(b.scope))) q = q.where(key, '==', value);
    return q;
  }
  async function page(b: Binding, suffix: string, field: string, after?: string, live = false) {
    let q = query(b, suffix).orderBy(field, 'asc').limit(pageSize + 1);
    if (live) q = q.where('live', '==', true);
    if (suffix === 'memory_facts') q = q.where('visibility', '==', 'family').where('status', '==', 'confirmed');
    if (after) q = q.startAfter(domainParse(uuid, after));
    const rows = await b.transaction.get(q), items = rows.docs.slice(0, pageSize);
    return { ids: items.map(row => domainParse(uuid, row.get(field), 'source_binding', 500)),
      next: rows.size > pageSize ? items.at(-1)!.get(field) as string : null, count: items.length };
  }
  async function task(b: Binding, id: string) {
    const row = await b.transaction.get(data.ref('tasks', 'task', id)); if (!row.exists) return null;
    if (Object.entries(data.tags(b.scope)).some(([key, value]) => row.get(key) !== value)) domainReject('not_found', 404);
    const value = data.open('task', id, b.scope, firestoreTaskSchema, row);
    if (value.id !== id || value.childId !== b.scope.childId || value.version !== row.get('recordVersion')) domainReject('task_binding', 500);
    return value;
  }
  async function concern(b: Binding, id: string) {
    const row = await b.transaction.get(data.ref('concerns', 'concern', id)); if (!row.exists) return null;
    if (Object.entries(data.tags(b.scope)).some(([key, value]) => row.get(key) !== value)) domainReject('not_found', 404);
    const value = data.open('concern', id, b.scope, firestoreDocumentConcernSchema, row);
    if (value.id !== id || value.childId !== b.scope.childId || value.version !== row.get('recordVersion')) domainReject('concern_binding', 500);
    return value;
  }
  async function event(b: Binding, concernId: string, id: string, timelineId?: string) {
    const row = await b.transaction.get(data.ref('concern_events', 'concern-event', id)); if (!row.exists) return null;
    if (Object.entries(data.tags(b.scope)).some(([key, value]) => row.get(key) !== value)) domainReject('not_found', 404);
    const value = data.open('concern-event', id, b.scope, firestoreDocumentConcernEventSchema, row);
    if (value.id !== id || value.concernId !== concernId || value.childId !== b.scope.childId
      || value.sequence !== row.get('sequence')
      || row.get(value.timelineId ? 'timelineId' : 'concernId') !== (value.timelineId ?? concernId)) domainReject('concern_binding', 500);
    if (value.timelineId !== timelineId) return null;
    return value;
  }
  async function profile(b: Binding) {
    const scoped = sourceBinding(b, 'profile');
    if (!scoped) return emptyFamilyDocumentSources(b.scope.childId).profile;
    const value = await options.care.readProfile(scoped);
    return { ...value, data: profileIsApplicable(value.data) ? value.data : null };
  }
  const profileSource = (value: Awaited<ReturnType<typeof profile>>): DocumentSource => ({ id: 'profile:' + value.childId,
    resourceId: value.childId, kind: 'profile', version: value.version, label: '已確認孩子資料', text: profileText(value), at: null });
  async function reference(b: Binding, source: Pick<DocumentSource, 'kind' | 'id' | 'resourceId'>, published = false): Promise<DocumentSource | null> {
    const scoped = sourceBinding(b, source.kind, published); if (!scoped) return null;
    if (source.kind !== 'concern' && source.id !== source.kind + ':' + source.resourceId) return null;
    if (source.kind === 'profile') {
      if (source.resourceId !== b.scope.childId) return null;
      const value = await options.care.readProfile(scoped);
      return profileSource({ ...value, data: profileIsApplicable(value.data) ? value.data : null });
    }
    if (source.kind === 'record') { const value = await options.care.readRecord(scoped, source.resourceId); return value ? recordDocumentSource(value) : null; }
    if (source.kind === 'fact') {
      const value = await options.memory.readFact(scoped, source.resourceId);
      return value?.visibility === 'family' && value.status === 'confirmed' && value.applicable && value.sourceState === 'current'
        ? factDocumentSource(value) : null;
    }
    if (source.kind === 'task') { const value = await task(b, source.resourceId); return value ? taskDocumentSource(value) : null; }
    const value = await concern(b, source.resourceId); if (!value) return null;
    if (source.id === 'concern:' + source.resourceId) return concernDocumentSource(value);
    const prefix = 'concern:' + source.resourceId + ':observation:';
    if (!source.id.startsWith(prefix) || !uuid.safeParse(source.id.slice(prefix.length)).success) return null;
    const observation = await event(b, source.resourceId, source.id.slice(prefix.length), value.timelineId);
    return observation?.kind === 'observation' ? concernDocumentSource(value, observation) : null;
  }
  async function supplement(b: Binding, loaded: FamilyDocumentSources, snapshots: DocumentSnapshot[]) {
    loaded.referencedSources ??= new Map(); loaded.checkedReferences ??= new Set();
    const known = new Set(loaded.entries.map(source => source.id));
    const published = snapshots.flatMap(snapshot => snapshot.sources);
    for (const source of new Map(published.map(source => [source.id, source])).values()) {
      if (known.has(source.id) || loaded.checkedReferences.has(source.id)) continue;
      const current = await reference(b, source, true);
      // Validation must not become a way to rebind an edit to unpublished private text.
      // Keep only an exact excerpt already disclosed in these snapshots, unless the
      // source module itself is shared. An unmatched check may be retried for another version.
      if (!sourceBinding(b, source.kind) && (!current || !published.some(value => value.id === current.id
        && value.version === current.version && value.text === current.text))) continue;
      loaded.checkedReferences.add(source.id);
      if (current) loaded.referencedSources.set(source.id, current);
    }
  }
  async function load(b: Binding): Promise<FamilyDocumentSources> {
    const loaded = emptyFamilyDocumentSources(b.scope.childId); loaded.profile = await profile(b); loaded.limited = false;
    loaded.sourceRevision = (await readContextBasis(data, b)).basis;
    const add = (source: DocumentSource, domain: ReportInput['domain']) => { loaded.entries.push(source); loaded.domains.set(source.id, domain); };
    if (sourceBinding(b, 'profile')) add(profileSource(loaded.profile), 'profile'); else loaded.limited = true;
    for (const [kind, suffix, field, live] of [['record', 'care_records', 'entityId', true], ['fact', 'memory_facts', 'entityId', true],
      ['task', 'tasks', 'taskId', false], ['concern', 'concerns', 'concernId', false]] as const) {
      const sourceScope = sourceBinding(b, kind); if (!sourceScope) { loaded.limited = true; continue; }
      const result = await page(b, suffix, field, undefined, live); loaded.limited ||= result.next !== null;
      for (const id of result.ids) {
        const source = await reference(b, { kind, id: kind + ':' + id, resourceId: id }); if (!source) continue;
        add(source, kind === 'fact' ? 'profile' : kind === 'concern' ? 'concerns' : 'changes_support');
        if (kind === 'record') {
          const record = await options.care.readRecord(sourceScope, id);
          if (record && ['feeding', 'sleep', 'diaper', 'temperature', 'measurement'].includes(record.details.kind)) loaded.domains.set(source.id, 'body_life');
          if (record && /[?？]\s*$/u.test(record.text)) loaded.questions.add(source.id);
        }
        if (kind === 'concern') {
          const current = await concern(b, id); if (current?.status === 'following') loaded.activeConcernIds.add(source.id);
          const rows = await b.transaction.get(query(b, 'concern_events').where(current?.timelineId ? 'timelineId' : 'concernId', '==', current?.timelineId ?? id).orderBy('sequence', 'asc').limit(6));
          loaded.limited ||= rows.size > 5;
          for (const row of rows.docs.slice(0, 5)) {
            const item = await event(b, id, domainParse(uuid, row.get('eventId'), 'concern_binding', 500), current?.timelineId);
            if (current && item?.kind === 'observation') add(concernDocumentSource(current, item), 'concerns');
          }
        }
      }
    }
    return loaded;
  }
  /** One bounded source page. Counts accumulate over all pages; wording stays bounded separately. */
  async function advance(b: Binding, state: FirestoreDocumentReport) {
    const kind = { profile: 'profile', records: 'record', facts: 'fact', tasks: 'task', concerns: 'concern', done: 'profile' } as const;
    if (state.stage !== 'done' && !sourceBinding(b, kind[state.stage])) {
      if (state.stage === 'profile') state.profile = emptyFamilyDocumentSources(b.scope.childId).profile;
      state.stage = { profile: 'records', records: 'facts', facts: 'tasks', tasks: 'concerns', concerns: 'done' }[state.stage] as FirestoreDocumentReport['stage'];
      delete state.pageAfter; return;
    }
    if (state.stage === 'profile') {
      state.profile = await profile(b);
      accumulateReportInputs(state, [{ source: profileSource(state.profile), domain: 'profile',
        validUntil: state.profile.data?.validUntil ? new Date(Date.parse(state.profile.data.validUntil + 'T16:00:00Z')).toISOString() : null }]);
      state.stage = 'records'; return;
    }
    if (state.stage === 'done') return;
    if (state.stage === 'concerns') {
      // Consume each concern's events before advancing to the next head. A page split cannot drop observations.
      let current = state.concernAfter ? await concern(b, state.concernAfter.id) : null;
      if (current && state.concernAfter && (state.concernAfter.timelineId ?? null) !== (current.timelineId ?? null)) domainReject('document_source_changed');
      if (!current) {
        let q = query(b, 'concerns').orderBy('concernId', 'asc').limit(1);
        if (state.pageAfter) q = q.startAfter(state.pageAfter);
        const heads = await b.transaction.get(q);
        if (!heads.size) { state.stage = 'done'; delete state.pageAfter; return; }
        current = await concern(b, domainParse(uuid, heads.docs[0].get('concernId'), 'concern_binding', 500));
        if (!current) domainReject('concern_binding', 500);
        state.concernAfter = { id: current.id, sequence: 0, ...(current.timelineId ? { timelineId: current.timelineId } : {}) };
        state.pendingConcern = { id: current.id, header: current.status === 'following' ? concernDocumentSource(current) : null, sawObservation: false };
        accumulateReportInputs(state, [], 1);
      }
      const rows = await b.transaction.get(query(b, 'concern_events').where(current.timelineId ? 'timelineId' : 'concernId', '==', current.timelineId ?? current.id)
        .where('sequence', '>', state.concernAfter!.sequence).orderBy('sequence', 'asc').limit(pageSize + 1));
      const inputs: ReportInput[] = [];
      for (const row of rows.docs.slice(0, pageSize)) {
        const value = await event(b, current.id, domainParse(uuid, row.get('eventId'), 'concern_binding', 500), current.timelineId);
        if (!value) domainReject('concern_binding', 500);
        if (value.kind === 'observation') {
          state.pendingConcern!.sawObservation = true;
          inputs.push({ source: concernDocumentSource(current, value as ConcernEvent), domain: 'concerns' });
        }
      }
      if (rows.size > pageSize) state.concernAfter!.sequence = rows.docs[pageSize - 1].get('sequence');
      else {
        // Defer an undated header until every observation page has been read, matching the SQL report contract.
        if (state.pendingConcern?.header && !state.pendingConcern.sawObservation)
          inputs.push({ source: state.pendingConcern.header, domain: 'concerns', activeConcern: true });
        state.pageAfter = current.id; delete state.concernAfter; delete state.pendingConcern;
      }
      accumulateReportInputs(state, inputs, Math.min(rows.size, pageSize));
      return;
    }
    const stage = state.stage, suffix = { records: 'care_records', facts: 'memory_facts', tasks: 'tasks' }[stage];
    const result = await page(b, suffix, stage === 'tasks' ? 'taskId' : 'entityId', state.pageAfter, stage !== 'tasks');
    const inputs: ReportInput[] = [];
    for (const id of result.ids) {
      if (stage === 'records') {
        const value = await options.care.readRecord(sourceBinding(b, 'record')!, id); if (!value) domainReject('source_binding', 500);
        inputs.push({ source: recordDocumentSource(value), recordKind: value.details.kind,
          domain: ['feeding', 'sleep', 'diaper', 'temperature', 'measurement'].includes(value.details.kind) ? 'body_life' : 'changes_support' });
      } else if (stage === 'facts') {
        const value = await options.memory.readFact(sourceBinding(b, 'fact')!, id);
        if (value?.visibility === 'family' && value.status === 'confirmed' && value.applicable && value.sourceState === 'current')
          inputs.push({ source: factDocumentSource(value), domain: 'profile', validUntil: value.validUntil });
      } else { const value = await task(b, id); if (!value) domainReject('source_binding', 500); inputs.push({ source: taskDocumentSource(value), domain: 'changes_support' }); }
    }
    accumulateReportInputs(state, inputs, result.count);
    if (result.next) state.pageAfter = result.next;
    else { delete state.pageAfter; state.stage = { records: 'facts', facts: 'tasks', tasks: 'concerns' }[stage] as ReportAccumulator['stage']; }
  }
  return { load, supplement, reference, advance, revision: async (b: Binding) => (await readContextBasis(data, b)).basis };
}
