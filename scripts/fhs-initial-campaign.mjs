import { openFirebasePersistence } from '../server/firebase-persistence.ts';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { readAiConfig } from '../server/ai-config.ts';
import { createFirestoreAdmin } from '../server/firestore-admin.ts';
import { FirestoreAiUsage, KNOWLEDGE_MAINTENANCE_PAYER, KNOWLEDGE_PUBLICATION_PAYER } from '../server/firestore-ai-usage.ts';
import { manualPublicationPin } from '../server/fhs-manual-publication.ts';
import { createKnowledgeCampaignBudget, campaign, campaignModel, campaignCredentials, retainedCampaignReceipts, selectCampaignDayAdmission } from '../server/knowledge-campaign-budget.ts';
import { cloudKnowledgeOriginalBucket } from '../server/firestore-knowledge-originals.ts';
import { createFirestoreKnowledgeRefresh } from '../server/firestore-knowledge-refresh.ts';
import { createFirestoreKnowledgeStore } from '../server/firestore-knowledge.ts';
import { createFirestoreKnowledgeMaintenance, knowledgeOperationId } from '../server/firestore-knowledge-maintenance.ts';
import { createKnowledgeSourceFetcher, fetchKnowledgeSource } from '../server/knowledge-source-fetch.ts';
import { matchesFhsPdfObservation, openFhsCampaignPdfReads, resolveFhsPdfObservation } from './fhs-pdf-reads.ts';
import { platformSourceWatches } from '../server/knowledge-source-catalog.ts';
import { platformMaterials, campaignMaterialWatches } from '../server/platform-materials.ts';
import { knowledgeReviewHash } from '../server/knowledge-review-assessment.ts';
import { createVertexAgentProvider } from '../server/agent-model-gateway.ts';
import { createVertexEmbeddingProvider } from '../server/vertex-embedding.ts';
import { canResumeRetainedPromptFailure, createFirestoreKnowledgeWork, knowledgeTruncatedOutputRepairId } from '../server/firestore-knowledge-work.ts';
import { AGENT_OUTPUT_LIMITS } from '../src/shared/agent-run-limits.ts';
import { AGE_OUTPUT_VERSION } from '../server/knowledge-age-output.ts';
import { retainedDraftRevisionSchema, retainedDraftWorkId } from '../server/knowledge-retained-draft.ts';
import { campaignRecoveryPlan } from './fhs-recovery-plan.mjs';
import { observationHash } from '../server/knowledge-observation.ts';
import { publicationAssignments } from './fhs-publication-lanes.mjs';

const [invocation, id, expected, ...extra] = process.argv.slice(2);
// Only the operator CLI selects the commissioned edition. Existing timers retain their own admission.
const commissioned = invocation === 'publish-approved' || invocation === 'resume-approved';
const manual = commissioned ? manualPublicationPin(id) : undefined;
if (commissioned && (!manual || manual.resumeOnly && invocation !== 'resume-approved'))
  throw Error('knowledge_manual_publication_scope');
const command = invocation === 'publish-approved' ? 'process-age-checked' : invocation === 'resume-approved' ? 'resume-age-checked' : invocation;
const recovering = command === 'recover';
const recoveryCommand = recovering || command === 'inspect-recovery';
const inspecting = command === 'inspect' || command === 'inspect-recovery';
const recovery = recoveryCommand && id && campaignRecoveryPlan(id).entries[0];
if (recoveryCommand && (!recovery?.campaignArgs || recovery.operationFingerprint !== expected)) throw Error('knowledge_campaign_recovery_ineligible');
const draftRevision = recoveryCommand ? retainedDraftRevisionSchema.parse(recovery) : undefined;
const resuming = command === 'resume' || command === 'resume-age-checked';
const repairing = command === 'repair-truncated';
const explicitAgeScope = command === 'process-age-checked' || command === 'resume-age-checked'
  || draftRevision?.action === 'review_pdf_region' || draftRevision?.action === 'retain_pdf_transcription';
