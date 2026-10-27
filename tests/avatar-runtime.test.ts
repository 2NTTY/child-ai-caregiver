import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { readFirebaseServerConfig } from '../server/firebase-config.ts';
import { FirestoreDomainError } from '../server/firestore-domain-data.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import type { OnlineSubmission } from '../src/shared/online.ts';

type AvatarFactory = typeof import('../server/firestore-avatars.ts').createFirestoreAvatarStore;
type CleanupFactory = typeof import('../server/firestore-avatar-cleanup.ts').createFirestoreAvatarCleanup;
type ExportFactory = typeof import('../server/firestore-account-export.ts').createFirestoreAccountExport;
type ErasureFactory = typeof import('../server/firestore-erasure-cleanup.ts').createFirestoreErasureCleanup;
type MaintenanceFactory = typeof import('../server/firestore-background-maintenance.ts').createFirestoreBackgroundMaintenance;
type QueueFactory = typeof import('../server/firestore-background-work.ts').createFirestoreBackgroundQueue;

test('production avatar wiring shares HTTP and online services and retains cleanup when admission is closed', async t => {
  // This is an assembly test: domain/Storage results are controlled ports, never cloud or codec acceptance.
  const unavailable = () => { throw new Error('Unexpected external, model, notification or unrelated service call'); };
  t.mock.method(globalThis, 'fetch', unavailable);
  const owner = 'synthetic-avatar-runtime', origin = 'https://avatar-runtime.example.test';
  const env = { NODE_ENV: 'production', SERVER_ORIGIN: origin, WEB_ORIGIN: origin,
    GCP_PROJECT_ID: 'synthetic-avatar-runtime', FIREBASE_DATABASE_ID: 'synthetic-avatar-runtime',
    FIREBASE_NAMESPACE: 'synthetic_avatar_runtime', FIREBASE_PHOTO_BUCKET: 'synthetic-avatar-content',
    FIREBASE_ERASURE_BUCKET: 'synthetic-avatar-journal', FIREBASE_TASK_WORKER_ENABLED: 'true', AI_ENABLED: 'false' };
  const fake = firestoreDomainFixture(), cipher = createStorageCipher(Buffer.alloc(32, 67));
  const stores: { options: Parameters<AvatarFactory>[0]; service: ReturnType<AvatarFactory>; reads: number; submissions: OnlineSubmission[] }[] = [];
  const cleanupConnections: { options: Parameters<CleanupFactory>[0]; service: ReturnType<CleanupFactory> }[] = [];
  const exports: Parameters<ExportFactory>[0][] = [], erasures: Parameters<ErasureFactory>[0][] = [];
  const maintenance: { options: Parameters<MaintenanceFactory>[0]; seen: unknown[][]; service: ReturnType<MaintenanceFactory> }[] = [];
  const queues: Parameters<QueueFactory>[0][] = [];
  let sessionUser: string | null = owner, failOriginal = true, persistenceCloses = 0, codecCloses = 0;
  const avatarObjects = { read: unavailable, write: unavailable, inspect: unavailable, remove: unavailable, address: unavailable };
  const journal = { writeOnce: unavailable, read: unavailable, readObject: unavailable };
  const url = (file: string) => new URL('../server/' + file, import.meta.url).href;

  t.mock.module(url('firestore-product-agent.ts'), { namedExports: { createFirestoreProductAgent: async () => ({
    runtime: { run: unavailable }, voiceTranscripts: {}, agent: { background: unavailable },
  }) } });
  t.mock.module(url('firestore-session-service.ts'), { namedExports: { FirestoreSessionService: class {
    deleteSession = unavailable; eraseUserPage = unavailable;
  } } });
  const authModule = await import('../server/firebase-auth.ts');
  t.mock.module(url('firebase-auth.ts'), { namedExports: { ...authModule, createFirebaseAuthPort: () => ({
    async getSession() { return sessionUser ? { user: { id: sessionUser, name: 'Synthetic', email: 'synthetic@example.test' } } : null; },
    handler: unavailable, assertRecentReauthentication: unavailable,
  }) } });
  t.mock.module('firebase-admin/auth', { namedExports: { getAuth: () => ({ getUser: unavailable, deleteUser: unavailable }) } });
  t.mock.module(url('firebase-persistence.ts'), { namedExports: { async openFirebasePersistence(input: typeof env) {
    return { config: readFirebaseServerConfig(input), database: fake.database, cipher,
      authority: { accountStatus: unavailable, acknowledge: unavailable, readControl: unavailable },
      async close() { persistenceCloses++; } };
  } } });
  t.mock.module(url('avatar-codec.ts'), { namedExports: { createAvatarCodec: () => ({ normalize: unavailable,
    async close() { codecCloses++; } }) } });
  const objectModules = [
    ['firebase-avatar-objects.ts', 'createCloudStorageAvatarObjects', avatarObjects],
    ['firebase-photo-objects.ts', 'createCloudStoragePhotoObjects', avatarObjects],
    ['firebase-voice-objects.ts', 'createCloudStorageVoiceObjects', avatarObjects],
    ['firebase-chat-file-objects.ts', 'createCloudStorageChatFileObjects', avatarObjects],
    ['firebase-erasure-journal.ts', 'createCloudStorageErasureJournal', journal],
  ] as const;
  for (const [file, name, value] of objectModules) {
    const actual = await import(url(file));
    t.mock.module(url(file), { namedExports: { ...actual, [name]: () => value } });
  }
  t.mock.module(url('firestore-avatars.ts'), { namedExports: { createFirestoreAvatarStore(options: Parameters<AvatarFactory>[0]) {
    const record = { options, service: null as unknown as ReturnType<AvatarFactory>, reads: 0, submissions: [] as OnlineSubmission[] };
    record.service = {
      retryAfterSeconds: 2,
      async read(userId, target) { assert.equal(userId, owner);record.reads++;return {
        avatar: { target, version: 0, asset: null, updatedAt: null, canManage: options.config.writesEnabled }, policy: options.config.policy }; },
      async submitOnline(userId, submission) {
        assert.equal(userId, owner);record.submissions.push(submission);
        if (failOriginal) { failOriginal = false;throw new FirestoreDomainError(503, 'avatar_unavailable'); }
        return { state: 'confirmed', operation: submission.operation, path: submission.path, statusCode: 201, changeSeq: '1', result: { upload: { id: submission.operation.opId } } };
      },
      uploadStatus: unavailable, uploadAdmission: unavailable, content: unavailable,
    };
    stores.push(record);return record.service;
  } } });
  t.mock.module(url('firestore-avatar-cleanup.ts'), { namedExports: { createFirestoreAvatarCleanup(options: Parameters<CleanupFactory>[0]) {
    const service = { process: unavailable, eraseForScope: unavailable };cleanupConnections.push({ options, service });return service;
  } } });
  t.mock.module(url('firestore-account-export.ts'), { namedExports: { createFirestoreAccountExport(options: Parameters<ExportFactory>[0]) {
    exports.push(options);return { async page(userId: string, input: { section: string }) {
      assert.equal(userId, owner);assert.equal(input.section, 'self_avatar_content');
      return { section: input.section, items: [], complete: true, nextCursor: null, scopeVersion: 'a'.repeat(64), notices: [] };
    }, messages: unavailable };
  } } });
  t.mock.module(url('firestore-erasure-cleanup.ts'), { namedExports: { createFirestoreErasureCleanup(options: Parameters<ErasureFactory>[0]) {
    erasures.push(options);return { advance: unavailable };
  } } });
  t.mock.module(url('firestore-background-maintenance.ts'), { namedExports: { createFirestoreBackgroundMaintenance(options: Parameters<MaintenanceFactory>[0]) {
    const seen: unknown[][] = [];
    const service = { async process(...args: unknown[]) { seen.push(args);return { state: 'unknown' as const }; }, tick: unavailable, childChange: unavailable };
    maintenance.push({ options, seen, service });return service;
  } } });
  const queueModule = await import('../server/firestore-background-work.ts');
  t.mock.module(url('firestore-background-work.ts'), { namedExports: { ...queueModule,
    createFirestoreBackgroundQueue(options: Parameters<QueueFactory>[0]) { queues.push(options);return { dispatch: unavailable, process: unavailable }; },
  } });

  const sourceGate = await import('../server/avatar-release.ts');
  const candidateGate = t.mock.module(url('avatar-release.ts'), { namedExports: { AVATAR_LIFECYCLE_RELEASE_READY: true } });
  const { openFirebaseRuntime } = await import('../server/firebase-runtime.ts');
  const { createFirebaseWorkerServices } = await import('../server/firebase-worker-services.ts');
  const runtimes: Awaited<ReturnType<typeof openFirebaseRuntime>>[] = [];
  const request = (path: string, body?: unknown, expected = owner) => new Request(origin + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'x-expected-user-id': expected, Origin: origin,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const submission: OnlineSubmission = { path: '/api/me/avatar/uploads', payload: { expectedVersion: 0 },
    operation: { opId: randomUUID(), deviceId: randomUUID(), workspaceId: randomUUID(), storageEpoch: randomUUID() } };
  const delivery = { taskName: unavailable, enqueue: unavailable, probe: unavailable };
  const backgroundDelivery = { enqueue: unavailable, probe: unavailable }, controller = new AbortController();
  const checkCleanup = (runtime: Awaited<ReturnType<typeof openFirebaseRuntime>>, index: number) => {
    assert.equal(runtime.avatarObjects, avatarObjects);assert.equal(cleanupConnections[index].options.objects, avatarObjects);
    assert.equal(cleanupConnections[index].options.journal, journal);assert.equal(runtime.avatarCleanup, cleanupConnections[index].service);
    assert.equal(exports[index].avatars, stores[index].service);assert.equal(erasures[index].avatars, runtime.avatarCleanup);
    assert.equal(erasures[index].journal, runtime.journal);
    const services = createFirebaseWorkerServices(runtime, delivery, backgroundDelivery, controller);
    assert.equal(services.maintenance, maintenance[index].service);assert.equal(maintenance[index].options.avatars, runtime.avatarCleanup);
    assert.equal(maintenance[index].options.cleanup, runtime.erasureCleanup);assert.equal(maintenance[index].options.journal, runtime.journal);
    assert.equal(maintenance[index].options.enabled, true);assert.equal(queues[index].transport, backgroundDelivery);
    return queues[index];
  };
  try {
    const runtime = await openFirebaseRuntime({ ...env, AVATAR_WRITES_ENABLED: 'true' });runtimes.push(runtime);
    assert.equal(runtime.avatars, stores[0].service);assert.equal(stores[0].options.config.writesEnabled, true);
    assert.equal(stores[0].options.objects, runtime.avatarObjects);assert.equal(stores[0].options.journal, runtime.journal);
    assert.equal((await runtime.handler(request('/api/me/avatar'))).status, 200);assert.equal(stores[0].reads, 1);
    assert.equal((await runtime.handler(request('/api/me/avatar', undefined, 'other'))).status, 409);assert.equal(stores[0].reads, 1);
    sessionUser = null;assert.equal((await runtime.handler(request('/api/me/avatar'))).status, 401);sessionUser = owner;
    assert.equal((await runtime.handler(request('/api/online/submit', submission, 'other'))).status, 409);
    assert.equal(stores[0].submissions.length, 0);
    const unknown = await runtime.handler(request('/api/online/submit', submission));
    assert.equal(unknown.status, 503);assert.equal(stores[0].submissions.length, 1, 'Runtime never retries an uncertain domain result');
    const replay = await runtime.handler(request('/api/online/submit', submission));
    assert.equal(replay.status, 200);assert.deepEqual((await replay.json()).operation, submission.operation);
    assert.deepEqual(stores[0].submissions, [submission, submission], 'The same original operation reaches the same avatar instance');
    const queue = checkCleanup(runtime, 0), signal = new AbortController().signal;
    const job = { kind: 'avatar-cleanup' } as Parameters<typeof queue.execute>[0];
    assert.deepEqual(await queue.execute(job, signal), { state: 'unknown' });assert.deepEqual(maintenance[0].seen, [[job, signal]]);
    const close = runtime.close();assert.equal(runtime.close(), close);await close;

    candidateGate.restore();
    t.mock.module(url('avatar-release.ts'), { namedExports: { AVATAR_LIFECYCLE_RELEASE_READY: false } });
    const closedModule = await import(new URL('../server/firebase-runtime.ts?avatar-runtime-closed', import.meta.url).href) as typeof import('../server/firebase-runtime.ts');
    await assert.rejects(closedModule.openFirebaseRuntime({ ...env, AVATAR_WRITES_ENABLED: 'true' }), /Avatar lifecycle release gate/);
    assert.equal(stores.length, 1, 'A closed gate rejects new writes before assembling a service');
    const closed = await closedModule.openFirebaseRuntime({ ...env, AVATAR_WRITES_ENABLED: 'false' });runtimes.push(closed);
    assert.equal(stores[1].options.config.writesEnabled, false);assert.equal(closed.avatars, undefined);
    assert.equal((await closed.handler(request('/api/me/avatar'))).status, 503);
    assert.equal((await closed.handler(request('/api/online/submit', submission))).status, 503);
    assert.equal(stores[1].reads, 0);assert.equal(stores[1].submissions.length, 0);
    const exportResponse = await closed.handler(request('/api/account/export?section=self_avatar_content'));
    assert.equal(exportResponse.status, 200);assert.deepEqual((await exportResponse.json()).items, []);
    const closedQueue = checkCleanup(closed, 1);
    assert.deepEqual(await closedQueue.execute(job, signal), { state: 'unknown' });assert.deepEqual(maintenance[1].seen, [[job, signal]]);
    await closed.close();assert.equal(codecCloses, 2);assert.equal(persistenceCloses, 2);
    t.diagnostic(JSON.stringify({ sourceReleaseReady: sourceGate.AVATAR_LIFECYCLE_RELEASE_READY, candidateGate: 'test-only mock',
      realEntries: ['openFirebaseRuntime', 'createFirebaseRequestHandler', 'createFirestoreOnlineStore', 'createFirebaseWorkerServices'],
      domainPorts: 'controlled', network: 0, models: 0, notifications: 0 }));
  } finally { await Promise.all(runtimes.map(runtime => runtime.close())); }
});
