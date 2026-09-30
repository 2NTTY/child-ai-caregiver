import type { Pool } from "pg";
import type { StorageCipher } from "./storage-crypto.ts";
import type { AiConfig } from "./ai-config.ts";
import { createAgentRuntime } from "./agent-runtime.ts";
import { createVertexAgentProvider } from "./agent-model-gateway.ts";
import { createProductAgentStore } from "./product-agent-store.ts";
import { createProductAgent } from "./product-agent.ts";
import { createKnowledgeStore } from "./knowledge-store.ts";
import { createKnowledgeRetriever } from "./knowledge-retriever.ts";
import { createEmbeddingGateway, createEmbeddingUsage } from "./embedding-gateway.ts";
import { createVertexEmbeddingProvider } from "./vertex-embedding.ts";
import { createAiUsageStore } from "./ai-usage.ts";
import type { TaskScheduling } from "./tasks.ts";
import { createTaskStore } from "./tasks.ts";
import { createMemoryStore } from "./memory.ts";
import { createChatStore } from "./chat.ts";

export function createProductAgentServices(pool: Pool, cipher: StorageCipher, config: AiConfig, scheduling?: TaskScheduling, diagnostics = false) {
  const store = createProductAgentStore(pool, cipher, scheduling);
  const agent = createProductAgent({ store, memory: createMemoryStore(pool, cipher, true),
    tasks: createTaskStore(pool, cipher, scheduling), chat: createChatStore(pool, cipher, true, true),
    runtime: createAgentRuntime({ config, usage: createAiUsageStore(pool), provider: createVertexAgentProvider(config),
      diagnostics: diagnostics ? event => { console.info("agent_diagnostic", JSON.stringify(event)); } : undefined }),
    knowledge: createKnowledgeRetriever(createKnowledgeStore(pool), createEmbeddingGateway({ config,
      usage: createEmbeddingUsage(pool), provider: config.enabled ? createVertexEmbeddingProvider(config) : undefined })),
  });
  return { store, agent };
}
