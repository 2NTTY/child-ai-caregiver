import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { DocumentSnapshot, Query, Transaction } from '@google-cloud/firestore';
import { z } from 'zod';
import { telegramBindingSchema, telegramDeliverySchema, telegramBeginInput, telegramConfirmInput, telegramVersionInput, telegramTestInput,
  type TelegramBinding, type TelegramChallenge, type TelegramStatus } from '../src/shared/telegram.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, FIRESTORE_TASK_DISPATCH_SCOPE as SYSTEM, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { workRecoveryScopeSchema, type WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';
import { openRecoveryEnvelope } from './firestore-recovery-envelope.ts';
import { prepareFirestoreBackgroundWork, type FirestoreBackgroundWork } from './firestore-background-work.ts';
import type { FirestoreOnlineMutation } from './firestore-online.ts';
import type { TelegramConfig, TelegramEvent, TelegramGateway, TelegramSendResult } from './telegram-types.ts';

const NIL = SYSTEM.childId, uuid = z.uuid(), time = z.iso.datetime({ offset: true }), positiveId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const targetSchema = z.object({ chatId: positiveId, senderId: positiveId, label: z.string().max(160) }).strict();
export const firestoreTelegramBindingSchema = z.object({ binding: telegramBindingSchema, botId: z.string(), target: targetSchema.nullable(), targetHash: z.string().nullable() }).strict();
export const firestoreTelegramChallengeSchema = z.object({ id: uuid, version: z.number().int().positive(), botId: z.string(),
  token: z.string().length(32).nullable(), candidate: targetSchema.nullable(), state: z.enum(['waiting', 'seen', 'consumed', 'cancelled']), createdAt: time, expiresAt: time }).strict();
export const firestoreTelegramDeliverySchema = z.object({ delivery: telegramDeliverySchema, botId: z.string(), bindingVersion: z.number().int().positive(),
  generation: uuid, authorizationVersion: z.string(), callback: z.string().length(32).nullable(), attempt: uuid.nullable() }).strict();
const pointerSchema = z.object({ id: uuid, scope: workRecoveryScopeSchema }).strict();
const stateSchema = z.object({ bindingId: uuid.nullable(), challengeId: uuid.nullable() }).strict();
const metaSchema = z.object({ key: z.string().length(44) }).strict();
const updateSchema = z.object({ botId: z.string(), updateId: z.number().int().nonnegative(), outcome: z.enum(['ignored', 'seen', 'revoked', 'acknowledged']) }).strict();
export const firestoreTelegramRecoverySchemas = { pointer: pointerSchema, state: stateSchema, meta: metaSchema, update: updateSchema };
type SavedBinding = z.infer<typeof firestoreTelegramBindingSchema>;
type SavedChallenge = z.infer<typeof firestoreTelegramChallengeSchema>;
type SavedDelivery = z.infer<typeof firestoreTelegramDeliverySchema>;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const hint = (chatId: number) => '••••' + String(chatId).slice(-4);
const pathPattern = /^\/api\/telegram\/(?:challenges|(?:challenges\/([0-9a-f-]{36})\/confirm)|(?:bindings\/([0-9a-f-]{36})\/(revoke|test)))$/iu;

