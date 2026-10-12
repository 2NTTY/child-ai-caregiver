import type { AiConfig } from '../../server/ai-config.ts';
import type { AgentModelProvider } from '../../server/agent-model-gateway.ts';
import type { ProductAgentResult } from '../../src/shared/product-agent.ts';

type BatchSnapshot = { state: string; rootCalls: number[]; historicalGenerationCalls: number };
/** The consumer validates its wire/checkpoint at runtime; none of these options enables live calls. */
export function createOfflineDocumentBatchConsumer(options: {
  config: AiConfig; productModelModule: Pick<typeof import('../../server/agent-model-gateway.ts'), 'createVertexAgentPayloadBuilder' | 'vertexAgentClientOptions'>;
  checkpoint: { filename: string; batchId: string; expectedLegacySha256: string;
    provenance: { testedSha: string; legacyHarnessSha: string; candidateSha256: string } };
  synthetic: { count(wire: unknown): Promise<number>;
    generate(wire: unknown, context: unknown): ReturnType<AgentModelProvider['generate']> };
  execution: { inspect(): unknown;
    runRoot(input: unknown, provider: AgentModelProvider): Promise<ProductAgentResult | null> };
}): { run(): Promise<{ mode: 'offline-simulation'; results: ProductAgentResult[]; ledger: BatchSnapshot }>;
  snapshot(): BatchSnapshot; close(): void };
