import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreHandoverJobs } from '../server/firestore-handover-jobs.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { Readable, Writable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { createHandoverService } from '../server/handover-service.ts';
import { createFirebaseHandoverObjects } from '../server/firebase-handover-objects.ts';
import { createFirestoreBackgroundQueue, firestoreBackgroundWorkSchema } from '../server/firestore-background-work.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { openHandoverArchive } from '../server/handover-archive.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { createFirebaseRequestHandler } from '../server/firebase-app.ts';
import { createFirebaseWorkerServices } from '../server/firebase-worker-services.ts';
import { prepareFirebaseRestore } from '../server/firestore-restore.ts';
import { createFirestoreAvatarData } from '../server/firestore-avatar-data.ts';
import { avatarBinding } from '../server/avatar-data.ts';

test('export requests persist one original job and outbox, reject changed retries, and retain cancellation on reconnect', async () => {
  const fixture = serialFirestoreFixture(), options = { database: fixture.database, cipher: createStorageCipher(Buffer.alloc(32, 84)),
    projectId: 'synthetic-pack', namespace: 'unit_pack' };
  const authority = createFirestoreAuthority(options);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  const userId = 'package-owner', email = 'package-owner@example.test';
  await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(Date.now() + 86400000).toISOString() });
  await authority.admitIdentity({ userId, email, emailVerified: true });
  await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const childId = (await authority.createChild({ userId, operationId: randomUUID(), displayName: 'Synthetic child' })).child.id;
  const jobs = createFirestoreHandoverJobs(options);
  const beforeWork = new Set([...fixture.records.keys()].filter(path => path.startsWith('unit_pack_background_work/')));
  const snapshot = () => [...fixture.records].map(([path, data]) => ({ path, data: structuredClone(data) }));
  const beforeRequest = snapshot();
  const command = { opId: randomUUID(), purpose: 'backup' as const, selection: { childIds: [childId], modules: ['care' as const, 'attachments' as const], period: null } };
  const created = await jobs.create(userId, command);
  const beforeUpload = snapshot();
  assert.equal(created.state, 'queued'); assert.equal(created.id, command.opId);
  assert.deepEqual(await jobs.create(userId, command), created);
  await assert.rejects(jobs.create(userId, { ...command, purpose: 'handover' }), { code: 'operation_conflict' });
  assert.equal(fixture.records.size > 0, true);
  const queued = [...fixture.records.entries()].filter(([path]) => path.startsWith('unit_pack_background_work/') && !beforeWork.has(path));
  assert.equal(queued.length, 2, 'one export and one expiry obligation are committed with the job');
  const scope = await authority.runTransaction(userId, null, async b => b.scope), data = new FirestoreDomainData(options);
  const work = queued.map(([path, value]) => data.open('background-work', value.id, scope, firestoreBackgroundWorkSchema,
    { exists: true, data: () => value } as never)).find(value => value.kind === 'handover-export')!;
  const stored = new Map<string, { body: Buffer; metadata: unknown }>(); let loseUploadResponse = true;
  const objects = createFirebaseHandoverObjects({ config: { projectId: options.projectId, namespace: options.namespace, bucketName: 'synthetic-packages' }, files: options.cipher.files, bucket: {
    async metadata(name) {
      if (stored.has(name) && loseUploadResponse) { loseUploadResponse = false; throw Error('Synthetic lost upload readback'); }
      return stored.get(name)?.metadata ?? null;
    },
    createWrite(name, config) { const parts: Buffer[] = []; return new Writable({
      write(chunk, _encoding, callback) { parts.push(Buffer.from(chunk)); callback(); },
      final(callback) { const body = Buffer.concat(parts); stored.set(name, { body, metadata: { name, bucket: 'synthetic-packages', generation: '1',
        size: String(body.length), metadata: config.metadata?.metadata } }); callback(); },
    }); },
    readPinned(name) { return Readable.from([stored.get(name)!.body]); },
    async removePinned(name) { stored.delete(name); },
  } });
  const exporter = createFirestoreAccountExport({ ...options, photos: { async content() { throw Error('No photo in this fixture'); } } });
  const root = await mkdtemp(join(tmpdir(), 'handover-jobs-'));
  const service = createHandoverService({ ...options, exporter, objects, serverId: 'synthetic-site', spoolRoot: root });
  try {
    const origin = 'https://synthetic.example.test'; let currentUser: string | null = userId;
    const auth = { async getSession() { return currentUser ? { user: { id: currentUser } } : null; },
      async handler() { throw Error('No authentication mutation in this flow'); } } as never;
    const handler = createFirebaseRequestHandler({ authority, auth, publicOrigin: origin, mailConfigured: false,
      accountData: { exporter, erasures: {} as never, packages: service } });
    const request = (path: string, body?: unknown) => handler(new Request(origin + '/api/account/packages' + path, {
      method: body === undefined ? 'GET' : 'POST', headers: { origin, 'content-type': 'application/json', 'x-expected-user-id': userId },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    assert.equal((await request('', command)).status, 202);
    const workerRuntime = { ...options, authority, config: { projectId: options.projectId,
      namespace: options.namespace, taskWorkerEnabled: true }, handover: service,
      currentAuth: async () => ({ disabled: false, emailVerified: true, email }),
      knowledgeRefresh: { async jobs() { return []; } },
    };
    const makeWorkers = (handover = service) => createFirebaseWorkerServices({ ...workerRuntime, handover } as never,
    { taskName() { return 'unused'; }, async enqueue() { throw Error('No reminder in this flow'); },
      async probe() { throw Error('No reminder in this flow'); } } as never,
    { async enqueue() { return { state: 'confirmed' }; }, async probe() { return { state: 'confirmed' }; } }, new AbortController());
    const workers = makeWorkers();
    const queue = workers.background;
    const delivery = { kind: 'product-work' as const, id: work.id, generation: work.generation,
      dispatchRevision: work.dispatchRevision, scheduledAt: work.dueAt };
    assert.equal((await queue.process(delivery)).state, 'unknown');
    assert.equal((await service.get(userId, created.id)).error, 'package_object_unknown');
    assert.equal((await request('/' + created.id + '/reconcile', {})).status, 200);
    const ready = await service.get(userId, created.id); assert.equal(ready.state, 'ready');
    assert.equal((await queue.process(delivery)).state, 'unknown', 'redelivery preserves the original worker receipt and does not create another export');
    assert.equal(stored.size, 1);
    assert.equal((await (await request('/' + created.id)).json()).state, 'ready');
    assert.equal((await (await request('')).json()).items[0].id, created.id);
    const response = await request('/' + created.id + '/download');
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'application/zip');
    assert.equal((await response.arrayBuffer()).byteLength, ready.bytes);
    currentUser = 'another-user'; assert.notEqual((await request('/' + created.id)).status, 200);
    currentUser = null; assert.equal((await request('')).status, 401); currentUser = userId;
    const downloaded = await service.download(userId, created.id);
    try {
      const archive = await openHandoverArchive({ path: downloaded.path });
      try { assert.equal(archive.manifest.packageId, created.id); assert.equal(archive.integrity, 'missing_proof'); }
      finally { archive.close(); }
    } finally { await downloaded.dispose(); }
    const codec = createFirestoreRestoreCodec(options);
    const [path, value] = [...fixture.records.entries()].find(([path]) => path.startsWith('unit_pack_handover_exports/'))!;
    const restored = codec.transform(codec.decode({ path, data: value }), { newEpochByWorkspace: new Map([[scope.workspaceId, randomUUID()]]),
      generation: randomUUID(), photoDescriptors: new Map() });
    assert.equal((codec.decode(restored).value as any).state, 'expired', 'restore cannot publish an old downloadable package');
    const uploadedSnapshot = snapshot();
    const avatars = createFirestoreAvatarData(options);
    await authority.runTransaction(userId, childId, async b => {
      const head = await avatars.head(b, avatarBinding(b.scope, { kind: 'child', childId }));
      avatars.prepareHead(b, { ...head, version: head.version + 1, updatedAt: new Date().toISOString() })();
    });
    assert.equal((await service.get(userId, created.id)).error, 'export_scope_changed', 'avatar changes invalidate a ready package without changing workspace sequence');
    await assert.rejects(service.download(userId, created.id), { code: 'export_scope_changed' });
    const cancel = { opId: randomUUID(), expectedVersion: ready.version };
    const cancelled = await jobs.cancel(userId, created.id, cancel);
    assert.equal(cancelled.state, 'cancelled');
    const restarted = createFirestoreHandoverJobs(options);
    assert.deepEqual(await restarted.get(userId, created.id), cancelled);
    assert.deepEqual(await restarted.cancel(userId, created.id, cancel), cancelled);
    assert.deepEqual(await restarted.create(userId, command), cancelled, 'replaying create cannot restart cancelled work');
    await assert.rejects(restarted.get('another-user', created.id));
    await assert.rejects(restarted.cancel(userId, created.id, { ...cancel, expectedVersion: 99 }), { code: 'operation_conflict' });
    await assert.rejects(service.download(userId, created.id));
    const afterLease = createHandoverService({ ...options, exporter, objects, serverId: 'synthetic-site',
      spoolRoot: root, serverClock: () => Date.now() + 600_000 });
    const cleanupWorkers = makeWorkers(afterLease);
    await cleanupWorkers.maintenance.tick();
    const cleanupRow = [...fixture.records.entries()].filter(([path]) => path.startsWith('unit_pack_background_work/'))
      .map(([path, value]) => codec.decode({ path, data: value }).value as any)
      .find(value => value.kind === 'handover-cleanup' && value.scope.ownerUserId === 'system:task-dispatch');
    assert.ok(cleanupRow, 'maintenance retains cleanup when an original user or generation is no longer available');
    assert.equal((await cleanupWorkers.background.process({ kind: 'product-work', id: cleanupRow.id,
      generation: cleanupRow.generation, dispatchRevision: cleanupRow.dispatchRevision, scheduledAt: cleanupRow.dueAt })).state, 'completed');
    assert.equal(stored.size, 0);
    const pausedGeneration = randomUUID();
    const pausedFixture = serialFirestoreFixture();
    await createFirestoreAuthority({ ...options, database: pausedFixture.database }).initializeControl({ generation: pausedGeneration, enabled: false });
    for (const [path, data] of pausedFixture.records) fixture.records.set(path, data);
    const current = snapshot(), control = current.find(row => codec.decode(row).context.kind === 'control')!;
    // A queued snapshot retains the live object; a snapshot predating the request retains its completed cleanup.
    for (const [source, live, cleaned] of [[beforeUpload, uploadedSnapshot, false], [beforeRequest, current, true]] as const) {
      const plan = prepareFirebaseRestore(options, { restoreId: randomUUID(), targetDatabaseId: 'synthetic-package-target',
        sourceGeneration: pausedGeneration, documents: source.map(row => row.path === control.path ? control : row),
        liveDocuments: live.map(row => row.path === control.path ? control : row),
        authUsers: [{ userId, email, disabled: false, emailVerified: true }], erasures: [], photoDescriptors: new Map(), erasureDescriptors: new Map() });
      const job = plan.records.filter(row => row.path.startsWith('unit_pack_handover_exports/')).map(row => codec.decode(row).value as any)[0];
      assert.equal(job.cleaned, cleaned); assert.equal(job.state, 'expired'); assert.deepEqual(job.objectScope, scope);
      assert.equal(job.artifact !== null, !cleaned);
      const target = serialFirestoreFixture();
      for (const row of plan.records) target.records.set(row.path, row.data);
      const targetControl = serialFirestoreFixture();
      await createFirestoreAuthority({ ...options, database: targetControl.database }).initializeControl({ generation: plan.generation, enabled: true });
      for (const [path, value] of targetControl.records) target.records.set(path, value);
      assert.equal((await createFirestoreHandoverJobs({ ...options, database: target.database }).get(userId, created.id)).state, 'expired',
        'original job lookup after epoch rotation returns its retired state, never its old package');
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
