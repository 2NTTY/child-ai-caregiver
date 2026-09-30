import { z } from "zod";
import {
  PERSONAL_DAILY_LIMIT, PERSONAL_MODEL, PERSONAL_RUN_LIMITS,
  type ModelKeyCheck, type ModelSettings, type ModelSettingsCommand, type ModelSettingsView,
} from "../shared/model-settings.ts";

const count = z.number().int().nonnegative();
const settingsSchema = z.object({
  version: count, mode: z.enum(["platform", "personal", "disabled"]),
  provider: z.literal("gemini"), model: z.literal(PERSONAL_MODEL),
  keyConfigured: z.boolean(), backgroundEnabled: z.boolean(),
  dailyLimit: z.number().int().min(PERSONAL_DAILY_LIMIT.min).max(PERSONAL_DAILY_LIMIT.max),
  maxModelCalls: z.number().int().min(PERSONAL_RUN_LIMITS.modelCalls.min).max(PERSONAL_RUN_LIMITS.modelCalls.max),
  maxQueryEmbeddings: z.number().int().min(PERSONAL_RUN_LIMITS.queryEmbeddings.min).max(PERSONAL_RUN_LIMITS.queryEmbeddings.max),
  updatedAt: z.string().datetime().nullable(),
}).strict();
const usageSchema = z.object({
  billingSource: z.enum(["platform", "personal"]).optional(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u), attempts: count, inputTokens: count,
  outputTokens: count, cachedTokens: count, unknownUsageAttempts: count,
}).strict();
const viewSchema = z.object({
  settings: settingsSchema, enabled: z.boolean(), platformAvailable: z.boolean(), personalAvailable: z.boolean(),
  personalGlobalLimit: count, usage: z.object({ platform: usageSchema, personal: usageSchema }).strict(),
}).strict();
const checkSchema = z.object({
  version: count, status: z.enum(["accessible", "unavailable"]), scope: z.literal("model_metadata_only"),
}).strict();
const errorCodeSchema = z.enum(["invalid_input", "version_conflict", "key_required", "consent_required", "unavailable"]);
type ErrorCode = z.infer<typeof errorCodeSchema>;

export class ModelSettingsApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | null;
  readonly unknownResult: boolean;
  constructor(status = 0, code: ErrorCode | null = null, unknownResult = status === 0) {
    super("Model settings request could not be confirmed");
    this.name = "ModelSettingsApiError";
    this.status = status; this.code = code; this.unknownResult = unknownResult;
  }
}

export interface ModelSettingsApi {
  read(signal: AbortSignal, userId: string): Promise<ModelSettingsView>;
  save(command: ModelSettingsCommand, signal: AbortSignal, userId: string): Promise<ModelSettings>;
  check(expectedVersion: number, signal: AbortSignal, userId: string): Promise<ModelKeyCheck>;
}

export function createModelSettingsApi(baseUrl = "", fetcher: typeof fetch = fetch): ModelSettingsApi {
  const base = baseUrl.replace(/\/$/u, "");
  const apiUrl = base.endsWith("/api") ? base : `${base}/api`;

  async function request(path: string, body: string | undefined, signal: AbortSignal, userId: string): Promise<unknown> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const timeout = setTimeout(abort, 20_000);
    try {
      if (controller.signal.aborted) throw new ModelSettingsApiError();
      const response = await fetcher(`${apiUrl}/ai/settings${path}`, {
        method: body === undefined ? "GET" : "POST", body,
        credentials: "include", cache: "no-store", signal: controller.signal,
        headers: { Accept: "application/json", "x-expected-user-id": userId,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      });
      if (controller.signal.aborted) throw new ModelSettingsApiError();
      if (!response.ok) {
        let code: ErrorCode | null = null;
        try {
          const value = await response.json() as { error?: { code?: unknown } };
          const parsed = errorCodeSchema.safeParse(value?.error?.code);
          if (parsed.success) code = parsed.data;
        } catch { /* Never retain response text or provider errors. */ }
        if (controller.signal.aborted) throw new ModelSettingsApiError();
        throw new ModelSettingsApiError(response.status, code, body !== undefined && response.status >= 500);
      }
      const value = await response.json() as unknown;
      if (controller.signal.aborted) throw new ModelSettingsApiError();
      return value;
    } catch (error) {
      if (error instanceof ModelSettingsApiError) throw error;
      throw new ModelSettingsApiError();
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }

  return {
    async read(signal, userId) {
      const parsed = viewSchema.safeParse(await request("", undefined, signal, userId));
      if (!parsed.success) throw new ModelSettingsApiError();
      return parsed.data;
    },
    save(command, signal, userId) {
      const expectedVersion = command.expectedVersion;
      // Serialize only this direct request; do not retain commands or use the online operation ledger.
      const body = JSON.stringify({
        expectedVersion, mode: command.mode, backgroundEnabled: command.backgroundEnabled,
        dailyLimit: command.dailyLimit, maxModelCalls: command.maxModelCalls,
        maxQueryEmbeddings: command.maxQueryEmbeddings, consent: command.consent,
        ...(command.apiKey === undefined ? {} : { apiKey: command.apiKey }),
        ...(command.removeKey === undefined ? {} : { removeKey: command.removeKey }),
      });
      return request("", body, signal, userId).then(value => {
        const parsed = settingsSchema.safeParse(value);
        if (!parsed.success || parsed.data.version <= expectedVersion) throw new ModelSettingsApiError();
        return parsed.data;
      });
    },
    async check(expectedVersion, signal, userId) {
      const parsed = checkSchema.safeParse(await request("/check", JSON.stringify({ expectedVersion }), signal, userId));
      if (!parsed.success || parsed.data.version !== expectedVersion) throw new ModelSettingsApiError();
      return parsed.data;
    },
  };
}
