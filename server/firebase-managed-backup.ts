import { GoogleAuth } from 'google-auth-library';
import { z } from 'zod';
import type { FirebaseNativeRecoveryOperation } from './firebase-native-recovery.ts';

const base = 'https://firestore.googleapis.com/v1/';
const segment = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/u);
const stamp = z.iso.datetime({ offset: true });
const backupSchema = z.object({ name: z.string(), database: z.string(), databaseUid: z.uuid(),
  snapshotTime: stamp, expireTime: stamp, state: z.literal('READY'),
  stats: z.object({ documentCount: z.string().regex(/^\d+$/u), sizeBytes: z.string().regex(/^\d+$/u) }) });
const operationSchema = z.object({ name: z.string(), done: z.boolean().optional(), error: z.unknown().optional(),
  metadata: z.object({ '@type': z.literal('type.googleapis.com/google.firestore.admin.v1.RestoreDatabaseMetadata'),
    database: z.string(), backup: z.string(), operationState: z.string(), endTime: stamp.optional() }),
  response: z.object({ name: z.string(), uid: z.uuid() }).optional() });
export type FirebaseManagedBackupTransport = (request: { method: 'GET' | 'POST'; url: string;
  data?: unknown; retry: false; timeout: 30000 }) => Promise<{status: number; data: unknown}>;
export interface FirebaseManagedBackupOptions {
  projectId: string; sourceDatabaseId: string; targetDatabaseId: string; location: string;
  request?: FirebaseManagedBackupTransport;
}
function reject(code: string): never { throw Object.assign(new Error('Managed backup rejected'), {code}); }
function requireValue(ok: unknown, code = 'managed_backup_binding'): asserts ok { if (!ok) reject(code); }

/** Operator only. A native restore creates a NEW isolated database; this never switches application traffic. */
export function createFirebaseManagedBackup(options: FirebaseManagedBackupOptions) {
  const {projectId, sourceDatabaseId, targetDatabaseId, location} = options;
  [projectId, sourceDatabaseId, targetDatabaseId, location].forEach(value => segment.parse(value));
  requireValue(sourceDatabaseId !== targetDatabaseId && targetDatabaseId.startsWith('yuban-restore-'), 'managed_restore_target');
  const source = `projects/${projectId}/databases/${sourceDatabaseId}`, target = `projects/${projectId}/databases/${targetDatabaseId}`;
  const backups = `projects/${projectId}/locations/${location}/backups/`, operations = target + '/operations/';
  const auth = new GoogleAuth({scopes: ['https://www.googleapis.com/auth/datastore']});
  const transport: FirebaseManagedBackupTransport = options.request ?? (async request => {
    const client = await auth.getClient(), headers = await client.getRequestHeaders(request.url);
    return client.transporter.request({...request, headers, retryConfig:{retry:0}, maxRedirects:0});
  });
  function name(value: string, prefix: string) {
    requireValue(value.startsWith(prefix) && /^[A-Za-z0-9._~-]{1,1024}$/u.test(value.slice(prefix.length))
      && !['.', '..'].includes(value.slice(prefix.length)), 'managed_backup_resource'); return value;
  }
  async function read(resource: string) {
    const response = await transport({method:'GET', url:base+resource, retry:false, timeout:30000});
    requireValue(response.status === 200, 'managed_backup_unavailable'); return response.data;
  }
  async function backup(backupName: string) {
    name(backupName, backups);
    const value = backupSchema.parse(await read(backupName));
    const database = z.object({name:z.string(), uid:z.uuid(), locationId:z.string()}).parse(await read(source));
    requireValue(value.name === backupName && value.database === source && value.databaseUid === database.uid
      && database.name === source && database.locationId === location && Date.parse(value.expireTime) > Date.now());
    // This matches the bounded application recovery operator, not the native service capacity.
    requireValue(BigInt(value.stats.documentCount) <= 2000n && BigInt(value.stats.sizeBytes) <= 32n*1024n*1024n,
      'managed_backup_application_limit'); return value;
  }
  function operation(value: unknown, backupName: string, operationName?: string) {
    const op = operationSchema.parse(value); name(op.name, operations);
    requireValue((!operationName || op.name === operationName) && op.metadata.database === target && op.metadata.backup === backupName);
    return op;
  }
  return {
    async start(backupName: string): Promise<FirebaseNativeRecoveryOperation> {
      await backup(backupName);
      let absent = false;
      try { const response = await transport({method:'GET',url:base+target,retry:false,timeout:30000}); absent = response.status === 404; }
      catch (error) { absent = Boolean(error && typeof error === 'object' && 'response' in error
        && (error.response as {status?:number})?.status === 404); }
      requireValue(absent, 'managed_restore_target_exists_or_unknown');
      // Unknown mutation outcomes are inspected by the original target name. Never retry with another name.
      try {
        const response = await transport({method:'POST',url:base+`projects/${projectId}/databases:restore`,
          data:{databaseId:targetDatabaseId,backup:backupName},retry:false,timeout:30000});
        requireValue(response.status === 200); return operation(response.data, backupName);
      } catch { return reject('managed_restore_unknown'); }
    },
    async inspect(backupName: string, operationName: string) {
      name(operationName, operations); return operation(await read(operationName), backupName, operationName);
    },
    async verify(backupName: string, operationName: string) {
      const value = await backup(backupName);
      name(operationName, operations);
      const op = operation(await read(operationName), backupName, operationName);
      requireValue(op.done === true && !op.error && op.metadata.operationState === 'SUCCESSFUL' && op.metadata.endTime
        && op.response?.name === target, 'managed_restore_not_complete');
      const database = z.object({name:z.string(),uid:z.uuid(),locationId:z.string(),type:z.literal('FIRESTORE_NATIVE'),
        sourceInfo:z.object({operation:z.string(),backup:z.object({backup:z.string()})})}).parse(await read(target));
      requireValue(database.name === target && database.locationId === location && database.uid === op.response!.uid
        && database.sourceInfo.operation === operationName && database.sourceInfo.backup.backup === backupName);
      return {backupName, operationName, sourceDatabase:source, targetDatabase:target, databaseUid:value.databaseUid, targetUid:database.uid,
        snapshotTime:value.snapshotTime, documentCount:Number(value.stats.documentCount), endTime:op.metadata.endTime!};
    },
  };
}
