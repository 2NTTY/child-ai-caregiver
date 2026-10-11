import { readServerHttpConfig, type ServerHttpConfig } from './config.ts';

export interface FirebaseServerConfig extends ServerHttpConfig {
  projectId: string;
  databaseId: string;
  namespace: string;
  sessionNamespace: string;
  authEmailEnabled: boolean;
}

/** Explicit deployment identities prevent accidental use of a default or unrelated database. */
export function readFirebaseServerConfig(env: Record<string, string | undefined>): FirebaseServerConfig {
  const http = readServerHttpConfig(env);
  if (env.FIREBASE_AUTH_EMAIL_ENABLED !== undefined && !['true', 'false'].includes(env.FIREBASE_AUTH_EMAIL_ENABLED)) throw new Error('Invalid FIREBASE_AUTH_EMAIL_ENABLED configuration');
  const projectId = env.GCP_PROJECT_ID;
  const databaseId = env.FIREBASE_DATABASE_ID;
  const namespace = env.FIREBASE_NAMESPACE;
  if (!projectId || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(projectId)) throw new Error('Invalid GCP_PROJECT_ID configuration');
  if (!databaseId || !/^[a-z][a-z0-9-]{2,61}[a-z0-9]$/u.test(databaseId)) throw new Error('Invalid FIREBASE_DATABASE_ID configuration');
  if (!namespace || !/^[a-z][a-z0-9_]{0,47}$/u.test(namespace)) throw new Error('Invalid FIREBASE_NAMESPACE configuration');
  if (http.production && (env.FIRESTORE_EMULATOR_HOST !== undefined || env.FIREBASE_AUTH_EMULATOR_HOST !== undefined)) {
    throw new Error('Emulator configuration is forbidden in production');
  }
  if (http.publicOrigin !== http.webOrigin) throw new Error('Firebase deployment requires a same-origin frontend');
  return { ...http, projectId, databaseId, namespace, sessionNamespace: namespace + '_sessions', authEmailEnabled: env.FIREBASE_AUTH_EMAIL_ENABLED === 'true' };
}

export function serverStorageBackend(env: Record<string, string | undefined>): 'postgres' | 'firestore' {
  const backend = env.STORAGE_BACKEND ?? 'postgres';
  if (backend !== 'postgres' && backend !== 'firestore') throw new Error('Invalid STORAGE_BACKEND configuration');
  return backend;
}
