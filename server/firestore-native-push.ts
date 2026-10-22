import { randomUUID, createHash } from 'node:crypto';
import type { Query, DocumentSnapshot } from '@google-cloud/firestore';
import { z } from 'zod';
import { notificationMessageContentSchema } from '../src/shared/notification-messages.ts';
import { acceptedMessage, messageSortMetadata } from './notification-message-content.ts';
import { nativePushBindingSchema, nativePushRegistrationSchema, nativePushReferenceSchema, type NativePushBinding } from '../src/shared/native-push.ts';
import { pushDeliverySchema, pushVersionInput, pushTestInput, type PushDelivery } from '../src/shared/web-push.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { prepareFirestoreBackgroundWork, type FirestoreBackgroundWork } from './firestore-background-work.ts';
import { workRecoveryScopeSchema } from './firestore-work-continuation-recovery.ts';
import { openRecoveryEnvelope } from './firestore-recovery-envelope.ts';
import { DeviceSessionError, type FirestoreDeviceSessions, type DeviceSessionKey } from './firestore-device-sessions.ts';
import type { FirestoreOnlineMutation } from './firestore-online.ts';
import type { NativePushGateway } from './native-push-gateway.ts';
import type { PushSendResult } from './web-push-types.ts';

const uuid = z.uuid(), NIL = '00000000-0000-0000-0000-000000000000';
export const firestoreNativeBindingSchema = z.object({ binding: nativePushBindingSchema,
  token: z.string().min(20).max(4096).nullable(), tokenHash: z.string().length(64).nullable(), sessionHash: z.string().length(64),
}).strict();
export const firestoreNativeDeliverySchema = z.object({ delivery: pushDeliverySchema, bindingVersion: z.number().int().positive(),
  generation: uuid, authorizationVersion: z.string(), attempt: uuid.nullable(), message: notificationMessageContentSchema.optional() }).strict();
