import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { createElement } from 'react';
import { Document, Page, Text, renderToBuffer } from '@react-pdf/renderer';
import JSZip from 'jszip';
import sharp from 'sharp';
import type { fetchPublicSourceResponse, submitSourceLogin } from '../server/public-source-transport.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreRegisteredSourceCards } from '../server/firestore-registered-source-cards.ts';
import { createFirestoreSourceCardDocuments } from '../server/firestore-source-card-documents.ts';
import { createFirestoreBackgroundMaintenance } from '../server/firestore-background-maintenance.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { createFirestoreBackgroundQueue, type FirestoreBackgroundDelivery } from '../server/firestore-background-work.ts';
import { createRegisteredSourceWorker } from '../server/registered-source-worker.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';

test('a scheduled personal card retains mixed editions, resumes its check, and fences credentials and readers', async t => {
  const fake = firestoreDomainFixture(), origin = 'https://publisher.example.org', cardId = randomUUID();
  let clock = Date.now();
  const domain = {
    database: fake.database, projectId: 'demo-source-poll', namespace: 'source_poll',
    cipher: createStorageCipher(Buffer.alloc(32, 32)), serverClock: () => clock
  };
  const authority = createFirestoreAuthority(domain), generation = randomUUID();
  await authority.initializeControl({ enabled: true, generation });
  for (const userId of ['alice', 'bob']) {
    const email = userId + '@example.test';
    await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(clock + 86400_000).toISOString() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  }
  const cards = createFirestoreRegisteredSourceCards({ ...domain, authority });
  await cards.command('alice', {
    action: 'create', operationId: randomUUID(), cardId, expectedRevision: 0,
    settings: { name: 'Synthetic library', kind: 'directory', url: origin + '/portal', allowedPath: '/library', frequencyMinutes: 30 }
  });
  await cards.credential('alice', cardId, { action: 'replace', operationId: randomUUID(), expectedRevision: 1, username: 'fixture-owner', password: 'fixture-password', loginUrl: origin + '/sign-in' });
  const documents = createFirestoreSourceCardDocuments(domain, cards), codec = createFirestoreRestoreCodec(domain);
  const pdf = await renderToBuffer(createElement(Document, {}, createElement(Page, {}, createElement(Text, {}, 'Private PDF notice for the synthetic classroom'))));
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Private Word notice</w:t></w:r></w:p></w:body></w:document>');
  const word = await zip.generateAsync({ type: 'nodebuffer' });
  const png = await sharp({ create: { width: 12, height: 10, channels: 3, background: 'blue' } }).png().toBuffer();
  const original = (name: string, mimeType: string, bytes: Buffer) => ({
    url: origin + '/library/' + name, mimeType, bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'), preview: null
  });
  const notice = (message: string) => original('notice', 'text/html', Buffer.from('<html><title>Notice</title><main><p>' + message + '</p><form><input value="hidden-ticket"/></form></main></html>'));
  const originals = [original('book.pdf', 'application/pdf', pdf),
  original('letter.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', word),
  original('image.png', 'image/png', png), notice('First notice')];
  // The real broker parses the fixture form and files. Only network I/O is substituted.
  let logins = 0, acquisitions = 0, interruptFinish = true, loseBatchAck = true, transient = true;
  let mode: 'files' | 'large' | 'login' | 'pause' = 'files';
  const catalog = Array.from({ length: 36 }, (_, i) => original('entry-' + i, 'text/html',
    Buffer.from('<main><p>Catalogue notice number ' + i + ' for the synthetic library</p></main>')));
  const also = original('also-listed', 'text/html', Buffer.from('<main><a href="' + catalog[0]!.url + '">Repeated catalogue item</a></main>'));
  const oversized = original('oversized.pdf', 'application/pdf', Buffer.alloc(0));
  let includeOversized = false;
  const fetched: string[] = [];
  const batchInputs: { checkId: string; items: { url: string; offset?: number }[] }[] = [];
  const response = (url: string, contentType: string, body: Buffer, status = 200) => ({ status: 'response' as const, response: { url, status, contentType, body } });
  const get: typeof fetchPublicSourceResponse = async (url, validate, _signal, _accept, options) => {
    const target = validate(url);
    const headers = await options?.sessionForGet?.(target);
    if (url === origin + '/sign-in') return response(url, 'text/html', Buffer.from('<form method="post"><input name="user" autocomplete="username"><input name="password" type="password"></form>'));
    assert.equal(headers?.cookie, 'access=synthetic-ticket');
    const library = mode === 'large' ? [...(includeOversized ? [oversized] : []), ...catalog, also] : originals;
    if (url === origin + '/portal') return response(url, 'text/html', Buffer.from('<main>' + library.map(item => '<p><a href="' + item.url + '">Original file</a></p>').join('') + '</main>'));
    if (includeOversized && url === oversized.url) {
      options?.onBodyLimit?.(200);
      return response(url, 'application/pdf', Buffer.alloc(0));
    }
    if (mode === 'large' && url !== also.url) fetched.push(url);
    const item = library.find(item => item.url === url);
    assert.ok(item);
    return response(url, item.mimeType, item.bytes);
  };
  const post: typeof submitSourceLogin = async (url, form, _signal, options) => {
    assert.equal(url.href, origin + '/sign-in');
    assert.ok(form.get('user') === 'fixture-owner' && form.get('password') === 'fixture-password');
    logins++;
    options.receiveCookies?.(url, ['access=synthetic-ticket; Path=/; Secure; HttpOnly']);
    return response(url.href, 'text/html', Buffer.from('<p>Welcome</p>'));
  };
  t.mock.module('../server/public-source-transport.ts', { namedExports: { fetchPublicSourceResponse: get, submitSourceLogin: post } });
  const { acquireSourceCard, acquireSourceCardBatch } = await import('../server/source-card-acquire.ts');
  const worker = createRegisteredSourceWorker({
    ...domain, documents: {
      ...documents, async ingest(...args) {
        const result = await documents.ingest(...args);
        if (mode === 'large' && loseBatchAck && args[1].length && result.pending) {
          loseBatchAck = false;
          throw Error('Synthetic lost acknowledgement after storing originals and frontier');
        }
        return result;
      }
    }, cards: {
      ...cards, async finish(job, result) {
        if (interruptFinish) { interruptFinish = false; throw Error('synthetic transport interruption'); }
        await cards.finish(job, result);
      }
    }, currentAuth: async userId => ({ userId, emailVerified: true, disabled: false }), async acquire(input, access, signal, work) {
      acquisitions++;
      assert.equal(input.cardId, cardId);
      assert.equal(input.entryUrl, origin + '/portal');
      assert.equal(await access.authorize(randomUUID()), false);
      assert.equal(await access.credentialFor!(randomUUID()), null);
      assert.equal(input.login?.url, origin + '/sign-in');
      const credential = await access.credentialFor!(cardId);
      assert.ok(credential?.origin === origin && credential.username === 'fixture-owner' && credential.password === 'fixture-password');
      if (acquisitions === 1) return acquireSourceCard(input, access, signal);
      if (mode === 'large') {
        batchInputs.push({ checkId: work.checkId, items: work.items });
        if (!loseBatchAck && transient) {
          transient = false;
          return { status: 'failed', reason: 'unavailable' };
        }
        // Consume only a prefix once, as an acquisition reaching its byte budget can do.
        const items = loseBatchAck && work.items.length > 3 ? work.items.slice(0, 3) : work.items;
        return acquireSourceCardBatch(input, access, signal, { ...work, items });
      }
      if (mode === 'login') return { status: 'needs_user', reason: 'mfa' };
      if (mode === 'pause') {
        const card = await cards.get('alice', cardId);
        await cards.command('alice', { action: 'set_enabled', enabled: false, operationId: randomUUID(), cardId, expectedRevision: card!.revision });
      }
      return { status: 'ok', originals };
    }
  });
  const deliveries: FirestoreBackgroundDelivery[] = [];
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const queue = createFirestoreBackgroundQueue({
    ...domain, enabled: true, readControl: tx => authority.readControl(tx),
    transport: { async enqueue(request) {
      const [path, data] = [...fake.records].find(([, value]) => value.id === request.id)!;
      const job = codec.decode({ path, data }).value as { kind: string };
      // Index deliveries belong to their own worker; this fixture executes only original acquisition.
      if (job.kind === 'source-card-check') deliveries.push(request);
      else assert.equal(job.kind, 'source-card-index');
      return { state: 'confirmed' };
    }, probe: () => assert.fail('Unexpected probe') }, execute: worker.process
  });
  const maintenance = createFirestoreBackgroundMaintenance({
    ...domain, enabled: true, sourceCards: worker,
    knowledge: { jobs: async () => [] } as never, photos: {} as never, erasures: {} as never, cleanup: {} as never
  });
  let scheduled = false;
  async function deliver() {
    if (!scheduled) { scheduled = true; await maintenance.tick(); }
    else await worker.schedule();
    await queue.dispatch();
    assert.equal(deliveries.length, 1);
    const delivery = deliveries.shift()!;
    const wait = Date.parse(delivery.scheduledAt) - Date.now();
    if (wait > 0) t.mock.timers.tick(wait);
    return queue.process(delivery);
  }
  const checkNow = async () => cards.command('alice', {
    action: 'check_now', operationId: randomUUID(), cardId,
    expectedRevision: (await cards.get('alice', cardId))!.revision
  });
  assert.equal((await deliver()).state, 'unknown');
  clock += 16 * 60000;
  assert.equal((await deliver()).state, 'completed');
  assert.deepEqual([acquisitions, logins, (await cards.get('alice', cardId))?.lastResult],
    [1, 1, { status: 'changed', documentCount: 4, savedDocumentCount: 4, indexedDocumentCount: 3 }]);
  const items = (await documents.list('alice', cardId)).items;
  assert.equal(items.length, 4);
  const hits = await documents.search('alice', cardId, 'Private Word notice');
  const wordHit = hits.items.find(hit => hit.source.mimeType.includes('wordprocessingml'));
  assert.ok(wordHit && wordHit.excerpt.includes('Private Word notice'));
  assert.ok(hits.items.every(hit => hit.source.indexCoverage !== 'original_only'));
  assert.equal(items.find(item => item.mimeType === 'image/png')?.indexCoverage, 'original_only');
  for (const item of items) {
    const { source, content } = await documents.read('alice', cardId, item.documentId, item.version);
    assert.equal(source.url, item.url);
    assert.equal(content.state, 'read');
    if ('text' in content) assert.match(content.text, /Private PDF notice|Private Word notice|First notice/);
    else { assert.equal(content.representation, 'image'); assert.equal(content.data.length > 0, true); }
  }
  const paper = items.find(item => item.mimeType === 'application/pdf')!;
  const native = await documents.read('alice', cardId, paper.documentId, paper.version, { page: 1, nativePdf: true });
  assert.ok('representation' in native.content && native.content.representation === 'pdf_page' && native.content.data.subarray(0, 5).toString() === '%PDF-');
  const bytes = await documents.read('alice', cardId, paper.documentId, paper.version, { byteOffset: 0 });
  assert.ok('representation' in bytes.content && bytes.content.representation === 'original_bytes' && bytes.content.data.equals(pdf));
  const first = items.find(item => item.mimeType === 'text/html')!;
  await assert.rejects(documents.search('bob', cardId, 'notice'), { code: 'source_document_unavailable' });
  await assert.rejects(documents.list('bob', cardId), { code: 'source_document_unavailable' });
  await assert.rejects(documents.read('bob', cardId, first.documentId, first.version), { code: 'source_document_unavailable' });
  const rows = () => [...fake.records.entries()].filter(([path]) => path.startsWith(domain.namespace + '_source_card_documents/'));
  const stored = rows().map(([path, data]) => codec.decode({ path, data }));
  const context = stored[0]!.context;
  if (context.family !== 'domain') throw Error('Expected private data');
  const target = { generation: randomUUID(), newEpochByWorkspace: new Map([[context.scope.workspaceId, randomUUID()]]), photoDescriptors: new Map() };
  for (const original of stored) {
    const restored = codec.transform(original, target);
    assert.deepEqual(codec.decode({ path: restored.path, data: restored.data }).value, original.value);
  }
  const prior = new Map(rows().map(([path, row]) => [path, row.ciphertext]));
  await checkNow(); assert.equal((await deliver()).state, 'completed');
  assert.equal((await cards.get('alice', cardId))?.lastResult?.status, 'unchanged');
  assert.equal(rows().filter(([path, row]) => row.ciphertext !== prior.get(path)).length, 1, 'only the check receipt changes');
  originals[3] = notice('Second notice');
  await checkNow(); await deliver();
  const next = (await documents.list('alice', cardId)).items.find(item => item.documentId === first.documentId)!;
  assert.notEqual(next.version, first.version);
  const old = await documents.read('alice', cardId, first.documentId, first.version);
  assert.equal(old.currentVersion, next.version);
  assert.ok('text' in old.content && old.content.text === 'First notice');
  originals[3] = { ...originals[3]!, url: origin + '/library/notice?X-Amz-Signature=secret-fixture' };
  await checkNow(); await deliver();
  assert.equal((await cards.get('alice', cardId))?.lastResult?.status, 'failed');
  assert.equal((await documents.list('alice', cardId)).items.length, 4);
  mode = 'login'; await checkNow(); await deliver();
  assert.equal((await cards.get('alice', cardId))?.lastResult?.status, 'mfa_required');
  assert.deepEqual(await cards.due(), []);
  mode = 'pause'; await checkNow(); assert.equal((await deliver()).state, 'stopped');
  await assert.rejects(documents.read('alice', cardId, first.documentId, first.version), { code: 'source_document_unavailable' });
  const paused = await cards.get('alice', cardId);
  await cards.command('alice', { action: 'set_enabled', enabled: true, operationId: randomUUID(), cardId, expectedRevision: paused!.revision });
  const partial = await cards.claim((await cards.due())[0]!); assert.ok(partial);
  const controller = new AbortController(), savedRows = rows().length;
  const interrupted = createFirestoreSourceCardDocuments(domain, {
    async withCurrentCheck(job, fn) {
      const result = await cards.withCurrentCheck(job, fn);
      if (rows().length > savedRows + 1) controller.abort();
      return result;
    }
  });
  const large = original('partial.txt', 'text/plain', Buffer.alloc(900000, 65));
  await assert.rejects(interrupted.ingest(partial, [large], controller.signal));
  assert.ok(rows().length > savedRows);
  assert.equal((await documents.list('alice', cardId)).items.length, 4);
  clock += 25 * 3600_000;
  await documents.pruneStaging();
  assert.equal(rows().length, savedRows);
  mode = 'large';
  // The expired staging-only check can resume from its uncommitted first item.
  assert.equal((await deliver()).state, 'pending');
  assert.equal((await deliver()).state, 'unknown');
  const savedAfterLoss = fetched.length;
  assert.equal(savedAfterLoss, 3);
  const partialHead = (await documents.list('alice', cardId)).items.find(item => item.url === catalog[0]!.url);
  assert.ok(partialHead);
  assert.equal((await cards.get('alice', cardId))?.checking, true);
  clock += 16 * 60_000;
  assert.equal((await deliver()).state, 'pending');
  let state = (await deliver()).state;
  for (let batch = 0; state === 'pending' && batch < 50; batch++) state = (await deliver()).state;
  assert.equal(state, 'completed');
  assert.deepEqual((await cards.get('alice', cardId))?.lastResult, {
    status: 'changed', documentCount: 36, savedDocumentCount: 36, indexedDocumentCount: 36
  });
  assert.equal(fetched.length, 36);
  assert.equal(new Set(fetched).size, 36);
  assert.equal(new Set(batchInputs.map(batch => batch.checkId)).size, 1);
  assert.ok(batchInputs.every(batch => batch.items.length <= 8));
  assert.equal(batchInputs.filter(batch => batch.items[0]?.url === origin + '/portal' && !batch.items[0]?.offset).length, 1);
  assert.deepEqual(await cards.due(), []);
  const firstPage = await documents.list('alice', cardId);
  assert.equal(firstPage.items.length, 20);
  const secondPage = await documents.list('alice', cardId, firstPage.nextCursor);
  assert.equal(secondPage.items.length, 20);
  assert.equal(secondPage.nextCursor, null);
  const durable = rows().filter(([path, data]) => {
    const value = codec.decode({ path, data }).value;
    return ['head', 'edition', 'part'].includes((value as { kind: string }).kind);
  }).map(([path, data]) => [path, data.ciphertext] as const);
  includeOversized = true;
  clock += 31 * 60_000;
  assert.equal((await deliver()).state, 'pending');
  assert.notEqual(batchInputs.at(-1)!.checkId, batchInputs[0]!.checkId);
  assert.deepEqual(batchInputs.at(-1)!.items, [{ url: origin + '/portal' }]);
  for (let batch = 0; batch < 50; batch++) {
    const delivered = await deliver();
    if (delivered.state === 'completed') break;
    assert.equal(delivered.state, 'pending');
  }
  assert.deepEqual((await cards.get('alice', cardId))?.lastResult, {
    status: 'failed', documentCount: 37, savedDocumentCount: 36, indexedDocumentCount: 36
  });
  const issues = (await documents.list('alice', cardId)).issues;
  assert.equal(issues?.count, 1);
  assert.deepEqual(issues?.examples, [{ url: oversized.url, reason: 'file_too_large' }]);
  assert.ok(durable.every(([path, ciphertext]) => fake.records.get(path)?.ciphertext === ciphertext));
  assert.ok(![...fake.records.keys()].some(path => path.includes('_knowledge_sources/')));
  assert.doesNotMatch(JSON.stringify(rows()), /fixture-password|private word|hidden-ticket|secret-fixture|publisher\.example/iu);
});
