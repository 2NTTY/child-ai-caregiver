import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformMediaStore } from '../server/firestore-platform-media.ts';
import { createPlatformMediaProcessor } from '../server/platform-media-processing.ts';
import { readWebVtt } from '../server/platform-media-evidence.ts';
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
