import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { FinishReason } from '@google/genai';
import { readAiConfig } from '../server/ai-config.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreKnowledgeStore } from '../server/firestore-knowledge.ts';
import { createFirestoreKnowledgeRefresh } from '../server/firestore-knowledge-refresh.ts';
import { createFirestoreKnowledgeMaintenance, knowledgeOperationId } from '../server/firestore-knowledge-maintenance.ts';
import { createFirestoreKnowledgeWork, knowledgeTruncatedOutputRepairId } from '../server/firestore-knowledge-work.ts';
import type { PlatformProviderFactory } from '../server/firestore-model-routing.ts';
import { observationHash } from '../server/knowledge-observation.ts';
import { fhsMaterialWatches } from '../server/platform-materials.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';

for (const failedStage of ['organizer', 'reviewer'] as const) test(`a truncated ${failedStage} resumes with the original observation and one publication`, async () => {
  const { database } = firestoreDomainFixture(), generation = randomUUID();
  const domain = { database, namespace: 'truncated', projectId: 'demo-truncated', cipher: createStorageCipher(Buffer.alloc(32, 19)) };
  const authority = createFirestoreAuthority(domain);
  await authority.initializeControl({ enabled: true, generation });
  const readControl: typeof authority.readControl = tx => authority.readControl(tx);
  const definition = fhsMaterialWatches.find(w => w.id === 'fhs-14799')!;
  const refresh = createFirestoreKnowledgeRefresh({ ...domain, readControl, definitions: [definition] });
  const knowledge = createFirestoreKnowledgeStore({ ...domain, observations: refresh.gate, sourceIds: [definition.id] });
  await refresh.register(definition.id, 'operator', true);
  const [job] = await refresh.jobs(definition.id);
  const request = { watchId: definition.id, operationFingerprint: 'a'.repeat(64), workerGeneration: generation, publishMode: 'live' as const };
  const checkId = knowledgeOperationId('knowledge-observation/1', request.operationFingerprint), signal = new AbortController().signal;
  const observation = { url: definition.url, title: 'Synthetic visit', text: 'Bring your record to the visit.',
    sourceDateText: null, sourcePublishedAt: null, sourceUpdatedAt: null };
  await refresh.process(job!.data, checkId, async () => ({ status: 'ok', items: [observation] }), signal);
  const config = readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'demo-truncated', AI_BACKGROUND_KNOWLEDGE_MAINTENANCE_ENABLED: 'true',
    AI_BACKGROUND_KNOWLEDGE_LIVE_FETCH: 'true', AI_BACKGROUND_KNOWLEDGE_LIVE_PUBLISH: 'true' });
  const calls: string[] = [];
  let embeddings = 0;
  const providers: PlatformProviderFactory = cfg => ({
    model: { generate: () => assert.fail('Unexpected chat call') },
    agent: { async generate(req) {
      const payload = JSON.parse(req.contents[0]!.parts![0]!.text!);
      calls.push(payload.role);
      const organize = Boolean(payload.originalUnits), truncated = (organize ? 'organizer' : 'reviewer') === failedStage && cfg.maxOutputTokens === 1024;
      const output = organize ? { units: payload.originalUnits.map((unit: { id: string; originalText: string }) => ({
        unitId: unit.id, section: 'Visit', text: unit.originalText, keywords: ['visit'], applicability: {
          region: 'HK', ageBasis: 'any', minAgeMonths: null, maxAgeMonths: null, topics: ['care'], conditions: [] } })) } :
        { changes: payload.comparisonUnits.map((c: { key: string }) => ({ key: c.key, meaning: 'new', explanation: 'Matches the original.' })),
          checks: { age: 'Any age', numbersAndUnits: 'None', timing: 'None', conditions: 'Preserved', exceptions: 'None', prohibitions: 'None', withdrawal: 'Reviewed' },
          questions: [{ query: 'What should I bring?', expectedKeys: [payload.candidate.chunks[0].key], reason: 'Visit preparation' }],
          decision: 'approve', decisionReason: 'Matches the original.' };
      return { content: { role: 'model', parts: [{ text: truncated ? '{' : JSON.stringify(output) }] },
        finishReason: truncated ? FinishReason.MAX_TOKENS : FinishReason.STOP, usageMetadata: { promptTokenCount: 10, totalTokenCount: 16, candidatesTokenCount: 6 } };
    } },
    embedding: { async embed() { embeddings++; return { values: [1, ...Array(1023).fill(0)], inputTokens: 3, billableCharacters: 20 }; } },
  });
  const options = { ...domain, config, knowledge, refresh, readControl, providers, credentialBinding: 'scripted-platform',
    fetch: async () => assert.fail('The frozen source must never be fetched again') };
  const original = await createFirestoreKnowledgeMaintenance(options).start(request, signal, job!.data.revision, checkId);
  assert.equal(original.code, 'model_output_limit');
  const recovery = { priorWork: request.operationFingerprint, observationHash: observationHash(observation) };
  const repaired = { ...request, operationFingerprint: knowledgeTruncatedOutputRepairId(recovery.priorWork) };
  const runner = createFirestoreKnowledgeMaintenance({ ...options, config: { ...config, maxOutputTokens: 4096 }, truncatedOutput: recovery });
  await assert.rejects(runner.start(request, signal, job!.data.revision, checkId), { code: 'knowledge_truncation_repair_binding' });
  const result = await runner.start(repaired, signal, job!.data.revision, checkId);
  assert.equal(result.published, true, JSON.stringify(result));
  assert.equal((await runner.start(repaired, signal, job!.data.revision, checkId)).published, true);
  assert.deepEqual(calls, ['background-knowledge-maintenance',
    failedStage === 'organizer' ? 'background-knowledge-maintenance' : 'knowledge-semantic-review', 'knowledge-semantic-review']);
  assert.equal(embeddings, 1);
  const work = createFirestoreKnowledgeWork({ ...domain, readControl });
  assert.equal((await work.inspect(request))?.result?.code, 'model_output_limit');
  assert.equal((await work.inspect(repaired))?.budget.modelCalls, failedStage === 'organizer' ? 2 : 1);
  const chained = { ...request, operationFingerprint: knowledgeTruncatedOutputRepairId(repaired.operationFingerprint) };
  const invalid = createFirestoreKnowledgeMaintenance({ ...options, truncatedOutput: { ...recovery, priorWork: repaired.operationFingerprint } });
  await assert.rejects(invalid.start(chained, signal, job!.data.revision, knowledgeOperationId('knowledge-observation/1', repaired.operationFingerprint)),
    { code: 'knowledge_truncation_repair_binding' });
  await refresh.process(job!.data, randomUUID(), async () => ({ status: 'ok', items: [{ ...observation, text: 'A different notice.' }] }), signal);
  await assert.rejects(runner.start(repaired, signal, job!.data.revision, checkId), { code: 'knowledge_truncation_repair_binding' });
});
