import assert from 'node:assert/strict';
import test from 'node:test';
import { createRegisteredSourceCardsApi, RegisteredSourceCardsError, sourceCardSettingsSchema } from './registered-source-cards-api.ts';

const cardId = '00000000-0000-4000-8000-000000000001';
const card = { cardId, revision: 1, name: '個人公告', kind: 'bulletin', url: 'https://school.example/news', frequencyMinutes: 60, enabled: true,
  credentialRef: null, lastCheckedAt: null, nextCheckAt: null, lastResult: null, checking: false };
const signal = () => new AbortController().signal;
test('account requests include expected identity and preserve the original operation on explicit retry', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const api = createRegisteredSourceCardsApi('/api', async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return calls.length === 1 ? new Response(null, { status: 503 }) : Response.json({ card });
  });
  const input = { action: 'check_now' as const, operationId: cardId, cardId, expectedRevision: 1 };
  await assert.rejects(api.mutate('actor', signal(), input), error => error instanceof RegisteredSourceCardsError && error.unknownResult);
  await api.mutate('actor', signal(), input);
  assert.equal(calls[0].init.body, calls[1].init.body);
  assert.equal(calls[0].url, '/api/account/source-cards');
  assert.equal(new Headers(calls[0].init.headers).get('x-expected-user-id'), 'actor');
  assert.equal(calls[0].init.credentials, 'include');
});
test('list cursor and direct card lookup use only account endpoints', async () => {
  const urls: string[] = [];
  const api = createRegisteredSourceCardsApi('https://app.example', async url => {
    urls.push(String(url)); return Response.json(urls.length === 1 ? { items: [card], nextCursor: 'opaque' } : { card });
  });
  const list = await api.list('actor', signal(), 'a+b');
  assert.equal(list.items[0].cardId, cardId);
  assert.equal(list.nextCursor, 'opaque');
  await api.get('actor', signal(), cardId);
  assert.deepEqual(urls, ['https://app.example/api/account/source-cards?cursor=a%2Bb', `https://app.example/api/account/source-cards/${cardId}`]);
});
test('credentials use their separate endpoint and errors never expose response text', async () => {
  const api = createRegisteredSourceCardsApi('/api', async (url, init) => {
    assert.equal(String(url), `/api/account/source-cards/${cardId}/credential`);
    assert.equal(JSON.parse(String(init?.body)).password, 'PRIVATE_PASSWORD');
    return Response.json({ error: { code: 'revision_conflict', message: 'PRIVATE_PASSWORD' } }, { status: 409 });
  });
  await assert.rejects(api.credential('actor', signal(), cardId, { action: 'replace', operationId: cardId, expectedRevision: 1, username: 'actor', password: 'PRIVATE_PASSWORD' }),
    error => error instanceof RegisteredSourceCardsError && !error.unknownResult && !String(error).includes('PRIVATE_PASSWORD'));
});
test('malformed successful writes remain unknown and settings reject invalid minute frequency or URL', async () => {
  const api = createRegisteredSourceCardsApi('/api', async () => Response.json({ card: { password: 'PRIVATE_PASSWORD' } }));
  await assert.rejects(api.mutate('actor', signal(), { action: 'remove', operationId: cardId, cardId, expectedRevision: 1 }),
    error => error instanceof RegisteredSourceCardsError && error.unknownResult && !String(error).includes('PRIVATE_PASSWORD'));
  const values = { name: '來源', kind: 'document', url: 'https://example.com', frequencyMinutes: 1 };
  assert.ok(sourceCardSettingsSchema.safeParse(values).success);
  for (const bad of [{ ...values, frequencyMinutes: 0 }, { ...values, frequencyMinutes: 1.5 }, { ...values, url: 'file:///private' }, { ...values, url: 'https://actor:secret@example.com' }]) assert.equal(sourceCardSettingsSchema.safeParse(bad).success, false);
});
