import { randomUUID } from 'node:crypto';
import { handoverImportModuleOf, handoverImportResourceSectionSchema, handoverImportSummarySchema } from '../src/shared/handover-imports.ts';
import { FieldPath, type DocumentSnapshot, type Query } from '@google-cloud/firestore';
import { z } from 'zod';
import { historyModule } from './handover-history-records.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { assertConcernImportAccess } from './firestore-concerns.ts';
import { createFirestoreSharingStore } from './firestore-sharing.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, firestoreDomainUuid, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { createFirestoreHandoverImportItems } from './firestore-handover-import-items.ts';
import { prepareFirestoreBackgroundWork, firestoreBackgroundWorkSchema, firestoreBackgroundReference, type FirestoreBackgroundWork } from './firestore-background-work.ts';
import { importBatchRequestSchema, importBatchSchema, importBatchControlSchema, importBatchId, importBatchControlId, classImportSourceHash,
  importBatchMetadata, importBatchControlMetadata, validImportBatch, initialImportModuleCounts, importModuleCounts, type HandoverImportBatch as Batch,
  type HandoverImportBatchControl, type HandoverImportBatchRequest } from './handover-import-batch-records.ts';
import type { HandoverImportRow } from './handover-import.ts';
import { attachmentSupplementModule, type HandoverAttachmentPorts } from './firestore-handover-attachments.ts';
import type { WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';
import { openRecoveryEnvelope } from './firestore-recovery-envelope.ts';
import { growthImportSourceRow } from './firestore-growth.ts';
import type { FirestoreKnowledgeStore } from './firestore-knowledge.ts';
import type { AvatarState } from '../src/shared/avatars.ts';
import { avatarBinding } from './avatar-data.ts';
import { avatarPublicState } from './avatar-policy.ts';
import { createFirestoreAvatarData } from './firestore-avatar-data.ts';
import { selfAvatarDifference } from './handover-original-backup.ts';

const NIL = '00000000-0000-0000-0000-000000000000';
const controlSchema = z.object({ opId: z.uuid(), expectedVersion: z.number().int().positive().max(2147483646) }).strict();
const stepSchema = z.object({ position: z.number().int().nonnegative(), cursor: z.string().min(1).max(16384).nullable(),
  nextCursor: z.string().min(1).max(16384).nullable() }).strict();
const actorScope = (b: Binding): WorkRecoveryScope => ({ ...b.scope, childId: NIL });
const listCursorSchema = z.object({ scope: z.string().regex(/^[a-f0-9]{64}$/u), after: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();

/** Internal verified-package coordinator. Public clients never supply verified rows, counts or worker leases. */
export function createFirestoreHandoverImportBatches(options: FirestoreDomainOptions & { serverClock?: () => number;
  attachments?: HandoverAttachmentPorts; knowledge?: FirestoreKnowledgeStore;
  sourceGuard?: (b: Binding, request: HandoverImportBatchRequest) => Promise<() => void> }) {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options), sharing = createFirestoreSharingStore(options);
  const items = createFirestoreHandoverImportItems(options), clock = options.serverClock ?? Date.now;
  const avatarData = createFirestoreAvatarData(options);
  const at = () => new Date(clock()).toISOString();
  const ref = (owner: string, id: string) => data.ref('handover_import_batches', 'handover-import-batch', importBatchId(owner, id));
  async function read(b: Binding, id: string, existing?: DocumentSnapshot) {
    domainParse(z.uuid(), id);
    const scope = actorScope(b), snapshot = existing ?? await b.transaction.get(ref(b.actorUserId, id));
    if (!snapshot.exists) domainReject('import_batch_not_found', 404);
    const job = data.open('handover-import-batch', importBatchId(b.actorUserId, id), scope, importBatchSchema, snapshot);
    if (!validImportBatch(job) || job.id !== id || job.version !== snapshot.get('recordVersion') || job.scope.ownerUserId !== b.actorUserId
      || firestoreDomainHash(job.scope) !== firestoreDomainHash(scope)) domainReject('import_batch_binding', 500);
    for (const [key, value] of Object.entries({ ...data.tags(scope), ...importBatchMetadata(job) }))
      if (Array.isArray(value) ? firestoreDomainHash(snapshot.get(key)) !== firestoreDomainHash(value) : snapshot.get(key) !== value) domainReject('import_batch_binding', 500);
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
      const enrol = request.enrolSourceIds?.includes(selected.sourceChildId);
      for (const module of selected.sections) {
        if (selected.target.spaceId) {
          if (module === 'sources' || module === 'chat') domainReject('private_scope_unavailable', 403);
          if (module === 'growth') domainReject('shared_domain_read_only', 403);
          if (enrol) continue;
          await sharing.inResourceTransaction(b, { ...selected.target, spaceId: selected.target.spaceId, module, mode: 'write' },
            async access => { if (module === 'concerns') assertConcernImportAccess(access.binding); scope = access.scope; });
        }
        else { if (!await b.readChild(selected.target.childId)) domainReject('forbidden', 403); scope = { ...actorScope(b), childId: selected.target.childId }; }
      }
      if (enrol) scope = await sharing.plannedClassImportScope(b, selected.target.spaceId!, selected.target.childId);
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
      at: at(), version: job.version, position: job.position, state: job.state, counts: job.counts, error: job.error,
      ...(job.failedEnrolment ? { failedEnrolment: job.failedEnrolment.sourceChildId } : {}) });
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
      delete next.failedEnrolment;
      const work = action === 'resume' ? await enqueue(b, next) : null;
      const save = prepareSave(b, next), audit = event(b, next, input.opId, action, fingerprint);
      save(); audit(); work?.commit(); return next;
    });
  }
  return {
    async list(owner: string, cursor?: string) {
      let previous: z.infer<typeof listCursorSchema> | undefined;
      if (cursor !== undefined) {
        if (cursor.length > 2048) domainReject('invalid_cursor', 400);
        try { previous = listCursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))); }
        catch { domainReject('invalid_cursor', 400); }
      }
      return authority.runTransaction(owner, null, async b => {
        const scope = actorScope(b), scopeHash = firestoreDomainHash(scope);
        if (previous && previous.scope !== scopeHash) domainReject('invalid_cursor', 400);
        let query: Query = data.collection('handover_import_batches');
        for (const [key, value] of Object.entries(data.tags(scope))) query = query.where(key, '==', value);
        query = query.orderBy(FieldPath.documentId()).limit(21);
        if (previous) query = query.startAfter(previous.after);
        const rows = (await b.transaction.get(query)).docs, page = rows.slice(0, 20);
        const listed = await Promise.all(page.map(async row => {
          const raw = row.data(), context = openRecoveryEnvelope({ ...options, locator: raw.recovery,
            envelope: { family: 'domain', version: raw.version, recordVersion: raw.recordVersion, ciphertext: raw.ciphertext } }).context;
          if (context.family !== 'domain' || context.kind !== 'handover-import-batch' || firestoreDomainHash(context.scope) !== scopeHash)
            domainReject('import_batch_binding', 500);
          let identity: [string, string];
          try { identity = domainParse(z.tuple([z.literal(owner), z.uuid()]), JSON.parse(context.id), 'import_batch_binding', 500); }
          catch { domainReject('import_batch_binding', 500); }
          const expected = ref(owner, identity[1]);
          if (row.id !== expected.id || row.ref.path !== expected.path) domainReject('import_batch_binding', 500);
          return read(b, identity[1], row);
        }));
        return { items: listed, nextCursor: rows.length > 20
          ? Buffer.from(JSON.stringify({ scope: scopeHash, after: page.at(-1)!.id })).toString('base64url') : null };
      });
    },
    async create(owner: string, raw: unknown, preflightError?: string) {
      const request = domainParse(importBatchRequestSchema, raw), fingerprint = firestoreDomainHash(request);
      if (preflightError) domainParse(z.string().regex(/^[a-z][a-z0-9_]{0,79}$/u), preflightError);
      return authority.runTransaction(owner, null, async b => {
        if ((await b.transaction.get(ref(owner, request.opId))).exists) {
          const prior = await read(b, request.opId); if (prior.fingerprint !== fingerprint) domainReject('operation_conflict'); return prior;
        }
        const scopes = await targetScopes(b, request), assertSource = await options.sourceGuard?.(b, request);
        const job: Batch = { id: request.opId, version: 1, request, fingerprint, scope: b.scope, targetScopes: scopes,
          createdAt: at(), updatedAt: at(), state: preflightError ? 'failed' : request.totalItems === 0 && !request.enrolSourceIds ? 'completed' : 'queued',
          generation: b.generation, authorizationVersion: b.authorizationVersion, execution: 1,
          position: 0, cursor: null, counts: { created: 0, updated: 0, skipped: 0, conflict: 0 },
          moduleCounts: initialImportModuleCounts(request), claim: null, error: preflightError ?? null };
        const work = job.state === 'queued' ? await enqueue(b, job) : null;
        const save = prepareSave(b, job); assertSource?.(); save(); work?.commit(); return job;
      });
    },
    get(owner: string, id: string) { return authority.runTransaction(owner, null, b => read(b, id)); },
    summary(owner: string, id: string, includeAccount = false) {
      return authority.runTransaction(owner, null, async b => {
        const job = await read(b, id);
        for (const [i, selected] of job.request.targets.entries()) {
          const expected = job.targetScopes[i];
          if (!selected.target.spaceId) {
            if (!await b.readChild(selected.target.childId)) domainReject('forbidden', 403);
            if (firestoreDomainHash({ ...b.scope, childId: selected.target.childId }) !== firestoreDomainHash(expected)) domainReject('import_target_changed');
          } else for (const module of selected.sections) {
            if (module === 'sources' || module === 'chat') domainReject('private_scope_unavailable', 403);
            await sharing.inResourceTransaction(b, { ...selected.target, spaceId: selected.target.spaceId, module, mode: 'read' }, async access => {
              if (firestoreDomainHash(access.scope) !== firestoreDomainHash(expected)) domainReject('import_target_changed');
            });
          }
        }
        return handoverImportSummarySchema.parse({ batchId: job.id, state: job.state, processedItems: job.position,
          totalItems: job.request.totalItems, modules: importModuleCounts(job),
          ...(includeAccount && job.request.accountAvatar ? { accountAvatar: { result: job.accountAvatarResult ?? null } } : {}) });
      });
    },
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
    async applySelfAvatar(work: FirestoreBackgroundWork, backup: { head: Pick<AvatarState, 'version' | 'target' | 'asset'>; content: Buffer | null }, signal: AbortSignal) {
      const port = options.attachments?.avatars;
      if (!port) domainReject('package_section_not_connected', 503);
      const owner = work.scope.ownerUserId;
      const sourceHash = firestoreDomainHash(backup.head);
      const stage = { batchId: work.resourceId, operationId: firestoreDomainUuid(['restore-self-avatar', owner, work.resourceId]),
        actorUserId: owner, sourceHash };
      const ids = { uploadId: stage.operationId, assetId: firestoreDomainUuid(['restored-self-asset', stage.operationId]) };
      const transact = (phase: 'reserve' | 'publish' | 'check_conflict') => authority.runTransaction(owner, null, async b => {
        const job = await read(b, work.resourceId), selected = job.request.accountAvatar;
        if (!selected || !job.request.restoreOriginal || job.request.source.accountId !== b.actorUserId
          || backup.head.target.kind !== 'self') domainReject('invalid_package_scope', 403);
        const lease = await held(b, work, job), source = await options.sourceGuard?.(b, job.request);
        if (job.state !== 'running' || job.claim?.token !== work.lease?.token || job.claim?.workId !== work.id)
          domainReject('import_batch_stopped');
        if (job.accountAvatarResult) return job;
        if (job.position !== 0 || job.cursor !== null) domainReject('import_cursor_changed');
        const current = avatarPublicState(await avatarData.head(b, avatarBinding(b.scope, { kind: 'self' })), false);
        const difference = selfAvatarDifference(backup.head, current);
        const fence = () => { signal.throwIfAborted(); lease(); source?.(); };
        let result: NonNullable<Batch['accountAvatarResult']>;
        let publish: (() => void) | undefined;
        const observed = { backupVersion: backup.head.version, localVersion: current.version, assetId: current.asset?.id ?? null };
        if (current.version !== selected.expectedVersion) {
          result = { ...observed, outcome: 'conflict', reason: 'version_conflict' };
        } else if (difference === 'empty_backup' || difference === 'unchanged') {
          result = { ...observed, outcome: 'skipped', reason: difference };
        } else if ((difference === 'deleted') !== (selected.mode === 'restore_deleted')) {
          result = { ...observed, outcome: 'conflict', reason: 'decision_changed' };
        } else {
          const asset = backup.head.asset;
          if (!asset || !backup.content) domainReject('invalid_package_attachment_metadata', 400);
          if (phase === 'check_conflict') domainReject('avatar_version_conflict');
          if (phase === 'reserve') {
            const plan = await port.store.prepareSelfRestoreReservation(b, { expectedVersion: current.version,
              policyId: port.policy.policyId, mimeType: asset.mimeType, bytes: asset.bytes, sha256: asset.sha256,
              crop: { centerX: 0.5, centerY: 0.5, zoom: 1 } }, ids, stage);
            fence(); plan.commit(); return null;
          }
          const plan = await port.store.prepareSelfRestorePublication(b, ids.uploadId, stage);
          if (plan.value.asset?.sha256 !== asset.sha256) domainReject('avatar_integrity_failed', 503);
          result = { ...observed, outcome: current.asset ? 'updated' : 'created', reason: null,
            localVersion: plan.value.version, assetId: plan.value.asset.id };
          publish = plan.commit;
        }
        const complete = job.request.totalItems === 1;
        const next: Batch = { ...job, version: job.version + 1, updatedAt: at(), accountAvatarResult: result, position: 1,
          counts: { ...job.counts, [result.outcome]: job.counts[result.outcome] + 1 },
          state: complete ? 'completed' : 'running', claim: complete ? null : job.claim,
          cursor: complete ? null : JSON.stringify({ target: 0, phase: 'current', page: null }) };
        const save = prepareSave(b, next);
        fence(); publish?.(); save(); return next;
      });
      const first = await transact('reserve');
      if (first) return first;
      let phase: 'publish' | 'check_conflict' = 'publish';
      try {
        const uploaded = await port.store.uploadSelfRestore(owner, ids.uploadId, backup.content!, backup.head.asset!, stage, signal);
        if (uploaded.state === 'rejected' && uploaded.errorCode === 'avatar_version_conflict') phase = 'check_conflict';
        else if (uploaded.state !== 'ready' && uploaded.state !== 'committed') domainReject(uploaded.errorCode ?? 'avatar_upload_not_ready');
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'avatar_version_conflict')) throw error;
        phase = 'check_conflict';
      }
      const settled = await transact(phase);
      if (!settled) domainReject('import_cursor_changed');
      return settled;
    },
    async enrol(work: FirestoreBackgroundWork, sourceChildId: string, displayName: string, signal: AbortSignal) {
      return authority.runTransaction(work.scope.ownerUserId, null, async b => {
        const job = await read(b, work.resourceId), assertLease = await held(b, work, job);
        if (job.state !== 'running' || job.claim?.token !== work.lease?.token || job.claim?.workId !== work.id)
          domainReject('import_batch_stopped');
        const done = job.enrolments ?? [], ids = job.request.enrolSourceIds;
        if (!ids || ids[done.length] !== sourceChildId || job.position !== 0) domainReject('import_cursor_changed');
        const assertSource = await options.sourceGuard?.(b, job.request);
        const index = job.request.targets.findIndex(target => target.sourceChildId === sourceChildId);
        const scope = job.targetScopes[index];
        if (!scope) domainReject('invalid_package_scope', 400);
        const operationId = firestoreBackgroundReference({ id: firestoreDomainHash(['enrol', job.id, sourceChildId]) });
        const prepared = await sharing.prepareClassImportEnrolment(b, scope, { operationId, displayName,
          sourceHash: classImportSourceHash(job.request.source, sourceChildId) });
        const completed = done.length + 1 === ids.length && job.request.totalItems === 0, timestamp = at();
        const next: Batch = { ...job, version: job.version + 1, updatedAt: timestamp, state: completed ? 'completed' : 'running',
          claim: completed ? null : job.claim, enrolments: [...done, { sourceChildId, at: timestamp, outcome: prepared.outcome }] };
        const save = prepareSave(b, next);
        assertLease(); assertSource?.(); signal.throwIfAborted();
        for (const write of prepared.writes) write();
        save(); return next;
      });
    },
    async apply(work: FirestoreBackgroundWork, input: { position: number; cursor: string | null; nextCursor: string | null; row: HandoverImportRow;
      documentContent?: import('./family-document-transfer.ts').DocumentTransferContent | null;
      concernEvents?: unknown[];
      attachmentContent?: import('./handover-import.ts').HandoverAttachmentContent | null }, signal?: AbortSignal) {
      const step = domainParse(stepSchema, { position: input.position, cursor: input.cursor, nextCursor: input.nextCursor });
      const owner = work.scope.ownerUserId, job = await authority.runTransaction(owner, null, b => read(b, work.resourceId));
      const index = job.request.targets.findIndex(target => target.sourceChildId === input.row.childId), selected = job.request.targets[index];
      const resourceSection = domainParse(handoverImportResourceSectionSchema, historyModule(input.row.section) ?? attachmentSupplementModule(input.row.section) ?? input.row.section, 'invalid_package_scope', 400);
      if (!selected || !selected.sections.includes(handoverImportModuleOf(resourceSection))) domainReject('invalid_package_scope', 400);
      const { path, rowIndex, ...source } = input.row.source;
      if (firestoreDomainHash(source) !== firestoreDomainHash(job.request.source)) domainReject('invalid_package_scope', 400);
      const opId = firestoreBackgroundReference({ id: firestoreDomainHash(['handover-import-row', owner, job.id, path, rowIndex]) });
      const identity = input.row.section === 'growth_attention' || input.row.section === 'growth_topics' ? growthImportSourceRow(input.row).value : input.row.value;
      const resolution = job.request.resolutions.find(row => row.sourceChildId === input.row.childId && row.section === input.row.section
        && row.resourceId === (input.row.section === 'child_avatar' ? input.row.childId : identity.id ?? identity.childId))?.resolution ?? { mode: 'preserve' as const };
      let committed: Batch | undefined;
      const item = await items.apply(owner, { opId, batchId: job.id, target: selected.target, row: input.row,
        integrity: job.request.integrity, resolution, ...(job.request.restoreOriginal ? { restoreOriginal: true } : {}),
        ...(input.documentContent === undefined ? {} : { documentContent: input.documentContent }),
        ...(input.concernEvents === undefined ? {} : { concernEvents: input.concernEvents }),
        ...(input.attachmentContent === undefined ? {} : { attachmentContent: input.attachmentContent }) }, async (actor, target) => {
        const latest = await read(actor, job.id), assertCurrentLease = await held(actor, work, latest);
        const assertSource = await options.sourceGuard?.(actor, latest.request);
        if (latest.state !== 'running' || !latest.claim || latest.claim.token !== work.lease?.token || latest.claim.workId !== work.id) domainReject('import_batch_stopped');
        if (latest.fingerprint !== job.fingerprint || firestoreDomainHash(target.scope) !== firestoreDomainHash(latest.targetScopes[index])) domainReject('import_target_changed');
        if (latest.position !== step.position || latest.cursor !== step.cursor) domainReject('import_cursor_changed');
        const position = latest.position + 1, completed = position === latest.request.totalItems;
        if (position > latest.request.totalItems || completed !== (step.nextCursor === null)) domainReject('import_coverage_changed');
        const assertCurrent = () => { assertCurrentLease(); assertSource?.(); signal?.throwIfAborted(); };
        return { assertCurrent, sealProgress: (result, repeated) => {
          // A prior row receipt implies its progress committed too; never count a replay at another position.
          if (repeated) domainReject('import_cursor_changed');
          // Domain preparation awaited reads after held(); reject expiration before any domain write.
          assertCurrent();
          const mainSection = handoverImportResourceSectionSchema.safeParse(input.row.section);
          const module = mainSection.success && input.row.value.format !== 'yuyoufang-source-revision:1'
            ? handoverImportModuleOf(mainSection.data) : null;
          const moduleCounts = importModuleCounts(latest)?.map(row => row.module === module
            ? { ...row, [result.outcome]: row[result.outcome] + 1 } : row) ?? null;
          const next: Batch = { ...latest, version: latest.version + 1, position, cursor: step.nextCursor, updatedAt: at(),
            state: completed ? 'completed' : 'running', claim: completed ? null : latest.claim,
            counts: { ...latest.counts, [result.outcome]: latest.counts[result.outcome] + 1 }, moduleCounts };
          const save = prepareSave(actor, next);
          return () => { save(); committed = next; };
        } };
      }, signal);
      return { item, batch: committed! };
    },
    async fail(work: FirestoreBackgroundWork, code: string, sourceChildId?: string) {
      domainParse(z.string().regex(/^[a-z][a-z0-9_]{0,79}$/u), code);
      return authority.runTransaction(work.scope.ownerUserId, null, async b => {
        const job = await read(b, work.resourceId), assertCurrentLease = await held(b, work, job);
        if (job.state !== 'running' || job.claim?.token !== work.lease?.token) domainReject('import_batch_stopped');
        const next: Batch = { ...job, version: job.version + 1, state: 'failed', claim: null, error: code, updatedAt: at() };
        if (sourceChildId && job.request.enrolSourceIds?.[job.enrolments?.length ?? 0] === sourceChildId)
          next.failedEnrolment = { sourceChildId, error: code };
        const save = prepareSave(b, next), audit = event(b, next, randomUUID(), 'fail', firestoreDomainHash([work.id, work.lease?.token, code]));
        assertCurrentLease(); save(); audit(); return next;
      });
    },
  };
}
