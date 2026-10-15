/// <reference lib="es2024.string" />
import { createHash } from 'node:crypto';
import type { Firestore, DocumentSnapshot } from '@google-cloud/firestore';
import { z } from 'zod';
import { agentWorkValuesSchema } from '../src/shared/agent-work.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { StorageCipher } from './storage-crypto.ts';
import type { WorkContinuationJob } from './agent-work-continuation.ts';
import type { WorkContinuationRecovery } from './agent-work-continuation-worker.ts';
import { canonical } from './firestore-session-codec.ts';

const FORMAT = 'yuban-work-recovery';
const bounded = (max: number) => z.string().min(1).max(max).refine(value => value.isWellFormed());
const id = bounded(256), uuid = z.uuid(), integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const decimal = z.string().regex(/^(0|[1-9][0-9]{0,18})$/u).refine(value => BigInt(value) <= 9223372036854775807n);
const state = z.enum(['active', 'deleting', 'deleted']);
const scopeSchema = z.object({ ownerUserId: id, workspaceId: uuid, childId: uuid, storageEpoch: uuid }).strict();
export type WorkRecoveryScope = z.infer<typeof scopeSchema>;
export type WorkRecoveryKind = 'control' | 'account' | 'workspace' | 'child' | 'work' | 'followup' | 'event' | 'claim' | 'run' | 'change';
const scoped = { ...scopeSchema.shape, authorizationVersion: decimal };
const schemas = {
  control: z.object({ enabled: z.boolean(), generation: uuid }).strict(),
  account: z.object({ userId: id, status: state, admitted: z.boolean(), invitationLive: z.boolean(),
    emailVerified: z.boolean(), acknowledgementVersion: bounded(128).nullable() }).strict(),
  workspace: z.object({ id: uuid, ownerUserId: id, storageEpoch: uuid, accessVersion: decimal, changeSeq: decimal, status: state }).strict(),
  child: z.object({ id: uuid, workspaceId: uuid, status: state }).strict(),
  work: z.object({ ...scopeSchema.shape, id: uuid, version: integer.min(1).max(2147483646),
    status: agentWorkValuesSchema.shape.status, payloadEncrypted: bounded(64 * 1024) }).strict(),
  followup: z.object({ ...scoped, workId: uuid, workVersion: integer.min(1).max(2147483646), enabled: z.boolean(),
    dueAt: z.iso.datetime({ offset: true }), dueConsumed: z.boolean(), watchResources: z.boolean(),
    knowledgeSourceIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u)).max(4) }).strict(),
  event: z.object({ ...scoped, id: uuid, jobId: uuid, workerGeneration: uuid,
    state: z.enum(['queued', 'completed', 'stopped', 'unknown', 'cancelled']), runId: uuid,
    payloadEncrypted: bounded(64 * 1024) }).strict(),
  claim: z.object({ ...scoped, runId: uuid, triggerKind: z.literal('worker'), triggerReference: uuid }).strict(),
  run: z.object({ ...scoped, id: uuid, triggerKind: z.literal('worker'), triggerReference: uuid,
    sourceMessageId: z.null(), recipeId: z.literal('product-work-followup'),
    dataVersion: bounded(100), state: z.enum(['running', 'completed', 'stopped', 'unknown']),
    stopReason: bounded(128).nullable(), expiresAtMs: integer.min(1), resultEncrypted: bounded(128 * 1024).nullable() }).strict(),
};
const eventPayloadSchema = z.object({ works: z.array(z.object({ workId: uuid, workVersion: integer.min(1).max(2147483646),
  changes: z.object({ due: z.literal(true), resources: z.array(z.never()).max(0), knowledge: z.array(z.never()).max(0) }).strict(),
}).strict()).min(1).max(5).refine(items => new Set(items.map(item => item.workId)).size === items.length) }).strict();
const receiptSchema = z.object({ runId: uuid, status: z.enum(['completed', 'stopped', 'unknown']), stopReason: bounded(128).nullable(),
  provenance: z.object({ packVersion: id, recipeId: z.literal('product-work-followup'), model: id }).strict().nullable(),
  countsKnown: z.boolean().optional(), counts: z.object({ modelCalls: integer.max(12), toolCalls: integer.max(8), queryEmbeddings: integer.max(6) }).strict(),
  outcome: z.literal('no_action').optional(),
  text: z.string().max(64000), citations: z.array(z.unknown()).max(6), privateSourceCitations: z.array(z.unknown()).max(8).optional(),
  retrievalMode: z.enum(['vector_keyword', 'keyword_degraded', 'not_used']),
  tools: z.array(z.object({ name: id, status: z.enum(['succeeded', 'rejected', 'conflict', 'failed', 'unknown']), reference: id.optional() }).strict()).max(8),
  proposals: z.array(z.never()).max(0),
}).strict().refine(value => value.outcome !== 'no_action' || value.status === 'completed' && value.text === ''
  && value.citations.length === 0 && !value.privateSourceCitations?.length && value.retrievalMode === 'not_used');
