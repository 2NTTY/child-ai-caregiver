import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformMediaStore } from '../server/firestore-platform-media.ts';
import { createPlatformMediaProcessor } from '../server/platform-media-processing.ts';
import { loadMediaOriginals, readWebVtt } from '../server/platform-media-evidence.ts';
import { createKnowledgeSourceFetcher } from '../server/knowledge-source-fetch.ts';
import { createFirestoreKnowledgeRefresh } from '../server/firestore-knowledge-refresh.ts';
import { fhsMaterialWatches } from '../server/platform-materials.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { randomUUID } from 'node:crypto';
import { knowledgeHash } from '../server/knowledge-inputs.ts';
import { mediaPlaybackUrl } from '../src/shared/platform-media.ts';

test('a fresh source check alone replaces discovered links and never starts media when disabled', async () => {
  const id = 'fhs-14799', definition = fhsMaterialWatches.find(w => w.id === id)!;
  const { database } = firestoreDomainFixture(), generation = randomUUID();
  const refresh = createFirestoreKnowledgeRefresh({ database, projectId: 'demo-test', namespace: 'test',
    definitions: [definition], readControl: async () => ({ enabled: true, generation }) });
  await refresh.register(id, 'operator');
  const [job] = await refresh.jobs(), signal = new AbortController().signal;
  const state = () => database.runTransaction(tx => refresh.media.read(tx, id));
  assert.equal((await state()).enabled, false);
  assert.ok((await state()).links.length > 0);
  for (const result of [{ status: 'failed', reason: 'network' }, { status: 'unavailable', httpStatus: 404 }] as const) {
    const before = await state();
    await refresh.process(job!.data, randomUUID(), async () => result, signal);
    assert.deepEqual(await state(), before);
  }
  const htmlFetch = (url: string) => createKnowledgeSourceFetcher({ transport: async () => ({ status: 'response',
    response: { status: 200, contentType: 'text/html', body: Buffer.from('<div id="content"><h2>Source</h2><p>Text</p>' + url + '</div>') } }) });
  await refresh.process(job!.data, randomUUID(), htmlFetch('<a href="https://youtu.be/zKcYlmle4gI">Video</a>'), signal);
  assert.deepEqual((await state()).links, ['https://www.youtube.com/watch?v=zKcYlmle4gI']);
  await refresh.process(job!.data, randomUUID(), htmlFetch(''), signal);
  assert.deepEqual((await state()).links, []);
});

test('only enabled platform cards process media and both cards reuse one timed original without a family model call', async () => {
  const { database } = firestoreDomainFixture(), store = createPlatformMediaStore(database, 'test');
  const ids = ['fhs-14799','fhs-14743'], url = 'https://www.youtube.com/watch?v=zKcYlmle4gI', signal = new AbortController().signal;
  let fetches = 0, calls = 0;
  const measured = [{ start: 1.25, end: 3.1, text: 'Example quote' }];
  const process = createPlatformMediaProcessor(store, 'test', async () => { calls++; return measured; }, async () => {
    fetches++; return [{ url, transcript: 'Example quote', captions: [], hash: knowledgeHash(url), duration: 4 }];
  });
  for (const id of ids) {
    await database.runTransaction(tx => store.reconcile(tx, id, [url]));
    await process(id, signal); assert.equal(fetches, 0);
  }
  for (const id of ids) {
    await database.runTransaction(async tx => { const card = await store.read(tx,id); await store.toggle(tx,id,true,card.revision); });
    await process(id, signal);
    const card = await database.runTransaction(tx => store.read(tx, id));
    assert.deepEqual(card.clips?.map(c => [c.start,c.end,c.text]), [[1.25,3.1,'Example quote']]);
    assert.equal(mediaPlaybackUrl(card.clips![0]!.url,1.25), url + '&t=1');
  }
  assert.equal(calls, 1);
  await database.runTransaction(tx => store.reconcile(tx, ids[0]!, []));
  assert.equal((await database.runTransaction(tx => store.read(tx, ids[0]!))).clips?.length, 0);
  assert.equal((await database.runTransaction(tx => store.read(tx, ids[1]!))).clips?.length, 1);
});

test('published WebVTT timecodes outrank audio analysis and malformed times are rejected', async () => {
  const captions = readWebVtt('WEBVTT\n\n00:01.000 --> 00:03.500\nA timed caption\n');
  assert.deepEqual(captions, [{ start: 1, end: 3.5, text: 'A timed caption' }]);
  assert.throws(() => readWebVtt('WEBVTT\n\n00:11.000 --> 00:03.000\nInvalid'));
  const {database} = firestoreDomainFixture(), store = createPlatformMediaStore(database,'test');
  const id = 'fhs-14799', url = 'https://www.youtube.com/watch?v=zKcYlmle4gI';
  await database.runTransaction(tx => store.reconcile(tx,id,[url]));
  await database.runTransaction(async tx => { const card = await store.read(tx,id); await store.toggle(tx,id,true,card.revision); });
  await createPlatformMediaProcessor(store,'test',async () => assert.fail('Captions should not use a model'),
    async () => [{url, hash: knowledgeHash(captions), captions, transcript:''}])(id,new AbortController().signal);
  assert.equal((await database.runTransaction(tx => store.read(tx,id))).clips?.[0]?.end, 3.5);
});

