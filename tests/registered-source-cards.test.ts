import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { registeredSourceCommandSchema, sourceCardAllowsUrl } from '../src/shared/registered-source-card.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreRegisteredSourceCards } from '../server/firestore-registered-source-cards.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { discardedRestoreKinds } from '../server/firestore-restore-operation-records.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';

const settings = { name: 'Synthetic bulletin', kind: 'bulletin' as const, url: 'https://publisher.example.org/news', frequencyMinutes: 15 };
async function fixture() {
  const fake = firestoreDomainFixture();
  let now = Date.parse('2026-11-01T01:00:00Z');
  const options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 77)), projectId: 'source-card-test',
    namespace: 'source_card_test', serverClock: () => now };
  const authority = createFirestoreAuthority(options);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  for (const id of ['alice', 'bob']) {
    const email = id + '@example.test';
    await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(now + 86400000).toISOString() });
    await authority.admitIdentity({ userId: id, email, emailVerified: true });
    await authority.acknowledge({ userId: id, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  }
  const store = createFirestoreRegisteredSourceCards({ ...options, authority });
  const cardId = randomUUID(), create = { cardId, operationId: randomUUID(), expectedRevision: 0, action: 'create' as const, settings };
  return { fake, store, authority, options, cardId, create, now: () => new Date(now).toISOString(), advance: (minutes: number) => { now += minutes * 60000; } };
}
test('account cards bind writes to the authenticated owner, accept exact retries and fence old settings', async () => {
  const f = await fixture();
  f.fake.loseReply();
  await assert.rejects(f.store.command('alice', f.create), /lost commit/);
  const { card } = await f.store.command('alice', f.create);
  assert.equal(card?.revision, 1);
  assert.equal(card.nextCheckAt, f.now());
  assert.deepEqual((await f.store.list('bob')).items, []);
  assert.equal(await f.store.get('bob', f.cardId), null);
  assert.equal((await f.store.list('alice')).items[0]?.cardId, f.cardId);
  const edit = { cardId: f.cardId, operationId: randomUUID(), expectedRevision: 1, action: 'update' as const, settings: { ...settings, frequencyMinutes: 1 } };
  assert.equal((await f.store.command('alice', edit)).card?.revision, 2);
  await assert.rejects(f.store.command('alice', { ...edit, operationId: randomUUID() }), { code: 'source_card_changed' });
  await assert.rejects(f.store.command('alice', { ...edit, settings }), { code: 'operation_conflict' });
});
test('work claims fence settings, update the schedule and suspend interactive login challenges', async () => {
  const f = await fixture();
  await f.store.command('alice', f.create);
  const op = { action: 'replace' as const, expectedRevision: 1, operationId: randomUUID(), username: 'synthetic-reader', password: 'fixture-secret-73' };
  const { card } = await f.store.credential('alice', f.cardId, op);
  assert.ok(card?.credentialRef);
  assert.equal(JSON.stringify([...f.fake.records.values()]).includes(op.password), false);
  assert.equal(JSON.stringify(await f.store.list('alice')).includes(op.username), false);
  const [candidate] = await f.store.due(10);
  const first = await f.store.claim(candidate!);
  assert.ok(first);
  assert.equal(await f.store.claim(candidate!), null);
  assert.deepEqual(await f.store.credentialFor(first), { kind: 'form', origin: new URL(settings.url).origin, loginUrl: settings.url, username: op.username, password: op.password });
  f.advance(20);
  const second = await f.store.claim((await f.store.due(10))[0]!);
  assert.ok(second);
  assert.equal(second.checkId, first.checkId);
  assert.notEqual(second.leaseToken, first.leaseToken);
  await assert.rejects(f.store.credentialFor(first), { code: 'source_check_expired' });
  await assert.rejects(f.store.finish(first, { status: 'changed' }), { code: 'source_check_expired' });
  await f.store.finish(second, { status: 'needs_login' });
  await f.store.finish(second, { status: 'needs_login' });
  assert.equal((await f.store.get('alice', f.cardId))?.nextCheckAt, null);
  assert.deepEqual(await f.store.due(10), []);
  const rename = await f.store.command('alice', { action: 'update', cardId: f.cardId, expectedRevision: card.revision, operationId: randomUUID(), settings: { ...settings, name: 'Renamed' } });
  assert.equal(rename.card?.nextCheckAt, null);
  await f.store.command('alice', { action: 'check_now', cardId: f.cardId, expectedRevision: rename.card!.revision, operationId: randomUUID() });
  const third = await f.store.claim((await f.store.due(10))[0]!);
  assert.ok(third);
  await f.store.finish(third, { status: 'unchanged', documentCount: 2 });
  const after = await f.store.get('alice', f.cardId);
  assert.equal(after?.lastCheckedAt, f.now());
  assert.equal(Date.parse(after!.nextCheckAt!) - Date.parse(f.now()), 15 * 60000);
  const updated = await f.store.command('alice', { action: 'update', cardId: f.cardId, operationId: randomUUID(), expectedRevision: after!.revision,
    settings: { ...settings, url: 'https://different.example.org/news' } });
  assert.equal(updated.card?.credentialRef, null);
  assert.equal([...f.fake.records.keys()].filter(path => path.includes('_source_credentials/')).length, 0);
});
test('pausing fences an in-flight download and restore requires fresh owner authorization', async () => {
  const f = await fixture(); await f.store.command('alice', f.create);
  const login = { action: 'replace', expectedRevision: 1, operationId: randomUUID(), username: 'reader', password: 'fixture',
    loginUrl: 'https://publisher.example.org/login' };
  await assert.rejects(f.store.credential('alice', f.cardId, { ...login, loginUrl: 'https://different.example.org/login' }), { code: 'source_login_origin' });
  await f.store.credential('alice', f.cardId, login);
  await assert.rejects(f.store.credential('alice', f.cardId, { ...login, password: 'different-fixture' }), { code: 'operation_conflict' });
  const job = await f.store.claim((await f.store.due(1))[0]!); assert.ok(job);
  const codec = createFirestoreRestoreCodec(f.options);
  const decoded = [...f.fake.records].filter(([path]) => /_source_(?:cards|card_ops|credentials)\//u.test(path))
    .map(([path, data]) => codec.decode({ path, data }));
  assert.ok(decoded.some(row => row.context.kind === 'registered-source-credential' && discardedRestoreKinds.has(row.context.kind)));
  const original = decoded.find(row => row.context.kind === 'registered-source-card')!;
  assert.equal(original.context.family, 'domain');
  if (original.context.family !== 'domain') throw new Error('Missing source card');
  const { workspaceId } = original.context.scope, storageEpoch = randomUUID();
  const restored = codec.transform(original, { generation: randomUUID(), newEpochByWorkspace: new Map([[workspaceId, storageEpoch]]), photoDescriptors: new Map() });
  const value = codec.decode({ path: restored.path, data: restored.data }).value as { card: { enabled: boolean; credentialRef: string | null }; lease: unknown };
  assert.deepEqual([value.card.enabled, value.card.credentialRef, value.lease, restored.data.dueAt], [false, null, null, undefined]);
  const off = await f.store.command('alice', { action: 'set_enabled', enabled: false, cardId: f.cardId, expectedRevision: 2, operationId: randomUUID() });
  assert.equal(off.card?.nextCheckAt, null);
  let ran = false;
  await assert.rejects(f.store.withCurrentCheck(job, async () => { ran = true; }), { code: 'source_check_expired' });
  assert.equal(ran, false);
  await f.store.command('alice', { action: 'remove', cardId: f.cardId, expectedRevision: off.card!.revision, operationId: randomUUID() });
  assert.deepEqual(await f.store.list('alice'), { items: [], nextCursor: null });
  assert.deepEqual(await f.store.due(1), []);
  assert.equal(await f.store.get('alice', f.cardId), null);
  assert.equal((await f.store.command('alice', f.create)).card, null);
  await assert.rejects(f.store.command('alice', { ...f.create, operationId: randomUUID() }), { code: 'source_card_not_found' });
});
test('a revoked account cannot occupy the first due slot indefinitely', async () => {
  const f = await fixture(); await f.store.command('alice', f.create); f.advance(1);
  await f.store.command('bob', { ...f.create, cardId: randomUUID(), operationId: randomUUID() });
  await f.authority.assertSessionAdmission('alice', { email: 'alice@example.test', emailVerified: false });
  const [denied] = await f.store.due(1); assert.equal(denied?.ownerUserId, 'alice');
  assert.equal(await f.store.claim(denied!), null);
  const [available] = await f.store.due(1); assert.equal(available?.ownerUserId, 'bob');
  assert.ok(await f.store.claim(available!));
});
test('assistant commands reject credentials, private addresses and reusable URL tokens', () => {
  const base = { action: 'create', expectedRevision: 0, cardId: randomUUID(), operationId: randomUUID(), settings };
  for (const url of ['http://publisher.example.org', 'https://name:pass@publisher.example.org/', 'https://127.0.0.1/', 'https://publisher.example.org/?access_token=example']) {
    assert.equal(registeredSourceCommandSchema.safeParse({ ...base, settings: { ...settings, url } }).success, false);
  }
  assert.equal(registeredSourceCommandSchema.safeParse({ ...base, password: 'unexpected' }).success, false);
  assert.equal(sourceCardAllowsUrl(settings, '/news/article#section'), true);
  assert.equal(sourceCardAllowsUrl(settings, '/newsletter'), false);
  assert.equal(sourceCardAllowsUrl(settings, '/news/%2f..%2fprivate'), false);
  assert.equal(sourceCardAllowsUrl({ ...settings, allowedPath: '/documents/' }, '/documents/leaflet.pdf'), true);
  assert.equal(sourceCardAllowsUrl({ ...settings, allowedPath: '/' }, 'https://other.example.org/doc'), false);
  assert.equal(sourceCardAllowsUrl({ ...settings, kind: 'document' }, settings.url + '?version=other'), false);
  for (const kind of ['document', 'directory', 'bulletin']) {
    const parsed = registeredSourceCommandSchema.parse({ ...base, settings: { name: settings.name, kind, url: settings.url } });
    assert.equal(parsed.action === 'create' && parsed.settings.frequencyMinutes, kind === 'bulletin' ? 1440 : 10080);
  }
});
