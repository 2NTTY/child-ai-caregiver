import type { OperationState } from "./view-model.ts";
import { PERSONAL_DAILY_LIMIT, PERSONAL_RUN_LIMITS } from "../../src/shared/model-settings.ts";
import type { ModelSettingsView, ModelKeyCheck, PersonalModelCatalog, ModelSettingsCommand } from "../../src/shared/model-settings.ts";
export type { ModelMode, ModelSettings, ModelSettingsUsage, ModelSettingsCommand, ModelKeyCheck } from "../../src/shared/model-settings.ts";

// Shared contract and legal ranges; the server remains the authority for effective limits.
export const personalLimits = { daily: PERSONAL_DAILY_LIMIT, ...PERSONAL_RUN_LIMITS };
export type ModelSettingsSnapshot = ModelSettingsView;
export interface ModelSettingsViewModel {
  scopeKey: string; accountName: string; serverLabel: string;
  snapshot: ModelSettingsSnapshot | null; online: boolean; authorized: boolean;
  busy: "read" | "save" | "check" | "catalog" | null; operation: OperationState; notice: string;
  needsRead: boolean; formRevision: number; secretRevision: number;
  keyCheck: ModelKeyCheck | null;
  catalog?: PersonalModelCatalog | null;
  originalOperationId?: string | null;
}
export interface ModelSettingsActions {
  refresh(): void;
  save(command: ModelSettingsCommand): void;
  check(expectedVersion: number): void;
  refreshCatalog?(expectedVersion: number): void;
}
