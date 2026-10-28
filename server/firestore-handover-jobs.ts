import { FieldPath, type DocumentSnapshot, type Query, type Transaction } from '@google-cloud/firestore';
import { z } from 'zod';
import { handoverCancelCommandSchema, handoverExportCommandSchema, handoverExportStateSchema,
  handoverExportViewSchema, type HandoverExportView } from '../src/shared/handover-jobs.ts';
import { handoverObjectDescriptorSchema } from './firebase-handover-objects.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { prepareFirestoreBackgroundWork, firestoreBackgroundWorkSchema, type FirestoreBackgroundWork } from './firestore-background-work.ts';
import { workRecoveryScopeSchema, type WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';
import { openRecoveryEnvelope } from './firestore-recovery-envelope.ts';
import { createFirestoreAvatarData } from './firestore-avatar-data.ts';
import { avatarBinding } from './avatar-data.ts';
import { avatarPublicState } from './avatar-policy.ts';

const hash = z.string().regex(/^[a-f0-9]{64}$/u), time = z.iso.datetime({ offset: true });
export const HANDOVER_EXPORT_RETENTION_MS = 24 * 60 * 60_000;
export const handoverArtifactContentSchema = z.object({ bytes: z.number().int().positive().max(256 * 1024 * 1024),
  sha256: hash, manifestSha256: hash }).strict();
export const firestoreHandoverJobSchema = z.object({ id: z.uuid(), version: z.number().int().positive(),
  scope: workRecoveryScopeSchema, objectScope: workRecoveryScopeSchema, request: handoverExportCommandSchema, fingerprint: hash,
  sourceVersion: hash, avatarBasis: hash.nullable(), authorizationVersion: z.string().min(1).max(256), generation: z.uuid(),
  state: handoverExportStateSchema, createdAt: time, expiresAt: time, error: z.string().max(100).nullable(),
  content: handoverArtifactContentSchema.nullable(), artifact: handoverObjectDescriptorSchema.nullable(),
  uploadStarted: z.boolean(), cleaned: z.boolean(),
  claim: z.object({ workId: hash, token: z.uuid(), until: time }).strict().nullable(),
  cancellation: handoverCancelCommandSchema.nullable(),
}).strict();
export type FirestoreHandoverJob = z.infer<typeof firestoreHandoverJobSchema>;
export function handoverJobIncludesScope(job: FirestoreHandoverJob, scope: WorkRecoveryScope) {
  return job.scope.ownerUserId === scope.ownerUserId && job.scope.workspaceId === scope.workspaceId
    && job.request.selection.childIds.includes(scope.childId);
}
export const handoverJobId = (ownerUserId: string, id: string) => JSON.stringify([ownerUserId, id]);
export function handoverSourceVersion(b: FirestoreAuthorityTransaction) {
  return firestoreDomainHash([b.scope.ownerUserId, b.scope.workspaceId, b.scope.storageEpoch, b.authorizationVersion, b.changeSeq]);
}
export function handoverJobMetadata(data: FirestoreDomainData, job: FirestoreHandoverJob) {
  return { ...data.tags(job.scope), createdAt: job.createdAt, expiresAt: job.expiresAt, state: job.state, cleaned: job.cleaned };
}
export function assertHandoverJobIdentity(job: FirestoreHandoverJob, scope: WorkRecoveryScope, id: string, version: number) {
  if (job.request.opId !== job.id || handoverJobId(scope.ownerUserId, job.id) !== id || job.version !== version
    || firestoreDomainHash(job.scope) !== firestoreDomainHash(scope) || job.fingerprint !== firestoreDomainHash(job.request)
    || firestoreDomainHash(job.objectScope) !== firestoreDomainHash(job.scope)
    || job.state === 'ready' && (!job.content || !job.artifact || !job.uploadStarted || job.cleaned)
    || job.artifact && (!job.content || job.content.sha256 !== job.artifact.sha256 || job.content.bytes !== job.artifact.bytes))
    domainReject('package_job_binding', 500);
}

/** Persistent identity and status only; model/ZIP/Storage calls never run in these transactions. */
export function createFirestoreHandoverJobs(options: FirestoreDomainOptions & { serverClock?: () => number }) {
  const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options), clock = options.serverClock ?? Date.now;
  const avatarData = createFirestoreAvatarData(options);
  const ref = (owner: string, id: string) => data.ref('handover_exports', 'handover-export', handoverJobId(owner, id));
  function open(scope: WorkRecoveryScope, id: string, snapshot: DocumentSnapshot): FirestoreHandoverJob | null {
    if (!snapshot.exists) return null;
    const identity = handoverJobId(scope.ownerUserId, id);
    const job = data.open('handover-export', identity, scope, firestoreHandoverJobSchema, snapshot);
    assertHandoverJobIdentity(job, scope, identity, snapshot.data()!.recordVersion);
    const metadata = handoverJobMetadata(data, job), raw = snapshot.data()!;
    for (const [key, value] of Object.entries(metadata)) if (raw[key] !== value) domainReject('package_job_binding', 500);
    return job;
  }
  function save(tx: Transaction, job: FirestoreHandoverJob) {
    const checked = domainParse(firestoreHandoverJobSchema, job, 'package_job_binding', 500);
    const identity = handoverJobId(job.scope.ownerUserId, job.id);
    assertHandoverJobIdentity(checked, job.scope, identity, job.version);
    tx.set(ref(job.scope.ownerUserId, job.id), { ...handoverJobMetadata(data, checked),
      ...data.seal('handover-export', identity, job.scope, firestoreHandoverJobSchema, checked, checked.version) });
  }
  async function readIn(b: FirestoreAuthorityTransaction, id: string) {
    domainParse(z.uuid(), id);
    const job = openOwned(b, id, await b.transaction.get(ref(b.scope.ownerUserId, id)));
    if (!job) domainReject('package_job_not_found', 404);
    return job;
  }
  function openOwned(b: FirestoreAuthorityTransaction, id: string, snapshot: DocumentSnapshot) {
    if (!snapshot.exists) return null;
    const raw = snapshot.data()!, context = openRecoveryEnvelope({ ...options, locator: raw.recovery,
      envelope: { family: 'domain', version: raw.version, recordVersion: raw.recordVersion, ciphertext: raw.ciphertext } }).context;
    if (context.kind !== 'handover-export' || context.id !== handoverJobId(b.scope.ownerUserId, id)
      || context.scope.ownerUserId !== b.scope.ownerUserId || context.scope.workspaceId !== b.scope.workspaceId
      || context.scope.childId !== b.scope.childId) domainReject('package_job_binding', 500);
    const job = open(context.scope, id, snapshot)!;
    if (context.scope.storageEpoch !== b.scope.storageEpoch && !['expired', 'cancelled'].includes(job.state)) domainReject('package_restored');
    return job;
  }
  function view(job: FirestoreHandoverJob, b: FirestoreAuthorityTransaction): HandoverExportView {
    const expired = clock() >= Date.parse(job.expiresAt), sourceChanged = handoverSourceVersion(b) !== job.sourceVersion;
    const terminal = ['cancelled', 'failed', 'expired'].includes(job.state);
    const state = terminal ? job.state : expired ? 'expired' : sourceChanged ? 'failed' : job.state;
    return handoverExportViewSchema.parse({ id: job.id, version: job.version, purpose: job.request.purpose,
      selection: job.request.selection, state, createdAt: job.createdAt, expiresAt: job.expiresAt,
      bytes: state === 'ready' ? job.artifact?.bytes ?? null : null,
      error: terminal ? job.error : expired ? 'package_expired' : sourceChanged ? 'export_scope_changed' : job.error });
  }
  async function avatarBasis(b: FirestoreAuthorityTransaction, selection: FirestoreHandoverJob['request']['selection']) {
    if (!selection.modules.includes('attachments')) return null;
    const heads = [];
    for (const childId of selection.childIds) {
      const head = await avatarData.head(b, avatarBinding({ ...b.scope, childId }, { kind: 'child', childId }));
      const { canManage: _canManage, ...current } = avatarPublicState(head, false);
      heads.push([childId, current]);
    }
    return firestoreDomainHash(heads);
  }
  async function currentView(job: FirestoreHandoverJob, b: FirestoreAuthorityTransaction) {
    const result = view(job, b);
    if (!['queued', 'building', 'ready'].includes(result.state)) return result;
    if (await avatarBasis(b, job.request.selection) !== job.avatarBasis)
      return { ...result, state: 'failed' as const, bytes: null, error: 'export_scope_changed' };
    return result;
  }
  async function cleanupIntent(b: FirestoreAuthorityTransaction, job: FirestoreHandoverJob, dueAt: string, basis: string) {
    return prepareFirestoreBackgroundWork(data, b.transaction, { kind: 'handover-cleanup', scope: b.scope,
      resourceId: job.id, basis, generation: b.generation, authorizationVersion: b.authorizationVersion }, dueAt);
  }
  async function held(b: FirestoreAuthorityTransaction, work: FirestoreBackgroundWork, job: FirestoreHandoverJob) {
    if (work.kind !== 'handover-export' || !work.lease) domainReject('package_claim_invalid');
    const snapshot = await b.transaction.get(data.ref('background_work', 'background-work', work.id));
    if (!snapshot.exists || firestoreDomainHash(work.scope) !== firestoreDomainHash(b.scope)) domainReject('package_claim_invalid');
    const live = data.open('background-work', work.id, b.scope, firestoreBackgroundWorkSchema, snapshot);
    if (live.lease?.token !== work.lease.token || live.resourceId !== job.id || live.kind !== work.kind || live.basis !== job.sourceVersion
      || live.generation !== b.generation || live.authorizationVersion !== b.authorizationVersion || live.state !== 'leased'
      || live.lease?.until !== work.lease.until || Date.parse(live.lease.until) <= clock()) domainReject('package_claim_invalid');
  }
  async function active(work: FirestoreBackgroundWork, update: (job: FirestoreHandoverJob) => FirestoreHandoverJob) {
    return authority.runTransaction(work.scope.ownerUserId, null, async b => {
      const prior = await readIn(b, work.resourceId); await held(b, work, prior);
      if ((await currentView(prior, b)).state !== 'building' || prior.claim?.token !== work.lease?.token) domainReject('package_job_stopped');
      const next = update(prior); save(b.transaction, next); return next;
    });
  }
  return {
    async list(owner: string, cursor?: string) {
      const cursorSchema = z.object({ scope: hash, after: hash }).strict();
      let previous: z.infer<typeof cursorSchema> | undefined;
      if (cursor !== undefined) {
        if (cursor.length > 2048) domainReject('invalid_cursor', 400);
        try { previous = cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))); }
        catch { domainReject('invalid_cursor', 400); }
      }
      return authority.runTransaction(owner, null, async b => {
        const scope = firestoreDomainHash(b.scope);
        if (previous && previous.scope !== scope) domainReject('invalid_cursor', 400);
        let query: Query = data.collection('handover_exports');
        for (const [key, value] of Object.entries(data.tags(b.scope))) query = query.where(key, '==', value);
        query = query.orderBy(FieldPath.documentId()).limit(21);
        if (previous) query = query.startAfter(previous.after);
        const rows = (await b.transaction.get(query)).docs, page = rows.slice(0, 20);
        const items = await Promise.all(page.map(async row => {
          const raw = row.data(), context = openRecoveryEnvelope({ ...options, locator: raw.recovery,
            envelope: { family: 'domain', version: raw.version, recordVersion: raw.recordVersion, ciphertext: raw.ciphertext } }).context;
          if (context.kind !== 'handover-export' || firestoreDomainHash(context.scope) !== scope) domainReject('package_job_binding', 500);
          const identity = domainParse(z.tuple([z.literal(owner), z.uuid()]), JSON.parse(context.id), 'package_job_binding', 500);
          if (row.id !== ref(owner, identity[1]).id) domainReject('package_job_binding', 500);
          return currentView(open(b.scope, identity[1], row)!, b);
        }));
        return { items, nextCursor: rows.length > 20 ? Buffer.from(JSON.stringify({ scope, after: page.at(-1)!.id })).toString('base64url') : null };
      });
    },
    async create(owner: string, raw: unknown) {
      const command = domainParse(handoverExportCommandSchema, raw), fingerprint = firestoreDomainHash(command);
      if (command.selection.period) domainReject('package_period_not_connected', 400);
      return authority.runTransaction(owner, null, async b => {
        const prior = openOwned(b, command.opId, await b.transaction.get(ref(owner, command.opId)));
        if (prior) { if (prior.fingerprint !== fingerprint) domainReject('operation_conflict'); return currentView(prior, b); }
        for (const childId of command.selection.childIds) if (!await b.readChild(childId)) domainReject('forbidden', 403);
        const createdAt = new Date(clock()).toISOString(), expiresAt = new Date(clock() + HANDOVER_EXPORT_RETENTION_MS).toISOString();
        const job: FirestoreHandoverJob = { id: command.opId, version: 1, scope: b.scope, objectScope: b.scope, request: command, fingerprint,
          sourceVersion: handoverSourceVersion(b), avatarBasis: await avatarBasis(b, command.selection), authorizationVersion: b.authorizationVersion, generation: b.generation,
          state: 'queued', createdAt, expiresAt, error: null, content: null, artifact: null, uploadStarted: false, cleaned: false, claim: null, cancellation: null };
        const work = await prepareFirestoreBackgroundWork(data, b.transaction, { kind: 'handover-export', scope: b.scope,
          resourceId: job.id, basis: job.sourceVersion, generation: b.generation, authorizationVersion: b.authorizationVersion }, createdAt);
        const cleanup = await cleanupIntent(b, job, expiresAt, 'expiry');
        save(b.transaction, job); work.commit(); cleanup.commit(); return view(job, b);
      });
    },
    async get(owner: string, id: string) { return authority.runTransaction(owner, null, async b => currentView(await readIn(b, id), b)); },
    async reconcilable(owner: string, id: string) {
      return authority.runTransaction(owner, null, async b => {
        const job = await readIn(b, id), result = await currentView(job, b);
        if (result.error === 'export_scope_changed' || ['cancelled', 'expired'].includes(result.state)) domainReject(result.error ?? 'package_job_stopped');
        return job;
      });
    },
    async reconciled(owner: string, previous: FirestoreHandoverJob, artifact: unknown) {
      const descriptor = domainParse(handoverObjectDescriptorSchema, artifact);
      return authority.runTransaction(owner, null, async b => {
        const job = await readIn(b, previous.id), result = await currentView({ ...job, state: job.state === 'failed' ? 'building' : job.state }, b);
        if (job.version !== previous.version || !['building', 'failed'].includes(job.state)
          || result.error === 'export_scope_changed' || result.state === 'expired' || !job.uploadStarted || job.cleaned
          || !job.content || descriptor.sha256 !== job.content.sha256 || descriptor.bytes !== job.content.bytes)
          domainReject('package_job_stopped');
        const next = { ...job, version: job.version + 1, state: 'ready' as const, artifact: descriptor, error: null };
        save(b.transaction, next); return view(next, b);
      });
    },
    async cancel(owner: string, id: string, raw: unknown) {
      const command = domainParse(handoverCancelCommandSchema, raw);
      return authority.runTransaction(owner, null, async b => {
        const previous = await readIn(b, id);
        if (previous.cancellation?.opId === command.opId) {
          if (firestoreDomainHash(previous.cancellation) !== firestoreDomainHash(command)) domainReject('operation_conflict');
          return view(previous, b);
        }
        if (previous.version !== command.expectedVersion) domainReject('version_conflict');
        if (['cancelled', 'expired'].includes(previous.state)) return view(previous, b);
        const next: FirestoreHandoverJob = { ...previous, version: previous.version + 1, state: 'cancelled', cancellation: command, error: null };
        const cleanup = await cleanupIntent(b, next, new Date(clock()).toISOString(), 'cancel:' + command.opId);
        save(b.transaction, next); cleanup.commit(); return view(next, b);
      });
    },
    /** Worker handoff also reads the actual persisted lease; a model cannot invent a trusted claim. */
    async claim(work: FirestoreBackgroundWork) {
      if (work.kind !== 'handover-export' || !work.lease) domainReject('package_claim_invalid');
      return authority.runTransaction(work.scope.ownerUserId, null, async b => {
        const prior = await readIn(b, work.resourceId);
        await held(b, work, prior);
        if (!['queued', 'building'].includes((await currentView(prior, b)).state)) return null;
        const next: FirestoreHandoverJob = { ...prior, version: prior.version + 1, state: 'building',
          claim: { workId: work.id, token: work.lease!.token, until: work.lease!.until } };
        save(b.transaction, next); return next;
      });
    },
    async prepareUpload(work: FirestoreBackgroundWork, raw: unknown) {
      const content = domainParse(handoverArtifactContentSchema, raw);
      return active(work, prior => {
        if (prior.content && firestoreDomainHash(prior.content) !== firestoreDomainHash(content)) domainReject('package_content_conflict');
        return { ...prior, version: prior.version + 1, content, uploadStarted: true };
      });
    },
    async publish(work: FirestoreBackgroundWork, raw: unknown) {
      const artifact = domainParse(handoverObjectDescriptorSchema, raw);
      return active(work, prior => {
        if (!prior.content || !prior.uploadStarted || artifact.sha256 !== prior.content.sha256 || artifact.bytes !== prior.content.bytes)
          domainReject('package_content_conflict');
        return { ...prior, version: prior.version + 1, state: 'ready', artifact, error: null };
      });
    },
    /** Keep an already-created object as a cleanup obligation even if permission/cancellation changed during upload. */
    async retainFailure(work: FirestoreBackgroundWork, code: string, rawArtifact?: unknown) {
      const artifact = rawArtifact === undefined ? null : domainParse(handoverObjectDescriptorSchema, rawArtifact);
      const allowed = new Set(['export_scope_changed', 'package_object_unknown', 'package_size_exceeded', 'package_job_stopped',
        'package_content_conflict', 'package_period_not_connected']);
      const error = allowed.has(code) ? code : 'package_build_failed';
      return options.database.runTransaction(async tx => {
        const prior = open(work.scope, work.resourceId, await tx.get(ref(work.scope.ownerUserId, work.resourceId)));
        if (!prior || !work.lease || prior.claim?.token !== work.lease.token || prior.state === 'ready') return;
        if (artifact && (!prior.content || artifact.bytes !== prior.content.bytes || artifact.sha256 !== prior.content.sha256))
          domainReject('package_content_conflict');
        const terminal = ['cancelled', 'expired'].includes(prior.state);
        save(tx, { ...prior, version: prior.version + 1, artifact: artifact ?? prior.artifact,
          state: terminal ? prior.state : 'failed', error: terminal ? prior.error : error });
      });
    },
    async downloadable(owner: string, id: string) {
      return authority.runTransaction(owner, null, async b => {
        const job = await readIn(b, id), result = await currentView(job, b);
        if (result.state !== 'ready' || !job.artifact || job.cleaned) domainReject(result.error ?? 'package_not_ready');
        return job;
      });
    },
    /** Cleanup is read-only with respect to product data and can operate after account erasure. */
    async retire(scope: WorkRecoveryScope, id: string) {
      return options.database.runTransaction(async tx => {
        const prior = open(scope, id, await tx.get(ref(scope.ownerUserId, id)));
        if (!prior || prior.cleaned) return prior;
        const next: FirestoreHandoverJob = { ...prior, version: prior.version + 1,
          state: prior.state === 'cancelled' ? 'cancelled' : 'expired', error: prior.state === 'cancelled' ? null : 'package_expired' };
        save(tx, next); return next;
      });
    },
    async cleaned(previous: FirestoreHandoverJob) {
      return options.database.runTransaction(async tx => {
        const current = open(previous.scope, previous.id, await tx.get(ref(previous.scope.ownerUserId, previous.id)));
        if (!current) return;
        if (current.version !== previous.version || !['cancelled', 'expired'].includes(current.state)) domainReject('package_cleanup_changed');
        save(tx, { ...current, version: current.version + 1, cleaned: true, artifact: null, claim: null });
      });
    },
  };
}
