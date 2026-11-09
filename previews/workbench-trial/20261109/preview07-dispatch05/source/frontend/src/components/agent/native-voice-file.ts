import { Directory, File, Paths } from "expo-file-system";
import { VOICE_LIMITS, normalizeVoiceMimeType } from "../../../../src/shared/voice";
import { localVoiceAttachment } from "./voice-attachment";
import { withNativePickedFile } from "./native-picked-file";

/** Own only our copy; never delete a file chosen from the user's library. */
export async function copyNativeVoice(file: File, declaredMime: string, fileName: string) {
  const mimeType = normalizeVoiceMimeType(declaredMime);
  if (!mimeType || file.size < 1 || file.size > VOICE_LIMITS.bytes) throw new Error("invalid_voice");
  const bytes = await file.bytes();
  if (!bytes.length || bytes.length > VOICE_LIMITS.bytes) throw new Error("invalid_voice");
  const folder = new Directory(Paths.cache, "yuyoufang-voice-drafts");
  folder.create({ intermediates: true, idempotent: true });
  // Crash leftovers are local drafts, not a durable business store.
  for (const item of folder.list()) if (item instanceof File && (item.creationTime ?? item.lastModified ?? 0) < Date.now() - 24 * 60 * 60 * 1000) item.delete();
  if (folder.list().length >= 8) throw new Error("voice_cache_full");
  const extension = mimeType === "audio/mp4" ? "m4a" : mimeType === "audio/mpeg" ? "mp3" : mimeType.split("/")[1]!;
  const owned = new File(folder, `${crypto.randomUUID()}.${extension}`);
  owned.create();
  try {
    owned.write(bytes);
    return localVoiceAttachment({ fileName, mimeType, bytes: bytes.length, uri: owned.uri,
      readBytes: () => owned.bytes(), release: () => { try { if (owned.exists) owned.delete(); } catch { /* Remains an inaccessible local cache copy; next bounded cleanup retries. */ } } });
  } catch (error) { if (owned.exists) owned.delete(); throw error; }
}
export async function pickNativeVoice() {
  const chosen = await File.pickFileAsync({ mimeTypes: "audio/*", multipleFiles: false });
  if (chosen.canceled) return null;
  const file = chosen.result;
  return withNativePickedFile(file, VOICE_LIMITS.bytes, copyNativeVoice);
}
