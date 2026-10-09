import { ApiError, GoogleGenAI } from "@google/genai";
import type { EmbedContentResponse } from "@google/genai";
import { KNOWLEDGE_EMBEDDING } from "../src/shared/knowledge.ts";
import type { AiConfig } from "./ai-config.ts";
import { nativeModelThinkingLevel } from "./model-thinking.ts";
import { AGENT_LIMITS } from "./agent-budget.ts";
import type { AgentModelProvider } from "./agent-model-gateway.ts";
import { EmbeddingFailure } from "./embedding-gateway.ts";
import type { EmbeddingProvider, EmbeddingReply } from "./embedding-gateway.ts";
import { ProviderFailure } from "./model-gateway.ts";
import type { ModelProvider } from "./model-gateway.ts";
import { readVertexReply } from "./vertex-provider.ts";

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

export function createGeminiKeyProviders(config: AiConfig, apiKey: string): {
  agent: AgentModelProvider;
  model: ModelProvider;
  embedding: EmbeddingProvider;
  check: (signal: AbortSignal) => Promise<boolean>;
} {
  if (typeof apiKey !== "string" || !apiKey.trim()) throw new ProviderFailure("unavailable");
  const thinkingLevel = nativeModelThinkingLevel(config.model);
  const httpOptions = { baseUrl: "https://generativelanguage.googleapis.com", apiVersion: "v1beta",
    timeout: config.timeoutMs, retryOptions: { attempts: 1 } };
  let client: GoogleGenAI;
  try {
    client = new GoogleGenAI({ enterprise: false, apiKey, apiVersion: "v1beta", httpOptions });
  } catch {
    throw new ProviderFailure("unavailable");
  }
  const failure = (error: unknown) => new ProviderFailure(
    error instanceof ApiError && error.status === 429 ? "rate_limited" : "unavailable");
  return {
    agent: {
      async generate(request, signal) {
        if (signal.aborted) throw new ProviderFailure("unavailable");
        try {
          const response = await client.models.generateContent({ model: config.model, contents: request.contents,
            config: { ...request.config, httpOptions, candidateCount: 1,
              maxOutputTokens: Math.min(config.maxOutputTokens, AGENT_LIMITS.outputTokens),
              thinkingConfig: { thinkingLevel }, abortSignal: signal } });
          const candidate = response.candidates?.[0];
          // Preserve native parts and opaque signatures for the next ADK turn.
          return { content: response.candidates?.length === 1 ? candidate?.content : undefined,
            finishReason: candidate?.finishReason, usageMetadata: response.usageMetadata };
        } catch (error) {
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
              candidateCount: 1, thinkingConfig: { thinkingLevel }, abortSignal: options.signal } });
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
        if (input.task !== "RETRIEVAL_QUERY" || typeof input.text !== "string" || !input.text.trim()
          || Buffer.byteLength(input.text, "utf8") > 2000 || input.title !== undefined) {
          throw new EmbeddingFailure("invalid_input");
        }
        try {
          const response = await client.models.embedContent({ model: KNOWLEDGE_EMBEDDING.model, contents: input.text,
            config: { httpOptions, taskType: "RETRIEVAL_QUERY", outputDimensionality: KNOWLEDGE_EMBEDDING.dimensions,
              abortSignal: signal } });
          return readKeyEmbedding(response);
        } catch (error) {
          if (signal.aborted) throw new EmbeddingFailure("cancelled");
          if (error instanceof EmbeddingFailure) throw error;
          throw new EmbeddingFailure(error instanceof ApiError && error.status === 400 ? "invalid_input" : "unavailable");
        }
      },
    },
    async check(signal) {
      if (signal.aborted) return false;
      try {
        const model = await client.models.get({ model: config.model, config: { httpOptions, abortSignal: signal } });
        return !signal.aborted && (model.supportedActions === undefined
          || (Array.isArray(model.supportedActions) && model.supportedActions.includes("generateContent")));
      } catch {
        return false;
      }
    },
  };
}
