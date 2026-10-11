/// <reference lib="es2024.string" />
import { createHash } from 'node:crypto';
import type { Firestore, DocumentSnapshot } from '@google-cloud/firestore';
import { z } from 'zod';
import type { StorageCipher } from './storage-crypto.ts';
import { workRecoveryScopeSchema, type WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';
import { canonicalJson } from './online-routing.ts';
import { taskValuesSchema, taskDueAtSchema, taskTimeZoneSchema, type CareTask, type TaskRevision } from '../src/shared/tasks.ts';

const FORMAT = 'yuban-firestore-domain', MAX_BYTES = 192 * 1024;
const decimal = z.string().regex(/^(0|[1-9][0-9]{0,18})$/u).refine(value => BigInt(value) <= 9223372036854775807n);
const bounded = (max: number) => z.string().min(1).max(max).refine(value => value.isWellFormed());
const version = z.number().int().positive().max(2147483647), datetime = z.iso.datetime({ offset: true });
export const firestoreChildSchema = z.object({ id: z.uuid(), workspaceId: z.uuid(), displayName: bounded(160), createdAt: datetime, accessRole: z.literal('owner') }).strict();
export const firestoreChangeSchema = z.object({ changeSeq: decimal,
  kind: z.enum(['children', 'care', 'profile', 'chat', 'family', 'preferences', 'memory', 'tasks', 'growth', 'documents']),
  childId: z.uuid().nullable(), deleted: z.boolean() }).strict();
export const firestoreTaskSchema: z.ZodType<CareTask> = z.object({
  ...taskValuesSchema.omit({ dueAt: true, timeZone: true }).shape,
  id: z.uuid(), childId: z.uuid(), version, createdBy: bounded(256), createdAt: datetime, updatedAt: datetime,
  occurrence: z.object({ id: z.uuid(), dueAt: taskDueAtSchema, timeZone: taskTimeZoneSchema,
    state: z.enum(['scheduled', 'completed', 'cancelled', 'needs_review']), terminalBasisVersion: version.nullable() }).strict(),
}).strict();
export const firestoreTaskRevisionSchema: z.ZodType<TaskRevision> = z.object({ task: firestoreTaskSchema,
  action: z.enum(['create', 'reschedule', 'complete', 'cancel', 'resolve']), actorUserId: bounded(256),
  basisVersion: z.number().int().nonnegative().max(2147483647), note: z.string().max(1000), at: datetime }).strict();
export const firestoreReminderOutboxSchema = z.object({ taskId: z.uuid(), occurrenceId: z.uuid(), taskVersion: version,
  dueAt: taskDueAtSchema, ownerUserId: bounded(256), workspaceId: z.uuid(), childId: z.uuid(), storageEpoch: z.uuid(),
  authorizationVersion: decimal, generation: z.uuid(), state: z.enum(['pending', 'leased', 'processed', 'cancelled', 'failed', 'unknown']),
  attempts: z.number().int().nonnegative().max(2147483647), lease: z.object({ token: z.uuid(), generation: z.uuid(), until: datetime }).strict().nullable() }).strict();
export type FirestoreReminderOutbox = z.infer<typeof firestoreReminderOutboxSchema>;
export interface FirestoreDomainOptions { database: Firestore; cipher: StorageCipher; projectId: string; namespace: string }
export interface FirestoreDomainEnvelope { format: 'yuban-firestore-domain'; version: 1; recordVersion: number; ciphertext: string }
export class FirestoreDomainError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) { super('Firestore domain request rejected'); this.name = 'FirestoreDomainError'; this.status = status; this.code = code; }
}
export function domainReject(code: string, status = 409): never { throw new FirestoreDomainError(status, code); }
export function domainParse<T>(schema: z.ZodType<T>, value: unknown, code = 'invalid_input', status = 400): T {
  const parsed = schema.safeParse(value); if (!parsed.success) domainReject(code, status); return parsed.data;
}
export function firestoreDomainHash(value: unknown): string { return createHash('sha256').update(canonicalJson(value)).digest('hex'); }
export function firestoreReminderOutboxId(taskId: string, taskVersion: number): string { return JSON.stringify([taskId, taskVersion]); }

