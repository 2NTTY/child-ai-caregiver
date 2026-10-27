import { chatFileAttachmentPageSchema, type ChatFileAttachmentPage } from '../shared/chat-files.ts';
import { attachmentListQuerySchema, type AttachmentListQuery } from '../shared/attachment-list.ts';
import { z } from 'zod';
import { CHAT_FILE_LIMITS, chatFileAttachmentSchema, chatFileReservationSchema, type ChatFileAttachment, type ChatFileReservation } from '../shared/chat-files.ts';
import { readBlobBytes, sha256Bytes } from './blob-bytes.ts';
import { sharedSelectionSchema, type SharedSelection } from '../shared/sharing.ts';

export class ChatFileApiError extends Error {
  readonly status: number; readonly code: string;
  constructor(status: number, code: string) { super('File operation could not be confirmed'); this.name = 'ChatFileApiError'; this.status = status; this.code = code; }
}
export function createChatFileApi(fetcher: typeof fetch, origin = '', hash: typeof sha256Bytes = sha256Bytes, selection?: SharedSelection) {
  const sharing = selection === undefined ? undefined : sharedSelectionSchema.parse(selection);
  const apiRoot=origin.replace(/\/$/u,'').replace(/\/api$/u,'')+'/api';
  const base = (childId: string, id?: string) => apiRoot + '/children/' + z.uuid().parse(childId) + '/files' + (id ? '/' + z.uuid().parse(id) : '');
  const matchesSelection = (file: ChatFileAttachment) => sharing
    ? file.sharedSpaceId === sharing.spaceId && file.messageId === null
    : file.sharedSpaceId === undefined;
  const writable = () => { if (sharing) throw new ChatFileApiError(403, 'shared_attachment_write_unavailable'); };
  async function request(url: string, userId: string, signal: AbortSignal, payload?: unknown, sharedDelete = false) {
    if (payload !== undefined && !sharedDelete) writable();
    if (sharing) url += (url.includes('?') ? '&' : '?') + new URLSearchParams({ spaceId: sharing.spaceId });
    if (!userId || signal.aborted) throw new ChatFileApiError(0, 'identity_changed');
    let response: Response;
    try { response = await fetcher(url, { method: payload === undefined ? 'GET' : 'POST', credentials: 'include', cache: 'no-store', signal,
      headers: { 'x-expected-user-id': userId, ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) }); }
    catch { throw new ChatFileApiError(0, 'file_operation_unknown'); }
    if (signal.aborted) throw new ChatFileApiError(0, 'identity_changed');
    if (!response.ok) {
      let code = 'file_unavailable';
      try { const body = await response.json(); const candidate = body?.code ?? body?.error?.code; if (typeof candidate === 'string' && /^[a-z_]{1,80}$/u.test(candidate)) code = candidate; } catch { /* Status remains available. */ }
      throw new ChatFileApiError(response.status, code);
    }
    return response;
  }
  async function checked(response: Response, childId: string, id: string, signal: AbortSignal): Promise<ChatFileAttachment> {
    let raw: unknown; try { raw = await response.json(); } catch { throw new ChatFileApiError(0, 'file_operation_unknown'); }
    const parsed = z.object({ file: chatFileAttachmentSchema }).strict().safeParse(raw);
    if (signal.aborted) throw new ChatFileApiError(0, 'identity_changed');
    if (!parsed.success || parsed.data.file.id !== id || parsed.data.file.childId !== childId
      || !matchesSelection(parsed.data.file)) throw new ChatFileApiError(0, 'file_response_invalid');
    return parsed.data.file;
  }
  return {
    async list(childId: string, query: AttachmentListQuery, signal: AbortSignal, userId: string): Promise<ChatFileAttachmentPage> {
      const input = attachmentListQuerySchema.parse(query), params = new URLSearchParams();
      if (input.limit !== undefined) params.set('limit', String(input.limit));
      if (input.cursor != null) params.set('cursor', input.cursor);
      const response = await request(base(childId) + (params.size ? '?' + params : ''), userId, signal);
      let raw: unknown; try { raw = await response.json(); } catch { throw new ChatFileApiError(0, 'file_response_invalid'); }
      if (signal.aborted) throw new ChatFileApiError(0, 'identity_changed');
      const page = chatFileAttachmentPageSchema.safeParse(raw);
      if (!page.success || page.data.items.some(item => item.childId !== childId || !matchesSelection(item))
        || input.limit !== undefined && page.data.items.length > input.limit
        || input.cursor != null && page.data.nextCursor === input.cursor) throw new ChatFileApiError(0, 'file_response_invalid');
      return page.data;
    },
    // The owner retains opId across unknown submissions. Never generate a replacement ID here.
    async reserve(childId: string, input: ChatFileReservation, signal: AbortSignal, userId: string) {
      writable();
      const payload = chatFileReservationSchema.parse(input);
      return checked(await request(base(childId), userId, signal, payload), childId, payload.opId, signal);
    },
    async get(childId: string, id: string, signal: AbortSignal, userId: string) {
      return checked(await request(base(childId, id), userId, signal), childId, id, signal);
    },
    async upload(file: ChatFileAttachment, base64: string, signal: AbortSignal, userId: string) {
      writable();
      return checked(await request(base(file.childId, file.id) + '/content', userId, signal, { expectedVersion: file.version, base64 }), file.childId, file.id, signal);
    },
    async resolve(childId: string, id: string, signal: AbortSignal, userId: string) {
      writable();
      return checked(await request(base(childId, id) + '/resolve', userId, signal, {}), childId, id, signal);
    },
    async delete(file: ChatFileAttachment, opId: string, signal: AbortSignal, userId: string) {
      if (!matchesSelection(file)) throw new ChatFileApiError(0, 'file_response_invalid');
      const response = await request(base(file.childId, file.id) + '/delete', userId, signal, { opId: z.uuid().parse(opId), expectedVersion: file.version }, true);
      const result = z.object({ operationId: z.uuid(), deleted: z.literal(true), cleanupPending: z.boolean() }).strict().safeParse(await response.json());
      if (signal.aborted || !result.success || result.data.operationId !== opId) throw new ChatFileApiError(0, 'file_operation_unknown');
      return result.data;
    },
    async content(file: ChatFileAttachment, signal: AbortSignal, userId: string) {
      if (!matchesSelection(file)) throw new ChatFileApiError(0, 'file_response_invalid');
      if (file.state !== 'ready' || !file.bytes || !file.sha256 || !file.mimeType) throw new ChatFileApiError(409, 'file_not_available');
      const response = await request(base(file.childId, file.id) + '/content', userId, signal);
      if (response.headers.get('content-type') !== 'application/octet-stream' || response.headers.get('x-content-sha256') !== file.sha256
        || response.headers.get('content-length') !== String(file.bytes)) throw new ChatFileApiError(0, 'file_response_invalid');
      const blob = await response.blob();
      if (blob.size !== file.bytes || blob.size > CHAT_FILE_LIMITS.bytes) throw new ChatFileApiError(0, 'file_response_invalid');
      const bytes = await readBlobBytes(blob);
      if (await hash(bytes) !== file.sha256 || signal.aborted) throw new ChatFileApiError(0, 'file_response_invalid');
      return { bytes, mimeType: file.mimeType };
    },
  };
}
export type ChatFileApi = ReturnType<typeof createChatFileApi>;
