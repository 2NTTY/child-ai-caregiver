/// <reference lib="es2024.string" />
import type { CompositeSessionKey, Event } from '@google/adk';
import type { StorageCipher } from './storage-crypto.ts';

// Keep the validated wire format/AAD stable; changing it requires a migration.
export const FORMAT = 'yuban-adk-firestore-fixture';
export const VERSION = 1;
export const MAX_DOCUMENT_BYTES = 900 * 1024;
export const MAX_EVENTS = 64;
export const MAX_LIST_SESSIONS = 100;
export type SessionKey = Readonly<CompositeSessionKey>;
export type StateMap = Record<string, unknown>;
type Scope = 'app' | 'user' | 'session' | 'event';
export interface EncryptedJson { format: typeof FORMAT; version: typeof VERSION; ciphertext: string; }

export class SessionContractError extends Error {
  readonly code: string;
  constructor(code: string) { super('Session storage request rejected'); this.name = 'SessionContractError'; this.code = code; }
}
export function reject(code: string): never { throw new SessionContractError(code); }
export function isRecord(value: unknown): value is StateMap { return value !== null && typeof value === 'object' && !Array.isArray(value); }
export function encodeId(value: string): string {
  if (typeof value !== 'string' || !value || !value.isWellFormed() || Buffer.byteLength(value, 'utf8') > 512) reject('invalid_identity');
  return 'i-' + Buffer.from(value, 'utf8').toString('base64url');
}
export function identity({ appName, userId, sessionId }: CompositeSessionKey): SessionKey {
  for (const value of [appName, userId, sessionId]) encodeId(value);
  return Object.freeze({ appName, userId, sessionId });
}
/** JSON persistence semantics: undefined/symbols/prototypes are not preserved. */
export function canonical(value: unknown): string {
  const persistent: unknown = JSON.parse(JSON.stringify(value));
  function sort(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(sort);
    if (!isRecord(node)) return node;
    const result: StateMap = Object.create(null);
    for (const key of Object.keys(node).sort()) result[key] = sort(node[key]);
    return result;
  }
  return JSON.stringify(sort(persistent));
}
export function persistentEvent(event: Event, tempPrefix: string): Event {
  const filtered: StateMap = Object.create(null);
  for (const [key, value] of Object.entries(event.actions?.stateDelta ?? {})) if (!key.startsWith(tempPrefix)) filtered[key] = value;
  return JSON.parse(canonical({ ...event, actions: { ...event.actions, stateDelta: filtered } })) as Event;
}
export function limitDocument<T>(value: T): T {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_DOCUMENT_BYTES) reject('document_too_large');
  return value;
}
export function createCodec(cipher: StorageCipher, projectId: string, namespace: string) {
  const aad = (kind: Scope, key: SessionKey, eventId: string | null = null) => JSON.stringify([FORMAT, VERSION, projectId, namespace, kind,
    key.appName, kind === 'app' ? null : key.userId, ['session', 'event'].includes(kind) ? key.sessionId : null,
    kind === 'event' ? eventId : null]);
  return {
    seal(kind: Scope, key: SessionKey, value: unknown, eventId: string | null = null): EncryptedJson {
      return { format: FORMAT, version: VERSION, ciphertext: cipher.encrypt(canonical(value), aad(kind, key, eventId)) };
    },
    open<T extends object = StateMap>(kind: Scope, key: SessionKey, envelope: unknown, eventId: string | null = null): T {
      try {
        if (!isRecord(envelope) || Object.keys(envelope).sort().join(',') !== 'ciphertext,format,version'
          || envelope.format !== FORMAT || envelope.version !== VERSION || typeof envelope.ciphertext !== 'string') reject('ciphertext_rejected');
        const value: unknown = JSON.parse(cipher.decrypt(envelope.ciphertext, aad(kind, key, eventId)));
        if (!isRecord(value)) reject('ciphertext_rejected');
        return value as T;
      } catch { reject('ciphertext_rejected'); }
    },
  };
}
