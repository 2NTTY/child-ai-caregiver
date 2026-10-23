import { ApiError, GoogleGenAI } from "@google/genai";
import type { EmbedContentResponse } from "@google/genai";
import { KNOWLEDGE_EMBEDDING } from "../src/shared/knowledge.ts";
import type { AiConfig } from "./ai-config.ts";
import { nativePersonalThinkingConfig } from "./model-thinking.ts";
import type { ModelKeyCheck, PersonalModelCatalog, PersonalModelProvider } from '../src/shared/model-settings.ts';
import { personalModelCatalog, personalModelEntry } from './personal-model-catalog.ts';
import { personalModelIdSchema } from '../src/shared/model-settings-schema.ts';
import { AGENT_LIMITS, AgentStopped } from "./agent-budget.ts";
import type { AgentModelProvider } from "./agent-model-gateway.ts";
import { EmbeddingFailure } from "./embedding-gateway.ts";
import type { EmbeddingProvider, EmbeddingReply } from "./embedding-gateway.ts";
import { ProviderFailure } from "./model-gateway.ts";
import type { ModelProvider } from "./model-gateway.ts";
import { readVertexReply } from "./vertex-provider.ts";
import { personalProviderHttpError } from './personal-provider-error.ts';

function readCount(value: unknown): number | null {
  if (value === undefined) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new EmbeddingFailure("invalid_response");
  }
  return value;
}

function readKeyEmbedding(response: EmbedContentResponse): EmbeddingReply {
  const embedding = response.embeddings?.[0];
  const values = embedding?.values;
  if (response.embeddings?.length !== 1 || !Array.isArray(values)
    || values.length !== KNOWLEDGE_EMBEDDING.dimensions
    || values.some(value => typeof value !== "number" || !Number.isFinite(value))
    || embedding?.statistics?.truncated === true) {
    throw new EmbeddingFailure("invalid_response");
  }
  const norm = Math.hypot(...values);
  if (!Number.isFinite(norm) || norm === 0) throw new EmbeddingFailure("invalid_response");
  const inputTokens = readCount(embedding?.statistics?.tokenCount);
  if (inputTokens !== null && inputTokens > 2048) throw new EmbeddingFailure("invalid_response");
  // Reduced-dimensional Developer API embeddings require local L2 normalization.
  return { values: values.map(value => value / norm), inputTokens,
    billableCharacters: readCount(response.metadata?.billableCharacterCount) };
}

