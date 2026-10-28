import { AppState, Linking, Platform } from 'react-native';
import { getSharedPayloads, clearSharedPayloads } from 'expo-sharing';
import { File } from 'expo-file-system';
import appConfig from '../../app.json';
import { CHAT_FILE_LIMITS } from '../../../src/shared/chat-files';
import { normalizeVoiceMimeType } from '../../../src/shared/voice';
import type { IncomingSharePayload, IncomingSharePlatform } from '../incoming-share';
import { photoAttachment } from '../assistant-draft';
import { withNativePickedFile } from '../components/agent/native-picked-file';
import { copyNativeFile } from '../components/agent/native-chat-file';
import { copyNativeVoice } from '../components/agent/native-voice-file';
import { photoOriginalFromBytes } from '../production/photo-original';

function photoMime(bytes: Uint8Array): 'image/jpeg' | 'image/png' | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return png.every((value, index) => bytes[index] === value) ? 'image/png' : null;
}

async function prepare(payload: IncomingSharePayload) {
  if (Platform.OS !== 'android') throw new Error('incoming_share_unavailable');
  // External file paths could target this app's private storage. Accept external provider URIs instead.
  if (!['image', 'audio', 'video', 'file'].includes(payload.shareType)
    || !payload.value.startsWith('content://')) throw new Error('incoming_share_content_uri_required');
  const uri = new URL(payload.value);
  if (uri.username || uri.password || uri.port || !uri.hostname) throw new Error('incoming_share_content_uri_required');
  const authority = decodeURIComponent(uri.hostname).toLowerCase(), applicationId = appConfig.expo.android.package.toLowerCase();
  if (authority === applicationId || authority.startsWith(applicationId + '.')) throw new Error('incoming_share_own_provider_rejected');
  const original = new File(payload.value);
  return withNativePickedFile(original, CHAT_FILE_LIMITS.bytes, async (file, nativeMime, fileName) => {
    if (!file.exists || file.size < 1 || file.size > CHAT_FILE_LIMITS.bytes) throw new Error('invalid_file');
    const concrete = nativeMime && !['*/*', 'application/octet-stream'].includes(nativeMime);
    let mimeType = (concrete ? nativeMime : payload.mimeType || nativeMime || 'application/octet-stream').toLowerCase().split(';', 1)[0]!.trim();
    if (payload.shareType === 'image' || mimeType.startsWith('image/')) {
      const bytes = await file.bytes();
      if (!bytes.length || bytes.length > CHAT_FILE_LIMITS.bytes) throw new Error('invalid_file');
      const actual = photoMime(bytes);
      if (actual) return photoAttachment(await photoOriginalFromBytes(bytes, fileName, actual));
      // Unsupported image originals remain files. Do not label unknown bytes as JPEG/PNG.
      if (mimeType === 'image/jpeg' || mimeType === 'image/png') mimeType = 'application/octet-stream';
    }
    return normalizeVoiceMimeType(mimeType) ? copyNativeVoice(file, mimeType, fileName) : copyNativeFile(file, mimeType, fileName);
  });
}

/** Raw Android input only; URL values remain text and are never resolved or fetched. */
export function createIncomingSharePlatform(): IncomingSharePlatform {
  return {
    read: () => Platform.OS === 'android' ? getSharedPayloads() : [],
    clear() { if (Platform.OS === 'android') clearSharedPayloads(); },
    subscribe(listener) {
      if (Platform.OS !== 'android') return () => {};
      const app = AppState.addEventListener('change', state => { if (state === 'active') listener(); });
      const link = Linking.addEventListener('url', () => listener());
      return () => { app.remove(); link.remove(); };
    },
    prepare,
  };
}
