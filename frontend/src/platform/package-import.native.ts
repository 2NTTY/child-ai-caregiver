import { Directory, File, Paths } from 'expo-file-system';
import { CHAT_FILE_LIMITS } from '../../../src/shared/chat-files';
import { HANDOVER_UPLOAD_MAX_BYTES } from '../../../src/shared/handover-uploads';
import type { SelectedPackage } from '../production/HandoverImportOwner';
import { withNativePickedFile } from '../components/agent/native-picked-file';
import { packageHash } from './package-import-hash';
import { registerPackageCacheBody, supportsPackageCacheBody } from './package-cache-body.native';

// Older binaries retain their original buffered attachment bound.
export const PACKAGE_IMPORT_MAX_BYTES = supportsPackageCacheBody() ? HANDOVER_UPLOAD_MAX_BYTES : CHAT_FILE_LIMITS.bytes;
const nativeSizeError = () => Object.assign(new Error('package_native_size_exceeded'), { maxBytes: PACKAGE_IMPORT_MAX_BYTES });
export async function pickImportPackage(signal: AbortSignal): Promise<SelectedPackage | null> {
  signal.throwIfAborted();
  const chosen = await File.pickFileAsync({ mimeTypes: '*/*', multipleFiles: false });
  signal.throwIfAborted(); if (chosen.canceled) return null;
  return prepareImportPackage(chosen.result, signal);
}
/** Picker and explicit Android share choices use the same bounded, disposable package copy. */
export async function prepareImportPackage(file: File, signal: AbortSignal): Promise<SelectedPackage> {
  signal.throwIfAborted();
  if (file.size > PACKAGE_IMPORT_MAX_BYTES) throw nativeSizeError();
  return withNativePickedFile(file, PACKAGE_IMPORT_MAX_BYTES, async (source, _mime, filename) => {
    if (!/\.zip$/iu.test(filename) || source.size < 1 || source.size > PACKAGE_IMPORT_MAX_BYTES) throw new Error('invalid_package_file');
    const folder = new Directory(Paths.cache, 'yuyoufang-package-imports'); folder.create({ intermediates: true, idempotent: true });
    for (const file of folder.list()) if (file instanceof File && (file.creationTime ?? file.lastModified ?? 0) < Date.now() - 86_400_000) file.delete();
    if (folder.list().length >= 4) throw new Error('package_local_cache_full');
    const owned = new File(folder, `${crypto.randomUUID()}.zip`);
    let body: Awaited<ReturnType<File['bytes']>> | undefined;
    try {
      signal.throwIfAborted();
      // The provider helper owns this temporary copy and deletes its empty directory afterwards.
      if (supportsPackageCacheBody() && file.uri.startsWith('content://')) await source.move(owned);
      else await source.copy(owned);
      signal.throwIfAborted();
      const bytes = owned.size;
      if (bytes < 1 || bytes > PACKAGE_IMPORT_MAX_BYTES) throw nativeSizeError();
      const sha256 = await packageHash(owned.readableStream(), bytes, signal);
      if (!owned.exists || owned.size !== bytes) throw new Error('invalid_package_file');
      if (supportsPackageCacheBody()) {
        const unregister = registerPackageCacheBody(owned);
        return { filename, bytes, sha256, body: owned, release() { unregister(); if (owned.exists) owned.delete(); } };
      }
      // A byte body preserves the API's application/zip header (Expo may override a Blob MIME).
      body = await owned.bytes(); signal.throwIfAborted();
      if (body.length !== bytes) throw new Error('invalid_package_file');
      const content = body;
      return { filename, bytes, sha256, body: content, release() { content.fill(0); if (owned.exists) owned.delete(); } };
    } catch (error) { body?.fill(0); if (owned.exists) owned.delete(); throw error; }
  });
}
