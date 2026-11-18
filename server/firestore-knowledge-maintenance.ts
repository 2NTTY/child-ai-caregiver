import { EmbeddingAdmissionDeferred } from "./embedding-failure.ts";
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
import { FirestoreAiUsage, KNOWLEDGE_MAINTENANCE_PAYER as OPERATOR } from "./firestore-ai-usage.ts";
import { FirestoreRootBudget } from "./firestore-root-budget.ts";
import { requireDurableUsage, type PlatformProviderFactory, type FirestoreModelRouting } from "./firestore-model-routing.ts";
import type { FirestoreDomainOptions } from "./firestore-domain-data.ts";
import type { FirestoreKnowledgeStore } from "./firestore-knowledge.ts";
import { parseKnowledgeObservation, type createFirestoreKnowledgeRefresh } from "./firestore-knowledge-refresh.ts";
import { createFirestoreKnowledgeWork, FirestoreKnowledgeWorkError } from "./firestore-knowledge-work.ts";
import { createBackgroundKnowledgeMaintenanceRunner, type BackgroundKnowledgeCandidate } from "./background-knowledge-maintenance.ts";
import { assertPreparedKnowledgePdfLayout, createModelKnowledgeReviewPort, type KnowledgeMaintenanceBaseline, type KnowledgePdfQuestion, type KnowledgePdfAcceptance } from "./background-knowledge-model.ts";
import { loadAgentPrompt } from "./agent-prompt.ts";
import { embeddingDocument } from "./knowledge-inputs.ts";
import { knowledgeReviewHash } from "./knowledge-review-assessment.ts";
import { SOURCE_WATCHES } from "./knowledge-source-catalog.ts";
import { GROWTH_RULES } from "./growth-rules.ts";
import type { SourceFetcher } from "./knowledge-refresh-types.ts";
import type { RootBudgetContext } from "./durable-root-budget.ts";

