import type { PdfAmendment } from "./knowledge-pdf-amendments.ts";
import { assembleKnowledgePdfWindows, manualPdfWindowBudget, planKnowledgePdfWindows, readKnowledgePdfWindow, PDF_WINDOW_METHOD, PDF_WINDOW_RANGE_LIMIT, type WindowReading } from "./knowledge-pdf-windows.ts";
import { AGE_OUTPUT_VERSION } from './knowledge-age-output.ts';
import { commissionedWebOriginal, matchesRegisteredRetainedDraft, retainedDraftWorkId, type RetainedDraftRevision } from './knowledge-retained-draft.ts';
import { extractKnowledgePdf } from "./knowledge-pdf.ts";
import { communicationReplayWork,normalizeRecordedComparison,recordedCommunicationComparison } from './fhs-script-comparison-stage.ts';
import { EmbeddingAdmissionDeferred } from "./embedding-failure.ts";
import { campaign, campaignCredentials, matchesCampaignPublicationBinding, type CampaignDayAdmission, type createKnowledgeCampaignBudget } from "./knowledge-campaign-budget.ts";
import { campaignMaterialWatches } from "./platform-materials.ts";
import { approvedScriptEdition, assertScriptBaseline, assertScriptObservation, scriptEditionCoverage, scriptEditionWorkId, currentScriptReadingWork, verifiedScriptReading, type ScriptEdition } from './fhs-script-edition.ts';
import { focusedKnowledgeWorkId, prepareFocusedKnowledgePage } from "./knowledge-pdf-focus.ts";
import { NATIVE_PDF_READER_VERSION } from "./knowledge-pdf-output.ts";
import type { Transaction } from "@google-cloud/firestore";
import type { BackgroundKnowledgeRunRequest } from "../src/shared/background-knowledge-maintenance.ts";
import type { AiConfig } from "./ai-config.ts";
import { AgentBudget, AGENT_LIMITS } from "./agent-budget.ts";
import { AgentGatewayModel, createVertexAgentProvider } from "./agent-model-gateway.ts";
import { createVertexEmbeddingProvider } from "./vertex-embedding.ts";
import { createEmbeddingGateway } from "./embedding-gateway.ts";
import { createFirestoreOperatorEmbeddingUsage } from "./firestore-embedding-usage.ts";
import { createFirestoreAdmin } from "./firestore-admin.ts";
import { FirestoreAiUsage, KNOWLEDGE_MAINTENANCE_PAYER as OPERATOR, KNOWLEDGE_PUBLICATION_PAYER } from "./firestore-ai-usage.ts";
import { manualPublicationPin, type ManualPublicationPin } from './fhs-manual-publication.ts';
import { bindFirstDispatch, firstDispatchWorkId, type FirstDispatch } from './fhs-undispatched-original.ts';
import { registeredReviewedWindow, type BoundReviewedWindow } from './fhs-reviewed-window.ts';
import { FirestoreRootBudget } from "./firestore-root-budget.ts";
import { requireDurableUsage, type PlatformProviderFactory, type FirestoreModelRouting } from "./firestore-model-routing.ts";
import type { FirestoreDomainOptions } from "./firestore-domain-data.ts";
import type { FirestoreKnowledgeStore } from "./firestore-knowledge.ts";
import { parseKnowledgeObservation, type createFirestoreKnowledgeRefresh } from "./firestore-knowledge-refresh.ts";
import { createFirestoreKnowledgeWork, FirestoreKnowledgeWorkError, knowledgeTruncatedOutputRepairId, type KnowledgeWorkPdfReader } from "./firestore-knowledge-work.ts";
import { BACKGROUND_KNOWLEDGE_RESERVED_UNITS, createBackgroundKnowledgeMaintenanceRunner, KnowledgeWindowPending, KnowledgeModelQuotaPending, type BackgroundKnowledgeCandidate } from "./background-knowledge-maintenance.ts";
import { observationHash } from "./knowledge-observation.ts";
import { assertPreparedKnowledgePdfLayout, createModelKnowledgeReviewPort, type KnowledgeMaintenanceBaseline, type KnowledgePdfQuestion, type KnowledgePdfAcceptance } from "./background-knowledge-model.ts";
import { loadAgentPrompt } from "./agent-prompt.ts";
import { embeddingForChunk, sourceVersionHash } from "./knowledge-inputs.ts";
import { knowledgeOperationId, knowledgeReviewHash } from "./knowledge-review-assessment.ts";
import { publicMaintenanceWatch } from "./knowledge-source-catalog.ts";
import { GROWTH_RULES } from "./growth-rules.ts";
import type { SourceFetcher } from "./knowledge-refresh-types.ts";
import type { RootBudgetContext } from "./durable-root-budget.ts";

const NIL = "00000000-0000-0000-0000-000000000000";
function reject(code: string): never { throw new FirestoreKnowledgeWorkError(code); }
export { knowledgeOperationId };

