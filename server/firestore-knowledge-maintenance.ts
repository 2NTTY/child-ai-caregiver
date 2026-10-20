import type { Transaction } from "@google-cloud/firestore";
import type { BackgroundKnowledgeRunRequest } from "../src/shared/background-knowledge-maintenance.ts";
import type { AiConfig } from "./ai-config.ts";
import { AgentBudget, AGENT_LIMITS } from "./agent-budget.ts";
import { AgentGatewayModel, createVertexAgentProvider } from "./agent-model-gateway.ts";
import { createVertexEmbeddingProvider } from "./vertex-embedding.ts";
import { createEmbeddingGateway } from "./embedding-gateway.ts";
import { createFirestoreOperatorEmbeddingUsage } from "./firestore-embedding-usage.ts";
import { createFirestoreAdmin } from "./firestore-admin.ts";
import { FirestoreAiUsage } from "./firestore-ai-usage.ts";
import { FirestoreRootBudget } from "./firestore-root-budget.ts";
import { requireDurableUsage, type PlatformProviderFactory } from "./firestore-model-routing.ts";
import type { FirestoreDomainOptions } from "./firestore-domain-data.ts";
import type { FirestoreKnowledgeStore } from "./firestore-knowledge.ts";
import type { createFirestoreKnowledgeRefresh } from "./firestore-knowledge-refresh.ts";
import { createFirestoreKnowledgeWork, FirestoreKnowledgeWorkError } from "./firestore-knowledge-work.ts";
import { createBackgroundKnowledgeMaintenanceRunner, type BackgroundKnowledgeCandidate } from "./background-knowledge-maintenance.ts";
import { createModelKnowledgeReviewPort, type KnowledgeMaintenanceBaseline } from "./background-knowledge-model.ts";
import { loadAgentPrompt } from "./agent-prompt.ts";
import { knowledgeReviewHash } from "./knowledge-review-assessment.ts";
import { SOURCE_WATCHES } from "./knowledge-source-catalog.ts";
import type { SourceFetcher } from "./knowledge-refresh-types.ts";
import type { RootBudgetContext } from "./durable-root-budget.ts";

