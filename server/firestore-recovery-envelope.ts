/// <reference lib="es2024.string" />
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { StorageCipher } from './storage-crypto.ts';
import { canonicalJson } from './online-routing.ts';
import { workRecoveryAad, workRecoveryScopeSchema, type WorkRecoveryKind, type WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';

const FORMAT = 'yuban-recovery-locator', VERSION = 1, MAX_BODY_BYTES = 192 * 1024;
const MAX_MAIN_CIPHERTEXT_BYTES = MAX_BODY_BYTES * 2, MAX_LOCATOR_BODY_BYTES = 64 * 1024, MAX_LOCATOR_BYTES = 96 * 1024;
const NIL = '00000000-0000-0000-0000-000000000000';
const bounded = (max: number) => z.string().min(1).max(max).refine(value => value.isWellFormed());
const recordVersion = z.number().int().positive().max(2147483647);
const contextSchema = z.object({ family: z.enum(['domain', 'authority']), kind: z.string().regex(/^[a-z][a-z0-9-]{0,60}$/u), id: bounded(2048),
  scope: workRecoveryScopeSchema, envelopeVersion: z.union([z.literal(1), z.literal(2)]), recordVersion: recordVersion.optional(), aad: bounded(32 * 1024) }).strict();
export const firestoreRecoveryLocatorSchema = z.object({ format: z.literal(FORMAT), version: z.literal(VERSION), ciphertext: bounded(MAX_LOCATOR_BYTES) }).strict();
const envelopeSchema = z.object({ family: z.enum(['domain', 'authority']), version: z.union([z.literal(1), z.literal(2)]),
  recordVersion: recordVersion.optional(), ciphertext: bounded(MAX_MAIN_CIPHERTEXT_BYTES) }).strict();
export type FirestoreRecoveryLocator = z.infer<typeof firestoreRecoveryLocatorSchema>;
export type FirestoreRecoveryContext = z.infer<typeof contextSchema>;
export type FirestoreRecoveryEnvelopeIdentity = z.infer<typeof envelopeSchema>;
export interface FirestoreRecoveryOptions { cipher: StorageCipher; projectId: string; namespace: string }
export interface SealRecoveryLocatorOptions extends FirestoreRecoveryOptions { ciphertext: string; context: FirestoreRecoveryContext }
export interface OpenRecoveryEnvelopeOptions extends FirestoreRecoveryOptions { envelope: FirestoreRecoveryEnvelopeIdentity; locator: unknown }
export interface OpenedRecoveryEnvelope { context: FirestoreRecoveryContext; value: unknown }
export class FirestoreRecoveryEnvelopeError extends Error {
  readonly code: string; readonly status: number;
  constructor(code: string, status = 409) { super('Firestore recovery envelope rejected'); this.name = 'FirestoreRecoveryEnvelopeError'; this.code = code; this.status = status; }
}
function reject(code: string, status = 409): never { throw new FirestoreRecoveryEnvelopeError(code, status); }
function parse<T>(schema: z.ZodType<T>, raw: unknown, code: string): T {
  const result = schema.safeParse(raw); if (!result.success) reject(code); return result.data;
}
function limit(text: string, max: number) { if (Buffer.byteLength(text, 'utf8') > max) reject('recovery_document_too_large', 413); }
function configuration(options: FirestoreRecoveryOptions) {
  if (!options || typeof options.cipher?.encrypt !== 'function' || typeof options.cipher?.decrypt !== 'function'
    || !bounded(256).safeParse(options.projectId).success || options.projectId !== options.projectId.trim()
    || !/^[a-z][a-z0-9_]{0,60}$/u.test(options.namespace)) reject('recovery_configuration', 500);
}
const workKinds = new Set<WorkRecoveryKind | 'daily'>(['control', 'account', 'workspace', 'child', 'work', 'followup', 'event', 'claim', 'run', 'change', 'daily']);
const auxiliaryKinds = new Set(['authority-invitation', 'authority-identity', 'authority-owner', 'authority-operation', 'authority-child-detail', 'authority-work-detail']);
function checkedContext(raw: unknown): FirestoreRecoveryContext {
  const value = parse(contextSchema, raw, 'recovery_context_invalid'), { recordVersion, ...rest } = value;
  return recordVersion === undefined ? rest : { ...rest, recordVersion };
}
function originalAad(projectId: string, namespace: string, context: FirestoreRecoveryContext): string {
  const { family, kind, id, scope, envelopeVersion, recordVersion } = context;
  if (family === 'domain') {
    if (envelopeVersion !== 1 || recordVersion === undefined) reject('recovery_binding');
    return canonicalJson(['yuban-firestore-domain', 1, projectId, namespace, kind, id, scope, recordVersion]);
  }
  if (recordVersion !== undefined) reject('recovery_binding');
  if (auxiliaryKinds.has(kind)) {
    if (envelopeVersion !== 2) reject('recovery_binding');
    const binding = kind === 'authority-invitation' ? null
      : kind === 'authority-identity' || kind === 'authority-owner' || kind === 'authority-operation' && scope.childId === NIL
        ? { ownerUserId: scope.ownerUserId } : scope;
    return JSON.stringify(['yuban-work-recovery', 2, projectId, namespace, kind, id, binding]);
  }
  if (!workKinds.has(kind as WorkRecoveryKind | 'daily') || envelopeVersion !== 1 && !(kind === 'event' && envelopeVersion === 2)) reject('recovery_binding');
  return workRecoveryAad(projectId, namespace, kind as WorkRecoveryKind | 'daily', id, scope, envelopeVersion);
}
function locatorAad(projectId: string, namespace: string, ciphertext: string): string {
  const hash = createHash('sha256').update(ciphertext, 'utf8').digest('hex');
  return canonicalJson([FORMAT, VERSION, projectId, namespace, hash]);
}
function mainCiphertext(raw: unknown, family: FirestoreRecoveryContext['family']): string {
  const ciphertext = parse(bounded(MAX_MAIN_CIPHERTEXT_BYTES), raw, 'recovery_ciphertext_invalid');
  limit(ciphertext, family === 'authority' ? MAX_BODY_BYTES : MAX_MAIN_CIPHERTEXT_BYTES); return ciphertext;
}

/** Operator recovery context only. This does not establish document-path bindings, payload type or restore permission. */
export function sealRecoveryLocator(options: SealRecoveryLocatorOptions): FirestoreRecoveryLocator {
  configuration(options);
  const context = checkedContext(options.context), ciphertext = mainCiphertext(options.ciphertext, context.family);
  if (context.aad !== originalAad(options.projectId, options.namespace, context)) reject('recovery_binding');
  const body = canonicalJson(context); limit(body, MAX_LOCATOR_BODY_BYTES);
  let encrypted: string;
  try { encrypted = options.cipher.encrypt(body, locatorAad(options.projectId, options.namespace, ciphertext)); }
  catch { reject('recovery_locator_ciphertext'); }
  limit(encrypted, MAX_LOCATOR_BYTES);
  const result = parse(firestoreRecoveryLocatorSchema, { format: FORMAT, version: VERSION, ciphertext: encrypted }, 'recovery_locator_invalid');
  limit(JSON.stringify(result), MAX_LOCATOR_BYTES); return result;
}

/** Authenticate the locator, reconstruct the unchanged original AAD, then authenticate and parse the main JSON. */
export function openRecoveryEnvelope(options: OpenRecoveryEnvelopeOptions): OpenedRecoveryEnvelope {
  configuration(options);
  const envelope = parse(envelopeSchema, options.envelope, 'recovery_envelope_invalid');
  const ciphertext = mainCiphertext(envelope.ciphertext, envelope.family);
  if (options.locator === undefined || options.locator === null) reject('recovery_locator_missing');
  const locator = parse(firestoreRecoveryLocatorSchema, options.locator, 'recovery_locator_invalid'); limit(JSON.stringify(locator), MAX_LOCATOR_BYTES);
  let raw: unknown;
  try {
    const body = options.cipher.decrypt(locator.ciphertext, locatorAad(options.projectId, options.namespace, ciphertext));
    limit(body, MAX_LOCATOR_BODY_BYTES); raw = JSON.parse(body);
  } catch (error) {
    if (error instanceof FirestoreRecoveryEnvelopeError) throw error;
    reject('recovery_locator_ciphertext');
  }
  const context = checkedContext(raw);
  if (context.family !== envelope.family || context.envelopeVersion !== envelope.version || context.recordVersion !== envelope.recordVersion
    || context.aad !== originalAad(options.projectId, options.namespace, context)) reject('recovery_binding');
  let value: unknown;
  try { const body = options.cipher.decrypt(ciphertext, context.aad); limit(body, MAX_BODY_BYTES); value = JSON.parse(body); }
  catch (error) {
    if (error instanceof FirestoreRecoveryEnvelopeError) throw error;
    reject('recovery_ciphertext');
  }
  return { context, value };
}
