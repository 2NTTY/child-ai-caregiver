import { randomUUID, createHash } from 'node:crypto';
import type { Query, DocumentSnapshot } from '@google-cloud/firestore';
import { z } from 'zod';
import { pushRegistrationInput, pushBindingSchema, pushDeliverySchema, pushVersionInput, pushTestInput,
  type PushBinding, type PushDelivery, type WebPushStatus } from '../src/shared/web-push.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { prepareFirestoreBackgroundWork, type FirestoreBackgroundWork } from './firestore-background-work.ts';
import type { FirestoreOnlineMutation } from './firestore-online.ts';
import type { WebPushGateway, PushSendResult } from './web-push-types.ts';
import { checkedSubscription, pushProvider } from './web-push-gateway.ts';

const uuid = z.uuid(), NIL = '00000000-0000-0000-0000-000000000000';
export const firestorePushBindingSchema = z.object({ binding: pushBindingSchema, input: pushRegistrationInput.nullable() }).strict();
export const firestorePushDeliverySchema = z.object({ delivery: pushDeliverySchema, bindingVersion: z.number().int().positive(),
  generation: uuid, authorizationVersion: z.string(), attempt: uuid.nullable() }).strict();
const endpointSchema = z.object({ ownerUserId: z.string().min(1).max(256), bindingId: uuid, endpointHash: z.string().length(64) }).strict();
type SavedBinding = z.infer<typeof firestorePushBindingSchema>;
type SavedDelivery = z.infer<typeof firestorePushDeliverySchema>;
const pathPattern = /^\/api\/web-push\/subscriptions(?:\/([0-9a-f-]{36})\/(revoke|test))?$/iu;

