import type { OperationState } from "./view-model.ts";

// Frontend projection of ce87370 src/shared/model-settings.ts and docs/API.md.
export type ModelMode = "platform" | "personal" | "disabled";
export const personalLimits = {
  daily: { min: 1, max: 1000, default: 100 },
  modelCalls: { min: 1, max: 12, default: 4 },
  queryEmbeddings: { min: 1, max: 6, default: 2 },
} as const;
export interface ModelSettings {
  version: number; mode: ModelMode; provider: "gemini"; model: string;
  keyConfigured: boolean; backgroundEnabled: boolean;
  dailyLimit: number; maxModelCalls: number; maxQueryEmbeddings: number;
  updatedAt: string | null;
}
export interface ModelSettingsUsage {
  billingSource?: "platform" | "personal"; day: string; attempts: number;
  inputTokens: number; outputTokens: number; cachedTokens: number; unknownUsageAttempts: number;
}
export interface ModelSettingsSnapshot {
  settings: ModelSettings; enabled: boolean; platformAvailable: boolean; personalAvailable: boolean;
  personalGlobalLimit: number; usage: { platform: ModelSettingsUsage; personal: ModelSettingsUsage };
  agentInputCharacters?: number;
}
export interface ModelSettingsCommand {
  expectedVersion: number; mode: ModelMode; apiKey?: string; removeKey?: boolean;
  backgroundEnabled: boolean; dailyLimit: number; maxModelCalls: number; maxQueryEmbeddings: number; consent: boolean;
}
export interface ModelKeyCheck { version: number; status: "accessible" | "unavailable"; scope: "model_metadata_only" }
export interface ModelSettingsViewModel {
  scopeKey: string; accountName: string; serverLabel: string;
  snapshot: ModelSettingsSnapshot | null; online: boolean; authorized: boolean;
  busy: "read" | "save" | "check" | null; operation: OperationState; notice: string;
  needsRead: boolean; formRevision: number; secretRevision: number;
  keyCheck: ModelKeyCheck | null;
}
export interface ModelSettingsActions {
  refresh(): void;
  save(command: ModelSettingsCommand): void;
  check(expectedVersion: number): void;
}
