import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { GoogleGenAI } from '@google/genai';
import { newOfflineLedger, openLedger, sha256 } from '../scripts/lib/chat-intent-probe-guards.mjs';
import { DOCUMENT_BATCH, offlineLegacyFingerprint, openOfflineDocumentBatch, prepareDocumentBatchWirePayload } from '../scripts/lib/chat-document-batch-guards.mjs';
import { createControlledDocumentBatchConsumer, createOfflineDocumentBatchConsumer } from '../scripts/lib/chat-document-batch-consumer.mjs';

const productRoot = process.env.CONTROLLED_OFFLINE_PRODUCT_ROOT ?? path.resolve(import.meta.dirname, '..');
const modelModule = await import(pathToFileURL(path.join(productRoot, 'server/agent-model-gateway.ts')).href);
const config = { enabled: true, project: DOCUMENT_BATCH.project, location: 'global', model: DOCUMENT_BATCH.model,
  maxOutputTokens: 1024, maxAttempts: 1, timeoutMs: 1000, agentThinkingLevel: 'medium' };
const sdkResponse = { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'Synthetic reply' }] } }],
  usageMetadata: { promptTokenCount: 10, totalTokenCount: 15 } };
const assertNoCredentialEnvironment = () => assert.equal(
  ['GOOGLE_API_KEY', 'GEMINI_API_KEY'].some(key => Object.hasOwn(process.env, key)), false,
  'The SDK serialization test requires absent credential environment keys');

