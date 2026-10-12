import type { Pool } from "pg";
import type { StorageCipher } from "./storage-crypto.ts";
import type { AiConfig } from "./ai-config.ts";
import { AgentStopped, agentBudgetFingerprint, freezeAgentRunLimits, type AgentRunLimits } from "./agent-budget.ts";
import type { DurableRootBudget } from "./durable-root-budget.ts";
import type { DurableAiUsage } from "./durable-ai-usage.ts";
import type { AgentModelProvider } from "./agent-model-gateway.ts";
import type { AgentDurableRunBinder, NativeAgentSessionService } from "./agent-runtime.ts";
import { createAgentRuntime } from "./agent-runtime.ts";
import { createVertexAgentProvider } from "./agent-model-gateway.ts";
import { createProductAgentStore } from "./product-agent-store.ts";
import { createProductAgent } from "./product-agent.ts";
import { createKnowledgeStore } from "./knowledge-store.ts";
import { createKnowledgeRetriever } from "./knowledge-retriever.ts";
import type { KnowledgeStore } from "./knowledge-store.ts";
import { createEmbeddingGateway, createEmbeddingUsage, type EmbeddingProvider } from "./embedding-gateway.ts";
import { createVertexEmbeddingProvider } from "./vertex-embedding.ts";
import { createAiUsageStore } from "./ai-usage.ts";
import type { TaskScheduling } from "./tasks.ts";
import { createTaskStore } from "./tasks.ts";
import { createMemoryStore } from "./memory.ts";
import { createChatStore } from "./chat.ts";
import { createSharedInputStore } from "./shared-input-store.ts";
import { createFamilyDocumentStore } from "./family-document-store.ts";
import { createConcernStore } from "./concern-store.ts";

import { createAgentWorkContinuationProcessor, workContinuationJobSchema } from "./agent-work-continuation-worker.ts";
import type { FirestoreWorkContinuationStore } from "./firestore-work-continuation-store.ts";

import type { GrowthStore } from "./growth-store.ts";

/** Trusted Server reader of current, eligible published public knowledge only. */
export type PublishedKnowledgeReader = Pick<KnowledgeStore, "candidates">;

/** Fixed server profile only. This is not a durable acceptance snapshot or personal routing. */
export interface ProductAgentDurableProfile {
  config: Readonly<AiConfig>;
  workflowVersion: string;
  promptPackVersion: string;
  settingsVersion: string;
  billingVersion: string;
  billingSource: "platform" | "personal";
  /** Optional fixed Server-selected counts; omitted profiles retain the production defaults. */
  runLimits?: AgentRunLimits;
}
export interface ProductAgentServicePorts {
  publishedKnowledgeReader?: PublishedKnowledgeReader;
  /** Unenabled pure-due assembly; canonical prerequisites must already exist in the same database. */
  workContinuationAuthority?: FirestoreWorkContinuationStore;
  /** Trusted isolated assembly; production bootstrap intentionally does not select this mode. */
  claimedRunPersistence?: {
    nativeSessionService: NativeAgentSessionService;
    rootBudget: DurableRootBudget;
    dailyUsage: DurableAiUsage;
    profile: ProductAgentDurableProfile;
    /** Trusted provider seam, including scripted offline providers; never request-selected. */
    provider?: AgentModelProvider;
    embeddingProvider?: EmbeddingProvider;
  };
}

