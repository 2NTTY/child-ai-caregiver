// Explicit local integration command, never part of automatic startup or unit discovery.
import assert from 'node:assert/strict';
import React from 'react';
import { avatarMemoryBucket } from './helpers/avatar-memory.ts';
import { Document, Page, Text, renderToBuffer } from '@react-pdf/renderer';
import { Firestore } from '@google-cloud/firestore';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreKnowledgeRefresh } from '../server/firestore-knowledge-refresh.ts';
import { createFirestoreKnowledgeStore } from '../server/firestore-knowledge.ts';
import { createFirestoreKnowledgeMaintenance } from '../server/firestore-knowledge-maintenance.ts';
import { createFirestoreKnowledgeWork } from '../server/firestore-knowledge-work.ts';
import { SOURCE_WATCHES } from '../server/knowledge-source-catalog.ts';
import { readAiConfig } from '../server/ai-config.ts';

import { createFirestoreModelRouting } from '../server/firestore-model-routing.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';

const sponsored = process.argv.includes('--sponsored');
const state = sponsored ? { projectId: 'demo-req005-maintenance', storageKey: randomBytes(32).toString('base64') } : JSON.parse(await readFile(new URL('../.cache/agent-local/state.json', import.meta.url), 'utf8'));
if (!state.projectId.startsWith('demo-') || !/^127\.0\.0\.1:\d+$/u.test(process.env.FIRESTORE_EMULATOR_HOST ?? ''))
  throw Error('This check requires an explicitly running isolated local emulator');
process.env.YUYF_LOCAL_DEVELOPMENT = '1';
const database = new Firestore({ projectId: state.projectId, databaseId: '(default)' });
const namespace = 'verify_knowledge_' + Date.now();
const domain = { database, namespace, projectId: state.projectId, cipher: createStorageCipher(Buffer.from(state.storageKey, 'base64')) };
const authority = createFirestoreAuthority(domain), generation = randomUUID();
// Use the catalog source without an executable growth-rule dependency. The
// HTML rule source is covered by the model test's mandatory hold assertion.
const definition = SOURCE_WATCHES.find(item => item.id === 'fhs-feeding-booklet-en');
const text = 'Bring the health record and a list of questions to the visit.';
const pdf = await renderToBuffer(React.createElement(Document, {}, React.createElement(Page, {}, React.createElement(Text, {}, text))));
const observed = { url: definition.url, title: 'Synthetic local preparation', text,
  sourcePublishedAt: null, sourceUpdatedAt: null, sourceDateText: null,
  extraction: { format: 'text_pdf', contentHash: createHash('sha256').update(pdf).digest('hex'),
    pageStart: 1, pageEnd: 1, totalPages: 1, complete: true },
  pages: [{ page: 1, text, status: 'text' }] };
