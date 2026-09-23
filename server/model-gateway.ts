import type { AiConfig } from "./ai-config.ts";
import type { AiUsageStore, AttemptOutcome, TokenUsage } from "./ai-usage.ts";

export interface ModelInput {
  systemInstruction: string;
  messages: { role: "user" | "model"; text: string }[];
}
export interface ModelReply { text: string; usage: TokenUsage }
export interface ModelProvider {
  generate(input: ModelInput, options: { signal: AbortSignal; maxOutputTokens: number }): Promise<ModelReply>;
}
export class ProviderFailure extends Error {
  readonly kind: "rate_limited" | "unavailable" | "invalid_response";
  constructor(kind: "rate_limited" | "unavailable" | "invalid_response") {
    super("Model provider failed");
    this.kind = kind;
  }
}
export class AiFailure extends Error {
  readonly code: "ai_disabled" | "ai_busy" | "ai_quota_exceeded" | "ai_timeout" | "ai_unavailable" | "invalid_input" | "unauthorized";
  constructor(code: AiFailure["code"]) {
    super(code);
    this.code = code;
  }
}
function validUsage(usage: TokenUsage): boolean {
  return usage !== null && typeof usage === "object"
    && [usage.inputTokens, usage.outputTokens, usage.cachedTokens].every(value => value === null || (Number.isSafeInteger(value) && value >= 0));
}

export function createModelGateway(options: {
  config: AiConfig;
  usage: Pick<AiUsageStore, "reserve" | "record">;
  provider?: ModelProvider;
}) {
  const activeUsers = new Set<string>();
  return {
    available: () => options.config.enabled && Boolean(options.provider),
    /** Input is assembled by server orchestration, never a raw browser prompt envelope. */
    async generate(userId: string, childId: string, input: ModelInput, authorize: () => Promise<boolean>): Promise<ModelReply> {
      const { config, provider, usage } = options;
      if (!await authorize()) throw new AiFailure("unauthorized");
      if (!config.enabled || !provider) throw new AiFailure("ai_disabled");
      const characters = input.systemInstruction.length + input.messages.reduce((sum, message) => sum + message.text.length, 0);
      if (!input.messages.length || input.messages.at(-1)?.role !== "user"
        || input.messages.some(message => !message.text.trim() || /[\u0000\uD800-\uDFFF]/u.test(message.text))
        || characters > config.maxInputCharacters) throw new AiFailure("invalid_input");
      if (activeUsers.has(userId) || activeUsers.size >= 4) throw new AiFailure("ai_busy");
      activeUsers.add(userId);
      try {
        for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
          if (!await authorize()) throw new AiFailure("unauthorized");
          if (!await usage.reserve(userId, config.dailyUserAttempts, config.dailyGlobalAttempts)) {
            throw new AiFailure("ai_quota_exceeded");
          }
          const started = Date.now();
          const controller = new AbortController();
          let timer: ReturnType<typeof setTimeout> | undefined;
          let outcome: AttemptOutcome = "unavailable";
          let tokens: TokenUsage = { inputTokens: null, outputTokens: null, cachedTokens: null };
          let retry = false;
          try {
            const reply = await Promise.race([
              provider.generate(input, { signal: controller.signal, maxOutputTokens: config.maxOutputTokens }),
              new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                  controller.abort();
                  reject(new AiFailure("ai_timeout"));
                }, config.timeoutMs);
              }),
            ]);
            if (typeof reply.text !== "string" || !reply.text.trim() || reply.text.length > 40000
              || /[\u0000\uD800-\uDFFF]/u.test(reply.text) || !validUsage(reply.usage)) {
              throw new ProviderFailure("invalid_response");
            }
            tokens = reply.usage;
            if (!await authorize()) throw new AiFailure("unauthorized");
            outcome = "succeeded";
            return reply;
          } catch (error) {
            if (error instanceof AiFailure) {
              outcome = error.code === "ai_timeout" ? "timeout" : "unauthorized";
              throw error;
            }
            if (error instanceof ProviderFailure && error.kind === "rate_limited") {
              outcome = "rate_limited";
              retry = attempt < config.maxAttempts;
            } else if (error instanceof ProviderFailure && error.kind === "invalid_response") outcome = "invalid_response";
            // Unknown outcomes and timeouts are never retried automatically.
            if (!retry) throw new AiFailure("ai_unavailable");
          } finally {
            if (timer) clearTimeout(timer);
            await usage.record({
              userId, childId, model: config.model, outcome, ...tokens,
              durationMs: Math.max(0, Date.now() - started),
            });
          }
          if (retry) await new Promise(resolve => setTimeout(resolve, 1000));
        }
        throw new AiFailure("ai_unavailable");
      } finally {
        activeUsers.delete(userId);
      }
    },
  };
}
export type ModelGateway = ReturnType<typeof createModelGateway>;