/** Project envelopes and query tags only. Point bindings and business permission stay in canonical authority. */
export class FirestoreDomainData {
  readonly options: Readonly<FirestoreDomainOptions>;
  constructor(options: FirestoreDomainOptions) {
    if (!options || typeof options.database?.collection !== 'function' || typeof options.database?.runTransaction !== 'function'
      || typeof options.cipher?.encrypt !== 'function' || typeof options.cipher?.decrypt !== 'function'
      || !bounded(256).safeParse(options.projectId).success || options.projectId !== options.projectId.trim()
      || !/^[a-z][a-z0-9_]{0,60}$/u.test(options.namespace)) domainReject('configuration', 500);
    this.options = Object.freeze({ ...options });
  }
  collection(suffix: string) {
    if (!/^[a-z][a-z0-9_]{0,40}$/u.test(suffix)) domainReject('configuration', 500);
    return this.options.database.collection(this.options.namespace + '_' + suffix);
  }
  ref(suffix: string, kind: string, id: string) { return this.collection(suffix).doc(firestoreDomainHash([kind, id])); }
  tags(scope: WorkRecoveryScope) {
    const checked = domainParse(workRecoveryScopeSchema, scope);
    const tag = (kind: string, value: string) => firestoreDomainHash([this.options.projectId, this.options.namespace, kind, value]);
    return { workspaceTag: tag('workspace', checked.workspaceId), epochTag: tag('epoch', checked.storageEpoch),
      childTag: tag('child', checked.childId), userTag: tag('user', checked.ownerUserId) };
  }
  sortKey(sequence: string): string { return domainParse(decimal, sequence).padStart(19, '0'); }
  private aad(kind: string, id: string, scope: WorkRecoveryScope, recordVersion: number) {
    if (!/^[a-z][a-z0-9-]{0,60}$/u.test(kind) || typeof id !== 'string' || !id.length || id.length > 2048) domainReject('configuration', 500);
    return canonicalJson([FORMAT, 1, this.options.projectId, this.options.namespace, kind, id,
      domainParse(workRecoveryScopeSchema, scope), domainParse(version, recordVersion)]);
  }
  seal<T>(kind: string, id: string, scope: WorkRecoveryScope, schema: z.ZodType<T>, value: T, recordVersion = 1): FirestoreDomainEnvelope {
    const body = canonicalJson(domainParse(schema, value, 'invalid_document', 500));
    if (Buffer.byteLength(body) > MAX_BYTES) domainReject('document_too_large', 413);
    const ciphertext = this.options.cipher.encrypt(body, this.aad(kind, id, scope, recordVersion));
    if (Buffer.byteLength(ciphertext) > MAX_BYTES * 2) domainReject('document_too_large', 413);
    return { format: FORMAT, version: 1, recordVersion, ciphertext };
  }
  open<T>(kind: string, id: string, scope: WorkRecoveryScope, schema: z.ZodType<T>, snapshot: DocumentSnapshot): T {
    const raw = snapshot.data();
    if (!snapshot.exists || raw?.format !== FORMAT || raw.version !== 1 || !version.safeParse(raw.recordVersion).success
      || typeof raw.ciphertext !== 'string' || Buffer.byteLength(raw.ciphertext) > MAX_BYTES * 2) domainReject('invalid_document', 500);
    let parsed: unknown;
    try {
      const text = this.options.cipher.decrypt(raw.ciphertext, this.aad(kind, id, scope, raw.recordVersion));
      if (Buffer.byteLength(text) > MAX_BYTES) domainReject('invalid_document', 500);
      parsed = JSON.parse(text);
    } catch { domainReject('invalid_document', 500); }
    return domainParse(schema, parsed, 'invalid_document', 500);
  }
}
