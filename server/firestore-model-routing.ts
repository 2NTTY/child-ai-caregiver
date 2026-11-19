import { monthlyFinance } from './monthly-finance.ts';
import { createFirestoreAdmin } from './firestore-admin.ts';
import type { DayFinancialEvidence } from './ai-financial-evidence.ts';
import { AGENT_HIGH_WATERMARK_DEFAULTS } from '../src/shared/agent-run-limits.ts';
import { z } from 'zod';
import type { AiConfig } from './ai-config.ts';
import type { PlatformPolicy } from '../src/shared/admin.ts';
import type { ModelSettings } from '../src/shared/model-settings.ts';
import { AGENT_INTERACTIVE_INPUT, AgentStopped } from './agent-budget.ts';
import { type ModelKeyCheck, type ModelSettingsView, type PersonalModelCatalog, type PersonalModelProvider } from '../src/shared/model-settings.ts';
import { KNOWLEDGE_EMBEDDING } from '../src/shared/knowledge.ts';
import { personalModelCatalog } from './personal-model-catalog.ts';
import { resolvePersonalModelLimits } from './personal-model-policy.ts';
import { createFirestoreModelSettings } from './firestore-model-settings.ts';
import { FirestoreAiUsage } from './firestore-ai-usage.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { domainReject, FirestoreDomainData, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { createVertexAgentProvider } from './agent-model-gateway.ts';
import { createVertexEmbeddingProvider } from './vertex-embedding.ts';
import { createVertexProvider } from './vertex-provider.ts';
import { createPersonalModelProviders } from './personal-model-providers.ts';
import { createEmbeddingGateway } from './embedding-gateway.ts';
import { ModelSettingsError } from './model-settings-contract.ts';

const checksSchema = z.object({ attempts: z.array(z.object({ userId: z.string(), at: z.number().int().nonnegative() }).strict()).max(4) }).strict();
export const firestoreModelChecksRecoverySchema = checksSchema;
const checkScope = { ownerUserId: 'system:model-key-check', workspaceId: '00000000-0000-0000-0000-000000000000',
  childId: '00000000-0000-0000-0000-000000000000', storageEpoch: '00000000-0000-0000-0000-000000000000' };
/** Firestore production must never fall back to process-local or SQL quota accounting. */
export const requireDurableUsage = Object.freeze({ async reserve(): Promise<never> { throw new AgentStopped('unavailable'); },
  async record(): Promise<never> { throw new AgentStopped('unavailable'); } });

export type PlatformProviderFactory = (config: AiConfig) => Pick<ReturnType<typeof createPersonalModelProviders>, 'agent' | 'model' | 'embedding'>;

