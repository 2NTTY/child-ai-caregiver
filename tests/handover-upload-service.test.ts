import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { Readable, Writable } from 'node:stream';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirebaseHandoverObjects } from '../server/firebase-handover-objects.ts';
import { createHandoverUploadService } from '../server/handover-upload-service.ts';
import { createFirebaseNodeHandler } from '../server/firebase-http.ts';
import { handleFirebaseAccountData } from '../server/firebase-account-data-api.ts';
import { writeHandoverArchive } from '../server/handover-archive.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { prepareFirebaseRestore } from '../server/firestore-restore.ts';
import { createFirestoreHandoverUploads } from '../server/firestore-handover-uploads.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';

test('package upload HTTP, immutable storage and cleanup preserve operation identity, isolation and restore obligations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'handover-upload-service-')), spoolRoot = join(root, 'spool'); await mkdir(spoolRoot);
  const fixture = serialFirestoreFixture(), cipher = createStorageCipher(Buffer.alloc(32, 67));
  const options = { database: fixture.database, cipher, projectId: 'demo-upload', namespace: 'unit_upload' };
  const authority = createFirestoreAuthority(options); await authority.initializeControl({ enabled: true, generation: randomUUID() });
  async function admit(userId: string) {
    const email = userId + '@example.test';
    await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  }
  await admit('recipient'); await admit('other');
  const childId = randomUUID(), scopeVersion = 'a'.repeat(64), pages = [
    { section: 'children', childId: null, items: [{ id: childId, displayName: 'Source child' }] },
    { section: 'profile', childId, items: [{ childId, version: 1, data: null }] }, { section: 'profile_history', childId, items: [] },
  ];
  async function* entries() {
    for (let i = 0; i < pages.length; i++) yield { path: `data/${i}.json`, mediaType: 'application/json', content: Buffer.from(JSON.stringify({ ...pages[i], scopeVersion })) };
    yield { path: 'summary.md', mediaType: 'text/markdown', content: Buffer.from('Synthetic package') };
  }
  const archive = await writeHandoverArchive({ directory: root, header: { format: 'yuyoufang-data', version: 1, packageId: randomUUID(), packageVersion: 1,
    createdAt: new Date().toISOString(), purpose: 'backup', source: { serverId: 'https://source.test', accountId: 'source' },
    selection: { childIds: [childId], modules: ['profile'], period: null } }, entries: entries(),
    coverage: () => pages.map(p => ({ section: p.section, childId: p.childId, scopeVersion, items: p.items.length, complete: true as const })) });
  const bytes = await readFile(archive.path), content = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  const stored = new Map<string, { body: Buffer; metadata: any }>(); let writes = 0, afterPut: (() => Promise<void>) | undefined;
  const objects = createFirebaseHandoverObjects({ config: { projectId: options.projectId, namespace: options.namespace, bucketName: 'synthetic-packages' }, files: cipher.files,
    bucket: { async metadata(name) { return stored.get(name)?.metadata ?? null; },
      createWrite(name, config) {
        writes++; const parts: Buffer[] = [];
        return new Writable({ write(chunk, _encoding, done) { parts.push(Buffer.from(chunk)); done(); }, final(done) {
          const body = Buffer.concat(parts); stored.set(name, { body, metadata: { name, bucket: 'synthetic-packages', generation: '10000000000000001', size: String(body.length), metadata: config.metadata?.metadata } }); done();
        } });
      },
      readPinned(name) { return Readable.from([stored.get(name)!.body]); },
      async removePinned(name, generation) { assert.equal(generation, '10000000000000001'); stored.delete(name); },
    } });
  let now = Date.now();
  const uploads = createHandoverUploadService({ ...options, spoolRoot, serverClock: () => now,
    objects: { ...objects, async put(input) { const descriptor = await objects.put(input); await afterPut?.(); return descriptor; } } });
  let base = '', observedStreaming = false;
  let enteredContent!: () => void;
  const contentEntered = new Promise<void>(resolve => { enteredContent = resolve; });
  const auth = { fromNodeHeaders: (raw: any) => new Headers(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v)]))),
    async getSession({ headers }: { headers: Headers }) { return headers.get('x-test-user') ? { user: { id: headers.get('x-test-user')! } } : null; } };
  let nodeHandler: ReturnType<typeof createFirebaseNodeHandler>;
  const server = createServer((req, res) => void nodeHandler(req, res));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + (server.address() as any).port;
  nodeHandler = createFirebaseNodeHandler({ publicOrigin: base, auth, handler: async request => {
    if (request.url.endsWith('/content')) { observedStreaming = request.body !== null && !request.bodyUsed; enteredContent(); }
    try { return await handleFirebaseAccountData(request, auth as any, { packageUploads: uploads } as any, r => r.json()); }
    catch (error: any) { return Response.json({ code: error.code ?? 'unknown' }, { status: error.status ?? 500 }); }
  } });
  const headers = (user = 'recipient') => ({ origin: base, 'x-test-user': user, 'x-expected-user-id': user });
  const call = (path: string, body?: unknown, user?: string) => fetch(base + '/api/account/package-uploads' + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { ...headers(user), 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const command = { opId: randomUUID(), filename: 'backup.zip', ...content };
  try {
    const reservation = await call('', command); assert.equal(reservation.status, 201); assert.equal((await reservation.json()).state, 'reserved');
    assert.equal((await (await call('', command)).json()).id, command.opId);
    assert.equal((await call('', { ...command, filename: 'changed.zip' })).status, 409);
    assert.equal((await call('/' + command.opId, undefined, 'other')).status, 404);
    async function* incrementalBody() { yield bytes.subarray(0, 17); await contentEntered; yield bytes.subarray(17); }
    const response = await fetch(base + '/api/account/package-uploads/' + command.opId + '/content', {
      method: 'POST', headers: { ...headers(), 'content-type': 'application/zip' }, body: incrementalBody() as any,
      duplex: 'half', signal: AbortSignal.timeout(5000) } as RequestInit);
    assert.equal(response.status, 200); const ready = await response.json();
    assert.equal(ready.state, 'ready'); assert.equal(ready.preview.integrity, 'missing_proof'); assert.equal(observedStreaming, true);
    assert.equal(writes, 1); assert.equal(JSON.stringify(ready).includes('objectName'), false);
    assert.deepEqual(await readdir(spoolRoot), []);
    await uploads.receive('recipient', command.opId, Readable.from([bytes]), new AbortController().signal); assert.equal(writes, 1);
    const replay = await fetch(base + '/api/account/package-uploads/' + command.opId + '/content', {
      method: 'POST', headers: { ...headers(), 'content-type': 'application/zip' }, body: bytes });
    assert.equal(replay.status, 200); assert.equal((await replay.json()).id, command.opId); assert.equal(writes, 1);
    const opened = await uploads.open('recipient', command.opId, new AbortController().signal);
    assert.equal(opened.reader.manifestSha256, ready.preview.manifestSha256); const scope = opened.job.scope; await opened.dispose();
    const codec = createFirestoreRestoreCodec(options), [path, data] = [...fixture.records].find(([path]) => path.includes('_handover_uploads/'))!;
    const decoded = codec.decode({ path, data });
    const recovered = codec.decode(codec.transform(decoded, { newEpochByWorkspace: new Map([[scope.workspaceId, randomUUID()]]),
      generation: randomUUID(), photoDescriptors: new Map() }));
    assert.equal((recovered.value as any).state, 'expired'); assert.equal((recovered.value as any).preview, null);
    assert.deepEqual((recovered.value as any).artifact, opened.job.artifact);
    const cancel = { opId: randomUUID(), expectedVersion: ready.version };
    assert.equal((await (await call('/' + command.opId + '/cancel', cancel)).json()).state, 'cancelled');
    await assert.rejects(uploads.open('recipient', command.opId, new AbortController().signal), { code: 'package_upload_not_ready' });
    assert.equal((await uploads.cleanup(scope, command.opId, new AbortController().signal)).state, 'deferred');
    now += 600_001;
    assert.equal((await uploads.cleanup(scope, command.opId, new AbortController().signal)).state, 'completed'); assert.equal(stored.size, 0);
    // A late successful object write must survive as a cleanup obligation after cancellation.
    const second = await uploads.create('recipient', { ...command, opId: randomUUID() });
    afterPut = async () => { const current = await uploads.get('recipient', second.id); await uploads.cancel('recipient', second.id, { opId: randomUUID(), expectedVersion: current.version }); };
    await assert.rejects(uploads.receive('recipient', second.id, Readable.from([bytes]), new AbortController().signal), { code: 'package_upload_stopped' });
    assert.equal(stored.size, 1); assert.equal((await uploads.get('recipient', second.id)).state, 'cancelled');
    now += 600_001;
    assert.equal((await uploads.cleanup(scope, second.id, new AbortController().signal)).state, 'completed'); assert.equal(stored.size, 0);
    assert.deepEqual(await readdir(spoolRoot), []);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});

test('restore preparation preserves live upload cleanup newer than the snapshot, including a later account', async () => {
  const fixture = serialFirestoreFixture(), options = { database: fixture.database, cipher: createStorageCipher(Buffer.alloc(32, 68)),
    projectId: 'demo-upload-restore', namespace: 'unit_upload_restore' };
  const authority = createFirestoreAuthority(options), generation = randomUUID();
  await authority.initializeControl({ enabled: true, generation });
  const snapshot = () => [...fixture.records].map(([path, data]) => ({ path, data: structuredClone(data) }));
  const beforeAccount = snapshot(), userId = 'later-owner', email = 'later-owner@example.test';
  await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
  await authority.admitIdentity({ userId, email, emailVerified: true });
  await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const uploads = createFirestoreHandoverUploads(options), id = randomUUID(), child = randomUUID();
  await uploads.create(userId, { opId: id, filename: 'backup.zip', bytes: 32, sha256: 'a'.repeat(64) });
  const reserved = snapshot(), claim = (await uploads.claim(userId, id))!; await uploads.beforeObject(claim);
  const artifact = { objectName: 'synthetic-immutable-upload', generation: '10000000000000001', bytes: 32,
    sha256: 'a'.repeat(64), cipherSha256: 'b'.repeat(64) };
  await uploads.publish(claim, artifact, { manifestSha256: 'c'.repeat(64), integrity: 'missing_proof', children: [{ id: child, displayName: 'Source child' }], coverage: [],
    header: { format: 'yuyoufang-data', version: 1, packageId: randomUUID(), packageVersion: 1, createdAt: new Date().toISOString(), purpose: 'backup',
      source: { serverId: 'https://source.test', accountId: 'source' }, selection: { childIds: [child], modules: ['profile'], period: null } } });
  const ready = snapshot(), paused = serialFirestoreFixture();
  await createFirestoreAuthority({ ...options, database: paused.database }).initializeControl({ enabled: false, generation });
  const codec = createFirestoreRestoreCodec(options), control = [...paused.records].map(([path, data]) => ({ path, data }))[0];
  for (const source of [reserved, beforeAccount]) {
    const plan = prepareFirebaseRestore(options, { restoreId: randomUUID(), targetDatabaseId: 'synthetic-upload-target', sourceGeneration: generation,
      documents: source.map(row => row.path === control.path ? control : row), liveDocuments: ready.map(row => row.path === control.path ? control : row),
      authUsers: [{ userId, email, disabled: false, emailVerified: true }], erasures: [], photoDescriptors: new Map(), erasureDescriptors: new Map() });
    const upload = plan.records.filter(row => row.path.includes('_handover_uploads/')).map(row => codec.decode(row).value as any)[0];
    assert.ok(upload); assert.equal(upload.state, 'expired'); assert.equal(upload.uploadStarted, true);
    assert.deepEqual(upload.artifact, artifact); assert.deepEqual(upload.scope, claim.scope);
  }
});
