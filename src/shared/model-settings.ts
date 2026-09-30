export type ModelBillingSource = "platform" | "personal";
export type ModelMode = ModelBillingSource | "disabled";
export const PERSONAL_MODEL = "gemini-3.1-flash-lite";
export const PERSONAL_DAILY_LIMIT = { default: 100, min: 1, max: 1000 } as const;
export const PERSONAL_RUN_LIMITS = {
  modelCalls: { default: 4, min: 1, max: 12 },
  queryEmbeddings: { default: 2, min: 1, max: 6 },
} as const;

/** Secret-free account settings; never return the key, its hash or a decryptable envelope. */
export interface ModelSettings {
  version: number;
  mode: ModelMode;
  provider: "gemini";
  model: string;
  keyConfigured: boolean;
  backgroundEnabled: boolean;
  dailyLimit: number;
  maxModelCalls: number;
  maxQueryEmbeddings: number;
  updatedAt: string | null;
}
export interface ModelSettingsCommand {
  expectedVersion: number;
  mode: ModelMode;
  apiKey?: string;
  removeKey?: boolean;
  backgroundEnabled: boolean;
  dailyLimit: number;
  maxModelCalls: number;
  maxQueryEmbeddings: number;
  consent: boolean;
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
  usage: { platform: ModelSettingsUsage; personal: ModelSettingsUsage };
}
export interface ModelKeyCheck {
  version: number;
  status: "accessible" | "unavailable";
  /** A metadata lookup cannot prove generation, embedding, billing or remaining provider quota. */
  scope: "model_metadata_only";
}