/** Existing VAPID/provider transport with Firestore receipts. No browser or model sends directly. */
export function createFirestoreWebPush(options: FirestoreDomainOptions & {
  gateway: WebPushGateway; enabled: boolean;
  currentAuth(userId: string): Promise<{ disabled: boolean; emailVerified: boolean }>;
}) {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options);
  const available = () => options.enabled && !!options.gateway.publicKey;
  function query(b: Binding, suffix: string): Query {
    let q: Query = data.collection(suffix); for (const [key, value] of Object.entries(data.tags(b.scope))) q = q.where(key, '==', value); return q;
  }
  function decode<T>(b: Pick<Binding, 'scope'>, row: DocumentSnapshot, kind: string, id: string, schema: z.ZodType<T>) {
    if (!row.exists || Object.entries(data.tags(b.scope)).some(([key, value]) => row.get(key) !== value)) domainReject('not_found', 404);
    return data.open(kind, id, b.scope, schema, row);
  }
  async function binding(b: Binding, id: string) {
    domainParse(uuid, id); const row = await b.transaction.get(data.ref('push_bindings', 'push-binding', id));
    const value = decode(b, row, 'push-binding', id, firestorePushBindingSchema);
    if (value.binding.id !== id || value.binding.version !== row.get('recordVersion') || value.binding.status !== row.get('status')) domainReject('push_binding', 500);
    return value;
  }
  const bindingEnvelope = (b: Pick<Binding, 'scope'>, saved: SavedBinding) => ({ ...data.tags(b.scope), bindingId: saved.binding.id,
    createdAt: saved.binding.createdAt, status: saved.binding.status,
    ...data.seal('push-binding', saved.binding.id, b.scope, firestorePushBindingSchema, saved, saved.binding.version) });
  const deliveryEnvelope = (b: Pick<Binding, 'scope'>, saved: SavedDelivery) => ({ ...data.tags(b.scope), deliveryId: saved.delivery.id,
    createdAt: saved.delivery.createdAt, bindingId: saved.delivery.bindingId, status: saved.delivery.status,
    ...data.seal('push-delivery', saved.delivery.id, b.scope, firestorePushDeliverySchema, saved) });
  async function recent(b: Binding) {
    const rows = await b.transaction.get(query(b, 'push_deliveries').where('createdAt', '>', new Date(Date.now() - 86400_000).toISOString())
      .orderBy('createdAt', 'desc').orderBy('deliveryId', 'desc').limit(4));
    return rows.docs.map(row => decode(b, row, 'push-delivery', row.get('deliveryId'), firestorePushDeliverySchema).delivery);
  }
  async function prepareRegister(b: Binding, raw: unknown) {
    const input = domainParse(pushRegistrationInput, raw);
    try { checkedSubscription(input.subscription); } catch { domainReject('invalid_subscription', 400); }
    if (!available()) domainReject('push_unavailable');
    const hash = createHash('sha256').update(input.subscription.endpoint).digest('hex'), ref = data.ref('push_endpoints', 'push-endpoint', hash);
    const occupied = await b.transaction.get(ref);
    if (occupied.exists) {
      if (occupied.get('userTag') !== data.tags(b.scope).userTag) domainReject('subscription_unavailable');
      const pointer = decode(b, occupied, 'push-endpoint', hash, endpointSchema);
      if (pointer.ownerUserId !== b.scope.ownerUserId || pointer.endpointHash !== hash) domainReject('push_binding', 500);
      const saved = await binding(b, pointer.bindingId);
      if (saved.binding.status !== 'active' || saved.binding.vapidPublicKey !== options.gateway.publicKey
        || !saved.input || firestoreDomainHash(saved.input.subscription) !== firestoreDomainHash(input.subscription)) domainReject('subscription_changed');
      return { binding: saved.binding, commit() {} };
    }
    const active = await b.transaction.get(query(b, 'push_bindings').where('status', '==', 'active').limit(5));
    const created = await b.transaction.get(query(b, 'push_bindings').where('createdAt', '>', new Date(Date.now() - 86400_000).toISOString()).limit(20));
    if (active.size >= 5 || created.size >= 20) domainReject('subscription_limit');
    const at = new Date().toISOString(), id = randomUUID(), saved: SavedBinding = { input, binding: { id, version: 1, status: 'active',
      provider: pushProvider(input.subscription.endpoint), label: input.label, endpointHash: hash, vapidPublicKey: options.gateway.publicKey!,
      expiresAt: input.subscription.expirationTime === null ? null : new Date(input.subscription.expirationTime).toISOString(), createdAt: at, updatedAt: at } };
    const pointer = { ...data.tags(b.scope), ...data.seal('push-endpoint', hash, b.scope, endpointSchema,
      { ownerUserId: b.scope.ownerUserId, bindingId: id, endpointHash: hash }) };
    return { binding: saved.binding, commit() { b.transaction.create(data.ref('push_bindings', 'push-binding', id), bindingEnvelope(b, saved)); b.transaction.create(ref, pointer); } };
  }
  async function prepareRevoke(b: Binding, id: string, expectedVersion: number) {
    const saved = await binding(b, id);
    if (saved.binding.version !== expectedVersion) domainReject('version_conflict');
    if (saved.binding.status !== 'active') return { binding: saved.binding, commit() {} };
    const hash = saved.binding.endpointHash!, pointer = data.ref('push_endpoints', 'push-endpoint', hash);
    const row = await b.transaction.get(pointer);
    if (!row.exists || decode(b, row, 'push-endpoint', hash, endpointSchema).bindingId !== id) domainReject('push_binding', 500);
    // The revoked binding is the immediate barrier; older queued pages stop when claimed.
    const queued = await b.transaction.get(query(b, 'push_deliveries').where('bindingId', '==', id).where('status', '==', 'queued').limit(20));
    const stopped = queued.docs.map(row => ({ ref: row.ref, saved: decode(b, row, 'push-delivery', row.get('deliveryId'), firestorePushDeliverySchema) }));
    const next: SavedBinding = { input: null, binding: { ...saved.binding, status: 'revoked', version: saved.binding.version + 1,
      label: '已撤銷的訂閱', endpointHash: null, updatedAt: new Date().toISOString() } };
    return { binding: next.binding, commit() { b.transaction.set(data.ref('push_bindings', 'push-binding', id), bindingEnvelope(b, next)); b.transaction.delete(pointer);
      for (const entry of stopped) { entry.saved.delivery = { ...entry.saved.delivery, status: 'stopped', reason: 'revoked', finishedAt: next.binding.updatedAt }; b.transaction.set(entry.ref, deliveryEnvelope(b, entry.saved)); }
    } };
  }
  async function prepareTest(b: Binding, id: string, expectedVersion: number) {
    const control = await authority.readControl(b.transaction);
    if (!available()) domainReject('push_unavailable'); if (!control.enabled) domainReject('worker_paused');
    const saved = await binding(b, id), value = saved.binding;
    if (value.version !== expectedVersion) domainReject('version_conflict');
    if (value.status !== 'active' || !saved.input || value.vapidPublicKey !== options.gateway.publicKey
      || value.expiresAt && Date.parse(value.expiresAt) <= Date.now()) domainReject('subscription_unavailable');
    const used = await recent(b);
    if (used.length >= 3 || used.some(item => Date.parse(item.createdAt) > Date.now() - 60_000)) domainReject('test_limit');
    const deliveryId = randomUUID(), createdAt = new Date().toISOString();
    const stored: SavedDelivery = { delivery: { id: deliveryId, bindingId: id, status: 'queued', reason: null,
      providerStatus: null, createdAt, attemptedAt: null, finishedAt: null }, bindingVersion: expectedVersion,
      generation: b.generation, authorizationVersion: b.authorizationVersion, attempt: null };
    const job = await prepareFirestoreBackgroundWork(data, b.transaction, { kind: 'push', scope: b.scope, resourceId: deliveryId, basis: deliveryId,
      generation: b.generation, authorizationVersion: b.authorizationVersion }, createdAt);
    return { delivery: stored.delivery, commit() { b.transaction.create(data.ref('push_deliveries', 'push-delivery', deliveryId), deliveryEnvelope(b, stored)); job.commit(); } };
  }
  const mutation: FirestoreOnlineMutation = {
    supports: path => pathPattern.test(path),
    async prepare(b, submission) {
      if (b.scope.childId !== NIL) domainReject('invalid_scope', 400);
      const route = pathPattern.exec(submission.path); if (!route) domainReject('not_found', 404);
      const id = route[1]?.toLowerCase(), action = route[2]?.toLowerCase();
      const prepared = !id ? await prepareRegister(b, submission.payload) : action === 'revoke'
        ? await prepareRevoke(b, id, domainParse(pushVersionInput, submission.payload).expectedVersion)
        : await prepareTest(b, id, domainParse(pushTestInput, submission.payload).expectedVersion);
      const change = await b.prepareChange(submission.operation.opId, 'preferences', false);
      return { childId: null, changeSeq: change.changeSeq, statusCode: !id || action === 'test' ? 201 : 200,
        result: 'binding' in prepared ? { binding: prepared.binding } : { delivery: prepared.delivery }, commit() { change.commit(); prepared.commit(); } };
    },
  };
  async function status(userId: string): Promise<WebPushStatus> {
    return authority.runTransaction(userId, null, async b => {
      const rows = await b.transaction.get(query(b, 'push_bindings').orderBy('createdAt', 'desc').orderBy('bindingId', 'desc').limit(20));
      const bindings = rows.docs.map(row => decode(b, row, 'push-binding', row.get('bindingId'), firestorePushBindingSchema).binding);
      bindings.sort((a, x) => Number(x.status === 'active') - Number(a.status === 'active'));
      const messages = await b.transaction.get(query(b, 'push_deliveries').orderBy('createdAt', 'desc').orderBy('deliveryId', 'desc').limit(20));
      const deliveries = messages.docs.map(row => decode(b, row, 'push-delivery', row.get('deliveryId'), firestorePushDeliverySchema).delivery);
      const used = await recent(b), next = Math.max(0, ...used.map(item => Date.parse(item.createdAt) + 60_000),
        used.length >= 3 ? Math.min(...used.map(item => Date.parse(item.createdAt))) + 86400_000 : 0);
      return { userId, available: available(), workerEnabled: (await authority.readControl(b.transaction)).enabled,
        publicKey: options.gateway.publicKey, supportedProviders: ['fcm', 'mozilla'], bindings, deliveries,
        testsRemaining: Math.max(0, 3 - used.length), nextTestAt: next > Date.now() ? new Date(next).toISOString() : null };
    });
  }
  async function process(job: FirestoreBackgroundWork, signal: AbortSignal) {
    const { scope } = job, id = job.resourceId;
    if (job.kind !== 'push' || scope.childId !== NIL) domainReject('invalid_scope', 400);
    const original = await authority.runTransaction(scope.ownerUserId, null, async b => {
      if (job.generation !== b.generation || job.authorizationVersion !== b.authorizationVersion || firestoreDomainHash(scope) !== firestoreDomainHash(b.scope)) return null;
      const ref = data.ref('push_deliveries', 'push-delivery', id), row = await b.transaction.get(ref);
      const saved = decode(b, row, 'push-delivery', id, firestorePushDeliverySchema), value = saved.delivery;
      if (value.id !== id || saved.generation !== job.generation || saved.authorizationVersion !== b.authorizationVersion) domainReject('push_binding', 500);
      if (!['queued', 'sending'].includes(value.status)) return { terminal: value.status === 'unknown' ? 'unknown' as const : 'completed' as const };
      if (value.status === 'sending') {
        saved.delivery = { ...value, status: 'unknown', reason: 'worker_interrupted', finishedAt: new Date().toISOString() };
        b.transaction.set(ref, deliveryEnvelope(b, saved)); return { terminal: 'unknown' as const };
      }
      const subscription = await binding(b, value.bindingId), control = await authority.readControl(b.transaction);
      const reason: PushDelivery['reason'] = !control.enabled ? 'worker_paused' : !options.gateway.publicKey ? 'configuration_unavailable'
        : subscription.binding.status !== 'active' || subscription.binding.version !== saved.bindingVersion || subscription.binding.vapidPublicKey !== options.gateway.publicKey
          || !subscription.input ? 'revoked' : subscription.binding.expiresAt && Date.parse(subscription.binding.expiresAt) <= Date.now() ? 'subscription_expired' : null;
      if (reason) { saved.delivery = { ...value, status: 'stopped', reason, finishedAt: new Date().toISOString() }; b.transaction.set(ref, deliveryEnvelope(b, saved)); return null; }
      saved.attempt = randomUUID(); saved.delivery = { ...value, status: 'sending', attemptedAt: new Date().toISOString() };
      b.transaction.set(ref, deliveryEnvelope(b, saved)); return { saved, subscription: subscription.input!.subscription };
    });
    if (!original) return { state: 'stopped' as const };
    if (original.terminal) return { state: original.terminal };
    const authorized = async () => {
      if (signal.aborted) return false;
      const identity = await options.currentAuth(scope.ownerUserId); if (identity.disabled || !identity.emailVerified) return false;
      try { return await authority.runTransaction(scope.ownerUserId, null, async b => {
        const current = decode(b, await b.transaction.get(data.ref('push_deliveries', 'push-delivery', id)), 'push-delivery', id, firestorePushDeliverySchema);
        const subscribed = (await binding(b, current.delivery.bindingId)).binding;
        return b.generation === job.generation && b.authorizationVersion === job.authorizationVersion && (await authority.readControl(b.transaction)).enabled
          && current.delivery.status === 'sending' && current.attempt === original.saved.attempt && subscribed.status === 'active'
          && subscribed.version === current.bindingVersion && subscribed.vapidPublicKey === options.gateway.publicKey
          && (!subscribed.expiresAt || Date.parse(subscribed.expiresAt) > Date.now());
      }); } catch (error) { if (error && typeof error === 'object' && 'status' in error && [403, 404, 409].includes(Number(error.status))) return false; throw error; }
    };
    let result: PushSendResult;
    try { result = await options.gateway.send(original.subscription, { v: 1, bindingId: original.saved.delivery.bindingId,
      bindingVersion: original.saved.bindingVersion, deliveryId: id }, signal, authorized); }
    catch { result = { status: 'unknown', reason: 'transport_unknown', providerStatus: null }; }
    // Persist actual provider evidence even if the account was revoked while the request was in flight.
    await options.database.runTransaction(async tx => {
      const b = { scope }, ref = data.ref('push_deliveries', 'push-delivery', id), row = await tx.get(ref); if (!row.exists) return;
      const saved = decode(b, row, 'push-delivery', id, firestorePushDeliverySchema);
      if (saved.attempt !== original.saved.attempt || saved.delivery.status !== 'sending') return;
      const bindingRef = data.ref('push_bindings', 'push-binding', saved.delivery.bindingId), subscriptionRow = await tx.get(bindingRef);
      const subscribed = subscriptionRow.exists ? decode(b, subscriptionRow, 'push-binding', saved.delivery.bindingId, firestorePushBindingSchema) : null;
      const expiring = result.reason === 'subscription_expired' && subscribed?.binding.status === 'active' && subscribed.binding.version === saved.bindingVersion;
      const pointer = expiring && subscribed.binding.endpointHash ? data.ref('push_endpoints', 'push-endpoint', subscribed.binding.endpointHash) : null;
      const pointerRow = pointer ? await tx.get(pointer) : null;
      const change = await authority.prepareReceiptChange(tx, scope, randomUUID(), 'preferences');
      change?.commit();
      saved.delivery = { ...saved.delivery, ...result, finishedAt: new Date().toISOString() }; tx.set(ref, deliveryEnvelope(b, saved));
      if (expiring) {
        if (pointerRow?.exists && decode(b, pointerRow, 'push-endpoint', subscribed.binding.endpointHash!, endpointSchema).bindingId === subscribed.binding.id) tx.delete(pointer!);
        subscribed.input = null; subscribed.binding = { ...subscribed.binding, version: subscribed.binding.version + 1, status: 'expired',
          endpointHash: null, label: '已失效的訂閱', updatedAt: new Date().toISOString() }; tx.set(bindingRef, bindingEnvelope(b, subscribed));
      }
    });
    return { state: result.status === 'unknown' ? 'unknown' as const : 'completed' as const };
  }
  return { status, mutation, process,
    async prepareInvalidation(b: Pick<Binding, 'scope' | 'transaction'>, id: string, version: number) {
      const ref = data.ref('push_bindings', 'push-binding', id), row = await b.transaction.get(ref);
      if (!row.exists) return { commit() {} };
      const value = decode(b, row, 'push-binding', id, firestorePushBindingSchema);
      if (value.binding.version !== version || value.binding.status !== 'active') return { commit() {} };
      const key = value.binding.endpointHash, pointer = key ? data.ref('push_endpoints', 'push-endpoint', key) : null;
      const occupied = pointer ? await b.transaction.get(pointer) : null;
      const remove = occupied?.exists && decode(b, occupied, 'push-endpoint', key!, endpointSchema).bindingId === id;
      value.input = null; value.binding = { ...value.binding, version: version + 1, status: 'expired', endpointHash: null,
        label: '已失效的訂閱', updatedAt: new Date().toISOString() };
      return { commit() { b.transaction.set(ref, bindingEnvelope(b, value)); if (remove) b.transaction.delete(pointer!); } };
    },
    async readBinding(b: Binding, id: string) { return binding(b, id); },
  };
}
export type FirestoreWebPush = ReturnType<typeof createFirestoreWebPush>;
