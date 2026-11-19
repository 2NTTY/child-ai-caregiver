import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import JSZip from 'jszip';
import { FinishReason } from '@google/genai';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreMemoryStore } from '../server/firestore-memory.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreProductAgent } from '../server/firestore-product-agent.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { createProductAgentApi } from '../src/client/product-agent-api.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { sourceSeries } from '../src/shared/source-series.ts';
import { liveSourceCitationSchema } from '../src/shared/live-source-citation.ts';
import { parseKnowledgeSource, sourceVersionHash } from '../server/knowledge-inputs.ts';
import { projectAgentCitation, projectAgentRun } from '../frontend/src/production/agent-projection.ts';
import { readSeriesReferences, exportSeriesReferences } from '../frontend/src/production/library-package.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';

const fixtures = JSON.parse(await readFile(new URL('../knowledge/hk-official-seed.json', import.meta.url), 'utf8'));
const booklet = parseKnowledgeSource(fixtures.find(item => item.sourceId === 'fhs-feeding-booklet-en'));

test('a scanned quotation and an image description retain their evidence type and exact physical page', () => {
  const evidence = { ...booklet, ...booklet.chunks[0], originalKind: 'visual_page', sourceExcerpt: '',
    text: 'A diagram shows two stages.', pageStart: 4, pageEnd: 7, excerptPage: 6 };
  const figure = projectAgentCitation(evidence);
  assert.equal(figure.excerptKind, 'visual_page');
  assert.equal(figure.excerpt, evidence.text);
  assert.deepEqual([figure.pageStart, figure.pageEnd, figure.excerptPage], [4, 7, 6]);
  const transcription = projectAgentCitation({ ...evidence, originalKind: 'page_transcription', sourceExcerpt: 'Label on scan' });
  assert.equal(transcription.excerptKind, 'page_transcription');
  assert.equal(transcription.excerpt, 'Label on scan');
  assert.equal(projectAgentCitation({ ...evidence, originalKind: 'page_transcription',
    sourceExcerpt: 'Label on scan', citedExcerpt: 'Absent from the page' }).excerpt, '');
});

test('source card actions preserve the displayed revision and only pinning adopts current editions', async () => {
  const { seriesPreferenceChange } = await import('../frontend/src/memory-reference-view-model.ts');
  const first = { sourceId: 'first', versionId: 'current-one', preference: { revision: 4, mode: 'fixed', enabled: true, selectedVersionId: 'old-one' } };
  const second = { ...first, sourceId: 'second', versionId: 'current-two' };
  const editions = [{ sourceId: 'first', versionId: 'current-one' }, { sourceId: 'second', versionId: 'current-two' }];
  const base = { seriesId: 'series', expectedRevision: 4, editions };
  const change = action => seriesPreferenceChange('series', [first, second], action);
  assert.deepEqual(change('toggle'), { ...base, enabled: false, mode: 'fixed', adopt: false });
  assert.deepEqual(change('follow'), { ...base, enabled: true, mode: 'follow', adopt: false });
  assert.deepEqual(change('fixed'), { ...base, enabled: true, mode: 'fixed', adopt: true });
  assert.deepEqual(change('platform'), { ...base, enabled: true, mode: 'platform', adopt: false });
  assert.equal(seriesPreferenceChange('series', [first, { ...second, preference: { ...second.preference, revision: 5 } }], 'fixed'), null);
  const untouched = { ...first, preference: { revision: 0, enabled: true, mode: 'platform', selectedVersionId: null } };
  const toggle = seriesPreferenceChange('series', [untouched], 'toggle');
  assert.equal(toggle.expectedRevision, 0); assert.equal(toggle.mode, 'platform');
});

test('REQ-006 personal ZIP contains only selected immutable references, rejects modified bytes and preserves the imported revision', async () => {
  const selectedVersionHash = sourceVersionHash(booklet), catalog = [{ ...booklet, versionHash: 'c'.repeat(64), series: sourceSeries(booklet),
    preference: { enabled: true, mode: 'fixed', selectedVersionHash, revision: 3 } }];
  const newDocument = { ...catalog[0], sourceId: 'new-series-document', preference: { enabled: true, mode: 'fixed', revision: 3, eligible: false } };
  const data = await exportSeriesReferences([...catalog, newDocument]);
  const selected = body => ({ filename: 'feeding.zip', bytes: body.byteLength, body });
  const result = await readSeriesReferences(selected(data), catalog);
  assert.deepEqual(result.editions, [{ sourceId: booklet.sourceId, versionHash: selectedVersionHash }]);
  assert.equal(result.series.id, 'fhs-infant-feeding'); assert.equal(result.revision, 3);
  const zip = await JSZip.loadAsync(data), path = 'editions/' + booklet.sourceId + '.json';
  const ref = JSON.parse(await zip.file(path).async('text'));
  assert.deepEqual(Object.keys(ref).sort(), ['kind', 'sourceId', 'versionHash']);
  zip.file(path, JSON.stringify({ ...ref, versionHash: 'b'.repeat(64) }), { createFolders: false });
  await assert.rejects(readSeriesReferences(selected(await zip.generateAsync({ type: 'uint8array' })), catalog), /invalid_library_package/);
  await assert.rejects(readSeriesReferences(selected(data), []), /library_reference_unavailable/);
});