export const firestoreNativePointerSchema = z.object({ scope: workRecoveryScopeSchema, bindingId: uuid, tokenHash: z.string().length(64) }).strict();
type SavedBinding = z.infer<typeof firestoreNativeBindingSchema>;
type SavedDelivery = z.infer<typeof firestoreNativeDeliverySchema>;
const routePattern = /^\/api\/native-push\/subscriptions(?:\/([0-9a-f-]{36})\/(revoke|test))?$/iu;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Device-session-bound FCM registration. Product grants refer to a binding, never a token. */
export function createFirestoreNativePush(options: FirestoreDomainOptions & {
  gateway: NativePushGateway;
  sessions: Pick<FirestoreDeviceSessions, 'assertActive' | 'assertActiveIn'>;
  currentAuth(userId: string): Promise<{ disabled: boolean; emailVerified: boolean }>;
}) {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options);
  function query(b: Pick<Binding, 'scope'>, suffix: string): Query {
    let q: Query = data.collection(suffix); for (const [key, value] of Object.entries(data.tags(b.scope))) q = q.where(key, '==', value); return q;
  }
  function decode<T>(b: Pick<Binding, 'scope'>, row: DocumentSnapshot, kind: string, id: string, schema: z.ZodType<T>): T {
    if (!row.exists || Object.entries(data.tags(b.scope)).some(([key, value]) => row.get(key) !== value)) domainReject('not_found', 404);
    return data.open(kind, id, b.scope, schema, row);
  }
  async function binding(b: Pick<Binding, 'scope' | 'transaction'>, id: string) {
    const row = await b.transaction.get(data.ref('native_push_bindings', 'native-push-binding', domainParse(uuid, id)));
    const saved = decode(b, row, 'native-push-binding', id, firestoreNativeBindingSchema);
    if (saved.binding.id !== id || saved.binding.version !== row.get('recordVersion') || saved.binding.status !== row.get('status')) domainReject('push_binding', 500);
    return saved;
  }
  const bindingEnvelope = (b: Pick<Binding, 'scope'>, saved: SavedBinding) => ({ ...data.tags(b.scope), bindingId: saved.binding.id,
    createdAt: saved.binding.createdAt, status: saved.binding.status, sessionTag: saved.sessionHash,
    ...data.seal('native-push-binding', saved.binding.id, b.scope, firestoreNativeBindingSchema, saved, saved.binding.version) });
  const deliveryEnvelope = (b: Pick<Binding, 'scope'>, saved: SavedDelivery) => ({ ...data.tags(b.scope), deliveryId: saved.delivery.id,
    bindingId: saved.delivery.bindingId, createdAt: saved.delivery.createdAt, status: saved.delivery.status,
    ...messageSortMetadata(saved.message ? [saved.message] : []),
    ...data.seal('native-push-delivery', saved.delivery.id, b.scope, firestoreNativeDeliverySchema, saved) });
  async function pointer(b: Pick<Binding, 'transaction'>, hash: string) {
    const ref = data.ref('native_push_tokens', 'native-push-token', hash), row = await b.transaction.get(ref);
    if (!row.exists) return null;
    // Internal uniqueness lookup only. Scope is authenticated, then path, tags and payload are checked.
    const raw = row.data()!, opened = openRecoveryEnvelope({ ...options, locator: raw.recovery,
      envelope: { family: 'domain', version: raw.version, recordVersion: raw.recordVersion, ciphertext: raw.ciphertext } });
    if (opened.context.kind !== 'native-push-token' || opened.context.id !== hash) domainReject('push_binding', 500);
    const value = decode({ scope: opened.context.scope }, row, 'native-push-token', hash, firestoreNativePointerSchema);
    if (value.tokenHash !== hash || firestoreDomainHash(value.scope) !== firestoreDomainHash(opened.context.scope)) domainReject('push_binding', 500);
    return value;
  }
  async function sessionActiveIn(b: Pick<Binding, 'transaction' | 'scope'>, saved: SavedBinding) {
    try { await options.sessions.assertActiveIn(b.transaction, { userId: b.scope.ownerUserId, sessionHash: saved.sessionHash }); return true; }
    catch (error) { if (error instanceof DeviceSessionError && error.status === 401) return false; throw error; }
  }
  async function prepareRegister(b: Binding, raw: unknown, session: DeviceSessionKey) {
    const input = domainParse(nativePushRegistrationSchema, raw);
    if (!options.gateway.available) domainReject('push_unavailable');
    const hash = hashToken(input.token), tokenRef = data.ref('native_push_tokens', 'native-push-token', hash);
    const occupied = await pointer(b, hash);
    let displaced: { scope: Binding['scope']; saved: SavedBinding } | null = null;
    if (occupied && (occupied.scope.ownerUserId !== b.scope.ownerUserId || occupied.bindingId !== input.bindingId)) {
      const other = { transaction: b.transaction, scope: occupied.scope }, old = await binding(other, occupied.bindingId);
      if (old.tokenHash !== hash) domainReject('push_binding', 500);
      if (old.binding.status === 'active' && await sessionActiveIn(other, old)) {
        if (occupied.scope.ownerUserId === b.scope.ownerUserId && old.sessionHash === session.sessionHash
          && old.token === input.token && !input.bindingId) return { binding: old.binding, commit() {} };
        domainReject('subscription_unavailable');
      }
      displaced = { scope: occupied.scope, saved: old };
    }
    const at = new Date().toISOString(); let saved: SavedBinding, oldPointer: string | null = null;
    if (input.bindingId) {
      saved = await binding(b, input.bindingId);
      if (saved.sessionHash !== session.sessionHash || saved.binding.status !== 'active') domainReject('subscription_unavailable');
      if (saved.binding.version !== input.expectedVersion || saved.binding.tokenRevision !== input.expectedTokenRevision) domainReject('version_conflict');
      if (saved.tokenHash) {
        const previous = await pointer(b, saved.tokenHash);
        if (!previous || previous.bindingId !== saved.binding.id || previous.scope.ownerUserId !== b.scope.ownerUserId) domainReject('push_binding', 500);
        if (saved.tokenHash !== hash) oldPointer = saved.tokenHash;
      }
      // Rotation preserves the logical device consent, but conflicts with a stale rotation request.
      saved = { ...saved, token: input.token, tokenHash: hash, binding: { ...saved.binding, label: input.label,
        tokenRevision: saved.binding.tokenRevision + 1, updatedAt: at } };
    } else {
      const active = await b.transaction.get(query(b, 'native_push_bindings').where('status', '==', 'active').limit(5));
      const created = await b.transaction.get(query(b, 'native_push_bindings').where('createdAt', '>', new Date(Date.now() - 86400_000).toISOString()).limit(20));
      if (active.size >= 5 || created.size >= 20) domainReject('subscription_limit');
      if (active.docs.some(row => row.get('sessionTag') === session.sessionHash)) domainReject('subscription_changed');
      saved = { token: input.token, tokenHash: hash, sessionHash: session.sessionHash,
        binding: { id: randomUUID(), version: 1, tokenRevision: 1, status: 'active', label: input.label, createdAt: at, updatedAt: at } };
    }
    const changed = displaced ? await authority.prepareReceiptChange(b.transaction, displaced.scope, randomUUID(), 'preferences') : null;
    return { binding: saved.binding, commit() {
      changed?.commit();
      if (displaced) {
        const old = displaced.saved; old.token = null; old.tokenHash = null;
        old.binding = { ...old.binding, status: 'revoked', version: old.binding.version + 1, updatedAt: at };
        b.transaction.set(data.ref('native_push_bindings', 'native-push-binding', old.binding.id), bindingEnvelope(displaced, old));
      }
      if (oldPointer) b.transaction.delete(data.ref('native_push_tokens', 'native-push-token', oldPointer));
      b.transaction.set(data.ref('native_push_bindings', 'native-push-binding', saved.binding.id), bindingEnvelope(b, saved));
      b.transaction.set(tokenRef, { ...data.tags(b.scope), ...data.seal('native-push-token', hash, b.scope, firestoreNativePointerSchema,
        { scope: b.scope, bindingId: saved.binding.id, tokenHash: hash }) });
    } };
  }
  async function prepareInvalidation(b: Pick<Binding, 'scope' | 'transaction'>, id: string, version: number, status: 'expired' | 'revoked' = 'expired', tokenHash?: string) {
    const saved = await binding(b, id);
    if (saved.binding.version !== version || saved.binding.status !== 'active' || tokenHash !== undefined && saved.tokenHash !== tokenHash) return { binding: saved.binding, commit() {} };
    const hash = saved.tokenHash, occupied = hash ? await pointer(b, hash) : null;
    saved.token = null; saved.tokenHash = null;
    saved.binding = { ...saved.binding, status, version: version + 1, updatedAt: new Date().toISOString() };
    return { binding: saved.binding, commit() {
      b.transaction.set(data.ref('native_push_bindings', 'native-push-binding', id), bindingEnvelope(b, saved));
      if (hash && occupied?.bindingId === id && occupied.scope.ownerUserId === b.scope.ownerUserId)
        b.transaction.delete(data.ref('native_push_tokens', 'native-push-token', hash));
    } };
  }
  async function recent(b: Binding) {
    const rows = await b.transaction.get(query(b, 'native_push_deliveries').where('createdAt', '>', new Date(Date.now() - 86400_000).toISOString())
      .orderBy('createdAt', 'desc').orderBy('deliveryId', 'desc').limit(4));
    return rows.docs.map(row => decode(b, row, 'native-push-delivery', row.get('deliveryId'), firestoreNativeDeliverySchema).delivery);
  }
  async function prepareTest(b: Binding, id: string, version: number) {
    if (!options.gateway.available) domainReject('push_unavailable');
    if (!(await authority.readControl(b.transaction)).enabled) domainReject('worker_paused');
    const saved = await binding(b, id);
    if (saved.binding.version !== version) domainReject('version_conflict');
    if (saved.binding.status !== 'active' || !saved.token || !await sessionActiveIn(b, saved)) domainReject('subscription_unavailable');
    const used = await recent(b);
    if (used.length >= 3 || used.some(item => Date.parse(item.createdAt) > Date.now() - 60_000)) domainReject('test_limit');
    const deliveryId = randomUUID(), createdAt = new Date().toISOString();
    const stored: SavedDelivery = { delivery: { id: deliveryId, bindingId: id, status: 'queued', reason: null, providerStatus: null,
      createdAt, attemptedAt: null, finishedAt: null }, bindingVersion: version, generation: b.generation,
      authorizationVersion: b.authorizationVersion, attempt: null };
    const job = await prepareFirestoreBackgroundWork(data, b.transaction, { kind: 'native-push', scope: b.scope, resourceId: deliveryId,
      basis: deliveryId, generation: b.generation, authorizationVersion: b.authorizationVersion }, createdAt);
    return { delivery: stored.delivery, commit() { b.transaction.create(data.ref('native_push_deliveries', 'native-push-delivery', deliveryId), deliveryEnvelope(b, stored)); job.commit(); } };
  }
  const mutation: FirestoreOnlineMutation = {
    supports: path => routePattern.test(path),
    async prepare(b, submission, context) {
      if (b.scope.childId !== NIL) domainReject('invalid_scope', 400);
      const route = routePattern.exec(submission.path); if (!route) domainReject('not_found', 404);
      const id = route[1]?.toLowerCase(), action = route[2]?.toLowerCase();
      let prepared;
      if (!id) {
        const session = context?.nativeSession;
        if (!session || session.userId !== b.scope.ownerUserId) domainReject('native_session_required', 403);
        await options.sessions.assertActiveIn(b.transaction, session);
        prepared = await prepareRegister(b, submission.payload, session);
      } else if (action === 'revoke') {
        const input = domainParse(pushVersionInput, submission.payload), saved = await binding(b, id);
        if (saved.binding.version !== input.expectedVersion) domainReject('version_conflict');
        prepared = await prepareInvalidation(b, id, input.expectedVersion, 'revoked');
      } else prepared = await prepareTest(b, id, domainParse(pushTestInput, submission.payload).expectedVersion);
      const change = await b.prepareChange(submission.operation.opId, 'preferences', false);
      return { childId: null, changeSeq: change.changeSeq, statusCode: !id || action === 'test' ? 201 : 200,
        result: 'binding' in prepared ? { binding: prepared.binding } : { delivery: prepared.delivery }, commit() { change.commit(); prepared.commit(); } };
    },
  };
  async function status(userId: string, session: DeviceSessionKey | null = null) {
    return authority.runTransaction(userId, null, async b => {
      const rows = await b.transaction.get(query(b, 'native_push_bindings').orderBy('createdAt', 'desc').orderBy('bindingId', 'desc').limit(20));
      const values = rows.docs.map(row => decode(b, row, 'native-push-binding', row.get('bindingId'), firestoreNativeBindingSchema));
      const messages = await b.transaction.get(query(b, 'native_push_deliveries').orderBy('createdAt', 'desc').orderBy('deliveryId', 'desc').limit(20));
      const used = await recent(b), next = Math.max(0, ...used.map(item => Date.parse(item.createdAt) + 60_000),
        used.length >= 3 ? Math.min(...used.map(item => Date.parse(item.createdAt))) + 86400_000 : 0);
      return { userId, available: options.gateway.available, workerEnabled: (await authority.readControl(b.transaction)).enabled,
        currentBindingId: session?.userId === userId ? values.find(v => v.sessionHash === session.sessionHash && v.binding.status === 'active')?.binding.id ?? null : null,
        bindings: values.map(v => v.binding), deliveries: messages.docs.map(row => decode(b, row, 'native-push-delivery', row.get('deliveryId'), firestoreNativeDeliverySchema).delivery),
        testsRemaining: Math.max(0, 3 - used.length), nextTestAt: next > Date.now() ? new Date(next).toISOString() : null };
    });
  }
  async function process(job: FirestoreBackgroundWork, signal: AbortSignal) {
    const { scope } = job, id = job.resourceId;
    if (job.kind !== 'native-push' || scope.childId !== NIL) domainReject('invalid_scope', 400);
    const original = await authority.runTransaction(scope.ownerUserId, null, async b => {
      if (job.generation !== b.generation || job.authorizationVersion !== b.authorizationVersion || firestoreDomainHash(scope) !== firestoreDomainHash(b.scope)) return null;
      const ref = data.ref('native_push_deliveries', 'native-push-delivery', id), row = await b.transaction.get(ref);
      const saved = decode(b, row, 'native-push-delivery', id, firestoreNativeDeliverySchema), value = saved.delivery;
      if (value.id !== id || saved.generation !== job.generation || saved.authorizationVersion !== b.authorizationVersion) domainReject('push_binding', 500);
      if (!['queued', 'sending'].includes(value.status)) return { terminal: value.status === 'unknown' ? 'unknown' as const : 'completed' as const };
      if (value.status === 'sending') {
        saved.delivery = { ...value, status: 'unknown', reason: 'worker_interrupted', finishedAt: new Date().toISOString() };
        b.transaction.set(ref, deliveryEnvelope(b, saved)); return { terminal: 'unknown' as const };
      }
      const subscribed = await binding(b, value.bindingId), control = await authority.readControl(b.transaction);
      const reason: PushDelivery['reason'] = !control.enabled ? 'worker_paused' : !options.gateway.available ? 'configuration_unavailable'
        : subscribed.binding.status !== 'active' || subscribed.binding.version !== saved.bindingVersion || !subscribed.token || !await sessionActiveIn(b, subscribed) ? 'revoked' : null;
      if (reason) { saved.delivery = { ...value, status: 'stopped', reason, finishedAt: new Date().toISOString() }; b.transaction.set(ref, deliveryEnvelope(b, saved)); return null; }
      saved.attempt = randomUUID(); saved.delivery = { ...value, status: 'sending', attemptedAt: new Date().toISOString() };
      b.transaction.set(ref, deliveryEnvelope(b, saved)); return { saved, subscribed };
    });
    if (!original) return { state: 'stopped' as const };
    if (original.terminal) return { state: original.terminal };
    const authorized = async () => {
      if (signal.aborted) return false;
      const identity = await options.currentAuth(scope.ownerUserId); if (identity.disabled || !identity.emailVerified) return false;
      try { return await authority.runTransaction(scope.ownerUserId, null, async b => {
        const current = decode(b, await b.transaction.get(data.ref('native_push_deliveries', 'native-push-delivery', id)), 'native-push-delivery', id, firestoreNativeDeliverySchema);
        const subscribed = await binding(b, current.delivery.bindingId);
        return b.generation === job.generation && b.authorizationVersion === job.authorizationVersion && (await authority.readControl(b.transaction)).enabled
          && current.delivery.status === 'sending' && current.attempt === original.saved.attempt && subscribed.binding.status === 'active'
          && subscribed.binding.version === current.bindingVersion && subscribed.tokenHash === original.subscribed.tokenHash && await sessionActiveIn(b, subscribed);
      }); } catch (error) { if (error && typeof error === 'object' && 'status' in error && [401, 403, 404, 409].includes(Number(error.status))) return false; throw error; }
    };
    let result: PushSendResult;
    try { result = await options.gateway.send(original.subscribed.token!, { v: 1, kind: 'test', bindingId: original.saved.delivery.bindingId,
      bindingVersion: original.saved.bindingVersion, deliveryId: id }, signal, authorized); }
    catch { result = { status: 'unknown', reason: 'transport_unknown', providerStatus: null }; }
    await options.database.runTransaction(async tx => {
      const b = { scope, transaction: tx }, ref = data.ref('native_push_deliveries', 'native-push-delivery', id), row = await tx.get(ref); if (!row.exists) return;
      const saved = decode(b, row, 'native-push-delivery', id, firestoreNativeDeliverySchema);
      if (saved.attempt !== original.saved.attempt || saved.delivery.status !== 'sending') return;
      const subscriptionRow = await tx.get(data.ref('native_push_bindings', 'native-push-binding', saved.delivery.bindingId));
      const subscribed = subscriptionRow.exists ? decode(b, subscriptionRow, 'native-push-binding', saved.delivery.bindingId, firestoreNativeBindingSchema) : null;
      const expired = result.reason === 'subscription_expired' && subscribed?.tokenHash === original.subscribed.tokenHash
        ? await prepareInvalidation(b, saved.delivery.bindingId, saved.bindingVersion) : null;
      const change = await authority.prepareReceiptChange(tx, scope, randomUUID(), 'preferences');
      change?.commit(); expired?.commit();
      const { message: capturedMessage, ...deliveryResult } = result;
      const message = options.messageHistoryEnabled === true ? acceptedMessage({ ...deliveryResult, message: capturedMessage }, 'native_push') : undefined;
      if (message) saved.message = message;
      saved.delivery = { ...saved.delivery, ...deliveryResult, finishedAt: new Date().toISOString() }; tx.set(ref, deliveryEnvelope(b, saved));
    });
    return { state: result.status === 'unknown' ? 'unknown' as const : 'completed' as const };
  }
  async function authorizeOpen(userId: string, session: DeviceSessionKey | null, raw: unknown) {
    const reference = domainParse(nativePushReferenceSchema, raw);
    if (!session || session.userId !== userId) domainReject('native_session_required', 403);
    return authority.runTransaction(userId, null, async b => {
      const subscribed = await binding(b, reference.bindingId);
      if (subscribed.binding.version !== reference.bindingVersion || subscribed.binding.status !== 'active'
        || subscribed.sessionHash !== session.sessionHash || !await sessionActiveIn(b, subscribed)) domainReject('not_found', 404);
      if (reference.kind === 'test') {
        const row = await b.transaction.get(data.ref('native_push_deliveries', 'native-push-delivery', reference.deliveryId));
        const saved = decode(b, row, 'native-push-delivery', reference.deliveryId, firestoreNativeDeliverySchema);
        if (saved.delivery.bindingId !== reference.bindingId || saved.bindingVersion !== reference.bindingVersion
          || !['accepted', 'unknown', 'sending'].includes(saved.delivery.status)) domainReject('not_found', 404);
      }
      return reference;
    });
  }
  return { status, mutation, process, authorizeOpen, readBinding: binding, prepareInvalidation, sessionActiveIn };
}
export type FirestoreNativePush = ReturnType<typeof createFirestoreNativePush>;
