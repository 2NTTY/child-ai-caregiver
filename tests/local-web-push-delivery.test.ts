import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomUUID } from 'node:crypto';
import { createLocalAgentDelivery } from '../server/local-agent-delivery.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';

test('local web chat captures only its reference and never reads or stores the private preview', async () => {
  const { database, records } = firestoreDomainFixture(), projectId = 'demo-web-chat', namespace = 'local_agent';
  const cipher = createStorageCipher(Buffer.alloc(32, 81));
  const env = { YUYF_LOCAL_DEVELOPMENT: '1', NODE_ENV: 'development', HOST: '127.0.0.1',
    SERVER_ORIGIN: 'http://127.0.0.1:7300', WEB_ORIGIN: 'http://127.0.0.1:7300',
    GCP_PROJECT_ID: projectId, FIREBASE_DATABASE_ID: '(default)', FIREBASE_NAMESPACE: namespace,
    FIREBASE_PHOTO_BUCKET: projectId + '-private', FIREBASE_ERASURE_BUCKET: projectId + '-journal',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:7302', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:7303',
    FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:7304', STORAGE_EMULATOR_HOST: 'http://127.0.0.1:7304',
    WEB_PUSH_ENABLED: 'false', ANDROID_PUSH_ENABLED: 'false', TELEGRAM_ENABLED: 'false',
    FIREBASE_AUTH_EMAIL_ENABLED: 'false', YUBAN_FIREBASE_STORAGE_KEY: Buffer.alloc(32, 81).toString('base64') };
  const local = createLocalAgentDelivery({ database, projectId, namespace, cipher }, env);
  const key = createECDH('prime256v1'); key.setPrivateKey(Buffer.alloc(32, 2));
  const subscription = { endpoint: 'https://web.push.apple.com/synthetic-token', expirationTime: null,
    keys: { p256dh: key.getPublicKey().toString('base64url'), auth: Buffer.alloc(16, 3).toString('base64url') } };
  const payload = { v: 2, kind: 'chat', bindingId: randomUUID(), bindingVersion: 1, deliveryId: randomUUID() } as const;
  let authorized = 0;
  const result = await local.adapters.pushGateway.send(subscription, payload, new AbortController().signal,
    async () => { authorized++; return true; }, () => { throw Error('PRIVATE preview must not be read'); });
  assert.equal(result.reason, 'local_preview_not_sent'); assert.equal(authorized, 1); assert.equal(records.size, 1);
  const [path, row] = [...records][0]!;
  const saved = JSON.parse(cipher.decrypt(row.ciphertext,
    JSON.stringify(['local-inbox/1', projectId, namespace, path.split('/').at(-1)])));
  assert.equal(saved.kind, 'chat'); assert.deepEqual(saved.reference, payload);
  assert.equal(JSON.stringify(saved).includes('PRIVATE'), false);
  const revoked = await local.adapters.pushGateway.send(subscription, { ...payload, deliveryId: randomUUID() },
    new AbortController().signal, async () => false);
  assert.equal(revoked.reason, 'revoked'); assert.equal(records.size, 1);
});
