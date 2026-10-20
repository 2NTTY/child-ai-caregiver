import { createHash } from 'node:crypto';
import { CHAT_FILE_LIMITS, chatFileMetadataSchema, type ChatFileMetadata } from '../src/shared/chat-files.ts';

export class ChatFileError extends Error {
  readonly code: 'invalid_chat_file' | 'chat_file_validation_unavailable';
  constructor(code: ChatFileError['code']) { super(code); this.name = 'ChatFileError'; this.code = code; }
}
/** Store arbitrary files as opaque bytes. Parsing is separate and never executes a selected file. */
export function decodeChatFileBase64(base64: string): Buffer {
  if (!base64 || base64.length > Math.ceil(CHAT_FILE_LIMITS.bytes / 3) * 4 || base64.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/u.test(base64)) throw new ChatFileError('invalid_chat_file');
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > CHAT_FILE_LIMITS.bytes || bytes.toString('base64') !== base64) throw new ChatFileError('invalid_chat_file');
  return bytes;
}
export async function validateChatFile(base64: string, mimeType: string, signal?: AbortSignal): Promise<{ buffer: Buffer; metadata: ChatFileMetadata }> {
  if (signal?.aborted) throw new ChatFileError('chat_file_validation_unavailable');
  const buffer = decodeChatFileBase64(base64);
  const parsed = chatFileMetadataSchema.safeParse({ mimeType, bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') });
  if (!parsed.success) throw new ChatFileError('invalid_chat_file');
  return { buffer, metadata: parsed.data };
}
