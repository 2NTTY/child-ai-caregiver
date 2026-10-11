import { randomUUID } from 'node:crypto';
import type { DocumentSnapshot } from '@google-cloud/firestore';
import { z } from 'zod';
import { FirestoreDomainData, FIRESTORE_TASK_DISPATCH_SCOPE, domainParse, domainReject, firestoreDomainHash,
  firestoreReminderDispatchRoutingSchema, firestoreReminderOutboxId, firestoreReminderOutboxSchema } from './firestore-domain-data.ts';
import { createFirestoreTaskWorker, type FirestoreTaskDelivery, type FirestoreTaskWorkerOptions } from './firestore-task-worker.ts';
import type { createFirebaseTaskDelivery, FirebaseTaskDeliveryResult } from './firebase-task-delivery.ts';

const datetime = z.iso.datetime({ offset: true }), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const cursorSchema = z.object({ version: z.literal(1), lane: z.enum(['pending', 'leased']), at: datetime,
  time: datetime.nullable(), id: hash.nullable() }).strict().refine(value => (value.time === null) === (value.id === null));
export const FIRESTORE_TASK_DISPATCH_SCAN_LEASE_MS = 60_000;
export const firestoreTaskDispatchScanSchema = z.object({
  revision: z.number().int().positive().max(2147483647), cursor: cursorSchema.nullable(),
  lease: z.object({ token: z.uuid(), until: datetime }).strict().nullable(),
}).strict();
export const firestoreTaskDispatchObservationSchema = z.object({ taskName: z.string().min(1).max(1024), jobHash: hash,
  scheduledAt: datetime, state: z.enum(['dispatching', 'confirmed', 'unknown', 'needs_attention']), calls: z.number().int().nonnegative().max(2147483647),
  unresolved: z.number().int().min(0).max(3), confirmedAt: datetime.nullable(), createdAt: datetime, updatedAt: datetime,
  lease: z.object({ token: z.uuid(), until: datetime }).strict().nullable() }).strict();
export interface FirestoreTaskDispatchPage {
  state: 'dispatched' | 'disabled'; scanned: number; confirmed: number; unknown: number; needsAttention: number;
  busy: number; rejected: number; skipped: number; hasMore: boolean; nextCursor: string | null;
}
export interface FirestoreTaskDispatcherOptions extends FirestoreTaskWorkerOptions {
  delivery: Pick<ReturnType<typeof createFirebaseTaskDelivery>, 'taskName' | 'enqueue' | 'probe'>;
}
const empty = (state: FirestoreTaskDispatchPage['state']): FirestoreTaskDispatchPage => ({ state, scanned: 0, confirmed: 0, unknown: 0,
  needsAttention: 0, busy: 0, rejected: 0, skipped: 0, hasMore: false, nextCursor: null });

