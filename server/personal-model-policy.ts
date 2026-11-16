import type { PlatformPolicy } from '../src/shared/admin.ts';
import type { EffectiveModelLimits, ModelSettings, PolicyLimitSource } from '../src/shared/model-settings.ts';
import { DEFAULT_SOFT_BUDGET_RATIO, clampSoftBudgetRatio, deriveSoftBudgetTargets, resolveRoleSoftBudgetRatio, type AgentSoftBudgetProfileRole } from '../src/shared/agent-run-limits.ts';

/** One resolver for settings display, interactive roles, media and background work. */
export function resolvePersonalModelLimits(
  settings: ModelSettings,
  policy: PlatformPolicy,
  options?: { role?: AgentSoftBudgetProfileRole; applyAdminRoleOverride?: boolean },
): EffectiveModelLimits {
  const rawPersonalSoftRatio = settings.mode === 'personal' && settings.softBudgetRatio !== undefined
    ? settings.softBudgetRatio
    : undefined;
  const resolvedRole = options?.role ?? 'interactive';
  const profileOverrides = policy.roleSoftBudgetRatios as Partial<Record<AgentSoftBudgetProfileRole, number>> | undefined;
  const adminRoleOverride = options?.applyAdminRoleOverride ? profileOverrides?.[resolvedRole] : undefined;
  const softBudgetRatio = rawPersonalSoftRatio !== undefined
    ? clampSoftBudgetRatio(rawPersonalSoftRatio)
    : options?.applyAdminRoleOverride
      ? resolveRoleSoftBudgetRatio({
          role: resolvedRole,
          policyRatio: policy.softBudgetRatio,
          profileOverrides,
        })
      : clampSoftBudgetRatio(policy.softBudgetRatio ?? DEFAULT_SOFT_BUDGET_RATIO);
  const softBudgetSource: PolicyLimitSource =
    rawPersonalSoftRatio !== undefined
      ? 'personal'
      : adminRoleOverride !== undefined || policy.softBudgetRatio !== undefined
        ? 'administrator'
        : 'system_default';
  if (settings.mode === 'personal') {
    const maxToolCalls = settings.maxToolCalls ?? policy.maxToolCalls;
    const maxRunSeconds = settings.maxRunSeconds ?? policy.maxRunSeconds;
    const modelRequestSeconds = settings.modelRequestSeconds ?? policy.modelRequestSeconds;
    const maxModelRetries = settings.maxModelRetries ?? policy.maxModelRetries;
    const targets = deriveSoftBudgetTargets({
      modelCalls: settings.maxModelCalls,
      toolCalls: maxToolCalls,
      queryEmbeddings: settings.maxQueryEmbeddings,
    }, softBudgetRatio);
    return {
      policyVersion: policy.version,
      dailyLimit: settings.dailyLimit,
      dailyGlobalLimit: policy.personalDailyGlobalAttempts,
      maxModelCalls: settings.maxModelCalls,
      maxQueryEmbeddings: settings.maxQueryEmbeddings,
      maxToolCalls,
      maxRunSeconds,
      modelRequestSeconds,
      maxModelRetries,
      cappedByAdministrator: [],
      softBudgetRatio: targets.softBudgetRatio,
      softTargets: {
        modelCalls: targets.modelCalls,
        toolCalls: targets.toolCalls,
        queryEmbeddings: targets.queryEmbeddings,
      },
      limitSources: {
        dailyLimit: 'personal',
        maxModelCalls: 'personal',
        maxQueryEmbeddings: 'personal',
        maxToolCalls: settings.maxToolCalls !== undefined ? 'personal' : 'administrator',
        maxRunSeconds: settings.maxRunSeconds !== undefined ? 'personal' : 'administrator',
        modelRequestSeconds: settings.modelRequestSeconds !== undefined ? 'personal' : 'administrator',
        maxModelRetries: settings.maxModelRetries !== undefined ? 'personal' : 'administrator',
        softBudgetRatio: softBudgetSource,
      },
    };
  }
  const targets = deriveSoftBudgetTargets({
    modelCalls: policy.maxModelCalls,
    toolCalls: policy.maxToolCalls,
    queryEmbeddings: policy.maxQueryEmbeddings,
  }, softBudgetRatio);
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
    softBudgetRatio: targets.softBudgetRatio,
    softTargets: {
      modelCalls: targets.modelCalls,
      toolCalls: targets.toolCalls,
      queryEmbeddings: targets.queryEmbeddings,
    },
    limitSources: {
      dailyLimit: 'administrator',
      maxModelCalls: 'administrator',
      maxQueryEmbeddings: 'administrator',
      maxToolCalls: 'administrator',
      maxRunSeconds: 'administrator',
      modelRequestSeconds: 'administrator',
      maxModelRetries: 'administrator',
      softBudgetRatio: softBudgetSource,
    },
  };
}
