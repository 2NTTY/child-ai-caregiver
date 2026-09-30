import type { Pool, PoolClient } from "pg";
import { PERSONAL_DAILY_LIMIT, PERSONAL_MODEL, PERSONAL_RUN_LIMITS } from "../src/shared/model-settings.ts";
import type { ModelMode, ModelSettings, ModelSettingsCommand } from "../src/shared/model-settings.ts";
import { ModelSettingsError } from "./model-settings-contract.ts";
import type { ModelSettingsStore } from "./model-settings-contract.ts";
import type { StorageCipher } from "./storage-crypto.ts";

const fields = new Set(["expectedVersion", "mode", "apiKey", "removeKey", "backgroundEnabled", "dailyLimit", "maxModelCalls", "maxQueryEmbeddings", "consent"]);
const requiredFields = ["expectedVersion", "mode", "backgroundEnabled", "dailyLimit", "maxModelCalls", "maxQueryEmbeddings", "consent"];
const validKey = (value: unknown): value is string => typeof value === "string" && value.length >= 20 && value.length <= 512 && !/[^\x21-\x7e]/u.test(value);
const unavailable = () => new ModelSettingsError("unavailable", 503);

export function parseModelSettingsCommand(input: unknown): ModelSettingsCommand {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new ModelSettingsError("invalid_input");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(input).some(key => typeof key !== "string" || !fields.has(key))
    || requiredFields.some(key => !Object.hasOwn(descriptors, key))
    || Object.values(descriptors).some(descriptor => !Object.hasOwn(descriptor, "value"))) throw new ModelSettingsError("invalid_input");
  const value = input as Record<string, unknown>;
  if (!Number.isSafeInteger(value.expectedVersion) || (value.expectedVersion as number) < 0 || (value.expectedVersion as number) >= 2147483647
    || !["platform", "personal", "disabled"].includes(value.mode as string)
    || typeof value.backgroundEnabled !== "boolean" || typeof value.consent !== "boolean"
    || !Number.isSafeInteger(value.dailyLimit) || (value.dailyLimit as number) < PERSONAL_DAILY_LIMIT.min || (value.dailyLimit as number) > PERSONAL_DAILY_LIMIT.max
    || !Number.isSafeInteger(value.maxModelCalls) || (value.maxModelCalls as number) < PERSONAL_RUN_LIMITS.modelCalls.min || (value.maxModelCalls as number) > PERSONAL_RUN_LIMITS.modelCalls.max
    || !Number.isSafeInteger(value.maxQueryEmbeddings) || (value.maxQueryEmbeddings as number) < PERSONAL_RUN_LIMITS.queryEmbeddings.min || (value.maxQueryEmbeddings as number) > PERSONAL_RUN_LIMITS.queryEmbeddings.max
    || (Object.hasOwn(value, "apiKey") && !validKey(value.apiKey))
    || (Object.hasOwn(value, "removeKey") && typeof value.removeKey !== "boolean")
    || (value.removeKey === true && (value.mode !== "disabled" || Object.hasOwn(value, "apiKey")))) throw new ModelSettingsError("invalid_input");
  if (value.mode === "personal" && !value.consent) throw new ModelSettingsError("consent_required");
  return {
    expectedVersion: value.expectedVersion as number, mode: value.mode as ModelMode,
    backgroundEnabled: value.mode === "personal" && value.backgroundEnabled, dailyLimit: value.dailyLimit as number, consent: value.consent,
    maxModelCalls: value.maxModelCalls as number, maxQueryEmbeddings: value.maxQueryEmbeddings as number,
    ...(Object.hasOwn(value, "apiKey") ? { apiKey: value.apiKey as string } : {}),
    ...(Object.hasOwn(value, "removeKey") ? { removeKey: value.removeKey as boolean } : {}),
  };
}

