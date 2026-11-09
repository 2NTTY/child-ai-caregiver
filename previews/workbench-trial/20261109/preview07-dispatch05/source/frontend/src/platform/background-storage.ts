import type { PickedBackgroundImage } from "../background-view-model";

/** Device-local presentation preference, never a care-photo or Server API port. */
export interface BackgroundStorage {
  read(scope: string): Promise<PickedBackgroundImage | null>;
  save(scope: string, image: PickedBackgroundImage): Promise<PickedBackgroundImage>;
  remove(scope: string): Promise<void>;
}
const database = "yuyoufang-local-appearance-v1", store = "backgrounds";
const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
export const backgroundMaxBytes = 4 * 1024 * 1024;
function valid(blob: Blob) { return allowed.has(blob.type) && blob.size > 0 && blob.size <= backgroundMaxBytes; }
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("Local storage unavailable")); return; }
    const request = indexedDB.open(database, 1);
    let rejected = false;
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store); };
    request.onerror = () => reject(new Error("Local storage unavailable"));
    request.onblocked = () => { rejected = true; reject(new Error("Local storage blocked")); };
    request.onsuccess = () => { if (rejected) request.result.close(); else resolve(request.result); };
  });
}
async function access<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try { return await new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(store, mode), request = action(transaction.objectStore(store));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = transaction.onabort = () => reject(new Error("Local background transaction failed"));
  }); } finally { db.close(); }
}
function selected(blob: Blob): PickedBackgroundImage {
  if (!valid(blob)) throw new Error("Stored background invalid");
  const uri = URL.createObjectURL(blob); let released = false;
  return { uri, filename: "自選圖片", blob, dispose() { if (!released) { released = true; URL.revokeObjectURL(uri); } } };
}
export const backgroundStorage: BackgroundStorage = {
  async read(scope) {
    const value: unknown = await access("readonly", store => store.get(scope));
    if (value === undefined) return null;
    if (!(value instanceof Blob)) throw new Error("Stored background invalid");
    return selected(value);
  },
  async save(scope, image) {
    if (!image.blob || !valid(image.blob)) throw new Error("Background unavailable");
    // Commit the Blob transaction before replacing the visible image. No base64/localStorage.
    await access("readwrite", store => store.put(image.blob!, scope));
    return selected(image.blob);
  },
  async remove(scope) { await access("readwrite", store => store.delete(scope)); },
};
