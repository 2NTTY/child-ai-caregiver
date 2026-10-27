import { Directory, File, Paths } from "expo-file-system";
import { CHAT_FILE_LIMITS, normalizeChatFileMime } from "../../../../src/shared/chat-files";
import { localFileAttachment } from "./file-attachment";
import { withNativePickedFile } from "./native-picked-file";

/** Own only our copy; never delete a file chosen from the user's library. */
export async function copyNativeFile(file: File, declaredMime: string, fileName: string) {
  const mimeType = normalizeChatFileMime(declaredMime);
  if (!mimeType || file.size < 1 || file.size > CHAT_FILE_LIMITS.bytes) throw new Error("invalid_file");
  const bytes = await file.bytes();
  if (!bytes.length || bytes.length > CHAT_FILE_LIMITS.bytes) throw new Error("invalid_file");
  const folder = new Directory(Paths.cache, "yuyoufang-file-drafts");
  folder.create({ intermediates: true, idempotent: true });
  // Crash leftovers are local drafts, not a durable business store.
  for (const item of folder.list()) if (item instanceof File && (item.creationTime ?? item.lastModified ?? 0) < Date.now() - 24 * 60 * 60 * 1000) item.delete();
  if (folder.list().length >= 8) throw new Error("file_cache_full");
  const owned = new File(folder, `${crypto.randomUUID()}.bin`);
  owned.create();
  try {
    owned.write(bytes);
    return localFileAttachment({ fileName, mimeType, bytes: bytes.length, uri: owned.uri,
      readBytes: () => owned.bytes(), release: () => { try { if (owned.exists) owned.delete(); } catch { /* Remains an inaccessible local cache copy; next bounded cleanup retries. */ } } });
  } catch (error) { if (owned.exists) owned.delete(); throw error; }
}
export async function pickNativeFile() {
  const chosen = await File.pickFileAsync({ mimeTypes: "*/*", multipleFiles: false });
  if (chosen.canceled) return null;
  const file = chosen.result;
  return withNativePickedFile(file, CHAT_FILE_LIMITS.bytes, copyNativeFile);
}
