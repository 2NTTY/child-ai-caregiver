import { openFirebasePersistence } from '../server/firebase-persistence.ts';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { readAiConfig } from '../server/ai-config.ts';
import { createKnowledgeCampaignBudget, campaignModel, retainedCampaignReceipts } from '../server/knowledge-campaign-budget.ts';
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
import { AGE_OUTPUT_VERSION } from '../server/knowledge-age-output.ts';
import { retainedDraftRevisionSchema, retainedDraftWorkId } from '../server/knowledge-retained-draft.ts';
import { campaignRecoveryPlan } from './fhs-recovery-plan.mjs';
import { observationHash } from '../server/knowledge-observation.ts';

const [command, id, expected, ...extra] = process.argv.slice(2);
const recovering = command === 'recover';
const recovery = recovering && id && campaignRecoveryPlan(id).entries[0];
if (recovering && (!recovery?.campaignArgs || recovery.operationFingerprint !== expected)) throw Error('knowledge_campaign_recovery_ineligible');
const draftRevision = recovering && recovery.action !== 'resume_prepared' ? retainedDraftRevisionSchema.parse(recovery) : undefined;
const preparedRecovery = recovery?.action === 'resume_prepared';
const resuming = command === 'resume';
const repairing = command === 'repair-truncated';
const explicitAgeScope = command === 'process-age-checked' || preparedRecovery || draftRevision?.action === 'review_pdf_region';
const firstPass = ['process', 'process-sized', 'process-age-checked'].includes(command);
const handlesSource = recovering || resuming || repairing || firstPass || command === 'inspect';
if ((!handlesSource && !['status', 'initialize'].includes(command)) || extra.length
  || (resuming || repairing || recovering ? !/^[a-f0-9]{64}$/u.test(expected ?? '') : expected !== undefined)
  || (handlesSource ? !id : id !== undefined))
  throw Error('Use status, initialize, inspect|process|process-sized|process-age-checked SOURCE_ID, or resume|repair-truncated|recover SOURCE_ID ORIGINAL_FINGERPRINT');
