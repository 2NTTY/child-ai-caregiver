import { AGENT_RUN_LIMITS } from './agent-run-limits.ts';

export type ModelBillingSource = "platform" | "personal";
export type ModelMode = ModelBillingSource | "disabled";
export type PersonalModelProvider = "gemini" | "vertex" | "openai-compatible";
export const PERSONAL_MODEL = "gemini-3.1-flash-lite";
export const MODEL_SETTINGS_MEDIA_TYPE = 'application/vnd.yuyoufang.model-settings.v3+json';
export const PERSONAL_DAILY_LIMIT = { default: 100, min: 1, max: 1000 } as const;
export const PERSONAL_RUN_LIMITS = {
  modelCalls: { ...AGENT_RUN_LIMITS.modelCalls, default: 4 },
  queryEmbeddings: { ...AGENT_RUN_LIMITS.queryEmbeddings, default: 2 },
  toolCalls: AGENT_RUN_LIMITS.toolCalls,
  deadlineSeconds: AGENT_RUN_LIMITS.deadlineSeconds,
  modelRequestSeconds: AGENT_RUN_LIMITS.modelRequestSeconds,
  modelRetries: AGENT_RUN_LIMITS.modelRetries,
} as const;

/** Absent values inherit the current administrator policy, including legacy settings. */
export interface PersonalAdvancedLimits {
  maxToolCalls?: number;
  maxRunSeconds?: number;
  modelRequestSeconds?: number;
  maxModelRetries?: number;
}

/** Secret-free account settings; never return the key, its hash or a decryptable envelope. */
export interface ModelSettings extends PersonalAdvancedLimits {
  limitPolicyVersion?: 2;
  version: number;
  mode: ModelMode;
  provider: PersonalModelProvider;
  model: string;
  baseUrl?: string;
  embeddingKeyConfigured?: boolean;
  keyConfigured: boolean;
  backgroundEnabled: boolean;
  dailyLimit: number;
  maxModelCalls: number;
  maxQueryEmbeddings: number;
  updatedAt: string | null;
}
export interface ModelSettingsCommand extends PersonalAdvancedLimits {
  /** New clients use a secret-free operation lookup after a lost response. */
  opId?: string;
  expectedVersion: number;
  mode: ModelMode;
  apiKey?: string;
  baseUrl?: string;
  embeddingApiKey?: string;
  removeEmbeddingKey?: boolean;
  removeKey?: boolean;
  backgroundEnabled: boolean;
  dailyLimit: number;
  maxModelCalls: number;
  maxQueryEmbeddings: number;
  consent: boolean;
  provider?: PersonalModelProvider;
  model?: string;
}
export interface ModelSettingsOperation { opId: string; settings: ModelSettings }
export interface EffectiveModelLimits {
  policyVersion: number;
  dailyLimit: number;
  dailyGlobalLimit: number;
  maxModelCalls: number;
  maxQueryEmbeddings: number;
  maxToolCalls: number;
  maxRunSeconds: number;
  modelRequestSeconds: number;
  maxModelRetries: number;
  cappedByAdministrator: string[];
}
export interface ModelSettingsUsage {
  billingSource?: ModelBillingSource;
  day: string; attempts: number; inputTokens: number; outputTokens: number;
  cachedTokens: number; unknownUsageAttempts: number;
}
export interface ModelSettingsView {
  settings: ModelSettings;
  enabled: boolean;
  platformAvailable: boolean;
  personalAvailable: boolean;
  personalGlobalLimit: number;
  agentInputCharacters?: number;
  effective?: EffectiveModelLimits;
  usage: { platform: ModelSettingsUsage; personal: ModelSettingsUsage };
}
export interface ModelKeyCheck {
  version: number;
  status: "accessible" | "unavailable";
  /** A metadata lookup cannot prove generation, embedding, billing or remaining provider quota. */
  scope: "model_metadata_only";
  reason?: "invalid_key" | "region_unavailable" | "model_unavailable" | "quota_exceeded" | "timeout" | "unavailable" | "metadata_unsupported";
}

export interface PersonalModelCatalogEntry {
  id: string;
  provider: PersonalModelProvider;
  label: string;
  /** Positive capability hints; false means unconfirmed, not a prohibition on selecting the model. */
  capabilities: { tools: boolean; image: boolean; audio: boolean; textStreaming: boolean };
  availability: "not_checked" | "listed";
}
export interface PersonalModelCatalog {
  version: number;
  provider: PersonalModelProvider;
  models: PersonalModelCatalogEntry[];
  scope: "model_metadata_only";
  status: "not_checked" | "checked" | "unavailable";
  reason?: ModelKeyCheck["reason"];
  truncated: boolean;
  embedding: { model: string; dimensions: number; status: "not_checked" | "unsupported" };
}
