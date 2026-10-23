import { Directory, File, Paths } from "expo-file-system";
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import type { PickedBackgroundImage } from "../background-view-model";

// Same local presentation port as Web; existing native modules, no runtime/config additions.
export const backgroundMaxBytes = 4 * 1024 * 1024;
const directory = () => new Directory(Paths.document, "yuyoufang-backgrounds");
const key = async (scope: string) => "background-" + await digestStringAsync(CryptoDigestAlgorithm.SHA256, scope);
async function metadata(scope: string) {
  if (!await SecureStore.isAvailableAsync()) throw new Error("Local storage unavailable");
  const id = await key(scope), raw = await SecureStore.getItemAsync(id);
  if (!raw) return { id, file: null };
  const name: unknown = JSON.parse(raw);
  if (typeof name !== "string" || !name.startsWith(id + "-") || !/^[a-z0-9-]+\.img$/.test(name)) throw new Error("Stored background invalid");
  return { id, file: new File(directory(), name) };
}
function selected(file: File): PickedBackgroundImage {
  if (!file.exists || file.size <= 0 || file.size > backgroundMaxBytes) throw new Error("Stored background invalid");
  return { uri: file.uri, filename: "自選圖片", dispose() {} }; // Only remove/replace owns durable-file deletion.
}
export const backgroundStorage = {
  async read(scope: string): Promise<PickedBackgroundImage | null> {
    const value = await metadata(scope); return value.file ? selected(value.file) : null;
  },
  async save(scope: string, image: PickedBackgroundImage): Promise<PickedBackgroundImage> {
    if (!image.uri.startsWith("file://")) throw new Error("Local image required");
    const previous = await metadata(scope), input = new File(image.uri);
    if (!input.exists || input.size <= 0 || input.size > backgroundMaxBytes) throw new Error("Background exceeds limit");
    const folder = directory(); folder.create({ intermediates: true, idempotent: true });
    const file = new File(folder, `${previous.id}-${randomUUID()}.img`);
    try {
      input.copy(file);
      const image = selected(file);
      // A small atomic secure-store pointer commits the new private file; never store photo bytes in key/value storage.
      await SecureStore.setItemAsync(previous.id, JSON.stringify(file.name), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
      try { if (previous.file?.exists) previous.file.delete(); } catch { /* Old file stays app-private; never expose its URI. */ }
      return image;
    } catch (error) { if (file.exists) file.delete(); throw error; }
  },
  async remove(scope: string): Promise<void> {
    const id = await key(scope);
    let file: File | null = null;
    try { file = (await metadata(scope)).file; } catch { /* Remove corrupt metadata without trusting a stored path. */ }
    await SecureStore.deleteItemAsync(id);
    if (file?.exists) file.delete();
  },
};
