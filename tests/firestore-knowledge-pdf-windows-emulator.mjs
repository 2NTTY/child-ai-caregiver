// Local emulator acceptance. Providers are synthetic and require no external credentials.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import React from 'react';
import { Document, Page, Text, Image, renderToBuffer } from '@react-pdf/renderer';
import sharp from 'sharp';
import { Firestore } from '@google-cloud/firestore';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreKnowledgeRefresh } from '../server/firestore-knowledge-refresh.ts';
import { createFirestoreKnowledgeMaintenance } from '../server/firestore-knowledge-maintenance.ts';
import { createFirestoreKnowledgeStore } from '../server/firestore-knowledge.ts';
import { createFirestoreKnowledgeWork } from '../server/firestore-knowledge-work.ts';
import { createKnowledgeSourceFetcher } from '../server/knowledge-source-fetch.ts';
import { SOURCE_WATCHES } from '../server/knowledge-source-catalog.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { extractKnowledgePdf } from '../server/knowledge-pdf.ts';
import { avatarMemoryBucket } from './helpers/avatar-memory.ts';
const projectId = 'demo-req004-pdf-windows', bucketName = projectId + '-private';
const originalBucket = { bucketName, bucket: avatarMemoryBucket(bucketName).port };
assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? '', /^127\.0\.0\.1:[0-9]+$/u);
process.env.YUYF_LOCAL_DEVELOPMENT = '1';
const mode = process.argv[2] ?? 'valid', sha = b => createHash('sha256').update(b).digest('hex');
assert.ok(['valid', 'contradiction', 'quota'].includes(mode));
const img = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="200"><rect width="900" height="200" fill="white"/><text x="80" y="115" font-family="Arial" font-size="52">Scan label AX7</text></svg>')).png().toBuffer();
const graphic = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#e00000' } }).png().toBuffer();
const pages = Array.from({ length: 33 }, (_, i) => {
  const page = i + 1;
  const content = page === 15 || page === 31 ? React.createElement(Image, { src: { data: page === 15 ? img : graphic, format: 'png' }, style: { width: 200 } })
    : React.createElement(Text, {}, page === 14 ? 'Boundary condition on page fourteen: keep the AFTER label on the next sheet.'
      : page === 16 ? 'Continuation of the example, labelled AX7.' : 'Navigation page for the mock transport booklet.');
  return React.createElement(Page, { key: page }, content);
});
const pdf = await renderToBuffer(React.createElement(Document, {}, ...pages)), originalHash = sha(pdf);
const domain = { database: new Firestore({ projectId }), projectId, namespace: 'req004_win_' + Date.now(), cipher: createStorageCipher(randomBytes(32)) };
const authority = createFirestoreAuthority(domain), generation = randomUUID(), id = 'fhs-feeding-booklet-en', def = SOURCE_WATCHES.find(x => x.id === id), original = new AbortController().signal;
await authority.initializeControl({ enabled: true, generation });
const readControl = tx => authority.readControl(tx);
const refresh = createFirestoreKnowledgeRefresh({ ...domain, definitions: SOURCE_WATCHES, readControl, originalBucket });
await refresh.register(id, 'synthetic-window-acceptance');
const calls = [];
let embeddings = 0, downloads = 0, landingStatus = 200;
const fetch = createKnowledgeSourceFetcher({ async transport(url, validate) {
  validate(url);
  if (url === def.leafletPage) {
    const body = Buffer.from('<main><h1>Synthetic scanned guide</h1><a href="14727.pdf">Read PDF</a></main>');
    return { status: 'response', response: { status: landingStatus, contentType: 'text/html', body } };
  }
  assert.equal(url, def.url);
  downloads++;
  return { status: 'response', response: { status: 200, contentType: 'application/pdf', body: pdf } };
} });
const config = readAiConfig({
  AI_ENABLED: 'true', GCP_PROJECT_ID: projectId, AI_BACKGROUND_KNOWLEDGE_MAINTENANCE_ENABLED: 'true',
  ...(mode === 'quota' ? { AI_DAILY_USER_ATTEMPTS: '1' } : {}),
  AI_BACKGROUND_KNOWLEDGE_LIVE_FETCH: 'true', AI_BACKGROUND_KNOWLEDGE_LIVE_PUBLISH: 'true',
});
const applicability = { region: 'HK', ageBasis: 'any', minAgeMonths: null, maxAgeMonths: null, topics: ['sample'], conditions: [] };
const examples = new Map([
  [14, { quote: 'Boundary condition on page fourteen', originalKind: 'text_layer' }],
  [15, { quote: 'Scan label AX7', originalKind: 'page_transcription' }],
  [31, { quote: '', originalKind: 'visual_page' }],
]);
async function generate(request) {
  const [instruction, attachment] = request.contents[0].parts;
  const payload = JSON.parse(instruction.text), scope = payload.readScope;
  const bytes = Buffer.from(attachment.inlineData.data, 'base64');
  assert.equal(payload.task, 'physicalPageWindow');
  assert.equal(scope.parentHash, originalHash);
  assert.equal(sha(bytes), scope.sliceHash);
  assert.equal(attachment.inlineData.mimeType, 'application/pdf');
  assert.equal(attachment.mediaResolution.level, 'MEDIA_RESOLUTION_HIGH');
  const extracted = await extractKnowledgePdf(bytes, { startPage: 1, pageLimit: 1, expectedHash: scope.sliceHash });
  assert.equal(extracted.totalPages, scope.lastPhysicalPage - scope.firstPhysicalPage + 1);
  calls.push({ role: payload.role, core: [scope.firstCorePage, scope.lastCorePage],
    attached: [scope.firstPhysicalPage, scope.lastPhysicalPage], sliceHash: scope.sliceHash });
  const pages = {}, ranges = {};
  for (let page = scope.firstCorePage; page <= scope.lastCorePage; page++) {
    pages['page' + page] = { status: examples.has(page) ? 'content' : 'navigation', reason: 'Synthetic inspected page ' + page };
  }
  for (const { first, last } of payload.ranges) {
    const page = [...examples.keys()].find(p => first <= p && p <= last), example = examples.get(page);
    const key = 'pages-' + first + '-' + last;
    if (payload.role === 'review') {
      assert.equal(payload.candidate[key]?.quote, undefined);
      const originalQuote = mode === 'contradiction' && page === 15 ? 'Conflicting text' : example?.quote ?? '';
      ranges[key] = { supported: true, originalQuote, reason: 'Source page and adjacent qualification verified' };
    } else {
      ranges[key] = example ? { section: 'Synthetic range ' + page, text: 'Synthetic read on page ' + page,
        keywords: ['sample'], applicability, quotePage: page, ...example } : null;
    }
  }
  const output = { pages, ranges };
  if (payload.role === 'review') {
    output.decision = 'approve';
    output.checks = Object.fromEntries(['age', 'numbersAndUnits', 'timing', 'conditions', 'exceptions', 'prohibitions', 'withdrawal']
      .map(key => [key, 'Source checked']));
  }
  return { content: { role: 'model', parts: [{ text: JSON.stringify(output) }] }, finishReason: 'STOP',
    usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 50, totalTokenCount: 100 } };
}
const providers = () => ({ agent: { generate }, embedding: { async embed() {
  embeddings++;
  return { values: [1, ...Array(1023).fill(0)], inputTokens: 10, billableCharacters: 30 };
} } });
function make() {
  const knowledge = createFirestoreKnowledgeStore({ ...domain, sourceIds: [id], observations: refresh.gate });
  const runner = createFirestoreKnowledgeMaintenance({ ...domain, readControl, config, knowledge, refresh,
    providers, credentialBinding: 'synthetic-window-policy', fetch });
  return { knowledge, runner };
}
const op = sha(randomUUID()), request = { watchId: id, workerGeneration: generation, operationFingerprint: op, publishMode: 'live' };
try {
  const states = [];
  for (let i = 0; i < 4; i++) {
    const { runner } = make(), result = await runner.start(request, original);
    states.push(result);
    console.log(JSON.stringify({ i, code: result.code, status: result.status, calls: calls.length, embeddings }));
    if (result.code === 'knowledge_window_pending')
      continue;
    break;
  }
  const { knowledge } = make(), work = createFirestoreKnowledgeWork({ ...domain, readControl }), save = await work.inspect(request), edition = await knowledge.publishedEdition(id);
  if (mode === 'contradiction') {
    assert.equal(edition, null);
    assert.equal(embeddings, 0);
    assert.equal(states.at(-1).code, 'knowledge_window_quote_mismatch');
  } else if (mode === 'quota') {
    assert.equal(states.at(-1).code, 'knowledge_model_daily_admission');
    assert.equal(await knowledge.publishedEdition(id), null);
    assert.equal(save.quotaPhase, 'model');
    assert.equal(save.budget.modelCalls, 1);
    assert.equal(save.result, null);
    assert.equal((await make().runner.start(request, original)).code, 'knowledge_model_daily_admission');
    assert.equal(calls.length, 1);
    assert.equal(embeddings, 0);
  } else {
    assert.ok(edition?.enabled);
    assert.equal(calls.length, 6);
    assert.equal(embeddings, 3);
    assert.equal(downloads, 1);
    assert.equal(save.prepared.provenance.windows.flatMap(w => w.pages).length, 33);
    assert.equal(edition.source.chunks.find(c => c.originalKind === 'page_transcription').originalText, 'Scan label AX7');
    assert.equal(edition.source.chunks.find(c => c.originalKind === 'visual_page').originalText, undefined);
    const filter = { region: 'HK', classification: 'official_guidance', age: null, ageMatch: 'unknown', topics: [] };
    const candidates = await knowledge.candidates(filter, null, { query: 'Synthetic', limit: 6 });
    assert.equal(candidates.length, 3);
    assert.ok(candidates.every(c => c.originalCoverage === 'excerpt_only' && c.extraction.contentHash === originalHash));
    assert.equal(candidates.find(c => c.originalKind === 'page_transcription').originalText, 'Scan label AX7');
    assert.equal(candidates.find(c => c.originalKind === 'visual_page').sourceExcerpt, '');
    assert.deepEqual(calls.map(c => c.role), ['organize', 'review', 'organize', 'review', 'organize', 'review']);
    assert.deepEqual(calls.filter(c => c.role === 'review').map(c => c.attached), [[1, 15], [14, 29], [28, 33]]);
    assert.equal((await make().runner.start(request, original)).status, 'already_recorded');
    assert.equal(calls.length, 6);
    landingStatus = 404;
    const missing = { ...request, operationFingerprint: sha(randomUUID()) };
    const unavailable = await make().runner.start(missing, original);
    assert.equal(unavailable.status, 'unavailable');
    assert.equal(unavailable.code, 'http_404');
    assert.equal((await make().runner.start(missing, original)).status, 'already_recorded');
    assert.equal((await knowledge.publishedEdition(id)).versionHash, edition.versionHash);
  }
} finally {
  await domain.database.terminate();
}
