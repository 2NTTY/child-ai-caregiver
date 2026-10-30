import { randomUUID } from 'node:crypto';
import type { Query } from '@google-cloud/firestore';
import { z } from 'zod';
import { concernValuesSchema, concernChangeSchema, CONCERN_EVENT_LIMIT, CONCERN_STORED_EVENT_LIMIT,
  type Concern, type ConcernEvent, type ConcernValues, type ConcernChange } from '../src/shared/concerns.ts';
import { createFirestoreAuthority, resourceAuthorityVersion, type FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, firestoreTaskSchema,
  type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { firestoreDocumentConcernEventSchema } from './firestore-document-sources.ts';
import { prepareContextChange } from './firestore-context-basis.ts';
import { prepareFirestoreBackgroundWork, firestoreBackgroundReference, type FirestoreBackgroundWork } from './firestore-background-work.ts';
import { firestoreCareSchema } from './firestore-care.ts';
import type { FirestoreAgentProposalExtension } from './firestore-agent-proposals.ts';
import { firestoreAgentClaimSchema, firestoreAgentRunSchema } from './firestore-agent-runs.ts';
import { createFirestoreSharingStore } from './firestore-sharing.ts';

const uuid = z.uuid(), time = z.iso.datetime({ offset: true }), version = z.number().int().positive().max(2147483647);
export const firestoreConcernSchema = z.object({ id: uuid, childId: uuid, title: z.string().min(1).max(160),
  reason: z.string().min(1).max(2000), status: z.enum(['following', 'closed']), version,
  createdAt: time, updatedAt: time, archivedAt: time.nullable(), statusBeforeArchive: z.literal('following').optional(),
  timelineId: uuid.optional(),
  attentionIds: z.array(uuid).max(CONCERN_STORED_EVENT_LIMIT), eventCount: z.number().int().min(1).max(CONCERN_STORED_EVENT_LIMIT),
  followUp: z.object({ id: uuid, at: time, state: z.enum(['pending', 'queued', 'completed', 'stopped', 'unknown', 'cancelled']),
    runId: uuid.nullable() }).strict().nullable(),
}).strict();
type Head = z.infer<typeof firestoreConcernSchema>;
const receiptSchema = z.object({ fingerprint: z.string().length(64), id: uuid, version }).strict();
const followupClaimSchema = z.object({ id: uuid, concernId: uuid, concernVersion: version, jobId: z.string().length(64),
  reference: uuid, generation: uuid, authorizationVersion: z.string() }).strict();
type Prepared = { value: Concern; changeSeq: string; commit(): void };
const authorityVersion = resourceAuthorityVersion;
const openFollowup = (head: Head) => head.followUp && ['pending', 'queued'].includes(head.followUp.state);
function future(at: string | null) {
  if (at !== null && (Date.parse(at) <= Date.now() || Date.parse(at) >= Date.UTC(2101, 0, 1))) domainReject('invalid_input', 400);
}

/** Same concern IDs and HTTP contract; immutable event rows keep long histories out of a single document. */
export function createFirestoreConcernStore(options: FirestoreDomainOptions) {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options);
  const sharing = createFirestoreSharingStore(options);
  function sharedView(b: Binding, value: Concern): Concern {
    if (!b.sharedAccess) return value;
    const modules = b.sharedAccess.modules ?? [];
    return { ...value, attentionIds:modules.includes('growth') ? value.attentionIds : [],
      followUp:value.followUp ? { ...value.followUp, runId:null } : null,
      events:value.events.map(({ runId: _runId, recordId, taskId, attentionId, attentionVersion, ...event }) => ({ ...event,
        ...(recordId && modules.includes('care') ? { recordId } : {}),
        ...(taskId && modules.includes('tasks') ? { taskId } : {}),
        ...(attentionId && modules.includes('growth') ? { attentionId, ...(attentionVersion === undefined ? {} : { attentionVersion }) } : {}),
      })) };
  }
  function query(b: Binding, suffix: string): Query {
    let q: Query = data.collection(suffix); for (const [key, value] of Object.entries(data.tags(b.scope))) q = q.where(key, '==', value); return q;
  }
  async function head(b: Binding, id: string, revision?: number): Promise<Head | null> {
    domainParse(uuid, id);
    const kind = revision ? 'concern-revision' : 'concern', key = revision ? JSON.stringify([id, revision]) : id;
    const row = await b.transaction.get(data.ref(revision ? 'concern_revisions' : 'concerns', kind, key));
    if (!row.exists) return null;
    if (Object.entries(data.tags(b.scope)).some(([k, v]) => row.get(k) !== v)) domainReject('not_found', 404);
    const value = data.open(kind, key, b.scope, firestoreConcernSchema, row);
    if (value.id !== id || value.childId !== b.scope.childId || value.version !== row.get('recordVersion')
      || value.id !== row.get('concernId') || revision && value.version !== revision) domainReject('concern_binding', 500);
    return value;
  }
  async function hydrate(b: Binding, item: Head): Promise<Concern> {
    const rows = await b.transaction.get(query(b, 'concern_events').where(item.timelineId ? 'timelineId' : 'concernId', '==', item.timelineId ?? item.id)
      .where('sequence', '<=', item.eventCount).orderBy('sequence', 'asc').limit(CONCERN_STORED_EVENT_LIMIT));
    const events = rows.docs.map((row, i) => {
      const event = data.open('concern-event', row.get('eventId'), b.scope, firestoreDocumentConcernEventSchema, row);
      if (event.id !== row.get('eventId') || event.concernId !== item.id || event.childId !== item.childId
        || event.timelineId !== item.timelineId || event.sequence !== i + 1 || row.get('sequence') !== event.sequence) domainReject('concern_binding', 500);
      const { concernId: _concern, childId: _child, sequence: _sequence, timelineId: _timeline, ...value } = event; return value;
    });
    if (events.length !== item.eventCount) domainReject('concern_history_incomplete', 503);
    const { eventCount: _count, timelineId: _timeline, ...value } = item; return { ...value, events, historyComplete: true };
  }
  async function read(b: Binding, id: string) { const item = await head(b, id); return item ? hydrate(b, item) : null; }
  function event(b: Binding, at: string, kind: ConcernEvent['kind'], title: string, text: string,
    refs: Partial<ConcernEvent> = {}): ConcernEvent {
    return { id: randomUUID(), at, kind, title, text, sourceLabel: '家庭共享關注', actorUserId: b.scope.ownerUserId, ...refs };
  }
  async function links(b: Binding, values: ConcernValues['links']) {
    const refs: Partial<ConcernEvent> = {};
    for (const [field, suffix, kind, schema] of [['recordId', 'care_records', 'care-record', firestoreCareSchema],
      ['taskId', 'tasks', 'task', firestoreTaskSchema]] as const) {
      const id = values[field]; if (!id) continue;
      const row = await b.transaction.get(data.ref(suffix, kind, id));
      if (!row.exists || Object.entries(data.tags(b.scope)).some(([k, v]) => row.get(k) !== v)
        || field === 'recordId' && row.get('live') !== true) domainReject('not_found', 404);
      const value = data.open(kind, id, b.scope, schema as z.ZodType<{ id: string; childId: string }>, row);
      if (value.id !== id || value.childId !== b.scope.childId) domainReject('concern_binding', 500);
      refs[field] = id;
    }
    if (values.attentionId) {
      const row = await b.transaction.get(data.ref('growth_attention', 'growth-attention', values.attentionId));
      if (!row.exists || Object.entries(data.tags(b.scope)).some(([k, v]) => row.get(k) !== v)) domainReject('not_found', 404);
      const saved = data.open('growth-attention', values.attentionId, b.scope,
        z.object({ item: z.object({ id: uuid, childId: uuid, version }).passthrough() }).passthrough(), row);
      if (saved.item.id !== values.attentionId || saved.item.childId !== b.scope.childId) domainReject('concern_binding', 500);
      refs.attentionId = values.attentionId; refs.attentionVersion = saved.item.version;
    }
    return refs;
  }
  function cancel(value: Head) { if (openFollowup(value)) value.followUp = { ...value.followUp!, state: 'cancelled' }; }
  async function save(b: Binding, value: Head, events: ConcernEvent[], prior: ConcernEvent[], opId: string): Promise<Prepared> {
    domainParse(firestoreConcernSchema, value);
    if (prior.length + events.length !== value.eventCount) domainReject('concern_binding', 500);
    const revisionId = JSON.stringify([value.id, value.version]), revisionRef = data.ref('concern_revisions', 'concern-revision', revisionId);
    if ((await b.transaction.get(revisionRef)).exists) domainReject('concern_changed');
    const wake = value.followUp?.state === 'pending' ? await prepareFirestoreBackgroundWork(data, b.transaction,
      { kind: 'concern', scope: b.scope, resourceId: value.id, basis: value.followUp.id,
        generation: b.generation, authorizationVersion: b.authorizationVersion }, value.followUp.at) : null;
    const context = await prepareContextChange(data, b), change = await b.prepareChange(opId, 'growth', false);
    const tags = { ...data.tags(b.scope), concernId: value.id, entityVersion: value.version, createdAt: value.createdAt };
    const storedEvents = events.map((entry, i) => {
      const row = { ...entry, concernId: value.id, childId: value.childId, sequence: prior.length + i + 1,
        ...(value.timelineId ? { timelineId: value.timelineId } : {}) };
      return { ref: data.ref('concern_events', 'concern-event', entry.id), value: { ...data.tags(b.scope),
        ...(value.timelineId ? { timelineId: value.timelineId } : { concernId: value.id }), eventId: entry.id, sequence: row.sequence,
        ...data.seal('concern-event', entry.id, b.scope, firestoreDocumentConcernEventSchema, row) } };
    });
    const { timelineId: _timeline, ...publicHead } = value;
    return { value: { ...publicHead, events: [...prior, ...events], historyComplete: true }, changeSeq: change.changeSeq,
      commit() { change.commit(); context(); wake?.commit();
        b.transaction.set(data.ref('concerns', 'concern', value.id), { ...tags, ...data.seal('concern', value.id, b.scope, firestoreConcernSchema, value, value.version) });
        b.transaction.create(revisionRef, { ...tags, ...data.seal('concern-revision', revisionId, b.scope, firestoreConcernSchema, value, value.version) });
        for (const entry of storedEvents) b.transaction.create(entry.ref, entry.value);
      } };
  }
  async function prepareCreate(b: Binding, raw: ConcernValues, opId: string): Promise<Prepared> {
    const input = domainParse(concernValuesSchema, raw); future(input.followUpAt);
    if ((await b.transaction.get(query(b, 'concerns').limit(200))).size >= 200) domainReject('concern_history_requires_review', 400);
    const refs = await links(b, input.links), now = new Date().toISOString(), id = randomUUID();
    return save(b, { id, childId: b.scope.childId, title: input.title, reason: input.reason, status: 'following', version: 1,
      createdAt: now, updatedAt: now, archivedAt: null, eventCount: 1, attentionIds: input.links.attentionId ? [input.links.attentionId] : [],
      followUp: input.followUpAt ? { id: randomUUID(), at: input.followUpAt, state: 'pending', runId: null } : null },
      [event(b, input.observedAt, 'observation', '開始持續關注', input.observation, refs)], [], opId);
  }
  async function prepareChange(b: Binding, id: string, raw: ConcernChange, opId: string): Promise<Prepared> {
    const input = domainParse(concernChangeSchema, raw), value = await head(b, id); if (!value) domainReject('not_found', 404);
    if (input.authorityVersion !== authorityVersion(b) || input.expectedVersion !== value.version || value.version >= 2147483647) domainReject('concern_changed');
    const full = value.eventCount >= CONCERN_EVENT_LIMIT, cancelling = input.action === 'schedule_followup' && input.followUpAt === null;
    const archiveCancellation = full && input.action === 'archive' && !!openFollowup(value), count = archiveCancellation ? 2 : 1;
    if (full && input.action !== 'archive' && !(cancelling && openFollowup(value)) || value.eventCount + count > CONCERN_STORED_EVENT_LIMIT
      || full && cancelling && value.eventCount >= CONCERN_STORED_EVENT_LIMIT - 1) domainReject('concern_history_requires_review', 400);
    const previous = await hydrate(b, value), now = new Date().toISOString(); value.version++; value.updatedAt = now;
    const added: ConcernEvent[] = [];
    if (input.action === 'append') {
      if (value.status !== 'following') domainReject('concern_changed');
      const refs = await links(b, input.links);
      if (input.links.attentionId && !value.attentionIds.includes(input.links.attentionId)) value.attentionIds.push(input.links.attentionId);
      if (value.followUp?.state !== 'pending') cancel(value);
      added.push(event(b, input.observedAt, 'observation', '補充觀察', input.text, refs));
    } else if (input.action === 'archive') {
      if (value.status !== 'following') domainReject('concern_changed');
      cancel(value); value.status = 'closed'; value.archivedAt = now; value.statusBeforeArchive = 'following';
      if (archiveCancellation) added.push(event(b, now, 'confirmed_action', '取消站內跟進', '家長結束此關注，尚未完成的站內跟進已取消；原有事件保留。'));
      added.push(event(b, now, 'confirmed_action', '結束持續關注', '家長確認結束此關注；原有事件及相關任務保留。'));
    } else if (input.action === 'restore') {
      if (value.status !== 'closed') domainReject('concern_changed');
      cancel(value); value.status = 'following'; value.archivedAt = null;
      added.push(event(b, now, 'confirmed_action', '恢復持續關注', '家長確認恢復此關注；原有跟進不會自動重新安排。'));
    } else {
      if (value.status !== 'following') domainReject('concern_changed');
      future(input.followUpAt); cancel(value);
      if (input.followUpAt) value.followUp = { id: randomUUID(), at: input.followUpAt, state: 'pending', runId: null };
      added.push(event(b, now, 'confirmed_action', input.followUpAt ? '安排站內跟進' : '取消站內跟進',
        input.followUpAt ? '家長確認在指定時間進行一次站內跟進。' : '家長取消尚未完成的站內跟進。'));
    }
    value.eventCount += added.length; return save(b, value, added, previous.events, opId);
  }
  async function operation(userId: string, childId: string, opId: string, request: unknown,
    prepare: (b: Binding) => Promise<Prepared>) {
    domainParse(uuid, opId);
    return authority.runTransaction(userId, childId, async b => {
      const key = JSON.stringify([userId, opId]), ref = data.ref('concern_operations', 'concern-operation', key);
      const row = await b.transaction.get(ref), fingerprint = firestoreDomainHash(request);
      if (row.exists) {
        if (Object.entries(data.tags(b.scope)).some(([k, v]) => row.get(k) !== v)) domainReject('operation_mismatch');
        const receipt = data.open('concern-operation', key, b.scope, receiptSchema, row);
        if (receipt.fingerprint !== fingerprint) domainReject('operation_mismatch');
        const item = await head(b, receipt.id, receipt.version); if (!item) domainReject('operation_erased'); return hydrate(b, item);
      }
      const prepared = await prepare(b), receipt = { fingerprint, id: prepared.value.id, version: prepared.value.version };
      const envelope = { ...data.tags(b.scope), ...data.seal('concern-operation', key, b.scope, receiptSchema, receipt) };
      prepared.commit(); b.transaction.create(ref, envelope); return prepared.value;
    });
  }
  const extension: FirestoreAgentProposalExtension = {
    supports: value => value.kind === 'concern_create' || value.kind === 'concern_change',
    async target(b, value) {
      if (value.kind === 'concern_create') return { label: value.values.title, visibility: 'family', sourceBasis: null };
      if (value.kind !== 'concern_change') domainReject('invalid_input', 400);
      const item = await head(b, value.concernId);
      if (!item || item.version !== value.change.expectedVersion || authorityVersion(b) !== value.change.authorityVersion) domainReject('concern_changed');
      return { label: item.title, visibility: 'family', sourceBasis: null };
    },
    async prepare(b, saved, opId) {
      const value = saved.proposal.value;
      if (value.kind !== 'concern_create' && value.kind !== 'concern_change') domainReject('invalid_input', 400);
      const result = value.kind === 'concern_create' ? await prepareCreate(b, value.values, opId) : await prepareChange(b, value.concernId, value.change, opId);
      return { result: { kind: 'concern', id: result.value.id, version: result.value.version }, changeSeq: result.changeSeq, commit: result.commit };
    },
  };
  async function currentFollowup(b: Binding, job: FirestoreBackgroundWork) {
    if (job.kind !== 'concern' || firestoreDomainHash(job.scope) !== firestoreDomainHash(b.scope)
      || job.generation !== b.generation || job.authorizationVersion !== b.authorizationVersion) return null;
    const value = await head(b, job.resourceId);
    if (!value || value.status !== 'following' || !openFollowup(value) || value.followUp!.id !== job.basis
      || Date.parse(value.followUp!.at) > Date.now()) return null;
    if (value.followUp!.state === 'queued') {
      const row = await b.transaction.get(data.ref('concern_followups', 'concern-followup', job.basis)); if (!row.exists) domainReject('concern_binding', 500);
      const claim = data.open('concern-followup', job.basis, b.scope, followupClaimSchema, row);
      if (claim.jobId !== job.id || claim.id !== job.basis || claim.concernId !== value.id || claim.concernVersion !== value.version
        || claim.reference !== firestoreBackgroundReference(job) || claim.generation !== b.generation || claim.authorizationVersion !== b.authorizationVersion) return null;
    }
    return value;
  }
  async function beginBackground(job: FirestoreBackgroundWork) {
    return authority.runTransaction(job.scope.ownerUserId, job.scope.childId, async b => {
      const value = await currentFollowup(b, job); if (!value) return null;
      const current = await hydrate(b, value);
      if (value.eventCount >= CONCERN_EVENT_LIMIT) {
        if (value.eventCount < CONCERN_STORED_EVENT_LIMIT - 1) {
          cancel(value); value.version++; value.updatedAt = new Date().toISOString(); value.eventCount++;
          const stopped = await save(b, value, [event(b, value.updatedAt, 'confirmed_action', '站內跟進因紀錄容量停止',
            '此關注已達日常紀錄上限，尚未完成的跟進已取消；仍可結束關注。', { sourceLabel: 'Server 站內跟進狀態' })], current.events, randomUUID()); stopped.commit();
        }
        return null;
      }
      if (value.followUp!.state === 'queued') return current;
      const reference = firestoreBackgroundReference(job), followup = value.followUp!;
      const claim = { id: followup.id, concernId: value.id, concernVersion: value.version + 1, jobId: job.id, reference,
        generation: b.generation, authorizationVersion: b.authorizationVersion };
      const ref = data.ref('concern_followups', 'concern-followup', followup.id);
      if ((await b.transaction.get(ref)).exists) domainReject('concern_binding', 500);
      value.version++; value.updatedAt = new Date().toISOString(); value.followUp = { ...followup, state: 'queued' };
      const prepared = await save(b, value, [], current.events, randomUUID());
      prepared.commit(); b.transaction.create(ref, { ...data.tags(b.scope), ...data.seal('concern-followup', followup.id, b.scope, followupClaimSchema, claim) });
      return prepared.value;
    });
  }
  async function finishBackground(job: FirestoreBackgroundWork) {
    return authority.runTransaction(job.scope.ownerUserId, job.scope.childId, async b => {
      const value = await currentFollowup(b, job); if (!value || value.followUp!.state !== 'queued') return { state: 'stopped' as const };
      const reference = firestoreBackgroundReference(job), key = JSON.stringify([b.scope.ownerUserId, b.scope.childId, 'worker', reference]);
      const claimRow = await b.transaction.get(data.ref('agent_claims', 'agent-claim', key));
      const claim = claimRow.exists ? data.open('agent-claim', key, b.scope, firestoreAgentClaimSchema, claimRow) : null;
      const runRow = claim ? await b.transaction.get(data.ref('agent_runs', 'agent-run', claim.runId)) : null;
      const run = runRow?.exists ? data.open('agent-run', claim!.runId, b.scope, firestoreAgentRunSchema, runRow) : null;
      if (run && (run.id !== claim!.runId || run.trigger.kind !== 'worker' || run.trigger.reference !== reference
        || run.childId !== b.scope.childId || run.ownerUserId !== b.scope.ownerUserId || run.authorizationVersion !== b.authorizationVersion)) domainReject('concern_receipt_mismatch', 500);
      if (run?.state === 'running' && Date.parse(run.expiresAt) > Date.now()) return { state: 'deferred' as const, nextAt: new Date(Date.parse(run.expiresAt) + 1000).toISOString() };
      const state: 'completed' | 'stopped' | 'unknown' = run?.result && run.state === 'completed' ? 'completed' : run?.result && run.state === 'stopped' ? 'stopped' : 'unknown';
      const current = await hydrate(b, value), now = new Date().toISOString();
      const added = run ? [event(b, now, 'confirmed_action', '站內跟進結果', {
        completed: '本次站內跟進已完成；本人可查看原 Agent 結果。', stopped: '本次站內跟進已停止；本人可查看原 Agent 收據。',
        unknown: '未能確認本次站內跟進結果；保留原操作，沒有自動重新執行。',
      }[state], { runId: run.id, sourceLabel: 'Agent 站內跟進收據' })] : [];
      if (added.length && value.eventCount >= CONCERN_STORED_EVENT_LIMIT - 1) domainReject('concern_history_requires_review', 400);
      value.version++; value.updatedAt = now; value.eventCount += added.length;
      value.followUp = { ...value.followUp!, state, runId: run?.id ?? null };
      const prepared = await save(b, value, added, current.events, randomUUID()); prepared.commit(); return { state };
    });
  }
  async function page(b: Binding) {
    const rows = await b.transaction.get(query(b, 'concerns').orderBy('createdAt').orderBy('concernId').limit(201));
    if (rows.size > 200) domainReject('concern_history_requires_review', 400);
    const items: Concern[] = [];
    for (const row of rows.docs) { const current = await head(b, row.get('concernId')); if (current) items.push(sharedView(b, await hydrate(b, current))); }
    return { authorityVersion: authorityVersion(b), items, canManage: !b.sharedAccess };
  }
  return { read, head, extension, prepareCreate, prepareChange, beginBackground, finishBackground,
    forSharedSpace(spaceId: string) {
      domainParse(uuid, spaceId);
      const unavailable = async (): Promise<never> => domainReject('shared_domain_read_only', 409);
      return {
        list:(u: string, c: string) => sharing.withResource(u, { spaceId, childId:c, module:'concerns', mode:'read' }, access => page(access.binding)),
        get:(u: string, c: string, id: string) => sharing.withResource(u, { spaceId, childId:c, module:'concerns', mode:'read' }, async access => {
          const value = await read(access.binding, id); return value ? sharedView(access.binding, value) : null;
        }),
        create:unavailable, change:unavailable,
      };
    },
    authorizeBackground: async (b: Binding, job: FirestoreBackgroundWork) => {
      const value = await currentFollowup(b, job); return !!value && value.followUp?.state === 'queued' && value.eventCount < CONCERN_EVENT_LIMIT;
    },
    list: (userId: string, childId: string) => authority.runTransaction(userId, childId, page),
    get: (userId: string, childId: string, id: string) => authority.runTransaction(userId, childId, b => read(b, id)),
    create: (userId: string, childId: string, values: ConcernValues, opId: string) =>
      operation(userId, childId, opId, { action: 'create', values }, b => prepareCreate(b, values, opId)),
    change: (userId: string, childId: string, id: string, change: ConcernChange, opId: string) =>
      operation(userId, childId, opId, { id, change }, b => prepareChange(b, id, change, opId)),
  };
}
export type FirestoreConcernStore = ReturnType<typeof createFirestoreConcernStore>;

/** Existing persisted formats, shared with isolated recovery. */
export const firestoreConcernRecoverySchemas = { receipt: receiptSchema, followup: followupClaimSchema };