const NIL = "00000000-0000-0000-0000-000000000000";
const OPERATOR = "system:knowledge-maintenance";
function reject(code: string): never { throw new FirestoreKnowledgeWorkError(code); }
function operationId(scope: string, fingerprint: string) {
  const id = knowledgeReviewHash([scope, fingerprint]);
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-5${id.slice(13, 16)}-8${id.slice(17, 20)}-${id.slice(20, 32)}`;
}

/** Same operator workflow for a host command, a scheduled worker and the local entry. */
export function createFirestoreKnowledgeMaintenance(options: FirestoreDomainOptions & {
  config: AiConfig;
  credentialBinding: string;
  providers?: PlatformProviderFactory;
  knowledge: FirestoreKnowledgeStore;
  refresh: ReturnType<typeof createFirestoreKnowledgeRefresh>;
  readControl(tx: Transaction): Promise<{ enabled: boolean; generation: string }>;
  fetch: SourceFetcher;
  fixtureFetch?: SourceFetcher;
  isolatedFixturePublish?: boolean;
}) {
  if (options.isolatedFixturePublish && (!options.projectId.startsWith("demo-")
    || !/^127\.0\.0\.1:[0-9]+$/u.test(process.env.FIRESTORE_EMULATOR_HOST ?? "")
    || process.env.YUYF_LOCAL_DEVELOPMENT !== "1")) reject("knowledge_fixture_publication_scope");
  if (!options.credentialBinding) reject("knowledge_maintenance_credential_binding");
  const policy = createFirestoreAdmin(options, options.config);
  const work = createFirestoreKnowledgeWork(options);
  const root = new FirestoreRootBudget({ ...options, namespace: options.namespace + "_knowledge_budget" });
  const daily = new FirestoreAiUsage({ ...options, namespace: options.namespace + "_ai_usage", billingSource: "platform" });
  return {
    async start(request: BackgroundKnowledgeRunRequest, signal = new AbortController().signal) {
      const current = await policy.readPolicy(), base = options.config;
      if (!base.enabled || !current.enabled || !base.backgroundKnowledgeMaintenanceEnabled)
        return { status: "not_enabled" as const, code: "background_knowledge_disabled", published: false };
      const definition = SOURCE_WATCHES.find(item => item.id === request.watchId);
      const registration = (await options.refresh.jobs()).find(job => job.definition.id === request.watchId);
      if (!definition || !registration || registration.data.workerGeneration !== request.workerGeneration)
        reject("knowledge_watch_not_registered");
      const prompt = await loadAgentPrompt("knowledge-organize", "structured",
        ["run", "scope", "context", "evidence", "capabilities", "outputContract"]);
      // Background work has an independent two-step profile, never a family key.
      // Respect a lower administrator ceiling. No retry can silently spend more.
      const limits = { modelCalls: Math.min(2, current.maxModelCalls), toolCalls: 8, queryEmbeddings: 1,
        deadlineMs: Math.min(300_000, current.maxRunSeconds * 1000) };
      const config: AiConfig = { ...base, model: current.model, dailyUserAttempts: current.dailyUserAttempts,
        dailyGlobalAttempts: current.dailyGlobalAttempts, timeoutMs: Math.min(base.timeoutMs, current.modelRequestSeconds * 1000),
        maxAttempts: 1, agentMaxRetries: 0 };
      const configHash = knowledgeReviewHash({ config, limits, policyVersion: current.version,
        credentialBinding: options.credentialBinding, promptPack: prompt.packVersion, watchRevision: registration.data.revision });
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
        const result = await options.refresh.process(registration.data, operationId("knowledge-observation/1", request.operationFingerprint),
          async (registered, boundedSignal) => { fetched = await fetcher(registered, boundedSignal); return fetched; }, abort);
        if (result.status === "already_recorded") {
          // A later source check may have replaced the current observation. Do
          // not bind this original operation to that newer body on restart.
          reject("knowledge_observation_outcome_unknown");
        }
        if (!fetched) reject("knowledge_observation_incomplete");
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
              { modelCalls: limits.modelCalls, deadlineMs: limits.deadlineMs });
            const authorize = async () => !signal.aborted && await session.authorize() && (await policy.readPolicy()).enabled;
            const providers = options.providers?.(config);
            let model: AgentGatewayModel | undefined;
            const completeText = async (input: { system: string; user: string; attemptKey: string }) =>
              session.completeText(input, async () => {
                if (!model) {
                  const context: RootBudgetContext = { generation: 1, binding: {
                    rootRunId: request.operationFingerprint, ownerId: OPERATOR, workspaceId: NIL, childId: NIL,
                    authorizationVersion: registration.data.revision, storageEpoch: request.workerGeneration,
                    trigger: { kind: "knowledge-maintenance", reference: request.watchId },
                    workflowVersion: "knowledge-maintenance/1", promptPackVersion: prompt.packVersion,
                    settingsVersion: String(current.version), billingVersion: options.credentialBinding,
                    limits: { modelCalls: limits.modelCalls, toolCalls: limits.toolCalls, queryEmbeddings: limits.queryEmbeddings },
                    deadlineAtMs: session.deadlineAtMs,
                  } };
                  budget = new AgentBudget(signal, AGENT_LIMITS.deadlineMs, session.deadlineAtMs);
                  budget.configurePersonal(limits);
                  budget.configureInputCharacters(base.agentMaxInputCharacters ?? AGENT_LIMITS.inputCharacters);
                  await budget.initializeDurable({ adapter: root, context, dailyUsage: daily, runLimits: limits });
                  model = new AgentGatewayModel({ config, budget, provider: providers?.agent ?? createVertexAgentProvider(config),
                    usage: requireDurableUsage, userId: OPERATOR, childId: NIL, authorize,
                    durableDailyUsage: { adapter: daily, context } });
                }
                return model.completeText(input);
              });
            const reviewer = createModelKnowledgeReviewPort({ completeText, baseline: readBaseline,
              async fetchedAt(candidate) {
                const observed = await options.refresh.inspect(candidate.watchId);
                if (observed.observation?.contentHash !== candidate.observationHash) reject("knowledge_observation_changed");
                return observed.observation.lastSuccessfulCheckAt;
              },
              savePrepared: session.savePrepared,
            });
            return { ...session.ports,
              review: {
                async review(candidate, abort) {
                  const saved = await session.readPrepared(candidate);
                  return saved?.review ?? reviewer.review(candidate, abort);
                },
              },
              async publish(candidate: BackgroundKnowledgeCandidate) {
                const prepared = await session.readPrepared(candidate);
                if (!prepared || !await authorize()) reject("knowledge_work_publication_mismatch");
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
                for (const document of pending) {
                  await session.reserveWorkUnit("embedding:" + document.hash);
                  const embedding = createEmbeddingGateway({ config, provider: providers?.embedding ?? createVertexEmbeddingProvider(config),
                    usage: createFirestoreOperatorEmbeddingUsage(options, session.deadlineAtMs) });
                  await options.knowledge.embedDocument(document, () => embedding.embed({
                    text: document.text, title: document.title, task: "RETRIEVAL_DOCUMENT",
                  }, { kind: "corpus_maintenance", actorId: "operator:knowledge-maintenance",
                    operationId: operationId("knowledge-embedding/1", knowledgeReviewHash([request.operationFingerprint, document.hash])) }, signal, authorize));
                }
                if (!await authorize()) reject("knowledge_work_lease_lost");
                await options.knowledge.publish(imported.versionId, imported.hash, undefined, session.publicationFence(candidate, prepared));
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
