/// <reference lib="es2024.string" />
import { createHash, randomBytes } from 'node:crypto';
import type { DocumentSnapshot, Firestore, Transaction } from '@google-cloud/firestore';
import { z } from 'zod';
import { MODEL_USAGE_ACTIVITIES } from '../src/shared/admin.ts';
import type { ModelAttemptActivity } from './durable-ai-usage.ts';
import { dailyFinance, dayFinancialEvidenceSchema, type DayFinancialEvidence } from './ai-financial-evidence.ts';
import type { StorageCipher } from './storage-crypto.ts';
import type { ModelBillingSource, ModelSettingsUsage } from '../src/shared/model-settings.ts';
import { canonical, isRecord } from './firestore-session-codec.ts';
import { DurableAiUsageError, type DurableAiUsage, type DurableAiUsageAdmission, type DurableAiUsageReceipt,
  type DurableAiUsageRecord, type DurableAiUsageRequest } from './durable-ai-usage.ts';

const FORMAT = 'yuban-ai-daily-usage', VERSION = 1, MAX_BYTES = 16 * 1024;
export const KNOWLEDGE_MAINTENANCE_PAYER = 'system:knowledge-maintenance';
const id = z.string().min(1).refine(value => value.isWellFormed() && Buffer.byteLength(value, 'utf8') <= 256);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/u);
const sourceSchema = z.enum(['platform', 'personal']);
const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const requestSchema = z.object({ budgetPurpose: z.literal('knowledge_maintenance').optional(), maintenanceLimit: integer.min(1).max(1000).optional(), kind: z.enum(['model', 'embedding']).optional(), rootRunId: id, attemptKey: id, bindingFingerprint: fingerprint,
  requestFingerprint: fingerprint, userId: id, childId: id, model: id, deadlineAtMs: integer.min(1),
  userLimit: integer.min(1).max(1000), globalLimit: integer.min(1).max(10000) }).strict();
const recordSchema = z.union([
  z.object({ kind: z.literal('model').optional(), outcome: z.enum(['succeeded', 'rate_limited', 'timeout', 'unavailable', 'invalid_response', 'unauthorized']),
    inputTokens: integer.nullable(), outputTokens: integer.nullable(), cachedTokens: integer.nullable(), durationMs: integer }).strict(),
  z.object({ kind: z.literal('embedding'), outcome: z.enum(['succeeded', 'unavailable', 'invalid_response', 'invalid_input', 'unauthorized', 'timeout', 'cancelled']),
    inputTokens: integer.nullable(), billableCharacters: integer.nullable(), durationMs: integer }).strict(),
]);
const attemptSchema = z.object({ request: requestSchema, billingSource: sourceSchema, day: daySchema,
  reservedAtMs: integer, record: recordSchema.nullable(), preparedFingerprint: fingerprint.optional(), preparationTokenHash: fingerprint.optional() }).strict()
  .refine(value => value.preparedFingerprint === undefined || (value.request.kind ?? 'model') === 'model').refine(value => value.record === null
    || (value.request.kind ?? 'model') === (value.record.kind ?? 'model'));
// Missing dimensions are historical coverage gaps. Only observed reservations or reports add to them.
const counterSchema = z.object({ attempts: integer, inputTokens: integer, outputTokens: integer, cachedTokens: integer, known: integer }).strict();
const detailSchema = z.object({ sponsoredMaintenance: integer.optional(), model: integer.optional(), queryEmbedding: integer.optional(), documentEmbedding: integer.optional(), otherEmbedding: integer.optional(),
  activities: z.partialRecord(z.enum([...MODEL_USAGE_ACTIVITIES, 'retry', 'tool']), integer).optional(),
  embeddingCharacters: integer.optional(), embeddingCharacterReports: integer.optional() }).strict();
