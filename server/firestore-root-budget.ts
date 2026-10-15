/// <reference lib="es2024.string" />
import { createHash } from 'node:crypto';
import type { Firestore, DocumentSnapshot } from '@google-cloud/firestore';
import { z } from 'zod';
import type { StorageCipher } from './storage-crypto.ts';
import { canonical, isRecord } from './firestore-session-codec.ts';
import { MAX_ROOT_BUDGET_LIMITS, RootBudgetError, type BudgetAdmission, type BudgetAttempt, type BudgetAttemptSnapshot, type BudgetSettlement,
  type DurableRootBudget, type RootBudgetContext, type RootBudgetLimits, type RootBudgetSnapshot } from './durable-root-budget.ts';

const FORMAT = 'yuban-root-budget';
const VERSION = 1;
export const MAX_ROOT_BUDGET_BYTES = 64 * 1024;
export const MAX_ROOT_BUDGET_ATTEMPTS = Object.values(MAX_ROOT_BUDGET_LIMITS).reduce((sum, limit) => sum + limit, 0);
const bounded = (bytes: number) => z.string().min(1).refine(value => value.isWellFormed() && Buffer.byteLength(value, 'utf8') <= bytes);
const id = bounded(256);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const limitsSchema = z.object({ modelCalls: integer.min(1).max(MAX_ROOT_BUDGET_LIMITS.modelCalls), toolCalls: integer.min(1).max(MAX_ROOT_BUDGET_LIMITS.toolCalls), queryEmbeddings: integer.min(1).max(MAX_ROOT_BUDGET_LIMITS.queryEmbeddings) }).strict();
const countsSchema = z.object({ modelCalls: integer, toolCalls: integer, queryEmbeddings: integer }).strict();
const bindingSchema = z.object({ rootRunId: id, ownerId: id, workspaceId: id, childId: id, authorizationVersion: id,
  storageEpoch: id, trigger: z.object({ kind: id, reference: id }).strict(), workflowVersion: id, promptPackVersion: id,
  settingsVersion: id, billingVersion: id, limits: limitsSchema, deadlineAtMs: integer.min(1) }).strict();
const contextSchema = z.object({ binding: bindingSchema, generation: integer.min(1) }).strict();
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const attemptSchema = z.discriminatedUnion('kind', [
  z.object({ key: id, fingerprint, kind: z.literal('model'), units: z.literal(1) }).strict(),
  z.object({ key: id, fingerprint, kind: z.literal('embedding'), units: z.literal(1) }).strict(),
  z.object({ key: id, fingerprint, kind: z.literal('tool_batch'), units: integer.min(1).max(MAX_ROOT_BUDGET_LIMITS.toolCalls) }).strict(),
]);
const settlementSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('known'), reference: bounded(512) }).strict(), z.object({ status: z.literal('unknown') }).strict(),
]);
const outcomeSchema = z.union([z.object({ status: z.literal('reserved') }).strict(), settlementSchema]);
const savedAttemptSchema = z.object({ request: attemptSchema, outcome: outcomeSchema }).strict();
const stateSchema = z.object({ bindingFingerprint: fingerprint, generation: integer.min(1), deadlineAtMs: integer.min(1),
  limits: limitsSchema, used: countsSchema, status: z.enum(['active', 'stopped']),
  attempts: z.array(savedAttemptSchema).max(MAX_ROOT_BUDGET_ATTEMPTS) }).strict();
