import { nativeChatPresenceInputSchema, nativePushReferenceSchema } from '../src/shared/native-push.ts';
import { DeviceSessionError, type FirestoreDeviceSessions, type DeviceSessionKey } from './firestore-device-sessions.ts';
import { chatStateSchema, chatTargetSchema, chatReasonSchema, presenceLifetimeMs, createChatNotificationPolicy } from './firestore-chat-notification-policy.ts';
import { createChatNotificationQueue } from './firestore-chat-notification-queue.ts';
import { pushSubscriptionInput } from '../src/shared/web-push.ts';
import { randomUUID, createHash } from 'node:crypto';
import type { Query, DocumentSnapshot } from '@google-cloud/firestore';
import { z } from 'zod';
import { notificationMessageContentSchema } from '../src/shared/notification-messages.ts';
import { acceptedMessage, messageSortMetadata } from './notification-message-content.ts';
import { pushRegistrationInput, pushBindingSchema, pushDeliverySchema, pushVersionInput, pushTestInput,
  type PushBinding, type PushDelivery, type WebPushStatus } from '../src/shared/web-push.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { prepareFirestoreBackgroundWork, type FirestoreBackgroundWork } from './firestore-background-work.ts';
import type { FirestoreOnlineMutation } from './firestore-online.ts';
import type { WebPushGateway, PushSendResult } from './web-push-types.ts';
import { checkedSubscription, pushProvider } from './web-push-gateway.ts';

const uuid = z.uuid(), NIL = '00000000-0000-0000-0000-000000000000';
export const firestorePushBindingSchema = z.object({ binding: pushBindingSchema, input: pushRegistrationInput.nullable(),
  sessionHash: z.string().regex(/^[a-f0-9]{64}$/u).optional(), chat: chatStateSchema.optional() }).strict();
export const firestorePushDeliverySchema = z.object({ delivery: pushDeliverySchema, bindingVersion: z.number().int().positive(),
  generation: uuid, authorizationVersion: z.string(), attempt: uuid.nullable(), chatTarget: chatTargetSchema.optional(), chatReason: chatReasonSchema.nullable().optional(),
  chatSession: z.string().regex(/^[a-f0-9]{64}$/u).optional(), message: notificationMessageContentSchema.optional() }).strict();
const endpointSchema = z.object({ ownerUserId: z.string().min(1).max(256), bindingId: uuid, endpointHash: z.string().length(64) }).strict();
export const firestorePushEndpointRecoverySchema = endpointSchema;
type SavedBinding = z.infer<typeof firestorePushBindingSchema>;
type SavedDelivery = z.infer<typeof firestorePushDeliverySchema>;
const pathPattern = /^\/api\/web-push\/subscriptions(?:\/([0-9a-f-]{36})\/(revoke|test))?$/iu;