/** Private binding and delivery ledger. Gateway/commands remain the existing Telegram protocol. */
export function createFirestoreTelegram(options: FirestoreDomainOptions & {
  config: TelegramConfig | null; gateway: TelegramGateway; currentAuth(userId: string): Promise<{ disabled: boolean; emailVerified: boolean }>;
}) {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options), config = options.config;
  const personalKey = (scope: WorkRecoveryScope) => JSON.stringify([scope.ownerUserId, scope.workspaceId, scope.storageEpoch]);
  const tagsMatch = (scope: WorkRecoveryScope, row: DocumentSnapshot) => Object.entries(data.tags(scope)).every(([key, value]) => row.get(key) === value);
  function decode<T>(scope: WorkRecoveryScope, row: DocumentSnapshot, kind: string, id: string, schema: z.ZodType<T>) {
    if (!row.exists || !tagsMatch(scope, row)) domainReject('not_found', 404); return data.open(kind, id, scope, schema, row);
  }
  function query(b: Pick<Binding, 'scope'>, suffix: string): Query {
    let q: Query = data.collection(suffix); for (const [key, value] of Object.entries(data.tags(b.scope))) q = q.where(key, '==', value); return q;
  }
  function envelope<T>(scope: WorkRecoveryScope, kind: string, id: string, schema: z.ZodType<T>, value: T, version = 1, metadata = {}) {
    return { ...data.tags(scope), ...metadata, ...data.seal(kind, id, scope, schema, value, version) };
  }
  const bindingEnvelope = (scope: WorkRecoveryScope, saved: SavedBinding) => envelope(scope, 'telegram-binding', saved.binding.id,
    firestoreTelegramBindingSchema, saved, saved.binding.version, { bindingId: saved.binding.id, createdAt: saved.binding.createdAt, status: saved.binding.status });
  const challengeEnvelope = (scope: WorkRecoveryScope, saved: SavedChallenge) => envelope(scope, 'telegram-challenge', saved.id,
    firestoreTelegramChallengeSchema, saved, saved.version, { challengeId: saved.id, createdAt: saved.createdAt, state: saved.state });
  const deliveryEnvelope = (scope: WorkRecoveryScope, saved: SavedDelivery) => envelope(scope, 'telegram-delivery', saved.delivery.id,
    firestoreTelegramDeliverySchema, saved, 1, { deliveryId: saved.delivery.id, bindingId: saved.delivery.bindingId, createdAt: saved.delivery.createdAt, status: saved.delivery.status,
      unresolved: ['queued', 'sending', 'unknown'].includes(saved.delivery.status) && !saved.delivery.acknowledgedAt });
  async function state(b: Binding) {
    const id = personalKey(b.scope), ref = data.ref('telegram_state', 'telegram-state', id), row = await b.transaction.get(ref);
    return { ref, id, value: row.exists ? decode(b.scope, row, 'telegram-state', id, stateSchema) : { bindingId: null, challengeId: null } };
  }
  async function binding(b: Binding, id: string) {
    const row = await b.transaction.get(data.ref('telegram_bindings', 'telegram-binding', id));
    const value = decode(b.scope, row, 'telegram-binding', id, firestoreTelegramBindingSchema);
    if (value.binding.id !== id || value.binding.version !== row.get('recordVersion') || value.binding.status !== row.get('status')) domainReject('telegram_binding', 500);
    return value;
  }
  async function challenge(b: Binding, id: string) {
    const row = await b.transaction.get(data.ref('telegram_challenges', 'telegram-challenge', id));
    const value = decode(b.scope, row, 'telegram-challenge', id, firestoreTelegramChallengeSchema);
    if (value.id !== id || value.version !== row.get('recordVersion')) domainReject('telegram_binding', 500); return value;
  }
  async function lookupKey(tx: Transaction) {
    const ref = data.ref('telegram_meta', 'telegram-meta', 'lookup-key'), row = await tx.get(ref);
    const value = row.exists ? data.open('telegram-meta', 'lookup-key', SYSTEM, metaSchema, row) : { key: randomBytes(32).toString('base64') };
    return { value: Buffer.from(value.key, 'base64'), commit() { if (!row.exists) tx.create(ref, envelope(SYSTEM, 'telegram-meta', 'lookup-key', metaSchema, value)); } };
  }
  const targetHash = (key: Buffer, chatId: number) => createHmac('sha256', key).update(config!.botId + ':' + chatId).digest('hex');
  const pendingKey = (fingerprint: string) => hash('pending:' + fingerprint);
  const lookupId = (type: 'start' | 'ack', token: string) => hash(config!.botId + ':' + type + ':' + token);
  function pointerEnvelope(scope: WorkRecoveryScope, key: string, id: string) { return envelope(scope, 'telegram-pointer', key, pointerSchema, { scope, id }); }
  async function pointer(tx: Transaction, key: string) {
    const ref = data.ref('telegram_pointers', 'telegram-pointer', key), row = await tx.get(ref); if (!row.exists) return null;
    // Recover only the authenticated scope before opening the owner-bound record; callers cannot supply it.
    const raw = row.data()!;
    const opened = openRecoveryEnvelope({ ...options, locator: raw.recovery, envelope: { family: 'domain', version: raw.version, recordVersion: raw.recordVersion, ciphertext: raw.ciphertext } });
    if (opened.context.kind !== 'telegram-pointer' || opened.context.id !== key) domainReject('telegram_binding', 500);
    const value = decode(opened.context.scope, row, 'telegram-pointer', key, pointerSchema);
    if (firestoreDomainHash(value.scope) !== firestoreDomainHash(opened.context.scope)) domainReject('telegram_binding', 500); return value;
  }
  function viewChallenge(value: SavedChallenge): TelegramChallenge {
    if (!config || !value.token || !['waiting', 'seen'].includes(value.state)) domainReject('telegram_link_changed');
    return { id: value.id, version: value.version, state: value.state === 'seen' ? 'seen' : 'waiting', expiresAt: value.expiresAt,
      startUrl: 'https://t.me/' + config.botUsername + '?start=' + value.token,
      candidate: value.candidate ? { label: value.candidate.label, chatIdHint: hint(value.candidate.chatId) } : null };
  }
  const writeState = (b: Binding, s: Awaited<ReturnType<typeof state>>) => b.transaction.set(s.ref, envelope(b.scope, 'telegram-state', s.id, stateSchema, s.value));
  async function prepareBegin(b: Binding) {
    if (!config) domainReject('telegram_unavailable');
    const s = await state(b), bound = s.value.bindingId ? await binding(b, s.value.bindingId) : null;
    if (bound?.binding.status === 'active') domainReject('telegram_already_bound');
    const previous = s.value.challengeId ? await challenge(b, s.value.challengeId) : null;
    const used = await b.transaction.get(query(b, 'telegram_challenges').where('createdAt', '>', new Date(Date.now() - 3600_000).toISOString()).limit(6));
    if (used.size >= 6) domainReject('telegram_link_limit');
    const meta = await lookupKey(b.transaction), now = Date.now();
    const previousPendingKey = previous?.candidate ? pendingKey(targetHash(meta.value, previous.candidate.chatId)) : null;
    const previousPending = previousPendingKey ? await pointer(b.transaction, previousPendingKey) : null;
    const value: SavedChallenge = { id: randomUUID(), version: 1, botId: config.botId, token: randomBytes(24).toString('base64url'), candidate: null,
      state: 'waiting', createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 600_000).toISOString() };
    const key = lookupId('start', value.token!), oldKey = previous?.token ? lookupId('start', previous.token) : null;
    s.value.challengeId = value.id;
    return { challenge: viewChallenge(value), commit() {
      meta.commit();
      if (previous && ['waiting', 'seen'].includes(previous.state)) {
        previous.version++; previous.state = 'cancelled'; previous.candidate = null; previous.token = null;
        b.transaction.set(data.ref('telegram_challenges', 'telegram-challenge', previous.id), challengeEnvelope(b.scope, previous));
      }
      if (oldKey) b.transaction.delete(data.ref('telegram_pointers', 'telegram-pointer', oldKey));
      if (previousPending && previousPending.id === previous?.id) b.transaction.delete(data.ref('telegram_pointers', 'telegram-pointer', previousPendingKey!));
      b.transaction.create(data.ref('telegram_challenges', 'telegram-challenge', value.id), challengeEnvelope(b.scope, value));
      b.transaction.create(data.ref('telegram_pointers', 'telegram-pointer', key), pointerEnvelope(b.scope, key, value.id)); writeState(b, s);
    } };
  }
  async function prepareConfirm(b: Binding, id: string, expectedVersion: number) {
    if (!config) domainReject('telegram_unavailable');
    const s = await state(b), pending = await challenge(b, id), existing = s.value.bindingId ? await binding(b, s.value.bindingId) : null;
    if (pending.version !== expectedVersion || pending.state !== 'seen' || !pending.candidate || !pending.token || s.value.challengeId !== id
      || pending.botId !== config.botId || Date.parse(pending.expiresAt) <= Date.now()) domainReject('telegram_link_changed');
    if (existing?.binding.status === 'active') domainReject('telegram_already_bound');
    const key = await lookupKey(b.transaction), fingerprint = targetHash(key.value, pending.candidate.chatId);
    if (await pointer(b.transaction, fingerprint)) domainReject('telegram_target_in_use');
    const candidateKey = pendingKey(fingerprint), candidatePointer = await pointer(b.transaction, candidateKey);
    if (candidatePointer?.id !== id || firestoreDomainHash(candidatePointer.scope) !== firestoreDomainHash(b.scope)) domainReject('telegram_link_changed');
    const at = new Date().toISOString(), bindingId = randomUUID();
    const saved: SavedBinding = { botId: config.botId, target: pending.candidate, targetHash: fingerprint,
      binding: { id: bindingId, version: 1, status: 'active', label: pending.candidate.label, chatIdHint: hint(pending.candidate.chatId), createdAt: at, updatedAt: at } };
    const tokenKey = lookupId('start', pending.token); pending.version++; pending.state = 'consumed'; pending.token = null; pending.candidate = null;
    s.value.bindingId = bindingId; s.value.challengeId = null;
    return { binding: saved.binding, commit() {
      key.commit(); b.transaction.create(data.ref('telegram_bindings', 'telegram-binding', bindingId), bindingEnvelope(b.scope, saved));
      b.transaction.create(data.ref('telegram_pointers', 'telegram-pointer', fingerprint), pointerEnvelope(b.scope, fingerprint, bindingId));
      b.transaction.set(data.ref('telegram_challenges', 'telegram-challenge', id), challengeEnvelope(b.scope, pending));
      b.transaction.delete(data.ref('telegram_pointers', 'telegram-pointer', tokenKey)); writeState(b, s);
      b.transaction.delete(data.ref('telegram_pointers', 'telegram-pointer', candidateKey));
    } };
  }
  async function prepareRevoke(b: Binding, id: string, expectedVersion: number, reason: 'revoked' | 'blocked' = 'revoked') {
    const saved = await binding(b, id); if (saved.binding.version !== expectedVersion) domainReject('version_conflict');
    if (saved.binding.status !== 'active') return { binding: saved.binding, commit() {} };
    const queued = await b.transaction.get(query(b, 'telegram_deliveries').where('bindingId', '==', id).where('status', '==', 'queued').limit(20));
    const rows = queued.docs.map(row => ({ ref: row.ref, value: decode(b.scope, row, 'telegram-delivery', row.get('deliveryId'), firestoreTelegramDeliverySchema) }));
    const key = saved.targetHash; saved.target = null; saved.targetHash = null;
    saved.binding = { ...saved.binding, version: expectedVersion + 1, status: reason, label: '已解除的 Telegram 帳號', chatIdHint: '', updatedAt: new Date().toISOString() };
    return { binding: saved.binding, commit() {
      b.transaction.set(data.ref('telegram_bindings', 'telegram-binding', id), bindingEnvelope(b.scope, saved));
      if (key) b.transaction.delete(data.ref('telegram_pointers', 'telegram-pointer', key));
      for (const row of rows) { if (row.value.callback) b.transaction.delete(data.ref('telegram_pointers', 'telegram-pointer', lookupId('ack', row.value.callback)));
        row.value.callback = null; row.value.delivery = { ...row.value.delivery, status: 'stopped', reason: 'revoked', finishedAt: saved.binding.updatedAt };
        b.transaction.set(row.ref, deliveryEnvelope(b.scope, row.value)); }
    } };
  }
  async function prepareTest(b: Binding, id: string, expectedVersion: number) {
    const saved = await binding(b, id), control = await authority.readControl(b.transaction);
    if (!config) domainReject('telegram_unavailable'); if (!control.enabled) domainReject('worker_paused');
    if (saved.binding.version !== expectedVersion) domainReject('version_conflict');
    if (saved.binding.status !== 'active' || !saved.target || saved.botId !== config.botId) domainReject('telegram_binding_unavailable');
    const unresolved = await b.transaction.get(query(b, 'telegram_deliveries').where('bindingId', '==', id).where('unresolved', '==', true).limit(1));
    if (unresolved.docs.some(row => !decode(b.scope, row, 'telegram-delivery', row.get('deliveryId'), firestoreTelegramDeliverySchema).delivery.acknowledgedAt)) domainReject('telegram_delivery_unresolved');
    const used = await b.transaction.get(query(b, 'telegram_deliveries').where('createdAt', '>', new Date(Date.now() - 86400_000).toISOString()).limit(3));
    if (used.size >= 3 || used.docs.some(row => Date.parse(row.get('createdAt')) > Date.now() - 60_000)) domainReject('test_limit');
    const deliveryId = randomUUID(), at = new Date().toISOString(), token = randomBytes(24).toString('base64url'), key = lookupId('ack', token);
    const value: SavedDelivery = { delivery: { id: deliveryId, bindingId: id, status: 'queued', reason: null, providerStatus: null, messageId: null,
      createdAt: at, attemptedAt: null, finishedAt: null, acknowledgedAt: null }, botId: config.botId, bindingVersion: expectedVersion,
      generation: b.generation, authorizationVersion: b.authorizationVersion, callback: token, attempt: null };
    const job = await prepareFirestoreBackgroundWork(data, b.transaction, { kind: 'telegram', scope: b.scope, resourceId: deliveryId, basis: deliveryId,
      generation: b.generation, authorizationVersion: b.authorizationVersion }, at);
    return { delivery: value.delivery, commit() {
      b.transaction.create(data.ref('telegram_deliveries', 'telegram-delivery', deliveryId), deliveryEnvelope(b.scope, value));
      b.transaction.create(data.ref('telegram_pointers', 'telegram-pointer', key), pointerEnvelope(b.scope, key, deliveryId)); job.commit();
    } };
  }
  const mutation: FirestoreOnlineMutation = { supports: path => pathPattern.test(path), async prepare(b, submission) {
    if (b.scope.childId !== NIL) domainReject('invalid_scope', 400);
    const route = pathPattern.exec(submission.path); if (!route) domainReject('not_found', 404);
    const result = route[1] ? await prepareConfirm(b, route[1], domainParse(telegramConfirmInput, submission.payload).expectedVersion)
      : route[2] ? route[3] === 'revoke' ? await prepareRevoke(b, route[2], domainParse(telegramVersionInput, submission.payload).expectedVersion)
        : await prepareTest(b, route[2], domainParse(telegramTestInput, submission.payload).expectedVersion)
        : (domainParse(telegramBeginInput, submission.payload), await prepareBegin(b));
    const change = await b.prepareChange(submission.operation.opId, 'preferences', false);
    return { childId: null, changeSeq: change.changeSeq, statusCode: route[3] === 'test' ? 201 : 200,
      result: 'binding' in result ? { binding: result.binding } : 'challenge' in result ? { challenge: result.challenge } : { delivery: result.delivery },
      commit() { change.commit(); result.commit(); } };
  } };
  async function status(userId: string): Promise<TelegramStatus> { return authority.runTransaction(userId, null, async b => {
    const s = await state(b), bound = s.value.bindingId ? await binding(b, s.value.bindingId) : null;
    const pending = s.value.challengeId ? await challenge(b, s.value.challengeId) : null;
    const rows = await b.transaction.get(query(b, 'telegram_deliveries').orderBy('createdAt', 'desc').orderBy('deliveryId', 'desc').limit(20));
    return { configured: !!config, workerEnabled: (await authority.readControl(b.transaction)).enabled, botUsername: config?.botUsername ?? null,
      binding: bound?.binding ?? null, challenge: pending && config && pending.botId === config.botId && ['waiting', 'seen'].includes(pending.state)
        && Date.parse(pending.expiresAt) > Date.now() ? viewChallenge(pending) : null,
      deliveries: rows.docs.map(row => decode(b.scope, row, 'telegram-delivery', row.get('deliveryId'), firestoreTelegramDeliverySchema).delivery) };
  }); }
  async function webhook(event: Exclude<TelegramEvent, { kind: 'contact_ack' }>): Promise<string | null> {
    if (!config || event.kind === 'ignore') return null;
    const locator = await options.database.runTransaction(async tx => {
      const key = event.kind === 'start' || event.kind === 'ack' ? lookupId(event.kind, event.token) : targetHash((await lookupKey(tx)).value, event.chatId);
      const bound = await pointer(tx, key); if (bound) return { ...bound, candidate: false };
      if (event.kind === 'stop' || event.kind === 'blocked') {
        const pending = await pointer(tx, pendingKey(key)); return pending ? { ...pending, candidate: true } : null;
      }
      return null;
    });
    if (!locator) return null;
    try { return await authority.runTransaction(locator.scope.ownerUserId, null, async b => {
      if (firestoreDomainHash(b.scope) !== firestoreDomainHash(locator.scope)) return null;
      const updateKey = JSON.stringify([config.botId, event.updateId]), ref = data.ref('telegram_updates', 'telegram-update', updateKey);
      if ((await b.transaction.get(ref)).exists) return null;
      let outcome: z.infer<typeof updateSchema>['outcome'] = 'ignored', ack: string | null = null, commit = () => {};
      if (event.kind === 'start') {
        const saved = await challenge(b, locator.id), s = await state(b);
        if (s.value.challengeId === saved.id && saved.token === event.token && saved.botId === config.botId && Date.parse(saved.expiresAt) > Date.now()
          && ['waiting', 'seen'].includes(saved.state) && !saved.candidate) {
          const meta = await lookupKey(b.transaction), fingerprint = targetHash(meta.value, event.chatId), key = pendingKey(fingerprint);
          if (await pointer(b.transaction, fingerprint)) return null;
          const occupied = await pointer(b.transaction, key);
          if (occupied && occupied.id !== saved.id) {
            const old = await b.transaction.get(data.ref('telegram_challenges', 'telegram-challenge', occupied.id));
            const value = old.exists ? decode(occupied.scope, old, 'telegram-challenge', occupied.id, firestoreTelegramChallengeSchema) : null;
            if (value && ['waiting', 'seen'].includes(value.state) && Date.parse(value.expiresAt) > Date.now()) return null;
          }
          saved.candidate = { chatId: event.chatId, senderId: event.senderId, label: event.label }; saved.state = 'seen'; saved.version++; outcome = 'seen';
          commit = () => { meta.commit(); b.transaction.set(data.ref('telegram_challenges', 'telegram-challenge', saved.id), challengeEnvelope(b.scope, saved));
            b.transaction.set(data.ref('telegram_pointers', 'telegram-pointer', key), pointerEnvelope(b.scope, key, saved.id)); };
        }
      } else if (event.kind === 'ack') {
        const row = await b.transaction.get(data.ref('telegram_deliveries', 'telegram-delivery', locator.id));
        const saved = decode(b.scope, row, 'telegram-delivery', locator.id, firestoreTelegramDeliverySchema), bound = await binding(b, saved.delivery.bindingId);
        if (saved.callback === event.token && saved.botId === config.botId && saved.bindingVersion === bound.binding.version && bound.binding.status === 'active'
          && bound.target?.chatId === event.chatId && bound.target.senderId === event.senderId && ['sending', 'accepted', 'unknown'].includes(saved.delivery.status)
          && (saved.delivery.messageId === null || saved.delivery.messageId === event.messageId)) {
          saved.delivery.acknowledgedAt ??= new Date().toISOString(); saved.delivery.messageId ??= event.messageId; outcome = 'acknowledged'; ack = event.callbackQueryId;
          commit = () => b.transaction.set(row.ref, deliveryEnvelope(b.scope, saved));
        }
      } else if (locator.candidate) {
        const pending = await challenge(b, locator.id), key = await lookupKey(b.transaction);
        if (pending.botId === config.botId && pending.state === 'seen' && pending.candidate?.chatId === event.chatId && pending.candidate.senderId === event.senderId) {
          const tokenKey = pending.token ? lookupId('start', pending.token) : null, candidateKey = pendingKey(targetHash(key.value, event.chatId));
          pending.state = 'cancelled'; pending.version++; pending.candidate = null; pending.token = null; outcome = 'revoked';
          commit = () => { b.transaction.set(data.ref('telegram_challenges', 'telegram-challenge', pending.id), challengeEnvelope(b.scope, pending));
            if (tokenKey) b.transaction.delete(data.ref('telegram_pointers', 'telegram-pointer', tokenKey)); b.transaction.delete(data.ref('telegram_pointers', 'telegram-pointer', candidateKey)); };
        }
      } else {
        const bound = await binding(b, locator.id);
        if (bound.botId === config.botId && bound.binding.status === 'active' && bound.target?.chatId === event.chatId && bound.target.senderId === event.senderId) {
          const revoked = await prepareRevoke(b, bound.binding.id, bound.binding.version, event.kind === 'blocked' ? 'blocked' : 'revoked'); outcome = 'revoked'; commit = revoked.commit;
        }
      }
      const change = outcome !== 'ignored' ? await b.prepareChange(randomUUID(), 'preferences', false) : null;
      change?.commit(); commit(); b.transaction.create(ref, envelope(b.scope, 'telegram-update', updateKey, updateSchema,
        { botId: config.botId, updateId: event.updateId, outcome })); return ack;
    }); } catch (error) {
      if (error && typeof error === 'object' && 'status' in error && [403, 404, 409].includes(Number(error.status))) return null; throw error;
    }
  }
  async function process(job: FirestoreBackgroundWork, signal: AbortSignal) {
    if (job.kind !== 'telegram' || job.scope.childId !== NIL) domainReject('invalid_scope', 400);
    const id = job.resourceId, scope = job.scope;
    const original = await authority.runTransaction(scope.ownerUserId, null, async b => {
      if (b.generation !== job.generation || b.authorizationVersion !== job.authorizationVersion || firestoreDomainHash(scope) !== firestoreDomainHash(b.scope)) return null;
      const ref = data.ref('telegram_deliveries', 'telegram-delivery', id), row = await b.transaction.get(ref);
      const saved = decode(scope, row, 'telegram-delivery', id, firestoreTelegramDeliverySchema);
      if (saved.delivery.id !== id || saved.generation !== b.generation || saved.authorizationVersion !== b.authorizationVersion) domainReject('telegram_binding', 500);
      if (!['queued', 'sending'].includes(saved.delivery.status)) return { terminal: saved.delivery.status === 'unknown' ? 'unknown' as const : 'completed' as const };
      if (saved.delivery.status === 'sending') {
        saved.delivery = { ...saved.delivery, status: 'unknown', reason: 'worker_interrupted', finishedAt: new Date().toISOString() };
        b.transaction.set(ref, deliveryEnvelope(scope, saved)); return { terminal: 'unknown' as const };
      }
      const bound = await binding(b, saved.delivery.bindingId), control = await authority.readControl(b.transaction);
      if (!config || saved.botId !== config.botId || !control.enabled || !bound.target || bound.binding.status !== 'active' || bound.binding.version !== saved.bindingVersion || !saved.callback || signal.aborted) {
        saved.delivery = { ...saved.delivery, status: 'stopped', reason: 'revoked', finishedAt: new Date().toISOString() };
        b.transaction.set(ref, deliveryEnvelope(scope, saved)); return null;
      }
      saved.attempt = randomUUID(); saved.delivery = { ...saved.delivery, status: 'sending', attemptedAt: new Date().toISOString() };
      b.transaction.set(ref, deliveryEnvelope(scope, saved)); return { saved, chatId: bound.target.chatId, callbackToken: saved.callback };
    });
    if (!original) return { state: 'stopped' as const }; if (original.terminal) return { state: original.terminal };
    const authorized = async () => {
      if (signal.aborted) return false;
      const identity = await options.currentAuth(scope.ownerUserId); if (identity.disabled || !identity.emailVerified) return false;
      try { return await authority.runTransaction(scope.ownerUserId, null, async b => {
        const row = await b.transaction.get(data.ref('telegram_deliveries', 'telegram-delivery', id)), current = decode(scope, row, 'telegram-delivery', id, firestoreTelegramDeliverySchema);
        const bound = await binding(b, current.delivery.bindingId);
        return b.generation === job.generation && b.authorizationVersion === job.authorizationVersion && (await authority.readControl(b.transaction)).enabled
          && current.delivery.status === 'sending' && current.attempt === original.saved.attempt && bound.binding.status === 'active'
          && bound.binding.version === current.bindingVersion && bound.botId === config?.botId;
      }); } catch (error) { if (error && typeof error === 'object' && 'status' in error && [403, 404, 409].includes(Number(error.status))) return false; throw error; }
    };
    let result: TelegramSendResult;
    try { result = await options.gateway.send({ chatId: original.chatId, callbackToken: original.callbackToken }, signal, authorized); }
    catch { result = { status: 'unknown', reason: 'transport_unknown', providerStatus: null, messageId: null }; }
    await options.database.runTransaction(async tx => {
      const ref = data.ref('telegram_deliveries', 'telegram-delivery', id), row = await tx.get(ref); if (!row.exists) return;
      const saved = decode(scope, row, 'telegram-delivery', id, firestoreTelegramDeliverySchema);
      if (saved.attempt !== original.saved.attempt || saved.delivery.status !== 'sending') return;
      const bindingRef = data.ref('telegram_bindings', 'telegram-binding', saved.delivery.bindingId), bindingRow = await tx.get(bindingRef);
      const bound = bindingRow.exists ? decode(scope, bindingRow, 'telegram-binding', saved.delivery.bindingId, firestoreTelegramBindingSchema) : null;
      const change = await authority.prepareReceiptChange(tx, scope, randomUUID(), 'preferences');
      if (saved.delivery.acknowledgedAt && ['rejected', 'stopped'].includes(result.status)) result = { status: 'unknown', reason: 'transport_unknown', providerStatus: result.providerStatus, messageId: saved.delivery.messageId };
      change?.commit();
      saved.delivery = { ...saved.delivery, ...result, messageId: saved.delivery.messageId ?? result.messageId,
        finishedAt: new Date().toISOString() }; tx.set(ref, deliveryEnvelope(scope, saved));
      if (result.reason === 'blocked' && bound?.binding.status === 'active' && bound.binding.version === saved.bindingVersion) {
        if (bound.targetHash) tx.delete(data.ref('telegram_pointers', 'telegram-pointer', bound.targetHash));
        bound.target = null; bound.targetHash = null; bound.binding = { ...bound.binding, version: bound.binding.version + 1, status: 'blocked',
          label: '已解除的 Telegram 帳號', chatIdHint: '', updatedAt: new Date().toISOString() }; tx.set(bindingRef, bindingEnvelope(scope, bound));
      }
    });
    return { state: result.status === 'unknown' ? 'unknown' as const : 'completed' as const };
  }
  return { status, mutation, webhook, process, readBinding: binding,
    async prepareInvalidation(b: Pick<Binding, 'scope' | 'transaction'>, id: string, version: number) {
      const ref = data.ref('telegram_bindings', 'telegram-binding', id), row = await b.transaction.get(ref);
      if (!row.exists) return { commit() {} };
      const value = decode(b.scope, row, 'telegram-binding', id, firestoreTelegramBindingSchema);
      if (value.binding.version !== version || value.binding.status !== 'active') return { commit() {} };
      const key = value.targetHash; value.target = null; value.targetHash = null;
      value.binding = { ...value.binding, version: version + 1, status: 'blocked', label: '已解除的 Telegram 帳號', chatIdHint: '', updatedAt: new Date().toISOString() };
      return { commit() { b.transaction.set(ref, bindingEnvelope(b.scope, value)); if (key) b.transaction.delete(data.ref('telegram_pointers', 'telegram-pointer', key)); } };
    },
  };
}
export type FirestoreTelegram = ReturnType<typeof createFirestoreTelegram>;
