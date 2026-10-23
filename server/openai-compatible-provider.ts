import type { LlmRequest, LlmResponse } from '@google/adk';
import { FinishReason, type Content, type Part } from '@google/genai';
import { z } from 'zod';
import type { AiConfig } from './ai-config.ts';
import { AGENT_LIMITS } from './agent-budget.ts';
import type { AgentModelProvider } from './agent-model-gateway.ts';
import type { ModelProvider } from './model-gateway.ts';
import { postPersonalModel, type PersonalModelTransport } from './personal-model-transport.ts';
import { providerConfigurationError } from './personal-provider-error.ts';

type Message = Record<string, unknown>;
const invalid = () => providerConfigurationError('model_response_invalid');
function instruction(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(instruction).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return '';
  const item = value as Record<string, unknown>;
  return typeof item.text === 'string' ? item.text : instruction(item.parts);
}
function inputParts(parts: Part[]): unknown[] {
  return parts.filter(p => !p.thought && !p.functionCall && !p.functionResponse).map(part => {
    if (typeof part.text === 'string') return { type: 'text', text: part.text };
    if (part.inlineData?.data) {
      const { data, mimeType } = part.inlineData;
      if (mimeType && ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mimeType))
        return { type: 'image_url', image_url: { url: `data:${mimeType};base64,${data}` } };
      const format = mimeType && ['audio/wav', 'audio/x-wav'].includes(mimeType) ? 'wav'
        : mimeType && ['audio/mpeg', 'audio/mp3'].includes(mimeType) ? 'mp3' : null;
      if (format) return { type: 'input_audio', input_audio: { data, format } };
    }
    // Never silently discard an attachment or send a private file URI to another service.
    throw providerConfigurationError('model_input_unsupported');
  });
}
/** Preserve tool identities and structured results across the existing ADK loop. */
export function compatibleMessages(contents: Content[], systemInstruction: unknown): Message[] {
  const messages: Message[] = [], pending: { id: string; name: string }[] = [];
  const system = instruction(systemInstruction);
  if (system) messages.push({ role: 'system', content: system });
  for (const [index, content] of contents.entries()) {
    const parts = content.parts ?? [];
    if (content.role === 'model') {
      const calls = parts.flatMap((part, n) => {
        if (!part.functionCall) return [];
        const call = part.functionCall;
        if (!call.name) throw invalid();
        const id = call.id ?? `call_${index}_${n}`;
        if (pending.some(item => item.id === id)) throw invalid();
        pending.push({ id, name: call.name });
        return [{ id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) } }];
      });
      if (parts.some(p => p.inlineData || p.fileData || p.functionResponse)) throw providerConfigurationError('model_input_unsupported');
      const text = parts.filter(p => !p.thought).map(p => p.text ?? '').join('');
      const reasoning = parts.filter(p => p.thought).map(p => p.text ?? '').join('');
      if (text || calls.length) messages.push({ role: 'assistant', content: text || null,
        ...(calls.length ? { tool_calls: calls } : {}), ...(reasoning ? { reasoning_content: reasoning } : {}) });
    } else {
      for (const part of parts) {
        if (!part.functionResponse) continue;
        const response = part.functionResponse;
        const candidates = pending.filter(item => response.id ? item.id === response.id : item.name === response.name);
        if (candidates.length !== 1 || candidates[0]!.name !== response.name) throw invalid();
        const call = candidates[0]!; pending.splice(pending.indexOf(call), 1);
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(response.response ?? {}) });
      }
      const body = inputParts(parts);
      if (body.length) messages.push({ role: 'user', content: body });
    }
  }
  if (pending.length) throw invalid();
  return messages;
}
function jsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonSchema);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    key === 'type' && typeof item === 'string' ? item.toLowerCase() : jsonSchema(item)]));
}
export function compatibleRequest(request: LlmRequest, model: string, maxOutputTokens: number): Record<string, unknown> {
  const declarations = (request.config?.tools ?? []).flatMap(tool => 'functionDeclarations' in tool ? tool.functionDeclarations ?? [] : []);
  const calling = request.config?.toolConfig?.functionCallingConfig;
  const allowed = calling?.allowedFunctionNames;
  const tools = declarations.filter(d => !allowed?.length || allowed.includes(d.name ?? '')).map(d => ({
    type: 'function', function: { name: d.name, ...(d.description ? { description: d.description } : {}),
      parameters: jsonSchema(d.parametersJsonSchema ?? d.parameters ?? { type: 'object', properties: {} }) },
  }));
  return { model, messages: compatibleMessages(request.contents, request.config?.systemInstruction), stream: false,
    max_completion_tokens: maxOutputTokens,
    ...(tools.length ? { tools, tool_choice: calling?.mode === 'ANY' ? 'required' : calling?.mode === 'NONE' ? 'none' : 'auto' } : {}) };
}
const count = z.number().int().nonnegative().optional();
const replySchema = z.object({
  choices: z.array(z.object({ finish_reason: z.string().nullable(), message: z.object({ role: z.literal('assistant'),
    content: z.string().nullable().optional(), reasoning_content: z.string().nullable().optional(),
    tool_calls: z.array(z.object({ id: z.string().min(1).max(256), type: z.literal('function'),
      function: z.object({ name: z.string().min(1).max(128), arguments: z.string() }) })).optional(),
  }) })).length(1),
  usage: z.object({ prompt_tokens: count, completion_tokens: count, total_tokens: count,
    prompt_tokens_details: z.object({ cached_tokens: count }).optional() }).nullable().optional(),
});
export function compatibleResponse(value: unknown): LlmResponse {
  const parsed = replySchema.safeParse(value);
  if (!parsed.success) throw invalid();
  const { message, finish_reason } = parsed.data.choices[0]!, parts: Part[] = [];
  if (message.reasoning_content) parts.push({ text: message.reasoning_content, thought: true });
  if (message.content) parts.push({ text: message.content });
  const ids = new Set<string>();
  for (const call of message.tool_calls ?? []) {
    let args: unknown;
    try { args = JSON.parse(call.function.arguments); } catch { throw invalid(); }
    if (!args || typeof args !== 'object' || Array.isArray(args) || ids.has(call.id)) throw invalid();
    ids.add(call.id);
    parts.push({ functionCall: { id: call.id, name: call.function.name, args: args as Record<string, unknown> } });
  }
  if (!parts.some(p => !p.thought) || !['stop', 'tool_calls', 'length'].includes(finish_reason ?? '')) throw invalid();
  const usage = parsed.data.usage;
  return { content: { role: 'model', parts }, finishReason: finish_reason === 'length' ? FinishReason.MAX_TOKENS : FinishReason.STOP,
    ...(usage ? { usageMetadata: { promptTokenCount: usage.prompt_tokens, candidatesTokenCount: usage.completion_tokens,
      totalTokenCount: usage.total_tokens, cachedContentTokenCount: usage.prompt_tokens_details?.cached_tokens } } : {}) };
}

