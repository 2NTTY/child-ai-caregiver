/// <reference lib="es2024.string" />
import { createHash } from 'node:crypto';
import type { DocumentSnapshot, Firestore } from '@google-cloud/firestore';
import { z } from 'zod';
import type { StorageCipher } from './storage-crypto.ts';
import type { ModelBillingSource } from '../src/shared/model-settings.ts';
import { canonical, isRecord } from './firestore-session-codec.ts';
import { DurableAiUsageError, type DurableAiUsage, type DurableAiUsageAdmission, type DurableAiUsageReceipt,
  type DurableAiUsageRecord, type DurableAiUsageRequest } from './durable-ai-usage.ts';

const FORMAT = 'yuban-ai-daily-usage', VERSION = 1, MAX_BYTES = 16 * 1024;
const id = z.string().min(1).refine(value => value.isWellFormed() && Buffer.byteLength(value, 'utf8') <= 256);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/u);
const sourceSchema = z.enum(['platform', 'personal']);
const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const requestSchema = z.object({ kind: z.enum(['model', 'embedding']).optional(), rootRunId: id, attemptKey: id, bindingFingerprint: fingerprint,
  requestFingerprint: fingerprint, userId: id, childId: id, model: id, deadlineAtMs: integer.min(1),
  userLimit: integer.min(1).max(1000), globalLimit: integer.min(1).max(10000) }).strict();
const recordSchema = z.union([
  z.object({ kind: z.literal('model').optional(), outcome: z.enum(['succeeded', 'rate_limited', 'timeout', 'unavailable', 'invalid_response', 'unauthorized']),
    inputTokens: integer.nullable(), outputTokens: integer.nullable(), cachedTokens: integer.nullable(), durationMs: integer }).strict(),
  z.object({ kind: z.literal('embedding'), outcome: z.enum(['succeeded', 'unavailable', 'invalid_response', 'invalid_input', 'unauthorized', 'timeout', 'cancelled']),
    inputTokens: integer.nullable(), billableCharacters: integer.nullable(), durationMs: integer }).strict(),
]);
const attemptSchema = z.object({ request: requestSchema, billingSource: sourceSchema, day: daySchema,
  reservedAtMs: integer, record: recordSchema.nullable() }).strict().refine(value => value.record === null
    || (value.request.kind ?? 'model') === (value.record.kind ?? 'model'));
const counterSchema = z.object({ attempts: integer, inputTokens: integer, outputTokens: integer, cachedTokens: integer, known: integer }).strict();
export const firestoreUsageRecoverySchemas = { attempt: attemptSchema, counter: counterSchema };
type Counter = z.infer<typeof counterSchema>;
type SavedAttempt = z.infer<typeof attemptSchema>;
const emptyCounter = (): Counter => ({ attempts: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, known: 0 });
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
function reject(code: string): never { throw new DurableAiUsageError(code); }
function parse<T>(schema: z.ZodType<T>, value: unknown, code: string): T {
  const result = schema.safeParse(value); if (!result.success) reject(code); return result.data;
}
function receipt(state: SavedAttempt): DurableAiUsageReceipt {
  return { ...(state.request.kind ? { kind: state.request.kind } : {}), day: state.day, reservedAtMs: state.reservedAtMs, record: state.record ? { ...state.record } : null };
}
/** Compare legacy model representations without changing saved payloads or ciphertext. */
function comparable<T extends { kind?: 'model' | 'embedding' }>(value: T) {
  return { ...value, kind: value.kind ?? 'model' };
}

export interface FirestoreAiUsageOptions {
  /** Already configured client; this adapter never reads credentials or owns its lifecycle. */
  database: Firestore;
  cipher: StorageCipher;
  projectId: string;
  namespace: string;
  /** Trusted constructor choice, never inferred from a model/request body. */
  billingSource: ModelBillingSource;
  serverClock?: () => number;
}

/**
 * Model and query-embedding daily quota and metadata accounting. Root limits and business
 * authority remain separate. No provider execution, refunds, cleanup or TTL.
 * Duplicate or lost acknowledgements never permit another dispatch.
 */
