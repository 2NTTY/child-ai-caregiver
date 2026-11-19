import { openFirebasePersistence } from '../server/firebase-persistence.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { createKnowledgeCampaignBudget, campaignModel } from '../server/knowledge-campaign-budget.ts';
import { cloudKnowledgeOriginalBucket } from '../server/firestore-knowledge-originals.ts';
import { createFirestoreKnowledgeRefresh } from '../server/firestore-knowledge-refresh.ts';
import { createFirestoreKnowledgeStore } from '../server/firestore-knowledge.ts';
import { createFirestoreKnowledgeMaintenance, knowledgeOperationId } from '../server/firestore-knowledge-maintenance.ts';
import { fetchKnowledgeSource } from '../server/knowledge-source-fetch.ts';
import { platformSourceWatches } from '../server/knowledge-source-catalog.ts';
import { platformMaterials, fhsMaterialWatches } from '../server/platform-materials.ts';
import { knowledgeReviewHash } from '../server/knowledge-review-assessment.ts';
import { createVertexAgentProvider } from '../server/agent-model-gateway.ts';
import { createVertexEmbeddingProvider } from '../server/vertex-embedding.ts';
import { createFirestoreKnowledgeWork } from '../server/firestore-knowledge-work.ts';

const [command, id, ...extra] = process.argv.slice(2);
if (!['status', 'initialize', 'inspect', 'process'].includes(command) || extra.length || (['process', 'inspect'].includes(command) ? !id : id !== undefined))
  throw Error('Use status, initialize, inspect SOURCE_ID, or process SOURCE_ID');
const persistence = await openFirebasePersistence(process.env);
try {
  const { database, cipher, config, authority } = persistence;
  if (config.projectId !== 'ai-caregivers-for-children' || process.env.FIRESTORE_EMULATOR_HOST
    || process.env.AI_KNOWLEDGE_MAINTENANCE_PAYER !== 'platform') throw Error('knowledge_campaign_environment_mismatch');
  const gate = createKnowledgeCampaignBudget(database, config.namespace);
  if (command === 'initialize') await gate.initialize();
  if (command === 'process' || command === 'inspect') {
    const ledger = await gate.status();
    if (!ledger || command === 'process' && (ledger.held > 0 || ledger.reconciliationRequired)) throw Error('knowledge_campaign_reconcile_before_next_source');
    const base = readAiConfig(process.env);
    if (base.location !== 'global' || !base.enabled || !base.backgroundKnowledgeMaintenanceEnabled
      || !base.backgroundKnowledgeLiveFetch || !base.backgroundKnowledgeLivePublish) throw Error('knowledge_campaign_route_unavailable');
    if (!fhsMaterialWatches.some(w => w.id === id)) throw Error('knowledge_campaign_source_not_approved');
    const domain = { database, cipher, projectId: config.projectId, namespace: config.namespace };
    const readControl = tx => authority.readControl(tx);
    const refresh = createFirestoreKnowledgeRefresh({ ...domain, definitions: platformSourceWatches, readControl,
      originalBucket: cloudKnowledgeOriginalBucket(config.projectId, config.photoBucket) });
    const knowledge = createFirestoreKnowledgeStore({ ...domain, sourceIds: config.knowledgeSourceIds, platformMaterials, observations: refresh.gate });
    const configForBatch = { ...base, localModelOverride: campaignModel, agentThinkingLevel: 'low' };
    const credentials = knowledgeReviewHash(['platform', 'fhs-initial-20261120', campaignModel, 'global', 'gemini-embedding-001', 'us-central1']);
    const reserve = async (kind, limit) => {
      try { return await gate.reserve(kind, id, limit); }
      catch (error) {
        if (/^knowledge_campaign_[a-z_]+$/u.test(error?.message ?? '')) error.code = error.message;
        throw error;
      }
    };
    const runner = createFirestoreKnowledgeMaintenance({ ...domain, readControl, config: configForBatch, credentialBinding: credentials,
      fetch: fetchKnowledgeSource, refresh, knowledge, providers(cfg) {
        if (cfg.project !== config.projectId || cfg.model !== campaignModel || cfg.location !== 'global') throw Error('knowledge_campaign_route_changed');
        const native = createVertexAgentProvider(cfg), vectors = createVertexEmbeddingProvider({ ...cfg, location: 'us-central1' });
        return { agent: { ...native, async generate(request, signal) {
          const settle = await reserve('generation', cfg.maxOutputTokens);
          const response = await native.generate(request, signal);
          const input = response.usageMetadata?.promptTokenCount, total = response.usageMetadata?.totalTokenCount;
          await settle(input, typeof input === 'number' && typeof total === 'number' ? total - input : null);
          return response;
        } }, embedding: { async embed(input, signal) {
          if (input.task !== 'RETRIEVAL_DOCUMENT') throw Error('knowledge_campaign_embedding_scope');
          const settle = await reserve('embedding', 0);
          const result = await vectors.embed(input, signal);
          await settle(result.inputTokens, 0);
          return result;
        } }, model: { async generate() { throw Error('knowledge_campaign_unexpected_provider'); } } };
      } });
    if (command === 'process') await refresh.register(id, 'fhs-initial-20261120', true);
    const [job] = await refresh.jobs(id);
    if (!job) throw Error('knowledge_campaign_watch_unavailable');
    const operationFingerprint = knowledgeReviewHash([credentials, id, job.data.revision, job.data.workerGeneration]);
    const checkId = knowledgeOperationId('knowledge-observation/1', operationFingerprint);
    const request = { watchId: id, operationFingerprint, workerGeneration: job.data.workerGeneration, publishMode: 'live' };
    if (command === 'inspect') {
      const saved = await createFirestoreKnowledgeWork(domain).inspect(request), active = await knowledge.publishedEdition(id);
      console.log(JSON.stringify({ id, operationFingerprint, approved: saved?.prepared?.review?.decision, prepared: Boolean(saved?.prepared),
        versionHash: saved?.prepared?.versionHash, result: saved?.result?.status, code: saved?.result?.code, modelCalls: saved?.budget.modelCalls,
        receipt: saved?.receipt?.state, active: active?.versionId ?? null }));
    } else {
      const signal = new AbortController().signal;
      const check = await refresh.process(job.data, checkId, fetchKnowledgeSource, signal);
      if (!['changed', 'unchanged', 'already_recorded'].includes(check.status)) throw Error('knowledge_campaign_fetch_' + check.status);
      const result = await runner.start(request, signal, job.data.revision, checkId);
      console.log(JSON.stringify({ sourceId: id, operationFingerprint, status: result.status, code: result.code, published: result.published }));
      if (!result.published && result.status !== 'unchanged') {
        process.exitCode = 2;
        if (['candidate_held', 'already_recorded'].includes(result.status) && ['model_output_limit', 'knowledge_review_failed'].includes(result.code)) {
          const saved = await createFirestoreKnowledgeWork(domain).inspect(request), balance = await gate.status();
          const retained = saved?.result?.status === 'candidate_held' && saved.result.code === result.code && !saved.prepared && !saved.receipt;
          if (retained && saved.budget.modelCalls > 0 && balance?.held === 0 && balance.attempts === balance.settled && !balance.reconciliationRequired) process.exitCode = 3;
        }
      }
    }
  }
  console.log(JSON.stringify({ balance: await gate.status() }));
} finally { await persistence.close(); }
