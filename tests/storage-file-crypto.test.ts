import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStorageCipher, openBuffer, sealBuffer } from '../server/storage-crypto.ts';

test('file encryption retains the existing envelope and releases plaintext only after complete authentication', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'storage-file-'));
  const key = randomBytes(32), cipher = createStorageCipher(key), context = 'synthetic-package:owner:version1';
  const source = join(directory, 'source.bin'), bytes = randomBytes(2 * 1024 * 1024 + 11);
  try {
    await writeFile(source, bytes);
    const encrypted = await cipher.files.encrypt({ source, directory, context, maxBytes: 3 * 1024 * 1024 });
    const envelope = await readFile(encrypted.path);
    assert.deepEqual(openBuffer(envelope, key, context), bytes);
    assert.equal(encrypted.sha256, createHash('sha256').update(envelope).digest('hex'));
    assert.equal(encrypted.bytes, bytes.length + 32);
    const decrypted = await cipher.files.decrypt({ source: encrypted.path, directory, context, maxBytes: 3 * 1024 * 1024 });
    assert.deepEqual(await readFile(decrypted.path), bytes);
    const legacyPath = join(directory, 'old-envelope.bin'); await writeFile(legacyPath, sealBuffer(Buffer.from('existing format'), key, context));
    const legacy = await cipher.files.decrypt({ source: legacyPath, directory, context, maxBytes: 100 });
    assert.equal(await readFile(legacy.path, 'utf8'), 'existing format');
    const before = await readdir(directory);
    await assert.rejects(cipher.files.decrypt({ source: encrypted.path, directory, context: 'wrong owner', maxBytes: 3 * 1024 * 1024 }));
    envelope[envelope.length - 1] ^= 1; await writeFile(encrypted.path, envelope);
    await assert.rejects(cipher.files.decrypt({ source: encrypted.path, directory, context, maxBytes: 3 * 1024 * 1024 }));
    await assert.rejects(cipher.files.encrypt({ source, directory, context, maxBytes: 2 }));
    assert.deepEqual(await readdir(directory), before, 'failure never leaves an unauthenticated plaintext file');
  } finally { key.fill(0); bytes.fill(0); await rm(directory, { recursive: true, force: true }); }
});
