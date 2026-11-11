import {
  TokenBasedContextCompactor,
  LlmSummarizer,
  isCompactedEvent,
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
 * 5. Deferral when ADK's timestamp boundary would hide retained raw events
 */
export function createRunContextCompactor(options: ContextCompactorOptions): BaseContextCompactor {
  const tokenThreshold = options.tokenThreshold ?? DEFAULT_IN_RUN_COMPACTION_TOKEN_THRESHOLD;
  const eventRetentionSize = options.eventRetentionSize ?? DEFAULT_IN_RUN_COMPACTION_EVENT_RETENTION;
  if (!Number.isSafeInteger(tokenThreshold) || tokenThreshold < 1
    || !Number.isSafeInteger(eventRetentionSize) || eventRetentionSize < 1) {
    throw new Error("Invalid context compaction limits");
  }

  const managedModel = createManagedCompactionModel(options.model, options.budget, options.signal);
  const summarizer = new LlmSummarizer({
    llm: managedModel,
    prompt: DEFAULT_COMPACTION_PROMPT
  });

  const baseCompactor = new TokenBasedContextCompactor({
    tokenThreshold,
    eventRetentionSize,
    summarizer
  });

  return {
    shouldCompact(context: InvocationContext) {
      return baseCompactor.shouldCompact(context);
    },

    async compact(context: InvocationContext): Promise<void> {
      try {
        // A global summary is visible to every sub-agent. Installing it in a
        // mixed session would also replace each sibling's own active window.
        if (context.isolationScope === undefined && context.session.events.some(event => event.isolationScope !== undefined)) return;
        options.signal?.throwIfAborted();
        // Let ADK choose its exact raw-event/tool-pair boundary. Keep the guard
        // local to this invocation so concurrent scopes never share context.
        const guarded = new TokenBasedContextCompactor({ tokenThreshold, eventRetentionSize,
          summarizer: { async summarize(eventsToCompact: Event[]) {
            const last = eventsToCompact.at(-1);
            const events = context.session.events;
            const index = last ? events.indexOf(last) : -1;
            if (!last || index < 0 || !Number.isFinite(last.timestamp) || events.slice(index + 1).some(event =>
              !isCompactedEvent(event)
              && (event.isolationScope === undefined || event.isolationScope === context.isolationScope)
              && event.timestamp <= last.timestamp)) {
              throw new Error("Compaction deferred until retained events have a separate timestamp boundary");
            }
            return summarizer.summarize(eventsToCompact);
          } }
        });
        await guarded.compact(context);
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
