import { randomBytes, randomUUID } from 'node:crypto';
import type { DocumentSnapshot, Query } from '@google-cloud/firestore';
import { z } from 'zod';
import { contactBindingSchema, contactConsentInput, contactGrantInput, contactAcknowledgeInput,
  type ContactConsent, type ContactGrant, type ContactRequest, type ContactPage, type ContactAttempt, type ContactBinding } from '../src/shared/contact.ts';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../src/shared/family.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, firestoreTaskSchema, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { workRecoveryScopeSchema, type WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';
import { openRecoveryEnvelope } from './firestore-recovery-envelope.ts';
import { prepareFirestoreBackgroundWork, type FirestoreBackgroundWork } from './firestore-background-work.ts';
import { createFirestoreTaskAgentEvents } from './firestore-task-agent.ts';
import { firestoreNotificationPreferencesSchema, firestoreTaskNotificationOutboxSchema, firestoreTaskReminderBatchSchema } from './firestore-task-worker.ts';
import { reminderDecision, reminderLocalTime, nextReminderCheck } from './task-policy.ts';
import type { FirestoreOnlineMutation } from './firestore-online.ts';
import type { FirestoreAgentRuns } from './firestore-agent-runs.ts';
import type { FirestoreGrowthStore } from './firestore-growth.ts';
import type { FirestoreWebPush } from './firestore-web-push.ts';
import type { FirestoreTelegram } from './firestore-telegram.ts';
import type { WebPushGateway } from './web-push-types.ts';
import type { TelegramGateway, TelegramEvent } from './telegram-types.ts';

const NIL = '00000000-0000-0000-0000-000000000000', uuid = z.uuid(), time = z.iso.datetime({ offset: true }), version = z.number().int().positive();
const consentValue = z.object({ userId: z.string(), version: z.number().int().nonnegative(), enabled: z.boolean(), allowBackup: z.boolean(), bindings: z.array(contactBindingSchema).max(2) }).strict();
export const firestoreContactConsentSchema = z.object({ value: consentValue, authorityVersion: z.string() }).strict();
const grantValue = z.object({ taskId: uuid, version, taskVersion: version, enabled: z.boolean(), primaryUserId: z.string(), backupUserId: z.string().nullable(),
  allowFollowUp: z.boolean(), allowFallback: z.boolean(), validUntil: time, authorizedBy: z.string(), content: z.literal('generic_notice'), trigger: z.literal('task_due'), updatedAt: time }).strict();
export const firestoreContactGrantSchema = z.object({ value: grantValue, authorityVersion: z.string(), consentVersion: z.number().int().nonnegative(), bindings: z.array(contactBindingSchema).max(2) }).strict();
const attemptSchema = z.object({ id: uuid, recipientUserId: z.string(), channel: z.enum(['web_push', 'telegram']), grantVersion: version, taskVersion: version,
  status: z.enum(['sending', 'accepted', 'rejected', 'unknown', 'stopped']), reason: z.string().nullable(), providerStatus: z.number().int().nullable(), messageId: z.number().int().nullable(),
  attemptedAt: time, finishedAt: time.nullable(), acknowledgedAt: time.nullable() }).strict();
const requestSchema = z.object({ id: uuid, taskId: uuid, taskVersion: version, occurrenceId: uuid, phase: z.enum(['initial', 'follow_up']),
  state: z.enum(['pending', 'accepted', 'rejected', 'unknown', 'stopped', 'coalesced']), reason: z.string().nullable(), nextAt: time,
  groupedTo: uuid.nullable(), createdAt: time, attempts: z.array(attemptSchema).max(2) }).strict();
export const firestoreContactRequestSchema = z.object({ request: requestSchema, grant: firestoreContactGrantSchema,
  generation: uuid, authorizationVersion: z.string(), runId: uuid, reminderId: uuid, batchId: uuid, callbackHash: z.string().nullable() }).strict();
const pointerSchema = z.object({ scope: workRecoveryScopeSchema, requestId: uuid, attemptId: uuid, binding: contactBindingSchema, botId: z.string() }).strict();
const dailySchema = z.object({ requestId: uuid, day: z.string(), at: time }).strict();
const updateSchema = z.object({ updateId: z.number().int().nonnegative(), attemptId: uuid }).strict();
type Consent = z.infer<typeof firestoreContactConsentSchema>;
type Grant = z.infer<typeof firestoreContactGrantSchema>;
type Saved = z.infer<typeof firestoreContactRequestSchema>;
const pathPattern = /^\/api\/children\/([0-9a-f-]{36})\/contact\/(?:consent|tasks\/([0-9a-f-]{36})\/authorization|attempts\/([0-9a-f-]{36})\/acknowledge)$/iu;
const evidence = { authorized: true, assigneeEligible: true, deliveryUnknown: false, initialAt: null, followUpAt: null, lastOrdinaryBatchAt: null };
const sameBinding = (a: ContactBinding, b: ContactBinding) => a.channel === b.channel && a.bindingId === b.bindingId && a.bindingVersion === b.bindingVersion;

/** Same consent/grant/provider evidence boundary; P2 owner-only authority never silently invents a second recipient. */
export function createFirestoreContact(options: FirestoreDomainOptions & {
  push: FirestoreWebPush; telegram: FirestoreTelegram; pushGateway: WebPushGateway; telegramGateway: TelegramGateway; telegramBotId: string | null;
  growth: Pick<FirestoreGrowthStore, 'taskAllowedIn'>; runs(): FirestoreAgentRuns;
  currentAuth(userId: string): Promise<{ disabled: boolean; emailVerified: boolean }>;
}) {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options), events = createFirestoreTaskAgentEvents(options);
  const personal = <T extends Pick<Binding, 'scope'>>(b: T): T => ({ ...b, scope: { ...b.scope, childId: NIL } });
  function query(b: Binding, suffix: string): Query { let q: Query = data.collection(suffix); for (const [key, value] of Object.entries(data.tags(b.scope))) q = q.where(key, '==', value); return q; }
  function decode<T>(b: Pick<Binding, 'scope'>, row: DocumentSnapshot, kind: string, id: string, schema: z.ZodType<T>) {
    if (!row.exists || Object.entries(data.tags(b.scope)).some(([k, v]) => row.get(k) !== v)) domainReject('not_found', 404); return data.open(kind, id, b.scope, schema, row);
  }
  const envelope = <T>(b: Pick<Binding, 'scope'>, kind: string, id: string, schema: z.ZodType<T>, value: T, recordVersion = 1, extra = {}) =>
    ({ ...data.tags(b.scope), ...extra, ...data.seal(kind, id, b.scope, schema, value, recordVersion) });
  const consentId = (b: Binding) => JSON.stringify([b.scope.childId, b.scope.ownerUserId]);
  async function consent(b: Binding): Promise<Consent> {
    const id = consentId(b), row = await b.transaction.get(data.ref('contact_consents', 'contact-consent', id));
    return row.exists ? decode(b, row, 'contact-consent', id, firestoreContactConsentSchema)
      : { value: { userId: b.scope.ownerUserId, version: 0, enabled: false, allowBackup: false, bindings: [] }, authorityVersion: b.authorizationVersion };
  }
  async function grant(b: Binding, id: string): Promise<Grant | null> {
    const row = await b.transaction.get(data.ref('contact_grants', 'contact-grant', id)); return row.exists ? decode(b, row, 'contact-grant', id, firestoreContactGrantSchema) : null;
  }
  async function task(b: Binding, id: string) {
    const row = await b.transaction.get(data.ref('tasks', 'task', id)); if (!row.exists) return null;
    const value = decode(b, row, 'task', id, firestoreTaskSchema);
    if (value.id !== id || value.childId !== b.scope.childId || value.version !== row.get('recordVersion')) domainReject('task_binding', 500); return value;
  }
  async function readRequest(b: Binding, id: string) {
    const row = await b.transaction.get(data.ref('contact_requests', 'contact-request', id)); if (!row.exists) return null;
    const value = decode(b, row, 'contact-request', id, firestoreContactRequestSchema);
    if (value.request.id !== id || value.reminderId !== id || row.get('requestId') !== id || row.get('runId') !== value.runId
      || row.get('createdAt') !== value.request.createdAt) domainReject('contact_binding', 500); return value;
  }
  function write(b: Pick<Binding, 'scope' | 'transaction'>, value: Saved) {
    b.transaction.set(data.ref('contact_requests', 'contact-request', value.request.id), envelope(b, 'contact-request', value.request.id, firestoreContactRequestSchema, value, 1,
      { requestId: value.request.id, runId: value.runId, taskId: value.request.taskId, createdAt: value.request.createdAt, attemptIds: value.request.attempts.map(a => a.id),
        unresolved: value.request.attempts.some(a => (a.status === 'sending' || a.status === 'unknown') && !a.acknowledgedAt) }));
  }
  async function activeBinding(b: Binding, link: ContactBinding) {
    const p = personal(b);
    try {
      if (link.channel === 'web_push') {
        const s = await options.push.readBinding(p, link.bindingId);
        return s.input && s.binding.status === 'active' && s.binding.version === link.bindingVersion && s.binding.vapidPublicKey === options.pushGateway.publicKey
          && (!s.binding.expiresAt || Date.parse(s.binding.expiresAt) > Date.now()) ? { channel: 'web_push' as const, subscription: s.input.subscription, label: s.binding.label } : null;
      }
      const s = await options.telegram.readBinding(p, link.bindingId);
      return s.target && s.binding.status === 'active' && s.binding.version === link.bindingVersion && s.botId === options.telegramBotId
        ? { channel: 'telegram' as const, target: s.target, label: s.binding.label } : null;
    } catch (error) { if (error && typeof error === 'object' && 'status' in error && error.status === 404) return null; throw error; }
  }
  async function bindings(b: Binding): Promise<ContactPage['availableBindings']> {
    const p = personal(b), list: ContactPage['availableBindings'] = [];
    const push = await b.transaction.get(query(p, 'push_bindings').where('status', '==', 'active').limit(6));
    if (push.size > 5) domainReject('contact_binding', 500);
    for (const row of push.docs) {
      const link: ContactBinding = { channel: 'web_push', bindingId: row.get('bindingId'), bindingVersion: row.get('recordVersion') }, active = await activeBinding(b, link);
      if (active) list.push({ ...link, label: active.label });
    }
    const telegram = await b.transaction.get(query(p, 'telegram_bindings').where('status', '==', 'active').limit(2));
    if (telegram.size > 1) domainReject('contact_binding', 500);
    for (const row of telegram.docs) {
      const link: ContactBinding = { channel: 'telegram', bindingId: row.get('bindingId'), bindingVersion: row.get('recordVersion') }, active = await activeBinding(b, link);
      if (active) list.push({ ...link, label: active.label });
    }
    return list;
  }
  async function preferences(b: Binding) {
    const p = personal(b), row = await b.transaction.get(data.ref('notification_preferences', 'notification-preferences', b.scope.ownerUserId));
    return row.exists ? decode(p, row, 'notification-preferences', b.scope.ownerUserId, firestoreNotificationPreferencesSchema) : DEFAULT_NOTIFICATION_PREFERENCES;
  }
  async function actionable(b: Binding, taskId: string) {
    if (!(await authority.readControl(b.transaction)).enabled) return null;
    const event = await events.current(b, taskId), g = await grant(b, taskId), c = await consent(b);
    if (!event || !g || !g.value.enabled || g.authorityVersion !== b.authorizationVersion || g.value.taskVersion !== event.task.version
      || g.value.primaryUserId !== b.scope.ownerUserId || event.task.assigneeUserId !== b.scope.ownerUserId || g.value.authorizedBy !== b.scope.ownerUserId
      || Date.parse(g.value.validUntil) <= Date.now() || event.reminder.phase === 'follow_up' && !g.value.allowFollowUp
      || !c.value.enabled || c.authorityVersion !== b.authorizationVersion || c.value.version !== g.consentVersion || !await options.growth.taskAllowedIn(b, taskId)) return null;
    for (const link of g.bindings) if (c.value.bindings.some(v => sameBinding(v, link)) && await activeBinding(b, link)) return { ...event, grant: g, consent: c };
    return null;
  }
  async function validRequest(b: Binding, value: Saved) {
    if (b.generation !== value.generation || b.authorizationVersion !== value.authorizationVersion) return null;
    const now = await actionable(b, value.request.taskId);
    if (!now || now.grant.value.version !== value.grant.value.version || now.task.version !== value.request.taskVersion
      || now.task.occurrence.id !== value.request.occurrenceId || now.reminder.id !== value.reminderId) return null;
    return now;
  }
  async function prepareConsent(b: Binding, raw: unknown) {
    const input = domainParse(contactConsentInput, raw), old = await consent(b), available = await bindings(b);
    if (old.value.version !== input.expectedVersion) domainReject('contact_changed');
    if (input.enabled && input.bindings.some(link => !available.some(v => sameBinding(v, link)))) domainReject('contact_binding_changed');
    const value: ContactConsent = { userId: b.scope.ownerUserId, version: old.value.version + 1, enabled: input.enabled, allowBackup: input.allowBackup, bindings: input.enabled ? input.bindings : [] };
    const saved: Consent = { value, authorityVersion: b.authorizationVersion }, id = consentId(b), revision = JSON.stringify([id, value.version]);
    return { result: { consent: value }, commit() {
      b.transaction.set(data.ref('contact_consents', 'contact-consent', id), envelope(b, 'contact-consent', id, firestoreContactConsentSchema, saved, value.version));
      b.transaction.create(data.ref('contact_consent_revisions', 'contact-consent-revision', revision), envelope(b, 'contact-consent-revision', revision, firestoreContactConsentSchema, saved, value.version));
    } };
  }
  async function prepareGrant(b: Binding, id: string, raw: unknown) {
    const input = domainParse(contactGrantInput, raw), t = await task(b, id), old = await grant(b, id), c = await consent(b);
    if (!t) domainReject('not_found', 404);
    if ((old?.value.version ?? 0) !== input.expectedVersion || t.version !== input.expectedTaskVersion) domainReject('contact_changed');
    if (input.backupUserId !== null || t.assigneeUserId !== b.scope.ownerUserId) domainReject('contact_recipient_unavailable');
    const choices: ContactBinding[] = [];
    if (input.enabled) {
      if (t.occurrence.state !== 'scheduled' || Date.parse(input.validUntil) <= Date.now() || Date.parse(input.validUntil) > Date.now() + 365 * 86400_000) domainReject('contact_scope_invalid');
      if (!c.value.enabled || c.authorityVersion !== b.authorizationVersion) domainReject('contact_consent_required');
      for (const link of c.value.bindings) if (await activeBinding(b, link)) choices.push(link);
      if (!choices.length) domainReject('contact_binding_changed');
    }
    const value: ContactGrant = { taskId: id, version: input.expectedVersion + 1, taskVersion: t.version, enabled: input.enabled, primaryUserId: t.assigneeUserId,
      backupUserId: null, allowFallback: input.allowFallback, allowFollowUp: input.allowFollowUp, validUntil: input.validUntil, authorizedBy: b.scope.ownerUserId,
      content: 'generic_notice', trigger: 'task_due', updatedAt: new Date().toISOString() };
    const saved: Grant = { value, authorityVersion: b.authorizationVersion, consentVersion: c.value.version, bindings: input.allowFallback ? choices : choices.slice(0, 1) };
    const event = input.enabled ? await events.current(b, id) : null;
    const wake = event ? await prepareFirestoreBackgroundWork(data, b.transaction, { kind: 'task-agent', scope: b.scope, resourceId: id,
      basis: event.reminder.id + ':' + value.version, generation: b.generation, authorizationVersion: b.authorizationVersion }, value.updatedAt) : null;
    const revision = JSON.stringify([id, value.version]);
    return { result: { grant: value }, commit() {
      b.transaction.set(data.ref('contact_grants', 'contact-grant', id), envelope(b, 'contact-grant', id, firestoreContactGrantSchema, saved, value.version, { taskId: id }));
      b.transaction.create(data.ref('contact_grant_revisions', 'contact-grant-revision', revision), envelope(b, 'contact-grant-revision', revision, firestoreContactGrantSchema, saved, value.version)); wake?.commit();
    } };
  }
  async function prepareAck(b: Binding, id: string) {
    const rows = await b.transaction.get(query(b, 'contact_requests').where('attemptIds', 'array-contains', id).limit(2));
    if (rows.size !== 1) domainReject('not_found', 404);
    const value = await readRequest(b, rows.docs[0].get('requestId')); if (!value) domainReject('not_found', 404);
    const attempt = value.request.attempts.find(a => a.id === id && a.recipientUserId === b.scope.ownerUserId);
    if (!attempt || !['sending', 'accepted', 'unknown'].includes(attempt.status)) domainReject('not_found', 404);
    attempt.acknowledgedAt ??= new Date().toISOString(); return { result: { acknowledged: true as const }, commit() { write(b, value); } };
  }
  const mutation: FirestoreOnlineMutation = { supports: path => pathPattern.test(path), async prepare(root, submission) {
    const match = pathPattern.exec(submission.path); if (!match) domainReject('not_found', 404);
    const childId = domainParse(uuid, match[1]); if (!await root.readChild(childId)) domainReject('not_found', 404);
    const b: Binding = { ...root, scope: { ...root.scope, childId }, prepareChange: (op, kind, deleted) => root.prepareChange(op, kind, deleted, childId) };
    const prepared = match[2] ? await prepareGrant(b, match[2], submission.payload) : match[3]
      ? (domainParse(contactAcknowledgeInput, submission.payload), await prepareAck(b, match[3])) : await prepareConsent(b, submission.payload);
    const change = await b.prepareChange(submission.operation.opId, 'tasks', false);
    return { childId, changeSeq: change.changeSeq, statusCode: 200, result: prepared.result, commit() { change.commit(); prepared.commit(); } };
  } };
  async function page(userId: string, childId: string): Promise<ContactPage> { return authority.runTransaction(userId, childId, async b => {
    const availableBindings = await bindings(b), own = await consent(b), list = await b.transaction.get(query(b, 'tasks').orderBy('taskId').limit(51));
    const grants = await b.transaction.get(query(b, 'contact_grants').orderBy('taskId').limit(501)); if (grants.size > 500) domainReject('contact_history_requires_review');
    const requests = await b.transaction.get(query(b, 'contact_requests').orderBy('createdAt', 'desc').orderBy('requestId', 'desc').limit(51));
    const enabled = own.value.enabled && own.authorityVersion === b.authorizationVersion;
    return { canManage: true, workerEnabled: (await authority.readControl(b.transaction)).enabled, consent: { ...own.value, enabled }, availableBindings,
      recipients: [{ userId, name: '本人', enabled, allowBackup: own.value.allowBackup, channels: own.value.bindings.map(v => v.channel) }],
      tasks: list.docs.slice(0, 50).map(row => decode(b, row, 'task', row.get('taskId'), firestoreTaskSchema)), tasksHaveMore: list.size > 50,
      grants: grants.docs.map(row => { const g = decode(b, row, 'contact-grant', row.get('taskId'), firestoreContactGrantSchema); return { ...g.value, enabled: g.value.enabled && g.authorityVersion === b.authorizationVersion }; }),
      requests: requests.docs.slice(0, 50).map(row => decode(b, row, 'contact-request', row.get('requestId'), firestoreContactRequestSchema).request), historyLimited: requests.size > 50 };
  }); }
  async function recorded(b: Binding, runId: string) {
    const rows = await b.transaction.get(query(b, 'contact_requests').where('runId', '==', runId).limit(8));
    return rows.docs.map(row => { const value = decode(b, row, 'contact-request', row.get('requestId'), firestoreContactRequestSchema); if (value.runId !== runId) domainReject('contact_binding', 500); return value.request.id; });
  }
  async function contactOptions(userId: string, childId: string, taskId: string) { return authority.runTransaction(userId, childId, async b => {
    const value = await actionable(b, taskId); if (!value) return { eligible: false as const, reason: 'Explicit current task grant, recipient consent, due event and applicable source are required.' };
    const existing = await readRequest(b, value.reminder.id);
    return { eligible: true as const, taskId, taskVersion: value.task.version, grantVersion: value.grant.value.version, recipientUserId: b.scope.ownerUserId,
      selectionReason: 'Explicit task assignee and current personal consent.', existing: existing?.request ?? null };
  }); }
  async function request(userId: string, childId: string, input: { taskId: string; taskVersion: number; grantVersion: number; recipientUserId: string; runId: string }) {
    return authority.runTransaction(userId, childId, async b => {
      const runs = options.runs(), run = await runs.requireLive(b, runs.current(b), input.runId), value = await actionable(b, input.taskId);
      if (!value || value.task.version !== input.taskVersion || value.grant.value.version !== input.grantVersion || input.recipientUserId !== userId) domainReject('contact_authorization_required');
      const prior = await readRequest(b, value.reminder.id); if (prior) return prior.request;
      const at = new Date().toISOString(), id = value.reminder.id, nextAt = new Date(Date.now() + 30_000).toISOString();
      const saved: Saved = { request: { id, taskId: input.taskId, taskVersion: value.task.version, occurrenceId: value.task.occurrence.id,
        phase: value.reminder.phase, state: 'pending', reason: null, nextAt, groupedTo: null, createdAt: at, attempts: [] }, grant: value.grant,
        generation: b.generation, authorizationVersion: b.authorizationVersion, runId: input.runId, reminderId: id, batchId: value.reminder.batchId, callbackHash: null };
      const queued = await prepareFirestoreBackgroundWork(data, b.transaction, { kind: 'contact', scope: b.scope, resourceId: id, basis: id,
        generation: b.generation, authorizationVersion: b.authorizationVersion }, nextAt);
      const change = await b.prepareChange(randomUUID(), 'tasks', false);
      change.commit(); write(b, saved); queued.commit(); runs.advance(b, run, change.changeSeq); return saved.request;
    });
  }
  async function process(job: FirestoreBackgroundWork, signal: AbortSignal) {
    if (job.kind !== 'contact') domainReject('invalid_scope', 400);
    const { scope } = job;
    const started = await authority.runTransaction(scope.ownerUserId, scope.childId, async b => {
      if (firestoreDomainHash(scope) !== firestoreDomainHash(b.scope) || job.generation !== b.generation || job.authorizationVersion !== b.authorizationVersion) return null;
      const saved = await readRequest(b, job.resourceId); if (!saved) return null;
      if (saved.request.state !== 'pending') return { terminal: saved.request.state === 'unknown' ? 'unknown' as const : 'completed' as const };
      const stop = async (reason: string, unknown = false) => {
        saved.request.state = unknown ? 'unknown' : 'stopped'; saved.request.reason = reason;
        const change = await b.prepareChange(randomUUID(), 'tasks', false); change.commit(); write(b, saved); return { terminal: unknown ? 'unknown' as const : 'stopped' as const };
      };
      if (saved.request.attempts.some(a => a.status === 'sending')) {
        for (const a of saved.request.attempts) if (a.status === 'sending') { a.status = 'unknown'; a.reason = 'worker_interrupted'; a.finishedAt = new Date().toISOString(); }
        return stop('worker_interrupted', true);
      }
      const current = await validRequest(b, saved); if (!current || signal.aborted) return stop('authorization_or_task_changed');
      const unknown = await b.transaction.get(query(b, 'contact_requests').where('taskId', '==', saved.request.taskId).where('unresolved', '==', true).limit(1));
      if (!unknown.empty) return stop('earlier_delivery_unknown');
      const prefs = await preferences(b), now = new Date().toISOString(), decision = reminderDecision(current.task, prefs, evidence, now);
      if (decision === 'quiet' || decision === 'not_due') {
        const nextAt = nextReminderCheck(current.task, prefs, evidence, now);
        if (!nextAt || Date.parse(nextAt) >= Date.parse(saved.grant.value.validUntil)) return stop('authorization_expired');
        saved.request.nextAt = nextAt; write(b, saved); return { nextAt };
      }
      if (decision !== 'initial') return stop('reminder_not_allowed');
      const position = saved.request.attempts.length, link = saved.grant.bindings[position]; if (!link) return stop('fallback_exhausted');
      const active = await activeBinding(b, link);
      const day = reminderLocalTime(now, prefs.timeZone).day, dailyId = JSON.stringify([scope.ownerUserId, day]), dailyRef = data.ref('contact_daily_slots', 'contact-daily-slot', dailyId);
      const slotRow = current.task.kind === 'ordinary' ? await b.transaction.get(dailyRef) : null;
      const slot = slotRow?.exists ? decode(personal(b), slotRow, 'contact-daily-slot', dailyId, dailySchema) : null;
      if (slot && slot.requestId !== saved.request.id) {
        saved.request.state = 'coalesced'; saved.request.reason = 'daily_slot_already_used'; saved.request.groupedTo = slot.requestId;
        const change = await b.prepareChange(randomUUID(), 'tasks', false); change.commit(); write(b, saved); return { terminal: 'completed' as const };
      }
      const batchRef = data.ref('task_reminder_batches', 'task-reminder-batch', saved.batchId), batchRow = await b.transaction.get(batchRef);
      const batch = batchRow.exists ? decode(personal(b), batchRow, 'task-reminder-batch', saved.batchId, firestoreTaskReminderBatchSchema) : null;
      const attempt: ContactAttempt = { id: randomUUID(), recipientUserId: scope.ownerUserId, channel: link.channel, grantVersion: saved.grant.value.version,
        taskVersion: saved.request.taskVersion, status: 'sending', reason: null, providerStatus: null, messageId: null, attemptedAt: now, finishedAt: null, acknowledgedAt: null };
      const token = link.channel === 'telegram' ? randomBytes(24).toString('base64url') : null;
      const callbackHash = token ? firestoreDomainHash([options.telegramBotId, token]) : null;
      saved.request.attempts.push(attempt); saved.callbackHash = callbackHash;
      const change = await b.prepareChange(randomUUID(), 'tasks', false); change.commit(); write(b, saved);
      if (current.task.kind === 'ordinary') b.transaction.set(dailyRef, envelope(personal(b), 'contact-daily-slot', dailyId, dailySchema, { requestId: saved.request.id, day, at: now }));
      if (batch && current.task.kind === 'ordinary') b.transaction.set(batchRef, envelope(personal(b), 'task-reminder-batch', saved.batchId, firestoreTaskReminderBatchSchema, { ...batch, state: 'sealed' }));
      if (callbackHash) b.transaction.create(data.ref('contact_callbacks', 'contact-callback', callbackHash), envelope(b, 'contact-callback', callbackHash, pointerSchema,
        { scope: b.scope, requestId: saved.request.id, attemptId: attempt.id, binding: link, botId: options.telegramBotId! }));
      return { saved, attempt, link, active, token };
    });
    if (!started) return { state: 'stopped' as const }; if (started.terminal) return { state: started.terminal };
    if (started.nextAt) return { state: 'deferred' as const, nextAt: started.nextAt };
    if (!started.saved || !started.attempt || !started.link) domainReject('contact_binding', 500);
    const { saved, attempt, link } = started;
    const authorized = async () => {
      if (signal.aborted) return false; const auth = await options.currentAuth(scope.ownerUserId); if (auth.disabled || !auth.emailVerified) return false;
      try { return await authority.runTransaction(scope.ownerUserId, scope.childId, async b => {
        const current = await readRequest(b, saved.request.id); if (!current || current.request.state !== 'pending') return false;
        const valid = await validRequest(b, current), a = current.request.attempts.find(a => a.id === attempt.id);
        return !!valid && a?.status === 'sending' && !!await activeBinding(b, link) && reminderDecision(valid.task, await preferences(b), evidence, new Date().toISOString()) === 'initial';
      }); } catch (error) { if (error && typeof error === 'object' && 'status' in error && [403, 404, 409].includes(Number(error.status))) return false; throw error; }
    };
    let result: { status: 'accepted' | 'rejected' | 'unknown' | 'stopped'; reason: string | null; providerStatus: number | null; messageId?: number | null };
    if (!started.active) result = { status: 'rejected', reason: 'binding_unavailable', providerStatus: null };
    else try {
      result = started.active.channel === 'web_push' ? await options.pushGateway.send(started.active.subscription,
        { v: 1, kind: 'care', bindingId: link.bindingId, bindingVersion: link.bindingVersion, deliveryId: attempt.id }, signal, authorized)
        : await options.telegramGateway.send({ chatId: started.active.target.chatId, callbackToken: started.token!, kind: 'care' }, signal, authorized);
    } catch { result = { status: 'unknown', reason: 'transport_unknown', providerStatus: null }; }
    // The provider receipt remains recordable after revocation. No new authority or effect is created here.
    await options.database.runTransaction(async tx => {
      const b = { scope, transaction: tx }, ref = data.ref('contact_requests', 'contact-request', saved.request.id), row = await tx.get(ref); if (!row.exists) return;
      const current = decode(b, row, 'contact-request', saved.request.id, firestoreContactRequestSchema), a = current.request.attempts.find(v => v.id === attempt.id);
      if (!a || a.status !== 'sending') return;
      const noticeRef = data.ref('notification_outbox', 'task-notification-outbox', current.reminderId), noticeRow = await tx.get(noticeRef);
      const notice = noticeRow.exists ? decode(b, noticeRow, 'task-notification-outbox', current.reminderId, firestoreTaskNotificationOutboxSchema) : null;
      const invalidation = result.reason === 'subscription_expired' && link.channel === 'web_push'
        ? await options.push.prepareInvalidation(personal(b), link.bindingId, link.bindingVersion)
        : result.reason === 'blocked' && link.channel === 'telegram' ? await options.telegram.prepareInvalidation(personal(b), link.bindingId, link.bindingVersion) : null;
      const change = await authority.prepareReceiptChange(tx, scope, randomUUID(), 'tasks');
      if (a.acknowledgedAt && (result.status === 'rejected' || result.status === 'stopped')) result = { ...result, status: 'unknown', reason: 'receipt_without_provider_confirmation' };
      Object.assign(a, result, { messageId: a.messageId ?? result.messageId ?? null, finishedAt: new Date().toISOString() });
      const fallback = result.status === 'rejected' && current.grant.value.allowFallback && current.request.attempts.length < current.grant.bindings.length;
      current.request.state = fallback ? 'pending' : result.status; current.request.reason = result.reason;
      change?.commit(); invalidation?.commit();
      current.request.nextAt = new Date(Date.now() + 1000).toISOString(); write(b, current);
      if (notice) tx.set(noticeRef, envelope(b, 'task-notification-outbox', current.reminderId, firestoreTaskNotificationOutboxSchema,
        { ...notice, state: result.status === 'accepted' ? 'delivered' : result.status === 'unknown' ? 'unknown' : fallback ? 'pending' : 'cancelled' }, notice.taskVersion, { state: result.status === 'unknown' ? 'unknown' : result.status === 'accepted' ? 'delivered' : fallback ? 'pending' : 'cancelled' }));
    });
    const latest = await authority.runTransaction(scope.ownerUserId, scope.childId, b => readRequest(b, saved.request.id));
    return latest?.request.state === 'pending' ? { state: 'deferred' as const, nextAt: latest.request.nextAt }
      : { state: result.status === 'unknown' ? 'unknown' as const : 'completed' as const };
  }
  async function telegramAcknowledgement(event: Extract<TelegramEvent, { kind: 'contact_ack' }>) {
    if (!options.telegramBotId) return null;
    const key = firestoreDomainHash([options.telegramBotId, event.token]), ref = data.ref('contact_callbacks', 'contact-callback', key), row = await ref.get(); if (!row.exists) return null;
    const raw = row.data()!, recovered = openRecoveryEnvelope({ ...options, locator: raw.recovery, envelope: { family: 'domain', version: raw.version, recordVersion: raw.recordVersion, ciphertext: raw.ciphertext } });
    if (recovered.context.kind !== 'contact-callback' || recovered.context.id !== key) domainReject('contact_binding', 500);
    const pointer = decode({ scope: recovered.context.scope }, row, 'contact-callback', key, pointerSchema);
    if (firestoreDomainHash(pointer.scope) !== firestoreDomainHash(recovered.context.scope) || pointer.botId !== options.telegramBotId) domainReject('contact_binding', 500);
    try { return await authority.runTransaction(pointer.scope.ownerUserId, pointer.scope.childId, async b => {
      if (firestoreDomainHash(pointer.scope) !== firestoreDomainHash(b.scope)) return null;
      const current = await readRequest(b, pointer.requestId), active = await activeBinding(b, pointer.binding);
      const a = current?.request.attempts.find(v => v.id === pointer.attemptId);
      if (!current || current.callbackHash !== key || !a || !['sending', 'accepted', 'unknown'].includes(a.status) || a.messageId !== null && a.messageId !== event.messageId
        || active?.channel !== 'telegram' || active.target.chatId !== event.chatId || active.target.senderId !== event.senderId) return null;
      const id = JSON.stringify([options.telegramBotId, event.updateId]), updateRef = data.ref('contact_updates', 'contact-update', id);
      if ((await b.transaction.get(updateRef)).exists) return event.callbackQueryId;
      a.acknowledgedAt ??= new Date().toISOString(); a.messageId ??= event.messageId;
      const change = await b.prepareChange(randomUUID(), 'tasks', false); change.commit(); write(b, current);
      b.transaction.create(updateRef, envelope(b, 'contact-update', id, updateSchema, { updateId: event.updateId, attemptId: a.id })); return event.callbackQueryId;
    }); } catch (error) { if (error && typeof error === 'object' && 'status' in error && [403, 404, 409].includes(Number(error.status))) return null; throw error; }
  }
  return { page, mutation, options: contactOptions, request, process, recorded,
    recordedForRun: (u: string, c: string, run: string) => authority.runTransaction(u, c, b => recorded(b, run)), telegramAcknowledgement };
}
export type FirestoreContact = ReturnType<typeof createFirestoreContact>;
