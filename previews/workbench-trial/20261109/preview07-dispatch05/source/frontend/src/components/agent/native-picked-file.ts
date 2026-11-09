import { Directory, File, Paths } from "expo-file-system";

/** Android content URIs contain document IDs, not the provider's display name. */
export async function withNativePickedFile<T>(file: File, maxBytes: number,
  consume: (file: File, mimeType: string, fileName: string) => Promise<T>): Promise<T> {
  if (!file.uri.startsWith("content://")) return consume(file, file.type, file.name);
  if (file.size < 1 || file.size > maxBytes) throw new Error("invalid_file");
  const root = new Directory(Paths.cache, "yuyoufang-picked-files");
  root.create({ intermediates: true, idempotent: true });
  const now = Date.now();
  for (const entry of root.list()) {
    const created = Number(entry.name.split("-")[0]);
    if (entry instanceof Directory && created > 0 && created < now - 24 * 60 * 60 * 1000) entry.delete();
  }
  if (root.list().length >= 8) throw new Error("file_cache_full");
  const temporary = new Directory(root, `${now}-${crypto.randomUUID()}`);
  temporary.create();
  try {
    // The SDK's native copy resolves the provider display name when targeting a directory.
    await file.copy(temporary);
    const entries = temporary.list();
    if (entries.length !== 1 || !(entries[0] instanceof File)) throw new Error("invalid_file");
    return await consume(entries[0], file.type, entries[0].name);
  } finally {
    try { temporary.delete(); } catch { /* Bounded cache cleanup retries after expiry. */ }
  }
}
