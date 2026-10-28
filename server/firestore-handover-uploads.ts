import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DocumentSnapshot, Transaction } from '@google-cloud/firestore';
import { handoverUploadCommandSchema, handoverUploadPreviewSchema, handoverUploadViewSchema } from '../src/shared/handover-uploads.ts';
import { handoverCancelCommandSchema } from '../src/shared/handover-jobs.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { openRecoveryEnvelope } from './firestore-recovery-envelope.ts';
import { prepareFirestoreBackgroundWork } from './firestore-background-work.ts';
import { handoverObjectDescriptorSchema } from './firebase-handover-objects.ts';
import { handoverUploadRecordSchema, handoverUploadId, handoverUploadMetadata, validHandoverUpload,
  HANDOVER_UPLOAD_RETENTION_MS, type HandoverUploadRecord as Upload } from './handover-upload-records.ts';
import type { WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';

/** Upload ownership and cleanup obligation are durable before any body or Storage write. */
export function createFirestoreHandoverUploads(options: FirestoreDomainOptions & { serverClock?: () => number }) {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options), clock = options.serverClock ?? Date.now;
  const ref = (owner: string, id: string) => data.ref('handover_uploads', 'handover-upload', handoverUploadId(owner, id));
  function open(scope: WorkRecoveryScope, id: string, snapshot: DocumentSnapshot) {
    if (!snapshot.exists) return null;
    const job = data.open('handover-upload', handoverUploadId(scope.ownerUserId, id), scope, handoverUploadRecordSchema, snapshot);
    if (!validHandoverUpload(job) || job.id !== id || job.version !== snapshot.get('recordVersion')
      || firestoreDomainHash(job.scope) !== firestoreDomainHash(scope)) domainReject('package_upload_binding', 500);
    for (const [key, value] of Object.entries({ ...data.tags(scope), ...handoverUploadMetadata(job) }))
      if (snapshot.get(key) !== value) domainReject('package_upload_binding', 500);
    return job;
  }
  function save(tx: Transaction, raw: Upload) {
    const job = domainParse(handoverUploadRecordSchema, raw, 'package_upload_binding', 500);
    if (!validHandoverUpload(job)) domainReject('package_upload_binding', 500);
    tx.set(ref(job.scope.ownerUserId, job.id), { ...data.tags(job.scope), ...handoverUploadMetadata(job),
      ...data.seal('handover-upload', handoverUploadId(job.scope.ownerUserId, job.id), job.scope, handoverUploadRecordSchema, job, job.version) });
  }
  async function owned(b: Binding, id: string) {
    domainParse(z.uuid(), id);
    const row = await b.transaction.get(ref(b.actorUserId, id)); if (!row.exists) domainReject('package_upload_not_found', 404);
    const raw = row.data()!, opened = openRecoveryEnvelope({ ...options, locator: raw.recovery,
      envelope: { family: 'domain', version: raw.version, recordVersion: raw.recordVersion, ciphertext: raw.ciphertext } });
    const context = opened.context;
    if (context.kind !== 'handover-upload' || context.id !== handoverUploadId(b.actorUserId, id)
      || context.scope.ownerUserId !== b.actorUserId || context.scope.workspaceId !== b.scope.workspaceId
      || context.scope.childId !== b.scope.childId) domainReject('package_upload_binding', 500);
    const job = open(context.scope, id, row)!;
    if (context.scope.storageEpoch !== b.scope.storageEpoch && job.state !== 'expired') domainReject('package_restored');
    return job;
  }
  function view(job: Upload) {
    const expired = clock() >= Date.parse(job.expiresAt), terminal = ['failed', 'cancelled', 'expired'].includes(job.state);
    const state = terminal ? job.state : expired ? 'expired' : job.state;
    return handoverUploadViewSchema.parse({ id: job.id, version: job.version, filename: job.request.filename, bytes: job.request.bytes,
      createdAt: job.createdAt, expiresAt: job.expiresAt, state, error: expired && !terminal ? 'package_expired' : job.error,
      preview: state === 'ready' ? job.preview : null });
  }
  const cleanupIntent = (b: Binding, job: Upload, dueAt: string, basis: string) => prepareFirestoreBackgroundWork(data, b.transaction,
    { kind: 'handover-upload-cleanup', scope: job.scope, resourceId: job.id, basis,
      generation: b.generation, authorizationVersion: b.authorizationVersion }, dueAt);
  async function active(previous: Upload, use: (b: Binding, current: Upload) => Promise<Upload> | Upload) {
    return authority.runTransaction(previous.scope.ownerUserId, null, async b => {
      const current = await owned(b, previous.id);
      if (current.state !== 'receiving' || !current.lease || current.lease.token !== previous.lease?.token
        || current.generation !== b.generation || current.authorizationVersion !== b.authorizationVersion
        || Date.parse(current.lease.until) <= clock() || Date.parse(current.expiresAt) <= clock()) domainReject('package_upload_stopped');
      const next = await use(b, current);
      if (Date.parse(current.lease.until) <= clock()) domainReject('package_upload_stopped');
      save(b.transaction, next); return next;
    });
  }
  return {
    async assertImportableIn(b: Binding, id: string, version: number) {
      // The operation may be committing a child's data; the staged package still belongs to the actor's account scope.
      const job = await owned({ ...b, scope: { ...b.scope, childId: '00000000-0000-0000-0000-000000000000' } }, id);
      if (job.state !== 'ready' || job.cleaned || job.version !== version || job.generation !== b.generation
        || job.authorizationVersion !== b.authorizationVersion) domainReject('package_upload_changed');
      const checkDeadline = () => { if (Date.parse(job.expiresAt) <= clock()) domainReject('package_expired'); };
      checkDeadline(); return checkDeadline;
    },
    async create(owner: string, raw: unknown) {
      const request = domainParse(handoverUploadCommandSchema, raw), fingerprint = firestoreDomainHash(request);
      return authority.runTransaction(owner, null, async b => {
        if ((await b.transaction.get(ref(owner, request.opId))).exists) {
          const prior = await owned(b, request.opId); if (prior.fingerprint !== fingerprint) domainReject('operation_conflict'); return view(prior);
        }
        let pending = data.collection('handover_uploads').where('cleaned', '==', false);
        for (const [key, value] of Object.entries(data.tags(b.scope))) pending = pending.where(key, '==', value);
        if ((await b.transaction.get(pending.limit(4))).size >= 4) domainReject('package_upload_capacity', 429);
        const createdAt = new Date(clock()).toISOString(), expiresAt = new Date(clock() + HANDOVER_UPLOAD_RETENTION_MS).toISOString();
        const job: Upload = { id: request.opId, version: 1, scope: b.scope, request, fingerprint, state: 'reserved',
          createdAt, expiresAt, generation: b.generation, authorizationVersion: b.authorizationVersion,
          error: null, preview: null, artifact: null, uploadStarted: false, cleaned: false, lease: null, cancellation: null };
        const cleanup = await cleanupIntent(b, job, expiresAt, 'retention'); save(b.transaction, job); cleanup.commit(); return view(job);
      });
    },
    get(owner: string, id: string) { return authority.runTransaction(owner, null, async b => view(await owned(b, id))); },
    async claim(owner: string, id: string) {
      return authority.runTransaction(owner, null, async b => {
        const job = await owned(b, id); if (job.state === 'ready') return null;
        if (job.state !== 'reserved' || Date.parse(job.expiresAt) <= clock()) domainReject('package_upload_stopped');
        const next: Upload = { ...job, version: job.version + 1, state: 'receiving', generation: b.generation,
          authorizationVersion: b.authorizationVersion, lease: { token: randomUUID(), until: new Date(clock() + 300_000).toISOString() } };
        save(b.transaction, next); return next;
      });
    },
    beforeObject(previous: Upload) { return active(previous, (_b, job) => ({ ...job, version: job.version + 1, uploadStarted: true })); },
    publish(previous: Upload, rawArtifact: unknown, rawPreview: unknown) {
      const artifact = domainParse(handoverObjectDescriptorSchema, rawArtifact), preview = domainParse(handoverUploadPreviewSchema, rawPreview);
      return active(previous, (_b, job) => {
        if (!job.uploadStarted || artifact.sha256 !== job.request.sha256 || artifact.bytes !== job.request.bytes) domainReject('package_content_conflict');
        return { ...job, version: job.version + 1, state: 'ready', artifact, preview, error: null };
      });
    },
    /** Preserve the exact object obligation even after account revocation during an upload. */
    async failed(previous: Upload, code: string, rawArtifact?: unknown) {
      const artifact = rawArtifact ? domainParse(handoverObjectDescriptorSchema, rawArtifact) : null;
      return options.database.runTransaction(async tx => {
        const job = open(previous.scope, previous.id, await tx.get(ref(previous.scope.ownerUserId, previous.id)));
        if (!job || job.lease?.token !== previous.lease?.token || job.state === 'ready') return;
        if (artifact && (artifact.sha256 !== job.request.sha256 || artifact.bytes !== job.request.bytes)) domainReject('package_content_conflict');
        const terminal = ['cancelled', 'expired'].includes(job.state);
        const control = await authority.readControl(tx);
        const cleanup = await prepareFirestoreBackgroundWork(data, tx, { kind: 'handover-upload-cleanup', scope: job.scope,
          resourceId: job.id, basis: 'failure:' + job.lease!.token, generation: control.generation,
          authorizationVersion: job.authorizationVersion }, new Date(clock()).toISOString());
        save(tx, { ...job, version: job.version + 1, state: terminal ? job.state : 'failed', artifact: artifact ?? job.artifact,
          preview: null, error: terminal ? job.error : /^[a-z][a-z0-9_]{0,99}$/u.test(code) ? code : 'package_upload_failed' });
        cleanup.commit();
      });
    },
    async cancel(owner: string, id: string, raw: unknown) {
      const command = domainParse(handoverCancelCommandSchema, raw);
      return authority.runTransaction(owner, null, async b => {
        const job = await owned(b, id);
        if (job.cancellation?.opId === command.opId) {
          if (firestoreDomainHash(job.cancellation) !== firestoreDomainHash(command)) domainReject('operation_conflict'); return view(job);
        }
        if (job.version !== command.expectedVersion) domainReject('version_conflict');
        if (['cancelled', 'expired'].includes(job.state)) domainReject('package_upload_stopped');
        const next: Upload = { ...job, version: job.version + 1, state: 'cancelled', preview: null, error: null, cancellation: command };
        const cleanup = await cleanupIntent(b, next, new Date(clock()).toISOString(), command.opId);
        save(b.transaction, next); cleanup.commit(); return view(next);
      });
    },
    async readable(owner: string, id: string) {
      return authority.runTransaction(owner, null, async b => {
        const job = await owned(b, id); if (view(job).state !== 'ready' || job.cleaned) domainReject('package_upload_not_ready'); return job;
      });
    },
    async retire(scope: WorkRecoveryScope, id: string) {
      return options.database.runTransaction(async tx => {
        const job = open(scope, id, await tx.get(ref(scope.ownerUserId, id))); if (!job || job.cleaned) return job;
        const stopped = job.state === 'cancelled' || job.state === 'failed';
        const next: Upload = { ...job, version: job.version + 1, state: stopped ? job.state : 'expired',
          preview: null, error: stopped ? job.error : 'package_expired' };
        save(tx, next); return next;
      });
    },
    async cleaned(previous: Upload) {
      return options.database.runTransaction(async tx => {
        const job = open(previous.scope, previous.id, await tx.get(ref(previous.scope.ownerUserId, previous.id))); if (!job) return;
        if (job.version !== previous.version || !['cancelled', 'expired', 'failed'].includes(job.state)) domainReject('package_cleanup_changed');
        save(tx, { ...job, version: job.version + 1, cleaned: true, preview: null, artifact: null, lease: null });
      });
    },
  };
}
