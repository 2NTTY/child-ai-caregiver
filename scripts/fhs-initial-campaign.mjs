import { openFirebasePersistence } from '../server/firebase-persistence.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { createKnowledgeCampaignBudget, campaignModel } from '../server/knowledge-campaign-budget.ts';
import { cloudKnowledgeOriginalBucket } from '../server/firestore-knowledge-originals.ts';
import { createFirestoreKnowledgeRefresh } from '../server/firestore-knowledge-refresh.ts';
import { createFirestoreKnowledgeStore } from '../server/firestore-knowledge.ts';
import { createFirestoreKnowledgeMaintenance, knowledgeOperationId } from '../server/firestore-knowledge-maintenance.ts';
import { fetchKnowledgeSource } from '../server/knowledge-source-fetch.ts';
import { platformSourceWatches } from '../server/knowledge-source-catalog.ts';
import { platformMaterials, campaignMaterialWatches } from '../server/platform-materials.ts';
import { knowledgeReviewHash } from '../server/knowledge-review-assessment.ts';
import { createVertexAgentProvider } from '../server/agent-model-gateway.ts';
import { createVertexEmbeddingProvider } from '../server/vertex-embedding.ts';
import { createFirestoreKnowledgeWork, knowledgeTruncatedOutputRepairId } from '../server/firestore-knowledge-work.ts';
import { AGENT_OUTPUT_LIMITS } from '../src/shared/agent-run-limits.ts';

const [command, id, expected, ...extra] = process.argv.slice(2);
const resuming = command === 'resume';
const repairing = command === 'repair-truncated';
const firstPass = command === 'process' || command === 'process-sized';
const handlesSource = resuming || repairing || firstPass || command === 'inspect';
if ((!handlesSource && !['status', 'initialize'].includes(command)) || extra.length
  || (resuming || repairing ? !/^[a-f0-9]{64}$/u.test(expected ?? '') : expected !== undefined)
  || (handlesSource ? !id : id !== undefined))
  throw Error('Use status, initialize, inspect|process|process-sized SOURCE_ID, or resume|repair-truncated SOURCE_ID ORIGINAL_FINGERPRINT');
