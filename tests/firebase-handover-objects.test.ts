import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable, Writable } from 'node:stream';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirebaseHandoverObjects, type HandoverBucketPort } from '../server/firebase-handover-objects.ts';

test('package objects preserve immutable identity, recover a lost reply, and authenticate before releasing a file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'handover-objects-'));
  const objects = new Map<string, { body: Buffer; metadata: Record<string, unknown> }>();
  let writes = 0, loseReply = false, failReadback = false, failReadInit = false;
  const bucket: HandoverBucketPort = {
    async metadata(name) { if (failReadback && objects.has(name)) throw new Error('metadata unavailable'); return objects.get(name)?.metadata ?? null; },
    createWrite(name, options) {
      writes++; const parts: Buffer[] = [];
      assert.equal(options.preconditionOpts?.ifGenerationMatch, 0);
      assert.equal(options.resumable, false);
      return new Writable({ write(chunk, _encoding, callback) { parts.push(Buffer.from(chunk)); callback(); },
        final(callback) {
          if (objects.has(name)) { callback(Object.assign(new Error('exists'), { code: 412 })); return; }
          const body = Buffer.concat(parts);
          objects.set(name, { body, metadata: { name, bucket: 'synthetic-packages', generation: '10000000000000001',
            size: String(body.length), metadata: options.metadata?.metadata } });
          callback(loseReply ? new Error('reply lost after saving') : undefined);
        } });
    },
    readPinned(name, generation) { if (failReadInit) throw new Error('download initialization failed');
      assert.equal(generation, '10000000000000001'); return Readable.from([objects.get(name)!.body]); },
    async removePinned(name, generation) { assert.equal(generation, '10000000000000001'); objects.delete(name); },
  };
  const store = createFirebaseHandoverObjects({ config: { projectId: 'demo-local', namespace: 'test', bucketName: 'synthetic-packages' },
    files: createStorageCipher(randomBytes(32)).files, bucket });
  const scope = { ownerUserId: 'synthetic-owner', workspaceId: randomUUID(), childId: randomUUID(), storageEpoch: randomUUID() };
  const source = join(directory, 'package.zip'), body = randomBytes(2 * 1024 * 1024 + 3);
  const content = { bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') }, packageId = randomUUID();
  try {
    await writeFile(source, body);
    const saved = await store.put({ scope, packageId, source, directory, content });
    assert.equal(writes, 1); assert.equal(saved.generation, '10000000000000001');
    assert.deepEqual(await store.put({ scope, packageId, source, directory, content }), saved);
    assert.equal(writes, 1, 'retry probes the same object and never uploads again');
    const opened = await store.read({ scope, packageId, descriptor: saved, directory });
    assert.deepEqual(await readFile(opened.path), body); await rm(opened.path);
    await assert.rejects(store.read({ scope: { ...scope, ownerUserId: 'another-owner' }, packageId, descriptor: saved, directory }));
    await assert.rejects(store.put({ scope, packageId, source, directory, content: { ...content, sha256: '0'.repeat(64) } }));
    const before = await readdir(directory);
    objects.get(saved.objectName)!.body[40] ^= 1;
    await assert.rejects(store.read({ scope, packageId, descriptor: saved, directory }));
    assert.deepEqual(await readdir(directory), before, 'failed reads release no plaintext or spool files');
    loseReply = true; const secondId = randomUUID();
    await assert.rejects(store.put({ scope, packageId: secondId, source, directory, content }), { code: 'package_object_unknown' });
    assert.equal(writes, 2);
    const recovered = await store.probe({ scope, packageId: secondId, content });
    assert.ok(recovered); assert.equal(writes, 2);
    await store.remove({ scope, packageId: secondId, descriptor: recovered });
    assert.equal(await store.probe({ scope, packageId: secondId, content }), null);
    loseReply = false; failReadback = true;
    const thirdId = randomUUID();
    await assert.rejects(store.put({ scope, packageId: thirdId, source, directory, content }), { code: 'package_object_unknown' });
    failReadback = false; assert.ok(await store.probe({ scope, packageId: thirdId, content }));
    failReadInit = true;
    await assert.rejects(store.read({ scope, packageId, descriptor: saved, directory }), { code: 'package_object_unavailable' });
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(await readdir(directory), before, 'source initialization failure cannot open an unowned spool file');
  } finally { body.fill(0); await rm(directory, { recursive: true, force: true }); }
});