export function createGeminiKeyProviders(config: AiConfig, apiKey: string, provider: Exclude<PersonalModelProvider, 'openai-compatible'> = 'gemini',
  options: { documentEmbeddings?: boolean } = {}): {
  agent: AgentModelProvider;
  model: ModelProvider;
  embedding: EmbeddingProvider;
  check: (signal: AbortSignal) => Promise<boolean>;
  inspect: (signal: AbortSignal) => Promise<Pick<ModelKeyCheck, 'status' | 'reason'>>;
  catalog: (version: number, refresh: boolean, signal: AbortSignal) => Promise<PersonalModelCatalog>;
} {
  if (typeof apiKey !== "string" || !apiKey.trim()) throw new ProviderFailure("unavailable");
  if (!personalModelIdSchema.safeParse(config.model).success) throw new ProviderFailure("unavailable");
  const thinkingConfig = nativePersonalThinkingConfig(config.model), vertex = provider === 'vertex';
  const apiVersion = vertex ? 'v1' : 'v1beta';
  const httpOptions = { baseUrl: vertex ? 'https://aiplatform.googleapis.com' : "https://generativelanguage.googleapis.com", apiVersion,
    timeout: config.timeoutMs, retryOptions: { attempts: 1 } };
  let client: GoogleGenAI;
  try {
    client = new GoogleGenAI({ enterprise: vertex, apiKey, apiVersion, httpOptions });
  } catch {
    throw new ProviderFailure("unavailable");
  }
  const failure = (error: unknown) => new ProviderFailure(
    error instanceof ApiError && error.status === 429 ? "rate_limited" : "unavailable");
  const reason = (error: unknown, signal: AbortSignal): NonNullable<ModelKeyCheck['reason']> => {
    if (signal.aborted) return 'timeout';
    if (!(error instanceof ApiError)) return 'unavailable';
    if (/user location is not supported|not available in your (country|region)/i.test(error.message)) return 'region_unavailable';
    if (/API_KEY_INVALID|API key not valid/i.test(error.message) || error.status === 401) return 'invalid_key';
    if (error.status === 404) return 'model_unavailable';
    if (error.status === 429) return 'quota_exceeded';
    return 'unavailable';
  };
  const inspect = async (signal: AbortSignal): Promise<Pick<ModelKeyCheck, 'status' | 'reason'>> => {
    if (vertex) return { status: 'unavailable', reason: 'metadata_unsupported' };
    if (signal.aborted) return { status: 'unavailable', reason: 'timeout' };
    try {
      const model = await client.models.get({ model: config.model, config: { httpOptions, abortSignal: signal } });
      return !signal.aborted && (model.supportedActions === undefined || model.supportedActions.includes('generateContent'))
        ? { status: 'accessible' } : { status: 'unavailable', reason: signal.aborted ? 'timeout' : 'model_unavailable' };
    } catch (error) { return { status: 'unavailable', reason: reason(error, signal) }; }
  };
  return {
    agent: {
      async generate(request, signal) {
        if (signal.aborted) throw new ProviderFailure("unavailable");
        try {
          const response = await client.models.generateContent({ model: config.model, contents: request.contents,
            config: { ...request.config, httpOptions, candidateCount: 1,
              maxOutputTokens: Math.min(config.maxOutputTokens, AGENT_LIMITS.outputTokens),
              thinkingConfig, abortSignal: signal } });
          const candidate = response.candidates?.[0];
          // Preserve native parts and opaque signatures for the next ADK turn.
          return { content: response.candidates?.length === 1 ? candidate?.content : undefined,
            finishReason: candidate?.finishReason, usageMetadata: response.usageMetadata };
        } catch (error) {
          // The shared Agent gateway owns status-only diagnostics, metering and bounded retries.
          if (error instanceof ApiError) {
            const cause = reason(error, signal);
            if (cause === 'invalid_key') throw new AgentStopped('model_key_invalid');
            if (cause === 'region_unavailable') throw new AgentStopped('model_region_unavailable');
            if (cause === 'model_unavailable') throw new AgentStopped('model_not_available');
            throw error;
          }
          throw failure(error);
        }
      },
    },
    model: {
      async generate(input, options) {
        if (options.signal.aborted) throw new ProviderFailure("unavailable");
        try {
          const response = await client.models.generateContent({ model: config.model,
            contents: input.messages.map(message => ({ role: message.role, parts: [{ text: message.text }] })),
            config: { systemInstruction: input.systemInstruction, httpOptions,
              maxOutputTokens: Math.min(options.maxOutputTokens, config.maxOutputTokens, AGENT_LIMITS.outputTokens),
              candidateCount: 1, thinkingConfig, abortSignal: options.signal } });
          return readVertexReply(response);
        } catch (error) {
          if (error instanceof ProviderFailure) throw error;
          throw failure(error);
        }
      },
    },
    embedding: {
      async embed(input, signal) {
        if (signal.aborted) throw new EmbeddingFailure("cancelled");
        // Express mode has no documented embedding method. Never use platform ADC as a substitute.
        if (vertex) throw new EmbeddingFailure('unavailable');
        // Only trusted operator composition enables document embeddings. Personal
        // routing stays query-only; the gateway still checks authority and usage.
        const document = input.task === "RETRIEVAL_DOCUMENT" && options.documentEmbeddings === true;
        if (typeof input.text !== "string" || !input.text.trim()
          || (document ? typeof input.title !== "string" || !input.title.trim() || input.title.length > 600
            : input.task !== "RETRIEVAL_QUERY" || input.title !== undefined)) {
          throw new EmbeddingFailure("invalid_input");
        }
        // SDK 2.24.0 cannot disable Developer API truncation. Keep the existing
        // conservative byte bound, including the title, and never truncate locally.
        if (Buffer.byteLength(input.text, "utf8") + Buffer.byteLength(input.title ?? "", "utf8") > 2000) {
          throw new EmbeddingFailure("invalid_input");
        }
        try {
          const response = await client.models.embedContent({ model: KNOWLEDGE_EMBEDDING.model, contents: input.text,
            config: { httpOptions, taskType: input.task, ...(document ? { title: input.title } : {}),
              outputDimensionality: KNOWLEDGE_EMBEDDING.dimensions,
              abortSignal: signal } });
          return readKeyEmbedding(response);
        } catch (error) {
          if (signal.aborted) throw new EmbeddingFailure("cancelled");
          if (error instanceof EmbeddingFailure) throw error;
          if (error instanceof ApiError) throw personalProviderHttpError(error.status, error.message, 'embedding');
          throw new EmbeddingFailure("unavailable");
        }
      },
    },
    inspect,
    async check(signal) { return (await inspect(signal)).status === 'accessible'; },
    async catalog(version, refresh, signal) {
      const result: PersonalModelCatalog = { version, provider, models: personalModelCatalog(provider), scope: 'model_metadata_only',
        status: 'not_checked', truncated: false, embedding: { model: KNOWLEDGE_EMBEDDING.model, dimensions: KNOWLEDGE_EMBEDDING.dimensions,
          status: vertex ? 'unsupported' : 'not_checked' } };
      if (!refresh) return result;
      if (vertex) return { ...result, status: 'unavailable', reason: 'metadata_unsupported' };
      try {
        const pager = await client.models.list({ config: { pageSize: 100, queryBase: true, httpOptions, abortSignal: signal } });
        const listed = new Set<string>();
        for (let page = 0; page < 2; page++) {
          for (const model of pager.page) {
            const id = model.name?.replace(/^models\//, '');
            if (model.supportedActions?.includes('generateContent') && personalModelIdSchema.safeParse(id).success) listed.add(id!);
          }
          if (!pager.hasNextPage() || page === 1) break;
          await pager.nextPage();
        }
        if (signal.aborted) return { ...result, status: 'unavailable', reason: 'timeout' };
        return { ...result, status: 'checked', truncated: pager.hasNextPage() || listed.size > 20,
          models: [...listed].slice(0, 20).map(id => personalModelEntry(id, provider, 'listed')) };
      } catch (error) { return { ...result, status: 'unavailable', reason: reason(error, signal) }; }
    },
  };
}