test('REQ-006 authorized live search crosses the real Runner, independent review, encrypted Firestore result, client and citation projection', async () => {
  const fake = firestoreDomainFixture(), options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 11)),
    projectId: 'synthetic-citation-project', namespace: 'synthetic_citation' };
  const authority = createFirestoreAuthority(options), user = 'synthetic-parent';
  await authority.initializeControl({ generation: crypto.randomUUID(), enabled: true });
  const email = 'parent@example.test';
  await authority.issueInvitation({ email, expiresAt: new Date(Date.now() + 90000).toISOString(), operationId: crypto.randomUUID() });
  await authority.admitIdentity({ userId: user, email, emailVerified: true });
  await authority.acknowledge({ userId: user, operationId: crypto.randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const { scope } = await authority.createChild({ userId: user, operationId: crypto.randomUUID(), displayName: 'Synthetic' });
  const chat = createFirestoreChatStore(options), care = createFirestoreCareStore(options);
  const memory = createFirestoreMemoryStore({ ...options, chat, care });
  const online = createFirestoreOnlineStore({ ...options, mutations: [chat.mutation, care.mutation, memory.mutation] });
  const message = await chat.createUserMessageForUser(user, scope.childId, '請查閱公開活動公告，告訴我開放日期。');
  const text = '活動於十一月十九日開放。', original = '活動通告。' + text + '下次時間另行通知。';
  const read = { classification: 'official_guidance', documentId: 'synthetic-notice', title: '活動通告', publisher: '合成公共機構',
    url: 'https://example.test/notices/open', termsUrl: null, fetchedAt: '2026-11-01T10:00:00Z', version: null,
    sourceDate: null, section: '開放時間', page: null, conditions: ['已登記者'], rights: 'retain_excerpt', original,
    start: original.indexOf(text), end: original.indexOf(text) + text.length };
  let receipt, reviewCount = 0, reads = 0, rechecks = 0;
  const reader = { classifications: ['official_guidance'], async search(query, signal, classification) {
    assert.equal(query, '公開活動開始日期'); assert.equal(classification, read.classification); signal.throwIfAborted(); reads++;
    return [read, { ...read, title: 'Limited notice', rights: 'locator_only', original: 'SECRET excerpt', start: 0, end: 6 }];
  }, async mayUse(snapshot) { liveSourceCitationSchema.parse(snapshot); rechecks++; return true; } };
  const product = await createFirestoreProductAgent({ ...options, chat, care, memory, online, liveSourceReader: owner => { assert.equal(owner, user); return reader; },
    config: readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: options.projectId }),
    platformProvider: { async generate(request) {
      const prompt = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? '').join('\n');
      const answer = parts => ({ content: { role: 'model', parts }, finishReason: FinishReason.STOP,
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5 } });
      if (prompt.includes('chat-delivery-review')) {
        const payload = JSON.parse(prompt.slice(prompt.indexOf('{')));
        assert.equal(payload.sources[0].citationId, receipt.sources[0].id); assert.equal(payload.sources[0].excerpt, text);
        assert.equal(payload.sources[0].classification, 'official_guidance'); reviewCount++;
        return answer([{ text: JSON.stringify({ draftHash: payload.draftHash, decision: 'pass', issues: [] }) }]);
      }
      const response = request.contents.flatMap(content => content.parts ?? []).find(part => part.functionResponse?.name === 'search_knowledge')?.functionResponse?.response;
      if (!response) return answer([{ functionCall: { id: 'read-live', name: 'search_knowledge',
        args: { query: '公開活動開始日期', acquisition: 'live', classification: 'official_guidance' } } }]);
      assert.equal(response.status, 'succeeded'); receipt = response.data.result;
      assert.equal(receipt.acquisition, 'live'); assert.equal(receipt.classification, 'official_guidance');
      assert.equal(receipt.sources[1].excerpt, null); assert.ok(!JSON.stringify(response).includes('SECRET'));
      return answer([{ functionCall: { id: 'cite-live', name: 'present_answer', args: {
        kind: 'public_information', paragraphs: [{ text, citationIds: [receipt.sources[0].id] }] } } }]);
    } } });
  const reply = await product.agent.reply(user, scope.childId, message.id, async () => true);
  assert.equal(reply?.status, 'completed', JSON.stringify(reply));
  assert.equal(reads, 1); assert.ok(rechecks >= 3); assert.equal(reviewCount, 1);
  assert.equal(reply.text, text + ' [1]'); assert.equal(reply.deliveryReview.decision, 'pass');
  assert.deepEqual(reply.tools.map(({ name, status }) => [name, status]), [['search_knowledge', 'succeeded'], ['present_answer', 'succeeded']]);
  const storedMessage = await chat.createModelMessageForUser(user, scope.childId, message.id, reply.text);
  const client = createProductAgentApi('https://local.test', async (_url, init) => {
    assert.equal(new Headers(init.headers).get('x-expected-user-id'), user);
    return Response.json({ result: await product.store.get(user, scope.childId, storedMessage.agentRunId) });
  });
  const replay = await client.getRun(scope.childId, reply.runId, new AbortController().signal, user);
  const displayed = projectAgentRun(replay, scope.childId, null).citations[0];
  assert.equal(displayed.id, receipt.sources[0].id); assert.equal(displayed.excerpt, text);
  assert.equal(displayed.seriesName, read.publisher); assert.equal(displayed.seriesId, undefined);
  assert.equal(displayed.acquisition, 'live'); assert.equal(displayed.fetchedAt, read.fetchedAt);
  assert.equal(displayed.url, read.url); assert.equal(displayed.classification, 'official_guidance');
  assert.ok(![...fake.records.keys()].some(path => /_knowledge_|_library_preferences/.test(path)));
  assert.ok(!JSON.stringify([...fake.records.values()]).includes(text));
});
