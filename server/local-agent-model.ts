import { createHash } from 'node:crypto';
import { z } from 'zod';
import { personalBaseUrlSchema, personalModelIdSchema } from '../src/shared/model-settings-schema.ts';
import { readAiConfig, type AiConfig } from './ai-config.ts';
import { createPersonalModelProviders } from './personal-model-providers.ts';
import { resolveModelThinkingLevel } from './model-thinking.ts';

const keySchema = z.string().min(1).max(512).regex(/^[\x21-\x7e]+$/u);
type Environment = Record<string, string | undefined>;

/** Local credentials select the production adapters. Never expose this closure to the Web client. */
export function readLocalAgentModel(env: Environment, options: { documentEmbeddings?: boolean } = {}) {
  if (env.YUYF_LOCAL_DEVELOPMENT !== '1' || env.NODE_ENV === 'production')
    throw Error('Local model configuration requires explicit development mode');
  const parsedProvider = z.enum(['gemini', 'vertex', 'vertex-adc', 'openai-compatible']).safeParse(env.LOCAL_MODEL_PROVIDER);
  if (!parsedProvider.success) throw Error('Unknown local model provider');
  const provider = parsedProvider.data, enabled = env.AI_ENABLED === 'true';
  const readKey = (value: string | undefined, name: string) => {
    if (value === undefined) return undefined;
    if (!keySchema.safeParse(value).success) throw Error(`Invalid ${name}; use a non-empty key without spaces`);
    return value;
  };
  const apiKey = readKey(env.LOCAL_MODEL_API_KEY, 'local model credential');
  const embeddingApiKey = readKey(env.LOCAL_MODEL_EMBEDDING_API_KEY, 'local embedding credential');
  if (enabled && (provider === 'vertex-adc' ? !env.LOCAL_MODEL_PROJECT : !apiKey))
    throw Error('Local model credentials missing; no platform fallback');
  if (provider === 'vertex-adc' && (apiKey || embeddingApiKey))
    throw Error('ADC mode cannot also select API keys; choose an explicit credential mode');
  let baseUrl: string | undefined;
  if (provider === 'openai-compatible') {
    const parsed = personalBaseUrlSchema.safeParse(env.LOCAL_MODEL_BASE_URL);
    if (!parsed.success) throw Error('Set a public HTTPS LOCAL_MODEL_BASE_URL for the compatible provider');
    baseUrl = parsed.data;
  } else if (env.LOCAL_MODEL_BASE_URL !== undefined) {
    throw Error('A custom API address requires the openai-compatible provider');
  }
  const modelConfig = readAiConfig({ ...env,
    GCP_PROJECT_ID: provider === 'vertex-adc' ? env.LOCAL_MODEL_PROJECT : env.GCP_PROJECT_ID,
    // The local admin retains the production policy schema; only model identity is selected by this local config.
    GEMINI_MODEL: undefined,
  });
  const selectedModel = env.GEMINI_MODEL ?? (provider === 'openai-compatible' ? undefined : modelConfig.model);
  if (!personalModelIdSchema.safeParse(selectedModel).success) throw Error('Set a valid local model ID explicitly');
  if (selectedModel !== modelConfig.model) modelConfig.localModelOverride = selectedModel;
  modelConfig.agentThinkingLevel = resolveModelThinkingLevel(selectedModel!, env.AI_AGENT_THINKING_LEVEL);
  const providers = provider !== 'vertex-adc' && enabled
    ? (selected: AiConfig) => createPersonalModelProviders(selected, apiKey!, provider, { baseUrl, embeddingApiKey, ...options })
    : undefined;
  // Preserve existing unchanged Gemini/ADC work bindings; changes of endpoint or embedding payer invalidate reuse.
  const binding: unknown[] = [provider, modelConfig.project,
    provider === 'vertex-adc' ? env.GOOGLE_APPLICATION_CREDENTIALS ?? 'local-adc' : apiKey];
  if (baseUrl || embeddingApiKey) binding.push(baseUrl ?? null, embeddingApiKey ?? null);
  return { provider, modelConfig, providers,
    embeddingConfigured: enabled && (provider === 'gemini' || provider === 'vertex-adc' || Boolean(embeddingApiKey)),
    credentialBinding: createHash('sha256').update(JSON.stringify(binding)).digest('hex') };
}