export function createCompatibleProviders(config: AiConfig, apiKey: string, baseUrl: string,
  transport: PersonalModelTransport = postPersonalModel): { agent: AgentModelProvider; model: ModelProvider } {
  const generate = async (request: LlmRequest, signal: AbortSignal, maxOutputTokens = config.maxOutputTokens) => {
    const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]);
    try {
      return compatibleResponse(await transport(baseUrl, apiKey,
        compatibleRequest(request, config.model, Math.min(maxOutputTokens, config.maxOutputTokens, AGENT_LIMITS.outputTokens)), boundedSignal));
    } catch (error) {
      if (!signal.aborted && boundedSignal.aborted) throw providerConfigurationError('model_http_408');
      throw error;
    }
  };
  return { agent: { generate }, model: { async generate(input, options) {
    const response = await generate({ model: config.model, contents: input.messages.map(m => ({ role: m.role, parts: [{ text: m.text }] })),
      config: { systemInstruction: input.systemInstruction }, toolsDict: {}, liveConnectConfig: {} }, options.signal, options.maxOutputTokens);
    if (response.finishReason !== FinishReason.STOP || response.content?.parts?.some(p => p.functionCall)) throw invalid();
    return { text: response.content?.parts?.filter(p => !p.thought).map(p => p.text ?? '').join('') ?? '',
      usage: { inputTokens: response.usageMetadata?.promptTokenCount ?? null, outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
        cachedTokens: response.usageMetadata?.cachedContentTokenCount ?? null } };
  } } };
}
