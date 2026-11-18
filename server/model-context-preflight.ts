import type { Content, GenerateContentParameters } from '@google/genai';

export const CONTEXT_SOFT_TARGET_TOKENS = 128_000;
export type NativeContextPayload = Omit<GenerateContentParameters, 'contents'> & { contents: Content[] };

// These model cards publish separate input and output limits.
// https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite
const nativeLimits = { input: 1_048_576, output: 65_536 } as const;
const localTokenModels = new Set(['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']);
// https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash (same limits for its Lite and Pro siblings).
const documentedModels = new Set(['gemini-3.1-flash-lite', ...localTokenModels]);
export interface ContextPreflight {
  measurement: 'counted' | 'estimated' | 'unknown';
  inputTokens: number | null;
  estimatedTextTokens: number;
  mediaParts: number;
  mediaTokens: number | null;
  outputReserve: number;
  inputLimit: number | null;
  outputLimit: number | null;
  softExceeded: boolean | null;
  exceedsCapacity: boolean;
}

function assess(input: unknown, outputReserve: number, mediaParts: number, mediaTokens: number | null,
  limits: typeof nativeLimits | null, counted?: number): ContextPreflight {
  // Planning estimate in UTF-8 bytes per token. Framing, scripts and tokenizer versions vary.
  // Never report this heuristic or a provider's partial contents-only count as exact usage.
  const estimatedTextTokens = Math.ceil(Buffer.byteLength(JSON.stringify(input), 'utf8') / 3);
  const exact = typeof counted === 'number' && Number.isSafeInteger(counted) && counted >= 0;
  const inputTokens = exact ? counted : mediaTokens === null ? null : estimatedTextTokens + mediaTokens;
  const knownPortion = inputTokens ?? estimatedTextTokens;
  const overSoft = knownPortion + outputReserve > CONTEXT_SOFT_TARGET_TOKENS;
  return { measurement: exact ? 'counted' : inputTokens === null ? 'unknown' : 'estimated',
    inputTokens, estimatedTextTokens, mediaParts, mediaTokens, outputReserve,
    inputLimit: limits?.input ?? null, outputLimit: limits?.output ?? null,
    softExceeded: overSoft || (inputTokens === null ? null : false),
    exceedsCapacity: !!limits && (knownPortion > limits.input || outputReserve > limits.output) };
}

export function nativeContextPreflight(payload: NativeContextPayload, audioDurationMs?: number, counted?: number): ContextPreflight {
  const { httpOptions: _http, abortSignal: _abort, ...config } = payload.config ?? {};
  const known = payload.model === 'gemini-3.1-flash-lite';
  let mediaParts = 0, mediaTokens: number | null = 0;
  // All production generation builders pass native Content[]. Only replace actual binary
  // parts here; similarly named keys inside tool arguments/results remain ordinary text.
  const contents = payload.contents.map(content => ({ ...content, parts: content.parts?.map(part => {
    if (!part.inlineData && !part.fileData) return part;
    mediaParts++;
    const mime = part.inlineData?.mimeType ?? part.fileData?.mimeType ?? '';
    // https://ai.google.dev/gemini-api/docs/media-resolution#token-counts
    let estimate: number | null = null;
    if (known && mime.startsWith('image/') && !part.mediaResolution && !config.mediaResolution) estimate = 1120;
    if (known && mime.startsWith('audio/') && audioDurationMs && audioDurationMs > 0) estimate = Math.ceil(audioDurationMs * 25 / 1000);
    mediaTokens = mediaTokens !== null && estimate !== null ? mediaTokens + estimate : null;
    return part.inlineData ? { ...part, inlineData: { ...part.inlineData, data: undefined } } : part;
  }) }));
  return assess({ contents, config }, config.maxOutputTokens ?? 0, mediaParts, mediaTokens, documentedModels.has(payload.model) ? nativeLimits : null, counted);
}

type CompatibleMessage = Record<string, unknown>;
export function compatibleContextPreflight(payload: { messages: CompatibleMessage[]; max_completion_tokens: number; tools?: unknown; tool_choice?: unknown }) {
  let mediaParts = 0;
  const messages = payload.messages.map(message => {
    if (message.role !== 'user' || !Array.isArray(message.content)) return message;
    return { ...message, content: message.content.map(part => {
      if (part.type !== 'image_url' && part.type !== 'input_audio') return part;
      mediaParts++;
      return { type: part.type };
    }) };
  });
  // Compatible deployments own their model aliases, tokenizers and multimodal processing.
  return assess({ messages, tools: payload.tools, tool_choice: payload.tool_choice }, payload.max_completion_tokens,
    mediaParts, mediaParts ? null : 0, null);
}

type SdkTokenizer = import('@google/genai/tokenizer/node').LocalTokenizer;
const tokenizers = new Map<string, { ready?: SdkTokenizer }>();

/** Only the public model dictionary can be fetched. A cold/failed load never holds up a request. */
export function nativeTokenCounter(model: string, enabled: boolean | undefined) {
  if (!enabled || !localTokenModels.has(model)) return undefined;
  let state = tokenizers.get(model);
  if (!state) {
    const loading: { ready?: SdkTokenizer } = {};
    tokenizers.set(model, loading);
    void import('@google/genai/tokenizer/node').then(async ({ LocalTokenizer }) => {
      const tokenizer = new LocalTokenizer(model);
      await tokenizer.countTokens('warmup');
      loading.ready = tokenizer;
    }).catch(() => { /* The ordinary estimator remains available. */ });
    state = loading;
  }
  return async (payload: NativeContextPayload) => {
    if (!state.ready || payload.model !== model || !localCounterSupports(payload)) return undefined;
    // Pass text only. The installed SDK can warn with the original contents on unsupported parts.
    const contents = payload.contents.map(content => ({
      role: content.role, parts: content.parts!.map(part => ({ text: part.text! })),
    }));
    const system = payload.config?.systemInstruction;
    try {
      const result = await state.ready.countTokens(contents, system ? { systemInstruction: system as string } : undefined);
      const tokens = result.totalTokens;
      return typeof tokens === 'number' && Number.isSafeInteger(tokens) && tokens >= 0 ? tokens : undefined;
    } catch { return undefined; }
  };
}

/** Only SDK-supported plain text is counted. Opaque history, media, tools and schemas use the normal fallback. */
function localCounterSupports(payload: NativeContextPayload): boolean {
  const allowedConfig = new Set(['systemInstruction', 'candidateCount', 'maxOutputTokens', 'thinkingConfig', 'httpOptions', 'abortSignal']);
  const config = payload.config ?? {};
  if (Object.entries(config).some(([key, value]) => value !== undefined && !allowedConfig.has(key))
    || (config.systemInstruction !== undefined && typeof config.systemInstruction !== 'string')) return false;
  return Array.isArray(payload.contents) && payload.contents.every(content =>
    typeof content === 'object' && 'parts' in content && Object.keys(content).every(key => key === 'parts' || key === 'role')
    && content.parts?.every(part => Object.keys(part).length === 1 && typeof part.text === 'string' && part.text.length > 0));
}
