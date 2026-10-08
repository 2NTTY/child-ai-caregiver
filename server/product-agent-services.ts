import type { Pool } from "pg";
import type { StorageCipher } from "./storage-crypto.ts";
import type { AiConfig } from "./ai-config.ts";
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

export interface ProductAgentServicePorts {
  publishedKnowledgeReader?: PublishedKnowledgeReader;
}

export function createProductAgentServices(pool: Pool, cipher: StorageCipher, config: AiConfig, scheduling?: TaskScheduling, diagnostics = false, growth?: GrowthStore,contact?:import("./contact-store.ts").ContactStore,summary?:import("./care-summary-store.ts").CareSummaryStore, routing?:import("./model-routing.ts").ModelRouting, actions?:import("./agent-actions-store.ts").AgentActionsStore, ports: ProductAgentServicePorts = {}) {
  const store = createProductAgentStore(pool, cipher, scheduling);
  const runtime = createAgentRuntime({ config, usage: createAiUsageStore(pool),
    provider: config.enabled ? createVertexAgentProvider(config) : { generate: async () => { throw new Error("ai_disabled"); } },
    resolve: routing?.resolve,
    diagnostics: diagnostics ? event => { console.info("agent_diagnostic", JSON.stringify(event)); } : undefined });
  const agent = createProductAgent({ store, growth, contact, summary, actions, documents:createFamilyDocumentStore(pool,cipher), concerns:createConcernStore(pool,cipher), sources:createSharedInputStore(pool,cipher), memory: createMemoryStore(pool, cipher, true),
    tasks: createTaskStore(pool, cipher, scheduling), chat: createChatStore(pool, cipher, true, true),
    runtime,
    knowledge: createKnowledgeRetriever(ports.publishedKnowledgeReader ?? createKnowledgeStore(pool), createEmbeddingGateway({ config,
      usage: createEmbeddingUsage(pool), provider: config.enabled ? createVertexEmbeddingProvider(config) : undefined })),
  });
  return { store, agent, runtime };
}
