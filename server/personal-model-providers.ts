import type { AiConfig } from './ai-config.ts';
import { ApiError } from '@google/genai';
import type { PersonalModelProvider } from '../src/shared/model-settings.ts';
import { KNOWLEDGE_EMBEDDING } from '../src/shared/knowledge.ts';
import { AgentStopped } from './agent-budget.ts';
import { createGeminiKeyProviders } from './gemini-key-provider.ts';
import { createCompatibleProviders } from './openai-compatible-provider.ts';
import { PersonalProviderError, personalProviderHttpError } from './personal-provider-error.ts';

/** Both production and local development use this factory; credentials never fall back to platform ADC. */
export function createPersonalModelProviders(config: AiConfig, apiKey: string, provider: PersonalModelProvider,
  options: { baseUrl?: string; embeddingApiKey?: string | null; documentEmbeddings?: boolean } = {}): ReturnType<typeof createGeminiKeyProviders> {
  const google = provider === 'openai-compatible' ? null : createGeminiKeyProviders(config, apiKey, provider, options);
  const model = google ?? createCompatibleProviders(config, apiKey, options.baseUrl ?? 'https://api.openai.com/v1');
  const embedding = options.embeddingApiKey
    ? createGeminiKeyProviders(config, options.embeddingApiKey, 'gemini', options).embedding
    : provider === 'gemini' ? google!.embedding : null;
  const unsupportedMetadata = async () => ({ status: 'unavailable' as const, reason: 'metadata_unsupported' as const });
  return { ...model,
    agent: { async generate(request, signal) {
      try { return await model.agent.generate(request, signal); }
      catch (error) {
        if (error instanceof ApiError) throw personalProviderHttpError(error.status, error.message);
        throw error;
      }
    } },
    check: google?.check ?? (async () => false),
    inspect: google?.inspect ?? unsupportedMetadata,
    async catalog(version, refresh, signal) {
      const result = google ? await google.catalog(version, refresh, signal) : {
        version, provider, models: [], status: refresh ? 'unavailable' as const : 'not_checked' as const,
        ...(refresh ? { reason: 'metadata_unsupported' as const } : {}),
        scope: 'model_metadata_only' as const, truncated: false,
        embedding: { model: KNOWLEDGE_EMBEDDING.model, dimensions: KNOWLEDGE_EMBEDDING.dimensions, status: 'not_checked' as const },
      };
      return { ...result, embedding: { ...result.embedding, status: embedding ? 'not_checked' : 'unsupported' } };
    },
    embedding: { async embed(input, signal) {
      if (!embedding) throw new AgentStopped('embedding_not_configured');
      try { return await embedding.embed(input, signal); }
      catch (error) {
        if (error instanceof PersonalProviderError) throw new AgentStopped(error.diagnostic.reason);
        throw error;
      }
    } },
  };
}
