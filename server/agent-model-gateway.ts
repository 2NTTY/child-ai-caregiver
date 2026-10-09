import { BaseLlm } from "@google/adk";
import type { LlmRequest, LlmResponse } from "@google/adk";
import { ApiError, GoogleGenAI } from "@google/genai";
import type { FunctionCall } from "@google/genai";
import type { AiConfig } from "./ai-config.ts";
import { nativeModelThinkingLevel } from "./model-thinking.ts";
import type { AiUsageStore, AttemptOutcome, TokenUsage } from "./ai-usage.ts";
import { decodePhoto } from "./photo-files.ts";
import { AGENT_LIMITS, AGENT_TOOL_RESPONSE_RESERVE, AgentBudget, AgentStopped } from "./agent-budget.ts";
import { logVertexFailure } from "./vertex-diagnostics.ts";

export interface AgentModelProvider {
  generate(request: LlmRequest, signal: AbortSignal): Promise<LlmResponse>;
}

/** One logical request accounting path for both current and projected native requests. */
export function agentRequestCharacters(request: Pick<LlmRequest, "contents" | "config">): number {
  let images = 0;
  const contents = request.contents.map(content => ({ ...content, parts: content.parts?.map(part => {
    if (part.fileData) throw new AgentStopped("input_limit");
    if (!part.inlineData) return part;
    if (content.role !== "user" || ++images > 1) throw new AgentStopped("input_limit");
    try { decodePhoto(part.inlineData.data ?? "", part.inlineData.mimeType ?? ""); } catch { throw new AgentStopped("input_limit"); }
    return { ...part, inlineData: { ...part.inlineData, data: "[bounded image bytes]" } };
  }) }));
  return JSON.stringify({ contents, config: request.config }).length;
}

function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function readUsage(response: LlmResponse): TokenUsage {
  const inputTokens = tokenCount(response.usageMetadata?.promptTokenCount);
  const total = tokenCount(response.usageMetadata?.totalTokenCount);
  return { inputTokens, outputTokens: total !== null && inputTokens !== null && total >= inputTokens ? total - inputTokens : null,
    cachedTokens: tokenCount(response.usageMetadata?.cachedContentTokenCount) };
}

export function createVertexAgentProvider(config: AiConfig): AgentModelProvider {
  const thinkingLevel = nativeModelThinkingLevel(config.model, config.agentThinkingLevel);
  const client = new GoogleGenAI({ enterprise: true, project: config.project, location: config.location, apiVersion: "v1",
    httpOptions: { timeout: config.timeoutMs, retryOptions: { attempts: 1 } } });
  return {
    async generate(request, signal) {
      try {
        const response = await client.models.generateContent({ model: config.model, contents: request.contents,
          config: { ...request.config, candidateCount: 1, maxOutputTokens: Math.min(config.maxOutputTokens, AGENT_LIMITS.outputTokens),
            thinkingConfig: { thinkingLevel }, abortSignal: signal } });
        const candidate = response.candidates?.[0];
        // Preserve all native parts, including opaque signatures. Only presentation filters thoughts.
        return { content: response.candidates?.length === 1 ? candidate?.content : undefined,
          finishReason: candidate?.finishReason, usageMetadata: response.usageMetadata };
      } catch (error) {
        logVertexFailure(error, signal);
        throw error;
      }
    },
  };
}

