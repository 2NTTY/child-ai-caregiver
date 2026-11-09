import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { Image } from 'react-native';
import type { AvatarPolicy } from '../../../src/shared/avatars.ts';
import { avatarImageHeader, type AvatarImage } from '../avatar-image';
import { photoPreview } from './photo-bytes';

export async function pickAvatarImage(policy: AvatarPolicy, signal: AbortSignal): Promise<AvatarImage | null> {
  if (signal.aborted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], shape: 'rectangle', allowsMultipleSelection: false, base64: false, exif: false, quality: 1 });
  if (signal.aborted || result.canceled) return null;
  const asset = result.assets[0];
  if (!asset?.uri.startsWith('file://')) throw new Error('avatar_picker_unavailable');
  const file = new File(asset.uri);
  if (!file.exists || !file.size || file.size > policy.maxInputBytes) throw new Error('avatar_input_too_large');
  const bytes = await file.bytes();
  const abort = () => bytes.fill(0); signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) { bytes.fill(0); return null; }
    const header = avatarImageHeader(bytes, policy), size = await Image.getSize(asset.uri);
    if (signal.aborted) return null;
    if (size.width !== header.width || size.height !== header.height) throw new Error('avatar_orientation_unavailable');
    const preview = photoPreview(bytes, header.mimeType);
    // Short-lived memory only; do not delete or persist the system picker result.
    return { ...header, ...preview, bytes, dispose() { preview.dispose(); bytes.fill(0); } };
  } catch (error) { bytes.fill(0); throw error; } finally { signal.removeEventListener('abort', abort); }
}