export class FirestoreAiUsage implements DurableAiUsage {
  readonly #database: Firestore;
  readonly #cipher: StorageCipher;
  readonly #projectId: string;
  readonly #namespace: string;
  readonly #source: ModelBillingSource;
  readonly #clock: () => number;
  get billingSource() { return this.#source; }
  constructor({ database, cipher, projectId, namespace, billingSource, serverClock = Date.now }: FirestoreAiUsageOptions) {
    if (typeof database?.collection !== 'function' || typeof database.runTransaction !== 'function'
      || typeof cipher?.encrypt !== 'function' || typeof cipher.decrypt !== 'function'
      || typeof projectId !== 'string' || !projectId || projectId !== projectId.trim() || !projectId.isWellFormed() || Buffer.byteLength(projectId) > 256
      || typeof namespace !== 'string' || !/^[a-z][a-z0-9_]{0,60}$/u.test(namespace) || typeof serverClock !== 'function') reject('invalid_configuration');
    this.#database = database; this.#cipher = cipher; this.#projectId = projectId; this.#namespace = namespace;
    this.#source = parse(sourceSchema, billingSource, 'invalid_configuration'); this.#clock = serverClock;
  }
  #now() {
    const now = this.#clock();
    if (!Number.isSafeInteger(now) || now < 0 || now > 253402300799999) reject('invalid_server_clock');
    return now;
  }
  #day(now: number) { return new Date(now).toISOString().slice(0, 10); }
  #attemptId(request: DurableAiUsageRequest) { return 'attempt_' + hash([request.rootRunId, request.attemptKey]); }
  #counterId(day: string, userId: string | null) { return 'daily_' + hash([this.#source, day, userId]); }
  #ref(id: string) { return this.#database.collection(this.#namespace).doc(id); }
  #aad(id: string) { return canonical([FORMAT, VERSION, this.#projectId, this.#namespace, id]); }
  #size(value: unknown) {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_BYTES) reject('document_too_large');
  }
  #seal(id: string, state: unknown) {
    this.#size(state);
    let ciphertext: string;
    try { ciphertext = this.#cipher.encrypt(canonical(state), this.#aad(id)); } catch { reject('ciphertext_rejected'); }
    if (typeof ciphertext !== 'string' || !ciphertext) reject('ciphertext_rejected');
    const envelope = { format: FORMAT, version: VERSION, ciphertext }; this.#size(envelope); return envelope;
  }
  #open<T>(id: string, snapshot: DocumentSnapshot, schema: z.ZodType<T>): T {
    let decoded: unknown;
    try {
      const envelope: unknown = snapshot.data(); this.#size(envelope);
      if (!isRecord(envelope) || Object.keys(envelope).sort().join(',') !== 'ciphertext,format,version'
        || envelope.format !== FORMAT || envelope.version !== VERSION || typeof envelope.ciphertext !== 'string') reject('ciphertext_rejected');
      const plaintext = this.#cipher.decrypt(envelope.ciphertext, this.#aad(id));
      if (Buffer.byteLength(plaintext, 'utf8') > MAX_BYTES) reject('ciphertext_rejected');
      decoded = JSON.parse(plaintext);
    } catch { reject('ciphertext_rejected'); }
    return parse(schema, decoded, 'invalid_stored_usage');
  }
  #attempt(id: string, snapshot: DocumentSnapshot, request: DurableAiUsageRequest) {
    const state = this.#open(id, snapshot, attemptSchema);
    if (canonical(comparable(state.request)) !== canonical(comparable(request)) || state.billingSource !== this.#source) reject('attempt_conflict');
    if (state.day !== this.#day(state.reservedAtMs) || state.reservedAtMs >= request.deadlineAtMs) reject('invalid_stored_usage');
    return state;
  }
  #counter(id: string, snapshot: DocumentSnapshot, required = false) {
    if (!snapshot.exists) { if (required) reject('counter_not_found'); return emptyCounter(); }
    const state = this.#open(id, snapshot, counterSchema);
    if (state.known > state.attempts) reject('invalid_stored_usage');
    return state;
  }
  #consistent(global: Counter, user: Counter) {
    // Both aggregates are updated in the same transaction. Each user's known
    // totals must remain a subset, including independently nullable token counts.
    for (const key of ['attempts', 'known', 'inputTokens', 'outputTokens', 'cachedTokens'] as const)
      if (user[key] > global[key]) reject('counter_inconsistent');
  }
  async reserve(input: DurableAiUsageRequest): Promise<DurableAiUsageAdmission> {
    const request = parse(requestSchema, input, 'invalid_request'), attemptId = this.#attemptId(request), attemptRef = this.#ref(attemptId);
    return this.#database.runTransaction(async transaction => {
      const saved = await transaction.get(attemptRef);
      // No day, deadline, counter or limit change can turn an existing attempt into execute.
      if (saved.exists) return { decision: 'lookup', receipt: receipt(this.#attempt(attemptId, saved, request)) };
      const now = this.#now(); if (now >= request.deadlineAtMs) reject('deadline_exceeded');
      const day = this.#day(now), globalId = this.#counterId(day, null), userId = this.#counterId(day, request.userId);
      const globalRef = this.#ref(globalId), userRef = this.#ref(userId);
      const globalSnapshot = await transaction.get(globalRef), userSnapshot = await transaction.get(userRef);
      // A new user/day may be absent. An existing user counter proves that its
      // global counter was committed too; absence cannot be treated as zero.
      const global = this.#counter(globalId, globalSnapshot, userSnapshot.exists), user = this.#counter(userId, userSnapshot);
      this.#consistent(global, user);
      if (this.#now() >= request.deadlineAtMs) reject('deadline_exceeded');
      if (global.attempts >= request.globalLimit || user.attempts >= request.userLimit) return { decision: 'quota_exceeded' };
      global.attempts++; user.attempts++;
      const state: SavedAttempt = { request, billingSource: this.#source, day, reservedAtMs: now, record: null };
      transaction.create(attemptRef, this.#seal(attemptId, state));
      transaction.set(globalRef, this.#seal(globalId, global)); transaction.set(userRef, this.#seal(userId, user));
      return { decision: 'execute', receipt: receipt(state) };
    });
  }
  async read(input: DurableAiUsageRequest): Promise<DurableAiUsageReceipt | null> {
    const request = parse(requestSchema, input, 'invalid_request'), id = this.#attemptId(request);
    return this.#database.runTransaction(async transaction => {
      const snapshot = await transaction.get(this.#ref(id));
      return snapshot.exists ? receipt(this.#attempt(id, snapshot, request)) : null;
    }, { readOnly: true });
  }
  async record(input: DurableAiUsageRequest, result: DurableAiUsageRecord): Promise<DurableAiUsageReceipt> {
    const request = parse(requestSchema, input, 'invalid_request'), record = parse(recordSchema, result, 'invalid_record');
    if ((request.kind ?? 'model') !== (record.kind ?? 'model')) reject('record_kind_conflict');
    const id = this.#attemptId(request), ref = this.#ref(id);
    return this.#database.runTransaction(async transaction => {
      const saved = await transaction.get(ref); if (!saved.exists) reject('attempt_not_found');
      const state = this.#attempt(id, saved, request);
      if (state.record) {
        if (canonical(comparable(state.record)) !== canonical(comparable(record))) reject('record_conflict');
        return receipt(state);
      }
      // Late accounting uses the reservation day, never today's quota or the root's terminal state.
      const globalId = this.#counterId(state.day, null), userId = this.#counterId(state.day, request.userId);
      const globalRef = this.#ref(globalId), userRef = this.#ref(userId);
      const global = this.#counter(globalId, await transaction.get(globalRef), true), user = this.#counter(userId, await transaction.get(userRef), true);
      this.#consistent(global, user);
      for (const counter of [global, user]) {
        if (counter.attempts < 1) reject('invalid_stored_usage');
        counter.inputTokens += record.inputTokens ?? 0;
        if (record.kind === 'embedding') {
          // Characters are not tokens. Embeddings have no output or cached-token fields.
          if (record.inputTokens !== null && record.billableCharacters !== null) counter.known++;
        } else {
          counter.outputTokens += record.outputTokens ?? 0; counter.cachedTokens += record.cachedTokens ?? 0;
          if (record.inputTokens !== null && record.outputTokens !== null && record.cachedTokens !== null) counter.known++;
        }
        parse(counterSchema, counter, 'usage_overflow');
        if (counter.known > counter.attempts) reject('invalid_stored_usage');
      }
      state.record = record;
      transaction.set(ref, this.#seal(id, state));
      transaction.set(globalRef, this.#seal(globalId, global)); transaction.set(userRef, this.#seal(userId, user));
      return receipt(state);
    });
  }
  async getGlobal(input: string) {
    const day = parse(daySchema, input, 'invalid_day');
    return this.#database.runTransaction(async transaction => {
      const id = this.#counterId(day, null), state = this.#counter(id, await transaction.get(this.#ref(id)));
      return { day, attempts: state.attempts, inputTokens: state.inputTokens, outputTokens: state.outputTokens,
        cachedTokens: state.cachedTokens, unknownUsageAttempts: state.attempts - state.known, billingSource: this.#source };
    }, { readOnly: true });
  }
  async getForUser(input: string) {
    const userId = parse(id, input, 'invalid_user');
    return this.#database.runTransaction(async transaction => {
      const day = this.#day(this.#now()), id = this.#counterId(day, userId), state = this.#counter(id, await transaction.get(this.#ref(id)));
      return { day, attempts: state.attempts, inputTokens: state.inputTokens, outputTokens: state.outputTokens,
        cachedTokens: state.cachedTokens, unknownUsageAttempts: state.attempts - state.known, billingSource: this.#source };
    }, { readOnly: true });
  }
}
