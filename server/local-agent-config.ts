import { readFirebaseServerConfig } from './firebase-config.ts';
import { AGENT_OUTPUT_LIMITS } from '../src/shared/agent-run-limits.ts';

type Environment = Record<string, string | undefined>;
const disabledChannels = ['WEB_PUSH_ENABLED', 'ANDROID_PUSH_ENABLED', 'TELEGRAM_ENABLED'];

export interface LocalAgentAiOverrides {
  dailyUserAttempts?: number | string;
  dailyGlobalAttempts?: number | string;
  personalDailyGlobalAttempts?: number | string;
  maxOutputTokens?: number | string;
  chatDeliveryReviewModelCalls?: number | string;
  agentThinkingLevel?: string;
  agentMaxInputCharacters?: number | string;
}

function readLocalValue(override: number | string | undefined, envValue: string | undefined): string | undefined {
  if (override !== undefined && override !== null) return String(override);
  return envValue !== undefined && envValue !== '' ? envValue : undefined;
}

/**
 * Resolve explicit operator quota/output overrides and centralized output token defaults for `agent:local`.
 * Never overrides production `readAiConfig` defaults outside `agent:local`.
 */
export function localAgentAiEnvironment(
  processEnv: Environment,
  configured: LocalAgentAiOverrides = {},
): Record<string, string> {
  const result: Record<string, string> = {
    AI_MAX_OUTPUT_TOKENS: readLocalValue(configured.maxOutputTokens, processEnv.AI_MAX_OUTPUT_TOKENS) ?? String(AGENT_OUTPUT_LIMITS.default),
  };
  const optional: Array<[string, number | string | undefined, string | undefined]> = [
    ['AI_DAILY_USER_ATTEMPTS', configured.dailyUserAttempts, processEnv.AI_DAILY_USER_ATTEMPTS],
    ['AI_DAILY_GLOBAL_ATTEMPTS', configured.dailyGlobalAttempts, processEnv.AI_DAILY_GLOBAL_ATTEMPTS],
    ['AI_PERSONAL_DAILY_GLOBAL_ATTEMPTS', configured.personalDailyGlobalAttempts, processEnv.AI_PERSONAL_DAILY_GLOBAL_ATTEMPTS],
    ['AI_CHAT_DELIVERY_REVIEW_MODEL_CALLS', configured.chatDeliveryReviewModelCalls, processEnv.AI_CHAT_DELIVERY_REVIEW_MODEL_CALLS],
    ['AI_AGENT_THINKING_LEVEL', configured.agentThinkingLevel, processEnv.AI_AGENT_THINKING_LEVEL],
    ['AI_AGENT_MAX_INPUT_CHARACTERS', configured.agentMaxInputCharacters, processEnv.AI_AGENT_MAX_INPUT_CHARACTERS],
  ];
  for (const [key, configValue, envValue] of optional) {
    const resolved = readLocalValue(configValue, envValue);
    if (resolved !== undefined) result[key] = resolved;
  }
  return result;
}

export function localEmulatorOrigin(value: string | undefined): string {
  if (!value || !/^127\.0\.0\.1:[1-9][0-9]{3,4}$/u.test(value)) throw new Error('Local emulator must use an explicit IPv4 loopback port');
  const url = new URL('http://' + value);
  if (!url.port || Number(url.port) > 65535) throw new Error('Invalid local emulator port');
  return url.origin;
}

/** Called before constructing any Admin SDK or database client. No missing-service cloud fallback. */
export function assertLocalAgentEnvironment(env: Environment) {
  if (env.YUYF_LOCAL_DEVELOPMENT !== '1' || env.NODE_ENV === 'production') throw new Error('Local Agent mode requires explicit development configuration');
  const config = readFirebaseServerConfig(env);
  if (!config.projectId.startsWith('demo-') || config.databaseId !== '(default)' || config.namespace !== 'local_agent'
    || config.host !== '127.0.0.1' || new URL(config.publicOrigin).hostname !== '127.0.0.1'
    || new URL(config.publicOrigin).protocol !== 'http:'
    || config.photoBucket !== config.projectId + '-private' || config.erasureBucket !== config.projectId + '-journal') {
    throw new Error('Local Agent data must use its isolated demo project');
  }
  for (const key of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
    if (env[key] !== undefined && env[key] !== config.projectId) throw new Error('Local data and model projects must be configured separately');
  }
  for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) localEmulatorOrigin(env[key]);
  if (env.STORAGE_EMULATOR_HOST !== localEmulatorOrigin(env.FIREBASE_STORAGE_EMULATOR_HOST)
    || disabledChannels.some(key => env[key] !== 'false') || !['true', 'false'].includes(env.FIREBASE_AUTH_EMAIL_ENABLED ?? '')) {
    throw new Error('Local Agent external delivery must stay disabled');
  }
  return config;
}