test('the real GenAI 2.24 serializer preserves the entire admitted request and performs one HTTP attempt', async () => {
  const request = { contents: [
    { role: 'user', parts: [{ text: 'Synthetic input' }] },
    { role: 'model', parts: [{ text: 'Synthetic thought', thought: true, thoughtSignature: 'AA==' }] },
    { role: 'model', parts: [{ functionCall: { id: 'original-call', name: 'read_work', args: { workId: null } }, thoughtSignature: 'AQ==' }] },
    { role: 'user', parts: [{ functionResponse: { id: 'original-call', name: 'read_work', response: { status: 'succeeded', data: { result: 'Synthetic work' } } } }] },
    { role: 'user', parts: [{ text: 'Synthetic first-call summary' }] },
  ], config: { systemInstruction: 'Synthetic system', labels: { adk_agent_name: 'yuban_agent' },
    tools: [{ functionDeclarations: [{ name: 'read_work', description: 'Synthetic declaration', parameters: {
      type: 'OBJECT', properties: { workId: { type: 'STRING', nullable: true } }, required: ['workId'],
    } }] }], toolConfig: { functionCallingConfig: { mode: 'AUTO' } } } };
  const builder = modelModule.createVertexAgentPayloadBuilder(config);
  const payload = builder(request), options = modelModule.vertexAgentClientOptions(config);
  assert.equal(options.httpOptions.retryOptions.attempts, 1);
  const bodies = [], urls = []; let fakeAuth = 0;
  assertNoCredentialEnvironment();
  const client = new GoogleGenAI({ ...options,
    googleAuthOptions: { authClient: { getRequestHeaders: async () => { fakeAuth++; return new Headers(); } } },
    httpOptions: { ...options.httpOptions, fetch: async (url, init) => {
      urls.push(String(url)); bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify(sdkResponse), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  await client.models.generateContent({ ...payload, config: { ...payload.config, abortSignal: new AbortController().signal } });
  assert.equal(fakeAuth, 1); assert.equal(bodies.length, 1);
  assert.equal(urls[0], `https://aiplatform.googleapis.com/v1/projects/${config.project}/locations/global/publishers/google/models/${config.model}:generateContent`);
  assert.deepEqual(bodies[0], { contents: request.contents,
    systemInstruction: { parts: [{ text: request.config.systemInstruction }], role: 'user' },
    tools: request.config.tools, toolConfig: request.config.toolConfig, labels: request.config.labels,
    generationConfig: { candidateCount: 1, maxOutputTokens: 1024, thinkingConfig: { thinkingLevel: 'MEDIUM' } } });
  let attempts = 0;
  assertNoCredentialEnvironment();
  const failedClient = new GoogleGenAI({ ...options,
    googleAuthOptions: { authClient: { getRequestHeaders: async () => new Headers() } },
    httpOptions: { ...options.httpOptions, fetch: async () => {
      attempts++; return new Response(JSON.stringify({ error: { code: 429, message: 'Synthetic rate limit', status: 'RESOURCE_EXHAUSTED' } }),
        { status: 429, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  await assert.rejects(failedClient.models.generateContent(payload)); assert.equal(attempts, 1);
});

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'consumer-test-'));
  const filename = path.join(directory, 'synthetic-ledger.json');
  fs.writeFileSync(filename, JSON.stringify({ ...newOfflineLedger(), offlineSimulationOnly: true }));
  for (const runId of ['historical_b_synthetic', 'historical_c_synthetic']) {
    const ledger = openLedger(filename, { offline: true, runId, caseId: 'B' });
    for (let i = 0; i < 4; i++) { ledger.reserve(); ledger.response({ promptTokenCount: 10, totalTokenCount: 15 }); }
    ledger.finish('completed'); ledger.close();
  }
  const checkpoint = { filename, batchId: 'consumer_synthetic_01',
    expectedLegacySha256: offlineLegacyFingerprint(JSON.parse(fs.readFileSync(filename, 'utf8'))),
    provenance: { testedSha: '04fb3f3ef7aa70cb63451b1229d8936241e389f1', legacyHarnessSha: 'f93dfb8f200c427867c4a02b803f4453681b0c75',
      candidateSha256: sha256(fs.readFileSync(new URL('../scripts/lib/chat-document-batch-consumer.mjs', import.meta.url))) } };
  const documents = ['school', 'outing'].map(id => ({ id, version: 3, current: { title: id, sections: [{ items: [
    { id: 'bag', checked: false }, { id: 'bottle', checked: false },
  ] }] } }));
  let consumer;
  t.after(() => { consumer?.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { checkpoint, documents, set: value => { consumer = value; return value; } };
}

test('consumer preparation, terminal tool failure and forged completed result stop before any next root', async t => {
  for (const failure of ['preparation', 'tool', 'semantic']) {
    const f = fixture(t); let roots = 0, sends = 0;
    const consumer = f.set(createOfflineDocumentBatchConsumer({ config, productModelModule: modelModule, checkpoint: f.checkpoint,
      synthetic: { count: async () => 10, generate: async () => { sends++; return {
        finishReason: 'STOP', content: sdkResponse.candidates[0].content, usageMetadata: sdkResponse.usageMetadata,
      }; } },
      execution: { inspect: () => ({ documents: f.documents, documentWrites: 0, works: [], receipts: [] }),
        runRoot: async (_input, provider) => {
          roots++;
          if (failure === 'preparation') return provider.generate({ contents: [{ role: 'user', parts: [{ inlineData: { data: 'AA==' } }] }], config: {} }, new AbortController().signal);
          await provider.generate({ contents: [{ role: 'user', parts: [{ text: 'Synthetic root' }] }], config: {} }, new AbortController().signal);
          return { approved: true, passed: true, status: 'completed', tools: [{ name: 'present_answer', status: failure === 'tool' ? 'unknown' : 'succeeded' }],
            countsKnown: true, counts: { modelCalls: 1, queryEmbeddings: 0 }, proposals: [], text: 'Fake success' };
        } },
    }));
    await assert.rejects(consumer.run());
    assert.equal(roots, 1); assert.equal(sends, failure === 'preparation' ? 0 : 1);
    assert.equal(consumer.snapshot().state, 'failed');
    await assert.rejects(consumer.run(), /consumer_run_reused/);
  }
  let touched = 0;
  assert.throws(() => createControlledDocumentBatchConsumer({ approved: true, passed: true,
    count: () => touched++, send: () => touched++ }), /live_disabled/);
  assert.equal(touched, 0);
});


test('wire admission binds exact native bytes and rejects target, defaults, hidden media and forged handles', async t => {
  const settings = { project: config.project, location: config.location, model: config.model,
    thinkingLevel: 'MEDIUM', candidateCount: 1, maxOutputTokens: 1024, attempts: 1 };
  const url = `https://aiplatform.googleapis.com/v1/projects/${config.project}/locations/global/publishers/google/models/${config.model}:generateContent`;
  const body = { contents: [{ role: 'user', parts: [{ text: 'Synthetic history' }] }],
    generationConfig: { candidateCount: 1, maxOutputTokens: 1024, thinkingConfig: { thinkingLevel: 'MEDIUM' } } };
  const wire = { url, body: JSON.stringify(body) };
  for (const target of [url + '?key=synthetic', url.replace(':generateContent', ':streamGenerateContent'),
    url.replace('locations/global', 'locations/us-central1'), url.replace(config.project, 'another-project'),
    url.replace(config.model, 'another-model'), url.replace('https:', 'http:')])
    assert.throws(() => prepareDocumentBatchWirePayload({ ...wire, url: target }, settings), /wire_target_invalid/);
  assert.throws(() => prepareDocumentBatchWirePayload({ ...wire, body: JSON.stringify({ ...body, generationConfig: {} }) }, settings), /wire_generation_config_invalid/);
  assert.throws(() => prepareDocumentBatchWirePayload({ ...wire, body: wire.body + ' ' }, settings), /wire_body_invalid/);
  assert.throws(() => prepareDocumentBatchWirePayload({ ...wire, body: JSON.stringify({ ...body,
    contents: [{ role: 'user', parts: [{ functionResponse: { name: 'read_work', response: { status: 'succeeded' },
      parts: [{ fileData: { fileUri: 'gs://synthetic/object', mimeType: 'text/plain' } }] } }] }] }) }, settings), /text_only_payload_required/);
  const f = fixture(t), batch = openOfflineDocumentBatch(f.checkpoint.filename, f.checkpoint);
  f.set(batch); batch.startRoot(DOCUMENT_BATCH.roots[0]);
  const handle = prepareDocumentBatchWirePayload(wire, settings);
  let counted;
  await batch.simulateGeneration(handle, { countSynthetic: async payload => {
    counted = payload; assert.deepEqual(payload, wire); assert.equal(Object.isFrozen(payload), true); return 10;
  }, sendSynthetic: async payload => { assert.equal(payload, counted); return {
    content: sdkResponse.candidates[0].content, finishReason: 'STOP', usageMetadata: sdkResponse.usageMetadata,
  }; } });
  await assert.rejects(batch.simulateGeneration({ ...handle }, { countSynthetic: () => { throw Error('Must not count'); }, sendSynthetic: () => { throw Error('Must not send'); } }), /batch_payload_or_concurrency_invalid/);
  assert.equal(batch.snapshot().generationCallsReserved, 1); assert.equal(batch.snapshot().state, 'failed');
});

test('consumer withholds forbidden search from ADK and cannot use another send after failure', async t => {
  const f = fixture(t); let roots = 0, sends = 0, delivered = 0, counts = 0;
  const consumer = f.set(createOfflineDocumentBatchConsumer({ config, productModelModule: modelModule, checkpoint: f.checkpoint,
    synthetic: { count: async () => { counts++; return 10; }, generate: async () => { sends++; return {
      content: { role: 'model', parts: [{ functionCall: { name: 'search_knowledge', args: { query: 'Synthetic query' } } }] },
      finishReason: 'STOP', usageMetadata: sdkResponse.usageMetadata,
    }; } }, execution: { inspect: () => ({ documents: f.documents, documentWrites: 0, works: [], receipts: [] }),
      runRoot: async (_input, provider) => {
        roots++;
        const request = { contents: [{ role: 'user', parts: [{ text: 'Synthetic search attempt' }] }], config: {} };
        await assert.rejects(provider.generate(request, new AbortController().signal).then(result => { delivered++; return result; }), /batch_tool_denied/);
        await assert.rejects(provider.generate(request, new AbortController().signal), /batch_terminal/);
        throw Error('First tool failure must stop');
      } },
  }));
  await assert.rejects(consumer.run());
  assert.equal(roots, 1); assert.equal(sends, 1); assert.equal(counts, 1); assert.equal(delivered, 0);
  assert.equal(consumer.snapshot().state, 'failed');
} );

test('credential environment presence is rejected without reading its value or touching counter and transport', t => {
  for (const key of ['GOOGLE_API_KEY', 'GEMINI_API_KEY']) {
    assert.equal(Object.hasOwn(process.env, key), false, 'This offline test requires absent credential environment keys');
    const f = fixture(t); let touched = 0;
    const before = fs.readFileSync(f.checkpoint.filename, 'utf8');
    process.env[key] = 'synthetic-unused-placeholder';
    try {
      assert.throws(() => createOfflineDocumentBatchConsumer({ config, productModelModule: modelModule, checkpoint: f.checkpoint,
        synthetic: { count: () => touched++, generate: () => touched++ }, execution: { inspect: () => touched++, runRoot: () => touched++ } }),
      /consumer_credential_environment_denied/);
      assert.equal(touched, 0); assert.equal(fs.readFileSync(f.checkpoint.filename, 'utf8'), before);
    } finally { delete process.env[key]; }
  }
});

test('clarification cannot advance using two copies of only one original document reference', async t => {
  const f = fixture(t); let works = [], roots = 0, sends = 0;
  const consumer = f.set(createOfflineDocumentBatchConsumer({ config, productModelModule: modelModule, checkpoint: f.checkpoint,
    synthetic: { count: async () => 10, generate: async () => { sends++; return {
      content: sdkResponse.candidates[0].content, finishReason: 'STOP', usageMetadata: sdkResponse.usageMetadata,
    }; } }, execution: { inspect: () => ({ documents: f.documents, works, documentWrites: 0, receipts: [] }),
      runRoot: async (_input, provider) => {
        roots++;
        await provider.generate({ contents: [{ role: 'user', parts: [{ text: 'Synthetic clarification' }] }], config: {} }, new AbortController().signal);
        works = [{ id: 'synthetic-work', status: 'waiting', version: 1, questions: ['Which document?'],
          resources: [1, 2].map(() => ({ kind: 'family_document', id: f.documents[0].id, version: f.documents[0].version })) }];
        return { status: 'completed', tools: ['read_context', 'read_work', 'read_family_documents', 'save_work', 'present_answer'].map(name => ({ name, status: 'succeeded' })),
          proposals: [], countsKnown: true, counts: { modelCalls: 1, queryEmbeddings: 0 }, text: '入學或旅行？' };
      } },
  }));
  await assert.rejects(consumer.run(), /clarification_outcome_invalid/);
  assert.equal(roots, 1); assert.equal(sends, 1); assert.equal(consumer.snapshot().state, 'failed');
  assert.equal(JSON.parse(fs.readFileSync(f.checkpoint.filename, 'utf8')).offlineBatchJournal.events.filter(event => event.type === 'root_passed').length, 0);
});
