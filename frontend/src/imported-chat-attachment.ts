import type { ImportedChatMessage } from '../../src/shared/chat-imports.ts';
import type { ChatFileAttachment, ChatFileMessageReference } from '../../src/shared/chat-files.ts';
import type { VoiceAttachment, VoiceMessageReference } from '../../src/shared/voice.ts';
import type { PhotoAttachment, PhotoMessageReference } from '../../src/shared/photos.ts';

export type ImportedAttachmentMetadata =
  | { kind: 'files'; value: ChatFileAttachment }
  | { kind: 'voices'; value: VoiceAttachment }
  | { kind: 'photos'; value: PhotoAttachment };
export type ImportedAttachmentView =
  | { kind: 'files'; reference: ChatFileMessageReference; messageId: string | null }
  | { kind: 'voices'; reference: VoiceMessageReference; messageId: string | null }
  | { kind: 'photos'; reference: PhotoMessageReference };

/** A source reference is evidence of bytes, never a local attachment address. */
export function importedAttachmentView(item: Pick<ImportedChatMessage, 'childId' | 'attachment' | 'message'>, metadata: ImportedAttachmentMetadata): ImportedAttachmentView | null {
  const binding = item.attachment, actual = metadata.value;
  const source = metadata.kind === 'files' ? item.message.file : metadata.kind === 'voices' ? item.message.voice : item.message.photo;
  if (!binding || binding.kind !== metadata.kind || !source || actual.id !== binding.resource.id
    || actual.childId !== item.childId || actual.version < binding.resource.version || actual.state !== 'ready'
    || actual.sharedSpaceId !== undefined || actual.sha256 !== source.sha256 || actual.bytes !== source.bytes
    || actual.mimeType !== source.mimeType) return null;
  if (metadata.kind === 'files') return { kind: 'files', messageId: metadata.value.messageId,
    reference: { ...item.message.file!, id: actual.id, version: actual.version } };
  if (metadata.kind === 'voices') return metadata.value.durationMs === item.message.voice!.durationMs
    ? { kind: 'voices', messageId: metadata.value.messageId, reference: { ...item.message.voice!, id: actual.id, version: actual.version } } : null;
  if (metadata.value.recoveryPending || metadata.value.visibility !== 'private') return null;
  return { kind: 'photos', reference: { id: actual.id, version: actual.version,
    fileName: metadata.value.fileName, source: metadata.value.source,
    sha256: metadata.value.sha256, bytes: metadata.value.bytes, mimeType: metadata.value.mimeType } };
}
