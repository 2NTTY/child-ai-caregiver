import { z } from 'zod';
import type { FirestoreChatFilesStore } from './firestore-chat-files.ts';
import { domainReject } from './firestore-domain-data.ts';
import { readChatFile } from './chat-file-reader.ts';

export const agentChatFileReadSchema = z.object({ id: z.uuid(), expectedVersion: z.number().int().min(1),
  page: z.number().int().min(1).nullable().optional(), offset: z.number().int().min(0).nullable().optional() }).strict();
/** Read a submitted private original, then recheck its authority after extraction. */
export function createChatFileAgentReader(store: Pick<FirestoreChatFilesStore, 'get' | 'contentForMessage'>) {
  return async (userId: string, childId: string, input: z.infer<typeof agentChatFileReadSchema>, signal?: AbortSignal) => {
    const args = agentChatFileReadSchema.parse(input), file = await store.get(userId, childId, args.id);
    if (file.state === 'deleted' || file.state === 'deleting') domainReject('chat_file_deleted', 410);
    if (file.version !== args.expectedVersion) domainReject('version_conflict');
    if (file.state !== 'ready' || !file.messageId || !file.fileName || !file.sha256 || !file.mimeType || !file.bytes)
      domainReject('chat_file_not_available');
    const reference = { id: file.id, version: file.version, sha256: file.sha256, mimeType: file.mimeType, bytes: file.bytes };
    const content = await store.contentForMessage(userId, childId, file.messageId, reference);
    let result;
    try { result = await readChatFile({ buffer: Buffer.from(content.base64, 'base64'), fileName: file.fileName,
      mimeType: file.mimeType, sha256: file.sha256 }, { page: args.page ?? undefined, offset: args.offset ?? undefined }, signal); }
    catch (error) {
      if (error instanceof Error && error.message === 'chat_file_invalid_range') domainReject('chat_file_invalid_range', 400);
      throw error;
    }
    const current = await store.get(userId, childId, file.id);
    if (current.state !== 'ready' || current.version !== file.version || current.sha256 !== file.sha256
      || current.messageId !== file.messageId) domainReject('chat_file_changed');
    return { file: { ...reference, fileName: file.fileName, messageId: file.messageId }, visibility: 'private' as const,
      sourceKind: 'user_attachment' as const, result };
  };
}
export type ChatFileAgentReader = ReturnType<typeof createChatFileAgentReader>;