test('an official page and its direct video link bind captions to the same player after a second video is added', async () => {
  const page = 'https://www.fhs.gov.hk/tc_chi/mulit_med/000002.html';
  const first = 'https://www.youtube.com/watch?v=zKcYlmle4gI';
  const second = 'https://www.fhs.gov.hk/tc_chi/mulit_med/second.mp4';
  const track = new URL('second.vtt', page).href;
  const signal = new AbortController().signal;
  let html = '<iframe src="https://www.youtube.com/embed/zKcYlmle4gI"></iframe><div id="transcript">Official script</div>';
  const fetcher: NonNullable<Parameters<typeof loadMediaOriginals>[2]> = async url => {
    assert.ok(url === page || url === track);
    const body = url === page ? html : 'WEBVTT\n\n00:01.000 --> 00:02.000\nSecond video only\n';
    return { status: 'response', response: { status: 200, contentType: url === page ? 'text/html' : 'text/vtt', body: Buffer.from(body) } };
  };
  const read = (url: string) => loadMediaOriginals(url, signal, fetcher);
  const single = await read(first);
  assert.equal(single[0]?.transcript, 'Official script');
  assert.deepEqual(await read(page), single);

  html += '<video><source src="' + second + '"><track kind="captions" srclang="zh" src="second.vtt"></video>';
  const byPage = await read(page), byDirect = await read(first);
  assert.deepEqual(byDirect, byPage.filter(original => original.url === first));
  assert.equal(byDirect[0]?.transcript, '');
  assert.deepEqual(byDirect[0]?.captions, []);
  assert.deepEqual(byPage.find(original => original.url === second)?.captions,
    [{ start: 1, end: 2, text: 'Second video only' }]);
});

test('an unresolved shared original keeps its previous clip while sibling streams and later links update', async () => {
  const { database } = firestoreDomainFixture(), store = createPlatformMediaStore(database, 'test');
  const id = 'fhs-14799', owner = 'fhs-14743', signal = new AbortController().signal;
  const base = 'https://www.fhs.gov.hk/tc_chi/mulit_med/';
  const page = base + 'a.html', shared = base + 'shared.mp4', removed = base + 'removed.mp4';
  const sibling = base + 'sibling.mp4', later = base + 'z.mp4';
  const cue = (text: string) => [{ start: 1, end: 2, text }];
  const captioned = (url: string, text: string) => ({ url, hash: knowledgeHash([url, text]), captions: cue(text), transcript: '' });
  const old = captioned(shared, 'Previous caption'), pending = { url: shared, hash: knowledgeHash('updated stream'), captions: [], transcript: '' };
  let updated = false, dispatches = 0;
  const process = createPlatformMediaProcessor(store, 'test', async () => {
    dispatches++;
    throw Error('provider_acknowledgement_unknown');
  }, async link => {
    if (link === shared) return [pending];
    if (link === later) return [captioned(later, 'Later link')];
    assert.equal(link, page);
    return updated ? [pending, captioned(sibling, 'Sibling stream')] : [old, captioned(removed, 'Removed stream')];
  });
  async function enable(cardId: string, links: string[]) {
    await database.runTransaction(tx => store.reconcile(tx, cardId, links));
    const state = await database.runTransaction(tx => store.read(tx, cardId));
    await database.runTransaction(tx => store.toggle(tx, cardId, true, state.revision));
  }
  await enable(id, [page]);
  await process(id, signal);
  await enable(owner, [shared]);
  await assert.rejects(process(owner, signal), /provider_acknowledgement_unknown/u);
  await database.runTransaction(tx => store.reconcile(tx, id, [page, later]));
  updated = true;
  const readCard = () => database.runTransaction(tx => store.read(tx, id));
  await process(id, signal);
  const refreshed = await readCard();
  assert.deepEqual(refreshed.clips?.map(c => [c.link, c.url, c.text]), [
    [page, shared, 'Previous caption'], [page, sibling, 'Sibling stream'], [later, later, 'Later link'],
  ]);
  assert.equal(refreshed.clips![0]!.evidenceHash, old.hash);
  await process(id, signal);
  assert.deepEqual(await readCard(), refreshed);
  assert.equal(dispatches, 1);
});

test('an unavailable media page retains its clips and reports the error after refreshing another link', async () => {
  const { database } = firestoreDomainFixture(), store = createPlatformMediaStore(database, 'test');
  const id = 'fhs-14799', base = 'https://www.fhs.gov.hk/tc_chi/mulit_med/';
  const page = base + 'a.html', video = base + 'a.mp4', later = base + 'z.mp4';
  const signal = new AbortController().signal;
  let unavailable = false;
  const process = createPlatformMediaProcessor(store, 'test', async () => assert.fail('Official captions suffice'), async link => {
    if (link === page && unavailable) throw Error('knowledge_media_source_unavailable');
    const url = link === page ? video : later;
    const text = unavailable ? 'Updated caption' : 'First caption';
    return [{ url, hash: knowledgeHash([url, text]), transcript: '', captions: [{ start: 1, end: 3, text }] }];
  });
  await database.runTransaction(tx => store.reconcile(tx, id, [page, later]));
  const read = () => database.runTransaction(tx => store.read(tx, id));
  const initial = await read();
  await database.runTransaction(tx => store.toggle(tx, id, true, initial.revision));
  await process(id, signal);
  const first = await read();
  unavailable = true;
  await assert.rejects(process(id, signal), /knowledge_media_source_unavailable/u);
  const refreshed = await read();
  assert.deepEqual(refreshed.clips?.[0], first.clips?.[0]);
  assert.equal(refreshed.clips?.[1]?.text, 'Updated caption');
});
