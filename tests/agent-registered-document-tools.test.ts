import assert from 'node:assert/strict';
import test from 'node:test';
import { createRegisteredDocumentTools, readSourceCardExcerpt, type AgentSourceDocumentReader } from '../server/agent-registered-document-tools.ts';
import { createRegisteredSourceCardsApi } from '../frontend/src/production/registered-source-cards-api.ts';
import type { SourceReading } from '../src/shared/source-card-reading.ts';

test('private visual evidence opens the same fact and retires when its authorization or edition changes', async () => {
  const owner = 'parent';
  const cardId = '00000000-0000-4000-8000-000000000001';
  const incarnation = '00000000-0000-4000-8000-000000000002';
  const source = { cardId, documentId: 'b'.repeat(64), version: 'c'.repeat(64), title: '校刊' };
  const facts = [{ type: 'visual_description' as const, text: '兩個藍色圓形' }];
  let readable = true;
  let embeddings = 0;
  const operations = new Set<string>();
  const store = {
    async searchPrivate(user, card, query, options) {
      assert.equal(user, owner); assert.equal(card, cardId);
      if (!operations.has(options.operationId)) await options.embedInRun!(query, async () => readable);
      operations.add(options.operationId);
      return { items: [{ source, page: 2, offset: 0, incarnation, facts }], nextCursor: null };
    },
    async readPrivateEvidence(user, card, doc, rev, page, offset, epoch) {
      if (!readable || user !== owner || epoch !== incarnation) return null;
      assert.deepEqual([card, doc, rev, page, offset], [cardId, source.documentId, source.version, 2, 0]);
      return { source, page, offset, facts };
    },
  } satisfies Pick<AgentSourceDocumentReader, 'searchPrivate' | 'readPrivateEvidence'>;
  const readings = new Map<string, { target: SourceReading; valid(): Promise<boolean> }>();
  const reader = store as AgentSourceDocumentReader;
  const tools = createRegisteredDocumentTools(reader, owner, 'run', async () => true,
    (id, target, evidence, valid) => {
      assert.equal(evidence.classification, 'private');
      readings.set(id, { target, valid });
    }, key => async (_text, authorizeSource) => {
      assert.equal(key, 'embedding:chat');
      assert.equal(await authorizeSource(), true);
      embeddings++;
      return [1];
    });
  const search = tools.find(tool => tool.name === 'search_source_card_evidence')!;
  const scope = { userId: owner, childId: 'child', workspaceId: 'workspace', authorizationVersion: '1', dataVersion: '1' };
  const signal = new AbortController().signal;
  assert.equal(await search.authorize({}, { ...scope, userId: 'other' }), false);
  for (const callId of ['a', 'retry']) {
    const result = await search.execute({ cardId, query: '頁面上畫了些甚麼？' }, { scope, callId, signal, runId: 'run', queryEmbeddingAttemptKey: 'embedding:chat' });
    assert.equal(result.status, 'succeeded');
  }
  assert.equal(operations.size, 1);
  assert.equal(readings.size, 1);
  const { target, valid } = [...readings.values()][0]!;
  assert.equal(await valid(), true);
  const view = await readSourceCardExcerpt(reader, owner, target, signal);
  assert.equal(view?.excerpt, facts[0]!.text);
  const api = createRegisteredSourceCardsApi('https://example.invalid/api', async (input, init) => {
    assert.equal(new Headers(init?.headers).get('x-expected-user-id'), owner);
    const url = new URL(String(input));
    assert.equal(url.pathname, '/api/account/source-cards/' + cardId + '/reading');
    assert.equal(url.searchParams.get('version'), source.version);
    assert.equal(url.searchParams.get('incarnation'), incarnation);
    assert.equal(url.searchParams.get('hash'), target.fact?.hash);
    return Response.json(view);
  });
  assert.equal((await api.reading(owner, signal, target)).kind, 'visual_description');
  assert.equal(await readSourceCardExcerpt(reader, 'other', target, signal), null);
  readable = false;
  assert.equal(await valid(), false);
  assert.equal(await readSourceCardExcerpt(reader, owner, target, signal), null);
  assert.equal(embeddings, 1);
});
