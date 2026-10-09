import type { Pool } from "pg";
import type { StorageCipher } from "./storage-crypto.ts";
import type { AiConfig } from "./ai-config.ts";
import type { BaseSessionService } from "@google/adk";
import { AgentStopped, agentBudgetFingerprint } from "./agent-budget.ts";
import type { DurableRootBudget } from "./durable-root-budget.ts";
import type { DurableAiUsage } from "./durable-ai-usage.ts";
import type { AgentModelProvider } from "./agent-model-gateway.ts";
import type { AgentDurableRunBinder } from "./agent-runtime.ts";
import { createAgentRuntime } from "./agent-runtime.ts";
import { createVertexAgentProvider } from "./agent-model-gateway.ts";
import { createProductAgentStore } from "./product-agent-store.ts";
import { createProductAgent } from "./product-agent.ts";
import { createKnowledgeStore } from "./knowledge-store.ts";
import { createKnowledgeRetriever } from "./knowledge-retriever.ts";
import type { KnowledgeStore } from "./knowledge-store.ts";
import { createEmbeddingGateway, createEmbeddingUsage } from "./embedding-gateway.ts";
import { createVertexEmbeddingProvider } from "./vertex-embedding.ts";
import { createAiUsageStore } from "./ai-usage.ts";
import type { TaskScheduling } from "./tasks.ts";
import { createTaskStore } from "./tasks.ts";
import { createMemoryStore } from "./memory.ts";
import { createChatStore } from "./chat.ts";
import { createSharedInputStore } from "./shared-input-store.ts";
import { createFamilyDocumentStore } from "./family-document-store.ts";
import { createConcernStore } from "./concern-store.ts";

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
  billingSource: "platform";
}
export interface ProductAgentServicePorts {
  publishedKnowledgeReader?: PublishedKnowledgeReader;
  /** Trusted isolated assembly; production bootstrap intentionally does not select this mode. */
  claimedRunPersistence?: {
    nativeSessionService: BaseSessionService;
    rootBudget: DurableRootBudget;
    dailyUsage: DurableAiUsage;
    profile: ProductAgentDurableProfile;
    /** Trusted provider seam, including scripted offline providers; never request-selected. */
    provider?: AgentModelProvider;
  };
}

function claimedRunAssembly(config: AiConfig, persistence: NonNullable<ProductAgentServicePorts["claimedRunPersistence"]>, routing: unknown) {
  const { nativeSessionService, rootBudget, dailyUsage, provider } = persistence;
  const profile = persistence.profile ? Object.freeze({ ...persistence.profile, config: Object.freeze({ ...persistence.profile.config }) }) : undefined;
  const version = (value: unknown): value is string => typeof value === "string" && value.length > 0
    && value.length <= 128 && value === value.trim() && value.isWellFormed();
  if (routing || !profile || !profile.config.enabled || profile.billingSource !== "platform" || dailyUsage?.billingSource !== "platform"
    || ![profile.workflowVersion, profile.promptPackVersion, profile.settingsVersion, profile.billingVersion].every(version)
    || agentBudgetFingerprint(config) !== agentBudgetFingerprint(profile.config)
    || !nativeSessionService || !rootBudget || !dailyUsage) throw new Error("Invalid claimed run persistence assembly");
  const fingerprint = agentBudgetFingerprint(profile.config);
  const bindDurableRun: AgentDurableRunBinder = (input, packVersion, limits) => {
    const claim = input.claimedRun, expiry = Date.parse(claim?.expiresAt ?? "");
    if (!claim || claim.created !== true || claim.state !== "running" || input.recipeId !== "product-interactive"
      || claim.recipeId !== input.recipeId || input.trigger.kind !== "interactive" || claim.trigger?.kind !== input.trigger.kind
      || claim.trigger.reference !== input.trigger.reference || claim.sourceMessageId !== input.trigger.reference
      || claim.runId !== input.runId || agentBudgetFingerprint(claim.scope) !== agentBudgetFingerprint(input.scope)
      || !version(claim.storageEpoch) || !claim.scope.dataVersion.startsWith(claim.storageEpoch + ":")
      || !/^\d+$/u.test(claim.scope.dataVersion.slice(claim.storageEpoch.length + 1))
      || !Number.isSafeInteger(expiry) || expiry <= Date.now() || expiry !== input.deadlineAtMs
      || packVersion !== profile.promptPackVersion || dailyUsage.billingSource !== "platform") throw new AgentStopped("unavailable");
    return { adapter: rootBudget, dailyUsage, context: { generation: 1, binding: {
      rootRunId: claim.runId, ownerId: claim.scope.userId, workspaceId: claim.scope.workspaceId, childId: claim.scope.childId,
      authorizationVersion: claim.scope.authorizationVersion, storageEpoch: claim.storageEpoch,
      trigger: { ...claim.trigger }, workflowVersion: profile.workflowVersion, promptPackVersion: packVersion,
      settingsVersion: profile.settingsVersion + ":" + fingerprint, billingVersion: profile.billingVersion,
      limits: { modelCalls: limits.modelCalls, toolCalls: limits.toolCalls, queryEmbeddings: limits.queryEmbeddings }, deadlineAtMs: expiry,
    } } };
  };
  return { config: profile.config, nativeSessionService, bindDurableRun, provider };
}

export function createProductAgentServices(pool: Pool, cipher: StorageCipher, config: AiConfig, scheduling?: TaskScheduling, diagnostics = false, growth?: GrowthStore,contact?:import("./contact-store.ts").ContactStore,summary?:import("./care-summary-store.ts").CareSummaryStore, routing?:import("./model-routing.ts").ModelRouting, actions?:import("./agent-actions-store.ts").AgentActionsStore, ports: ProductAgentServicePorts = {}) {
  const durable = ports.claimedRunPersistence ? claimedRunAssembly(config, ports.claimedRunPersistence, routing) : undefined;
  const selectedConfig = durable?.config ?? config;
  const store = createProductAgentStore(pool, cipher, scheduling);
  const runtime = createAgentRuntime({ config: selectedConfig, usage: createAiUsageStore(pool),
    ...(durable ? { nativeSessionService: durable.nativeSessionService, bindDurableRun: durable.bindDurableRun } : {}),
    provider: durable?.provider ?? (selectedConfig.enabled ? createVertexAgentProvider(selectedConfig) : { generate: async () => { throw new Error("ai_disabled"); } }),
    resolve: routing?.resolve,
    diagnostics: diagnostics ? event => { console.info("agent_diagnostic", JSON.stringify(event)); } : undefined });
  const agent = createProductAgent({ store, growth, contact, summary, actions, documents:createFamilyDocumentStore(pool,cipher), concerns:createConcernStore(pool,cipher), sources:createSharedInputStore(pool,cipher), memory: createMemoryStore(pool, cipher, true),
    tasks: createTaskStore(pool, cipher, scheduling), chat: createChatStore(pool, cipher, true, true),
    runtime,
    knowledge: createKnowledgeRetriever(ports.publishedKnowledgeReader ?? createKnowledgeStore(pool), createEmbeddingGateway({ config: selectedConfig,
      usage: createEmbeddingUsage(pool), provider: selectedConfig.enabled ? createVertexEmbeddingProvider(selectedConfig) : undefined })),
  });
  return { store, agent, runtime };
}
