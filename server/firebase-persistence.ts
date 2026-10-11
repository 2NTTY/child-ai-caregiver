import { Firestore } from '@google-cloud/firestore';
import { createStorageCipher, readSecretKey } from './storage-crypto.ts';
import { createFirestoreAuthority } from './firestore-authority.ts';
import { readFirebaseServerConfig } from './firebase-config.ts';

/** Shared production assembly for the HTTP server and the explicitly invoked operator CLI. */
export async function openFirebasePersistence(env: Record<string, string | undefined>) {
  const config = readFirebaseServerConfig(env);
  const cipher = createStorageCipher(await readSecretKey(env.STORAGE_KEY_FILE));
  const database = new Firestore({ projectId: config.projectId, databaseId: config.databaseId });
  const authority = createFirestoreAuthority({ database, cipher, projectId: config.projectId, namespace: config.namespace });
  return { config, cipher, database, authority, close: () => database.terminate() };
}
