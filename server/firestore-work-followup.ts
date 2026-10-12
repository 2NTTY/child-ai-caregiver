import { randomUUID } from 'node:crypto';
import { FieldPath, type Query } from '@google-cloud/firestore';
import { z } from 'zod';
import { agentWorkSchema, workResourceSchema, workContinuationSchema, type AgentWork, type WorkResource } from '../src/shared/agent-work.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { FirestoreDomainData, domainReject, firestoreDomainHash, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { prepareFirestoreBackgroundWork, firestoreBackgroundReference, type FirestoreBackgroundWork } from './firestore-background-work.ts';
import { continuationKnowledgeMeaning, projectWorkContinuationContext, type ResourceBasis, type KnowledgeCurrent, type WorkContinuationChanges } from './agent-work-continuation-core.ts';
import type { FirestoreAgentRuns } from './firestore-agent-runs.ts';

const time = z.iso.datetime({ offset: true }), uuid = z.uuid();
const resourceSchema = workResourceSchema.extend({ status: z.string(), available: z.boolean(), terminal: z.boolean() });
const knowledgeSchema = z.object({ sourceId: z.string(), versionId: uuid.nullable(), hash: z.string().nullable(), available: z.boolean() }).strict();
const changesSchema = z.object({ due: z.boolean(), resources: z.array(workResourceSchema.extend({ previousVersion: z.number(), status: z.string() })).max(8),
  knowledge: z.array(z.object({ sourceId: z.string(), versionId: uuid, meaning: z.enum(['material', 'recheck']) }).strict()).max(4) }).strict();
export const firestoreWorkWatchSchema = z.object({ workId: uuid, workVersion: z.number().int().positive(), authorizationVersion: z.string(),
  enabled: z.boolean(), dueConsumed: z.boolean(), nextCheckAt: time, resources: z.array(resourceSchema).max(8), knowledge: z.array(knowledgeSchema).max(4),
  latestEventId: uuid.nullable() }).strict();
const eventItemSchema = z.object({ workId: uuid, workVersion: z.number().int().positive(), work: agentWorkSchema,
  resources: z.array(resourceSchema).max(8), knowledge: z.array(knowledgeSchema).max(4), changes: changesSchema }).strict();
export const firestoreWorkEventSchema = eventItemSchema.extend({ id: uuid, generation: uuid,
  authorizationVersion: z.string(), jobId: z.string(), additional: z.array(eventItemSchema).max(4).default([]), result: workContinuationSchema }).strict();
const dailySchema = z.object({ eventId: uuid, day: z.string() }).strict();
type Watch = z.infer<typeof firestoreWorkWatchSchema>;
type Event = z.infer<typeof firestoreWorkEventSchema>;
const active = (work: AgentWork) => ['active', 'waiting'].includes(work.status) && !!work.followUp;
const tomorrow = () => new Date((Math.floor((Date.now() + 8 * 3600_000) / 86400_000) + 1) * 86400_000 - 8 * 3600_000).toISOString();

