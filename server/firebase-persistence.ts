import { Firestore } from '@google-cloud/firestore';
import { createStorageCipher } from './storage-crypto.ts';
import { readFirebaseStorageKey } from './firebase-storage-key.ts';
import { createFirestoreAuthority } from './firestore-authority.ts';
import { readFirebaseServerConfig } from './firebase-config.ts';

/** Shared production assembly for the HTTP server and the explicitly invoked operator CLI. */
export async function openFirebasePersistence(env: Record<string, string | undefined>) {
  const config = readFirebaseServerConfig(env);
  const key = await readFirebaseStorageKey(env);
  let cipher: ReturnType<typeof createStorageCipher>;
  try { cipher = createStorageCipher(key); } finally { key.fill(0); }
  const database = new Firestore({ projectId: config.projectId, databaseId: config.databaseId });
  const authority = createFirestoreAuthority({ database, cipher, projectId: config.projectId, namespace: config.namespace });
  return { config, cipher, database, authority, close: () => database.terminate() };
}
