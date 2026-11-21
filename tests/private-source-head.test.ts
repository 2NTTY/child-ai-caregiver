import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreRegisteredSourceCards } from '../server/firestore-registered-source-cards.ts';
import { createFirestoreSourceCardDocuments } from '../server/firestore-source-card-documents.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { FirestoreDomainData, firestoreDomainHash } from '../server/firestore-domain-data.ts';
import { sourceCardDocumentRecord } from '../server/source-card-document-record.ts';
import { sourceCardRecord } from '../server/registered-source-records.ts';
import { createFirestoreBackgroundQueue, firestoreBackgroundReference, readFirestoreBackgroundClaim, type FirestoreBackgroundDelivery } from '../server/firestore-background-work.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';

const settings = { name: 'Synthetic document', kind: 'document' as const, url: 'https://publisher.example.org/notice.txt', frequencyMinutes: 15 };
async function fixture() {
  const fake = firestoreDomainFixture();
  let clock = Date.now();
  const options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 79)), projectId: 'source-head-test',
    namespace: 'source_head_test', serverClock: () => clock };
  const authority = createFirestoreAuthority(options);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  for (const userId of ['alice', 'bob']) {
    const email = userId + '@example.test';
    await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(clock + 86400000).toISOString() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  }
  const cards = createFirestoreRegisteredSourceCards({ ...options, authority }), cardId = randomUUID();
  await cards.command('alice', { action: 'create', operationId: randomUUID(), cardId, expectedRevision: 0, settings });
  const documents = createFirestoreSourceCardDocuments(options, cards), codec = createFirestoreRestoreCodec(options), data = new FirestoreDomainData(options);
  const decoded = () => [...fake.records].filter(([path]) => /_source_cards\/|_source_card_documents\/|_background_work\//u.test(path))
    .map(([path, value]) => ({ path, record: codec.decode({ path, data: value }) }));
  const jobs = () => decoded().filter(r => r.record.context.kind === 'background-work').map(r => r.record.value as any);
  const head = () => decoded().find(r => (r.record.value as any).kind === 'head')!;
  const access = () => (decoded().find(r => r.record.context.kind === 'registered-source-card')!.record.value as any).accessRevision ?? 1;
  async function command(action: object) {
    const card = await cards.get('alice', cardId);
    return cards.command('alice', { cardId, operationId: randomUUID(), expectedRevision: card!.revision, ...action });
  }
  async function claim() { const job = await cards.claim((await cards.due())[0]!); assert.ok(job); return job; }
  function original(text = 'Synthetic notice A') {
    const bytes = Buffer.from(text);
    return { url: settings.url, mimeType: 'text/plain', bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  async function ingest(text?: string) {
    const job = await claim(); await documents.ingest(job, [original(text)], AbortSignal.timeout(10000));
    await cards.finish(job, { status: 'changed' }); return job;
  }
  function rewrite(row: ReturnType<typeof head>, value: unknown) {
    const c = row.record.context; if (c.family !== 'domain') throw Error('Expected domain');
    const schema = c.kind === 'source-card-document' ? sourceCardDocumentRecord : sourceCardRecord;
    const prior = fake.records.get(row.path);
    fake.records.set(row.path, { ...prior, ...data.seal(c.kind, c.id, c.scope, schema as any, value, c.recordVersion) });
  }
  return { fake, cards, cardId, documents, options, authority, decoded, jobs, head, access, command, claim, original, ingest, rewrite,
    advance: () => { clock += 16 * 60000; } };
}

test('index authorization advances only when source access changes and survives scheduling writes', async () => {
  const f = await fixture();
  assert.equal(f.access(), 1);
  await f.command({ action: 'update', settings: { ...settings, name: 'Renamed', frequencyMinutes: 30 } });
  await f.command({ action: 'check_now' }); assert.equal(f.access(), 1);
  await f.command({ action: 'set_enabled', enabled: false }); assert.equal(f.access(), 2);
  await assert.rejects(f.documents.withIndexCard('alice', f.cardId, async () => true), { code: 'source_document_unavailable' });
  await f.command({ action: 'set_enabled', enabled: true }); assert.equal(f.access(), 3);
  const job = await f.claim(); await f.cards.renew(job); assert.equal(f.access(), 3);
  await f.cards.finish(job, { status: 'failed' }); assert.equal(f.access(), 3);
  await f.command({ action: 'check_now' }); const login = await f.claim();
  await f.cards.finish(login, { status: 'needs_login' }); await f.cards.finish(login, { status: 'needs_login' });
  assert.equal(f.access(), 4);
  await assert.rejects(f.documents.withIndexCard('alice', f.cardId, async () => true), { code: 'source_document_unavailable' });
  let revision = (await f.cards.get('alice', f.cardId))!.revision;
  await f.cards.credential('alice', f.cardId, { action: 'replace', expectedRevision: revision, operationId: randomUUID(), username: 'reader', password: 'synthetic' });
  assert.equal(f.access(), 5);
  revision = (await f.cards.get('alice', f.cardId))!.revision;
  await f.cards.credential('alice', f.cardId, { action: 'clear', expectedRevision: revision, operationId: randomUUID() });
  assert.equal(f.access(), 6);
  await f.command({ action: 'update', settings: { ...settings, url: 'https://publisher.example.org/other.txt' } }); assert.equal(f.access(), 7);
});

test('head and index job commit together, exact retries reuse identity, and old editions remain readable', async () => {
  const f = await fixture(), job = await f.claim();
  let calls = 0;
  const documents = createFirestoreSourceCardDocuments(f.options, { async withCurrentCheck(job, fn) {
    if (++calls === 3) f.fake.failCommit();
    return f.cards.withCurrentCheck(job, fn);
  } });
  await assert.rejects(documents.ingest(job, [f.original()], AbortSignal.timeout(10000)), /commit failed/);
  assert.equal(f.head(), undefined); assert.equal(f.jobs().length, 0);
  await f.documents.ingest(job, [f.original()], AbortSignal.timeout(10000));
  const first = f.head().record.value as any;
  const authorityTag = await f.authority.runTransaction('alice', null, async b => firestoreDomainHash([b.scope, b.generation, b.authorizationVersion]));
  assert.deepEqual(first.rag, { accessRevision: 1, incarnation: job.checkId, authorityTag });
  const [index] = f.jobs(); assert.equal(index.kind, 'source-card-index'); assert.equal(index.resourceId, f.cardId);
  assert.deepEqual(JSON.parse(index.basis), [first.documentId, first.version, job.checkId, 1]);
  await f.documents.ingest(job, [f.original()], AbortSignal.timeout(10000)); assert.equal(f.jobs().length, 1);
  await f.cards.finish(job, { status: 'changed' }); f.advance();
  await f.ingest('Synthetic notice B');
  const second = f.head().record.value as any;
  assert.notEqual(second.rag.incarnation, first.rag.incarnation); assert.equal(f.jobs().length, 2);
  const old = await f.documents.read('alice', f.cardId, first.documentId, first.version);
  assert.ok('text' in old.content && old.content.text === 'Synthetic notice A');
  f.advance(); const back = await f.ingest(); const third = f.head().record.value as any;
  assert.equal(third.version, first.version); assert.equal(third.rag.incarnation, back.checkId);
  assert.notEqual(third.rag.incarnation, first.rag.incarnation); assert.equal(f.jobs().length, 3);
  await assert.rejects(f.documents.withIndexHead('bob', f.cardId, first.documentId, async () => true), { code: 'source_document_unavailable' });
  assert.equal(await f.documents.withIndexHead('alice', f.cardId, first.documentId, async (_, head) => head.version), first.version);
});

test('legacy heads are backfilled and pause/re-enable requires a fresh index incarnation', async () => {
  const f = await fixture(); await f.ingest();
  const row = f.head(), { rag: _rag, ...legacy } = row.record.value as any;
  f.rewrite(row, legacy);
  await assert.rejects(f.documents.withIndexHead('alice', f.cardId, legacy.documentId, async () => true), { code: 'source_document_unavailable' });
  const search = await f.documents.search('alice', f.cardId, 'Synthetic'); assert.equal(search.items.length, 1);
  f.advance(); const backfill = await f.ingest();
  assert.equal((f.head().record.value as any).rag.incarnation, backfill.checkId);
  await f.command({ action: 'set_enabled', enabled: false }); await f.command({ action: 'set_enabled', enabled: true });
  await assert.rejects(f.documents.withIndexHead('alice', f.cardId, legacy.documentId, async () => true), { code: 'source_document_unavailable' });
  const fresh = await f.ingest();
  const head = await f.documents.withIndexHead('alice', f.cardId, legacy.documentId, async (_, head) => head);
  const authorityTag = await f.authority.runTransaction('alice', null, async b => firestoreDomainHash([b.scope, b.generation, b.authorizationVersion]));
  assert.deepEqual(head.rag, { accessRevision: 3, incarnation: fresh.checkId, authorityTag });
  await f.documents.withIndexCard('alice', f.cardId, async (b, grant, accessRevision) => {
    assert.equal(await f.documents.readIndexHeadIn(b, f.cardId, grant, accessRevision - 1, legacy.documentId), null);
    assert.equal((await f.documents.readIndexHeadIn(b, f.cardId, grant, accessRevision, legacy.documentId))!.version, head.version);
  });
  const current = f.head();
  f.fake.records.set(current.path, { ...f.fake.records.get(current.path), id: '0'.repeat(64) });
  await assert.rejects(f.documents.withIndexHead('alice', f.cardId, legacy.documentId, async () => true), { code: 'source_document_integrity' });
});

test('a legacy HTML edition keeps its exact original and index when standalone category markup is recognized',async()=>{
  const f = await fixture(), text = 'Keep the two envelopes separate. '.repeat(420).trim(), section = 'First collection';
  async function scan(tag:string,sections:string[],paragraph=text) {
    const job = await f.claim();
    const body = '<article><h1>Envelope lesson</h1><p>'+paragraph+'</p>'+tag+'</article>';
    const original = {...f.original(body),mimeType:'text/html',sections};
    const result = await f.documents.ingest(job,[original],AbortSignal.timeout(10000));
    await f.cards.finish(job,result.result); f.advance();
    return (await f.documents.list('alice',f.cardId)).items[0]!;
  }
  // The prior HTML extractor included standalone category text in the frozen original.
  const legacy = await scan('<span>'+section+'</span>',[section]);
  const oldHead = f.head(), {bodyVersion:_bodyVersion,...oldFields} = oldHead.record.value as any;
  f.rewrite(oldHead,oldFields);
  const renamed = 'New collection';
  const recognized = await scan('<a rel=category href="/group">'+renamed+'</a>',[renamed]);
  assert.equal(recognized.version,legacy.version);
  assert.deepEqual(recognized.categories,{basis:'publisher',labels:[renamed]});
  const removed = await scan('',[]);
  assert.equal(removed.version,legacy.version); assert.equal(f.jobs().length,1);
  const saved = await f.documents.read('alice',f.cardId,legacy.documentId,legacy.version);
  assert.ok('text' in saved.content && text.startsWith(saved.content.text.split('\n\n')[1]!));
  const tail = await f.documents.read('alice',f.cardId,legacy.documentId,legacy.version,{offset:text.length});
  assert.ok('text' in tail.content && tail.content.text.includes(section));
  const revised = await scan('',[],'Spend the coins in the first envelope.');
  assert.notEqual(revised.version,legacy.version); assert.equal(f.jobs().length,2);
});

test('a private index claim requires its own live background lease and leaves the default claim allowlist unchanged', async () => {
  const f = await fixture(); await f.ingest();
  const [work] = f.jobs(), reference = firestoreBackgroundReference(work), data = new FirestoreDomainData(f.options);
  await f.authority.runTransaction('alice', null, async b => {
    assert.equal(await readFirestoreBackgroundClaim(data, b, reference, 'source-card-index'), null);
  });
  const deliveries: FirestoreBackgroundDelivery[] = [];
  const queue = createFirestoreBackgroundQueue({ ...f.options, enabled: true, readControl: tx => f.authority.readControl(tx),
    transport: { async enqueue(value) { deliveries.push(value); return { state: 'confirmed' }; }, probe: () => assert.fail('Unexpected probe') },
    async execute(job) {
      await f.authority.runTransaction('alice', null, async b => {
        assert.equal(await readFirestoreBackgroundClaim(data, b, reference), null);
        assert.equal((await readFirestoreBackgroundClaim(data, b, reference, 'source-card-index'))?.id, job.id);
      });
      return { state: 'completed' };
    } });
  await queue.dispatch(); assert.equal(deliveries.length, 1);
  assert.equal((await queue.process(deliveries[0]!)).state, 'completed');
  await f.authority.runTransaction('alice', null, async b => {
    assert.equal(await readFirestoreBackgroundClaim(data, b, reference, 'source-card-index'), null);
  });
});

test('an authority change or missing authority tag fences old heads until a same-version scan creates a fresh incarnation', async () => {
  const f = await fixture(); await f.ingest();
  const expectedTag = await f.authority.runTransaction('alice', null, async b => firestoreDomainHash([b.scope, b.generation, b.authorizationVersion]));
  let count = 1;
  for (const authorityTag of [undefined, 'f'.repeat(64)]) {
    const row = f.head(), old = row.record.value as any;
    f.rewrite(row, { ...old, rag: { accessRevision: old.rag.accessRevision, incarnation: old.rag.incarnation,
      ...(authorityTag ? { authorityTag } : {}) } });
    await assert.rejects(f.documents.withIndexHead('alice', f.cardId, old.documentId, async () => true), { code: 'source_document_unavailable' });
    f.advance(); const job = await f.claim();
    const result = await f.documents.ingest(job, [f.original()], AbortSignal.timeout(10000));
    const head = await f.documents.withIndexHead('alice', f.cardId, old.documentId, async (_, head) => head);
    assert.equal(head.version, old.version);
    assert.equal(head.rag!.authorityTag, expectedTag);
    assert.equal(head.rag!.incarnation, job.checkId);
    assert.notEqual(head.rag!.incarnation, old.rag.incarnation);
    assert.equal(f.jobs().length, ++count);
    assert.deepEqual(await f.documents.ingest(job, [f.original()], AbortSignal.timeout(10000)), result);
    assert.equal(f.jobs().length, count);
    await f.cards.finish(job, { status: 'unchanged' });
  }
  const stable = (f.head().record.value as any).rag;
  f.advance(); await f.ingest();
  assert.deepEqual((f.head().record.value as any).rag, stable);
  assert.equal(f.jobs().length, count);
});