/** Existing VAPID/provider transport with Firestore receipts. No browser or model sends directly. */
export function createFirestoreWebPush(options: FirestoreDomainOptions & {
  gateway: WebPushGateway; enabled: boolean;
  sessions?: Pick<FirestoreDeviceSessions,'assertActiveIn'|'canResumeIn'>;
  dispatchChatWork?: (id: string) => Promise<unknown>;
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
     ...(saved.chatTarget ? {chatCreatedAt:saved.delivery.createdAt} : {createdAt:saved.delivery.createdAt}), bindingId: saved.delivery.bindingId, status: saved.delivery.status,
    ...messageSortMetadata(saved.message ? [saved.message] : []),
    ...data.seal('push-delivery', saved.delivery.id, b.scope, firestorePushDeliverySchema, saved) });
  const {chatMessageAvailable, chatEligibility} = createChatNotificationPolicy(data);
  const validSubscription = (s: SavedBinding) => available() && s.binding.status === 'active' && s.input
    && s.binding.vapidPublicKey === options.gateway.publicKey && (!s.binding.expiresAt || Date.parse(s.binding.expiresAt) > Date.now());

  async function sessionActive(b: Binding, s: SavedBinding) {
    if (!s.sessionHash || !options.sessions) return false;
    try {
      await options.sessions.assertActiveIn(b.transaction,{userId:b.actorUserId,sessionHash:s.sessionHash});
      return true;
    } catch (err) {
      if (err instanceof DeviceSessionError && err.status === 401) return false;
      throw err;
    }
  }
  function requireSession(b: Binding, session: DeviceSessionKey) {
    if (session.userId !== b.actorUserId || !options.sessions) domainReject('unauthorized',401);
    return options.sessions.assertActiveIn(b.transaction,session);
  }
  function presenceView(saved: SavedBinding, session: DeviceSessionKey) {
    const ours = saved.sessionHash === session.sessionHash;
    return {bindingId:saved.binding.id, presenceVersion:saved.chat?.presenceVersion ?? 0,
      chatNotificationsEnabled:ours && saved.chat?.notificationsEnabled === true,
      chatPreviewEnabled:ours && saved.chat?.previewEnabled === true, expiresAt:ours ? saved.chat?.expiresAt ?? null : null};
  }
  async function readChatPresence(userId: string, session: DeviceSessionKey, id: string) {
    return authority.runTransaction(userId,null,async b => {
      await requireSession(b,session);
      const saved = await binding(b,id);
      if (!validSubscription(saved)) domainReject('subscription_unavailable');
      return presenceView(saved,session);
    });
  }
  function hasProof(saved: SavedBinding, input: unknown) {
    const proof = pushSubscriptionInput.safeParse(input);
    return !!saved.input && proof.success && firestoreDomainHash(saved.input.subscription) === firestoreDomainHash(proof.data);
  }
  const presenceInput = nativeChatPresenceInputSchema.extend({bindingId:uuid, expectedBindingVersion:z.number().int().positive(),
    expectedPresenceVersion:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER-1), subscription:pushSubscriptionInput.optional()});
  async function setChatPresence(userId: string, session: DeviceSessionKey, raw: unknown) {
    const input = domainParse(presenceInput,raw);
    return authority.runTransaction(userId,null,async b => {
      await requireSession(b,session);
      const saved = await binding(b,input.bindingId);
      if (!validSubscription(saved) || saved.binding.version !== input.expectedBindingVersion) domainReject('subscription_changed');
      const version = saved.chat?.presenceVersion ?? 0, sameSession = saved.sessionHash === session.sessionHash;
      if (version !== input.expectedPresenceVersion) domainReject('presence_changed');
      if ((!sameSession || input.chatNotificationsEnabled !== undefined || input.chatPreviewEnabled !== undefined) && !hasProof(saved,input.subscription))
        domainReject('installation_proof_required',409);
      if (!sameSession && (input.chatNotificationsEnabled !== true || input.chatPreviewEnabled === undefined))
        domainReject('installation_consent_required',409);
      if (input.childId && !await b.readChild(input.childId)) domainReject('not_found',404);
      const enabled = input.chatNotificationsEnabled ?? saved.chat?.notificationsEnabled ?? false;
      if (input.chatPreviewEnabled && !enabled) domainReject('invalid_input',400);
      const previewEnabled = enabled && (input.chatPreviewEnabled ?? saved.chat?.previewEnabled ?? false);
      const preferenceChanged = !sameSession || enabled !== !!saved.chat?.notificationsEnabled || previewEnabled !== !!saved.chat?.previewEnabled;
      const change = preferenceChanged ? await b.prepareChange(randomUUID(),'preferences',false) : null;
      saved.sessionHash = session.sessionHash;
      saved.chat = {notificationsEnabled:enabled, previewEnabled, brandedCard:true, presenceVersion:version+1,
        childId:enabled ? input.childId : null, expiresAt:enabled && input.childId ? new Date(Date.now()+presenceLifetimeMs).toISOString() : null};
      change?.commit();
      b.transaction.set(data.ref('push_bindings','push-binding',saved.binding.id),bindingEnvelope(b,saved));
      return presenceView(saved,session);
    });
  }
  const queue = createChatNotificationQueue(data, {
    kind:'push', bindings:'push_bindings', identity:'web-chat-delivery', deliveries:'push_deliveries', record:'push-delivery',
    dispatch:options.dispatchChatWork,
    async recipient(b,id) {
      const s = await binding(b,id);
      return validSubscription(s) && s.chat?.notificationsEnabled && await sessionActive(b,s)
        ? {...s.binding, sessionHash:s.sessionHash} : null;
    },
    read:(b,row,id)=>decode(b,row,'push-delivery',id,firestorePushDeliverySchema), envelope:deliveryEnvelope,
  });
  async function authorizeChatOpen(userId: string, session: DeviceSessionKey, raw: unknown, proof?:unknown) {
    const ref = domainParse(nativePushReferenceSchema,raw);
    return authority.runTransaction(userId,null,async b => {
      await requireSession(b,session);
      const subscribed = await binding(b,ref.bindingId);
      if (ref.kind !== 'care' || !validSubscription(subscribed) || !subscribed.chat?.notificationsEnabled
        || subscribed.binding.version !== ref.bindingVersion || !subscribed.sessionHash) domainReject('not_found',404);
      const row = await b.transaction.get(data.ref('push_deliveries','push-delivery',ref.deliveryId));
      const saved = decode(b,row,'push-delivery',ref.deliveryId,firestorePushDeliverySchema);
      if (!saved.chatTarget || saved.delivery.id !== ref.deliveryId || saved.delivery.bindingId !== ref.bindingId || saved.bindingVersion !== ref.bindingVersion
        || saved.generation !== b.generation || saved.authorizationVersion !== b.authorizationVersion || !['sending','unknown','accepted'].includes(saved.delivery.status)
        || !saved.chatSession || !await options.sessions!.canResumeIn(b.transaction,{userId,sessionHash:saved.chatSession})) domainReject('not_found',404);
      if (session.sessionHash !== saved.chatSession || session.sessionHash !== subscribed.sessionHash) {
        if (proof === undefined) domainReject('installation_proof_required',409);
        if (!hasProof(subscribed,proof)) domainReject('not_found',404);
      }
      if (!await chatMessageAvailable(b,saved.chatTarget)) domainReject('not_found',404);
      return {kind:'chat' as const,...saved.chatTarget};
    });
  }
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
  async function status(userId: string, includeApple = false): Promise<WebPushStatus> {
    return authority.runTransaction(userId, null, async b => {
      const rows = await b.transaction.get(query(b, 'push_bindings').orderBy('createdAt', 'desc').orderBy('bindingId', 'desc').limit(20));
      const bindings = rows.docs.map(row => decode(b, row, 'push-binding', row.get('bindingId'), firestorePushBindingSchema).binding).filter(binding => includeApple || binding.provider !== 'apple');
      bindings.sort((a, x) => Number(x.status === 'active') - Number(a.status === 'active'));
      const messages = await b.transaction.get(query(b, 'push_deliveries').orderBy('createdAt', 'desc').orderBy('deliveryId', 'desc').limit(20));
      const deliveries = messages.docs.map(row => decode(b, row, 'push-delivery', row.get('deliveryId'), firestorePushDeliverySchema).delivery);
      const used = await recent(b), next = Math.max(0, ...used.map(item => Date.parse(item.createdAt) + 60_000),
        used.length >= 3 ? Math.min(...used.map(item => Date.parse(item.createdAt))) + 86400_000 : 0);
      return { userId, available: available(), workerEnabled: (await authority.readControl(b.transaction)).enabled,
        publicKey: options.gateway.publicKey, supportedProviders: includeApple ? ['fcm','mozilla','apple'] : ['fcm','mozilla'], bindings, deliveries,
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
      const reason: PushDelivery['reason'] = saved.chatTarget && (saved.chatSession !== subscription.sessionHash || !await sessionActive(b,subscription)) ? 'revoked' : !control.enabled ? 'worker_paused' : !options.gateway.publicKey ? 'configuration_unavailable'
        : subscription.binding.status !== 'active' || subscription.binding.version !== saved.bindingVersion || subscription.binding.vapidPublicKey !== options.gateway.publicKey
          || !subscription.input ? 'revoked' : subscription.binding.expiresAt && Date.parse(subscription.binding.expiresAt) <= Date.now() ? 'subscription_expired' : null;
      if (reason) { saved.delivery = { ...value, status: 'stopped', reason, finishedAt: new Date().toISOString() }; b.transaction.set(ref, deliveryEnvelope(b, saved)); return null; }
      if (saved.chatTarget) {
        const chat = await chatEligibility(b,saved,subscription);
        saved.chatReason = chat.reason;
        if (chat.nextAt) { b.transaction.set(ref,deliveryEnvelope(b,saved)); return {deferred:chat.nextAt}; }
        if (chat.reason) {
          saved.delivery = {...value,status:'stopped',reason:'revoked',finishedAt:new Date().toISOString()};
          b.transaction.set(ref,deliveryEnvelope(b,saved)); return null;
        }
      }
      saved.attempt = randomUUID(); saved.delivery = { ...value, status: 'sending', attemptedAt: new Date().toISOString() };
      b.transaction.set(ref, deliveryEnvelope(b, saved)); return { saved, subscription: subscription.input!.subscription };
    });
    if (!original) return { state: 'stopped' as const };
    if ('deferred' in original && original.deferred) return {state:'deferred' as const,nextAt:original.deferred};
    if (original.terminal) return { state: original.terminal };
    if (!original.saved || !original.subscription) domainReject('push_binding',500);
    const {saved:claimed,subscription:targetSubscription} = original;
    const authorization = {chat:null as Awaited<ReturnType<typeof chatEligibility>> | null};
    const authorized = async () => {
      authorization.chat = null;
      if (signal.aborted) return false;
      const identity = await options.currentAuth(scope.ownerUserId); if (identity.disabled || !identity.emailVerified) return false;
      try { return await authority.runTransaction(scope.ownerUserId, null, async b => {
        const current = decode(b, await b.transaction.get(data.ref('push_deliveries', 'push-delivery', id)), 'push-delivery', id, firestorePushDeliverySchema);
        const registration = await binding(b,current.delivery.bindingId), subscribed = registration.binding;
        const active = b.generation === job.generation && b.authorizationVersion === job.authorizationVersion && (await authority.readControl(b.transaction)).enabled
          && current.delivery.status === 'sending' && current.attempt === claimed.attempt && subscribed.status === 'active'
          && subscribed.version === current.bindingVersion && subscribed.vapidPublicKey === options.gateway.publicKey
          && (!subscribed.expiresAt || Date.parse(subscribed.expiresAt) > Date.now());
        if (!active || !current.chatTarget) return active;
        if (registration.sessionHash !== current.chatSession || !await sessionActive(b,registration)) return false;
        authorization.chat = await chatEligibility(b,current,registration);
        return !authorization.chat.reason;
      }); } catch (error) { if (error && typeof error === 'object' && 'status' in error && [403, 404, 409].includes(Number(error.status))) return false; throw error; }
    };
    let result: PushSendResult;
    try { result = await options.gateway.send(targetSubscription, {
      ...(claimed.chatTarget ? {v:2 as const,kind:'chat' as const} : {v:1 as const}),
      bindingId: claimed.delivery.bindingId,bindingVersion: claimed.bindingVersion,deliveryId:id
    },signal,authorized,() => authorization.chat?.previewText); }
    catch { result = { status: 'unknown', reason: 'transport_unknown', providerStatus: null }; }
    // Persist actual provider evidence even if the account was revoked while the request was in flight.
    await options.database.runTransaction(async tx => {
      const b = { scope }, ref = data.ref('push_deliveries', 'push-delivery', id), row = await tx.get(ref); if (!row.exists) return;
      const saved = decode(b, row, 'push-delivery', id, firestorePushDeliverySchema);
      if (saved.attempt !== claimed.attempt || saved.delivery.status !== 'sending') return;
      const bindingRef = data.ref('push_bindings', 'push-binding', saved.delivery.bindingId), subscriptionRow = await tx.get(bindingRef);
      const subscribed = subscriptionRow.exists ? decode(b, subscriptionRow, 'push-binding', saved.delivery.bindingId, firestorePushBindingSchema) : null;
      const expiring = result.reason === 'subscription_expired' && subscribed?.binding.status === 'active' && subscribed.binding.version === saved.bindingVersion;
      const pointer = expiring && subscribed.binding.endpointHash ? data.ref('push_endpoints', 'push-endpoint', subscribed.binding.endpointHash) : null;
      const pointerRow = pointer ? await tx.get(pointer) : null;
      const change = await authority.prepareReceiptChange(tx, scope, randomUUID(), 'preferences');
      change?.commit();
      if (saved.chatTarget && result.status === 'stopped' && authorization.chat?.reason) {
        saved.chatReason = authorization.chat.reason;
        if (authorization.chat.nextAt) {
          saved.attempt = null;
          saved.delivery = {...saved.delivery,status:'queued',reason:null,attemptedAt:null,finishedAt:null};
          tx.set(ref,deliveryEnvelope(b,saved)); return;
        }
      }
      const { message: capturedMessage, ...deliveryResult } = result;
      const message = options.messageHistoryEnabled === true ? acceptedMessage({ ...deliveryResult, message: capturedMessage }, 'web_push') : undefined;
      if (message) saved.message = message;
      saved.delivery = { ...saved.delivery, ...deliveryResult, finishedAt: new Date().toISOString() }; tx.set(ref, deliveryEnvelope(b, saved));
      if (expiring) {
        if (pointerRow?.exists && decode(b, pointerRow, 'push-endpoint', subscribed.binding.endpointHash!, endpointSchema).bindingId === subscribed.binding.id) tx.delete(pointer!);
        subscribed.input = null; subscribed.binding = { ...subscribed.binding, version: subscribed.binding.version + 1, status: 'expired',
          endpointHash: null, label: '已失效的訂閱', updatedAt: new Date().toISOString() }; tx.set(bindingRef, bindingEnvelope(b, subscribed));
      }
    });
    if (result.status === 'stopped' && authorization.chat?.nextAt) return {state:'deferred' as const,nextAt:authorization.chat.nextAt};
    return { state: result.status === 'unknown' ? 'unknown' as const : 'completed' as const };
  }
  return { status, mutation, process, ...queue, readChatPresence, setChatPresence, authorizeChatOpen,
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
