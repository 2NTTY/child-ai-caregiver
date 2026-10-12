import { randomUUID } from 'node:crypto';
import type { DocumentSnapshot, Transaction } from '@google-cloud/firestore';
import { z } from 'zod';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, FIRESTORE_TASK_DISPATCH_SCOPE,
  type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { workRecoveryScopeSchema } from './firestore-work-continuation-recovery.ts';
import type { FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';

const time = z.iso.datetime({ offset: true }), uuid = z.uuid(), text = z.string().min(1).max(256);
const version = z.number().int().positive().max(2147483647);
export const backgroundKindSchema = z.enum(['child-change', 'growth', 'concern', 'work-check', 'work-continuation', 'task-agent',
  'document-refresh', 'knowledge-check', 'photo-cleanup', 'scope-erasure', 'push', 'telegram', 'contact']);
const identitySchema = z.object({ kind: backgroundKindSchema, scope: workRecoveryScopeSchema, resourceId: text,
  basis: text, generation: uuid, authorizationVersion: text }).strict();
export const firestoreBackgroundWorkSchema = identitySchema.extend({ id: z.string().regex(/^[a-f0-9]{64}$/u),
  version, createdAt: time, dueAt: time, dispatchRevision: version,
  state: z.enum(['pending', 'leased', 'completed', 'stopped', 'failed', 'unknown']),
  failures: z.number().int().min(0).max(3), attempts: z.number().int().nonnegative(),
  dispatch: z.enum(['pending', 'sending', 'confirmed', 'unknown', 'conflict']),
  dispatchLease: z.object({ token: uuid, until: time }).strict().nullable(),
  lease: z.object({ token: uuid, until: time }).strict().nullable(),
}).strict();
export const firestoreBackgroundDeliverySchema = z.object({ kind: z.literal('product-work'),
  id: z.string().regex(/^[a-f0-9]{64}$/u), generation: uuid, dispatchRevision: version, scheduledAt: time }).strict();
export type FirestoreBackgroundWork = z.infer<typeof firestoreBackgroundWorkSchema>;
export type FirestoreBackgroundDelivery = z.infer<typeof firestoreBackgroundDeliverySchema>;
export type BackgroundIdentity = z.infer<typeof identitySchema>;
const routeSchema = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/u), scope: workRecoveryScopeSchema }).strict();
const ref = (data: FirestoreDomainData, id: string) => data.ref('background_work', 'background-work', id);
const jobId = (identity: BackgroundIdentity) => firestoreDomainHash(['product-work', identity]);
const referenceSchema = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/u), reference: uuid }).strict();
export const firestoreBackgroundRecoverySchemas = { route: routeSchema, reference: referenceSchema, identity: identitySchema };
export function firestoreBackgroundReference(job: Pick<FirestoreBackgroundWork, 'id'>) {
  const hex = job.id;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function seal(data: FirestoreDomainData, raw: FirestoreBackgroundWork) {
  const value = domainParse(firestoreBackgroundWorkSchema, raw, 'background_binding', 500);
  const identity = identitySchema.parse({ kind: value.kind, scope: value.scope, resourceId: value.resourceId,
    basis: value.basis, generation: value.generation, authorizationVersion: value.authorizationVersion });
  if (value.id !== jobId(identity)) domainReject('background_binding', 500);
  return { ...data.tags(value.scope), id: value.id, state: value.state, dueAt: value.dueAt,
    dispatch: value.dispatch, leaseUntil: value.lease?.until ?? null,
    route: data.seal('background-route', value.id, FIRESTORE_TASK_DISPATCH_SCOPE, routeSchema, { id: value.id, scope: value.scope }),
    ...data.seal('background-work', value.id, value.scope, firestoreBackgroundWorkSchema, value, value.version) };
}
function open(data: FirestoreDomainData, snapshot: DocumentSnapshot): FirestoreBackgroundWork | null {
  if (!snapshot.exists) return null;
  const body = snapshot.data();
  const id = domainParse(z.string().regex(/^[a-f0-9]{64}$/u), body?.id, 'background_binding', 500);
  const route = data.open('background-route', id, FIRESTORE_TASK_DISPATCH_SCOPE, routeSchema,
    { exists: !!body?.route, data: () => body?.route } as DocumentSnapshot);
  if (route.id !== id || ref(data, id).id !== snapshot.id) domainReject('background_binding', 500);
  const value = data.open('background-work', route.id, route.scope, firestoreBackgroundWorkSchema, snapshot);
  const identity = identitySchema.parse({ kind: value.kind, scope: value.scope, resourceId: value.resourceId,
    basis: value.basis, generation: value.generation, authorizationVersion: value.authorizationVersion });
  if (value.id !== jobId(identity)) domainReject('background_binding', 500);
  const expected = { ...data.tags(value.scope), id: value.id, state: value.state, dueAt: value.dueAt,
    dispatch: value.dispatch, leaseUntil: value.lease?.until ?? null, recordVersion: value.version };
  // Authenticate routing and query projections without encrypting a new envelope during reads.
  for (const field of ['id', 'state', 'dueAt', 'dispatch', 'leaseUntil', 'recordVersion', 'userTag', 'workspaceTag', 'childTag', 'epochTag'] as const)
    if (body?.[field] !== expected[field]) domainReject('background_binding', 500);
  if (firestoreDomainHash(value.scope) !== firestoreDomainHash(route.scope)) domainReject('background_binding', 500);
  return value;
}

/** Prepare in the caller's authority transaction; commit only after every domain read has finished. */
export async function prepareFirestoreBackgroundWork(data: FirestoreDomainData, tx: Transaction,
  raw: BackgroundIdentity, dueAt: string) {
  const identity = domainParse(identitySchema, raw), id = jobId(identity);
  domainParse(time, dueAt);
  const prior = open(data, await tx.get(ref(data, id)));
  if (prior) return { id, commit() {} };
  const reference = firestoreBackgroundReference({ id }), referenceId = JSON.stringify([identity.scope.ownerUserId, identity.scope.childId, reference]);
  const referenceRef = data.ref('background_references', 'background-reference', referenceId);
  if ((await tx.get(referenceRef)).exists) domainReject('background_reference_conflict');
  const value: FirestoreBackgroundWork = { ...identity, id, dueAt, version: 1, dispatchRevision: 1,
    createdAt: new Date().toISOString(), state: 'pending', failures: 0, attempts: 0,
    dispatch: 'pending', dispatchLease: null, lease: null };
  const envelope = seal(data, value);
  const pointer = { ...data.tags(identity.scope), ...data.seal('background-reference', referenceId, identity.scope, referenceSchema, { id, reference }) };
  return { id, commit() { tx.create(ref(data, id), envelope); tx.create(referenceRef, pointer); } };
}

/** A native worker lease is the only route to a background model claim. Knowledge maintenance never uses a family run. */
export async function readFirestoreBackgroundClaim(data: FirestoreDomainData, b: Binding, reference: string) {
  domainParse(uuid, reference);
  const id = JSON.stringify([b.scope.ownerUserId, b.scope.childId, reference]);
  const pointer = await b.transaction.get(data.ref('background_references', 'background-reference', id)); if (!pointer.exists) return null;
  const route = data.open('background-reference', id, b.scope, referenceSchema, pointer);
  const job = open(data, await b.transaction.get(ref(data, route.id)));
  if (!job || route.reference !== reference || firestoreBackgroundReference(job) !== reference || job.state !== 'leased' || !job.lease
    || Date.parse(job.lease.until) <= Date.now() || job.generation !== b.generation || job.authorizationVersion !== b.authorizationVersion
    || firestoreDomainHash(job.scope) !== firestoreDomainHash(b.scope)
    || !['growth', 'concern', 'task-agent', 'work-continuation'].includes(job.kind)) return null;
  return job;
}

export interface BackgroundTransport {
  enqueue(job: FirestoreBackgroundDelivery): Promise<{ state: 'confirmed' | 'unknown' | 'conflict' }>;
  probe(job: FirestoreBackgroundDelivery): Promise<{ state: 'confirmed' | 'unknown' | 'conflict' }>;
}
export interface BackgroundQueueOptions extends FirestoreDomainOptions {
  enabled: boolean;
  readControl(tx?: Transaction): Promise<{ generation: string; enabled: boolean }>;
  transport: BackgroundTransport;
  execute(job: FirestoreBackgroundWork, signal: AbortSignal): Promise<{ state: 'completed' | 'stopped' | 'unknown' | 'deferred'; nextAt?: string }>;
  signal?: AbortSignal;
}
/** Product-only outbox. Handlers recheck canonical resources and recover original effects before executing. */
export function createFirestoreBackgroundQueue(options: BackgroundQueueOptions) {
  const data = new FirestoreDomainData(options), database = options.database;
  const delivery = (job: FirestoreBackgroundWork): FirestoreBackgroundDelivery => ({ kind: 'product-work', id: job.id,
    generation: job.generation, dispatchRevision: job.dispatchRevision, scheduledAt: job.dueAt });
  const save = (tx: Transaction, job: FirestoreBackgroundWork) => tx.set(ref(data, job.id), seal(data, { ...job, version: job.version + 1 }));
  async function claimDispatch(id: string) {
    const token = randomUUID();
    return database.runTransaction(async tx => {
      const control = await options.readControl(tx), job = open(data, await tx.get(ref(data, id)));
      if (!options.enabled || !control.enabled || !job || job.state !== 'pending'
        || job.dispatch === 'confirmed' || job.dispatch === 'conflict') return null;
      if (control.generation !== job.generation) { save(tx, { ...job, state: 'stopped', dispatchLease: null }); return null; }
      if (job.dispatchLease && Date.parse(job.dispatchLease.until) > Date.now()) return null;
      const probeOnly = job.dispatch !== 'pending';
      save(tx, { ...job, dispatch: 'sending', dispatchLease: { token, until: new Date(Date.now() + 30_000).toISOString() } });
      return { job, token, probeOnly };
    });
  }
  async function dispatchOne(id: string) {
    const claim = await claimDispatch(id); if (!claim) return 'skipped';
    const response = await options.transport[claim.probeOnly ? 'probe' : 'enqueue'](delivery(claim.job));
    await database.runTransaction(async tx => {
      const job = open(data, await tx.get(ref(data, id)));
      if (!job || job.dispatchRevision !== claim.job.dispatchRevision || job.dispatchLease?.token !== claim.token) return;
      save(tx, { ...job, dispatch: response.state, dispatchLease: null });
    });
    return response.state;
  }
  async function dispatch() {
    if (!options.enabled || !(await options.readControl()).enabled) return { scanned: 0, confirmed: 0, unresolved: 0 };
    // Confirmed Tasks retry their original request. Unknown create results are probed, never recreated.
    const rows = await data.collection('background_work').where('state', '==', 'pending')
      .where('dispatch', 'in', ['pending', 'sending']).where('dueAt', '<=', new Date(Date.now() + 86400_000).toISOString())
      .orderBy('dueAt').orderBy('id').limit(12).get();
    let confirmed = 0, unresolved = 0;
    for (const row of rows.docs) { const job = open(data, row)!; const result = await dispatchOne(job.id); if (result === 'confirmed') confirmed++; else if (result !== 'skipped') unresolved++; }
    return { scanned: rows.size, confirmed, unresolved };
  }
  async function process(raw: FirestoreBackgroundDelivery) {
    const request = domainParse(firestoreBackgroundDeliverySchema, raw), token = randomUUID();
    const claimed = await database.runTransaction(async tx => {
      const control = await options.readControl(tx), job = open(data, await tx.get(ref(data, request.id)));
      if (!options.enabled || !control.enabled || !job || control.generation !== request.generation || job.generation !== request.generation
        || job.dispatchRevision !== request.dispatchRevision || job.dueAt !== request.scheduledAt) return { state: 'stopped' as const };
      if (job.state !== 'pending' && job.state !== 'leased') return { state: job.state };
      if (Date.parse(job.dueAt) > Date.now()) return { state: 'busy' as const };
      if (job.lease && Date.parse(job.lease.until) > Date.now()) return { state: 'busy' as const };
      const failures = Math.min(3, job.failures + (job.lease ? 1 : 0));
      if (failures >= 3) { save(tx, { ...job, failures, state: 'failed', lease: null }); return { state: 'failed' as const }; }
      const next = { ...job, state: 'leased' as const, failures, attempts: job.attempts + 1,
        dispatch: 'confirmed' as const, lease: { token, until: new Date(Date.now() + 120_000).toISOString() } };
      save(tx, next); return { state: 'claimed' as const, job: next };
    });
    if (claimed.state !== 'claimed') return { state: claimed.state };
    let outcome: Awaited<ReturnType<BackgroundQueueOptions['execute']>>;
    try { outcome = await options.execute(claimed.job, AbortSignal.any([AbortSignal.timeout(95_000), ...(options.signal ? [options.signal] : [])])); }
    catch (error) {
      const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
      outcome = { state: status === 403 || status === 404 || status === 409 ? 'stopped' : 'unknown' };
    }
    return database.runTransaction(async tx => {
      const control = await options.readControl(tx), job = open(data, await tx.get(ref(data, request.id)));
      if (!job || job.lease?.token !== token) return { state: 'stopped' as const };
      const current = control.enabled && control.generation === job.generation && Date.parse(job.lease.until) > Date.now();
      const nextAt = outcome.state === 'deferred' ? domainParse(time, outcome.nextAt, 'background_next_time', 500) : null;
      if (nextAt && Date.parse(nextAt) <= Date.now()) domainReject('background_next_time', 500);
      const state = !current ? 'unknown' as const : outcome.state === 'deferred' ? 'pending' as const : outcome.state;
      save(tx, { ...job, state, lease: null, ...(state === 'pending' ? { dueAt: nextAt!, dispatchRevision: job.dispatchRevision + 1,
        dispatch: 'pending' as const, dispatchLease: null } : {}) });
      return { state };
    });
  }
  return { dispatch, process };
}
