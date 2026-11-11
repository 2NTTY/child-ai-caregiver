import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createKnowledgeTransfers } from '../server/firestore-knowledge-transfers.ts';
import { createFirestoreAdmin } from '../server/firestore-admin.ts';
import { createFirebaseRequestHandler } from '../server/firebase-app.ts';
import { readAiConfig } from '../server/ai-config.ts';

test('an administrator can inspect and control the same public import as the CLI', async () => {
  const { database, records } = serialFirestoreFixture();
  const domain = { database, cipher: createStorageCipher(Buffer.alloc(32, 36)), namespace: 'test_public_admin', projectId: 'demo-public-admin' };
  const authority = createFirestoreAuthority(domain);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  const ledger = createKnowledgeTransfers(domain, tx => authority.readControl(tx));
  const admin = createFirestoreAdmin(domain, readAiConfig({ AI_ENABLED: 'false' }), undefined, undefined, ledger);
  const uid = 'admin:example', origin = 'https://example.test';
  let actor = uid;
  const session = async () => ({ user: { id: actor } });
  const handle = createFirebaseRequestHandler({ authority, admin, auth: { getSession: session, assertRecentReauthentication: session, handler: async () => new Response(null, { status: 404 }) },
    publicOrigin: origin, adminUid: uid, mailConfigured: true });
  const call = (path, body, source = origin) => handle(new Request(origin + '/api/admin/knowledge-transfers' + path, {
    method: body ? 'POST' : 'GET', headers: { 'x-expected-user-id': actor, origin: source, 'content-type': 'application/json' },
    ...(body && { body: JSON.stringify(body) }),
  }));
  const digest = n => n.toString(16).padStart(64, '0');
  const legacy = await ledger.start(digest(0), 1, 'cli');
  const oldRow = [...records].find(([path]) => path.startsWith('test_public_admin_knowledge_transfers/'))[1];
  delete oldRow.transferDigest;
  for (let n = 1; n <= 21; n++) await ledger.start(digest(n), 22, 'cli');
  actor = 'other'; assert.equal((await call('')).status, 403); actor = uid;
  const page = await call(''); assert.equal(page.status, 200);
  const { items, nextCursor } = await page.json();
  assert.deepEqual(items.map(row => row.id), Array.from({ length: 20 }, (_, i) => digest(i + 1)));
  assert.deepEqual((await (await call('?cursor=' + nextCursor)).json()).items.map(row => row.id), [digest(21)]);
  assert.equal((await (await call('/' + legacy.id)).json()).batch.id, legacy.id);
  assert.equal((await call('/' + digest(99))).status, 404);
  const id = digest(5), entry = { sourceId: 'official-guide', versionHash: digest(60) };
  for (let n = 0; n < 21; n++) {
    const job = await ledger.get(id);
    await database.runTransaction(tx => ledger.fence(job, entry, 'cli')(tx, {
      sourceId: entry.sourceId, hash: entry.versionHash, versionId: randomUUID(), unchanged: n > 0, state: 'draft',
    }));
  }
  const detail = await (await call('/' + id)).json();
  assert.equal(detail.items.length, 20); assert.equal(detail.nextFrom, 20);
  assert.equal(detail.batch.next, 21); assert.ok(!('generation' in detail.batch));
  const tail = await (await call('/' + id + '?from=20')).json();
  assert.deepEqual(tail.items.map(row => row.index), [20]); assert.equal(tail.nextFrom, null);
  const change = { expectedRevision: detail.batch.revision };
  assert.equal((await call('/' + id + '/stop', change, 'https://other.test')).status, 403);
  const stopped = await (await call('/' + id + '/stop', change)).json();
  assert.equal(stopped.batch.state, 'stopped');
  assert.equal((await call('/' + id + '/resume', change)).status, 409);
  const resumed = await call('/' + id + '/resume', { expectedRevision: stopped.batch.revision });
  assert.equal((await resumed.json()).batch.next, 21);
  assert.equal((await ledger.get(id)).state, 'ready');
});