/** Same operator workflow for a host command, a scheduled worker and the local entry. */
export function createFirestoreKnowledgeMaintenance(options: FirestoreDomainOptions & {
  config: AiConfig;
  credentialBinding: string;
  explicitAgeScope?: boolean;
  retainedDraft?: RetainedDraftRevision;
  reviewedWindow?: BoundReviewedWindow;
  providers?: PlatformProviderFactory;
  sponsor?: { userId: string; routing: Pick<FirestoreModelRouting, 'resolve'>; identityActive(): Promise<boolean> };
  knowledge: FirestoreKnowledgeStore;
  refresh: ReturnType<typeof createFirestoreKnowledgeRefresh>;
  readControl(tx: Transaction): Promise<{ enabled: boolean; generation: string }>;
  fetch: SourceFetcher;
  pdfReader?: KnowledgeWorkPdfReader;
  fixtureFetch?: SourceFetcher;
  pdfQuestion?: KnowledgePdfQuestion;
  acceptance?: KnowledgePdfAcceptance;
  focusedPage?: { priorWork: string; priorVersionHash: string; priorReader: string; priorQuestion: KnowledgePdfQuestion };
  isolatedComparison?: { destination: string; baseline: KnowledgeMaintenanceBaseline;
    previousVisual?: { priorWork: string; priorVersionHash: string } };
  useIsolatedPlatformDailyLimit?: boolean;
  campaignAdmission?: CampaignDayAdmission;
  campaignBudget?: ReturnType<typeof createKnowledgeCampaignBudget>;
  manualPublication?: ManualPublicationPin;
  scriptEdition?: ScriptEdition;
  reviseHeldScript?: boolean;
  firstDispatch?: FirstDispatch;
  truncatedOutput?: { priorWork: string; observationHash: string };
  reviseHeldPdf?: { priorWork: string; priorVersionHash: string; feedback: string; amendments?: PdfAmendment[] };
  isolatedFixturePublish?: boolean;
}) {
  if ((options.isolatedFixturePublish || options.isolatedComparison || options.useIsolatedPlatformDailyLimit) && (!options.projectId.startsWith("demo-")
    || !/^127\.0\.0\.1:[0-9]+$/u.test(process.env.FIRESTORE_EMULATOR_HOST ?? "")
    || process.env.YUYF_LOCAL_DEVELOPMENT !== "1")) reject("knowledge_fixture_publication_scope");
  if (!options.credentialBinding) reject("knowledge_maintenance_credential_binding");
  if (options.useIsolatedPlatformDailyLimit && options.sponsor) reject("knowledge_fixture_publication_scope");
  if ((options.campaignAdmission || options.campaignBudget) && options.sponsor) reject("knowledge_campaign_payer_mismatch");
  const manual = options.manualPublication;
  const script = options.scriptEdition;
  if (options.reviseHeldScript && !script) reject('knowledge_script_revision_not_commissioned');
  const selectedPage = options.retainedDraft?.action === 'review_web_original' ? options.retainedDraft : undefined;
  const web = selectedPage && commissionedWebOriginal(selectedPage.sourceId);
  if (selectedPage && (!web || knowledgeReviewHash(selectedPage) !== knowledgeReviewHash(web) || !options.campaignBudget || !options.providers
    || manual || script || options.sponsor || options.campaignAdmission || options.truncatedOutput || options.acceptance || options.focusedPage
    || options.isolatedComparison || options.isolatedFixturePublish || options.fixtureFetch || options.useIsolatedPlatformDailyLimit))
    reject('knowledge_web_original_scope');
  const publication = manual ?? script ?? web;
  if (script && (approvedScriptEdition(script.sourceId) !== script || !options.campaignBudget || !options.providers || !options.explicitAgeScope
    || options.credentialBinding !== campaignCredentials || options.sponsor || options.campaignAdmission || manual || options.firstDispatch
    || options.truncatedOutput || options.retainedDraft || options.reviewedWindow || options.focusedPage || options.reviseHeldPdf
    || options.acceptance || options.isolatedComparison || options.pdfQuestion || options.isolatedFixturePublish || options.fixtureFetch))
    reject('knowledge_script_edition_scope');
  const revisedWindow = options.reviewedWindow;
  const firstDispatch = options.firstDispatch;
  if (firstDispatch && (!manual || manual.resumeOnly || revisedWindow || options.retainedDraft || options.truncatedOutput
    || options.isolatedComparison || options.focusedPage || options.reviseHeldPdf || options.pdfQuestion || options.acceptance
    || options.isolatedFixturePublish)) reject('knowledge_manual_publication_scope');
  const commissionedParent = options.reviseHeldScript && script ? scriptEditionWorkId(script) : firstDispatch?.original ?? revisedWindow?.operationFingerprint ?? web?.operationFingerprint;
  if (revisedWindow && (!manual || options.retainedDraft || options.truncatedOutput || options.focusedPage || options.reviseHeldPdf
    || options.isolatedComparison || options.pdfQuestion || options.acceptance || options.isolatedFixturePublish)) reject('knowledge_manual_publication_scope');
  if (manual && (manualPublicationPin(manual.sourceId) !== manual || !options.campaignBudget || !options.explicitAgeScope
    || options.sponsor || options.campaignAdmission || options.truncatedOutput || options.retainedDraft))
    reject("knowledge_manual_publication_scope");
  const policy = createFirestoreAdmin(options, options.config);
  const work = createFirestoreKnowledgeWork(options);
  const root = new FirestoreRootBudget({ ...options, namespace: options.namespace + "_knowledge_budget" });
  return {
    async start(request: BackgroundKnowledgeRunRequest, signal = new AbortController().signal, expectedRevision?: string, recordedCheckId?: string, reusedOrganizationFrom?: string) {
      const current = await policy.readPolicy(), base = options.config;
      if (!base.enabled || (!options.sponsor && !current.enabled) || !base.backgroundKnowledgeMaintenanceEnabled)
        return { status: "not_enabled" as const, code: "background_knowledge_disabled", published: false };
      const grant = options.campaignAdmission;
      if (grant && (grant.policyVersion !== current.version || current.dailyUserAttempts !== 200 || current.dailyGlobalAttempts !== 400))
        reject("knowledge_campaign_policy_changed");
      const platformDaily = new FirestoreAiUsage({ ...options, namespace: options.namespace + "_ai_usage", billingSource: "platform",
        campaignAdmission: grant, manualPublication: publication });
      const definition = publicMaintenanceWatch(request.watchId);
      const registration = (await options.refresh.jobs(request.watchId)).find(job => job.definition.id === request.watchId);
      if (!definition || !registration || registration.data.workerGeneration !== request.workerGeneration
        || (expectedRevision !== undefined && expectedRevision !== registration.data.revision))
        reject("knowledge_watch_not_registered");
      if (manual && (!recordedCheckId || manual.sourceId !== request.watchId || definition.kind !== 'pdf'))
        reject('knowledge_manual_publication_binding');
      const retained = options.retainedDraft;
      const transcript = retained?.action === 'retain_pdf_transcription' ? retained : undefined;
      if (options.campaignBudget) {
        const original = knowledgeReviewHash([campaignCredentials, request.watchId, registration.data.revision, request.workerGeneration]);
        const bound = script ? script.sourceId === request.watchId && definition.kind === 'page' && !reusedOrganizationFrom
          && request.operationFingerprint === (options.reviseHeldScript ? currentScriptReadingWork(script) : scriptEditionWorkId(script))
          && recordedCheckId === knowledgeOperationId('knowledge-observation/1', scriptEditionWorkId(script))
          : firstDispatch ? firstDispatch.original === original && request.operationFingerprint === firstDispatchWorkId(original)
          && !reusedOrganizationFrom && bindFirstDispatch(manual,original,await work.inspect({...request,operationFingerprint:original}))?.observation === firstDispatch.observation
          : revisedWindow ? revisedWindow.operationFingerprint === original && request.operationFingerprint === retainedDraftWorkId(original)
          && revisedWindow.registration === registeredReviewedWindow(manual,original,revisedWindow.observationHash) && !reusedOrganizationFrom
          : retained ? matchesRegisteredRetainedDraft(retained, original, request.operationFingerprint)
          : options.truncatedOutput ? options.truncatedOutput.priorWork === original && request.operationFingerprint === knowledgeTruncatedOutputRepairId(original)
          : request.operationFingerprint === original;
        if (!bound || options.credentialBinding !== campaignCredentials || !options.providers || request.publishMode !== 'live'
          || expectedRevision !== registration.data.revision || !campaignMaterialWatches.some(watch => watch.id === request.watchId))
          reject('knowledge_campaign_operation_changed');
      }
      if (grant) {
        const original = knowledgeReviewHash([campaignCredentials, request.watchId, expectedRevision, request.workerGeneration]);
        const bound = retained ? matchesRegisteredRetainedDraft(retained, original, request.operationFingerprint)
          : options.explicitAgeScope && request.operationFingerprint === original;
        if (!bound || !options.providers || options.credentialBinding !== campaignCredentials
          || !campaignMaterialWatches.some(watch => watch.id === request.watchId) || request.publishMode !== 'live'
          || expectedRevision !== registration.data.revision || recordedCheckId !== knowledgeOperationId('knowledge-observation/1', original))
          reject("knowledge_campaign_operation_changed");
      }
      const prompt = await loadAgentPrompt("knowledge-organize", "structured",
        ["run", "scope", "context", "evidence", "capabilities", "outputContract"]);
      const sponsor = options.sponsor;
      if (sponsor && !await sponsor.identityActive()) reject('knowledge_sponsor_inactive');
      const personal = sponsor && await sponsor.routing.resolve(sponsor.userId, 'knowledge-maintenance');
      if (sponsor && (!personal || personal.billingSource !== 'personal' || !personal.maintenanceEmbedding || !await personal.authorize()))
        reject('knowledge_sponsor_not_authorized');
      const daily = personal?.dailyUsage ?? platformDaily, payerId = sponsor?.userId ?? (publication ? KNOWLEDGE_PUBLICATION_PAYER : OPERATOR);
      const credentialBinding = sponsor && personal
        ? knowledgeReviewHash(['maintenance-sponsor/1', sponsor.userId, personal.settingsVersion]) : options.credentialBinding;
      const previous = await work.inspect(request);
      const scriptRevision = options.reviseHeldScript && script ? await verifiedScriptReading(script,
        operationFingerprint=>work.inspect({...request,operationFingerprint}),request.operationFingerprint,
        operationFingerprint=>work.inspectScriptReview({...request,operationFingerprint})) : undefined;
      const recovery = options.truncatedOutput;
      if (retained && (sponsor || recovery || reusedOrganizationFrom || !expectedRevision
        || request.publishMode !== 'live' || definition.kind !== (retained.action === 'review_age_draft' || web ? 'page' : 'pdf') || request.watchId !== retained.sourceId
        || request.operationFingerprint !== retainedDraftWorkId(retained.operationFingerprint)
        || (retained.priorOperationFingerprint && retained.operationFingerprint !== knowledgeTruncatedOutputRepairId(retained.priorOperationFingerprint))
        || recordedCheckId !== knowledgeOperationId('knowledge-observation/1', retained.priorOperationFingerprint ?? retained.operationFingerprint)))
        reject('knowledge_retained_page_binding');
      if (transcript && (options.credentialBinding !== campaignCredentials || !options.providers || !matchesRegisteredRetainedDraft(transcript,
        knowledgeReviewHash([campaignCredentials, request.watchId, expectedRevision, request.workerGeneration]), request.operationFingerprint)))
        reject('knowledge_retained_transcription_binding');
      const originalRequest = recovery ? { ...request, operationFingerprint: recovery.priorWork } : undefined;
      if (recovery && originalRequest) {
        if (sponsor || !recordedCheckId || !expectedRevision || reusedOrganizationFrom || request.publishMode !== 'live'
          || request.operationFingerprint !== knowledgeTruncatedOutputRepairId(recovery.priorWork)
          || recordedCheckId !== knowledgeOperationId('knowledge-observation/1', recovery.priorWork)) reject('knowledge_truncation_repair_binding');
        const prior = await work.inspect(originalRequest), observed = await options.refresh.resumeCheck(registration.data, recordedCheckId);
        if (prior?.result?.status !== 'candidate_held' || prior.result.code !== 'model_output_limit' || prior.receipt || prior.prepared
          || prior.result.observationHash !== recovery.observationHash || observed?.status !== 'ok' || observed.items.length !== 1
          || observationHash(observed.items[0]!) !== recovery.observationHash) reject('knowledge_truncation_repair_binding');
      }
      if (definition.leafletPage && !recordedCheckId && !previous?.result && !previous?.receipt) {
        const fetcher = base.backgroundKnowledgeLiveFetch ? options.fetch : options.fixtureFetch;
        if (fetcher) {
          const checkId = knowledgeOperationId("knowledge-observation/1", request.operationFingerprint);
          const checked = await options.refresh.process(registration.data, checkId, fetcher, signal);
          if (!["changed", "unchanged", "already_recorded", "failed", "needs_review", "unavailable"].includes(checked.status))
            return { status: "rejected" as const, code: checked.status, published: false };
          recordedCheckId = checkId;
        }
      }
      const pinned = recordedCheckId && (definition.leafletPage || script || web) ? await options.refresh.resumeCheck(registration.data,recordedCheckId) : null;
      let verifyCommission: ((tx: Transaction) => Promise<void>) | undefined;
      if (web) {
        const item = pinned?.status === 'ok' && pinned.items.length === 1 ? pinned.items[0] : null;
        const parent = await work.inspect({...request,operationFingerprint:web.operationFingerprint});
        if (!item || item.url !== web.url || observationHash(item) !== web.observationHash || parent?.lease || parent?.receipt || parent?.prepared
          || parent?.result?.status !== 'candidate_held' || parent.result.code !== 'knowledge_review_failed' || parent.result.observationHash !== web.observationHash)
          reject('knowledge_web_original_parent_changed');
        verifyCommission = async tx => {
          const state = await options.refresh.gate.read(tx,web.sourceId);
          if (!state?.watch.enabled || !state.watch.manualOnly || !state.catalogMatches || state.watch.revision !== expectedRevision
            || state.observation?.contentHash !== web.observationHash || state.observation.unavailable || await options.knowledge.publishedEdition(web.sourceId,tx))
            reject('knowledge_web_original_observation_changed');
          await options.campaignBudget!.verifyWebRejection(tx,web);
        };
        if (!previous?.receipt && !previous?.result) await options.database.runTransaction(verifyCommission,{readOnly:true});
      }
      if (script) {
        assertScriptObservation(script, definition, pinned);
        verifyCommission = async tx => {
          const state = await options.refresh.gate.read(tx, script.sourceId);
          if (!state?.watch.enabled || !state.watch.manualOnly || !state.catalogMatches || state.watch.revision !== expectedRevision
            || state.observation?.contentHash !== script.observationHash || state.observation.unavailable)
            reject('knowledge_script_edition_observation_changed');
          assertScriptBaseline(script, await options.knowledge.publishedEdition(script.sourceId, tx));
        };
        if (!previous?.receipt && !previous?.result) await options.database.runTransaction(verifyCommission, { readOnly: true });
      }
      if (manual) {
        const commissionOperation = commissionedParent ?? request.operationFingerprint;
        const check = knowledgeOperationId('knowledge-observation/1', commissionOperation);
        const recovered = recordedCheckId === knowledgeOperationId('knowledge-observation/parser-recovery/1', commissionOperation);
        const original = recovered ? await options.refresh.resumeCheck(registration.data, check) : null;
        const item = pinned?.status === 'ok' && pinned.items.length === 1 ? pinned.items[0] : undefined;
        if (reusedOrganizationFrom || (manual.resumeOnly && !previous)
          || (recordedCheckId !== check && !(recovered && original?.status === 'failed' && original.reason === 'parse' && item?.nativeWindowMethod === PDF_WINDOW_METHOD))
          || item?.url !== definition.url || item.extraction?.contentHash !== manual.sha256 || item.extraction.totalPages !== manual.pages)
          reject('knowledge_manual_publication_binding');
        const expectedObservation = observationHash(item);
        if (firstDispatch && expectedObservation !== firstDispatch.observation) reject('knowledge_manual_publication_binding');
        if (revisedWindow && (expectedObservation !== revisedWindow.observationHash || item.nativeWindowMethod !== PDF_WINDOW_METHOD))
          reject('knowledge_manual_publication_binding');
        verifyCommission = async tx => {
          const current = await options.refresh.gate.read(tx, manual.sourceId);
          if (!current?.watch.enabled || !current.watch.manualOnly || !current.catalogMatches || current.watch.revision !== expectedRevision
            || current.observation?.contentHash !== expectedObservation || current.observation.unavailable)
            reject('knowledge_manual_publication_binding');
          if (!manual.resumeOnly) {
            const ref = options.database.collection(options.namespace + '_knowledge_campaigns').doc(campaign).collection('publicationBindings').doc(manual.sourceId);
            if (!matchesCampaignPublicationBinding((await tx.get(ref)).data(), manual, commissionOperation, current.watch.revision, request.workerGeneration))
              reject('knowledge_manual_publication_binding');
          }
        };
        await options.database.runTransaction(verifyCommission, { readOnly: true });
      }
      const windowed = Boolean(previous?.windowed || (pinned?.status === "ok" && pinned.items[0]?.nativeWindowMethod === PDF_WINDOW_METHOD));
      if (transcript && !windowed) reject('knowledge_retained_transcription_binding');
      // A resumed job or retained reading must reconstruct its original page and stage keys.
      const priorReading = commissionedParent ?? retained?.operationFingerprint ?? recovery?.priorWork ?? reusedOrganizationFrom;
      const planOwner = previous ?? (windowed && priorReading ? await work.inspect({ ...request, operationFingerprint: priorReading }) : null);
      const rangeLimit = planOwner ? planOwner.windowRangeLimit ?? 14 : PDF_WINDOW_RANGE_LIMIT;
      const windowPlan = windowed && rangeLimit === PDF_WINDOW_RANGE_LIMIT ? {windowRangeLimit:rangeLimit} : {};
      const manualWindows = manual && !manual.resumeOnly && windowed ? manualPdfWindowBudget(manual.pages, rangeLimit) : undefined;
      const modelAllowance = transcript ? 2 : retained ? 1 : windowed ? current.maxModelCalls : 2;
      const limits = { modelCalls: manualWindows?.modelCalls ?? Math.min(modelAllowance, current.maxModelCalls, personal?.runLimits.modelCalls ?? modelAllowance),
        toolCalls: Math.min(8, current.maxToolCalls, personal?.runLimits.toolCalls ?? 8), queryEmbeddings: 1,
        deadlineMs: Math.min(300_000, current.maxRunSeconds * 1000, personal?.runLimits.deadlineMs ?? 300_000) };
      const config: AiConfig = { ...(personal?.config ?? { ...base, model: base.localModelOverride ?? current.model,
        dailyUserAttempts: current.dailyUserAttempts, dailyGlobalAttempts: current.dailyGlobalAttempts }),
        timeoutMs: Math.min(personal?.config.timeoutMs ?? base.timeoutMs, current.modelRequestSeconds * 1000), maxAttempts: 1, agentMaxRetries: 0 };
      const corpusPolicy = options.useIsolatedPlatformDailyLimit ? { isolatedMaintenanceProject: options.projectId } : {};
      const ageContract = revisedWindow ? {reviewedWindow:knowledgeReviewHash(revisedWindow)}
        : retained ? { retainedDraftRevision: knowledgeReviewHash(retained) }
        : script ? { ageOutput: AGE_OUTPUT_VERSION, scriptEdition: knowledgeReviewHash(script), ...(scriptRevision ? {scriptRevision} : {}) }
        : options.explicitAgeScope ? { ageOutput: AGE_OUTPUT_VERSION } : {};
      const configBinding = { config, limits, ...corpusPolicy, ...ageContract, ...(recovery ? { truncatedOutput: recovery } : {}), ...(definition.leafletPage ? { reader: windowed ? PDF_WINDOW_METHOD : NATIVE_PDF_READER_VERSION } : {}), policyVersion: current.version,
        credentialBinding, ...(options.pdfQuestion ? { pdfQuestion: options.pdfQuestion } : {}), promptPack: prompt.packVersion, watchRevision: registration.data.revision };
      const focus = options.focusedPage;
      const comparison = options.isolatedComparison;
      const previousVisual = comparison?.previousVisual;
      const revision = options.reviseHeldPdf;
      if (revision && (windowed || focus || !definition.leafletPage || !revision.feedback.trim() || revision.feedback.length > 1000
        || request.operationFingerprint !== knowledgeReviewHash(["knowledge-held-pdf-revision/1", revision]))) reject("knowledge_pdf_revision_binding_mismatch");
      const comparisonBinding = comparison ? { destination: comparison.destination, comparedVersionId: comparison.baseline.versionId,
        comparedHash: comparison.baseline.versionHash, comparedObservationHash: comparison.baseline.observationHash,
        ...(previousVisual ? { previousVisual } : {}) } : undefined;
      if (comparison && (windowed || focus || !definition.leafletPage || comparison.baseline.source.sourceId !== request.watchId
        || comparison.baseline.versionHash !== sourceVersionHash(comparison.baseline.source))) reject("knowledge_destination_baseline_conflict");
      const readerConfigHash = knowledgeReviewHash({ ...configBinding, ...windowPlan, ...(focus ? { focus } : {}), ...(revision ? {revision} : {}), ...(comparisonBinding ? { comparisonBinding } : {}) });
      const publicationConfigHash = knowledgeReviewHash({ config, limits, ...corpusPolicy, ...ageContract, ...(revision ? {revision} : {}), policyVersion:current.version, credentialBinding,
        watchRevision:registration.data.revision, question:options.pdfQuestion ?? null, focus:focus ?? null, ...(comparisonBinding ? { comparisonBinding } : {}) });
      if (focus && (!options.pdfQuestion || !recordedCheckId || !definition.leafletPage
        || (reusedOrganizationFrom ?? request.operationFingerprint) !== focusedKnowledgeWorkId(focus.priorWork, focus.priorVersionHash, options.pdfQuestion))) reject("knowledge_focus_binding_mismatch");
      // A completed, sealed review may finish indexing after a prompt update under the identical publication grant.
      const configHash = previous?.prepared && previous.publicationConfigHash === publicationConfigHash
        ? previous.configHash : readerConfigHash;
      const today = new Date().toISOString().slice(0, 10);
      const replaysCommunication = script?.sourceId === recordedCommunicationComparison.sourceId
        && request.operationFingerprint === communicationReplayWork;
      const generationCapacity = async (tx:Transaction, reader:FirestoreAiUsage) => replaysCommunication ||
        ((!(firstDispatch || script || web) || await options.campaignBudget!.hasGenerationCapacity(tx,config.maxOutputTokens))
        && reader.modelCapacity(tx,payerId,config.dailyUserAttempts,config.dailyGlobalAttempts));
      if (!publication && grant?.day !== today && previous?.configHash === configHash && previous.waitingForQuotaDay === today)
        return { status: "budget_exhausted" as const, code: previous.quotaPhase === "model" ? "knowledge_model_daily_admission" : "knowledge_embedding_daily_admission", published: false, budget: previous.budget };
      let budget: AgentBudget | undefined;
      let baseline: KnowledgeMaintenanceBaseline | null | undefined;
      const readBaseline = async () => {
        if (baseline !== undefined) return baseline;
        const edition = await options.knowledge.publishedEdition(request.watchId);
        if (edition && !edition.enabled) reject("knowledge_source_disabled");
        baseline = edition ? { versionId: edition.versionId, versionHash: edition.versionHash,
          observationHash: edition.observationHash, source: edition.source } : null;
        return baseline;
      };
      const fetchThroughObservation = (fetcher: SourceFetcher): SourceFetcher => async (watch, abort) => {
        let fetched: Awaited<ReturnType<SourceFetcher>> | undefined;
        if (recordedCheckId) {
          const recorded = pinned ?? await options.refresh.resumeCheck(registration.data, recordedCheckId);
          if (!recorded) reject("knowledge_observation_superseded");
          return recorded;
        }
        const checkId = knowledgeOperationId("knowledge-observation/1", request.operationFingerprint);
        const result = await options.refresh.process(registration.data, checkId,
          async (registered, boundedSignal) => {
            const result = await fetcher(registered, boundedSignal);
            fetched = result.status === "ok" ? { ...result, items: result.items.map(parseKnowledgeObservation) } : result;
            return fetched;
          }, abort);
        if (result.status === "already_recorded") {
          // A later source check may have replaced the current observation. Do
          // not bind this original operation to that newer body on restart.
          const pinned = await options.refresh.resumeCheck(registration.data, checkId);
          if (!pinned) reject("knowledge_observation_outcome_unknown");
          return pinned;
        }
        if (!fetched || !["changed", "unchanged", "failed", "needs_review", "unavailable"].includes(result.status)) reject("knowledge_observation_incomplete");
        return fetched;
      };
      const runner = createBackgroundKnowledgeMaintenanceRunner({
        enabled: true, liveFetch: base.backgroundKnowledgeLiveFetch, livePublish: base.backgroundKnowledgeLivePublish,
        printedPageReview: Boolean(options.pdfQuestion || focus),
        isolatedFixturePublish: options.isolatedFixturePublish,
      }, {
        fetch: fetchThroughObservation(options.fetch),
        ...(options.fixtureFetch ? { fixtureFetch: fetchThroughObservation(options.fixtureFetch) } : {}),
        async readObservation() { const prior = await readBaseline(); return prior?.observationHash
          ? { contentHash: prior.observationHash, unavailable: false } : null; },
        durable: {
          async bind(boundRequest, leaseToken) {
            const session = await work.bind(boundRequest, leaseToken, configHash,
              { modelCalls: limits.modelCalls, deadlineMs: limits.deadlineMs, publicationConfigHash, ...windowPlan, ...(windowed ? { windowed:true as const } : {}),
                ...(script ? {maxUnits: BACKGROUND_KNOWLEDGE_RESERVED_UNITS + script.chunkCount} : {}), ...(definition.leafletPage ? {
                maxUnits: manualWindows?.maxUnits ?? 2 + Math.min(current.maxToolCalls, personal?.runLimits.toolCalls ?? current.maxToolCalls) } : {}) }, reusedOrganizationFrom,
              publication || grant?.day === today ? tx => generationCapacity(tx,platformDaily) : undefined, retained,
              firstDispatch && verifyCommission ? {...firstDispatch,verify:verifyCommission} : undefined);
            const authorize = async () => {
              if (signal.aborted || !await session.authorize()) return false;
              const latest = await policy.readPolicy();
              return sponsor ? Boolean(personal && latest.version === current.version && await sponsor.identityActive() && await personal.authorize())
                : latest.enabled && latest.version === current.version;
            };
            const providers = personal ? { agent: personal.provider, embedding: personal.maintenanceEmbedding! } : options.providers?.(config);
            const meter = options.campaignBudget?.meter({ sourceId: boundRequest.watchId, operationFingerprint: commissionedParent ?? boundRequest.operationFingerprint,
              async assertLease(tx) {
                await session.assertLease(tx);
                await verifyCommission?.(tx);
              } }, config.maxOutputTokens);
            const quotaReader = personal
              ? new FirestoreAiUsage({...options,namespace:options.namespace+"_ai_usage",billingSource:"personal"}) : platformDaily;
            const completeText = async (input: Parameters<AgentGatewayModel["completeText"]>[0]) => {
              const stage = { system: input.system, user: input.user, attemptKey: input.attemptKey };
              if (replaysCommunication) {
                if (input.role !== 'knowledge_review') reject('knowledge_script_review_stage_binding');
                const saved = await work.inspectCommunicationComparison({...request,operationFingerprint:recordedCommunicationComparison.work},stage);
                if (saved.state !== 'ready' || !saved.text) reject('knowledge_script_stage_text_unavailable');
                return normalizeRecordedComparison(saved.text, input.user);
              }
              if (transcript) return work.readHeldStage(request, transcript, stage.attemptKey, knowledgeReviewHash(stage));
              if (revisedWindow && (input.role === 'knowledge_organize' || revisedWindow.registration.action === 'retain_window_quotes'))
                return work.readHeldStage(request,revisedWindow,stage.attemptKey,knowledgeReviewHash(stage));
              if (recovery && originalRequest) {
                const saved = await work.readTruncatedStage(originalRequest, recovery.observationHash, stage);
                if (saved !== null) return saved;
              }
              return session.completeText(stage, async rootRunId => {
                budget?.close();
                const context: RootBudgetContext = { generation: 1, binding: {
                  rootRunId, ownerId: payerId, workspaceId: NIL, childId: NIL,
                  authorizationVersion: registration.data.revision, storageEpoch: request.workerGeneration,
                  trigger: { kind: "knowledge-maintenance", reference: request.watchId },
                  workflowVersion: "knowledge-maintenance/1", promptPackVersion: prompt.packVersion,
                  settingsVersion: String(current.version), billingVersion: credentialBinding,
                  limits: { modelCalls: limits.modelCalls, toolCalls: limits.toolCalls, queryEmbeddings: limits.queryEmbeddings },
                  deadlineAtMs: session.deadlineAtMs,
                } };
                budget = new AgentBudget(signal, AGENT_LIMITS.deadlineMs, session.deadlineAtMs);
                budget.configurePersonal(limits);
                budget.configureInputCharacters(base.agentMaxInputCharacters ?? AGENT_LIMITS.inputCharacters);
                await budget.initializeDurable({ adapter: root, context, dailyUsage: daily, runLimits: limits });
                const provider = providers?.agent ?? createVertexAgentProvider(config);
                const model = new AgentGatewayModel({ config, budget, provider: meter?.generation(provider,input.attemptKey) ?? provider,
                  usage: requireDurableUsage, userId: payerId, childId: NIL, authorize,
                  durableDailyUsage: { adapter: daily, context } });
                return model.completeText(input);
              }, tx => generationCapacity(tx,quotaReader));
            };
            const reviewer = createModelKnowledgeReviewPort({ completeText, explicitAgeScope: options.explicitAgeScope,
              replayCommunication: replaysCommunication, scriptRevision, webOriginal: web, readPdf: options.refresh.originals.readPdf,
              pdfQuestion: options.pdfQuestion, acceptance: options.acceptance, baseline: readBaseline, growthRules: GROWTH_RULES,
              ...(retained && retained.action !== 'retain_pdf_transcription' && retained.action !== 'review_web_original' ? { retainedDraft: { revision: retained,
                readOrganizer: key => work.readHeldStage(request, retained, key, retained.organizerRequestHash) } } : {}),
              comparison,
              ...(revision ? { async heldDraft() {
                const previous = await work.inspect({ ...request, operationFingerprint:revision.priorWork });
                if (!previous?.prepared || previous.receipt || previous.result?.status !== "candidate_held"
                  || previous.prepared.versionHash !== revision.priorVersionHash) reject("knowledge_pdf_revision_binding_mismatch");
                return { work: revision.priorWork, prepared: previous.prepared, feedback: revision.feedback, amendments: revision.amendments };
              } } : {}),
              ...(previousVisual ? { async previousVisual(candidate: BackgroundKnowledgeCandidate) {
                const old = await work.inspect({ ...request, operationFingerprint: previousVisual.priorWork });
                const proof = old?.prepared?.provenance.nativePdf;
                if (old?.prepared?.versionHash !== previousVisual.priorVersionHash || !proof?.focus || !proof.layoutQuestion
                  || proof.contentHash !== candidate.observed.extraction?.contentHash
                  || proof.focus.parentHash !== proof.contentHash) reject("knowledge_focus_binding_mismatch");
                return { focus: proof.focus, layoutQuestion: proof.layoutQuestion };
              } } : {}),
              async fetchedAt(candidate) {
                const observed = await options.refresh.inspect(candidate.watchId);
                if (observed.observation?.contentHash !== candidate.observationHash) reject("knowledge_observation_changed");
                return observed.observation.fetchedAt;
              },
              savePrepared: session.savePrepared,
            });
            return { ...session.ports,
              review: {
                async review(candidate, abort) {
                  const saved = await session.readPrepared(candidate);
                  if (saved) assertPreparedKnowledgePdfLayout(saved, options.pdfQuestion, options.acceptance);
                  if (definition.kind === "page") {
                    const review = saved?.review ?? await reviewer.review(candidate, abort);
                    if (request.publishMode === "live" && review.growthRuleImpact === "requires_review") {
                      const held = saved ?? await session.readPrepared(candidate);
                      if (!held || !await authorize()) reject("knowledge_work_lease_lost");
                      const draft = await options.knowledge.importSource(held.source);
                      if (draft.versionId !== held.assessment.comparedVersionId) {
                        await options.knowledge.review(draft.versionId, draft.hash, "agent-knowledge-maintenance", held.assessment,
                          { sourceId: candidate.watchId, contentHash: candidate.observationHash }, session.verifyLease);
                      }
                    }
                    return review;
                  }
                  if (saved) return saved.review;
                  if (candidate.observed.nativeWindowMethod) {
                    if (!windowed || focus) reject("knowledge_window_binding_changed");
                    const baseline = await readBaseline(), extraction = candidate.observed.extraction!;
                    if (baseline && (candidate.previousObservationHash !== baseline.observationHash ||
                      sourceVersionHash(baseline.source) !== baseline.versionHash)) reject("knowledge_maintenance_baseline_mismatch");
                    const plan = planKnowledgePdfWindows(extraction.totalPages!, limits.modelCalls, rangeLimit);
                    const readings: WindowReading[] = [];
                    for (const [index, range] of plan.entries()) {
                      let reading = await session.readWindow(index);
                      if (!reading) {
                        await session.reserveWorkUnit("pdf-window:" + index);
                        const count = range.lastRead - range.firstRead + 1;
                        const window = await work.readPdfWindow(candidate.watchId, extraction.contentHash, range.firstRead,
                          count, options.refresh.originals, abort);
                        if (window.descriptor.total !== extraction.totalPages) reject("knowledge_window_binding_changed");
                        const textLayers = [];
                        for (let startPage = 1; startPage <= count; startPage += 8) {
                          const local = await (options.pdfReader ?? extractKnowledgePdf)(window.bytes, { startPage, pageLimit: 8,
                            expectedHash: window.descriptor.contentHash, signal: abort });
                          if (local.totalPages !== count) reject("knowledge_window_binding_changed");
                          textLayers.push(...local.pages.map(p => ({ ...p, page: p.page + range.firstRead - 1 })));
                        }
                        reading = await readKnowledgePdfWindow({ range, candidate, baseline, sliceHash: window.descriptor.contentHash,
                          explicitAgeScope: options.explicitAgeScope, bytes: window.bytes, textLayers, completeText, signal: abort,
                          retainedTranscription: transcript, reviewedWindow:revisedWindow?.registration });
                        const hasNext = index < plan.length - 1;
                        await session.saveWindow(index, reading, hasNext);
                        if (hasNext) throw new KnowledgeWindowPending();
                      }
                      readings.push(reading);
                    }
                    const currentObservation = await options.refresh.inspect(candidate.watchId);
                    if (currentObservation.observation?.contentHash !== candidate.observationHash) reject("knowledge_observation_changed");
                    const prepared = assembleKnowledgePdfWindows({ candidate, baseline, windows: readings, windowRangeLimit:rangeLimit,
                      fetchedAt: currentObservation.observation.fetchedAt, packVersion: prompt.packVersion,
                      growthRules: GROWTH_RULES.filter(r => r.sourceId === candidate.watchId) });
                    const pair = readings[0]?.registeredRequests;
                    if (revisedWindow && (!pair || readings.length !== 1)) reject('knowledge_retained_transcription_binding');
                    const retainedProof = revisedWindow && pair ? {
                      priorWork: revisedWindow.operationFingerprint, organizerRequestHash: pair.organizerRequestHash,
                      ...(revisedWindow.registration.action === 'retain_window_quotes' ? {reviewerRequestHash:pair.reviewerRequestHash} : {}),
                      revisionHash: knowledgeReviewHash(revisedWindow.registration),
                    } : transcript ? {
                      priorWork: transcript.operationFingerprint, organizerRequestHash: transcript.organizerRequestHash,
                      reviewerRequestHash: transcript.reviewerRequestHash, revisionHash: knowledgeReviewHash(transcript),
                    } : undefined;
                    await session.savePrepared(candidate, retainedProof
                      ? {...prepared, provenance:{...prepared.provenance, retainedDraft:retainedProof}} : prepared);
                    return prepared.review;
                  }
                  if (focus) {
                    const old = await work.inspect({ ...request, operationFingerprint: focus.priorWork });
                    const prior = old?.prepared, question = options.pdfQuestion!;
                    if (!old || !prior || old.receipt || prior.versionHash !== focus.priorVersionHash || !question.physicalPage
                      || old.configHash !== knowledgeReviewHash({ ...configBinding, reader: focus.priorReader,
                        promptPack: prior.provenance.packVersion, pdfQuestion: focus.priorQuestion }))
                      reject("knowledge_focus_binding_mismatch");
                    const window = await work.readPdfWindow(candidate.watchId, question.contentHash, question.physicalPage, 1,
                      options.refresh.originals, abort);
                    const corrected = await prepareFocusedKnowledgePage({ prior, priorWork: focus.priorWork, candidate,
                      question, window, completeText, acceptance: options.acceptance, baseline: await readBaseline(), signal: abort,
                      growthRuleKeys: GROWTH_RULES.filter(rule => rule.sourceId === candidate.watchId).map(rule => rule.key) });
                    await session.savePrepared(candidate, corrected);
                    return corrected.review;
                  }
                  return reviewer.review(candidate, abort);
                },
              },
              async publish(candidate: BackgroundKnowledgeCandidate) {
                const prepared = await session.readPrepared(candidate);
                if (!prepared || !await authorize()) reject("knowledge_work_publication_mismatch");
                assertPreparedKnowledgePdfLayout(prepared, options.pdfQuestion, options.acceptance);
                if (script) {
                  if (prepared.source.chunks.length !== script.chunkCount || prepared.assessment.comparedVersionId !== script.baselineId || prepared.assessment.comparedHash !== script.baselineHash
                    || candidate.observationHash !== script.observationHash) reject('knowledge_script_edition_baseline_changed');
                  scriptEditionCoverage(candidate.observed, prepared.source);
                }
                const imported = await options.knowledge.importSource(prepared.source);
                const reviewed = await options.knowledge.review(imported.versionId, imported.hash, "agent-knowledge-maintenance",
                  prepared.assessment, { sourceId: candidate.watchId, contentHash: candidate.observationHash,
                    ...(windowed ? { verifyWindowedReview:session.verifyWindowedReview } : {}) });
                if (reviewed.status !== "reviewed") return { published: false, code: reviewed.reason ?? "knowledge_review_held" };
                let complete = false;
                for (let batch = 0; batch < 4 && !complete; batch++) {
                  if (!await authorize()) reject("knowledge_work_lease_lost");
                  complete = (await options.knowledge.prepareSearch(imported.versionId, imported.hash)).complete;
                }
                if (!complete) reject("knowledge_search_incomplete");
                const pending = await options.knowledge.missingDocuments(imported.versionId);
                const focusProof = prepared.provenance.nativePdf?.focus;
                const predecessor = focusProof && (await work.inspect({ ...request, operationFingerprint: focusProof.priorWork }))?.prepared;
                if (focusProof && predecessor?.versionHash !== focusProof.priorVersionHash) reject("knowledge_focus_binding_mismatch");
                const priorInputs = new Set(predecessor?.source.chunks.map(chunk =>
                  embeddingForChunk(predecessor.source.title, chunk).hash));
                for (const document of pending) {
                  const origin = priorInputs.has(document.hash) ? focusProof!.priorWork : request.operationFingerprint;
                  await session.reserveWorkUnit("embedding:" + document.hash);
                  const provider = providers?.embedding ?? createVertexEmbeddingProvider(config);
                  const embedding = createEmbeddingGateway({ config, ...corpusPolicy, provider: meter?.embedding(provider,document.hash) ?? provider,
                    billingSource: daily.billingSource, usage: createFirestoreOperatorEmbeddingUsage(options, session.deadlineAtMs,
                      sponsor ? { userId: payerId, dailyLimit: config.dailyUserAttempts, binding: credentialBinding } : undefined,
                      grant, publication) });
                  await options.knowledge.embedDocument(document, () => embedding.embed({
                    text: document.text, title: document.title, task: "RETRIEVAL_DOCUMENT",
                  }, { kind: "corpus_maintenance", actorId: "operator:knowledge-maintenance",
                    operationId: knowledgeOperationId("knowledge-embedding/1", knowledgeReviewHash([origin, document.hash])) }, signal, authorize)).catch(async (error: unknown) => {
                    if (error instanceof EmbeddingAdmissionDeferred) await session.waitForQuota();
                    throw error;
                  });
                }
                if (!await authorize()) reject("knowledge_work_lease_lost");
                await options.knowledge.publish(imported.versionId, imported.hash, undefined, session.publicationFence(candidate, prepared));
                const edition = await options.knowledge.publishedEdition(candidate.watchId);
                if (!edition?.enabled || edition.versionId !== imported.versionId || edition.versionHash !== imported.hash
                  || edition.observationHash !== candidate.observationHash) reject("knowledge_publication_readback_mismatch");
                return { published: true };
              },
            };
          },
        },
      });
      try { return await runner.start(request, signal); }
      catch (error) {
        if (error instanceof KnowledgeModelQuotaPending) return {status:"budget_exhausted" as const,code:"knowledge_model_daily_admission",published:false};
        if (error instanceof KnowledgeWindowPending) return { status:"in_progress" as const,code:"knowledge_window_pending",published:false };
        if (error instanceof EmbeddingAdmissionDeferred)
          return { status: "budget_exhausted" as const, code: "knowledge_embedding_daily_admission", published: false };
        throw error;
      } finally { budget?.close(); }
    },
  };
}
