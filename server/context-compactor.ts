import {
  TokenBasedContextCompactor,
  LlmSummarizer,
  type BaseContextCompactor,
  type InvocationContext,
  type Event,
  type BaseLlm,
  type LlmRequest,
  type LlmResponse
} from "@google/adk";
import { AgentStopped } from "./agent-budget.ts";
import { AgentGatewayModel } from "./agent-model-gateway.ts";

/**
 * Engineering baseline suggestion for in-run context compaction token threshold.
 * Under REQ-005 §4.2, serves as an engineering starting threshold pending centralized policy approval.
 */
export const DEFAULT_IN_RUN_COMPACTION_TOKEN_THRESHOLD = 16000;

/**
 * Engineering baseline default for number of active uncompacted events retained in sliding window.
 */
export const DEFAULT_IN_RUN_COMPACTION_EVENT_RETENTION = 4;

export interface InRunCompactionConfig {
  /** Prompt token threshold that triggers in-run compaction (default: 16000) */
  tokenThreshold?: number;
  /** Number of raw events to retain uncompacted (default: 4) */
  eventRetentionSize?: number;
  /** Custom summarization prompt */
  prompt?: string;
}

export const DEFAULT_COMPACTION_PROMPT =
  "Please summarize the interactions concisely, focusing on key facts, tool execution results, and pending questions or tasks. Do not extrapolate, infer unmentioned facts, or claim user consent.";

export interface ContextCompactorOptions extends InRunCompactionConfig {
  model: BaseLlm;
  budget?: { admitModel: () => Promise<void>; counts?: { modelCalls: number } };
  signal?: AbortSignal;
}

/**
 * Wraps the given LLM model with runtime budget admission and cancellation checks.
 * Charges budget.admitModel() before model call generation and verifies signal abortion.
 */
export function createManagedCompactionModel(
  baseModel: BaseLlm,
  budget?: { admitModel: () => Promise<void> },
  signal?: AbortSignal
): BaseLlm {
  const isGatewayModel = baseModel instanceof AgentGatewayModel;
  return new Proxy(baseModel, {
    get(target, prop, receiver) {
      if (prop === "generateContentAsync") {
        return async function* (request: LlmRequest, stream: boolean = false): AsyncGenerator<LlmResponse, void, unknown> {
          signal?.throwIfAborted();
          if (!isGatewayModel && budget && typeof budget.admitModel === "function") {
            await budget.admitModel();
          }
          const generator = target.generateContentAsync(request, stream);
          for await (const chunk of generator) {
            signal?.throwIfAborted();
            yield chunk;
          }
        };
      }
      return Reflect.get(target, prop, receiver);
    }
  });
}

/**
 * Creates an in-run context compactor integrating Google ADK 2.1.0 TokenBasedContextCompactor
 * and LlmSummarizer, enforcing:
 * 1. Transient in-run compaction only (never touches Firestore persistent memory)
 * 2. Tool-call / response atomicity (FunctionCall and FunctionResponse pairs retained together)
 * 3. Gateway budget accounting and cancellation signal enforcement
 * 4. Anti-extrapolation and anti-consent prompt invariants
 * 5. Monotonic timestamp ordering ensuring ADK does not drop retained events
 */
export function createRunContextCompactor(options: ContextCompactorOptions): BaseContextCompactor {
  const tokenThreshold = options.tokenThreshold ?? DEFAULT_IN_RUN_COMPACTION_TOKEN_THRESHOLD;
  const eventRetentionSize = options.eventRetentionSize ?? DEFAULT_IN_RUN_COMPACTION_EVENT_RETENTION;
  const prompt = options.prompt ?? DEFAULT_COMPACTION_PROMPT;

  const managedModel = createManagedCompactionModel(options.model, options.budget, options.signal);
  const summarizer = new LlmSummarizer({
    llm: managedModel,
    prompt
  });

  const baseCompactor = new TokenBasedContextCompactor({
    tokenThreshold,
    eventRetentionSize,
    summarizer
  });

  return {
    shouldCompact(context: InvocationContext): boolean {
      if (baseCompactor.shouldCompact(context)) {
        return true;
      }
      // Fallback for test/mock sessions where usageMetadata may not be populated
      const events = context.session?.events ?? [];
      const rawEvents = events.filter((e: any) => !(e.author === "system" && e.content?.role === "model" && typeof e.endTime === "number"));
      if (rawEvents.length <= eventRetentionSize) return false;
      const chars = rawEvents.reduce((acc, ev) => acc + JSON.stringify(ev.content ?? {}).length, 0);
      const estimatedTokens = Math.ceil(chars / 4);
      return estimatedTokens > tokenThreshold;
    },

    async compact(context: InvocationContext): Promise<void> {
      try {
        await baseCompactor.compact(context);

        // Monotonic timestamp protection (REQ-005 §4.2):
        // In high-frequency runs, retained events might share the same millisecond timestamp as the compacted event.
        // ADK's getActiveEvents filters events with (event.timestamp > latestCompactedEvent.endTime).
        // Ensure that every retained event following the compacted event has a strictly increasing timestamp > endTime.
        const events = context.session?.events ?? [];
        const compacted = events.filter((e: any) => e.author === "system" && e.content?.role === "model" && typeof e.endTime === "number");
        if (compacted.length > 0) {
          const latestCompacted = compacted[compacted.length - 1] as any;
          const endTime = latestCompacted.endTime;
          const compactedIdx = events.indexOf(latestCompacted);
          let curTime = endTime;
          for (let i = 0; i < events.length; i++) {
            if (i === compactedIdx) continue;
            const ev = events[i];
            if (ev.timestamp && ev.timestamp <= endTime && i > compactedIdx) {
              curTime++;
              ev.timestamp = curTime;
            }
          }
        }
      } catch (err: any) {
        if (
          err?.name === "AbortError" ||
          err instanceof AgentStopped ||
          err?.message?.includes("aborted") ||
          options.signal?.aborted
        ) {
          throw err;
        }
        // Non-abort error: graceful fallback, keep original events without failing run
      }
    }
  };
}
