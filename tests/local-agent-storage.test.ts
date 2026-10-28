import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

test('local package streams share immutable locks, pin exact generations and release cancellation without widening photo limits', async context => {
  const env = { NODE_ENV: 'development', YUYF_LOCAL_DEVELOPMENT: '1', HOST: '127.0.0.1', PORT: '23000',
    SERVER_ORIGIN: 'http://127.0.0.1:23000', WEB_ORIGIN: 'http://127.0.0.1:23000',
    GCP_PROJECT_ID: 'demo-local-agent', FIREBASE_DATABASE_ID: '(default)', FIREBASE_NAMESPACE: 'local_agent',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:23002', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:23003',
    FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:23004', STORAGE_EMULATOR_HOST: 'http://127.0.0.1:23004',
    FIREBASE_PHOTO_BUCKET: 'demo-local-agent-private', FIREBASE_ERASURE_BUCKET: 'demo-local-agent-journal',
    WEB_PUSH_ENABLED: 'false', ANDROID_PUSH_ENABLED: 'false', TELEGRAM_ENABLED: 'false', FIREBASE_AUTH_EMAIL_ENABLED: 'false' };
  const generation = '9007199254740993123', name = 'packages/v1/synthetic/package';
  const rows = new Map<string, { generation: string; size: string }>();
  let uploads = 0, saves = 0, transferred = 0, media = 0, deletes = 0;
  let activeUpload: Writable | undefined;
  const chunk = Buffer.alloc(1024 * 1024, 7);
  function* chunks(count: number) { for (let i = 0; i < count; i++) yield chunk; }
  context.mock.module('@google-cloud/storage', { namedExports: { Storage: class {
    constructor(options: Record<string, unknown>) {
      assert.equal(options.apiEndpoint, 'http://127.0.0.1:23004'); assert.equal(options.useAuthWithCustomEndpoint, false);
      assert.deepEqual(options.retryOptions, { autoRetry: false });
    }
    bucket(bucket: string) { return { file(object: string) { const key = bucket + '/' + object; return {
      async getMetadata() { const row = rows.get(key); if (!row) throw Object.assign(new Error('missing'), { code: 404 }); return [{ ...row }]; },
      async save(bytes: Buffer) { saves++; rows.set(key, { generation, size: String(bytes.length) }); },
      createWriteStream(options: { timeout?: number; preconditionOpts?: { ifGenerationMatch?: number } }) {
        assert.equal(options.timeout, 300000); assert.equal(options.preconditionOpts?.ifGenerationMatch, 0); uploads++;
        let bytes = 0;
        activeUpload = new Writable({ write(part: Buffer, _encoding, callback) { bytes += part.length; transferred += part.length; callback(); },
          final(callback) { setImmediate(() => { rows.set(key, { generation, size: String(bytes) }); callback(); }); } });
        return activeUpload;
      },
    }; } }; }
  } } });
  context.mock.method(globalThis, 'fetch', async (input: string | URL | Request, options?: RequestInit) => {
    const url = new URL(String(input)); assert.equal(url.origin, 'http://127.0.0.1:23004');
    assert.equal(decodeURIComponent(url.pathname.split('/o/')[1]), name);
    if (options?.method === 'DELETE') {
      assert.equal(url.searchParams.get('ifGenerationMatch'), generation);
      deletes++; rows.delete(env.FIREBASE_PHOTO_BUCKET + '/' + name); return new Response(null, { status: 204 });
    }
    media++; return new Response(Readable.toWeb(Readable.from(chunks(41))) as ReadableStream);
  });
  const { createLocalAgentBuckets } = await import('../server/local-agent-storage.ts');
  const buckets = createLocalAgentBuckets(env), signal = new AbortController().signal;
  assert.equal(typeof buckets, 'function');
  const bucket = buckets.handover(env.FIREBASE_PHOTO_BUCKET);
  assert.throws(() => buckets.handover(env.FIREBASE_ERASURE_BUCKET));
  assert.throws(() => buckets.handover('unknown'));
  assert.equal(await bucket.metadata(name, signal), null);
  const options = { resumable: false, preconditionOpts: { ifGenerationMatch: 0 } };
  const first = pipeline(Readable.from(chunks(41)), bucket.createWrite(name, options));
  const duplicate = pipeline(Readable.from([Buffer.from('replacement')]), bucket.createWrite(name, options));
  const duplicateRejected = assert.rejects(duplicate, { code: 412 });
  await first; await duplicateRejected; assert.equal(uploads, 1); assert.equal(transferred, 41 * chunk.length);
  assert.equal((await bucket.metadata(name, signal) as { generation: string }).generation, generation);
  await assert.rejects(buckets(env.FIREBASE_PHOTO_BUCKET).writeNew(name, Buffer.from('replacement'), options), { code: 412 });
  await assert.rejects(buckets(env.FIREBASE_PHOTO_BUCKET).writeNew('photo-too-large', Buffer.alloc(40 * 1024 * 1024 + 1), options), { code: 400 });
  assert.equal(saves, 0);
  let readBytes = 0;
  await pipeline(bucket.readPinned(name, generation, signal), new Writable({ write(part: Buffer, _encoding, callback) { readBytes += part.length; callback(); } }));
  assert.equal(readBytes, 41 * chunk.length); assert.equal(media, 1);
  await assert.rejects(pipeline(bucket.readPinned(name, '9007199254740993124', signal), new Writable({ write(_part, _encoding, callback) { callback(); } })), { code: 412 });
  await assert.rejects(bucket.removePinned(name, '9007199254740993124', signal), { code: 412 }); assert.equal(deletes, 0);
  const pendingSource = new Readable({ read() { this.push(chunk); this._read = () => {}; } });
  const cancel = new AbortController(), writing = pipeline(pendingSource, bucket.createWrite('packages/v1/synthetic/cancelled', options), { signal: cancel.signal });
  await new Promise(resolve => setImmediate(resolve));
  const metadataCancel = new AbortController(), queuedMetadata = bucket.metadata('packages/v1/synthetic/cancelled', metadataCancel.signal);
  const metadataRejected = assert.rejects(queuedMetadata, { name: 'AbortError' }); metadataCancel.abort(); await metadataRejected;
  cancel.abort(); await assert.rejects(writing, { name: 'AbortError' }); assert.equal(activeUpload?.destroyed, true);
  assert.equal(await bucket.metadata('packages/v1/synthetic/cancelled', signal), null);
  const oversized = pipeline(Readable.from(chunks(257)), bucket.createWrite('packages/v1/synthetic/oversized', options));
  await assert.rejects(oversized, { code: 413 });
  assert.equal(await bucket.metadata('packages/v1/synthetic/oversized', signal), null);
  await bucket.removePinned(name, generation, signal); assert.equal(deletes, 1); assert.equal(await bucket.metadata(name, signal), null);
});