export function claimedRunAssembly(config: AiConfig, persistence: NonNullable<ProductAgentServicePorts["claimedRunPersistence"]>, routing: unknown, allowWorkContinuation = false, allowPersonal = false) {
  const { nativeSessionService, rootBudget, dailyUsage, provider, embeddingProvider } = persistence;
  const profile = persistence.profile ? Object.freeze({ ...persistence.profile, config: Object.freeze({ ...persistence.profile.config }),
    ...(persistence.profile.runLimits === undefined ? {} : { runLimits: freezeAgentRunLimits(persistence.profile.runLimits) }) }) : undefined;
  const version = (value: unknown): value is string => typeof value === "string" && value.length > 0
    && value.length <= 128 && value === value.trim() && value.isWellFormed();
  if (routing || !profile || !profile.config.enabled || (!allowPersonal && profile.billingSource !== "platform")
    || !["platform", "personal"].includes(profile.billingSource) || dailyUsage?.billingSource !== profile.billingSource
    || ![profile.workflowVersion, profile.promptPackVersion, profile.settingsVersion, profile.billingVersion].every(version)
    || agentBudgetFingerprint(config) !== agentBudgetFingerprint(profile.config)
    || !nativeSessionService || !rootBudget || !dailyUsage) throw new Error("Invalid claimed run persistence assembly");
  const fingerprint = agentBudgetFingerprint(profile.config);
  const bindDurableRun: AgentDurableRunBinder = (input, packVersion, limits) => {
    const claim = input.claimedRun, expiry = Date.parse(claim?.expiresAt ?? "");
    const interactive = input.recipeId === "product-interactive" && input.trigger.kind === "interactive" && claim?.sourceMessageId === input.trigger.reference;
    const continuation = allowWorkContinuation && input.recipeId === "product-work-followup" && input.trigger.kind === "worker"
      && claim?.sourceMessageId === null && workContinuationJobSchema.shape.workerGeneration.safeParse(claim.workerGeneration).success;
    if (!claim || claim.created !== true || claim.state !== "running" || !(interactive || continuation)
      || claim.recipeId !== input.recipeId || claim.trigger?.kind !== input.trigger.kind
      || claim.trigger.reference !== input.trigger.reference
      || claim.runId !== input.runId || agentBudgetFingerprint(claim.scope) !== agentBudgetFingerprint(input.scope)
      || !version(claim.storageEpoch) || !claim.scope.dataVersion.startsWith(claim.storageEpoch + ":")
      || !/^\d+$/u.test(claim.scope.dataVersion.slice(claim.storageEpoch.length + 1))
      || !Number.isSafeInteger(expiry) || expiry <= Date.now() || expiry !== input.deadlineAtMs
      || packVersion !== profile.promptPackVersion || dailyUsage.billingSource !== profile.billingSource) throw new AgentStopped("unavailable");
    return { adapter: rootBudget, dailyUsage, context: { generation: 1, binding: {
      rootRunId: claim.runId, ownerId: claim.scope.userId, workspaceId: claim.scope.workspaceId, childId: claim.scope.childId,
      authorizationVersion: claim.scope.authorizationVersion, storageEpoch: claim.storageEpoch,
      trigger: { ...claim.trigger }, workflowVersion: profile.workflowVersion + (continuation ? ":worker:" + claim.workerGeneration : ""), promptPackVersion: packVersion,
      settingsVersion: profile.settingsVersion + ":" + fingerprint, billingVersion: profile.billingVersion,
      limits: { modelCalls: limits.modelCalls, toolCalls: limits.toolCalls, queryEmbeddings: limits.queryEmbeddings }, deadlineAtMs: expiry,
    } } };
  };
  return { config: profile.config, runLimits: profile.runLimits, nativeSessionService, bindDurableRun, provider, embeddingProvider };
}

export function createProductAgentServices(pool: Pool, cipher: StorageCipher, config: AiConfig, scheduling?: TaskScheduling, diagnostics = false, growth?: GrowthStore,contact?:import("./contact-store.ts").ContactStore,summary?:import("./care-summary-store.ts").CareSummaryStore, routing?:import("./model-routing.ts").ModelRouting, actions?:import("./agent-actions-store.ts").AgentActionsStore, ports: ProductAgentServicePorts = {}) {
  if (ports.workContinuationAuthority && (!ports.claimedRunPersistence || !ports.claimedRunPersistence.provider))
    throw new Error("work_continuation_persistence_required");
  const durable = ports.claimedRunPersistence ? claimedRunAssembly(config, ports.claimedRunPersistence, routing, Boolean(ports.workContinuationAuthority)) : undefined;
  const selectedConfig = durable?.config ?? config;
  const store = createProductAgentStore(pool, cipher, scheduling);
  const runtime = createAgentRuntime({ config: selectedConfig, usage: createAiUsageStore(pool),
    ...(durable ? { nativeSessionService: durable.nativeSessionService, bindDurableRun: durable.bindDurableRun, boundRunLimits: durable.runLimits } : {}),
    provider: durable?.provider ?? (selectedConfig.enabled ? createVertexAgentProvider(selectedConfig) : { generate: async () => { throw new Error("ai_disabled"); } }),
    resolve: routing?.resolve,
    diagnostics: diagnostics ? event => { console.info("agent_diagnostic", JSON.stringify(event)); } : undefined });
  const agent = createProductAgent({ workContinuationAuthority: ports.workContinuationAuthority, store, growth, contact, summary, actions, documents:createFamilyDocumentStore(pool,cipher), concerns:createConcernStore(pool,cipher), sources:createSharedInputStore(pool,cipher), memory: createMemoryStore(pool, cipher, true),
    tasks: createTaskStore(pool, cipher, scheduling), chat: createChatStore(pool, cipher, true, true),
    runtime,
    knowledge: createKnowledgeRetriever(ports.publishedKnowledgeReader ?? createKnowledgeStore(pool), createEmbeddingGateway({ config: selectedConfig,
      usage: createEmbeddingUsage(pool), provider: durable?.embeddingProvider ?? (selectedConfig.enabled ? createVertexEmbeddingProvider(selectedConfig) : undefined) })),
  });
  return { store, agent, runtime, continuation: ports.workContinuationAuthority
    ? createAgentWorkContinuationProcessor({ mode: "durable", store: ports.workContinuationAuthority, agent }) : undefined };
}
