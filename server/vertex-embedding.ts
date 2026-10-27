import { ApiError, GoogleGenAI } from "@google/genai";
import type { EmbedContentResponse } from "@google/genai";
import { KNOWLEDGE_EMBEDDING } from "../src/shared/knowledge.ts";
import type { AiConfig } from "./ai-config.ts";
import { EmbeddingFailure } from "./embedding-gateway.ts";
import type { EmbeddingProvider, EmbeddingReply } from "./embedding-gateway.ts";
import { personalProviderHttpError } from './personal-provider-error.ts';

function readCount(value: unknown): number | null {
  if (value === undefined) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new EmbeddingFailure("invalid_response");
  }
  return value;
}

export function readVertexEmbedding(response: EmbedContentResponse): EmbeddingReply {
  const embedding = response.embeddings?.[0];
  const values = embedding?.values;
  if (response.embeddings?.length !== 1 || !embedding || !Array.isArray(values)
    || values.length !== KNOWLEDGE_EMBEDDING.dimensions
    || values.some(value => typeof value !== "number" || !Number.isFinite(value))
    || values.every(value => value === 0)
    || embedding.statistics?.truncated !== false) {
    throw new EmbeddingFailure("invalid_response");
  }
  const inputTokens = readCount(embedding.statistics?.tokenCount);
  if (inputTokens !== null && inputTokens > 2048) throw new EmbeddingFailure("invalid_response");
  return {
    values,
    inputTokens,
    billableCharacters: readCount(response.metadata?.billableCharacterCount),
  };
}

export function createVertexEmbeddingProvider(config: AiConfig, credential?: { apiKey: string; documentEmbeddings?: boolean }): EmbeddingProvider {
  const client = new GoogleGenAI({
    enterprise: true, project: config.project, location: config.location, apiVersion: "v1",
    ...(credential ? { apiKey: credential.apiKey } : {}),
    httpOptions: { timeout: config.timeoutMs, retryOptions: { attempts: 1 },
      ...(credential ? { baseUrl: config.location === 'global' ? 'https://aiplatform.googleapis.com'
        : config.location === 'us' || config.location === 'eu' ? `https://aiplatform.${config.location}.rep.googleapis.com`
        : `https://${config.location}-aiplatform.googleapis.com` } : {}) },
  });
  return {
    async embed(input, signal) {
      if (signal.aborted) throw new EmbeddingFailure("cancelled");
      if (credential && (typeof input.text !== 'string' || !input.text.trim()
        || input.task === 'RETRIEVAL_DOCUMENT' && (!credential.documentEmbeddings || !input.title?.trim())
        || input.task === 'RETRIEVAL_QUERY' && input.title !== undefined)) throw new EmbeddingFailure('invalid_input');
      try {
        const response = await client.models.embedContent({
          model: KNOWLEDGE_EMBEDDING.model,
          contents: input.text,
          config: {
            taskType: input.task,
            ...(input.task === "RETRIEVAL_DOCUMENT" ? { title: input.title } : {}),
            outputDimensionality: KNOWLEDGE_EMBEDDING.dimensions,
            autoTruncate: false,
            abortSignal: signal,
          },
        });
        return readVertexEmbedding(response);
      } catch (error) {
        if (signal.aborted) throw new EmbeddingFailure("cancelled");
        if (error instanceof EmbeddingFailure) throw error;
        if (credential && error instanceof ApiError) throw personalProviderHttpError(error.status, error.message, 'embedding');
        throw new EmbeddingFailure(error instanceof ApiError && error.status === 400 ? "invalid_input" : "unavailable");
      }
    },
  };
}