const persistence = await openFirebasePersistence(process.env);
try {
  const { database, cipher, config, authority } = persistence;
  if (config.projectId !== 'ai-caregivers-for-children' || process.env.FIRESTORE_EMULATOR_HOST
    || process.env.AI_KNOWLEDGE_MAINTENANCE_PAYER !== 'platform') throw Error('knowledge_campaign_environment_mismatch');
  const retainedFile = process.env.FHS_CAMPAIGN_RETAINED_RECEIPTS || (recovering
    ? new URL('../artifacts/verification/FHS_INITIAL_RETAINED_UNKNOWN_20261120.json', import.meta.url) : undefined);
  const retained = retainedFile ? retainedCampaignReceipts.parse(JSON.parse(readFileSync(retainedFile, 'utf8'))).retained : [];
  const gate = createKnowledgeCampaignBudget(database, config.namespace, retained);
  if (command === 'initialize') await gate.initialize();
  if (handlesSource) {
    const ledger = await gate.status();
    if (!ledger || command !== 'inspect' && !gate.canAdvance(ledger, id)) throw Error('knowledge_campaign_reconcile_before_next_source');
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
    const work = createFirestoreKnowledgeWork({ ...domain, readControl });
    for (const unknown of retained) {
      const [registered] = await refresh.jobs(unknown.sourceId);
      const held = registered && await work.inspect({ watchId: unknown.sourceId, operationFingerprint: unknown.operationFingerprint,
        workerGeneration: registered.data.workerGeneration, publishMode: 'live' });
      if (held?.result?.status !== 'candidate_held' || !held.result.observationHash || held.lease || held.prepared || held.receipt
        || await knowledge.publishedEdition(unknown.sourceId)) throw Error('knowledge_campaign_retained_work_mismatch');
    }
    const credentials = knowledgeReviewHash(['platform', 'fhs-initial-20261120', campaignModel, 'global', 'gemini-embedding-001', 'us-central1']);
    if (firstPass) await refresh.register(id, 'fhs-initial-20261120', true);
    const [job] = await refresh.jobs(id);
    if (!job) throw Error('knowledge_campaign_watch_unavailable');
    const original = knowledgeReviewHash([credentials, id, job.data.revision, job.data.workerGeneration]);
    if (expected && original !== (draftRevision?.priorOperationFingerprint ?? expected)) throw Error('knowledge_campaign_resume_binding_changed');
    const originalRequest = { watchId: id, operationFingerprint: original, workerGeneration: job.data.workerGeneration, publishMode: 'live' };
    const prior = repairing || resuming || recovering ? await work.inspect({ ...originalRequest, operationFingerprint: draftRevision?.operationFingerprint ?? original }) : null;
    if (draftRevision && (prior?.result?.status !== 'candidate_held' || prior.result.code !== recovery.code
      || prior.result.observationHash !== draftRevision.observationHash || prior.prepared || prior.receipt || prior.lease))
      throw Error('knowledge_campaign_recovery_parent_changed');
    if (preparedRecovery && (prior?.prepared?.versionHash !== recovery.versionHash || prior.prepared.review.decision !== 'approve_candidate'
      || prior.prepared.source.extraction?.contentHash !== recovery.sha256 || recovery.ageOutput !== AGE_OUTPUT_VERSION
      || (!prior.result && (!prior.waitingForQuotaDay || prior.quotaPhase === 'model'))))
      throw Error('knowledge_campaign_prepared_binding_changed');
    if (resuming && !prior) throw Error('knowledge_campaign_resume_binding_changed');
    if (repairing && (prior?.result?.status !== 'candidate_held' || prior.result.code !== 'model_output_limit'
      || !prior.result.observationHash || prior.prepared || prior.receipt)) throw Error('knowledge_campaign_truncation_not_confirmed');
    const operationFingerprint = draftRevision ? retainedDraftWorkId(draftRevision.operationFingerprint) : repairing ? knowledgeTruncatedOutputRepairId(original) : original;
    const request = { ...originalRequest, operationFingerprint };
    const checkId = knowledgeOperationId('knowledge-observation/1', original);
    const sized = recovering || repairing || command === 'process-sized' || explicitAgeScope;
    // Every provider dispatch reserves this same ceiling on the existing gross ledger.
    const maxOutputTokens = sized ? AGENT_OUTPUT_LIMITS.default * (definition.kind === 'pdf' ? 2 : 1) : base.maxOutputTokens;
    if (preparedRecovery && maxOutputTokens !== recovery.maxOutputTokens) throw Error('knowledge_campaign_prepared_binding_changed');
    const configForBatch = { ...base, maxOutputTokens, localModelOverride: campaignModel, agentThinkingLevel: 'low' };
    const reserve = async (kind, limit) => {
      try { return await gate.reserve(kind, id, limit); }
      catch (error) {
        if (/^knowledge_campaign_[a-z_]+$/u.test(error?.message ?? '')) error.code = error.message;
        throw error;
      }
    };
    const runner = createFirestoreKnowledgeMaintenance({ ...domain, readControl, config: configForBatch, credentialBinding: credentials,
      explicitAgeScope, retainedDraft: draftRevision,
      ...(repairing ? { truncatedOutput: { priorWork: original, observationHash: prior.result.observationHash } } : {}),
      fetch: fetchKnowledgeSource, refresh, knowledge, providers(cfg) {
        if (cfg.project !== config.projectId || cfg.model !== campaignModel || cfg.location !== 'global') throw Error('knowledge_campaign_route_changed');
        const native = createVertexAgentProvider(cfg), vectors = createVertexEmbeddingProvider({ ...cfg, location: 'us-central1' });
        return { agent: { ...native, async generate(request, signal) {
          if (preparedRecovery) throw Error('knowledge_campaign_prepared_generation_forbidden');
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
        if ((repairing || recovering) && await knowledge.publishedEdition(id)) throw Error('knowledge_campaign_source_already_published');
        if (resuming || repairing || recovering) {
          const snapshot = await refresh.resumeCheck(job.data, checkId);
          if (snapshot?.status !== 'ok') throw Error('knowledge_campaign_original_observation_changed');
          if (recovering && (snapshot.items.length !== 1 || snapshot.items[0].url !== recovery.url
            || observationHash(snapshot.items[0]) !== (draftRevision?.observationHash ?? prior.prepared.review.observationHash)))
            throw Error('knowledge_campaign_original_observation_changed');
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
            || !gate.canAdvance(balance, id))
            throw Error('knowledge_campaign_window_progress_unconfirmed');
          completedUnits = progress.budget.usedUnits;
        } while (true);
      }
      let readback;
      if (recovering) {
        const recorded = await work.inspect(request), active = await knowledge.publishedEdition(id);
        if (result.published && (recorded?.receipt?.state !== 'committed' || recorded.prepared?.review.decision !== 'approve_candidate'
          || !active?.enabled || !active.current || active.versionHash !== recorded.prepared.versionHash
          || active.observationHash !== recorded.receipt.observationHash)) throw Error('knowledge_campaign_recovery_readback_mismatch');
        let listedCard;
        if (result.published) {
          const reader = randomUUID();
          const { cards } = await database.runTransaction(tx => knowledge.platformCards(tx, reader, undefined, recovery.url), { readOnly: true });
          const card = cards.find(c => c.sourceId === id && c.versionId === active.versionId);
          if (!card?.enabled) throw Error('knowledge_campaign_recovery_card_unlisted');
          const edition = await knowledge.exportPublishedEdition(id, active.versionHash, card.seriesId);
          if (edition.versionHash !== active.versionHash || edition.source.url !== recovery.url) throw Error('knowledge_campaign_recovery_card_mismatch');
          listedCard = { seriesId: card.seriesId, versionId: card.versionId, chunks: edition.source.chunks.length, vectors: edition.embeddings.length };
        }
        readback = { recoveryOf: recovery.operationFingerprint, receiptState: recorded?.receipt?.state ?? null, listedCard,
          candidateVersionHash: recorded?.prepared?.versionHash ?? null, activeVersionId: active?.versionId ?? null,
          activeVersionHash: active?.versionHash ?? null, observationHash: recorded?.result?.observationHash ?? recorded?.prepared?.review.observationHash ?? null,
          reviewDecision: recorded?.prepared?.review.decision ?? null, reviewNotes: recorded?.prepared?.review.notes ?? [] };
      }
      console.log(JSON.stringify({ sourceId: id, operationFingerprint, ...readback, ...(repairing ? { priorOperationFingerprint: original } : {}),
        ...(explicitAgeScope ? { ageOutput: AGE_OUTPUT_VERSION } : {}), maxOutputTokens,
        status: result.status, code: result.code, published: result.published }));
      if (!result.published && result.status !== 'unchanged') {
        process.exitCode = 2;
        if (result.status === 'budget_exhausted' && ['knowledge_model_daily_admission', 'knowledge_embedding_daily_admission'].includes(result.code)) {
          const deferred = await work.inspect(request), balance = await gate.status();
          if (deferred?.waitingForQuotaDay && !deferred.result && !deferred.receipt && !deferred.lease
            && gate.canAdvance(balance, id)) process.exitCode = 4;
        }
        if (['candidate_held', 'already_recorded'].includes(result.status) && ['model_output_limit', 'knowledge_review_failed', 'review_hold',
          'knowledge_age_one_sided', 'knowledge_age_uncertain'].includes(result.code)) {
          const saved = await work.inspect(request), balance = await gate.status();
          const held = result.code === 'review_hold' ? saved?.prepared?.review?.decision === 'hold_candidate' : !saved?.prepared;
          const confirmedHold = saved?.result?.status === 'candidate_held' && saved.result.code === result.code && held && !saved.receipt;
          if (confirmedHold && saved.budget.modelCalls > 0 && gate.canAdvance(balance, id)) process.exitCode = 3;
        }
      }
    }
  }
  console.log(JSON.stringify({ balance: await gate.status() }));
} finally { await persistence.close(); }
