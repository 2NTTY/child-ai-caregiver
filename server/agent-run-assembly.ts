import type { AiConfig } from './ai-config.ts';
import { AgentStopped, agentBudgetFingerprint, freezeAgentRunLimits, type AgentRunLimits } from './agent-budget.ts';
import type { DurableRootBudget } from './durable-root-budget.ts';
import type { DurableAiUsage } from './durable-ai-usage.ts';
import type { AgentModelProvider } from './agent-model-gateway.ts';
import type { AgentDurableRunBinder, NativeAgentSessionService } from './agent-runtime.ts';
import type { EmbeddingProvider } from './embedding-gateway.ts';
import { workContinuationJobSchema } from './agent-work-continuation-core.ts';

/** Fixed server profile only. This is not a durable acceptance snapshot or personal routing. */
export interface ProductAgentDurableProfile {
  config: Readonly<AiConfig>;
  workflowVersion: string;
  promptPackVersion: string;
  settingsVersion: string;
  billingVersion: string;
  billingSource: "platform" | "personal";
  /** Optional fixed Server-selected counts; omitted profiles retain the production defaults. */
  runLimits?: AgentRunLimits;
}
export interface ClaimedRunPersistence {
  nativeSessionService: NativeAgentSessionService;
  rootBudget: DurableRootBudget;
  dailyUsage: DurableAiUsage;
  profile: ProductAgentDurableProfile;
  /** Trusted constructor seams; never request-selected. */
  provider?: AgentModelProvider;
  embeddingProvider?: EmbeddingProvider;
}

export function claimedRunAssembly(config: AiConfig, persistence: ClaimedRunPersistence, routing: unknown, allowWorkContinuation = false, allowPersonal = false, allowProductEntrypoints = false) {
  const { nativeSessionService, rootBudget, dailyUsage, provider, embeddingProvider } = persistence;
  const profile = persistence.profile ? Object.freeze({ ...persistence.profile, config: Object.freeze({ ...persistence.profile.config }),
    ...(persistence.profile.runLimits === undefined ? {} : { runLimits: freezeAgentRunLimits(persistence.profile.runLimits) }) }) : undefined;
  const version = (value: unknown): value is string => typeof value === "string" && value.length > 0
    && value.length <= 128 && value === value.trim() && value.isWellFormed();
  if (routing || !profile || !profile.config.enabled || (!allowPersonal && profile.billingSource !== "platform")
    || !["platform", "personal"].includes(profile.billingSource) || dailyUsage?.billingSource !== profile.billingSource
    || ![profile.workflowVersion, profile.promptPackVersion, profile.settingsVersion, profile.billingVersion].every(version)
    || agentBudgetFingerprint(config) !== agentBudgetFingerprint(profile.config)
    || !nativeSessionService || !rootBudget || !dailyUsage) throw new Error("Invalid claimed run persistence assembly");
  const fingerprint = agentBudgetFingerprint(profile.config);
  const bindDurableRun: AgentDurableRunBinder = (input, packVersion, limits) => {
    const claim = input.claimedRun, expiry = Date.parse(claim?.expiresAt ?? "");
    const interactive = input.recipeId === "product-interactive" && input.trigger.kind === "interactive" && claim?.sourceMessageId === input.trigger.reference;
    const continuation = (allowWorkContinuation || allowProductEntrypoints) && input.recipeId === "product-work-followup" && input.trigger.kind === "worker"
      && claim?.sourceMessageId === null && workContinuationJobSchema.shape.workerGeneration.safeParse(claim.workerGeneration).success;
    const background = allowProductEntrypoints && input.recipeId === "product-background" && input.trigger.kind === "worker"
      && claim?.purpose === "background" && claim.sourceMessageId === null
      && workContinuationJobSchema.shape.workerGeneration.safeParse(claim.workerGeneration).success;
    const capture = allowProductEntrypoints && input.trigger.kind === "interactive" && claim?.sourceMessageId === null
      && ((input.recipeId === "photo-capture" && claim.purpose === "photo-extraction" && claim.sourceResource?.kind === "photo")
        || (input.recipeId === "shared-capture" && claim.purpose === "shared-extraction" && claim.sourceResource?.kind === "shared-input"))
      && claim.sourceResource?.id === input.trigger.reference && Number.isSafeInteger(claim.sourceResource.version) && claim.sourceResource.version > 0;
    if (!claim || claim.created !== true || claim.state !== "running" || !(interactive || continuation || background || capture)
      || claim.recipeId !== input.recipeId || claim.trigger?.kind !== input.trigger.kind
      || claim.trigger.reference !== input.trigger.reference
      || claim.runId !== input.runId || agentBudgetFingerprint(claim.scope) !== agentBudgetFingerprint(input.scope)
      || !version(claim.storageEpoch) || !claim.scope.dataVersion.startsWith(claim.storageEpoch + ":")
      || !/^\d+$/u.test(claim.scope.dataVersion.slice(claim.storageEpoch.length + 1))
      || !Number.isSafeInteger(expiry) || expiry <= Date.now() || expiry !== input.deadlineAtMs
      || packVersion !== profile.promptPackVersion || dailyUsage.billingSource !== profile.billingSource) throw new AgentStopped("unavailable");
    return { adapter: rootBudget, dailyUsage, context: { generation: 1, binding: {
      rootRunId: claim.runId, ownerId: claim.scope.userId, workspaceId: claim.scope.workspaceId, childId: claim.scope.childId,
      authorizationVersion: claim.scope.authorizationVersion, storageEpoch: claim.storageEpoch,
      trigger: { ...claim.trigger }, workflowVersion: profile.workflowVersion + ((continuation || background) ? ":worker:" + claim.workerGeneration : capture ? ":capture:" + claim.sourceResource!.kind + ":" + claim.sourceResource!.id + ":" + claim.sourceResource!.version : ""), promptPackVersion: packVersion,
      settingsVersion: profile.settingsVersion + ":" + fingerprint, billingVersion: profile.billingVersion,
      limits: { modelCalls: limits.modelCalls, toolCalls: limits.toolCalls, queryEmbeddings: limits.queryEmbeddings }, deadlineAtMs: expiry,
    } } };
  };
  return { config: profile.config, runLimits: profile.runLimits, nativeSessionService, bindDurableRun, provider, embeddingProvider };
}