/** Continuation is a private, read-only run. Canonical work and resource versions remain the authority. */
export function createFirestoreWorkFollowUp(options: FirestoreDomainOptions & {
  resource(b: Binding, resource: WorkResource): Promise<ResourceBasis>;
  knowledge(b: Binding, ids: readonly string[]): Promise<KnowledgeCurrent[]>;
  runs(): FirestoreAgentRuns;
}) {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options);
  function envelope<T>(b: Binding, kind: string, id: string, schema: z.ZodType<T>, value: T, metadata = {}) {
    return { ...data.tags(b.scope), ...metadata, ...data.seal(kind, id, b.scope, schema, value) };
  }
  async function watch(b: Binding, id: string): Promise<Watch | null> {
    const row = await b.transaction.get(data.ref('work_watches', 'work-watch', id)); if (!row.exists) return null;
    const value = data.open('work-watch', id, b.scope, firestoreWorkWatchSchema, row);
    if (value.workId !== id || row.get('enabled') !== value.enabled || row.get('nextCheckAt') !== value.nextCheckAt) domainReject('work_followup_binding', 500);
    return value;
  }
  const write = (b: Binding, value: Watch) => b.transaction.set(data.ref('work_watches', 'work-watch', value.workId),
    envelope(b, 'work-watch', value.workId, firestoreWorkWatchSchema, value, { workId: value.workId, enabled: value.enabled, nextCheckAt: value.nextCheckAt }));
  const writeEvent = (b: Binding, value: Event) => b.transaction.set(data.ref('work_events', 'work-event', value.id),
    envelope(b, 'work-event', value.id, firestoreWorkEventSchema, value));
  async function capture(b: Binding, work: AgentWork) {
    const resources: ResourceBasis[] = [];
    for (const ref of work.resources) resources.push(await options.resource(b, ref));
    const knowledge = await options.knowledge(b, work.followUp?.knowledgeSourceIds ?? []);
    return { resources, knowledge };
  }
  const stripped = (knowledge: KnowledgeCurrent[]) => knowledge.map(({ assessment: _assessment, ...entry }) => entry);
  function difference(work: AgentWork, saved: Watch, next: Awaited<ReturnType<typeof capture>>): WorkContinuationChanges {
    const changes: WorkContinuationChanges = { due: !saved.dueConsumed && !!work.followUp?.dueAt && Date.parse(work.followUp.dueAt) <= Date.now(), resources: [], knowledge: [] };
    if (work.followUp?.watchResources) for (const ref of next.resources) {
      const old = saved.resources.find(v => v.id === ref.id && v.kind === ref.kind);
      if (old && ref.available && (!old.available || old.version !== ref.version || old.status !== ref.status))
        changes.resources.push({ kind: ref.kind, id: ref.id, previousVersion: old.version, version: ref.version, status: ref.status });
    }
    for (const current of next.knowledge) {
      const meaning = continuationKnowledgeMeaning(saved.knowledge.find(v => v.sourceId === current.sourceId), current);
      if (meaning && current.versionId) changes.knowledge.push({ sourceId: current.sourceId, versionId: current.versionId, meaning });
    }
    return changes;
  }
  const meaningful = (changes: WorkContinuationChanges) => changes.due || changes.resources.length > 0 || changes.knowledge.length > 0;
  async function prepare(b: Binding, work: AgentWork) {
    const previous = await watch(b, work.id), basis = await capture(b, work), enabled = active(work) && !basis.resources.some(r => r.terminal);
    const at = new Date().toISOString(), due = work.followUp?.dueAt;
    const value: Watch = { workId: work.id, workVersion: work.version, authorizationVersion: b.authorizationVersion, enabled,
      dueConsumed: !due, nextCheckAt: due && due < at ? at : due ?? new Date(Date.now() + 3600_000).toISOString(),
      resources: basis.resources, knowledge: stripped(basis.knowledge), latestEventId: previous?.latestEventId ?? null };
    const job = enabled ? await prepareFirestoreBackgroundWork(data, b.transaction, { kind: 'work-check', scope: b.scope, resourceId: work.id,
      basis: 'version:' + work.version, generation: b.generation, authorizationVersion: b.authorizationVersion }, value.nextCheckAt) : null;
    return { commit() { write(b, value); job?.commit(); } };
  }
  async function event(b: Binding, id: string) {
    const row = await b.transaction.get(data.ref('work_events', 'work-event', id)); if (!row.exists) return null;
    const value = data.open('work-event', id, b.scope, firestoreWorkEventSchema, row);
    if (value.id !== id || value.result.eventId !== id) domainReject('work_followup_binding', 500); return value;
  }
  async function check(job: FirestoreBackgroundWork) {
    return authority.runTransaction(job.scope.ownerUserId, job.scope.childId, async b => {
      if (job.kind !== 'work-check' || b.generation !== job.generation || b.authorizationVersion !== job.authorizationVersion
        || firestoreDomainHash(job.scope) !== firestoreDomainHash(b.scope)) return { state: 'stopped' as const };
      const work = await b.readWork(job.resourceId), saved = await watch(b, job.resourceId);
      if (!work || !saved?.enabled || work.version !== saved.workVersion || saved.authorizationVersion !== b.authorizationVersion) return { state: 'stopped' as const };
      const next = await capture(b, work), changes = difference(work, saved, next);
      if (!active(work) || next.resources.some(r => r.terminal)) { saved.enabled = false; write(b, saved); return { state: 'stopped' as const }; }
      const day = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10), dailyId = JSON.stringify([b.scope, day]);
      const dailyRef = data.ref('work_daily_slots', 'work-daily-slot', dailyId), slot = meaningful(changes) ? await b.transaction.get(dailyRef) : null;
      if (slot?.exists) {
        const value = data.open('work-daily-slot', dailyId, b.scope, dailySchema, slot); if (value.day !== day) domainReject('work_followup_binding', 500);
        saved.nextCheckAt = tomorrow(); write(b, saved); return { state: 'completed' as const };
      }
      saved.resources = next.resources; saved.knowledge = stripped(next.knowledge);
      saved.nextCheckAt = !saved.dueConsumed && work.followUp?.dueAt && !changes.due ? work.followUp.dueAt : new Date(Date.now() + 3600_000).toISOString();
      if (!meaningful(changes)) { write(b, saved); return { state: 'completed' as const }; }
      // Preserve the existing daily coalescing contract: at most ten candidates, five works, one private run.
      let q: Query = data.collection('work_watches'); for (const [key, value] of Object.entries(data.tags(b.scope))) q = q.where(key, '==', value);
      const rows = await b.transaction.get(q.orderBy(FieldPath.documentId()).limit(9)), additional: z.infer<typeof eventItemSchema>[] = [], watches: Watch[] = [];
      for (const row of rows.docs) {
        if (additional.length === 4) break;
        const other = await watch(b, row.get('workId')); if (!other || other.workId === work.id || !other.enabled || other.authorizationVersion !== b.authorizationVersion) continue;
        const current = await b.readWork(other.workId); if (!current || !active(current) || current.version !== other.workVersion) continue;
        const captured = await capture(b, current); if (captured.resources.some(r => r.terminal)) continue;
        const changed = difference(current, other, captured); if (!meaningful(changed)) continue;
        other.resources = captured.resources; other.knowledge = stripped(captured.knowledge); other.dueConsumed ||= changed.due; watches.push(other);
        additional.push({ workId: current.id, workVersion: current.version, work: current, resources: other.resources, knowledge: other.knowledge, changes: changed });
      }
      const id = randomUUID(), at = new Date().toISOString();
      const queued = await prepareFirestoreBackgroundWork(data, b.transaction, { kind: 'work-continuation', scope: b.scope, resourceId: id,
        basis: id, generation: b.generation, authorizationVersion: b.authorizationVersion }, at);
      const value: Event = { id, workId: work.id, workVersion: work.version, generation: b.generation, authorizationVersion: b.authorizationVersion,
        jobId: queued.id, work, resources: saved.resources, knowledge: saved.knowledge, changes, additional,
        result: { eventId: id, runId: null, state: 'queued', createdAt: at } };
      const change = await b.prepareChange(randomUUID(), 'memory', false);
      saved.latestEventId = id; saved.dueConsumed ||= changes.due; saved.nextCheckAt = tomorrow();
      change.commit(); write(b, saved); writeEvent(b, value); queued.commit();
      for (const other of watches) { other.latestEventId = id; other.nextCheckAt = tomorrow(); write(b, other); }
      b.transaction.create(dailyRef, envelope(b, 'work-daily-slot', dailyId, dailySchema, { eventId: id, day }));
      return { state: 'completed' as const };
    });
  }
  async function input(b: Binding, job: FirestoreBackgroundWork) {
    if (job.kind !== 'work-continuation' || b.generation !== job.generation || b.authorizationVersion !== job.authorizationVersion
      || firestoreDomainHash(b.scope) !== firestoreDomainHash(job.scope)) return null;
    const value = await event(b, job.resourceId);
    if (!value || value.jobId !== job.id || value.result.state !== 'queued' || value.authorizationVersion !== b.authorizationVersion || value.generation !== b.generation) return null;
    const items = [];
    for (const item of [value, ...value.additional]) {
      const work = await b.readWork(item.workId), saved = await watch(b, item.workId);
      if (!work || !saved?.enabled || !active(work) || item.workVersion !== work.version) return null;
      const current = await capture(b, work);
      if (current.resources.some(r => r.terminal) || firestoreDomainHash(current.resources) !== firestoreDomainHash(item.resources)
        || firestoreDomainHash(stripped(current.knowledge)) !== firestoreDomainHash(item.knowledge)) return null;
      items.push({ work, changes: item.changes, textPartial: false, knowledgeSourceIds: current.knowledge.filter(v => v.available).map(v => v.sourceId) });
    }
    return projectWorkContinuationContext(value.id, items);
  }
  async function finish(job: FirestoreBackgroundWork) {
    return authority.runTransaction(job.scope.ownerUserId, job.scope.childId, async b => {
      const value = await event(b, job.resourceId); if (!value || value.jobId !== job.id) return { state: 'stopped' as const };
      if (value.result.state !== 'queued') return { state: value.result.state === 'unknown' ? 'unknown' as const : 'completed' as const };
      const runs = options.runs(), run = await runs.originalRun(b, 'worker', firestoreBackgroundReference(job));
      if (run?.state === 'running' && Date.parse(run.expiresAt) > Date.now())
        return { state: 'deferred' as const, nextAt: new Date(Date.parse(run.expiresAt) + 1000).toISOString() };
      value.result.runId = run?.id ?? null;
      value.result.state = !run ? 'stopped' : run.state === 'completed' ? 'completed' : run.state === 'stopped' ? 'stopped' : 'unknown';
      const change = await b.prepareChange(randomUUID(), 'memory', false); change.commit(); writeEvent(b, value);
      return { state: value.result.state === 'unknown' ? 'unknown' as const : value.result.state === 'stopped' ? 'stopped' as const : 'completed' as const };
    });
  }
  return { prepare, check, input, finish,
    async project(b: Binding, work: AgentWork): Promise<AgentWork> {
      const saved = await watch(b, work.id), last = saved?.latestEventId ? await event(b, saved.latestEventId) : null;
      if (!last) return work;
      const item = [last, ...last.additional].find(value => value.workId === work.id);
      return { ...work, latestFollowUp: { ...last.result, state: last.result.state === 'queued'
        && (!item || item.workVersion !== work.version || !active(work) || !saved?.enabled) ? 'cancelled' : last.result.state } };
    },
  };
}
export type FirestoreWorkFollowUp = ReturnType<typeof createFirestoreWorkFollowUp>;
