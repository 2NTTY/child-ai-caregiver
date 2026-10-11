import { readSecretKey } from './storage-crypto.ts';

/** Secret Manager values are canonical base64; never log or include values in errors. */
export function decodeFirebaseStorageKey(encoded: string): Buffer {
  if (typeof encoded !== 'string' || encoded.length !== 44) throw new Error('Storage key unavailable or invalid');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) {
    key.fill(0); throw new Error('Storage key unavailable or invalid');
  }
  return key;
}

/** Cloud Run uses a pinned Secret Manager environment reference; operator files retain strict permissions. */
export async function readFirebaseStorageKey(env: Record<string, string | undefined>): Promise<Buffer> {
  const value = env.YUBAN_FIREBASE_STORAGE_KEY;
  if (value !== undefined) {
    if (env.STORAGE_KEY_FILE !== undefined) throw new Error('Ambiguous storage key configuration');
    return decodeFirebaseStorageKey(value);
  }
  return readSecretKey(env.STORAGE_KEY_FILE);
}
