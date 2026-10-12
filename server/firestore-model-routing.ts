import { z } from 'zod';
import type { AiConfig } from './ai-config.ts';
import { AGENT_INTERACTIVE_INPUT, AgentStopped } from './agent-budget.ts';
import { PERSONAL_MODEL, type ModelKeyCheck, type ModelSettingsView } from '../src/shared/model-settings.ts';
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

export function createFirestoreModelRouting(options: FirestoreDomainOptions, config: AiConfig) {
  const settings = createFirestoreModelSettings(options), authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options);
  const usage = { platform: new FirestoreAiUsage({ ...options, namespace: options.namespace + '_ai_usage', billingSource: 'platform' }),
    personal: new FirestoreAiUsage({ ...options, namespace: options.namespace + '_ai_usage', billingSource: 'personal' }) };
  const personalGlobalLimit = config.personalDailyGlobalAttempts ?? 1000;
  const disabled = async (): Promise<never> => { throw new AgentStopped('unavailable'); };
  const platform = config.enabled && config.project ? { agent: createVertexAgentProvider(config), model: createVertexProvider(config),
    embedding: createVertexEmbeddingProvider(config) } : { agent: { generate: disabled }, model: { generate: disabled }, embedding: { embed: disabled } };
  const allowed = (userId: string) => authority.runTransaction(userId, null, async () => true);
  return {
    settings,
    async view(userId: string): Promise<ModelSettingsView> {
      const state = await settings.get(userId);
      return { settings: state, enabled: config.enabled, platformAvailable: config.enabled && Boolean(config.project),
        personalAvailable: config.enabled, personalGlobalLimit, agentInputCharacters: config.agentMaxInputCharacters ?? AGENT_INTERACTIVE_INPUT.default,
        usage: { platform: await usage.platform.getForUser(userId), personal: await usage.personal.getForUser(userId) } };
    },
    async currentUsage(userId: string) {
      const state = await settings.get(userId); return usage[state.mode === 'personal' ? 'personal' : 'platform'].getForUser(userId);
    },
    async available(userId: string) {
      const state = await settings.get(userId);
      return config.enabled && (state.mode === 'platform' ? Boolean(config.project) : state.mode === 'personal' && state.keyConfigured);
    },
    async check(userId: string, version: number, signal: AbortSignal): Promise<ModelKeyCheck> {
      const snapshot = await settings.resolve(userId);
      if (snapshot.settings.version !== version) throw new ModelSettingsError('version_conflict', 409);
      if (!config.enabled || !snapshot.apiKey) throw new ModelSettingsError('unavailable', 503);
      await authority.runTransaction(userId, null, async b => {
        const ref = data.ref('model_key_checks', 'model-key-checks', 'active'), row = await b.transaction.get(ref), now = Date.now();
        const attempts = (row.exists ? data.open('model-key-checks', 'active', checkScope, checksSchema, row).attempts : [])
          .filter(value => now - value.at < 60_000);
        if (attempts.length >= 4 || attempts.some(value => value.userId === userId)) throw new ModelSettingsError('unavailable', 429);
        attempts.push({ userId, at: now }); b.transaction.set(ref, data.seal('model-key-checks', 'active', checkScope, checksSchema, { attempts }));
      });
      const accessible = await createGeminiKeyProviders({ ...config, model: PERSONAL_MODEL }, snapshot.apiKey)
        .check(AbortSignal.any([signal, AbortSignal.timeout(10_000)]));
      if (!await settings.isCurrent(userId, version)) throw new ModelSettingsError('version_conflict', 409);
      return { version, status: accessible ? 'accessible' : 'unavailable', scope: 'model_metadata_only' };
    },
    async resolve(userId: string, trigger: 'interactive' | 'worker') {
      const snapshot = await settings.resolve(userId), state = snapshot.settings, personal = state.mode === 'personal';
      const enabled = config.enabled && state.mode !== 'disabled' && (personal
        ? Boolean(snapshot.apiKey) && (trigger !== 'worker' || state.backgroundEnabled) : Boolean(config.project));
      const selectedConfig: AiConfig = { ...config, enabled, ...(personal ? { maxAttempts: 1, model: PERSONAL_MODEL,
        dailyUserAttempts: state.dailyLimit, dailyGlobalAttempts: personalGlobalLimit } : {}) };
      const providers = personal && snapshot.apiKey ? createGeminiKeyProviders(selectedConfig, snapshot.apiKey) : platform;
      const source = personal ? 'personal' as const : 'platform' as const;
      const authorize = async () => enabled && await allowed(userId) && await settings.isCurrent(userId, state.version);
      const gateway = createEmbeddingGateway({ config: selectedConfig, provider: enabled ? providers.embedding : undefined,
        usage: requireDurableUsage, billingSource: source });
      return { config: selectedConfig, provider: providers.agent, settingsVersion: String(state.version), billingSource: source,
        dailyUsage: usage[source], authorize,
        runLimits: personal ? { modelCalls: state.maxModelCalls, queryEmbeddings: state.maxQueryEmbeddings } : undefined,
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