const vector = [1, ...Array(1023).fill(0)];
const calls = [];
let embeddings = 0, fetches = 0;
try {
  await authority.initializeControl({ enabled: true, generation });
  const readControl = tx => authority.readControl(tx);
  const refresh = createFirestoreKnowledgeRefresh({ ...domain, originalBucket: { bucketName: "demo-originals", bucket: avatarMemoryBucket("demo-originals").port }, definitions: SOURCE_WATCHES, readControl });
  await refresh.register(definition.id, 'synthetic-local-verification');
  const knowledge = createFirestoreKnowledgeStore({ ...domain, sourceIds: [definition.id], observations: refresh.gate });
  const config = { ...readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-model-project' }),
    backgroundKnowledgeMaintenanceEnabled: true, backgroundKnowledgeLiveFetch: false, backgroundKnowledgeLivePublish: true };
  const options = { ...domain, config, credentialBinding: 'scripted-no-network', knowledge, refresh, readControl, isolatedFixturePublish: true,
    fetch: async () => { throw Error('No external fetch allowed'); },
    fixtureFetch: async () => { fetches++; return { status: 'ok', original: {mimeType:'application/pdf',bytes:pdf}, items: [observed] }; },
    providers: () => ({
      agent: { async generate(request) {
        const input = JSON.parse(request.contents[0].parts[0].text);
        calls.push(input.role);
        const originalPart = request.contents[0].parts[1].inlineData;
        assert.equal(originalPart.mimeType, "application/pdf");
        assert.ok(Buffer.from(originalPart.data, "base64").equals(pdf));
        const nativeCoverage = { pages: [{page:1, finding:"Synthetic visit checklist"}], unreadablePages:[], layoutAnswer:null };
        let output;
        if (input.role === 'background-knowledge-maintenance') output = {
          ranges: Object.fromEntries(input.ranges.map(range => [range.key, {section:'到診準備',
            pageText: {physicalPage1:'帶備健康記錄及問題清單。'}, keywords:['到診', '記錄'], region:'HK', ageRange:null, topics:['preparation'], conditions:[]} ])),
          nativeCoverage,
        };
        else {
          assert.equal(input.role, 'knowledge-semantic-review');
          output = {
            nativeCoverage: { pageFindings: {page1:"Synthetic visit checklist"}, unreadablePages: [], layoutAnswer: null }, changes: Object.fromEntries(input.candidate.chunks.map(chunk => [chunk.key,
              {meaning: 'new', explanation: 'The supplied original supports the preparation.'}])),
            checks: { age: 'No age claim', numbersAndUnits: 'No numbers', timing: 'Before visit', conditions: 'Preserved',
              exceptions: 'None supplied', prohibitions: 'None supplied', withdrawal: 'No previous edition' },
            questions: [{ query: '到診帶甚麼？', expectedKeys: input.candidate.chunks.map(chunk => chunk.key), reason: 'Original supports both items' }],
            decisionReason: 'The candidate is supported by the supplied original.', decision: 'approve' };
        }
        return { content: { role: 'model', parts: [{ text: JSON.stringify(output) }] }, finishReason: 'STOP',
          usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 20, totalTokenCount: 40 } };
      } },
      embedding: { async embed() { embeddings++; return { values: vector, inputTokens: 10, billableCharacters: 30 }; } },
    }),
  };
  let sponsorRouting, revoke;
  if (sponsored) {
    const uid = 'test-public-sponsor', email = uid + '@example.test', key = 'synthetic-maintenance-emulator-key';
    await authority.issueInvitation({ email, expiresAt: new Date(Date.now() + 60000).toISOString(), operationId: randomUUID() });
    await authority.admitIdentity({ userId: uid, email, emailVerified: true });
    await authority.acknowledge({ userId: uid, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    sponsorRouting = createFirestoreModelRouting(domain, config);
    const policy = { mode: 'personal', backgroundEnabled: true, publicMaintenanceEnabled: true, dailyLimit: 20,
      maxModelCalls: 2, maxQueryEmbeddings: 1, consent: true };
    await sponsorRouting.settings.save(uid, { ...policy, opId: randomUUID(), expectedVersion: 0, apiKey: key });
    revoke = () => sponsorRouting.settings.save(uid, { ...policy, opId: randomUUID(), expectedVersion: 1, publicMaintenanceEnabled: false });
    const scripted = options.providers();
    options.sponsor = { userId: uid, routing: sponsorRouting, identityActive: async () => true };
    options.providers = () => { throw Error('Unexpected platform credential'); };
    // Keep the real personal adapters and intercept only their network requests.
    globalThis.fetch = async (url, init) => {
      const endpoint = new URL(url instanceof Request ? url.url : url);
      assert.equal(endpoint.hostname, 'generativelanguage.googleapis.com');
      assert.equal(new Headers(init?.headers ?? url.headers).get('x-goog-api-key'), key);
      const body = JSON.parse(init?.body ?? await url.text());
      if (endpoint.pathname.endsWith(':countTokens')) return Response.json({ totalTokens: 200 });
      if (endpoint.pathname.endsWith(':generateContent')) {
        const generated = await scripted.agent.generate(body);
        return Response.json({ candidates: [{ content: generated.content, finishReason: generated.finishReason }], usageMetadata: generated.usageMetadata });
      }
      if (endpoint.pathname.endsWith(':batchEmbedContents')) {
        assert.equal(body.requests.length, 1);
        assert.equal(body.requests[0].taskType, 'RETRIEVAL_DOCUMENT');
        assert.ok(body.requests[0].title);
        const result = await scripted.embedding.embed();
        return Response.json({ embeddings: [{ values: result.values }] });
      }
      throw Error('Unexpected personal provider endpoint: ' + endpoint.pathname);
    };
  }
  const request = { watchId: definition.id, operationFingerprint: createHash('sha256').update(randomUUID()).digest('hex'),
    workerGeneration: generation, publishMode: 'live' };
  const result = await createFirestoreKnowledgeMaintenance(options).start(request);
  assert.equal(result.published, true, JSON.stringify(result));
  assert.deepEqual(calls, ['background-knowledge-maintenance', 'knowledge-semantic-review']);
  assert.equal(embeddings, 1);
  const edition = await knowledge.publishedEdition(definition.id);
  assert.equal(edition.source.chunks[0].originalText, text);
  assert.equal(edition.source.chunks[0].text, '帶備健康記錄及問題清單。');
  // Reassemble, then replay the same operation. No generation, fetch or embedding repeats.
  const repeated = await createFirestoreKnowledgeMaintenance(options).start(request);
  assert.equal(repeated.published, true);
  assert.equal(repeated.status, 'already_recorded');
  assert.equal(calls.length, 2); assert.equal(fetches, 1); assert.equal(embeddings, 1);
  const retrieved = await knowledge.candidates({ region: 'HK', classification: 'official_guidance', age: null, ageMatch: 'unknown', topics: [] },
    vector, { query: '到診' });
  assert.equal(retrieved.length, 1);
  assert.equal(retrieved[0].versionId, edition.versionId);
  if (sponsored) {
    const day = new Date().toISOString().slice(0, 10);
    const userUsage = await sponsorRouting.usage.personal.getForUser('test-public-sponsor', []);
    assert.equal(userUsage.attempts, 3);
    assert.equal(userUsage.finance.unsettledAttempts, 0);
    assert.equal(userUsage.maintenanceFinance.unsettledAttempts, 3);
    assert.equal((await sponsorRouting.usage.platform.getGlobal(day)).attempts, 0);
    await revoke();
    await assert.rejects(createFirestoreKnowledgeMaintenance(options).start({ ...request,
      operationFingerprint: createHash('sha256').update(randomUUID()).digest('hex') }), /unauthorized/u);
    assert.equal(calls.length, 2);
    assert.equal(embeddings, 1);
  }
  // Unknown model outcome must stay lookup-only across a new lease/process.
  const work = createFirestoreKnowledgeWork({ ...domain, readControl });
  const unknownRequest = { ...request, operationFingerprint: createHash('sha256').update(randomUUID()).digest('hex') };
  const policyHash = 'e'.repeat(64), token = randomUUID();
  const first = await work.bind(unknownRequest, token, policyHash, { modelCalls: 2, deadlineMs: 120000 });
  await first.ports.claimOperation(unknownRequest.operationFingerprint, token, Date.now() + 60000);
  const input = { system: 'synthetic', user: 'synthetic', attemptKey: 'synthetic-unknown' };
  await assert.rejects(first.completeText(input, async () => { throw Error('transport outcome unknown'); }));
  await first.ports.releaseOperation(unknownRequest.operationFingerprint, token);
  const nextToken = randomUUID(), next = await work.bind(unknownRequest, nextToken, policyHash, { modelCalls: 2, deadlineMs: 120000 });
  await next.ports.claimOperation(unknownRequest.operationFingerprint, nextToken, Date.now() + 60000);
  await assert.rejects(next.completeText(input, async () => { throw Error('must never be called'); }), { code: 'knowledge_work_model_outcome_unknown' });
  await next.ports.releaseOperation(unknownRequest.operationFingerprint, nextToken);
  console.log(JSON.stringify({ status: 'passed', namespace, result: result.status, modelStages: calls, scriptedEmbeddings: embeddings,
    sponsored, nativeEmulatorPublication: true, sameOperationReassembled: true, unknownNotRedispatched: true, trueModelCalls: 0 }));
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', namespace, scriptedModelCalls: calls.length, scriptedEmbeddings: embeddings,
    code: error.code ?? error.name, trueModelCalls: 0 }));
  throw error;
} finally { await database.terminate(); }