const firstPass = ['process', 'process-sized', 'process-age-checked'].includes(command);
const handlesSource = recovering || resuming || repairing || firstPass || inspecting;
const lane = process.env.FHS_CAMPAIGN_LANE;
const originalPin = process.env.FHS_CAMPAIGN_ORIGINAL_OPERATION;
const assigned = handlesSource && !inspecting ? [...publicationAssignments()].find(([, rows]) => rows.some(row => row.sourceId === id)) : undefined;
const laneSource = assigned?.[1].find(row => row.sourceId === id);
if (assigned && (!lane || lane !== assigned[0]) || lane && (!assigned || !commissioned || manual?.lane !== lane
  || !/^[a-f0-9]{64}$/u.test(originalPin ?? '')) || originalPin && !lane) throw Error('fhs_lane_source_owned');
if ((!handlesSource && !['status', 'initialize', 'retain-inspected'].includes(command)) || extra.length
  || (resuming || repairing || recoveryCommand ? !/^[a-f0-9]{64}$/u.test(expected ?? '') : expected !== undefined)
  || (handlesSource ? !id : id !== undefined))
  throw Error('Use status, initialize, retain-inspected, inspect|process|process-sized|process-age-checked|publish-approved SOURCE_ID, or resume|resume-age-checked|resume-approved|repair-truncated|recover|inspect-recovery SOURCE_ID ORIGINAL_FINGERPRINT');
