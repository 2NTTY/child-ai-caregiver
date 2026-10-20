import type { PlatformPolicy } from '../src/shared/admin.ts';
import type { EffectiveModelLimits, ModelSettings } from '../src/shared/model-settings.ts';

/** One resolver for settings display, interactive roles, media and background work. */
export function resolvePersonalModelLimits(settings: ModelSettings, policy: PlatformPolicy): EffectiveModelLimits {
  const cappedByAdministrator: string[] = [];
  const cap = (field: string, requested: number | undefined, maximum: number) => {
    if (requested !== undefined && requested > maximum) cappedByAdministrator.push(field);
    return Math.min(requested ?? maximum, maximum);
  };
  const personal = settings.mode === 'personal';
  return {
    policyVersion: policy.version,
    dailyLimit: personal ? settings.dailyLimit : policy.dailyUserAttempts,
    dailyGlobalLimit: personal ? policy.personalDailyGlobalAttempts : policy.dailyGlobalAttempts,
    maxModelCalls: personal && !settings.limitPolicyVersion ? settings.maxModelCalls : cap('maxModelCalls', personal ? settings.maxModelCalls : undefined, policy.maxModelCalls),
    maxQueryEmbeddings: personal && !settings.limitPolicyVersion ? settings.maxQueryEmbeddings : cap('maxQueryEmbeddings', personal ? settings.maxQueryEmbeddings : undefined, policy.maxQueryEmbeddings),
    maxToolCalls: cap('maxToolCalls', personal ? settings.maxToolCalls : undefined, policy.maxToolCalls),
    maxRunSeconds: cap('maxRunSeconds', personal ? settings.maxRunSeconds : undefined, policy.maxRunSeconds),
    modelRequestSeconds: cap('modelRequestSeconds', personal ? settings.modelRequestSeconds : undefined, policy.modelRequestSeconds),
    maxModelRetries: cap('maxModelRetries', personal ? settings.maxModelRetries : undefined, policy.maxModelRetries),
    cappedByAdministrator,
  };
}
