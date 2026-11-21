import { z } from 'zod';
import type { Transaction } from '@google-cloud/firestore';
import type { AiConfig } from './ai-config.ts';
import type { FirestoreDomainOptions } from './firestore-domain-data.ts';
import { createFirestoreAdmin } from './firestore-admin.ts';
import { FirestoreAiUsage, KNOWLEDGE_MAINTENANCE_PAYER } from './firestore-ai-usage.ts';
import { createVertexAgentProvider } from './agent-model-gateway.ts';
import { createVertexEmbeddingProvider } from './vertex-embedding.ts';
import { createFirestoreOperatorEmbeddingUsage } from './firestore-embedding-usage.ts';
import { createEmbeddingGateway } from './embedding-gateway.ts';
import { mediaCue } from '../src/shared/platform-media.ts';
import { knowledgeHash } from './knowledge-inputs.ts';
import { knowledgeOperationId } from './firestore-knowledge-maintenance.ts';
import type { MediaAnalyzer } from './platform-media-processing.ts';
import type { FirestoreKnowledgeStore } from './firestore-knowledge.ts';
import { resolveModelThinkingLevel } from './model-thinking.ts';
import { readFile } from 'node:fs/promises';

export function platformCardProviders(domain: FirestoreDomainOptions, config: AiConfig, store: FirestoreKnowledgeStore,
  readControl: (tx: Transaction) => Promise<{ enabled: boolean }>) {
  const policy = createFirestoreAdmin(domain, config);
  const usage = new FirestoreAiUsage({ ...domain, namespace: domain.namespace + '_ai_usage', billingSource: 'platform' });
  async function route() {
    const current = await policy.readPolicy();
    if (!config.enabled || !current.enabled || !config.backgroundKnowledgeMaintenanceEnabled
      || !(await domain.database.runTransaction(readControl)).enabled) throw Error('knowledge_media_not_authorized');
    return { ...config, model: current.model, agentThinkingLevel: resolveModelThinkingLevel(current.model),
      dailyUserAttempts: current.dailyUserAttempts, dailyGlobalAttempts: current.dailyGlobalAttempts };
  }
  const analyze: MediaAnalyzer = async (original, signal, authorize) => {
    if (original.transcript.trim() || original.captions.length) throw Error('knowledge_media_text_available');
    const cfg = await route(), native = createVertexAgentProvider(cfg);
    const instruction = await readFile(new URL('../prompts/modules/platform-media-timing.md', import.meta.url), 'utf8');
    const mimeType = original.url.endsWith('.mp3') ? 'audio/mpeg' : original.url.endsWith('.m4a') ? 'audio/mp4' : 'video/mp4';
    const contents = [{ role: 'user', parts: [{ text: '此影音未有官方講稿。' },
      { fileData: { fileUri: original.url, mimeType } }] }];
    const request = { kind: 'model' as const, budgetPurpose: 'knowledge_maintenance' as const,
      rootRunId: knowledgeOperationId('platform-media/1', original.hash), attemptKey: 'align-public-media',
      bindingFingerprint: knowledgeHash(['public-media/1', original.hash]), requestFingerprint: knowledgeHash([instruction, contents, cfg.model]),
      userId: KNOWLEDGE_MAINTENANCE_PAYER, childId: '00000000-0000-0000-0000-000000000000', model: cfg.model,
      deadlineAtMs: Date.now() + cfg.timeoutMs, userLimit: cfg.dailyUserAttempts, globalLimit: cfg.dailyGlobalAttempts };
    if (!await authorize()) throw Error('knowledge_media_not_authorized');
    const grant = await usage.reserve(request);
    if (grant.decision === 'quota_exceeded') throw Error('knowledge_media_daily_capacity');
    if (grant.decision !== 'execute') throw Error('knowledge_media_previous_attempt');
    const started = Date.now(), response = await native.generate({ contents, toolsDict: {}, liveConnectConfig: {},
      config: { systemInstruction: instruction, responseMimeType: 'application/json' } }, signal);
    const input = response.usageMetadata?.promptTokenCount ?? null, total = response.usageMetadata?.totalTokenCount;
    await usage.record(request, { outcome: 'succeeded', inputTokens: input, outputTokens: input !== null && total !== undefined ? Math.max(0,total-input) : null,
      cachedTokens: response.usageMetadata?.cachedContentTokenCount ?? null, durationMs: Date.now() - started });
    if (response.finishReason !== 'STOP') throw Error('knowledge_media_incomplete');
    const cues = z.array(mediaCue).min(1).max(200).parse(JSON.parse(response.content?.parts?.filter(p => !p.thought).map(p => p.text ?? '').join('') ?? ''));
    return cues;
  };
  async function indexReviewed(versionId: string, versionHash: string) {
    const pending = await store.missingDocuments(versionId);
    if (!pending.length) return;
    const cfg = await route(), deadline = Date.now() + 300000, signal = AbortSignal.timeout(300000);
    const provider = createVertexEmbeddingProvider({ ...cfg, location: 'us-central1' });
    for (const doc of pending) {
      const embedder = createEmbeddingGateway({ config: cfg, billingSource: 'platform',
        usage: createFirestoreOperatorEmbeddingUsage(domain, deadline), provider });
      await store.embedDocument(doc, () => embedder.embed({ text: doc.text, title: doc.title, task: 'RETRIEVAL_DOCUMENT' },
        { kind: 'corpus_maintenance', actorId: 'operator:knowledge-maintenance',
          operationId: knowledgeOperationId('platform-card-sync/1', knowledgeHash([versionHash, doc.hash])) },
        signal, async () => (await route()).enabled));
    }
  }
  return { analyze, indexReviewed };
}