const jobSchema = z.object({ eventId: uuid, jobId: uuid, workerGeneration: uuid, storageEpoch: uuid }).strict();
const MAX_BYTES = 192 * 1024;
function reject(code: string): never { throw new Error(`work_recovery_${code}`); }
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value); if (!parsed.success) reject('invalid_document'); return parsed.data;
}
function size(value: unknown) { if (Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8') > MAX_BYTES) reject('document_too_large'); }
const same = (left: unknown, right: unknown) => canonical(left) === canonical(right);

/** Point-read identities; account and control have one canonical identity in a namespace. */
export function workRecoveryDocumentId(kind: WorkRecoveryKind | 'daily', originalId: string): string {
  return createHash('sha256').update(JSON.stringify([kind, originalId])).digest('hex');
}
export function workRecoveryClaimId(scope: WorkRecoveryScope, eventId: string): string {
  return JSON.stringify([scope.ownerUserId, scope.childId, 'worker', eventId]);
}
/** Stable storage format shared with the synthetic fixture writer; no production seed API. */
export function workRecoveryAad(projectId: string, namespace: string, kind: WorkRecoveryKind | 'daily', originalId: string, scope: WorkRecoveryScope, version: 1 | 2 = 1): string {
  const binding = kind === 'control' ? null : kind === 'account' ? { ownerUserId: scope.ownerUserId }
    : kind === 'workspace' ? { workspaceId: scope.workspaceId } : scope;
  return JSON.stringify([FORMAT, version, projectId, namespace, kind, originalId, binding]);
}
export interface FirestoreWorkRecoveryOptions {
  database: Firestore; cipher: StorageCipher; projectId: string; namespace: string;
  /** Server-selected original scope; never derived from model or HTTP input. */
  scope: WorkRecoveryScope;
  serverClock?: () => number;
}

/**
 * Recovery-only, owner-only pure-due events that already have an original claim/run.
 * Never accepts new work, runs a model, exposes receipt content or falls back to SQL.
 * Authority documents currently require synthetic seeding; not selected by bootstrap.
 */
export class FirestoreWorkContinuationRecovery implements WorkContinuationRecovery {
  #options: Readonly<FirestoreWorkRecoveryOptions>;
  protected get options() { return this.#options; }
  constructor(options: FirestoreWorkRecoveryOptions) {
    if (!options || typeof options.database?.runTransaction !== 'function' || typeof options.database?.collection !== 'function'
      || typeof options.cipher?.encrypt !== 'function' || typeof options.cipher?.decrypt !== 'function'
      || !id.safeParse(options.projectId).success || options.projectId !== options.projectId.trim()
      || !/^[a-z][a-z0-9_]{0,60}$/u.test(options.namespace)
      || options.serverClock !== undefined && typeof options.serverClock !== 'function') reject('configuration');
    this.#options = Object.freeze({ ...options, scope: Object.freeze(parse(scopeSchema, options.scope)) });
  }
  protected ref(kind: WorkRecoveryKind | 'daily', originalId: string) {
    return this.options.database.collection(this.options.namespace).doc(workRecoveryDocumentId(kind, originalId));
  }
  protected aad(kind: WorkRecoveryKind | 'daily', originalId: string, version: 1 | 2 = 1) {
    const { projectId, namespace, scope } = this.options; return workRecoveryAad(projectId, namespace, kind, originalId, scope, version);
  }
  protected seal(kind: WorkRecoveryKind | 'daily', originalId: string, value: unknown, version: 1 | 2 = 1) {
    size(value);
    const envelope = { format: FORMAT, version, ciphertext: this.options.cipher.encrypt(canonical(value), this.aad(kind, originalId, version)) };
    size(envelope); return envelope;
  }
  protected open<T>(kind: WorkRecoveryKind | 'daily', originalId: string, snapshot: DocumentSnapshot, schema: z.ZodType<T>, version: 1 | 2 = 1): T {
    if (!snapshot.exists) reject('missing_document');
    const envelope = parse(z.object({ format: z.literal(FORMAT), version: z.literal(version), ciphertext: bounded(MAX_BYTES), recovery: z.unknown().optional() }).strict(), snapshot.data());
    size(envelope);
    return this.decrypt(envelope.ciphertext, this.aad(kind, originalId, version), schema);
  }
  protected decrypt<T>(ciphertext: string, aad: string, schema: z.ZodType<T>): T {
    let value: unknown;
    try { const text = this.options.cipher.decrypt(ciphertext, aad); if (Buffer.byteLength(text) > MAX_BYTES) reject('document_too_large'); value = JSON.parse(text); }
    catch { reject('ciphertext'); }
    return parse(schema, value);
  }
  async recoverBackground(raw: WorkContinuationJob): ReturnType<WorkContinuationRecovery["recoverBackground"]> {
    const job = parse(jobSchema, raw), { database, scope } = this.options;
    if (job.storageEpoch !== scope.storageEpoch) reject('scope');
    const claimId = workRecoveryClaimId(scope, job.eventId);
    return database.runTransaction(async transaction => {
      const read = async <T>(kind: WorkRecoveryKind | 'daily', originalId: string, schema: z.ZodType<T>) =>
        this.open(kind, originalId, await transaction.get(this.ref(kind, originalId)), schema);
      const control = await read('control', 'current', schemas.control);
      const account = await read('account', scope.ownerUserId, schemas.account);
      const workspace = await read('workspace', scope.workspaceId, schemas.workspace);
      const child = await read('child', scope.childId, schemas.child);
      const event = await read('event', job.eventId, schemas.event);
      const claim = await read('claim', claimId, schemas.claim);
      const run = await read('run', event.runId, schemas.run);
      const now = (this.options.serverClock ?? Date.now)();
      if (!Number.isSafeInteger(now) || now < 0) reject('clock');
      if (!control.enabled || control.generation !== job.workerGeneration || account.userId !== scope.ownerUserId
        || account.status !== 'active' || !account.admitted || !account.invitationLive || !account.emailVerified
        || account.acknowledgementVersion !== SERVICE_POLICY_VERSION || workspace.id !== scope.workspaceId
        || workspace.ownerUserId !== scope.ownerUserId || workspace.status !== 'active' || workspace.storageEpoch !== scope.storageEpoch
        || child.id !== scope.childId || child.workspaceId !== scope.workspaceId || child.status !== 'active') reject('authority');
      const bound = (value: WorkRecoveryScope & { authorizationVersion: string }) =>
        same(scope, { ownerUserId: value.ownerUserId, workspaceId: value.workspaceId, childId: value.childId, storageEpoch: value.storageEpoch })
        && value.authorizationVersion === workspace.accessVersion;
      if (![event, claim, run].every(bound) || event.id !== job.eventId || event.jobId !== job.jobId
        || event.workerGeneration !== job.workerGeneration || claim.runId !== event.runId || claim.triggerReference !== event.id
        || run.id !== event.runId || run.triggerReference !== event.id
        || !run.dataVersion.startsWith(scope.storageEpoch + ':') || !decimal.safeParse(run.dataVersion.slice(scope.storageEpoch.length + 1)).success) reject('binding');
      const payload = this.decrypt(event.payloadEncrypted, `agent-work-continuation:${scope.childId}:${scope.ownerUserId}:${event.id}`, eventPayloadSchema);
      let active = 0;
      for (const candidate of payload.works) {
        const work = await read('work', candidate.workId, schemas.work), followup = await read('followup', candidate.workId, schemas.followup);
        if (!same(scope, { ownerUserId: work.ownerUserId, workspaceId: work.workspaceId, childId: work.childId, storageEpoch: work.storageEpoch })
          || work.id !== candidate.workId || !bound(followup) || followup.workId !== work.id || followup.workVersion !== work.version) reject('binding');
        const values = this.decrypt(work.payloadEncrypted, `agent-work:${scope.childId}:${scope.ownerUserId}:${work.id}:${work.version}`, agentWorkValuesSchema);
        if (values.status !== work.status) reject('binding');
        if (work.version !== candidate.workVersion || !followup.enabled || !['active', 'waiting'].includes(work.status)) continue;
        if (values.resources.length || !values.followUp || values.followUp.watchResources || values.followUp.knowledgeSourceIds.length
          || !values.followUp.dueAt || values.followUp.dueAt !== followup.dueAt || !followup.dueConsumed
          || Date.parse(followup.dueAt) > now) reject('unsupported_event');
        active++;
      }
      const receipt = run.resultEncrypted === null ? null : this.decrypt(run.resultEncrypted,
        `agent-run:${scope.childId}:${scope.ownerUserId}:${run.id}`, receiptSchema);
      if (receipt && (receipt.runId !== run.id || receipt.status !== run.state || receipt.stopReason !== run.stopReason)) reject('receipt_binding');
      if (run.state === 'completed' && !receipt || run.state === 'stopped' && !receipt
        || run.state === 'running' && (receipt || run.stopReason !== null)
        || run.state === 'unknown' && !receipt && run.stopReason !== 'interrupted') reject('receipt_missing');
      // Recheck current authority/bindings; terminal event precedence is immutable, not a claim of event/run agreement.
      if (event.state !== 'queued') return { state: 'already_terminal' as const, runId: run.id };
      if (active && run.state === 'running' && run.expiresAtMs > now) return { state: 'pending' as const, runId: run.id };
      const nextState = !active ? 'cancelled' : run.state === 'running' ? 'unknown' : run.state;
      const nextSequence = (BigInt(workspace.changeSeq) + 1n).toString();
      if (!decimal.safeParse(nextSequence).success) reject('sequence_exhausted');
      const changeId = JSON.stringify([scope.workspaceId, scope.storageEpoch, event.id]);
      const changeRef = this.ref('change', changeId);
      if ((await transaction.get(changeRef)).exists) reject('change_conflict');
      // All reads precede all writes; the callback may be discarded and rerun by the SDK.
      transaction.set(this.ref('event', event.id), this.seal('event', event.id, { ...event, state: nextState }));
      if (run.state === 'running' && run.expiresAtMs <= now)
        transaction.set(this.ref('run', run.id), this.seal('run', run.id, { ...run, state: 'unknown', stopReason: 'interrupted' }));
      transaction.set(this.ref('workspace', workspace.id), this.seal('workspace', workspace.id, { ...workspace, changeSeq: nextSequence }));
      transaction.create(changeRef, this.seal('change', changeId, { workspaceId: scope.workspaceId, storageEpoch: scope.storageEpoch,
        changeSeq: nextSequence, kind: 'memory', childId: scope.childId, privateUserId: scope.ownerUserId,
        ownerOnly: false, deleted: false, suppressWorkWake: true, eventId: event.id, runId: run.id }));
      return { state: 'settled' as const, runId: run.id };
    });
  }
}

export { schemas as workRecoverySchemas, eventPayloadSchema as workRecoveryPayloadSchema, receiptSchema as workRecoveryReceiptSchema,
  scopeSchema as workRecoveryScopeSchema, parse as parseWorkRecovery, same as sameWorkRecovery };