export const firestoreUsageRecoverySchemas = { attempt: attemptSchema, counter: counterSchema, detail: detailSchema };
type Counter = z.infer<typeof counterSchema>;
type SavedAttempt = z.infer<typeof attemptSchema>;
const emptyCounter = (): Counter => ({ attempts: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, known: 0 });
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
function reject(code: string): never { throw new DurableAiUsageError(code); }
function parse<T>(schema: z.ZodType<T>, value: unknown, code: string): T {
  const result = schema.safeParse(value); if (!result.success) reject(code); return result.data;
}
function receipt(state: SavedAttempt): DurableAiUsageReceipt {
  return { ...(state.request.kind ? { kind: state.request.kind } : {}), day: state.day, reservedAtMs: state.reservedAtMs, ...(state.preparedFingerprint ? { preparedFingerprint: state.preparedFingerprint } : {}), record: state.record ? { ...state.record } : null };
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
  #attemptId(request: Pick<DurableAiUsageRequest, 'rootRunId' | 'attemptKey'>) { return 'attempt_' + hash([request.rootRunId, request.attemptKey]); }
  #counterId(day: string, userId: string | null) { return 'daily_' + hash([this.#source, day, userId]); }
  // Existing workers and rollback images read the strict v1 quota documents.
  // Keep additive reporting separate and commit it with the original admission or acknowledgement.
  async #detail(transaction: Transaction, id: string) {
    const ref = this.#database.collection(this.#namespace + '_detail').doc(id);
    const snapshot = await transaction.get(ref);
    const key = 'detail/' + id;
    const value: z.infer<typeof detailSchema> = snapshot.exists ? this.#open(key, snapshot, detailSchema) : {};
    return { value, save: () => transaction.set(ref, this.#seal(key, parse(detailSchema, value, 'usage_overflow'))) };
  }
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
    // Older sponsored embeddings recorded the smaller of the two limits. Their receipt
    // remains lookup-only after the split, including settlement after midnight.
    let original: DurableAiUsageRequest = request;
    if (state.request.maintenanceLimit === undefined && request.maintenanceLimit !== undefined
      && this.#source === 'personal' && request.kind === 'embedding' && request.budgetPurpose === 'knowledge_maintenance') {
      const { maintenanceLimit, ...legacy } = request;
      original = { ...legacy, userLimit: Math.min(request.userLimit, maintenanceLimit) };
    }
    if (canonical(comparable(state.request)) !== canonical(comparable(original)) || state.billingSource !== this.#source) reject('attempt_conflict');
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
  async recordToolAdmission(transaction: Transaction, admittedAt: number, units: number) {
    const detail = await this.#detail(transaction, this.#counterId(this.#day(admittedAt), null));
    const activities = detail.value.activities ??= {};
    activities.tool = (activities.tool ?? 0) + integer.min(1).parse(units);
    detail.save();
  }
  /** Peek before starting a native PDF stage. The usual reserve remains authoritative at dispatch. */
  async modelCapacity(tx: Transaction, userId: string, userLimit: number, globalLimit: number) {
    const day = this.#day(this.#now());
    const globalId = this.#counterId(day, null), ownerId = this.#counterId(day, userId);
    const [globalSnapshot, ownerSnapshot] = await tx.getAll(this.#ref(globalId), this.#ref(ownerId));
    const global = this.#counter(globalId, globalSnapshot, ownerSnapshot.exists);
    const owner = this.#counter(ownerId, ownerSnapshot);
    this.#consistent(global, owner);
    return global.attempts < globalLimit && owner.attempts < userLimit;
  }

  async reserve(input: DurableAiUsageRequest, embeddingPurpose?: 'query_embedding' | 'corpus_maintenance', activity?: ModelAttemptActivity): Promise<DurableAiUsageAdmission> {
    const request = parse(requestSchema, input, 'invalid_request'), attemptId = this.#attemptId(request), attemptRef = this.#ref(attemptId);
    if (embeddingPurpose !== undefined && (request.kind !== 'embedding'
      || !['query_embedding', 'corpus_maintenance'].includes(embeddingPurpose))) reject('invalid_request');
    if (activity && (request.kind === 'embedding' || !MODEL_USAGE_ACTIVITIES.includes(activity.activity)
      || typeof activity.retry !== 'boolean')) reject('invalid_request');
    if (request.maintenanceLimit !== undefined && (this.#source !== 'personal' || embeddingPurpose !== 'corpus_maintenance'
      || request.budgetPurpose !== 'knowledge_maintenance')) reject('invalid_request');
    const dimension = request.kind !== 'embedding' ? 'model' : embeddingPurpose === 'query_embedding' ? 'queryEmbedding'
      : embeddingPurpose === 'corpus_maintenance' ? 'documentEmbedding' : 'otherEmbedding';
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
      const detail = await this.#detail(transaction, globalId);
      if (request.budgetPurpose === 'knowledge_maintenance' && this.#source === 'personal') {
        const ownerDetail = await this.#detail(transaction, userId);
        const maintenance = ownerDetail.value.sponsoredMaintenance ?? 0;
        if (request.maintenanceLimit !== undefined && maintenance >= request.maintenanceLimit) return { decision: 'quota_exceeded' };
        ownerDetail.value.sponsoredMaintenance = maintenance + 1;
        detail.value.sponsoredMaintenance = (detail.value.sponsoredMaintenance ?? 0) + 1;
        ownerDetail.save();
      }
      detail.value[dimension] = (detail.value[dimension] ?? 0) + 1;
      if (activity) {
        const counts = detail.value.activities ??= {};
        counts[activity.activity] = (counts[activity.activity] ?? 0) + 1;
        if (activity.retry) counts.retry = (counts.retry ?? 0) + 1;
      }
      global.attempts++; user.attempts++;
      const preparationToken = (request.kind ?? 'model') === 'model' ? randomBytes(32).toString('hex') : undefined;
      const state: SavedAttempt = { request, billingSource: this.#source, day, reservedAtMs: now, record: null,
        ...(preparationToken ? { preparationTokenHash: createHash('sha256').update(preparationToken).digest('hex') } : {}) };
      transaction.create(attemptRef, this.#seal(attemptId, state));
      transaction.set(globalRef, this.#seal(globalId, global)); transaction.set(userRef, this.#seal(userId, user));
      detail.save();
      return { decision: 'execute', receipt: receipt(state), ...(preparationToken ? { preparationToken } : {}) };
    });
  }
  async prepareModelDispatch(input: DurableAiUsageRequest, expected: string, next: string, preparationToken: string): Promise<DurableAiUsageReceipt> {
    const request = parse(requestSchema, input, 'invalid_request'),
      expectedFingerprint = parse(fingerprint, expected, 'invalid_fingerprint'), nextFingerprint = parse(fingerprint, next, 'invalid_fingerprint');
    if ((request.kind ?? 'model') !== 'model') reject('invalid_request');
    const token = parse(fingerprint, preparationToken, 'invalid_preparation_token');
    const id = this.#attemptId(request), ref = this.#ref(id);
    return this.#database.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) reject('attempt_not_found');
      const state = this.#attempt(id, snapshot, request);
      if (state.record) reject('record_conflict');
      if (state.preparationTokenHash !== createHash('sha256').update(token).digest('hex')) reject('preparation_owner_conflict');
      if (this.#now() >= request.deadlineAtMs) reject('deadline_exceeded');
      if ((state.preparedFingerprint ?? state.request.requestFingerprint) !== expectedFingerprint) reject('preparation_conflict');
      state.preparedFingerprint = nextFingerprint;
      transaction.set(ref, this.#seal(id, state)); return receipt(state);
    });
  }
  /** Same original billing/request check, with no nested transaction, reservation or accounting write. */
  async readInTransaction(input: DurableAiUsageRequest, transaction: Transaction): Promise<DurableAiUsageReceipt | null> {
    const request = parse(requestSchema, input, 'invalid_request'), id = this.#attemptId(request);
    const snapshot = await transaction.get(this.#ref(id));
    return snapshot.exists ? receipt(this.#attempt(id, snapshot, request)) : null;
  }
  async read(input: DurableAiUsageRequest): Promise<DurableAiUsageReceipt | null> {
    const request = parse(requestSchema, input, 'invalid_request');
    return this.#database.runTransaction(transaction => this.readInTransaction(request, transaction), { readOnly: true });
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
      if (record.kind === 'embedding' && record.billableCharacters !== null) {
        const detail = await this.#detail(transaction, globalId);
        detail.value.embeddingCharacters = (detail.value.embeddingCharacters ?? 0) + record.billableCharacters;
        detail.value.embeddingCharacterReports = (detail.value.embeddingCharacterReports ?? 0) + 1;
        detail.save();
      }
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
  async #resolveInvoiceLines(transaction: Transaction, day: string, lines: DayFinancialEvidence['attempts']) {
    return Promise.all(lines.map(async line => {
      const attemptId = this.#attemptId(line), snapshot = await transaction.get(this.#ref(attemptId));
      if (!snapshot.exists) reject('financial_binding_conflict');
      const saved = this.#open(attemptId, snapshot, attemptSchema);
      if (saved.billingSource !== this.#source || saved.day !== day || this.#day(saved.reservedAtMs) !== day
        || saved.request.model !== line.model || saved.request.rootRunId !== line.rootRunId || saved.request.attemptKey !== line.attemptKey
        || (line.ownerUserId !== undefined && line.ownerUserId !== saved.request.userId)
        || (line.rate && (line.rate.kind === 'model') !== ((saved.request.kind ?? 'model') === 'model'))) reject('financial_binding_conflict');
      const maintenance = this.#source === 'personal' ? saved.request.budgetPurpose === 'knowledge_maintenance'
        : saved.request.userId === KNOWLEDGE_MAINTENANCE_PAYER;
      return { line, userId: saved.request.userId, record: saved.record, maintenance };
    }));
  }
  async getGlobal(input: string, rawEvidence?: DayFinancialEvidence) {
    const day = parse(daySchema, input, 'invalid_day');
    const evidence = rawEvidence && parse(dayFinancialEvidenceSchema, rawEvidence, 'invalid_financial_evidence');
    if (evidence && (evidence.day !== day || evidence.payer !== this.#source)) reject('financial_binding_conflict');
    return this.#database.runTransaction(async transaction => {
      const id = this.#counterId(day, null), state = this.#counter(id, await transaction.get(this.#ref(id)));
      if (evidence && evidence.attempts.length > state.attempts) reject('financial_binding_conflict');
      const lines = await this.#resolveInvoiceLines(transaction, day, evidence?.attempts ?? []);
      const { value: detail } = await this.#detail(transaction, id);
      let maintenanceAttempts = detail.sponsoredMaintenance ?? 0;
      if (this.#source === 'platform') {
        const maintenanceId = this.#counterId(day, KNOWLEDGE_MAINTENANCE_PAYER);
        const maintenance = this.#counter(maintenanceId, await transaction.get(this.#ref(maintenanceId)));
        this.#consistent(state, maintenance);
        maintenanceAttempts = maintenance.attempts;
      }
      const projectFinance = (maintenance: boolean, attempts: number) => {
        const selected = lines.filter(item => maintenance === item.maintenance);
        if (selected.length > attempts) reject('financial_binding_conflict');
        return dailyFinance(this.#source, attempts, evidence && { ...evidence, attempts: selected.map(item => item.line),
          approvedDailyBudget: maintenance ? evidence.approvedMaintenanceBudget : evidence.approvedDailyBudget,
          providerQuota: maintenance ? undefined : evidence.providerQuota }, selected.map(item => item.record));
      };
      if (maintenanceAttempts > state.attempts) reject('counter_inconsistent');
      const model = detail.model ?? 0, queryEmbedding = detail.queryEmbedding ?? 0, documentEmbedding = detail.documentEmbedding ?? 0,
        otherEmbedding = detail.otherEmbedding ?? 0, unclassified = state.attempts - model - queryEmbedding - documentEmbedding - otherEmbedding;
      if (unclassified < 0) reject('invalid_stored_usage');
      return { day, attempts: state.attempts, inputTokens: state.inputTokens, outputTokens: state.outputTokens,
        cachedTokens: state.cachedTokens, unknownUsageAttempts: state.attempts - state.known, billingSource: this.#source,
        breakdown: { model, queryEmbedding, documentEmbedding, otherEmbedding, unclassified,
          ...(detail.activities ? { activities: detail.activities } : {}),
          embeddingCharacters: detail.embeddingCharacters ?? null, embeddingCharacterReports: detail.embeddingCharacterReports ?? 0 },
        finance: projectFinance(false, state.attempts - maintenanceAttempts),
        maintenanceFinance: projectFinance(true, maintenanceAttempts) };
    }, { readOnly: true });
  }
  async getForUser(input: string, financialEvidence?: readonly DayFinancialEvidence[], ledgerDay?: string): Promise<ModelSettingsUsage & { billingSource: ModelBillingSource }> {
    const userId = parse(id, input, 'invalid_user');
    return this.#database.runTransaction(async transaction => {
      const day = ledgerDay === undefined ? this.#day(this.#now()) : parse(daySchema, ledgerDay, 'invalid_day');
      const id = this.#counterId(day, userId), state = this.#counter(id, await transaction.get(this.#ref(id)));
      const usage = { day, attempts: state.attempts, inputTokens: state.inputTokens, outputTokens: state.outputTokens,
        cachedTokens: state.cachedTokens, unknownUsageAttempts: state.attempts - state.known, billingSource: this.#source };
      if (financialEvidence === undefined || this.#source !== 'personal') return usage;
      const evidence = financialEvidence.find(row => row.day === day && row.payer === 'personal');
      const candidates = state.attempts === 0 ? [] : evidence?.attempts.filter(line => !line.ownerUserId || line.ownerUserId === userId) ?? [];
      const lines = (await this.#resolveInvoiceLines(transaction, day, candidates)).filter(item => item.userId === userId);
      if (lines.length > state.attempts) reject('financial_binding_conflict');
      const maintenance = (await this.#detail(transaction, id)).value.sponsoredMaintenance ?? 0;
      if (maintenance > state.attempts) reject('counter_inconsistent');
      const project = (isMaintenance: boolean, attempts: number) => {
        const selected = lines.filter(item => item.maintenance === isMaintenance);
        if (selected.length > attempts) reject('financial_binding_conflict');
        const { settlement, estimates, unestimatedAttempts, unsettledAttempts } = dailyFinance(this.#source, attempts,
          evidence && { ...evidence, attempts: selected.map(item => item.line) }, selected.map(item => item.record));
        return { settlement, estimates, unestimatedAttempts, unsettledAttempts };
      };
      return { ...usage, finance: project(false, state.attempts - maintenance), maintenanceFinance: project(true, maintenance) };
    }, { readOnly: true });
  }
}

/** Preserve the original request contract when another ledger stores its recovery reference. */
export { requestSchema as firestoreDailyUsageRequestSchema };
