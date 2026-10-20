import { z } from "zod";
import {
  MODEL_SETTINGS_MEDIA_TYPE,
  type ModelKeyCheck, type ModelSettings, type ModelSettingsCommand, type ModelSettingsView, type ModelSettingsOperation, type PersonalModelCatalog,
} from "../shared/model-settings.ts";
import { publicModelSettingsSchema as settingsSchema, effectiveModelLimitsSchema, modelCheckReasonSchema,
  modelSettingsOperationSchema, personalModelCatalogSchema } from '../shared/model-settings-schema.ts';

const count = z.number().int().nonnegative();
const usageSchema = z.object({
  billingSource: z.enum(["platform", "personal"]).optional(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u), attempts: count, inputTokens: count,
  outputTokens: count, cachedTokens: count, unknownUsageAttempts: count,
}).strict();
const viewSchema = z.object({
  settings: settingsSchema, enabled: z.boolean(), platformAvailable: z.boolean(), personalAvailable: z.boolean(),
  personalGlobalLimit: count, usage: z.object({ platform: usageSchema, personal: usageSchema }).strict(),
  agentInputCharacters: z.number().int().min(32000).max(64000).optional(),
  effective: effectiveModelLimitsSchema.optional(),
}).strict();
const checkSchema = z.object({
  version: count, status: z.enum(["accessible", "unavailable"]), scope: z.literal("model_metadata_only"),
  reason: modelCheckReasonSchema.optional(),
}).strict();
const errorCodeSchema = z.enum(["invalid_input", "version_conflict", "operation_conflict", "key_required", "consent_required", "model_unsupported", "client_update_required", "unavailable"]);
type ErrorCode = z.infer<typeof errorCodeSchema>;

export class ModelSettingsApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | null;
  readonly unknownResult: boolean;
  readonly operationId: string | null;
  constructor(status = 0, code: ErrorCode | null = null, unknownResult = status === 0, operationId: string | null = null) {
    super("Model settings request could not be confirmed");
    this.name = "ModelSettingsApiError";
    this.status = status; this.code = code; this.unknownResult = unknownResult;
    this.operationId = operationId;
  }
}

export interface ModelSettingsApi {
  read(signal: AbortSignal, userId: string): Promise<ModelSettingsView>;
  save(command: ModelSettingsCommand, signal: AbortSignal, userId: string): Promise<ModelSettings>;
  check(expectedVersion: number, signal: AbortSignal, userId: string): Promise<ModelKeyCheck>;
  operation(opId: string, signal: AbortSignal, userId: string): Promise<ModelSettingsOperation | null>;
  catalog(expectedVersion: number, refresh: boolean, signal: AbortSignal, userId: string): Promise<PersonalModelCatalog>;
}

/** A missing receipt is not proof that the original request cannot still commit. */
export async function readModelSettingsRecovery(api: ModelSettingsApi, original: { opId: string; expectedVersion: number },
  signal: AbortSignal, userId: string) {
  const receipt = await api.operation(original.opId, signal, userId);
  const snapshot = await api.read(signal, userId);
  const outcome = receipt ? "confirmed" : snapshot.settings.version > original.expectedVersion ? "superseded" : "unknown";
  return { snapshot, outcome } as const;
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
        headers: { Accept: MODEL_SETTINGS_MEDIA_TYPE, "x-expected-user-id": userId,
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
      const expectedVersion = command.expectedVersion, opId = command.opId ?? crypto.randomUUID();
      // Serialize only this direct request; do not retain commands or use the online operation ledger.
      const body = JSON.stringify({
        opId, expectedVersion, mode: command.mode, backgroundEnabled: command.backgroundEnabled,
        dailyLimit: command.dailyLimit, maxModelCalls: command.maxModelCalls,
        maxQueryEmbeddings: command.maxQueryEmbeddings, consent: command.consent,
        ...(command.apiKey === undefined ? {} : { apiKey: command.apiKey }),
        ...(command.removeKey === undefined ? {} : { removeKey: command.removeKey }),
        ...Object.fromEntries((['provider', 'model', 'maxToolCalls', 'maxRunSeconds', 'modelRequestSeconds', 'maxModelRetries'] as const)
          .filter(key => command[key] !== undefined).map(key => [key, command[key]])),
      });
      return request("", body, signal, userId).then(value => {
        const parsed = settingsSchema.safeParse(value);
        if (!parsed.success || parsed.data.version <= expectedVersion) throw new ModelSettingsApiError();
        return parsed.data;
      }).catch(error => {
        const failure = error instanceof ModelSettingsApiError ? error : new ModelSettingsApiError();
        throw new ModelSettingsApiError(failure.status, failure.code, failure.unknownResult, opId);
      });
    },
    async operation(opId, signal, userId) {
      if (!z.uuid().safeParse(opId).success) throw new ModelSettingsApiError(400, 'invalid_input', false);
      const parsed = modelSettingsOperationSchema.nullable().safeParse(await request('/operations/' + encodeURIComponent(opId), undefined, signal, userId));
      if (!parsed.success || parsed.data && parsed.data.opId !== opId) throw new ModelSettingsApiError();
      return parsed.data;
    },
    async catalog(expectedVersion, refresh, signal, userId) {
      const parsed = personalModelCatalogSchema.safeParse(await request('/models', refresh ? JSON.stringify({ expectedVersion }) : undefined, signal, userId));
      if (!parsed.success || parsed.data.version !== expectedVersion) throw new ModelSettingsApiError();
      return parsed.data;
    },
    async check(expectedVersion, signal, userId) {
      const parsed = checkSchema.safeParse(await request("/check", JSON.stringify({ expectedVersion }), signal, userId));
      if (!parsed.success || parsed.data.version !== expectedVersion) throw new ModelSettingsApiError();
      return parsed.data;
    },
  };
}
