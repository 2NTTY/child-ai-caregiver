import { z } from 'zod';
import { AGENT_RUN_LIMITS } from '../shared/agent-run-limits.ts';
import { resolveApiBaseUrl } from '../config/api-base-url.ts';
import { mixedChatCreateSchema, mixedChatAppendSchema, mixedChatRoomSchema, mixedChatMessageSchema } from '../shared/mixed-chat.ts';
import { productAgentResultSchema } from '../shared/product-agent-result.ts';
import { mixedTaskBatchSchema, mixedBatchControlSchema, mixedBatchAdvanceSchema } from '../shared/mixed-task-batch.ts';

export class MixedChatApiError extends Error {
  readonly status: number; readonly code: string;
  constructor(status = 0, code = 'mixed_chat_unavailable') { super('Mixed chat request could not be confirmed'); this.status = status; this.code = code; }
}
const roomReply = z.strictObject({ room: mixedChatRoomSchema });
const messageReply = z.strictObject({ message: mixedChatMessageSchema });
const cursorSchema = z.string().min(1).max(8192).nullable();
const roomPage = z.strictObject({ rooms: z.array(mixedChatRoomSchema).max(3), nextCursor: cursorSchema });
const detailReply = z.strictObject({ room: mixedChatRoomSchema, messages: z.array(mixedChatMessageSchema).max(16), nextCursor: cursorSchema });
const resultReply = z.strictObject({ result: productAgentResultSchema.nullable() });
const batchReply = z.strictObject({ batch: mixedTaskBatchSchema.nullable() });
function checked<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value); if (!result.success) throw new MixedChatApiError(0, 'mixed_chat_response_invalid'); return result.data;
}
function identifier(value: string) {
  if (!z.uuid().safeParse(value).success) throw new MixedChatApiError(400, 'invalid_input'); return value;
}
function query(cursor?: string) {
  if (cursor === undefined) return '';
  if (!cursorSchema.safeParse(cursor).success || cursor === null) throw new MixedChatApiError(400, 'invalid_input');
  return '?' + new URLSearchParams({ cursor });
}
export function createMixedChatApi(baseUrl = '', fetcher: typeof fetch = fetch) {
  const base = resolveApiBaseUrl(baseUrl).replace(/\/$/u, ''), api = (base.endsWith('/api') ? base : base + '/api') + '/account/mixed-chats';
  async function request(path: string, method: 'GET' | 'POST' | 'DELETE', userId: string, signal: AbortSignal, body?: unknown, timeoutMs = 20_000): Promise<unknown> {
    if (!userId || signal.aborted) throw new MixedChatApiError(409, 'identity_changed');
    const controller = new AbortController(), cancel = () => controller.abort();
    signal.addEventListener('abort', cancel, { once: true }); const timer = setTimeout(cancel, timeoutMs);
    try {
      const response = await fetcher(api + path, { method, credentials: 'include', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/json', 'x-expected-user-id': userId, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const value: unknown = await response.json();
      if (controller.signal.aborted) throw new MixedChatApiError();
      if (!response.ok) {
        const error = value && typeof value === 'object' && 'error' in value ? value.error : null;
        const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
        throw new MixedChatApiError(response.status, typeof code === 'string' && /^[a-z_]{1,80}$/u.test(code) ? code : 'mixed_chat_unavailable');
      }
      return value;
    } catch (error) { if (error instanceof MixedChatApiError) throw error; throw new MixedChatApiError(); }
    finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
  }
  return {
    async list(userId: string, signal: AbortSignal, cursor?: string) {
      const result = checked(roomPage, await request(query(cursor), 'GET', userId, signal));
      if (cursor !== undefined && result.nextCursor === cursor || new Set(result.rooms.map(room => room.id)).size !== result.rooms.length)
        throw new MixedChatApiError(0, 'mixed_chat_response_invalid');
      return result;
    },
    async detail(roomId: string, userId: string, signal: AbortSignal, cursor?: string) {
      const result = checked(detailReply, await request('/' + identifier(roomId) + query(cursor), 'GET', userId, signal));
      if (result.room.id !== roomId || result.messages.some(message => message.roomId !== roomId || message.version > result.room.version)
        || new Set(result.messages.map(message => message.id)).size !== result.messages.length || cursor !== undefined && result.nextCursor === cursor)
        throw new MixedChatApiError(0, 'mixed_chat_response_invalid');
      return result;
    },
    async create(input: z.infer<typeof mixedChatCreateSchema>, userId: string, signal: AbortSignal) {
      const body = checked(mixedChatCreateSchema, input), result = checked(roomReply, await request('', 'POST', userId, signal, body));
      if (result.room.scope.kind !== body.scope.kind || body.scope.kind === 'class' && (result.room.scope.kind !== 'class' || result.room.scope.spaceId !== body.scope.spaceId)
        || JSON.stringify([...result.room.childIds].sort()) !== JSON.stringify([...body.childIds].sort())) throw new MixedChatApiError(0, 'mixed_chat_response_invalid');
      return result.room;
    },
    async append(roomId: string, input: z.infer<typeof mixedChatAppendSchema>, userId: string, signal: AbortSignal) {
      const body = checked(mixedChatAppendSchema, input);
      const result = checked(messageReply, await request('/' + identifier(roomId) + '/messages', 'POST', userId, signal, body));
      if (result.message.roomId !== roomId || result.message.version !== body.expectedVersion + 1 || result.message.text !== body.text)
        throw new MixedChatApiError(0, 'mixed_chat_response_invalid');
      return result.message;
    },
    async reply(roomId: string, messageId: string, method: 'GET' | 'POST' | 'DELETE', userId: string, signal: AbortSignal) {
      const timeout = method === 'POST' ? (AGENT_RUN_LIMITS.deadlineSeconds.max + 30) * 1000 : undefined;
      return checked(resultReply, await request('/' + identifier(roomId) + '/messages/' + identifier(messageId) + '/reply', method, userId, signal, undefined, timeout)).result;
    },
    async batch(roomId: string, messageId: string, userId: string, signal: AbortSignal) {
      return checked(batchReply, await request('/' + identifier(roomId) + '/messages/' + identifier(messageId) + '/task-batch', 'GET', userId, signal)).batch;
    },
    async controlBatch(roomId: string, messageId: string, input: z.infer<typeof mixedBatchControlSchema>, userId: string, signal: AbortSignal) {
      const body = checked(mixedBatchControlSchema, input);
      const batch = checked(batchReply, await request('/' + identifier(roomId) + '/messages/' + identifier(messageId) + '/task-batch', 'POST', userId, signal, body)).batch;
      if (!batch || batch.digest !== body.digest) throw new MixedChatApiError(0, 'mixed_chat_response_invalid');
      return batch;
    },
    async advanceBatch(roomId: string, messageId: string, input: z.infer<typeof mixedBatchAdvanceSchema>, userId: string, signal: AbortSignal) {
      const body = checked(mixedBatchAdvanceSchema, input);
      const batch = checked(batchReply, await request('/' + identifier(roomId) + '/messages/' + identifier(messageId) + '/task-batch/advance', 'POST', userId, signal, body)).batch;
      if (!batch || batch.digest !== body.digest) throw new MixedChatApiError(0, 'mixed_chat_response_invalid');
      return batch;
    },
  };
}
export type MixedChatApi = ReturnType<typeof createMixedChatApi>;