const NIL = "00000000-0000-0000-0000-000000000000";
function reject(code: string): never { throw new FirestoreKnowledgeWorkError(code); }
export function knowledgeOperationId(scope: string, fingerprint: string) {
  const id = knowledgeReviewHash([scope, fingerprint]);
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-5${id.slice(13, 16)}-8${id.slice(17, 20)}-${id.slice(20, 32)}`;
}

/** Same operator workflow for a host command, a scheduled worker and the local entry. */
export function createFirestoreKnowledgeMaintenance(options: FirestoreDomainOptions & {
  config: AiConfig;
  credentialBinding: string;
  providers?: PlatformProviderFactory;
  sponsor?: { userId: string; routing: Pick<FirestoreModelRouting, 'resolve'>; identityActive(): Promise<boolean> };
  knowledge: FirestoreKnowledgeStore;
  refresh: ReturnType<typeof createFirestoreKnowledgeRefresh>;
  readControl(tx: Transaction): Promise<{ enabled: boolean; generation: string }>;
  fetch: SourceFetcher;
  fixtureFetch?: SourceFetcher;
  pdfQuestion?: KnowledgePdfQuestion;
  acceptance?: KnowledgePdfAcceptance;
  focusedPage?: { priorWork: string; priorVersionHash: string; priorReader: string; priorQuestion: KnowledgePdfQuestion };
  isolatedFixturePublish?: boolean;
}) {
  if (options.isolatedFixturePublish && (!options.projectId.startsWith("demo-")
    || !/^127\.0\.0\.1:[0-9]+$/u.test(process.env.FIRESTORE_EMULATOR_HOST ?? "")
    || process.env.YUYF_LOCAL_DEVELOPMENT !== "1")) reject("knowledge_fixture_publication_scope");
  if (!options.credentialBinding) reject("knowledge_maintenance_credential_binding");
  const policy = createFirestoreAdmin(options, options.config);
  const work = createFirestoreKnowledgeWork(options);
  const root = new FirestoreRootBudget({ ...options, namespace: options.namespace + "_knowledge_budget" });
  const platformDaily = new FirestoreAiUsage({ ...options, namespace: options.namespace + "_ai_usage", billingSource: "platform" });
  return {
    async start(request: BackgroundKnowledgeRunRequest, signal = new AbortController().signal, expectedRevision?: string, recordedCheckId?: string, reusedOrganizationFrom?: string) {
      const current = await policy.readPolicy(), base = options.config;
      if (!base.enabled || (!options.sponsor && !current.enabled) || !base.backgroundKnowledgeMaintenanceEnabled)
        return { status: "not_enabled" as const, code: "background_knowledge_disabled", published: false };
      const definition = SOURCE_WATCHES.find(item => item.id === request.watchId);
      const registration = (await options.refresh.jobs()).find(job => job.definition.id === request.watchId);
      if (!definition || !registration || registration.data.workerGeneration !== request.workerGeneration
        || (expectedRevision !== undefined && expectedRevision !== registration.data.revision))
        reject("knowledge_watch_not_registered");
      const prompt = await loadAgentPrompt("knowledge-organize", "structured",
        ["run", "scope", "context", "evidence", "capabilities", "outputContract"]);
      const sponsor = options.sponsor;
      if (sponsor && !await sponsor.identityActive()) reject('knowledge_sponsor_inactive');
      const personal = sponsor && await sponsor.routing.resolve(sponsor.userId, 'knowledge-maintenance');
      if (sponsor && (!personal || personal.billingSource !== 'personal' || !personal.maintenanceEmbedding || !await personal.authorize()))
        reject('knowledge_sponsor_not_authorized');
      const daily = personal?.dailyUsage ?? platformDaily, payerId = sponsor?.userId ?? OPERATOR;
      const credentialBinding = sponsor && personal
        ? knowledgeReviewHash(['maintenance-sponsor/1', sponsor.userId, personal.settingsVersion]) : options.credentialBinding;
      const limits = { modelCalls: Math.min(2, current.maxModelCalls, personal?.runLimits.modelCalls ?? 2),
        toolCalls: Math.min(8, current.maxToolCalls, personal?.runLimits.toolCalls ?? 8), queryEmbeddings: 1,
        deadlineMs: Math.min(300_000, current.maxRunSeconds * 1000, personal?.runLimits.deadlineMs ?? 300_000) };
      const config: AiConfig = { ...(personal?.config ?? { ...base, model: base.localModelOverride ?? current.model,
        dailyUserAttempts: current.dailyUserAttempts, dailyGlobalAttempts: current.dailyGlobalAttempts }),
        timeoutMs: Math.min(personal?.config.timeoutMs ?? base.timeoutMs, current.modelRequestSeconds * 1000), maxAttempts: 1, agentMaxRetries: 0 };
      const configBinding = { config, limits, ...(definition.leafletPage ? { reader: NATIVE_PDF_READER_VERSION } : {}), policyVersion: current.version,
        credentialBinding, ...(options.pdfQuestion ? { pdfQuestion: options.pdfQuestion } : {}), promptPack: prompt.packVersion, watchRevision: registration.data.revision };
      const focus = options.focusedPage;
      const configHash = knowledgeReviewHash({ ...configBinding, ...(focus ? { focus } : {}) });
      if (focus && (!options.pdfQuestion || !recordedCheckId || !definition.leafletPage
        || (reusedOrganizationFrom ?? request.operationFingerprint) !== focusedKnowledgeWorkId(focus.priorWork, focus.priorVersionHash, options.pdfQuestion))) reject("knowledge_focus_binding_mismatch");
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
          const pinned = await options.refresh.resumeCheck(registration.data, recordedCheckId);
          if (!pinned) reject("knowledge_observation_superseded");
          return pinned;
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
        if (!fetched || !["changed", "unchanged", "failed", "unavailable"].includes(result.status)) reject("knowledge_observation_incomplete");
        return fetched;
      };
      const runner = createBackgroundKnowledgeMaintenanceRunner({
        enabled: true, liveFetch: base.backgroundKnowledgeLiveFetch, livePublish: base.backgroundKnowledgeLivePublish,
        isolatedFixturePublish: options.isolatedFixturePublish,
      }, {
        fetch: fetchThroughObservation(options.fetch),
        ...(options.fixtureFetch ? { fixtureFetch: fetchThroughObservation(options.fixtureFetch) } : {}),
        async readObservation() { const prior = await readBaseline(); return prior?.observationHash
          ? { contentHash: prior.observationHash, unavailable: false } : null; },
        durable: {
          async bind(boundRequest, leaseToken) {
            const session = await work.bind(boundRequest, leaseToken, configHash,
              { modelCalls: limits.modelCalls, deadlineMs: limits.deadlineMs, ...(definition.leafletPage ? {
                maxUnits: 2 + Math.min(current.maxToolCalls, personal?.runLimits.toolCalls ?? current.maxToolCalls) } : {}) }, reusedOrganizationFrom);
            const authorize = async () => {
              if (signal.aborted || !await session.authorize()) return false;
              const latest = await policy.readPolicy();
              return sponsor ? Boolean(personal && latest.version === current.version && await sponsor.identityActive() && await personal.authorize())
                : latest.enabled;
            };
            const providers = personal ? { agent: personal.provider, embedding: personal.maintenanceEmbedding! } : options.providers?.(config);
            let model: AgentGatewayModel | undefined;
            const completeText = async (input: Parameters<AgentGatewayModel["completeText"]>[0]) =>
              session.completeText({ system: input.system, user: input.user, attemptKey: input.attemptKey }, async () => {
                if (!model) {
                  const context: RootBudgetContext = { generation: 1, binding: {
                    rootRunId: request.operationFingerprint, ownerId: payerId, workspaceId: NIL, childId: NIL,
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
                  model = new AgentGatewayModel({ config, budget, provider: providers?.agent ?? createVertexAgentProvider(config),
                    usage: requireDurableUsage, userId: payerId, childId: NIL, authorize,
                    durableDailyUsage: { adapter: daily, context } });
                }
                return model.completeText(input);
              });
            const reviewer = createModelKnowledgeReviewPort({ completeText, readPdf: options.refresh.originals.readPdf, pdfQuestion: options.pdfQuestion, acceptance: options.acceptance, baseline: readBaseline, growthRules: GROWTH_RULES,
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
                  if (saved) { assertPreparedKnowledgePdfLayout(saved, options.pdfQuestion, options.acceptance); return saved.review; }
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
                const imported = await options.knowledge.importSource(prepared.source);
                const reviewed = await options.knowledge.review(imported.versionId, imported.hash, "agent-knowledge-maintenance",
                  prepared.assessment, { sourceId: candidate.watchId, contentHash: candidate.observationHash });
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
                  embeddingDocument(predecessor.source.title, chunk.section, chunk.text).hash));
                for (const document of pending) {
                  const origin = priorInputs.has(document.hash) ? focusProof!.priorWork : request.operationFingerprint;
                  await session.reserveWorkUnit("embedding:" + document.hash);
                  const embedding = createEmbeddingGateway({ config, provider: providers?.embedding ?? createVertexEmbeddingProvider(config),
                    billingSource: daily.billingSource, usage: createFirestoreOperatorEmbeddingUsage(options, session.deadlineAtMs,
                      sponsor ? { userId: payerId, dailyLimit: config.dailyUserAttempts, binding: credentialBinding } : undefined) });
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
      finally { budget?.close(); }
    },
  };
}
