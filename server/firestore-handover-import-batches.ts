import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { historyModule } from './handover-history-records.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { createFirestoreSharingStore } from './firestore-sharing.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { createFirestoreHandoverImportItems } from './firestore-handover-import-items.ts';
import { prepareFirestoreBackgroundWork, firestoreBackgroundWorkSchema, firestoreBackgroundReference, type FirestoreBackgroundWork } from './firestore-background-work.ts';
import { importBatchRequestSchema, importBatchSchema, importBatchControlSchema, importBatchId, importBatchControlId,
  importBatchMetadata, importBatchControlMetadata, validImportBatch, type HandoverImportBatch as Batch,
  type HandoverImportBatchControl, type HandoverImportBatchRequest } from './handover-import-batch-records.ts';
import type { HandoverImportRow } from './handover-import.ts';
import type { WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';

const NIL = '00000000-0000-0000-0000-000000000000';
const controlSchema = z.object({ opId: z.uuid(), expectedVersion: z.number().int().positive().max(2147483646) }).strict();
const stepSchema = z.object({ position: z.number().int().nonnegative(), cursor: z.string().min(1).max(16384).nullable(),
  nextCursor: z.string().min(1).max(16384).nullable() }).strict();
const actorScope = (b: Binding): WorkRecoveryScope => ({ ...b.scope, childId: NIL });

/** Internal verified-package coordinator. Public clients never supply verified rows, counts or worker leases. */
export function createFirestoreHandoverImportBatches(options: FirestoreDomainOptions & { serverClock?: () => number;
  sourceGuard?: (b: Binding, request: HandoverImportBatchRequest) => Promise<() => void> }) {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options), sharing = createFirestoreSharingStore(options);
  const items = createFirestoreHandoverImportItems(options), clock = options.serverClock ?? Date.now;
  const at = () => new Date(clock()).toISOString();
  const ref = (owner: string, id: string) => data.ref('handover_import_batches', 'handover-import-batch', importBatchId(owner, id));
  async function read(b: Binding, id: string) {
    domainParse(z.uuid(), id);
    const scope = actorScope(b), snapshot = await b.transaction.get(ref(b.actorUserId, id));
    if (!snapshot.exists) domainReject('import_batch_not_found', 404);
    const job = data.open('handover-import-batch', importBatchId(b.actorUserId, id), scope, importBatchSchema, snapshot);
    if (!validImportBatch(job) || job.id !== id || job.version !== snapshot.get('recordVersion') || job.scope.ownerUserId !== b.actorUserId
      || firestoreDomainHash(job.scope) !== firestoreDomainHash(scope)) domainReject('import_batch_binding', 500);
    for (const [key, value] of Object.entries({ ...data.tags(scope), ...importBatchMetadata(job) }))
      if (snapshot.get(key) !== value) domainReject('import_batch_binding', 500);
    return job;
  }
  function prepareSave(b: Binding, raw: Batch) {
    const job = domainParse(importBatchSchema, raw, 'import_batch_binding', 500);
    if (!validImportBatch(job)) domainReject('import_batch_binding', 500);
    const envelope = { ...data.tags(job.scope), ...importBatchMetadata(job),
      ...data.seal('handover-import-batch', importBatchId(job.scope.ownerUserId, job.id), job.scope, importBatchSchema, job, job.version) };
    return () => b.transaction.set(ref(job.scope.ownerUserId, job.id), envelope);
  }
  async function targetScopes(b: Binding, request: HandoverImportBatchRequest) {
    const result: WorkRecoveryScope[] = [];
    for (const selected of request.targets) {
      let scope: WorkRecoveryScope | undefined;
      for (const module of selected.sections) {
        if (selected.target.spaceId) await sharing.inResourceTransaction(b, { ...selected.target, spaceId: selected.target.spaceId, module, mode: 'write' },
          async access => { scope = access.scope; });
        else { if (!await b.readChild(selected.target.childId)) domainReject('forbidden', 403); scope = { ...actorScope(b), childId: selected.target.childId }; }
      }
      result.push(scope!);
    }
    return result;
  }
  const basis = (job: Batch) => `${job.fingerprint}:${job.execution}`;
  const enqueue = (b: Binding, job: Batch) => prepareFirestoreBackgroundWork(data, b.transaction, { kind: 'handover-import',
    scope: job.scope, resourceId: job.id, basis: basis(job), generation: b.generation, authorizationVersion: b.authorizationVersion }, at());
  async function held(b: Binding, work: FirestoreBackgroundWork, job: Batch) {
    if (work.kind !== 'handover-import' || !work.lease || work.resourceId !== job.id
      || firestoreDomainHash(work.scope) !== firestoreDomainHash(job.scope) || work.basis !== basis(job)) domainReject('import_claim_invalid');
    const snapshot = await b.transaction.get(data.ref('background_work', 'background-work', work.id));
    if (!snapshot.exists) domainReject('import_claim_invalid');
    const live = data.open('background-work', work.id, job.scope, firestoreBackgroundWorkSchema, snapshot);
    if (live.id !== work.id || live.kind !== work.kind || live.resourceId !== job.id || live.basis !== basis(job)
      || firestoreDomainHash(live.scope) !== firestoreDomainHash(job.scope) || live.generation !== b.generation || live.generation !== job.generation
      || live.authorizationVersion !== b.authorizationVersion || live.authorizationVersion !== job.authorizationVersion || live.state !== 'leased'
      || live.lease?.token !== work.lease.token || live.lease?.until !== work.lease.until) domainReject('import_claim_invalid');
    const assertCurrentLease = () => { if (Date.parse(live.lease!.until) <= clock()) domainReject('import_claim_invalid'); };
    assertCurrentLease(); return assertCurrentLease;
  }
  function event(b: Binding, job: Batch, opId: string, action: HandoverImportBatchControl['action'], fingerprint: string) {
    const value = importBatchControlSchema.parse({ opId, batchId: job.id, actorUserId: b.actorUserId, action, fingerprint,
      at: at(), version: job.version, position: job.position, state: job.state, counts: job.counts, error: job.error });
    const identity = importBatchControlId(b.actorUserId, opId), envelope = { ...data.tags(job.scope), ...importBatchControlMetadata(value),
      ...data.seal('handover-import-control', identity, job.scope, importBatchControlSchema, value) };
    return () => b.transaction.create(data.ref('handover_import_controls', 'handover-import-control', identity), envelope);
  }
  async function repeatedControl(b: Binding, job: Batch, opId: string, fingerprint: string) {
    const identity = importBatchControlId(b.actorUserId, opId);
    const snapshot = await b.transaction.get(data.ref('handover_import_controls', 'handover-import-control', identity));
    if (!snapshot.exists) return false;
    const prior = data.open('handover-import-control', identity, b.scope, importBatchControlSchema, snapshot);
    if (prior.fingerprint !== fingerprint || prior.actorUserId !== b.actorUserId || prior.batchId !== job.id) domainReject('operation_conflict');
    return true;
  }
  async function control(owner: string, id: string, raw: unknown, action: 'cancel' | 'resume') {
    const input = domainParse(controlSchema, raw), fingerprint = firestoreDomainHash({ id, action, input });
    return authority.runTransaction(owner, null, async b => {
      const job = await read(b, id);
      if (await repeatedControl(b, job, input.opId, fingerprint)) return job;
      if (job.version !== input.expectedVersion) domainReject('version_conflict');
      if (action === 'cancel' ? !['queued', 'running'].includes(job.state) : !['cancelled', 'failed'].includes(job.state)) domainReject('import_batch_stopped');
      const scopes = action === 'resume' ? await targetScopes(b, job.request) : job.targetScopes;
      if (firestoreDomainHash(scopes) !== firestoreDomainHash(job.targetScopes)) domainReject('import_target_changed');
      const next: Batch = { ...job, version: job.version + 1, updatedAt: at(), claim: null, error: null,
        state: action === 'cancel' ? 'cancelled' : 'queued', execution: job.execution + (action === 'resume' ? 1 : 0),
        authorizationVersion: b.authorizationVersion, generation: b.generation };
      const work = action === 'resume' ? await enqueue(b, next) : null;
      const save = prepareSave(b, next), audit = event(b, next, input.opId, action, fingerprint);
      save(); audit(); work?.commit(); return next;
    });
  }
  return {
    async create(owner: string, raw: unknown, preflightError?: string) {
      const request = domainParse(importBatchRequestSchema, raw), fingerprint = firestoreDomainHash(request);
      if (preflightError) domainParse(z.string().regex(/^[a-z][a-z0-9_]{0,79}$/u), preflightError);
      return authority.runTransaction(owner, null, async b => {
        if ((await b.transaction.get(ref(owner, request.opId))).exists) {
          const prior = await read(b, request.opId); if (prior.fingerprint !== fingerprint) domainReject('operation_conflict'); return prior;
        }
        const scopes = await targetScopes(b, request), assertSource = await options.sourceGuard?.(b, request);
        const job: Batch = { id: request.opId, version: 1, request, fingerprint, scope: b.scope, targetScopes: scopes,
          createdAt: at(), updatedAt: at(), state: preflightError ? 'failed' : request.totalItems === 0 ? 'completed' : 'queued',
          generation: b.generation, authorizationVersion: b.authorizationVersion, execution: 1,
          position: 0, cursor: null, counts: { created: 0, updated: 0, skipped: 0, conflict: 0 }, claim: null, error: preflightError ?? null };
        const work = job.state === 'queued' ? await enqueue(b, job) : null;
        const save = prepareSave(b, job); assertSource?.(); save(); work?.commit(); return job;
      });
    },
    get(owner: string, id: string) { return authority.runTransaction(owner, null, b => read(b, id)); },
    async replayControl(owner: string, id: string, raw: unknown, action: 'cancel' | 'resume') {
      const input = domainParse(controlSchema, raw), fingerprint = firestoreDomainHash({ id, action, input });
      return authority.runTransaction(owner, null, async b => {
        const job = await read(b, id); return await repeatedControl(b, job, input.opId, fingerprint) ? job : null;
      });
    },
    cancel: (owner: string, id: string, command: unknown) => control(owner, id, command, 'cancel'),
    resume: (owner: string, id: string, command: unknown) => control(owner, id, command, 'resume'),
    async claim(work: FirestoreBackgroundWork) {
      return authority.runTransaction(work.scope.ownerUserId, null, async b => {
        const job = await read(b, work.resourceId), assertCurrentLease = await held(b, work, job);
        if (!['queued', 'running'].includes(job.state)) return null;
        const next: Batch = { ...job, state: 'running', version: job.version + 1, updatedAt: at(),
          claim: { workId: work.id, token: work.lease!.token, until: work.lease!.until } };
        const save = prepareSave(b, next); assertCurrentLease(); save(); return next;
      });
    },
    async apply(work: FirestoreBackgroundWork, input: { position: number; cursor: string | null; nextCursor: string | null; row: HandoverImportRow }) {
      const step = domainParse(stepSchema, { position: input.position, cursor: input.cursor, nextCursor: input.nextCursor });
      const owner = work.scope.ownerUserId, job = await authority.runTransaction(owner, null, b => read(b, work.resourceId));
      const index = job.request.targets.findIndex(target => target.sourceChildId === input.row.childId), selected = job.request.targets[index];
      if (!selected || !selected.sections.includes((historyModule(input.row.section) ?? input.row.section) as any)) domainReject('invalid_package_scope', 400);
      const { path, rowIndex, ...source } = input.row.source;
      if (firestoreDomainHash(source) !== firestoreDomainHash(job.request.source)) domainReject('invalid_package_scope', 400);
      const opId = firestoreBackgroundReference({ id: firestoreDomainHash(['handover-import-row', owner, job.id, path, rowIndex]) });
      const resolution = job.request.resolutions.find(row => row.sourceChildId === input.row.childId && row.section === input.row.section
        && row.resourceId === (input.row.value.id ?? input.row.value.childId))?.resolution ?? { mode: 'preserve' as const };
      let committed: Batch | undefined;
      const item = await items.apply(owner, { opId, batchId: job.id, target: selected.target, row: input.row,
        integrity: job.request.integrity, resolution }, async (actor, target) => {
        const latest = await read(actor, job.id), assertCurrentLease = await held(actor, work, latest);
        const assertSource = await options.sourceGuard?.(actor, latest.request);
        if (latest.state !== 'running' || !latest.claim || latest.claim.token !== work.lease?.token || latest.claim.workId !== work.id) domainReject('import_batch_stopped');
        if (latest.fingerprint !== job.fingerprint || firestoreDomainHash(target.scope) !== firestoreDomainHash(latest.targetScopes[index])) domainReject('import_target_changed');
        if (latest.position !== step.position || latest.cursor !== step.cursor) domainReject('import_cursor_changed');
        const position = latest.position + 1, completed = position === latest.request.totalItems;
        if (position > latest.request.totalItems || completed !== (step.nextCursor === null)) domainReject('import_coverage_changed');
        return (result, repeated) => {
          // A prior row receipt implies its progress committed too; never count a replay at another position.
          if (repeated) domainReject('import_cursor_changed');
          // Domain preparation awaited reads after held(); reject expiration before any domain write.
          assertCurrentLease(); assertSource?.();
          const next: Batch = { ...latest, version: latest.version + 1, position, cursor: step.nextCursor, updatedAt: at(),
            state: completed ? 'completed' : 'running', claim: completed ? null : latest.claim,
            counts: { ...latest.counts, [result.outcome]: latest.counts[result.outcome] + 1 } };
          const save = prepareSave(actor, next);
          return () => { save(); committed = next; };
        };
      });
      return { item, batch: committed! };
    },
    async fail(work: FirestoreBackgroundWork, code: string) {
      domainParse(z.string().regex(/^[a-z][a-z0-9_]{0,79}$/u), code);
      return authority.runTransaction(work.scope.ownerUserId, null, async b => {
        const job = await read(b, work.resourceId), assertCurrentLease = await held(b, work, job);
        if (job.state !== 'running' || job.claim?.token !== work.lease?.token) domainReject('import_batch_stopped');
        const next: Batch = { ...job, version: job.version + 1, state: 'failed', claim: null, error: code, updatedAt: at() };
        const save = prepareSave(b, next), audit = event(b, next, randomUUID(), 'fail', firestoreDomainHash([work.id, work.lease?.token, code]));
        assertCurrentLease(); save(); audit(); return next;
      });
    },
  };
}
