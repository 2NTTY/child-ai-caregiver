import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeFirebaseStorageKey, readFirebaseStorageKey } from '../server/firebase-storage-key.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';

test('Firebase Secret Manager input is exact and remains usable after transient key cleanup', async () => {
  const encoded = Buffer.alloc(32, 7).toString('base64');
  const key = await readFirebaseStorageKey({ YUBAN_FIREBASE_STORAGE_KEY: encoded });
  const cipher = createStorageCipher(key); key.fill(0);
  const encrypted = cipher.encrypt('synthetic only', 'scope');
  assert.equal(cipher.decrypt(encrypted, 'scope'), 'synthetic only');
  assert.throws(() => cipher.decrypt(encrypted, 'other-scope'));
  for (const value of [encoded + '\n', encoded.slice(1), Buffer.alloc(31).toString('base64'), '']) {
    assert.throws(() => decodeFirebaseStorageKey(value), { message: 'Storage key unavailable or invalid' });
  }
  await assert.rejects(readFirebaseStorageKey({ YUBAN_FIREBASE_STORAGE_KEY: encoded, STORAGE_KEY_FILE: 'unused' }), /Ambiguous/);
  await assert.rejects(readFirebaseStorageKey({}), /Storage key unavailable or invalid/);
});
