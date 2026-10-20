import { createFirestoreAdmin } from './firestore-admin.ts';
import { z } from 'zod';
import type { AiConfig } from './ai-config.ts';
import { AGENT_INTERACTIVE_INPUT, AgentStopped } from './agent-budget.ts';
import { type ModelKeyCheck, type ModelSettingsView, type PersonalModelCatalog, type PersonalModelProvider } from '../src/shared/model-settings.ts';
import { KNOWLEDGE_EMBEDDING } from '../src/shared/knowledge.ts';
import { personalModelCatalog } from './personal-model-catalog.ts';
import { resolvePersonalModelLimits } from './personal-model-policy.ts';
import { createFirestoreModelSettings } from './firestore-model-settings.ts';
import { FirestoreAiUsage } from './firestore-ai-usage.ts';
import { createFirestoreAuthority } from './firestore-authority.ts';
import { FirestoreDomainData, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { createVertexAgentProvider } from './agent-model-gateway.ts';
import { createVertexEmbeddingProvider } from './vertex-embedding.ts';
import { createVertexProvider } from './vertex-provider.ts';
import { createGeminiKeyProviders } from './gemini-key-provider.ts';
import { createEmbeddingGateway } from './embedding-gateway.ts';
import { ModelSettingsError } from './model-settings-contract.ts';

const checksSchema = z.object({ attempts: z.array(z.object({ userId: z.string(), at: z.number().int().nonnegative() }).strict()).max(4) }).strict();
export const firestoreModelChecksRecoverySchema = checksSchema;
const checkScope = { ownerUserId: 'system:model-key-check', workspaceId: '00000000-0000-0000-0000-000000000000',
  childId: '00000000-0000-0000-0000-000000000000', storageEpoch: '00000000-0000-0000-0000-000000000000' };
/** Firestore production must never fall back to process-local or SQL quota accounting. */
export const requireDurableUsage = Object.freeze({ async reserve(): Promise<never> { throw new AgentStopped('unavailable'); },
  async record(): Promise<never> { throw new AgentStopped('unavailable'); } });

export type PlatformProviderFactory = (config: AiConfig) => Pick<ReturnType<typeof createGeminiKeyProviders>, 'agent' | 'model' | 'embedding'>;

export function createFirestoreModelRouting(options: FirestoreDomainOptions, config: AiConfig, platformProviders?: PlatformProviderFactory) {
  const settings = createFirestoreModelSettings(options), authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options);
  const usage = { platform: new FirestoreAiUsage({ ...options, namespace: options.namespace + '_ai_usage', billingSource: 'platform' }),
    personal: new FirestoreAiUsage({ ...options, namespace: options.namespace + '_ai_usage', billingSource: 'personal' }) };
  const policy = createFirestoreAdmin(options, config);
  const allowed = (userId: string) => authority.runTransaction(userId, null, async () => true);
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
    settings,
    async readInteractiveRunSeconds(tx: import("@google-cloud/firestore").Transaction) { return (await policy.readPolicyIn(tx)).maxRunSeconds; },
    async view(userId: string): Promise<ModelSettingsView> {
      const state = await settings.get(userId), current = await policy.readPolicy();
      return { settings: state, enabled: config.enabled, platformAvailable: config.enabled && current.enabled && Boolean(config.project),
        personalAvailable: config.enabled, personalGlobalLimit: current.personalDailyGlobalAttempts, agentInputCharacters: config.agentMaxInputCharacters ?? AGENT_INTERACTIVE_INPUT.default,
        effective: resolvePersonalModelLimits(state, current),
        usage: { platform: await usage.platform.getForUser(userId), personal: await usage.personal.getForUser(userId) } };
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
      const result = await createGeminiKeyProviders({ ...config, model: snapshot.settings.model }, snapshot.apiKey, snapshot.settings.provider)
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
          status: selectedProvider === 'vertex' ? 'unsupported' : 'not_checked' } };
      if (!config.enabled || !snapshot.apiKey) throw new ModelSettingsError('key_required');
      await reserveMetadataCheck(userId);
      const result = await createGeminiKeyProviders({ ...config, model: state.model }, snapshot.apiKey, state.provider)
        .catalog(version, true, AbortSignal.any([signal, AbortSignal.timeout(10_000)]));
      if (!await settings.isCurrent(userId, version)) throw new ModelSettingsError('version_conflict', 409);
      return result;
    },
    async resolve(userId: string, trigger: 'interactive' | 'worker') {
      const snapshot = await settings.resolve(userId), state = snapshot.settings, personal = state.mode === 'personal', current = await policy.readPolicy();
      const limits = resolvePersonalModelLimits(state, current);
      const enabled = config.enabled && state.mode !== 'disabled' && (personal
        ? Boolean(snapshot.apiKey) && (trigger !== 'worker' || state.backgroundEnabled) : current.enabled && Boolean(config.project));
      const selectedConfig: AiConfig = { ...config, enabled, model: current.model,
        timeoutMs: limits.modelRequestSeconds * 1000, agentMaxRetries: limits.maxModelRetries,
        dailyUserAttempts: limits.dailyLimit, dailyGlobalAttempts: limits.dailyGlobalLimit,
        ...(personal ? { maxAttempts: 1, model: state.model } : {}) };
      const disabled = async (): Promise<never> => { throw new AgentStopped('unavailable'); };
      const providers = !enabled ? { agent: { generate: disabled }, model: { generate: disabled }, embedding: { embed: disabled } } : personal && snapshot.apiKey ? createGeminiKeyProviders(selectedConfig, snapshot.apiKey, state.provider) : platformProviders ? platformProviders(selectedConfig) : { agent: createVertexAgentProvider(selectedConfig), model: createVertexProvider(selectedConfig), embedding: createVertexEmbeddingProvider(selectedConfig) };
      const source = personal ? 'personal' as const : 'platform' as const;
      const authorize = async () => enabled && (personal || (await policy.readPolicy()).enabled) && await allowed(userId) && await settings.isCurrent(userId, state.version);
      const gateway = createEmbeddingGateway({ config: selectedConfig, provider: enabled ? providers.embedding : undefined,
        usage: requireDurableUsage, billingSource: source });
      return { config: selectedConfig, provider: providers.agent, settingsVersion: String(state.version) + ":policy:" + current.version, billingSource: source,
        dailyUsage: usage[source], authorize,
        runLimits: { modelCalls: limits.maxModelCalls, queryEmbeddings: limits.maxQueryEmbeddings,
          toolCalls: limits.maxToolCalls, deadlineMs: limits.maxRunSeconds * 1000 },
        embeddings: { embed: (...args: Parameters<typeof gateway.embed>) => {
          const [input, actor, signal, resourceAccess, durable] = args;
          if (!durable) throw new AgentStopped('unavailable');
          return gateway.embed(input, actor, signal, async () => actor.actorId === userId && actor.kind === 'query_embedding'
            && await authorize() && await resourceAccess(), durable);
        } },
      };
    },
  };
}
export type FirestoreModelRouting = ReturnType<typeof createFirestoreModelRouting>;
