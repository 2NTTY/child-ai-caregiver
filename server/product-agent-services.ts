import type { Pool } from "pg";
import type { StorageCipher } from "./storage-crypto.ts";
import type { AiConfig } from "./ai-config.ts";
import { claimedRunAssembly, type ClaimedRunPersistence } from "./agent-run-assembly.ts";
export { claimedRunAssembly, type ProductAgentDurableProfile } from "./agent-run-assembly.ts";
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

import { createAgentWorkContinuationProcessor } from "./agent-work-continuation-worker.ts";
import type { FirestoreWorkContinuationStore } from "./firestore-work-continuation-store.ts";

import type { GrowthStore } from "./growth-store.ts";

/** Trusted Server reader of current, eligible published public knowledge only. */
export type PublishedKnowledgeReader = Pick<KnowledgeStore, "candidates">;

export interface ProductAgentServicePorts {
  publishedKnowledgeReader?: PublishedKnowledgeReader;
  /** Unenabled pure-due assembly; canonical prerequisites must already exist in the same database. */
  workContinuationAuthority?: FirestoreWorkContinuationStore;
  /** Trusted isolated assembly; production bootstrap intentionally does not select this mode. */
  claimedRunPersistence?: ClaimedRunPersistence;
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
