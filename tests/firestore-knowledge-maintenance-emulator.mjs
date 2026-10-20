// Explicit local integration command, never part of automatic startup or unit discovery.
import assert from 'node:assert/strict';
import { Firestore } from '@google-cloud/firestore';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreKnowledgeRefresh } from '../server/firestore-knowledge-refresh.ts';
import { createFirestoreKnowledgeStore } from '../server/firestore-knowledge.ts';
import { createFirestoreKnowledgeMaintenance } from '../server/firestore-knowledge-maintenance.ts';
import { createFirestoreKnowledgeWork } from '../server/firestore-knowledge-work.ts';
import { SOURCE_WATCHES } from '../server/knowledge-source-catalog.ts';
import { readAiConfig } from '../server/ai-config.ts';

const state = JSON.parse(await readFile(new URL('../.cache/agent-local/state.json', import.meta.url), 'utf8'));
if (!state.projectId.startsWith('demo-') || !/^127\.0\.0\.1:\d+$/u.test(process.env.FIRESTORE_EMULATOR_HOST ?? ''))
  throw Error('This check requires an explicitly running isolated local emulator');
process.env.YUYF_LOCAL_DEVELOPMENT = '1';
const database = new Firestore({ projectId: state.projectId, databaseId: '(default)' });
const namespace = 'verify_knowledge_' + Date.now();
const domain = { database, namespace, projectId: state.projectId, cipher: createStorageCipher(Buffer.from(state.storageKey, 'base64')) };
const authority = createFirestoreAuthority(domain), generation = randomUUID();
const definition = SOURCE_WATCHES.find(item => item.id === 'fhs-solid-food');
const text = '到診前帶上孩子的健康記錄，並先寫下希望詢問的問題。';
const observed = { url: definition.url, title: 'Synthetic local preparation', text,
  sourcePublishedAt: null, sourceUpdatedAt: null, sourceDateText: null };
const vector = [1, ...Array(1023).fill(0)];
const calls = [];
let embeddings = 0, fetches = 0;
try {
  await authority.initializeControl({ enabled: true, generation });
  const readControl = tx => authority.readControl(tx);
  const refresh = createFirestoreKnowledgeRefresh({ ...domain, definitions: SOURCE_WATCHES, readControl });
  await refresh.register(definition.id, 'synthetic-local-verification');
  const knowledge = createFirestoreKnowledgeStore({ ...domain, sourceIds: [definition.id], observations: refresh.gate });
  const config = { ...readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-model-project' }),
    backgroundKnowledgeMaintenanceEnabled: true, backgroundKnowledgeLiveFetch: false, backgroundKnowledgeLivePublish: true };
  const options = { ...domain, config, credentialBinding: 'scripted-no-network', knowledge, refresh, readControl, isolatedFixturePublish: true,
    fetch: async () => { throw Error('No external fetch allowed'); },
    fixtureFetch: async () => { fetches++; return { status: 'ok', items: [observed] }; },
    providers: () => ({
      agent: { async generate(request) {
        const input = JSON.parse(request.contents[0].parts[0].text);
        calls.push(input.role);
        let output;
        if (input.role === 'background-knowledge-maintenance') output = {
          units: input.originalUnits.map(unit => ({ unitId: unit.id, section: '到診準備',
            text: '帶備健康記錄及問題清單。', keywords: ['到診', '記錄'],
            applicability: { region: 'HK', ageBasis: 'any', minAgeMonths: null, maxAgeMonths: null, topics: ['preparation'], conditions: [] } })),
        };
        else {
          assert.equal(input.role, 'knowledge-semantic-review');
          output = {
            changes: input.candidate.chunks.map(chunk => ({ key: chunk.key,
              meaning: 'new', explanation: 'The supplied original supports the preparation.' })),
            checks: { age: 'No age claim', numbersAndUnits: 'No numbers', timing: 'Before visit', conditions: 'Preserved',
              exceptions: 'None supplied', prohibitions: 'None supplied', withdrawal: 'No previous edition' },
            questions: [{ query: '到診帶甚麼？', expectedKeys: input.candidate.chunks.map(chunk => chunk.key), reason: 'Original supports both items' }],
            growthRuleImpact: 'none', growthRuleReason: 'No executable rule change', decision: 'approve' };
        }
        return { content: { role: 'model', parts: [{ text: JSON.stringify(output) }] }, finishReason: 'STOP',
          usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 20, totalTokenCount: 40 } };
      } },
      embedding: { async embed() { embeddings++; return { values: vector, inputTokens: 10, billableCharacters: 30 }; } },
    }),
  };
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
    nativeEmulatorPublication: true, sameOperationReassembled: true, unknownNotRedispatched: true, trueModelCalls: 0 }));
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', namespace, scriptedModelCalls: calls.length, scriptedEmbeddings: embeddings,
    code: error.code ?? error.name, trueModelCalls: 0 }));
  throw error;
} finally { await database.terminate(); }