const persistence = await openFirebasePersistence(process.env);
try {
  const { database, cipher, config, authority } = persistence;
  if (config.projectId !== 'ai-caregivers-for-children' || process.env.FIRESTORE_EMULATOR_HOST
    || process.env.AI_KNOWLEDGE_MAINTENANCE_PAYER !== 'platform') throw Error('knowledge_campaign_environment_mismatch');
  const retainedFile = process.env.FHS_CAMPAIGN_RETAINED_RECEIPTS || (recoveryCommand
    ? new URL('../artifacts/verification/FHS_INITIAL_RETAINED_UNKNOWN_20261120.json', import.meta.url) : undefined);
  const retained = retainedFile ? retainedCampaignReceipts.parse(JSON.parse(readFileSync(retainedFile, 'utf8'))).retained : [];
  const gate = createKnowledgeCampaignBudget(database, config.namespace, retained);
  const selected = selectCampaignDayAdmission(process.env.FHS_CAMPAIGN_DAY_ADMISSION);
  const admission = selected?.day === new Date().toISOString().slice(0, 10) ? selected : undefined;
  const domain = { database, cipher, projectId: config.projectId, namespace: config.namespace };
  let daily;
  if (command === 'status') {
    const day = new Date().toISOString().slice(0, 10);
    const policy = await createFirestoreAdmin(domain, readAiConfig(process.env)).readPolicy();
    const usage = new FirestoreAiUsage({ ...domain, namespace: config.namespace + '_ai_usage', billingSource: 'platform' });
    const owner = await usage.getForUser(KNOWLEDGE_MAINTENANCE_PAYER, undefined, day);
    const publication = await usage.getForUser(KNOWLEDGE_PUBLICATION_PAYER, undefined, day);
    const global = await usage.getGlobal(day);
    const currentGrant = admission?.day === day ? admission : null;
    if (currentGrant && currentGrant.policyVersion !== policy.version) throw Error('knowledge_campaign_policy_changed');
    daily = { day, policyVersion: policy.version, maintenanceAttempts: owner.attempts, maintenanceLimit: currentGrant?.attempts ?? policy.dailyUserAttempts,
      manualPublication: publication, globalAttempts: global.attempts, globalLimit: policy.dailyGlobalAttempts,
      ordinaryGlobalAttempts: global.attempts - publication.attempts,
      maintenanceRemaining: Math.max(0, Math.min((currentGrant?.attempts ?? policy.dailyUserAttempts) - owner.attempts,
        policy.dailyGlobalAttempts - global.attempts + publication.attempts)), grant: currentGrant };
  }
  if (command === 'initialize') await gate.initialize();
  const readControl = tx => authority.readControl(tx);
  const refresh = createFirestoreKnowledgeRefresh({ ...domain, definitions: platformSourceWatches, readControl,
    originalBucket: cloudKnowledgeOriginalBucket(config.projectId, config.photoBucket) });
  const knowledge = createFirestoreKnowledgeStore({ ...domain, sourceIds: config.knowledgeSourceIds, platformMaterials, observations: refresh.gate });
  const work = createFirestoreKnowledgeWork({ ...domain, readControl });
  if (command === 'retain-inspected') {
    if (!retained.length) throw Error('knowledge_campaign_retained_receipts_required');
    for (const unknown of retained) {
      const [registered] = await refresh.jobs(unknown.sourceId);
      const held = registered && await work.inspect({ watchId: unknown.sourceId, operationFingerprint: unknown.operationFingerprint,
        workerGeneration: registered.data.workerGeneration, publishMode: 'live' });
      if (held?.result?.status !== 'candidate_held' || !held.result.observationHash || held.lease || held.prepared || held.receipt
        || await knowledge.publishedEdition(unknown.sourceId)) throw Error('knowledge_campaign_retained_work_mismatch');
    }
    await gate.retainInspected();
  }
  if (handlesSource) await handleSource();
  async function handleSource() {
    const admissionState = await gate.sourceStatus(id);
    const reservations = admissionState.reservations.map(({kind, ceiling}) => ({kind, ceiling}));
    if (!inspecting && !admissionState.admissible) throw Error('knowledge_campaign_reconcile_before_next_source');
    const base = readAiConfig(process.env);
    if (base.location !== 'global' || !base.enabled || !base.backgroundKnowledgeMaintenanceEnabled
      || !base.backgroundKnowledgeLiveFetch || !base.backgroundKnowledgeLivePublish) throw Error('knowledge_campaign_route_unavailable');
    const definition = campaignMaterialWatches.find(w => w.id === id);
    if (!definition) throw Error('knowledge_campaign_source_not_approved');
    const pdfReader = await openFhsCampaignPdfReads(command, definition.kind, process.env);
    const fetchSource = pdfReader ? createKnowledgeSourceFetcher({ pdfReader }) : fetchKnowledgeSource;
    const credentials = campaignCredentials;
    if (firstPass && !lane) await refresh.register(id, 'fhs-initial-20261120', true);
    const [job] = await refresh.jobs(id);
    if (!job && inspecting && !draftRevision) {
      console.log(JSON.stringify({ id, registered: false, started: false, operationFingerprint: null,
        active: (await knowledge.publishedEdition(id))?.versionId ?? null, reservations,
        leaseUntilMs: null, quotaDay: null, receipt: null, prepared: false }));
      return;
    }
    if (!job) throw Error('knowledge_campaign_watch_unavailable');
    const original = knowledgeReviewHash([credentials, id, job.data.revision, job.data.workerGeneration]);
    if (lane) {
      const bound = (await database.collection(config.namespace + '_knowledge_campaigns').doc(campaign).collection('publicationBindings').doc(id).get()).data();
      if (original !== originalPin || bound?.operationFingerprint !== original || bound.sourceId !== id || bound.lane !== lane
        || bound.sha256 !== laneSource.sha256 || bound.pages !== laneSource.pages) throw Error('fhs_lane_operation_changed');
    }
    if (expected && original !== (draftRevision?.priorOperationFingerprint ?? expected)) throw Error('knowledge_campaign_resume_binding_changed');
    const originalRequest = { watchId: id, operationFingerprint: original, workerGeneration: job.data.workerGeneration, publishMode: 'live' };
    const prior = repairing || resuming || recoveryCommand ? await work.inspect({ ...originalRequest, operationFingerprint: draftRevision?.operationFingerprint ?? original }) : null;
    if (draftRevision && (prior?.result?.status !== 'candidate_held' || prior.result.code !== recovery.code
      || prior.result.observationHash !== draftRevision.observationHash || prior.prepared || prior.receipt || prior.lease))
      throw Error('knowledge_campaign_recovery_parent_changed');
    if (resuming && !prior) throw Error('knowledge_campaign_resume_binding_changed');
    if (repairing && (prior?.result?.status !== 'candidate_held' || prior.result.code !== 'model_output_limit'
      || !prior.result.observationHash || prior.prepared || prior.receipt)) throw Error('knowledge_campaign_truncation_not_confirmed');
    const operationFingerprint = draftRevision ? retainedDraftWorkId(draftRevision.operationFingerprint) : repairing ? knowledgeTruncatedOutputRepairId(original) : original;
    const request = { ...originalRequest, operationFingerprint };
    const laneObservation = laneSource ? await resolveFhsPdfObservation(refresh, job.data, original, laneSource) : null;
    const checkId = laneObservation?.checkId ?? knowledgeOperationId('knowledge-observation/1', original);
    const sized = recovering || repairing || command === 'process-sized' || explicitAgeScope;
    // Every provider dispatch reserves this same ceiling on the existing gross ledger.
    const maxOutputTokens = sized ? AGENT_OUTPUT_LIMITS.default * (definition.kind === 'pdf' ? 2 : 1) : base.maxOutputTokens;
    const configForBatch = { ...base, maxOutputTokens, localModelOverride: campaignModel, agentThinkingLevel: 'low' };
    const runAdmission = !manual && (explicitAgeScope || draftRevision) ? admission : undefined;
    const runner = createFirestoreKnowledgeMaintenance({ ...domain, readControl, config: configForBatch, credentialBinding: credentials,
      explicitAgeScope, retainedDraft: draftRevision, campaignAdmission: runAdmission, campaignBudget: gate, manualPublication: manual,
      ...(repairing ? { truncatedOutput: { priorWork: original, observationHash: prior.result.observationHash } } : {}),
      fetch: fetchSource, pdfReader, refresh, knowledge, providers(cfg) {
        if (cfg.project !== config.projectId || cfg.model !== campaignModel || cfg.location !== 'global') throw Error('knowledge_campaign_route_changed');
        const native = createVertexAgentProvider(cfg), vectors = createVertexEmbeddingProvider({ ...cfg, location: 'us-central1' });
        return { agent: native, embedding: vectors, model: { async generate() { throw Error('knowledge_campaign_unexpected_provider'); } } };
      } });
    if (inspecting) {
      const saved = await work.inspect(request), active = await knowledge.publishedEdition(id);
      const pin = manualPublicationPin(id), reads = process.env.FHS_CAMPAIGN_PDF_READS;
      let recordedWindow;
      if (command === 'inspect' && reads && pin?.lane === 'C2' && saved?.windowed
        && ['knowledge_review_failed', 'knowledge_window_quote_mismatch'].includes(saved.result?.code)
        && !active && !reservations.length) {
        const { inspectHeldWindowEvidence } = await import('./fhs-held-window-evidence.mjs');
        recordedWindow = await inspectHeldWindowEvidence({ domain, refresh, job: job.data, pin, definition, original, saved,
          reads, indexHash: process.env.FHS_CAMPAIGN_PDF_READS_SHA256 });
      }
      console.log(JSON.stringify({ id, registered: true, operationFingerprint, approved: saved?.prepared?.review?.decision, prepared: Boolean(saved?.prepared),
        versionHash: saved?.prepared?.versionHash, result: saved?.result?.status, code: saved?.result?.code, modelCalls: saved?.budget.modelCalls,
        receipt: saved?.receipt?.state, active: active?.versionId ?? null, started: Boolean(saved),
        leaseUntilMs: saved?.lease?.untilMs ?? null, quotaDay: saved?.waitingForQuotaDay ?? null, reservations, recordedWindow,
        ...(draftRevision ? { priorOperationFingerprint: draftRevision.operationFingerprint, observationHash: draftRevision.observationHash,
          activeVersionHash: active?.versionHash ?? null,
          retainedPromptFailure: saved?.retainedPromptFailure?.code ?? null, reviewNotes: saved?.prepared?.review.notes ?? [] } : {}) }));
    } else {
      const signal = new AbortController().signal;
      const saved = resuming ? prior : await work.inspect(request);
      let result = canResumeRetainedPromptFailure(saved, draftRevision) ? null : saved?.result;
      if (result?.published && saved.receipt?.state !== 'committed') throw Error('knowledge_campaign_publication_receipt_missing');
      if (!result) {
        if ((repairing || recovering) && await knowledge.publishedEdition(id)) throw Error('knowledge_campaign_source_already_published');
        if (resuming || repairing || recovering || lane) {
          const snapshot = laneObservation ? laneObservation.snapshot : await refresh.resumeCheck(job.data, checkId);
          if (snapshot?.status !== 'ok') throw Error('knowledge_campaign_original_observation_changed');
          if (laneSource && !matchesFhsPdfObservation(laneSource, snapshot)) throw Error('fhs_lane_original_check_changed');
          if (recovering && (snapshot.items.length !== 1 || snapshot.items[0].url !== recovery.url
            || observationHash(snapshot.items[0]) !== draftRevision.observationHash))
            throw Error('knowledge_campaign_original_observation_changed');
        } else {
          const check = await refresh.process(job.data, checkId, fetchSource, signal);
          if (!['changed', 'unchanged', 'already_recorded'].includes(check.status)) throw Error('knowledge_campaign_fetch_' + check.status);
        }
        let completedUnits = -1;
        do {
          result = await runner.start(request, signal, job.data.revision, checkId);
          if (result.status !== 'in_progress' || result.code !== 'knowledge_window_pending') break;
          const progress = await work.inspect(request);
          if (!progress?.windowed || progress.result || progress.receipt || progress.lease || progress.budget.usedUnits <= completedUnits
            || !(await gate.sourceStatus(id)).admissible)
            throw Error('knowledge_campaign_window_progress_unconfirmed');
          completedUnits = progress.budget.usedUnits;
        } while (true);
      }
      let readback;
      if (recovering || manual) {
        const sourceUrl = recovering ? recovery.url : definition.url;
        const recorded = await work.inspect(request), active = await knowledge.publishedEdition(id);
        if (result.published && (recorded?.receipt?.state !== 'committed' || recorded.prepared?.review.decision !== 'approve_candidate'
          || !active?.enabled || !active.current || active.versionHash !== recorded.prepared.versionHash
          || active.observationHash !== recorded.receipt.observationHash)) throw Error('knowledge_campaign_recovery_readback_mismatch');
        let listedCard;
        if (result.published) {
          const reader = randomUUID();
          const { cards } = await database.runTransaction(tx => knowledge.platformCards(tx, reader, undefined, sourceUrl), { readOnly: true });
          const card = cards.find(c => c.sourceId === id && c.versionId === active.versionId);
          if (!card?.enabled) throw Error('knowledge_campaign_recovery_card_unlisted');
          const edition = await knowledge.exportPublishedEdition(id, active.versionHash, card.seriesId);
          if (edition.versionHash !== active.versionHash || edition.source.url !== sourceUrl) throw Error('knowledge_campaign_recovery_card_mismatch');
          listedCard = { seriesId: card.seriesId, versionId: card.versionId, chunks: edition.source.chunks.length, vectors: edition.embeddings.length };
        }
        readback = { ...(draftRevision ? { priorOperationFingerprint: draftRevision.operationFingerprint } : {}),
          receiptState: recorded?.receipt?.state ?? null, listedCard,
          candidateVersionHash: recorded?.prepared?.versionHash ?? null, activeVersionId: active?.versionId ?? null,
          activeVersionHash: active?.versionHash ?? null, observationHash: recorded?.result?.observationHash ?? recorded?.prepared?.review.observationHash ?? null,
          reviewDecision: recorded?.prepared?.review.decision ?? null, ...(recovering ? { reviewNotes: recorded?.prepared?.review.notes ?? [] } : {}) };
      }
      console.log(JSON.stringify({ sourceId: id, operationFingerprint, ...readback, ...(repairing ? { priorOperationFingerprint: original } : {}),
        ...(manual ? { payer: KNOWLEDGE_PUBLICATION_PAYER } : {}),
        ...(explicitAgeScope ? { ageOutput: AGE_OUTPUT_VERSION } : {}), ...(runAdmission ? { campaignDayAdmission: runAdmission } : {}), maxOutputTokens,
        status: result.status, code: result.code, published: result.published }));
      if (!result.published && result.status !== 'unchanged') {
        process.exitCode = 2;
        if (result.status === 'budget_exhausted' && ['knowledge_model_daily_admission', 'knowledge_embedding_daily_admission'].includes(result.code)) {
          const deferred = await work.inspect(request);
          if (deferred?.waitingForQuotaDay && !deferred.result && !deferred.receipt && !deferred.lease
            && (await gate.sourceStatus(id)).admissible) process.exitCode = 4;
        }
        if (['candidate_held', 'already_recorded'].includes(result.status) && ['model_output_limit', 'knowledge_review_failed', 'review_hold',
          'knowledge_age_one_sided', 'knowledge_age_uncertain'].includes(result.code)) {
          const saved = await work.inspect(request);
          const held = result.code === 'review_hold' ? saved?.prepared?.review?.decision === 'hold_candidate' : !saved?.prepared;
          const confirmedHold = saved?.result?.status === 'candidate_held' && saved.result.code === result.code && held && !saved.receipt;
          if (confirmedHold && saved.budget.modelCalls > 0 && (await gate.sourceStatus(id)).admissible) process.exitCode = 3;
        }
      }
    }
  }
  console.log(JSON.stringify({ balance: await gate.status(), ...(daily ? { daily } : {}) }));
} finally { await persistence.close(); }
