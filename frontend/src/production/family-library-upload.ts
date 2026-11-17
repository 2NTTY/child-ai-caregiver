import { randomUUID } from 'expo-crypto';
import { toByteArray } from 'base64-js';
import { createPhotoApi } from '../../../src/client/photo-api';
import { createChatFileApi } from '../../../src/client/chat-file-api';
import { createVoiceApi } from '../../../src/client/voice-api';
import { CHAT_FILE_LIMITS, normalizeChatFileMime } from '../../../src/shared/chat-files';
import { normalizeVoiceMimeType, VOICE_LIMITS } from '../../../src/shared/voice';
import { PHOTO_LIMITS } from '../../../src/shared/photos';
import type { SharedSelection } from '../../../src/shared/sharing';
import type { AssistantAttachment } from '../assistant-draft';
import { photoSha256 } from '../platform/photo-bytes';

export type LibraryUploadReference = { opId: string; kind: AssistantAttachment['kind']; fingerprint: string };

export function familyLibraryApi(fetcher: typeof fetch, base: string, sharing: SharedSelection) {
  return { photo: createPhotoApi(base, fetcher, photoSha256, sharing),
    voice: createVoiceApi(fetcher, base, photoSha256, sharing), file: createChatFileApi(fetcher, base, photoSha256, sharing) };
}

export async function saveLibraryOriginal(api: ReturnType<typeof familyLibraryApi>, selected: AssistantAttachment,
  childId: string, userId: string, signal: AbortSignal, current: () => boolean, previous: LibraryUploadReference | undefined,
  admitted: (ref: LibraryUploadReference) => void) {
  const { kind, fileName, bytes } = selected;
  const max = kind === 'photo' ? PHOTO_LIMITS.bytes : kind === 'voice' ? VOICE_LIMITS.bytes : CHAT_FILE_LIMITS.bytes;
  const read = selected.photo?.readBase64 ?? selected.readBase64;
  if (!read || bytes < 1 || bytes > max) throw Error('invalid_file');
  const base64 = await read();
  if (!current()) return;
  if (base64.length !== Math.ceil(bytes / 3) * 4) throw Error('invalid_file');
  const data = new Uint8Array(toByteArray(base64));
  if (data.length !== bytes) throw Error('invalid_file');
  const sha256 = await photoSha256(data);
  if (!current()) return;
  const fingerprint = JSON.stringify([kind, fileName, bytes, selected.mimeType, sha256]);
  if (previous && previous.fingerprint !== fingerprint) throw Error('original_changed');
  const opId = previous?.opId ?? randomUUID();
  const meta = { fileName, bytes, sha256, opId };
  const voiceMime = normalizeVoiceMimeType(selected.mimeType);
  if ((kind === 'voice' && !voiceMime) || (kind === 'photo' && !selected.photo)) throw Error('invalid_file');
  admitted({ opId, kind, fingerprint });
  if (kind === 'photo' && selected.photo) {
    const saved = await api.photo.reserveLibrary(childId, opId,
      { fileName, bytes, sha256, mimeType: selected.photo.mimeType, source: '家庭附件庫' }, signal, userId);
    if (!current()) return;
    return saved.state === 'ready' ? saved.state : (await api.photo.upload(saved, base64, signal, userId)).state;
  } else if (kind === 'voice' && voiceMime) {
    const saved = await api.voice.reserve(childId, { ...meta, mimeType: voiceMime }, signal, userId);
    if (!current()) return;
    return saved.state === 'reserved' ? (await api.voice.upload(saved, base64, signal, userId)).state : saved.state;
  } else {
    const saved = await api.file.reserve(childId, { ...meta, mimeType: normalizeChatFileMime(selected.mimeType) }, signal, userId);
    if (!current()) return;
    return saved.state === 'reserved' ? (await api.file.upload(saved, base64, signal, userId)).state : saved.state;
  }
}
