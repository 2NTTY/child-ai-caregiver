import { ApiError, GoogleGenAI } from "@google/genai";
import type { GenerateContentResponse } from "@google/genai";
import type { AiConfig } from "./ai-config.ts";
import { nativeModelThinkingLevel } from "./model-thinking.ts";
import { ProviderFailure } from "./model-gateway.ts";
import type { ModelProvider } from "./model-gateway.ts";
import { logVertexFailure } from "./vertex-diagnostics.ts";

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
export function readVertexReply(response: GenerateContentResponse) {
  const candidate = response.candidates?.[0];
  const parts = candidate?.content?.parts?.filter(part => !part.thought);
  if (response.candidates?.length !== 1 || candidate?.finishReason !== "STOP" || !parts?.length
    || parts.some(part => typeof part.text !== "string" || part.functionCall || part.inlineData || part.executableCode)) {
    throw new ProviderFailure("invalid_response");
  }
  const text = parts.map(part => part.text).join("");
  if (!text.trim()) throw new ProviderFailure("invalid_response");
  const usage = response.usageMetadata;
  const inputTokens = count(usage?.promptTokenCount);
  const total = count(usage?.totalTokenCount);
  return { text, usage: {
    inputTokens,
    // Includes thinking tokens when the provider reports an aggregate total.
    outputTokens: total !== null && inputTokens !== null && total >= inputTokens ? total - inputTokens : null,
    cachedTokens: count(usage?.cachedContentTokenCount),
  } };
}
export function createVertexProvider(config: AiConfig): ModelProvider {
  const thinkingLevel = nativeModelThinkingLevel(config.model);
  const client = new GoogleGenAI({
    enterprise: true, project: config.project, location: config.location, apiVersion: "v1",
    httpOptions: { timeout: config.timeoutMs, retryOptions: { attempts: 1 } },
  });
  return {
    async generate(input, options) {
      try {
        const response = await client.models.generateContent({
          model: config.model,
          contents: input.messages.map(message => ({ role: message.role, parts: [{ text: message.text }] })),
          config: {
            systemInstruction: input.systemInstruction,
            maxOutputTokens: options.maxOutputTokens,
            candidateCount: 1,
            thinkingConfig: { thinkingLevel },
            abortSignal: options.signal,
          },
        });
        return readVertexReply(response);
      } catch (error) {
        if (error instanceof ProviderFailure) throw error;
        logVertexFailure(error, options.signal);
        throw new ProviderFailure(error instanceof ApiError && error.status === 429 ? "rate_limited" : "unavailable");
      }
    },
  };
}
