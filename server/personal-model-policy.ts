import type { PlatformPolicy } from '../src/shared/admin.ts';
import type { EffectiveModelLimits, ModelSettings } from '../src/shared/model-settings.ts';

/** One resolver for settings display, interactive roles, media and background work. */
export function resolvePersonalModelLimits(settings: ModelSettings, policy: PlatformPolicy): EffectiveModelLimits {
  if (settings.mode === 'personal') {
    return {
      policyVersion: policy.version,
      dailyLimit: settings.dailyLimit,
      dailyGlobalLimit: policy.personalDailyGlobalAttempts,
      maxModelCalls: settings.maxModelCalls,
      maxQueryEmbeddings: settings.maxQueryEmbeddings,
      maxToolCalls: settings.maxToolCalls ?? policy.maxToolCalls,
      maxRunSeconds: settings.maxRunSeconds ?? policy.maxRunSeconds,
      modelRequestSeconds: settings.modelRequestSeconds ?? policy.modelRequestSeconds,
      maxModelRetries: settings.maxModelRetries ?? policy.maxModelRetries,
      cappedByAdministrator: [],
    };
  }
  return {
    policyVersion: policy.version,
    dailyLimit: policy.dailyUserAttempts,
    dailyGlobalLimit: policy.dailyGlobalAttempts,
    maxModelCalls: policy.maxModelCalls,
    maxQueryEmbeddings: policy.maxQueryEmbeddings,
    maxToolCalls: policy.maxToolCalls,
    maxRunSeconds: policy.maxRunSeconds,
    modelRequestSeconds: policy.modelRequestSeconds,
    maxModelRetries: policy.maxModelRetries,
    cappedByAdministrator: [],
  };
}