const persistence = await openFirebasePersistence(process.env);
try {
  const { database, cipher, config, authority } = persistence;
  if (config.projectId !== 'ai-caregivers-for-children' || process.env.FIRESTORE_EMULATOR_HOST
    || process.env.AI_KNOWLEDGE_MAINTENANCE_PAYER !== 'platform') throw Error('knowledge_campaign_environment_mismatch');
  const gate = createKnowledgeCampaignBudget(database, config.namespace);
  if (command === 'initialize') await gate.initialize();
  if (handlesSource) {
    const ledger = await gate.status();
    if (!ledger || command !== 'inspect' && (ledger.held > 0 || ledger.reconciliationRequired)) throw Error('knowledge_campaign_reconcile_before_next_source');
    const base = readAiConfig(process.env);
    if (base.location !== 'global' || !base.enabled || !base.backgroundKnowledgeMaintenanceEnabled
      || !base.backgroundKnowledgeLiveFetch || !base.backgroundKnowledgeLivePublish) throw Error('knowledge_campaign_route_unavailable');
    const definition = campaignMaterialWatches.find(w => w.id === id);
    if (!definition) throw Error('knowledge_campaign_source_not_approved');
    const domain = { database, cipher, projectId: config.projectId, namespace: config.namespace };
    const readControl = tx => authority.readControl(tx);
    const refresh = createFirestoreKnowledgeRefresh({ ...domain, definitions: platformSourceWatches, readControl,
      originalBucket: cloudKnowledgeOriginalBucket(config.projectId, config.photoBucket) });
    const knowledge = createFirestoreKnowledgeStore({ ...domain, sourceIds: config.knowledgeSourceIds, platformMaterials, observations: refresh.gate });
    const credentials = knowledgeReviewHash(['platform', 'fhs-initial-20261120', campaignModel, 'global', 'gemini-embedding-001', 'us-central1']);
    if (firstPass) await refresh.register(id, 'fhs-initial-20261120', true);
    const [job] = await refresh.jobs(id);
    if (!job) throw Error('knowledge_campaign_watch_unavailable');
    const original = knowledgeReviewHash([credentials, id, job.data.revision, job.data.workerGeneration]);
    if (expected && original !== expected) throw Error('knowledge_campaign_resume_binding_changed');
    const originalRequest = { watchId: id, operationFingerprint: original, workerGeneration: job.data.workerGeneration, publishMode: 'live' };
    const work = createFirestoreKnowledgeWork({ ...domain, readControl });
    const prior = repairing || resuming ? await work.inspect(originalRequest) : null;
    if (resuming && !prior) throw Error('knowledge_campaign_resume_binding_changed');
    if (repairing && (prior?.result?.status !== 'candidate_held' || prior.result.code !== 'model_output_limit'
      || !prior.result.observationHash || prior.prepared || prior.receipt)) throw Error('knowledge_campaign_truncation_not_confirmed');
    const operationFingerprint = repairing ? knowledgeTruncatedOutputRepairId(original) : original;
    const request = { ...originalRequest, operationFingerprint };
    const checkId = knowledgeOperationId('knowledge-observation/1', original);
    const sized = repairing || command === 'process-sized';
    // Every provider dispatch reserves this same ceiling on the existing gross ledger.
    const maxOutputTokens = sized ? AGENT_OUTPUT_LIMITS.default * (definition.kind === 'pdf' ? 2 : 1) : base.maxOutputTokens;
    const configForBatch = { ...base, maxOutputTokens, localModelOverride: campaignModel, agentThinkingLevel: 'low' };
    const reserve = async (kind, limit) => {
      try { return await gate.reserve(kind, id, limit); }
      catch (error) {
        if (/^knowledge_campaign_[a-z_]+$/u.test(error?.message ?? '')) error.code = error.message;
        throw error;
      }
    };
    const runner = createFirestoreKnowledgeMaintenance({ ...domain, readControl, config: configForBatch, credentialBinding: credentials,
      ...(repairing ? { truncatedOutput: { priorWork: original, observationHash: prior.result.observationHash } } : {}),
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
    if (command === 'inspect') {
      const saved = await work.inspect(request), active = await knowledge.publishedEdition(id);
      console.log(JSON.stringify({ id, operationFingerprint, approved: saved?.prepared?.review?.decision, prepared: Boolean(saved?.prepared),
        versionHash: saved?.prepared?.versionHash, result: saved?.result?.status, code: saved?.result?.code, modelCalls: saved?.budget.modelCalls,
        receipt: saved?.receipt?.state, active: active?.versionId ?? null }));
    } else {
      const signal = new AbortController().signal;
      const saved = resuming ? prior : await work.inspect(request);
      let result = saved?.result;
      if (result?.published && saved.receipt?.state !== 'committed') throw Error('knowledge_campaign_publication_receipt_missing');
      if (!result) {
        if (repairing && await knowledge.publishedEdition(id)) throw Error('knowledge_campaign_source_already_published');
        if (resuming || repairing) {
          const snapshot = await refresh.resumeCheck(job.data, checkId);
          if (snapshot?.status !== 'ok') throw Error('knowledge_campaign_original_observation_changed');
        } else {
          const check = await refresh.process(job.data, checkId, fetchKnowledgeSource, signal);
          if (!['changed', 'unchanged', 'already_recorded'].includes(check.status)) throw Error('knowledge_campaign_fetch_' + check.status);
        }
        let completedUnits = -1;
        do {
          result = await runner.start(request, signal, job.data.revision, checkId);
          if (result.status !== 'in_progress' || result.code !== 'knowledge_window_pending') break;
          const progress = await work.inspect(request), balance = await gate.status();
          if (!progress?.windowed || progress.result || progress.receipt || progress.lease || progress.budget.usedUnits <= completedUnits
            || !balance || balance.held || balance.reconciliationRequired || balance.attempts !== balance.settled)
            throw Error('knowledge_campaign_window_progress_unconfirmed');
          completedUnits = progress.budget.usedUnits;
        } while (true);
      }
      console.log(JSON.stringify({ sourceId: id, operationFingerprint, ...(repairing ? { priorOperationFingerprint: original } : {}),
        maxOutputTokens, status: result.status, code: result.code, published: result.published }));
      if (!result.published && result.status !== 'unchanged') {
        process.exitCode = 2;
        if (['candidate_held', 'already_recorded'].includes(result.status) && ['model_output_limit', 'knowledge_review_failed', 'review_hold'].includes(result.code)) {
          const saved = await work.inspect(request), balance = await gate.status();
          const held = result.code === 'review_hold' ? saved?.prepared?.review?.decision === 'hold_candidate' : !saved?.prepared;
          const retained = saved?.result?.status === 'candidate_held' && saved.result.code === result.code && held && !saved.receipt;
          if (retained && saved.budget.modelCalls > 0 && balance?.held === 0 && balance.attempts === balance.settled && !balance.reconciliationRequired) process.exitCode = 3;
        }
      }
    }
  }
  console.log(JSON.stringify({ balance: await gate.status() }));
} finally { await persistence.close(); }