/** The ADK model adapter shares the existing quota store, but never flattens protocol parts. */
export class AgentGatewayModel extends BaseLlm {
  failure?: AgentStopped;
  private readonly options: {
    config: AiConfig; provider: AgentModelProvider; usage: Pick<AiUsageStore, "reserve" | "record">;
    budget: AgentBudget; userId: string; childId: string; authorize: () => Promise<boolean>;
    terminalToolNames?: ReadonlySet<string>;
    projectCapabilityConfig?: (request: LlmRequest, calls: readonly FunctionCall[]) => Promise<LlmRequest["config"] | undefined>;
  };
  constructor(options: AgentGatewayModel["options"]) { super({ model: options.config.model }); this.options = options; }
  async connect(): Promise<never> { throw new AgentStopped("unavailable"); }
  async *generateContentAsync(request: LlmRequest): AsyncGenerator<LlmResponse, void> {
    try { yield* this.generateBounded(request); }
    catch (error) {
      this.failure = error instanceof AgentStopped ? error : new AgentStopped("unavailable");
      throw this.failure;
    }
  }
  private async *generateBounded(request: LlmRequest): AsyncGenerator<LlmResponse, void> {
    const { config, provider, usage, budget, userId, childId, authorize } = this.options;
    budget.check();
    if (!config.enabled) throw new AgentStopped("unavailable");
    if (!await budget.wait(authorize)) throw new AgentStopped("unauthorized");
    // Binary media has its own bounded allowance; all text, schemas and opaque protocol metadata remain counted.
    const requestCharacters = agentRequestCharacters(request);
    if (requestCharacters > budget.limits.inputCharacters) {
      throw new AgentStopped("input_limit");
    }
    budget.take("modelCalls");
    if (!await budget.wait(() => usage.reserve(userId, config.dailyUserAttempts, config.dailyGlobalAttempts))) {
      throw new AgentStopped("quota_exceeded");
    }
    const start = Date.now();
    let outcome: AttemptOutcome = "unavailable";
    let tokens: TokenUsage = { inputTokens: null, outputTokens: null, cachedTokens: null };
    let response: LlmResponse;
    try {
      response = await budget.wait(() => provider.generate(request, budget.signal));
      tokens = readUsage(response);
      if (response.errorCode || response.interrupted || response.partial || response.finishReason !== "STOP"
        || response.content?.role !== "model" || !response.content.parts?.length) throw new AgentStopped("invalid_response");
      if (!await budget.wait(authorize)) throw new AgentStopped("unauthorized");
      const calls = response.content.parts.filter(part => part.functionCall);
      if (calls.length) budget.take("toolCalls", calls.length);
      if (calls.some(part => !part.functionCall?.name || !Object.hasOwn(request.toolsDict, part.functionCall.name))) {
        throw new AgentStopped("invalid_tool");
      }
      // Reject the complete batch before ADK can execute even its first handler.
      if (calls.length > 1 && calls.some(part => this.options.terminalToolNames?.has(part.functionCall!.name!))) {
        throw new AgentStopped("invalid_response");
      }
      const modelContentCharacters = JSON.stringify(response.content).length;
      const projected = this.options.projectCapabilityConfig && calls.length
        ? await budget.wait(() => this.options.projectCapabilityConfig!(request, calls.map(part => part.functionCall!))) : undefined;
      const futureCharacters = projected ? agentRequestCharacters({ contents: request.contents, config: projected }) : requestCharacters;
      const capabilityGrowthCharacters = Math.max(0, futureCharacters - requestCharacters);
      if (capabilityGrowthCharacters > 0
        && futureCharacters + modelContentCharacters + AGENT_TOOL_RESPONSE_RESERVE > budget.limits.inputCharacters) throw new AgentStopped("input_limit");
      budget.prepareToolResponseBudget(requestCharacters, modelContentCharacters, capabilityGrowthCharacters);
      outcome = "succeeded";
    } catch (error) {
      if (error instanceof AgentStopped) {
        outcome = error.reason === "unauthorized" ? "unauthorized"
          : error.reason === "deadline" || error.reason === "cancelled" ? "timeout"
          : error.reason === "invalid_response" ? "invalid_response" : "unavailable";
        throw error;
      }
      outcome = error instanceof ApiError && error.status === 429 ? "rate_limited" : "unavailable";
      throw new AgentStopped("unavailable");
    } finally {
      await usage.record({ userId, childId, model: config.model, outcome, ...tokens, durationMs: Math.max(0, Date.now() - start) });
    }
    budget.check();
    yield response;
  }
}