type Stored = z.infer<typeof stateSchema>;
export const firestoreRootBudgetRecoverySchema = stateSchema;
function reject(code: string): never { throw new RootBudgetError(code); }
function parse<T>(schema: z.ZodType<T>, value: unknown, code: string): T {
  const parsed = schema.safeParse(value); if (!parsed.success) reject(code); return parsed.data;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function counter(attempt: BudgetAttempt): keyof RootBudgetLimits {
  return attempt.kind === 'model' ? 'modelCalls' : attempt.kind === 'embedding' ? 'queryEmbeddings' : 'toolCalls';
}
function entrySnapshot(entry: Stored['attempts'][number]): BudgetAttemptSnapshot { return { ...entry.request, outcome: { ...entry.outcome } }; }

export interface FirestoreRootBudgetOptions {
  /** Already configured trusted client; its lifecycle remains with the caller. */
  database: Firestore;
  cipher: StorageCipher;
  /** Trusted project/client pairing, not HTTP, model, or environment configuration. */
  projectId: string;
  namespace: string;
  /** Trusted constructor-only clock for deterministic tests. Production defaults to Date.now. */
  serverClock?: () => number;
}

/**
 * Adapter-only, one bounded encrypted document per original business root.
 * No provider dispatch, SQL authority, auth lookup, lease/takeover, deletion or TTL.
 * Reservations consume permanently. Lost replies and unknown outcomes must never
 * trigger replay. Callers must reauthorize before reading actual business receipts.
 */
export class FirestoreRootBudget implements DurableRootBudget {
  #database: Firestore;
  #cipher: StorageCipher;
  #projectId: string;
  #namespace: string;
  #clock: () => number;
  constructor({ database, cipher, projectId, namespace, serverClock = Date.now }: FirestoreRootBudgetOptions) {
    if (typeof database?.collection !== 'function' || typeof database.runTransaction !== 'function'
      || typeof cipher?.encrypt !== 'function' || typeof cipher.decrypt !== 'function'
      || typeof projectId !== 'string' || !projectId || projectId !== projectId.trim() || !projectId.isWellFormed() || Buffer.byteLength(projectId) > 256
      || typeof namespace !== 'string' || !/^[a-z][a-z0-9_]{0,60}$/.test(namespace) || typeof serverClock !== 'function') reject('invalid_configuration');
    this.#database = database; this.#cipher = cipher; this.#projectId = projectId; this.#namespace = namespace; this.#clock = serverClock;
  }
  #now(): number {
    const now = this.#clock(); if (!Number.isSafeInteger(now) || now < 0) reject('invalid_server_clock'); return now;
  }
  #ref(context: RootBudgetContext) { return this.#database.collection(this.#namespace).doc(hash(context.binding.rootRunId)); }
  #aad(context: RootBudgetContext): string { return JSON.stringify([FORMAT, VERSION, this.#projectId, this.#namespace, context.binding.rootRunId]); }
  #fingerprint(context: RootBudgetContext): string { return hash(canonical(context.binding)); }
  #size(value: unknown): void { if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_ROOT_BUDGET_BYTES) reject('document_too_large'); }
  #seal(context: RootBudgetContext, state: Stored) {
    this.#size(state);
    let ciphertext: string;
    try { ciphertext = this.#cipher.encrypt(canonical(state), this.#aad(context)); } catch { reject('ciphertext_rejected'); }
    if (typeof ciphertext !== 'string' || !ciphertext) reject('ciphertext_rejected');
    const envelope = { format: FORMAT, version: VERSION, ciphertext }; this.#size(envelope); return envelope;
  }
  #load(context: RootBudgetContext, snapshot: DocumentSnapshot): Stored {
    if (!snapshot.exists) reject('root_not_found');
    const envelope: unknown = snapshot.data(); this.#size(envelope);
    let decoded: unknown;
    try {
      if (!isRecord(envelope) || Object.keys(envelope).sort().join(',') !== 'ciphertext,format,version'
        || envelope.format !== FORMAT || envelope.version !== VERSION || typeof envelope.ciphertext !== 'string') reject('ciphertext_rejected');
      const text = this.#cipher.decrypt(envelope.ciphertext, this.#aad(context));
      if (Buffer.byteLength(text, 'utf8') > MAX_ROOT_BUDGET_BYTES) reject('ciphertext_rejected');
      decoded = JSON.parse(text);
    } catch { reject('ciphertext_rejected'); }
    const state = parse(stateSchema, decoded, 'invalid_stored_budget');
    const used: RootBudgetLimits = { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 }, keys = new Set<string>();
    for (const attempt of state.attempts) {
      if (keys.has(attempt.request.key)) reject('invalid_stored_budget');
      keys.add(attempt.request.key); used[counter(attempt.request)] += attempt.request.units;
    }
    for (const key of Object.keys(used) as (keyof RootBudgetLimits)[]) if (used[key] !== state.used[key] || used[key] > state.limits[key]) reject('invalid_stored_budget');
    if (state.bindingFingerprint !== this.#fingerprint(context) || state.deadlineAtMs !== context.binding.deadlineAtMs
      || canonical(state.limits) !== canonical(context.binding.limits)) reject('binding_conflict');
    if (state.generation !== context.generation) reject('generation_conflict');
    return state;
  }
  #snapshot(state: Stored, now: number): RootBudgetSnapshot {
    return { generation: state.generation, deadlineAtMs: state.deadlineAtMs, limits: { ...state.limits }, used: { ...state.used },
      status: state.status === 'stopped' ? 'stopped' : now >= state.deadlineAtMs ? 'expired' : 'active', attempts: state.attempts.map(entrySnapshot) };
  }
  #active(state: Stored, now: number): void {
    if (state.status === 'stopped') reject('root_stopped');
    if (now >= state.deadlineAtMs) reject('deadline_exceeded');
  }
  #find(state: Stored, request: BudgetAttempt) {
    const entry = state.attempts.find(item => item.request.key === request.key);
    if (entry && canonical(entry.request) !== canonical(request)) reject('attempt_conflict');
    return entry;
  }
  async open(input: RootBudgetContext): Promise<RootBudgetSnapshot> {
    const context = parse(contextSchema, input, 'invalid_context'), ref = this.#ref(context);
    return this.#database.runTransaction(async transaction => {
      const document = await transaction.get(ref), now = this.#now();
      if (document.exists) {
        const state = this.#load(context, document);
        if (now >= state.deadlineAtMs) reject('deadline_exceeded');
        return this.#snapshot(state, now);
      }
      if (now >= context.binding.deadlineAtMs) reject('deadline_exceeded');
      const state: Stored = { bindingFingerprint: this.#fingerprint(context), generation: context.generation, deadlineAtMs: context.binding.deadlineAtMs,
        limits: context.binding.limits, used: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 }, status: 'active', attempts: [] };
      transaction.create(ref, this.#seal(context, state)); return this.#snapshot(state, now);
    });
  }
  async read(input: RootBudgetContext): Promise<RootBudgetSnapshot> {
    const context = parse(contextSchema, input, 'invalid_context'), ref = this.#ref(context);
    return this.#database.runTransaction(async transaction => {
      const state = this.#load(context, await transaction.get(ref)); return this.#snapshot(state, this.#now());
    }, { readOnly: true });
  }
  async reserve(input: RootBudgetContext, attempt: BudgetAttempt): Promise<BudgetAdmission> {
    const context = parse(contextSchema, input, 'invalid_context'), request = parse(attemptSchema, attempt, 'invalid_attempt'), ref = this.#ref(context);
    return this.#database.runTransaction(async transaction => {
      const state = this.#load(context, await transaction.get(ref)), now = this.#now(); this.#active(state, now);
      const existing = this.#find(state, request);
      if (existing) return { decision: 'lookup', attempt: entrySnapshot(existing), snapshot: this.#snapshot(state, now) };
      const key = counter(request);
      if (state.used[key] + request.units > state.limits[key]) reject('budget_exhausted');
      if (state.attempts.length >= MAX_ROOT_BUDGET_ATTEMPTS) reject('attempt_capacity');
      const entry: Stored['attempts'][number] = { request, outcome: { status: 'reserved' } };
      state.used[key] += request.units; state.attempts.push(entry);
      transaction.set(ref, this.#seal(context, state));
      return { decision: 'execute', attempt: entrySnapshot(entry), snapshot: this.#snapshot(state, now) };
    });
  }
  async settle(input: RootBudgetContext, attempt: BudgetAttempt, result: BudgetSettlement): Promise<RootBudgetSnapshot> {
    const context = parse(contextSchema, input, 'invalid_context'), request = parse(attemptSchema, attempt, 'invalid_attempt'),
      outcome = parse(settlementSchema, result, 'invalid_settlement'), ref = this.#ref(context);
    return this.#database.runTransaction(async transaction => {
      const state = this.#load(context, await transaction.get(ref)), now = this.#now(), entry = this.#find(state, request);
      if (!entry) reject('attempt_not_found');
      // A read-back of the identical prior settlement is safe even after stop/expiry.
      if (canonical(entry.outcome) === canonical(outcome)) return this.#snapshot(state, now);
      this.#active(state, now);
      if (entry.outcome.status !== 'reserved') reject('settlement_conflict');
      entry.outcome = outcome; transaction.set(ref, this.#seal(context, state)); return this.#snapshot(state, now);
    });
  }
  async stop(input: RootBudgetContext): Promise<RootBudgetSnapshot> {
    const context = parse(contextSchema, input, 'invalid_context'), ref = this.#ref(context);
    return this.#database.runTransaction(async transaction => {
      const state = this.#load(context, await transaction.get(ref)), now = this.#now();
      if (state.status !== 'stopped') { state.status = 'stopped'; transaction.set(ref, this.#seal(context, state)); }
      return this.#snapshot(state, now);
    });
  }
}
