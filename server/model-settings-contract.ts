import type { ModelSettings, ModelSettingsCommand, ModelSettingsOperation } from "../src/shared/model-settings.ts";

export class ModelSettingsError extends Error {
  readonly code: "invalid_input" | "version_conflict" | "operation_conflict" | "key_required" | "consent_required" | "model_unsupported" | "client_update_required" | "unavailable";
  readonly status: number;
  constructor(code: ModelSettingsError["code"], status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
export interface ModelSettingsStore {
  get(userId: string): Promise<ModelSettings>;
  save(userId: string, command: ModelSettingsCommand): Promise<ModelSettings>;
  /** Server-only; never use this result in a response, prompt, job, receipt or log. */
  resolve(userId: string): Promise<{ settings: ModelSettings; apiKey: string | null }>;
  isCurrent(userId: string, version: number): Promise<boolean>;
  getOperation?(userId: string, opId: string): Promise<ModelSettingsOperation | null>;
}
