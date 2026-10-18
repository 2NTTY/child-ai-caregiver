import { readServerHttpConfig, type ServerHttpConfig } from './config.ts';
import { isIP } from 'node:net';

export interface FirebaseServerConfig extends ServerHttpConfig {
  projectId: string;
  databaseId: string;
  namespace: string;
  sessionNamespace: string;
  authEmailEnabled: boolean;
  photoBucket: string;
  erasureBucket: string;
  taskWorkerEnabled: boolean;
  knowledgeSourceIds: readonly string[] | null;
}
function bucket(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (!value || value.length < 3 || value.length > (value.includes('.') ? 222 : 63) || !/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/u.test(value)
    || value.split('.').some(part => !part.length || part.length > 63) || isIP(value) !== 0 || value.startsWith('goog') || /google|g00gle/u.test(value)) {
    throw new Error('Invalid ' + key + ' configuration');
  }
  return value;
}

/** Explicit deployment identities prevent accidental use of a default or unrelated database. */
export function readFirebaseServerConfig(env: Record<string, string | undefined>): FirebaseServerConfig {
  const http = readServerHttpConfig(env);
  if (env.FIREBASE_AUTH_EMAIL_ENABLED !== undefined && !['true', 'false'].includes(env.FIREBASE_AUTH_EMAIL_ENABLED)) throw new Error('Invalid FIREBASE_AUTH_EMAIL_ENABLED configuration');
  if (env.FIREBASE_TASK_WORKER_ENABLED !== undefined && !['true', 'false'].includes(env.FIREBASE_TASK_WORKER_ENABLED)) throw new Error('Invalid FIREBASE_TASK_WORKER_ENABLED configuration');
  const projectId = env.GCP_PROJECT_ID;
  const databaseId = env.FIREBASE_DATABASE_ID;
  const namespace = env.FIREBASE_NAMESPACE;
  if (!projectId || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(projectId)) throw new Error('Invalid GCP_PROJECT_ID configuration');
  const localDefault = databaseId === '(default)' && env.YUYF_LOCAL_DEVELOPMENT === '1' && !http.production && projectId.startsWith('demo-');
  if (!databaseId || !localDefault && !/^[a-z][a-z0-9-]{2,61}[a-z0-9]$/u.test(databaseId)) throw new Error('Invalid FIREBASE_DATABASE_ID configuration');
  if (!namespace || !/^[a-z][a-z0-9_]{0,47}$/u.test(namespace)) throw new Error('Invalid FIREBASE_NAMESPACE configuration');
  const photoBucket = bucket(env, 'FIREBASE_PHOTO_BUCKET'), erasureBucket = bucket(env, 'FIREBASE_ERASURE_BUCKET');
  if (photoBucket === erasureBucket) throw new Error('Firebase photo and erasure buckets must differ');
  const knowledgeSourceIds = env.FIREBASE_KNOWLEDGE_SOURCE_IDS === undefined ? null : env.FIREBASE_KNOWLEDGE_SOURCE_IDS.split(',');
  if (knowledgeSourceIds !== null && (knowledgeSourceIds.length < 1 || knowledgeSourceIds.length > 10
    || knowledgeSourceIds.some(id => !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(id)) || new Set(knowledgeSourceIds).size !== knowledgeSourceIds.length)) {
    throw new Error('Invalid FIREBASE_KNOWLEDGE_SOURCE_IDS configuration');
  }
  if (http.production && ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST', 'STORAGE_EMULATOR_HOST', 'YUYF_LOCAL_DEVELOPMENT'].some(key => env[key] !== undefined)) {
    throw new Error('Emulator configuration is forbidden in production');
  }
  if (http.publicOrigin !== http.webOrigin) throw new Error('Firebase deployment requires a same-origin frontend');
  return { ...http, projectId, databaseId, namespace, sessionNamespace: namespace + '_sessions', authEmailEnabled: env.FIREBASE_AUTH_EMAIL_ENABLED === 'true',
    photoBucket, erasureBucket, taskWorkerEnabled: env.FIREBASE_TASK_WORKER_ENABLED === 'true', knowledgeSourceIds };
}

/** Production no longer accepts SQL or an implicit fallback. */
export function serverStorageBackend(env: Record<string, string | undefined>): 'firestore' {
  if (env.STORAGE_BACKEND !== undefined && env.STORAGE_BACKEND !== 'firestore') throw new Error('Invalid STORAGE_BACKEND configuration');
  return 'firestore';
}