export function createFirestoreModelRouting(options: FirestoreDomainOptions & {
  usageFinancialEvidence?: () => DayFinancialEvidence[] | undefined;
}, config: AiConfig, platformProviders?: PlatformProviderFactory,
personalProviders: (...args: Parameters<typeof createPersonalModelProviders>) => ReturnType<PlatformProviderFactory> = createPersonalModelProviders) {
  const settings = createFirestoreModelSettings(options), authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options);
  const usage = { platform: new FirestoreAiUsage({ ...options, namespace: options.namespace + '_ai_usage', billingSource: 'platform' }),
    personal: new FirestoreAiUsage({ ...options, namespace: options.namespace + '_ai_usage', billingSource: 'personal' }) };
  const policy = createFirestoreAdmin(options, config);
  const allowed = (userId: string) => authority.runTransaction(userId, null, async () => true);
  function profileFor(state: ModelSettings, current: PlatformPolicy, trigger: 'interactive' | 'worker') {
    const personal = state.mode === 'personal', limits = resolvePersonalModelLimits(state, current);
    const enabled = config.enabled && state.mode !== 'disabled' && (personal
      ? state.keyConfigured && (trigger !== 'worker' || state.backgroundEnabled) : current.enabled && Boolean(config.project));
    const selectedConfig: AiConfig = { ...config, enabled, model: config.localModelOverride ?? current.model,
      timeoutMs: limits.modelRequestSeconds * 1000, agentMaxRetries: limits.maxModelRetries,
      dailyUserAttempts: limits.dailyLimit, dailyGlobalAttempts: limits.dailyGlobalLimit,
      ...(personal ? { maxAttempts: 1, model: state.model } : {}) };
    const billingSource = personal ? 'personal' as const : 'platform' as const;
    return { personal, enabled, limits, selectedConfig, billingSource, settingsVersion: state.version + ':policy:' + current.version,
      runLimits: { modelCalls: limits.maxModelCalls, queryEmbeddings: limits.maxQueryEmbeddings, toolCalls: limits.maxToolCalls,
        deadlineMs: limits.maxRunSeconds * 1000, softBudgetRatio: limits.softBudgetRatio } };
  }
  async function reserveMetadataCheck(userId: string) {
    await authority.runTransaction(userId, null, async b => {
      const ref = data.ref('model_key_checks', 'model-key-checks', 'active'), row = await b.transaction.get(ref), now = Date.now();
      const attempts = (row.exists ? data.open('model-key-checks', 'active', checkScope, checksSchema, row).attempts : [])
        .filter(value => now - value.at < 60_000);
      if (attempts.length >= 4 || attempts.some(value => value.userId === userId)) throw new ModelSettingsError('unavailable', 429);
      attempts.push({ userId, at: now }); b.transaction.set(ref, data.seal('model-key-checks', 'active', checkScope, checksSchema, { attempts }));
    });
  }
  return {
    settings, budgetAlerts: policy.budgetAlerts, usage,
    async readWorkerProfileIn(b: FirestoreAuthorityTransaction) {
      const state = await settings.readIn({ transaction: b.transaction,
        scope: { ...b.scope, childId: '00000000-0000-0000-0000-000000000000' } });
      return profileFor(state, await policy.readPolicyIn(b.transaction), 'worker');
    },
    async readInteractiveRunSeconds(tx: import("@google-cloud/firestore").Transaction, scope: FirestoreAuthorityTransaction['scope']) {
      const current = await policy.readPolicyIn(tx);
      const state = await settings.readIn({ transaction: tx, scope: { ...scope, childId: '00000000-0000-0000-0000-000000000000' } });
      return resolvePersonalModelLimits(state, current).maxRunSeconds;
    },
    async view(userId: string, includePersonalFinance = false): Promise<ModelSettingsView> {
      const state = await settings.get(userId), current = await policy.readPolicy();
      return { settings: state, enabled: config.enabled, platformAvailable: config.enabled && current.enabled && Boolean(config.project),
        personalAvailable: config.enabled, personalGlobalLimit: current.personalDailyGlobalAttempts, agentInputCharacters: config.agentMaxInputCharacters ?? AGENT_INTERACTIVE_INPUT.default,
        effective: resolvePersonalModelLimits(state, current, { role: 'interactive', applyAdminRoleOverride: true }),
        usage: { platform: await usage.platform.getForUser(userId),
          personal: await usage.personal.getForUser(userId, includePersonalFinance ? options.usageFinancialEvidence?.() ?? [] : undefined) } };
    },
    async monthUsage(userId: string) {
      const today = new Date().toISOString().slice(0, 10);
      await allowed(userId);
      const evidence = options.usageFinancialEvidence?.() ?? [];
      const report = await monthlyFinance(today.slice(0, 7), today, day => usage.personal.getForUser(userId, evidence, day));
      await allowed(userId);
      return report;
    },
    async currentUsage(userId: string) {
      const state = await settings.get(userId); return usage[state.mode === 'personal' ? 'personal' : 'platform'].getForUser(userId);
    },
    async available(userId: string) {
      const state = await settings.get(userId), current = await policy.readPolicy();
      return config.enabled && (state.mode === 'platform' ? current.enabled && Boolean(config.project) : state.mode === 'personal' && state.keyConfigured);
    },
    async check(userId: string, version: number, signal: AbortSignal): Promise<ModelKeyCheck> {
      const snapshot = await settings.resolve(userId);
      if (snapshot.settings.version !== version) throw new ModelSettingsError('version_conflict', 409);
      if (!config.enabled || !snapshot.apiKey) throw new ModelSettingsError('unavailable', 503);
      await reserveMetadataCheck(userId);
      const result = await createPersonalModelProviders({ ...config, model: snapshot.settings.model }, snapshot.apiKey, snapshot.settings.provider,
        { baseUrl: snapshot.settings.baseUrl, embeddingApiKey: snapshot.embeddingApiKey,
          embeddingProvider: snapshot.settings.embeddingProvider, embeddingProject: snapshot.settings.embeddingProject, embeddingLocation: snapshot.settings.embeddingLocation })
        .inspect(AbortSignal.any([signal, AbortSignal.timeout(10_000)]));
      if (!await settings.isCurrent(userId, version)) throw new ModelSettingsError('version_conflict', 409);
      return { version, ...result, scope: 'model_metadata_only' };
    },
    async catalog(userId: string, version: number, refresh: boolean, signal: AbortSignal, provider?: PersonalModelProvider): Promise<PersonalModelCatalog> {
      const snapshot = await settings.resolve(userId), state = snapshot.settings;
      if (state.version !== version) throw new ModelSettingsError('version_conflict', 409);
      const selectedProvider = provider ?? state.provider;
      if (refresh && selectedProvider !== state.provider) throw new ModelSettingsError('invalid_input');
      if (!refresh) return { version, provider: selectedProvider, models: personalModelCatalog(selectedProvider), status: 'not_checked',
        scope: 'model_metadata_only', truncated: false, embedding: { model: KNOWLEDGE_EMBEDDING.model, dimensions: KNOWLEDGE_EMBEDDING.dimensions,
          status: snapshot.embeddingApiKey || state.embeddingProvider !== 'vertex' && selectedProvider === 'gemini' ? 'not_checked' : 'unsupported' } };
      if (!config.enabled || !snapshot.apiKey) throw new ModelSettingsError('key_required');
      await reserveMetadataCheck(userId);
      const result = await createPersonalModelProviders({ ...config, model: state.model }, snapshot.apiKey, state.provider,
        { baseUrl: state.baseUrl, embeddingApiKey: snapshot.embeddingApiKey,
          embeddingProvider: state.embeddingProvider, embeddingProject: state.embeddingProject, embeddingLocation: state.embeddingLocation })
        .catalog(version, true, AbortSignal.any([signal, AbortSignal.timeout(10_000)]));
      if (!await settings.isCurrent(userId, version)) throw new ModelSettingsError('version_conflict', 409);
      return result;
    },
    async resolve(userId: string, trigger: 'interactive' | 'worker' | 'knowledge-maintenance' | 'private-source-worker' | 'private-source-query') {
      const snapshot = await settings.resolve(userId), state = snapshot.settings, personal = state.mode === 'personal', current = await policy.readPolicy();
      if ((trigger === 'private-source-worker' || trigger === 'private-source-query') && (!personal || !snapshot.apiKey))
        domainReject('personal_source_key_required', 409);
      if (trigger === 'knowledge-maintenance' && (!personal || !state.publicMaintenanceEnabled || !state.backgroundEnabled || !snapshot.apiKey))
        throw new AgentStopped('unauthorized');
      const { enabled, limits, selectedConfig, billingSource: source, runLimits, settingsVersion } =
        profileFor(state, current, trigger === 'interactive' || trigger === 'private-source-query' ? 'interactive' : 'worker');
      if (enabled && personal && !snapshot.apiKey) throw new AgentStopped('unavailable');
      const disabled = async (): Promise<never> => { throw new AgentStopped('unavailable'); };
      const providers = !enabled ? { agent: { generate: disabled }, model: { generate: disabled }, embedding: { embed: disabled } }
        : personal && snapshot.apiKey ? personalProviders(selectedConfig, snapshot.apiKey, state.provider,
          { documentEmbeddings: trigger === 'knowledge-maintenance' || trigger === 'private-source-worker', baseUrl: state.baseUrl, embeddingApiKey: snapshot.embeddingApiKey,
            embeddingProvider: state.embeddingProvider, embeddingProject: state.embeddingProject, embeddingLocation: state.embeddingLocation })
        : platformProviders ? platformProviders(selectedConfig) : { agent: createVertexAgentProvider(selectedConfig), model: createVertexProvider(selectedConfig), embedding: createVertexEmbeddingProvider(selectedConfig) };
      const authorize = async () => enabled && (personal || (await policy.readPolicy()).enabled) && await allowed(userId) && await settings.isCurrent(userId, state.version);
      let activePolicyVersion = current.version;
      const readPolicyTransition = async () => {
        const latest = await policy.readPolicy();
        const nextLimits = resolvePersonalModelLimits(state, latest);
        const metadata = { policyVersion: latest.version, softBudgetSource: nextLimits.limitSources?.softBudgetRatio,
          repeatedSignatureStreak: latest.highWatermark?.repeatedSignatureStreak ?? AGENT_HIGH_WATERMARK_DEFAULTS.repeatedSignatureStreak };
        if (!enabled || (!personal && !latest.enabled)) return { ...metadata, enabled: false as const };
        if (latest.version === activePolicyVersion) return null;
        activePolicyVersion = latest.version;
        return {
          ...metadata,
          enabled: true as const,
          maxModelCalls: nextLimits.maxModelCalls,
          maxToolCalls: nextLimits.maxToolCalls,
          maxQueryEmbeddings: nextLimits.maxQueryEmbeddings,
          deadlineMs: nextLimits.maxRunSeconds * 1000,
          softBudgetRatio: nextLimits.softBudgetRatio,
          roleSoftBudgetRatios: latest.roleSoftBudgetRatios ?? {},
        };
      };
      const gateway = createEmbeddingGateway({ config: selectedConfig, provider: enabled ? providers.embedding : undefined,
        usage: requireDurableUsage, billingSource: source });
      return { config: selectedConfig, provider: providers.agent, policyVersion: current.version,
        repeatedSignatureStreak: current.highWatermark?.repeatedSignatureStreak ?? AGENT_HIGH_WATERMARK_DEFAULTS.repeatedSignatureStreak,
        settingsVersion, billingSource: source,
        maintenanceEmbedding: trigger === 'knowledge-maintenance' ? providers.embedding : undefined,
        dailyUsage: usage[source], authorize, readPolicyTransition,
        softBudgetSource: limits.limitSources?.softBudgetRatio,
        ...(current.roleSoftBudgetRatios ? { roleSoftBudgetRatios: current.roleSoftBudgetRatios } : {}),
        runLimits,
        embeddings: { embed: (...args: Parameters<typeof gateway.embed>) => {
          const [input, actor, signal, resourceAccess, durable] = args;
          if (!durable) throw new AgentStopped('unavailable');
          if (personal && (state.provider !== 'gemini' || state.embeddingProvider === 'vertex') && !snapshot.embeddingApiKey)
            throw new AgentStopped('embedding_not_configured');
          return gateway.embed(input, actor, signal, async () => actor.actorId === userId && (actor.kind === 'query_embedding'
            || trigger === 'private-source-worker' && actor.kind === 'private_document_embedding' && input.task === 'RETRIEVAL_DOCUMENT')
            && await authorize() && await resourceAccess(), durable);
        } },
      };
    },
  };
}
export type FirestoreModelRouting = ReturnType<typeof createFirestoreModelRouting>;