/** One bounded global page wakes authorized durable work. Transport uncertainty never creates another identity. */
export function createFirestoreTaskDispatcher(options: FirestoreTaskDispatcherOptions) {
  const data = new FirestoreDomainData(options), worker = createFirestoreTaskWorker(options);
  if (!options.delivery || ['taskName', 'enqueue', 'probe'].some(key => typeof options.delivery[key as keyof typeof options.delivery] !== 'function')) domainReject('configuration', 500);
  const now = () => {
    const value = (options.serverClock ?? Date.now)();
    if (!Number.isSafeInteger(value) || value < 0 || value > 253402271909999) domainReject('clock', 500);
    return value;
  };
  function routing(snapshot: DocumentSnapshot): FirestoreTaskDelivery {
    const raw = snapshot.data(), taskId = domainParse(z.uuid(), raw?.taskId, 'dispatch_routing', 500);
    const taskVersion = domainParse(z.number().int().positive().max(2147483647), raw?.taskVersion, 'dispatch_routing', 500);
    const id = firestoreReminderOutboxId(taskId, taskVersion), dispatchId = firestoreDomainHash(['task-reminder-outbox', id]);
    if (snapshot.id !== dispatchId || raw?.dispatchId !== dispatchId) domainReject('dispatch_routing', 500);
    const route = data.open('task-dispatch-routing', id, FIRESTORE_TASK_DISPATCH_SCOPE, firestoreReminderDispatchRoutingSchema,
      { exists: !!raw?.dispatchRouting, data: () => raw?.dispatchRouting } as DocumentSnapshot);
    if (route.taskId !== taskId || route.taskVersion !== taskVersion || raw?.dispatchRouting.recordVersion !== taskVersion) domainReject('dispatch_routing', 500);
    for (const [key, value] of Object.entries(data.tags(route.scope))) if (raw?.[key] !== value) domainReject('dispatch_routing', 500);
    const work = data.open('task-reminder-outbox', id, route.scope, firestoreReminderOutboxSchema, snapshot);
    if (work.taskId !== taskId || work.taskVersion !== taskVersion || work.occurrenceId !== route.occurrenceId
      || work.ownerUserId !== route.scope.ownerUserId || work.workspaceId !== route.scope.workspaceId || work.childId !== route.scope.childId
      || work.storageEpoch !== route.scope.storageEpoch || work.authorizationVersion !== route.authorizationVersion || work.generation !== route.generation
      || work.taskVersion !== raw?.recordVersion || work.occurrenceId !== raw?.occurrenceId || work.state !== raw?.state
      || work.dueAt !== raw?.dueAt || (work.lease?.until ?? null) !== raw?.leaseUntil) domainReject('dispatch_routing', 500);
    return { kind: 'task-reminder', ...route, scheduledAt: work.dueAt };
  }
  const scanRef = data.ref('task_dispatches', 'task-dispatch-scan', 'current');
  type Scan = z.infer<typeof firestoreTaskDispatchScanSchema>;
  function readScan(snapshot: DocumentSnapshot): Scan | null {
    if (!snapshot.exists) return null;
    for (const [key,value] of Object.entries(data.tags(FIRESTORE_TASK_DISPATCH_SCOPE)))
      if (snapshot.get(key) !== value) domainReject('dispatch_scan_binding', 503);
    const scan = data.open('task-dispatch-scan', 'current', FIRESTORE_TASK_DISPATCH_SCOPE, firestoreTaskDispatchScanSchema, snapshot);
    if (snapshot.ref.path !== scanRef.path || snapshot.get('recordVersion') !== scan.revision
      || scan.cursor && Date.parse(scan.cursor.at) > now()) domainReject('dispatch_scan_binding', 503);
    return scan;
  }
  function revisionAfter(scan: Scan | null) {
    const revision = (scan?.revision ?? 0) + 1;
    return domainParse(firestoreTaskDispatchScanSchema.shape.revision, revision, 'dispatch_scan_revision', 503);
  }
  function scanEnvelope(scan: Scan) {
    return { ...data.tags(FIRESTORE_TASK_DISPATCH_SCOPE),
      ...data.seal('task-dispatch-scan', 'current', FIRESTORE_TASK_DISPATCH_SCOPE, firestoreTaskDispatchScanSchema, scan, scan.revision) };
  }
  async function claimScan(token: string) {
    return options.database.runTransaction(async transaction => {
      const snapshot = await transaction.get(scanRef), original = readScan(snapshot), at = now();
      if (original?.lease && Date.parse(original.lease.until) > at) return null;
      // Persist the initial cutoff too, so an expired/lost first claim retries the same page.
      const cursor = original?.cursor ?? { version: 1 as const, lane: 'pending' as const, at: new Date(at).toISOString(), time: null, id: null };
      const scan: Scan = { revision: revisionAfter(original), cursor,
        lease: { token, until: new Date(at + FIRESTORE_TASK_DISPATCH_SCAN_LEASE_MS).toISOString() } };
      const envelope = scanEnvelope(scan);
      if (snapshot.exists) transaction.set(scanRef,envelope); else transaction.create(scanRef,envelope);
      return scan;
    });
  }
  async function completeScan(claim: Scan, cursor: Scan['cursor']) {
    return options.database.runTransaction(async transaction => {
      const original = readScan(await transaction.get(scanRef));
      if (!original || original.revision !== claim.revision || original.lease?.token !== claim.lease!.token
        || Date.parse(original.lease.until) <= now()) return false;
      const next: Scan = { revision: revisionAfter(original), cursor, lease: null };
      transaction.set(scanRef,scanEnvelope(next)); return true;
    });
  }
  async function dispatchScheduled(): Promise<FirestoreTaskDispatchPage> {
    if (!options.enabled) return empty('disabled');
    const claim = await claimScan(randomUUID());
    if (!claim) return { ...empty('dispatched'), busy: 1 };
    // A thrown page/settlement leaves the original cutoff/cursor leased until expiry.
    const page = await dispatch(Buffer.from(JSON.stringify(claim.cursor)).toString('base64url'));
    const next = page.nextCursor === null ? null
      : domainParse(cursorSchema, JSON.parse(Buffer.from(page.nextCursor,'base64url').toString('utf8')), 'dispatch_scan_binding', 503);
    if (!await completeScan(claim,next)) domainReject('dispatch_scan_changed',503);
    return page;
  }
  async function reserve(job: FirestoreTaskDelivery, taskName: string) {
    const token = randomUUID(), jobHash = firestoreDomainHash(job), ref = data.ref('task_dispatches', 'task-dispatch-observation', taskName);
    return worker.dispatchTransaction(job, 'enqueue', async binding => {
      const at = now(), instant = new Date(at).toISOString(), snapshot = await binding.transaction.get(ref);
      let original: z.infer<typeof firestoreTaskDispatchObservationSchema> | null = null;
      if (snapshot.exists) {
        for (const [key, value] of Object.entries(data.tags(binding.scope))) if (snapshot.get(key) !== value) domainReject('dispatch_observation', 500);
        original = data.open('task-dispatch-observation', taskName, binding.scope, firestoreTaskDispatchObservationSchema, snapshot);
        if (original.taskName !== taskName || original.jobHash !== jobHash || original.scheduledAt !== job.scheduledAt
          || snapshot.get('recordVersion') !== job.taskVersion || (original.state === 'dispatching') !== (original.lease !== null)) domainReject('dispatch_observation', 500);
        if (original.state === 'needs_attention') return { mode: 'needs_attention' as const };
        if (original.lease && Date.parse(original.lease.until) > at) return { mode: 'busy' as const };
      }
      const unresolved = Math.min(3, (original?.unresolved ?? 0) + (original?.state === 'dispatching' ? 1 : 0));
      const value = { taskName, jobHash, scheduledAt: job.scheduledAt, state: unresolved >= 3 ? 'needs_attention' as const : 'dispatching' as const,
        calls: (original?.calls ?? 0) + (unresolved >= 3 ? 0 : 1), unresolved, confirmedAt: original?.confirmedAt ?? null,
        createdAt: original?.createdAt ?? instant, updatedAt: instant, lease: unresolved >= 3 ? null : { token, until: new Date(at + 30_000).toISOString() } };
      binding.transaction.set(ref, { ...data.tags(binding.scope), ...data.seal('task-dispatch-observation', taskName, binding.scope, firestoreTaskDispatchObservationSchema, value, job.taskVersion) });
      return unresolved >= 3 ? { mode: 'needs_attention' as const } : { mode: original ? 'probe' as const : 'create' as const, token };
    });
  }
  async function settle(job: FirestoreTaskDelivery, taskName: string, token: string, outcome: FirebaseTaskDeliveryResult) {
    const ref = data.ref('task_dispatches', 'task-dispatch-observation', taskName);
    return worker.dispatchTransaction(job, 'settle', async binding => {
      const snapshot = await binding.transaction.get(ref);
      if (!snapshot.exists) domainReject('dispatch_observation', 500);
      for (const [key, value] of Object.entries(data.tags(binding.scope))) if (snapshot.get(key) !== value) domainReject('dispatch_observation', 500);
      const original = data.open('task-dispatch-observation', taskName, binding.scope, firestoreTaskDispatchObservationSchema, snapshot);
      if (original.taskName !== taskName || original.jobHash !== firestoreDomainHash(job) || original.scheduledAt !== job.scheduledAt
        || snapshot.get('recordVersion') !== job.taskVersion) domainReject('dispatch_observation', 500);
      if (original.state !== 'dispatching' || original.lease?.token !== token) return original.state;
      const instant = new Date(now()).toISOString(), unresolved = Math.min(3, original.unresolved + (outcome.state === 'unknown' ? 1 : 0));
      const state = outcome.state === 'conflict' || unresolved >= 3 ? 'needs_attention' as const : outcome.state;
      const value = { ...original, state, unresolved, confirmedAt: original.confirmedAt ?? (outcome.state === 'confirmed' ? instant : null), updatedAt: instant, lease: null };
      binding.transaction.set(ref, { ...data.tags(binding.scope), ...data.seal('task-dispatch-observation', taskName, binding.scope, firestoreTaskDispatchObservationSchema, value, job.taskVersion) });
      return state;
    });
  }
  async function dispatch(rawCursor?: string | null): Promise<FirestoreTaskDispatchPage> {
      if (!options.enabled) return empty('disabled');
      let cursor: z.infer<typeof cursorSchema> = { version: 1, lane: 'pending', at: new Date(now()).toISOString(), time: null, id: null };
      if (rawCursor !== undefined && rawCursor !== null) {
        if (typeof rawCursor !== 'string' || rawCursor.length > 2048 || !/^[A-Za-z0-9_-]+$/u.test(rawCursor)) domainReject('invalid_cursor', 400);
        try {
          const bytes = Buffer.from(rawCursor, 'base64url'); if (bytes.toString('base64url') !== rawCursor) domainReject('invalid_cursor', 400);
          cursor = domainParse(cursorSchema, JSON.parse(bytes.toString('utf8')), 'invalid_cursor', 400);
        } catch { domainReject('invalid_cursor', 400); }
        if (Date.parse(cursor.at) > now()) domainReject('invalid_cursor', 400);
      }
      const page = empty('dispatched');
      const candidates = await options.database.runTransaction(async transaction => {
        const rows: { snapshot: DocumentSnapshot; lane: 'pending' | 'leased'; time: string }[] = [];
        for (const lane of cursor.lane === 'pending' ? ['pending', 'leased'] as const : ['leased'] as const) {
          const field = lane === 'pending' ? 'dueAt' : 'leaseUntil';
          let query = data.collection('task_outbox').where('state', '==', lane).where(field, '<=', cursor.at).orderBy(field).orderBy('dispatchId').limit(26 - rows.length);
          if (lane === cursor.lane && cursor.time !== null) query = query.startAfter(cursor.time, cursor.id);
          const selected = await transaction.get(query);
          for (const snapshot of selected.docs) rows.push({ snapshot, lane, time: snapshot.get(field) });
          if (rows.length >= 26) break;
        }
        return rows;
      });
      page.hasMore = candidates.length > 25;
      if (page.hasMore) {
        const last = candidates[24];
        const next = { ...cursor, lane: last.lane, time: last.time, id: last.snapshot.get('dispatchId') };
        domainParse(cursorSchema, next, 'dispatch_routing', 500);
        page.nextCursor = Buffer.from(JSON.stringify(next)).toString('base64url');
      }
      await Promise.all(candidates.slice(0, 25).map(async candidate => {
        page.scanned++;
        try {
          const job = routing(candidate.snapshot), taskName = options.delivery.taskName(job), observed = await reserve(job, taskName);
          if (observed.state !== 'ready') { page.skipped++; return; }
          if (observed.value.mode === 'needs_attention') { page.needsAttention++; return; }
          if (observed.value.mode === 'busy') { page.busy++; return; }
          let outcome: FirebaseTaskDeliveryResult;
          try { outcome = await options.delivery[observed.value.mode === 'create' ? 'enqueue' : 'probe'](job); }
          catch { outcome = { state: 'unknown', taskName }; }
          if (outcome.taskName !== taskName || !['confirmed', 'unknown', 'conflict'].includes(outcome.state)) outcome = { state: 'conflict', taskName };
          const completed = await settle(job, taskName, observed.value.token, outcome);
          const state = completed.state === 'ready' ? completed.value : 'unknown';
          if (state === 'confirmed') page.confirmed++; else if (state === 'needs_attention') page.needsAttention++; else page.unknown++;
        } catch (error) {
          const status = error !== null && typeof error === 'object' && 'status' in error ? error.status : null;
          if (status === 403 || status === 409 || status === 404) page.skipped++;
          else if (status === 500 || status === 400 || status === 413) page.rejected++;
          else page.unknown++;
        }
      }));
      return page;
  }
  return { dispatch, dispatchScheduled };
}