interface SettingsRow {
  version: number;
  mode: ModelMode;
  background_enabled: boolean;
  personal_daily_limit: number;
  max_model_calls: number;
  max_query_embeddings: number;
  updated_at: Date;
  key_configured?: boolean;
  api_key_encrypted?: string | null;
}
const safeColumns = "version, mode, background_enabled, personal_daily_limit, max_model_calls, max_query_embeddings, updated_at, api_key_encrypted IS NOT NULL AS key_configured";
const secretColumns = "version, mode, background_enabled, personal_daily_limit, max_model_calls, max_query_embeddings, updated_at, api_key_encrypted";
const context = (userId: string, version: number) => "model_settings:" + JSON.stringify([userId, version]) + ":api_key";
function settings(row?: SettingsRow): ModelSettings {
  return row ? {
    version: row.version, mode: row.mode, provider: "gemini", model: PERSONAL_MODEL,
    keyConfigured: row.key_configured ?? row.api_key_encrypted != null,
    backgroundEnabled: row.background_enabled, dailyLimit: row.personal_daily_limit, maxModelCalls: row.max_model_calls, maxQueryEmbeddings: row.max_query_embeddings, updatedAt: row.updated_at.toISOString(),
  } : {
    version: 0, mode: "platform", provider: "gemini", model: PERSONAL_MODEL, keyConfigured: false,
    backgroundEnabled: false, dailyLimit: PERSONAL_DAILY_LIMIT.default,
    maxModelCalls: PERSONAL_RUN_LIMITS.modelCalls.default, maxQueryEmbeddings: PERSONAL_RUN_LIMITS.queryEmbeddings.default, updatedAt: null,
  };
}

export function createModelSettingsStore(pool: Pool, cipher: StorageCipher): ModelSettingsStore {
  function decrypt(userId: string, row?: SettingsRow): string | null {
    if (!row?.api_key_encrypted) return null;
    const key = cipher.decrypt(row.api_key_encrypted, context(userId, row.version));
    if (!validKey(key)) throw unavailable();
    return key;
  }
  return {
    async get(userId) {
      try {
        const row = (await pool.query<SettingsRow>("SELECT " + safeColumns + " FROM model_settings WHERE user_id=$1", [userId])).rows[0];
        return settings(row);
      } catch { throw unavailable(); }
    },
    async save(userId, input) {
      const command = parseModelSettingsCommand(input);
      let client: PoolClient | undefined;
      let failed = false;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        // Lock the account as well as the settings row so two first writes cannot both observe version zero.
        const account = await client.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [userId]);
        if (!account.rows[0]) throw unavailable();
        const row = (await client.query<SettingsRow>("SELECT " + secretColumns + " FROM model_settings WHERE user_id=$1 FOR UPDATE", [userId])).rows[0];
        if ((row?.version ?? 0) !== command.expectedVersion) throw new ModelSettingsError("version_conflict", 409);
        const key = command.removeKey ? null : command.apiKey ?? decrypt(userId, row);
        if (command.mode === "personal" && !key) throw new ModelSettingsError("key_required");
        const version = command.expectedVersion + 1;
        const encryptedKey = key === null ? null : cipher.encrypt(key, context(userId, version));
        const values = [userId, version, command.mode, command.backgroundEnabled, command.dailyLimit, encryptedKey, command.maxModelCalls, command.maxQueryEmbeddings];
        const result = row
          ? await client.query<SettingsRow>("UPDATE model_settings SET version=$2, mode=$3, background_enabled=$4, personal_daily_limit=$5, api_key_encrypted=$6, max_model_calls=$7, max_query_embeddings=$8, updated_at=now() WHERE user_id=$1 AND version=$9 RETURNING " + safeColumns, [...values, command.expectedVersion])
          : await client.query<SettingsRow>("INSERT INTO model_settings (user_id,version,mode,background_enabled,personal_daily_limit,api_key_encrypted,max_model_calls,max_query_embeddings) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING " + safeColumns, values);
        if (!result.rows[0]) throw new ModelSettingsError("version_conflict", 409);
        const resultSettings = settings(result.rows[0]);
        await client.query("COMMIT");
        return resultSettings;
      } catch (error) {
        failed = !(error instanceof ModelSettingsError && error.code !== "unavailable");
        if (client) {
          try { await client.query("ROLLBACK"); } catch { failed = true; }
        }
        if (error instanceof ModelSettingsError && error.code !== "unavailable") throw error;
        throw unavailable();
      } finally {
        client?.release(failed);
      }
    },
    async resolve(userId) {
      try {
        const row = (await pool.query<SettingsRow>("SELECT " + secretColumns + " FROM model_settings WHERE user_id=$1", [userId])).rows[0];
        return { settings: settings(row), apiKey: decrypt(userId, row) };
      } catch { throw unavailable(); }
    },
    async isCurrent(userId, version) {
      try {
        const row = (await pool.query<{ version: number }>("SELECT version FROM model_settings WHERE user_id=$1", [userId])).rows[0];
        return (row?.version ?? 0) === version;
      } catch { throw unavailable(); }
    },
  };
}
