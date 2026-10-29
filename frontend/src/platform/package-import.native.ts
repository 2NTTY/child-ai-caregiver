import { Directory, File, Paths } from 'expo-file-system';
import { CHAT_FILE_LIMITS } from '../../../src/shared/chat-files';
import type { SelectedPackage } from '../production/HandoverImportOwner';
import { withNativePickedFile } from '../components/agent/native-picked-file';
import { packageHash } from './package-import-hash';

// The installed Expo fetch buffers request bodies. Keep the existing native attachment bound
// until a streaming transport can preserve session identity, cancellation and redirect rejection.
export const PACKAGE_IMPORT_MAX_BYTES = CHAT_FILE_LIMITS.bytes;
export async function pickImportPackage(signal: AbortSignal): Promise<SelectedPackage | null> {
  signal.throwIfAborted();
  const chosen = await File.pickFileAsync({ mimeTypes: '*/*', multipleFiles: false });
  signal.throwIfAborted(); if (chosen.canceled) return null;
  if (chosen.result.size > PACKAGE_IMPORT_MAX_BYTES) throw new Error('package_native_size_exceeded');
  return withNativePickedFile(chosen.result, PACKAGE_IMPORT_MAX_BYTES, async (source, _mime, filename) => {
    if (!/\.zip$/iu.test(filename) || source.size < 1 || source.size > PACKAGE_IMPORT_MAX_BYTES) throw new Error('invalid_package_file');
    const folder = new Directory(Paths.cache, 'yuyoufang-package-imports'); folder.create({ intermediates: true, idempotent: true });
    for (const file of folder.list()) if (file instanceof File && (file.creationTime ?? file.lastModified ?? 0) < Date.now() - 86_400_000) file.delete();
    if (folder.list().length >= 4) throw new Error('package_local_cache_full');
    const owned = new File(folder, `${crypto.randomUUID()}.zip`);
    try {
      signal.throwIfAborted(); await source.copy(owned); signal.throwIfAborted();
      const bytes = owned.size, sha256 = await packageHash(owned.readableStream(), bytes, signal);
      // A byte body preserves the API's application/zip header (Expo may override a Blob MIME).
      const body = await owned.bytes(); signal.throwIfAborted();
      return { filename, bytes, sha256, body, release() { body.fill(0); if (owned.exists) owned.delete(); } };
    } catch (error) { if (owned.exists) owned.delete(); throw error; }
  });
}
