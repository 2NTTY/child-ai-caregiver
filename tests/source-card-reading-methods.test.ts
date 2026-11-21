import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreRegisteredSourceCards } from '../server/firestore-registered-source-cards.ts';
import { createFirestoreSourceCardDocuments } from '../server/firestore-source-card-documents.ts';
import { createRegisteredSourceWorker } from '../server/registered-source-worker.ts';
import { createRegisteredSourceTools } from '../server/agent-registered-source-tools.ts';
import { createRegisteredDocumentTools, readSourceCardExcerpt } from '../server/agent-registered-document-tools.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import type { FirestoreBackgroundWork } from '../server/firestore-background-work.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';

test('scheduled catalogues verify a reading method against searchable editions and recover from a layout change', async t => {
  const fixture = firestoreDomainFixture();
  let clock = Date.now();
  const options = { database: fixture.database, projectId: 'demo-reading-methods', namespace: 'method_acceptance',
    cipher: createStorageCipher(Buffer.alloc(32, 7)), serverClock: () => clock };
  const authority = createFirestoreAuthority(options);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  const owner = 'reader', email = 'reader@example.test';
  await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(clock + 86400000).toISOString() });
  await authority.admitIdentity({ userId: owner, email, emailVerified: true });
  await authority.acknowledge({ userId: owner, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const cards = createFirestoreRegisteredSourceCards({ ...options, authority });
  const documents = createFirestoreSourceCardDocuments(options, cards);
  const a = 'https://library.example.org/books', b = 'https://museum.example.org/notices';
  const article = (text: string) => '<article><h1>Publisher notice</h1><p>' + text + '</p></article>';
  const links = (url: string) => '<main><a href="' + url + '">Reading room bulletin</a></main>';
  const feed = (url: string) => '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Museum notice</title><link href="' + url + '"/></entry></feed>';
  const pages = new Map([[a, links(a + '/room')], [a + '/room', article('青松閱覽室星期一開放。')],
    [b, feed(b + '/latest')], [b + '/summer', article('夏季展覽在松木館舉行。')] ]);
  const group = (heading: string) => '<section><h2>' + heading + '</h2><ul><li><a href="' + a + '/room">閱覽室公告</a></li></ul></section>';
  const secondary = '<a href="' + a + '/services">其他館藏</a>';
  pages.set(a, '<main>' + group('親子閱讀') + group('三至六歲') + secondary + '</main>');
  pages.set(a + '/services', '<main>' + group('社區服務') + '</main>');
  const annex = await PDFDocument.create();
  annex.addPage().drawText('Independent room booking form');
  const annexBytes = Buffer.from(await annex.save());
  pages.set(a + '/room', '<article><h1>閱覽室公告</h1><p>本頁為現行正文。</p><p>青松閱覽室星期一開放。家庭可以於開放時間查閱借書安排及使用館內提供的設施。</p>'
    + '<a href="room-print.pdf">本頁列印版（PDF）</a><a href="booking.pdf">獨立預約表格</a></article>');
  const requests: string[] = [];
  let firstRead = true;
  t.mock.module('../server/public-source-transport.ts', { namedExports: {
    async fetchPublicSourceResponse(url: string, validate: (url: string) => URL) {
      validate(url);
      requests.push(url);
      if (url === a && firstRead) {
        firstRead = false;
        return { status: 'response', response: { url, status: 503, contentType: 'text/plain', body: Buffer.alloc(0) } };
      }
      const resolved = url === b + '/latest' ? validate(b + '/summer').href : url;
      if (resolved === a + '/booking.pdf') return { status: 'response',
        response: { url: resolved, status: 200, contentType: 'application/pdf', body: annexBytes } };
      const body = pages.get(resolved);
      return { status: 'response', response: { url: resolved, status: body ? 200 : 404,
        contentType: body?.startsWith('<feed') ? 'application/atom+xml' : 'text/html', body: Buffer.from(body ?? '') } };
    }, submitSourceLogin() { assert.fail('Public catalogues do not require a login'); }
  } });
  const worker = createRegisteredSourceWorker({ ...options, cards, documents,
    currentAuth: async userId => ({ userId, emailVerified: true, disabled: false }) });
  const codec = createFirestoreRestoreCodec(options);
  let lastCheck: string;
  async function add(url: string) {
    const cardId = randomUUID();
    await cards.command(owner, { action: 'create', cardId, operationId: randomUUID(), expectedRevision: 0,
      settings: { name: new URL(url).hostname, kind: 'directory', url, frequencyMinutes: 1 } });
    return cardId;
  }
  async function run(cardId: string) {
    await worker.schedule();
    const scheduled = [...fixture.records].filter(([path]) => path.includes('background_work/')).map(([path, data]) =>
      codec.decode({ path, data }).value as FirestoreBackgroundWork).filter(row => row.kind === 'source-card-check' && row.resourceId === cardId).at(-1);
    assert.ok(scheduled, 'A scheduled check must exist');
    lastCheck = JSON.parse(scheduled.basis)[1];
    for (let i = 0; i < 25; i++) {
      const turn = await worker.process(scheduled, AbortSignal.timeout(15000));
      if (turn.state === 'completed') return (await cards.get(owner, cardId))!;
      assert.equal(turn.state, 'deferred');
    }
    assert.fail('The bounded catalogue did not finish');
  }
  async function citation(id: string, text: string) {
    const hit = (await documents.search(owner, id, text)).items.find(h => h.excerpt.includes(text));
    assert.ok(hit, text);
    const { content } = await documents.read(owner, id, hit.source.documentId, hit.source.version);
    assert.ok(JSON.stringify(content).includes(text));
    const target = { cardId: id, documentId: hit.source.documentId, version: hit.source.version, offset: 0 };
    const tools = createRegisteredDocumentTools(documents, owner, 'test-run', async () => true,
      (_id, saved) => assert.deepEqual(saved, target), () => null);
    const context = { scope: { userId: owner }, signal: AbortSignal.timeout(5000) } as never;
    const reply = await tools.find(tool => tool.name === 'read_source_card_document')!.execute(target, context);
    assert.match(reply.reference ?? '', /^source-card:[a-f0-9]{64}$/u);
    assert.ok((await readSourceCardExcerpt(documents, owner, target, AbortSignal.timeout(5000)))?.excerpt.includes(text));
    t.diagnostic(JSON.stringify({ original: hit.source.url, quote: text, version: target.version, citation: reply.reference }));
    return hit.source.version;
  }
  const aid = await add(a), bid = await add(b);
  const first = await run(aid), second = await run(bid);
  const v1 = await citation(aid, '青松閱覽室星期一開放。');
  assert.equal(first.methods?.[0]?.sample.version, v1);
  assert.equal(requests.filter(url => url === a).length, 2);
  assert.equal(second.methods?.[0]?.parser, 'feed');
  await citation(bid, '夏季展覽在松木館舉行。');
  const firstItems = (await documents.list(owner, aid)).items;
  const room = firstItems.find(item => item.url === a + '/room')!;
  assert.deepEqual(room.categories, { basis: 'publisher', labels: ['三至六歲', '社區服務', '親子閱讀'] });
  assert.equal(firstItems.length, 2);
  assert.equal(requests.filter(url => url === a + '/room').length, 1);
  assert.ok(!requests.includes(a + '/room-print.pdf'));
  assert.equal(requests.filter(url => url === a + '/booking.pdf').length, 1);
  assert.deepEqual((await documents.list(owner, bid)).items[0]!.categories, { basis: 'document', labels: ['學習與活動'], evidence: '展覽' });
  const indexWork = () => [...fixture.records].filter(([path]) => path.includes('background_work/')).map(([path, data]) =>
    codec.decode({ path, data }).value as FirestoreBackgroundWork).filter(row => row.kind === 'source-card-index').length;
  const workBefore = indexWork();
  clock += 61000;
  pages.set(a, '<main>' + group('圖書館服務') + secondary + '</main>');
  pages.set(a + '/services', links(a + '/room'));
  assert.equal((await run(aid)).lastResult?.status, 'unchanged');
  const movedRoom = (await documents.list(owner, aid)).items.find(item => item.url === room.url)!;
  assert.deepEqual(movedRoom.categories, { basis: 'publisher', labels: ['圖書館服務'] });
  assert.equal(movedRoom.documentId, room.documentId);
  assert.equal(movedRoom.version, v1);
  assert.equal(indexWork(), workBefore);
  clock += 61000;
  pages.set(a, '<table><tr><td><a href="' + a + '/room">閱覽室</a></td></tr><tr><td>' + secondary + '</td></tr></table>');
  pages.set(a + '/room', article('青松閱覽室星期四開放。'));
  pages.set(b, '<head><link rel="alternate" type="application/atom+xml" href="' + b + '/feed"/></head><main><h1>展覽通告</h1></main>');
  pages.set(b + '/feed', feed(b + '/summer'));
  pages.set(b + '/summer', article('夏季展覽移至石橋館。'));
  const repaired = await run(aid);
  assert.equal(repaired.methods?.[0]?.parser, 'records');
  assert.equal(repaired.methods?.[0]?.revision, 2);
  assert.notEqual(await citation(aid, '青松閱覽室星期四開放。'), v1);
  const moved = await run(bid);
  assert.equal(moved.methods?.[0]?.feedUrl, b + '/feed');
  assert.equal(moved.methods?.[0]?.revision, 2);
  await citation(bid, '夏季展覽移至石橋館。');
  clock += 61000;
  assert.equal((await run(aid)).lastResult?.status, 'unchanged');
  assert.equal((await run(bid)).lastResult?.status, 'unchanged');
  clock += 61000;
  pages.set(a, '<main><h1>查閱目錄</h1></main>');
  const blocked = await run(aid);
  assert.equal(blocked.lastResult?.status, 'failed');
  assert.equal(blocked.gap?.url, a);
  assert.deepEqual(blocked.methods, repaired.methods);
  await citation(aid, '青松閱覽室星期四開放。');
  await cards.command(owner, { action: 'skip_gap', cardId: aid, expectedRevision: blocked.revision,
    checkId: blocked.gap!.checkId, operationId: randomUUID() });
  clock += 61000;
  const repeated = await run(aid);
  assert.equal(repeated.gap?.skipped, true);
  assert.equal(repeated.gap?.checkId, blocked.gap!.checkId);
  async function suggest(url: string) {
    const card = (await cards.get(owner, aid))!;
    const session = createRegisteredSourceTools(cards, owner, randomUUID(), '這張卡的目錄可能在 ' + url, async () => true);
    const tool = session.tools.find(tool => tool.name === 'manage_source_card')!;
    const reply = await tool.execute({ action: 'suggest_location', url, checkId: card.gap?.checkId, cardId: aid, expectedRevision: card.revision }, { scope: { userId: owner }, signal: AbortSignal.timeout(5000) } as never);
    assert.equal(reply.status, 'succeeded');
  }
  pages.set(a + '/wrong', links(a + '/irrelevant'));
  pages.set(a + '/irrelevant', article('未經證實的線索文字。'));
  await suggest(a + '/wrong');
  const rejected = await run(aid);
  assert.equal(rejected.hint?.status, 'rejected');
  assert.ok(!requests.includes(a + '/irrelevant'));
  assert.deepEqual(rejected.methods, repaired.methods);
  assert.equal((await documents.search(owner, aid, '未經證實的線索文字。')).items.some(h => h.excerpt.includes('未經證實')), false);
  pages.set(a + '/new', links(a + '/room'));
  await suggest(a + '/new');
  const resumed = await run(aid);
  assert.equal(lastCheck!, blocked.gap!.checkId);
  assert.equal(resumed.hint?.status, 'verified');
  assert.equal(resumed.hint?.checkId, blocked.gap?.checkId);
  assert.equal(resumed.gap, undefined);
  assert.ok(resumed.methods?.some(method => method.url === a + '/new'));
  await citation(aid, '青松閱覽室星期四開放。');
  clock += 61000;
  assert.equal((await run(aid)).lastResult?.status, 'unchanged');
  assert.equal((await cards.get(owner, aid))?.gap, undefined);
  pages.set(b + '/feed', feed(b + '/missing').replace('</feed>', '<entry><link href="' + b + '/summer"/></entry></feed>'));
  pages.set(b + '/summer', article('秋季展覽移至白石館。'));
  const partial = await run(bid);
  assert.equal(partial.lastResult?.status, 'failed');
  assert.equal(partial.gap?.url, b + '/missing');
  assert.equal(requests.filter(url => url === b + '/missing').length, 3);
  await citation(bid, '秋季展覽移至白石館。');
});
