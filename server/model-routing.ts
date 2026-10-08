import type { Pool } from "pg";
import type { AiConfig } from "./ai-config.ts";
import { createAiUsageStore } from "./ai-usage.ts";
import { createVertexAgentProvider } from "./agent-model-gateway.ts";
import { createVertexProvider } from "./vertex-provider.ts";
import { createVertexEmbeddingProvider } from "./vertex-embedding.ts";
import { createEmbeddingGateway, createEmbeddingUsage } from "./embedding-gateway.ts";
import { createGeminiKeyProviders } from "./gemini-key-provider.ts";
import { createModelSettingsStore } from "./model-settings.ts";
import { ModelSettingsError } from "./model-settings-contract.ts";
import type { StorageCipher } from "./storage-crypto.ts";
import { PERSONAL_MODEL, type ModelSettingsView, type ModelKeyCheck } from "../src/shared/model-settings.ts";
import { AGENT_INTERACTIVE_INPUT } from "./agent-budget.ts";

/** Credentials stay in this Server closure; never put the resolved object in a job or response. */
export function createModelRouting(pool: Pool, cipher: StorageCipher, config: AiConfig, isUserAllowed: (userId: string) => Promise<boolean> = async () => true) {
  const settings = createModelSettingsStore(pool, cipher);
  const usage = { platform: createAiUsageStore(pool), personal: createAiUsageStore(pool, "personal") };
  const personalGlobalLimit = config.personalDailyGlobalAttempts ?? 1000;
  const disabled = async (): Promise<never> => { throw new Error("ai_disabled"); };
  const platform = config.enabled && config.project ? { agent: createVertexAgentProvider(config), model: createVertexProvider(config),
    embedding: createVertexEmbeddingProvider(config) } : { agent: { generate: disabled }, model: { generate: disabled }, embedding: { embed: disabled } };
  const checks = new Map<string, number>();
  return {
    settings,
    async view(userId: string): Promise<ModelSettingsView> {
      const state = await settings.get(userId);
      return { settings: state, enabled: config.enabled, platformAvailable: config.enabled && Boolean(config.project),
        personalAvailable: config.enabled, personalGlobalLimit,
        agentInputCharacters: config.agentMaxInputCharacters ?? AGENT_INTERACTIVE_INPUT.default,
        usage: { platform: await usage.platform.getForUser(userId), personal: await usage.personal.getForUser(userId) } };
    },
    async currentUsage(userId: string) {
      const state = await settings.get(userId);
      return usage[state.mode === "personal" ? "personal" : "platform"].getForUser(userId);
    },
    async available(userId: string) {
      const state = await settings.get(userId);
      return config.enabled && await isUserAllowed(userId) && (state.mode === "platform" ? Boolean(config.project) : state.mode === "personal" && state.keyConfigured);
    },
    async check(userId: string, version: number, signal: AbortSignal): Promise<ModelKeyCheck> {
      if (!await isUserAllowed(userId)) throw new ModelSettingsError("unavailable", 403);
      const now = Date.now();
      for (const [id, time] of checks) if (now - time >= 60000) checks.delete(id);
      if (checks.has(userId) || checks.size >= 4) throw new ModelSettingsError("unavailable", 429);
      const snapshot = await settings.resolve(userId);
      if (snapshot.settings.version !== version) throw new ModelSettingsError("version_conflict", 409);
      if (!config.enabled || !snapshot.apiKey) throw new ModelSettingsError("unavailable", 503);
      checks.set(userId, now);
      const accessible = await createGeminiKeyProviders({ ...config, model: PERSONAL_MODEL }, snapshot.apiKey).check(AbortSignal.any([signal, AbortSignal.timeout(10000)]));
      if (!await settings.isCurrent(userId, version)) throw new ModelSettingsError("version_conflict", 409);
      return { version, status: accessible ? "accessible" : "unavailable", scope: "model_metadata_only" };
    },
    async resolve(userId: string, trigger: "interactive" | "worker") {
      const snapshot = await settings.resolve(userId), state = snapshot.settings;
      const personal = state.mode === "personal";
      const allowed = config.enabled && await isUserAllowed(userId) && state.mode !== "disabled" && (personal
        ? Boolean(snapshot.apiKey) && (trigger !== "worker" || state.backgroundEnabled) : Boolean(config.project));
      const selectedConfig: AiConfig = { ...config, enabled: allowed,
        ...(personal ? { maxAttempts: 1, model: PERSONAL_MODEL, dailyUserAttempts: state.dailyLimit, dailyGlobalAttempts: personalGlobalLimit } : {}) };
      const providers = personal && snapshot.apiKey ? createGeminiKeyProviders(selectedConfig, snapshot.apiKey) : platform;
      const authorize = async () => allowed && await isUserAllowed(userId) && await settings.isCurrent(userId, state.version);
      const gateway = createEmbeddingGateway({ config: selectedConfig, provider: allowed ? providers.embedding : undefined,
        usage: createEmbeddingUsage(pool, personal ? "personal" : "platform") });
      return { config: selectedConfig, provider: providers.agent, model: providers.model,
        runLimits: personal ? { modelCalls: state.maxModelCalls, queryEmbeddings: state.maxQueryEmbeddings } : undefined,
        usage: personal ? usage.personal : usage.platform, authorize,
        embeddings: { embed: (input: Parameters<typeof gateway.embed>[0], actor: Parameters<typeof gateway.embed>[1], signal: AbortSignal,
          resourceAccess: () => Promise<boolean>) => gateway.embed(input, actor, signal,
            async () => actor.actorId === userId && actor.kind === "query_embedding" && await authorize() && await resourceAccess()) } };
    },
  };
}
export type ModelRouting = ReturnType<typeof createModelRouting>;
