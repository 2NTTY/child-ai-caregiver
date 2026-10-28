import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CareTask, TaskReminder, TaskWorkState } from '../src/shared/tasks.ts';
import { taskTimeZoneSchema } from '../src/shared/tasks.ts';
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from '../src/shared/family.ts';
import { nextReminderCheck, reminderDecision, reminderLocalTime } from './task-policy.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, firestoreReminderOutboxId, firestoreReminderOutboxSchema,
  firestoreTaskSchema, firestoreTaskStorageSchema, firestoreTaskRevisionStorageSchema, sealFirestoreReminderOutbox, type FirestoreDomainOptions, type FirestoreReminderOutbox } from './firestore-domain-data.ts';
import { validTaskAttribution, validTaskRevisionAttribution } from './firestore-task-records.ts';
import { createFirestoreTaskExecution } from './firestore-task-execution.ts';
import { workRecoveryScopeSchema, type WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';
import { prepareFirestoreBackgroundWork } from './firestore-background-work.ts';

const uuid = z.uuid(), version = z.number().int().positive().max(2147483647), datetime = z.iso.datetime({ offset: true });
const decimal = firestoreReminderOutboxSchema.shape.authorizationVersion, NIL = '00000000-0000-0000-0000-000000000000';
export const firestoreTaskDeliverySchema = z.object({ kind: z.literal('task-reminder'), scope: workRecoveryScopeSchema,
  taskId: uuid, occurrenceId: uuid, taskVersion: version, authorizationVersion: decimal, generation: uuid, scheduledAt: datetime }).strict();
export type FirestoreTaskDelivery = z.infer<typeof firestoreTaskDeliverySchema>;
export const firestoreNotificationPreferencesSchema = z.object({ timeZone: taskTimeZoneSchema,
  quietStart: z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/u), quietEnd: z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/u),
  allowAppointmentDuringQuiet: z.boolean(), version }).strict();
export const firestoreTaskReminderSchema: z.ZodType<TaskReminder> = z.object({ id: uuid, batchId: uuid, taskId: uuid,
  occurrenceId: uuid, taskVersion: version, phase: z.enum(['initial', 'follow_up']), createdAt: datetime }).strict();
export const firestoreTaskReminderBatchSchema = z.object({ id: uuid, recipientUserId: z.string().min(1).max(256),
  category: z.enum(['ordinary', 'appointment']), key: z.string().min(1).max(128), state: z.enum(['open', 'sealed']), createdAt: datetime }).strict();
export const firestoreTaskNotificationOutboxSchema = z.object({ id: uuid, reminderId: uuid, taskId: uuid, occurrenceId: uuid,
  taskVersion: version, recipientUserId: z.string().min(1).max(256), createdAt: datetime,
  state: z.enum(['pending', 'leased', 'delivered', 'unknown', 'cancelled']) }).strict();
export interface FirestoreTaskCurrentAuth { userId: string; disabled: boolean; emailVerified: boolean; email: string | null }
export interface FirestoreTaskWorkerOptions extends FirestoreDomainOptions {
  enabled: boolean;
  currentAuth(userId: string): Promise<FirestoreTaskCurrentAuth>;
  serverClock?: () => number;
}
export type FirestoreTaskResult = { state: 'processed' | 'deferred' | 'not_due' | 'busy' | 'stale' | 'stopped' | 'failed' | 'unknown' | 'disabled';
  receipt: TaskReminder | null; nextAt: string | null };
export type FirestoreTaskClaim = FirestoreTaskResult | { state: 'claimed'; lease: NonNullable<FirestoreReminderOutbox['lease']> };
export interface FirestoreTaskWorker {
  claim(job: FirestoreTaskDelivery): Promise<FirestoreTaskClaim>;
  complete(job: FirestoreTaskDelivery, lease: NonNullable<FirestoreReminderOutbox['lease']>): Promise<FirestoreTaskResult>;
  process(job: FirestoreTaskDelivery): Promise<FirestoreTaskResult>;
  due(userId: string, childId: string, limit?: number): Promise<FirestoreTaskDelivery[]>;
  dispatchTransaction<T>(job: FirestoreTaskDelivery, mode: 'enqueue' | 'settle',
    visit: (binding: FirestoreAuthorityTransaction, work: FirestoreReminderOutbox) => Promise<T>): Promise<FirestoreTaskResult | { state: 'ready'; value: T }>;
  view(binding: FirestoreAuthorityTransaction, taskIds: string[]): Promise<{ reminders: TaskReminder[]; work: TaskWorkState[]; workerEnabled: boolean }>;
}
function stableUuid(value: unknown): string {
  const hex = firestoreDomainHash(value).slice(0, 32);
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-5' + hex.slice(13, 16) + '-8' + hex.slice(17, 20) + '-' + hex.slice(20);
}
/** Stable effect identity survives restoration; authority and envelopes still bind the current epoch. */
export function firestoreTaskStableScope(scope: WorkRecoveryScope): Pick<WorkRecoveryScope, 'ownerUserId' | 'workspaceId' | 'childId'> {
  return { ownerUserId: scope.ownerUserId, workspaceId: scope.workspaceId, childId: scope.childId };
}
export function firestoreTaskReminderId(scope: WorkRecoveryScope, occurrenceId: string, phase: TaskReminder['phase']): string {
  return stableUuid(['task-reminder', firestoreTaskStableScope(scope), occurrenceId, phase]);
}
export function firestoreTaskReminderBatchId(scope: WorkRecoveryScope, category: CareTask['kind'], key: string): string {
  return stableUuid(['task-batch', firestoreTaskStableScope(scope), category, key]);
}
export function firestoreTaskRecipientBatchKey(scope: WorkRecoveryScope, recipientUserId: string, key: string): string {
  return scope.ownerUserId === 'space:' + scope.workspaceId ? firestoreDomainHash(recipientUserId) + ':' + key : key;
}
const result = (state: FirestoreTaskResult['state'], receipt: TaskReminder | null = null, nextAt: string | null = null): FirestoreTaskResult => ({ state, receipt, nextAt });

/** F02 persists authorized reminders and delivery intents; this consumer never sends a notification or runs a model. */
export function createFirestoreTaskWorker(options: FirestoreTaskWorkerOptions): FirestoreTaskWorker {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options);
  if (typeof options.enabled !== 'boolean' || typeof options.currentAuth !== 'function'
    || options.serverClock !== undefined && typeof options.serverClock !== 'function') domainReject('configuration', 500);
  const now = () => {
    const at = (options.serverClock ?? Date.now)();
    if (!Number.isSafeInteger(at) || at < 0 || at > 253402271909999) domainReject('clock', 500);
    return at;
  };
  const ownerScope = (scope: WorkRecoveryScope) => ({ ...scope, childId: NIL });
  const matchTags = (raw: any, scope: WorkRecoveryScope) => {
    const tags = data.tags(scope);
    for (const [key, value] of Object.entries(tags)) if (raw?.[key] !== value) domainReject('task_projection_binding', 500);
  };
  async function currentAuth(userId: string) {
    let current: FirestoreTaskCurrentAuth;
    try { current = await options.currentAuth(userId); } catch { domainReject('task_auth_unavailable', 503); }
    if (!current || current.userId !== userId || typeof current.disabled !== 'boolean' || typeof current.emailVerified !== 'boolean') domainReject('task_auth_unavailable', 503);
    const email = z.email().max(320).safeParse(current.email);
    if (current.disabled || !current.emailVerified || !email.success) domainReject('task_auth_denied', 403);
    return email.data.trim().toLowerCase();
  }
  const execute = createFirestoreTaskExecution(options, currentAuth);
  function bindingMatches(binding: FirestoreAuthorityTransaction, job: FirestoreTaskDelivery) {
    if (firestoreDomainHash(binding.scope) !== firestoreDomainHash(job.scope) || binding.authorizationVersion !== job.authorizationVersion
      || binding.generation !== job.generation) domainReject('task_scope_changed');
  }
  async function task(binding: FirestoreAuthorityTransaction, taskId: string): Promise<CareTask | null> {
    const snapshot = await binding.transaction.get(data.ref('tasks', 'task', taskId));
    if (!snapshot.exists) return null;
    matchTags(snapshot.data(), binding.scope);
    const value = data.open('task', taskId, binding.scope, firestoreTaskStorageSchema, snapshot);
    if (value.id !== taskId || !validTaskAttribution(value, binding.scope) || value.version !== snapshot.get('recordVersion')) domainReject('task_binding', 500);
    return firestoreTaskSchema.parse(value);
  }
  async function outbox(binding: FirestoreAuthorityTransaction, taskId: string, taskVersion: number) {
    const id = firestoreReminderOutboxId(taskId, taskVersion), ref = data.ref('task_outbox', 'task-reminder-outbox', id);
    const snapshot = await binding.transaction.get(ref);
    if (!snapshot.exists) return null;
    matchTags(snapshot.data(), binding.scope);
    const value = data.open('task-reminder-outbox', id, binding.scope, firestoreReminderOutboxSchema, snapshot), raw = snapshot.data();
    if (value.taskId !== taskId || value.taskVersion !== taskVersion || value.ownerUserId !== binding.scope.ownerUserId
      || value.workspaceId !== binding.scope.workspaceId || value.childId !== binding.scope.childId || value.storageEpoch !== binding.scope.storageEpoch
      || value.taskVersion !== raw?.recordVersion || value.taskId !== raw?.taskId || value.occurrenceId !== raw?.occurrenceId
      || value.taskVersion !== raw?.taskVersion || value.state !== raw?.state || value.dueAt !== raw?.dueAt
      || (value.lease?.until ?? null) !== raw?.leaseUntil) domainReject('outbox_binding', 500);
    return { id, ref, value };
  }
  const sealOutbox = (scope: WorkRecoveryScope, value: FirestoreReminderOutbox) => sealFirestoreReminderOutbox(data, scope, value);
  async function reminders(binding: FirestoreAuthorityTransaction, taskId: string, occurrenceId: string, maximumVersion: number) {
    const values: TaskReminder[] = [], notifications: z.infer<typeof firestoreTaskNotificationOutboxSchema>[] = [];
    for (const phase of ['initial', 'follow_up'] as const) {
      const id = firestoreTaskReminderId(binding.scope, occurrenceId, phase), snapshot = await binding.transaction.get(data.ref('task_reminders', 'task-reminder', id));
      if (!snapshot.exists) continue;
      matchTags(snapshot.data(), binding.scope);
      const value = data.open('task-reminder', id, binding.scope, firestoreTaskReminderSchema, snapshot);
      if (value.id !== id || value.taskId !== taskId || value.occurrenceId !== occurrenceId || value.phase !== phase
        || value.taskVersion > maximumVersion || value.taskVersion !== snapshot.get('recordVersion')) domainReject('reminder_binding', 500);
      const notificationSnapshot = await binding.transaction.get(data.ref('notification_outbox', 'task-notification-outbox', id));
      if (!notificationSnapshot.exists) domainReject('notification_outbox_missing', 500);
      matchTags(notificationSnapshot.data(), binding.scope);
      const notification = data.open('task-notification-outbox', id, binding.scope, firestoreTaskNotificationOutboxSchema, notificationSnapshot);
      let recipient = binding.scope.ownerUserId;
      if (recipient.startsWith('space:')) {
        const revisionId=JSON.stringify([taskId,value.taskVersion]);
        const revision=await binding.transaction.get(data.ref('task_revisions','task-revision',revisionId));
        matchTags(revision.data(),binding.scope);
        const saved=data.open('task-revision',revisionId,binding.scope,firestoreTaskRevisionStorageSchema,revision);
        if(saved.task.id!==taskId||saved.task.version!==value.taskVersion||revision.get('recordVersion')!==value.taskVersion
          ||!validTaskRevisionAttribution(saved,binding.scope))domainReject('reminder_binding',500);
        recipient=saved.task.assigneeUserId;
      }
      if (notification.id !== id || notification.reminderId !== id || notification.taskId !== taskId || notification.occurrenceId !== occurrenceId
        || notification.taskVersion !== value.taskVersion || notification.recipientUserId !== recipient
        || notification.createdAt !== value.createdAt || notification.taskVersion !== notificationSnapshot.get('recordVersion')) domainReject('notification_binding', 500);
      values.push(value); notifications.push(notification);
    }
    return { values, notifications };
  }
  async function preferences(binding: FirestoreAuthorityTransaction): Promise<NotificationPreferences> {
    const scope = ownerScope(binding.scope), id = scope.ownerUserId, snapshot = await binding.transaction.get(data.ref('notification_preferences', 'notification-preferences', id));
    if (!snapshot.exists) return { ...DEFAULT_NOTIFICATION_PREFERENCES };
    matchTags(snapshot.data(), scope);
    const value = data.open('notification-preferences', id, scope, firestoreNotificationPreferencesSchema, snapshot);
    if (value.version !== snapshot.get('recordVersion')) domainReject('preferences_binding', 500);
    return value;
  }
  const jobMatches = (job: FirestoreTaskDelivery, value: FirestoreReminderOutbox) => {
    if (value.occurrenceId !== job.occurrenceId || value.authorizationVersion !== job.authorizationVersion || value.generation !== job.generation) domainReject('outbox_binding');
  };
  const currentTask = (value: CareTask | null, work: FirestoreReminderOutbox) => value && value.version === work.taskVersion
    && value.occurrence.id === work.occurrenceId && value.occurrence.state === 'scheduled';
  async function transition(binding: FirestoreAuthorityTransaction, value: FirestoreReminderOutbox, state: FirestoreReminderOutbox['state'], operationId: string) {
    const changed = { ...value, state, lease: null }, prepared = await binding.prepareChange(operationId, 'tasks', false);
    const envelope = sealOutbox(binding.scope, changed);
    prepared.commit(); binding.transaction.set(data.ref('task_outbox', 'task-reminder-outbox', firestoreReminderOutboxId(value.taskId, value.taskVersion)), envelope);
  }
  const worker: FirestoreTaskWorker = {
    async claim(raw) {
      const job = domainParse(firestoreTaskDeliverySchema, raw);
      if (!options.enabled) return result('disabled');
      const token = randomUUID(), transitionId = stableUuid(['task-work', job.scope, job.taskId, job.taskVersion, token]);
      return execute(job, async binding => {
        const at = now(), until = new Date(at + 30_000).toISOString();
        bindingMatches(binding, job);
        const row = await outbox(binding, job.taskId, job.taskVersion);
        if (!row) return result('stopped'); jobMatches(job, row.value);
        const work = row.value;
        if (work.state === 'unknown') return result('unknown');
        if (work.state === 'cancelled' || work.state === 'failed') return result(work.state === 'failed' ? 'failed' : 'stopped');
        if (work.state === 'processed') {
          const prior = await reminders(binding, work.taskId, work.occurrenceId, work.taskVersion);
          return result('processed', prior.values.at(-1) ?? null);
        }
        const current = await task(binding, work.taskId);
        if (!currentTask(current, work)) { await transition(binding, work, 'cancelled', transitionId); return result('stopped'); }
        if (work.state === 'leased' && !work.lease || work.state === 'pending' && work.lease) domainReject('outbox_binding', 500);
        if (work.lease && work.lease.generation !== binding.generation) domainReject('task_scope_changed');
        if (work.state === 'leased' && work.lease && Date.parse(work.lease.until) > at) return result('busy', null, work.lease.until);
        const failures = Math.min(3, work.failures + (work.state === 'leased' ? 1 : 0));
        if (failures >= 3) { await transition(binding, { ...work, failures }, 'failed', transitionId); return result('failed'); }
        if (Date.parse(work.dueAt) > at || Date.parse(current!.occurrence.dueAt) > at) return result('not_due', null, work.dueAt);
        const lease = { token, generation: binding.generation, until }, changed = { ...work, state: 'leased' as const, attempts: work.attempts + 1, failures, lease };
        binding.transaction.set(row.ref, sealOutbox(binding.scope, changed));
        return { state: 'claimed' as const, lease };
      });
    },
    async complete(raw, rawLease) {
      const job = domainParse(firestoreTaskDeliverySchema, raw), lease = domainParse(firestoreReminderOutboxSchema.shape.lease.unwrap(), rawLease);
      if (!options.enabled) return result('disabled');
      const changeId = stableUuid(['task-check', job.scope, job.taskId, job.taskVersion, lease.token]);
      return execute(job, async (binding, recipient) => {
        const at = now(), instant = new Date(at).toISOString();
        bindingMatches(binding, job);
        const row = await outbox(binding, job.taskId, job.taskVersion);
        if (!row) return result('stopped'); jobMatches(job, row.value);
        const work = row.value;
        if (work.state === 'unknown') return result('unknown');
        if (work.state === 'cancelled' || work.state === 'failed') return result(work.state === 'failed' ? 'failed' : 'stopped');
        const prior = await reminders(binding, work.taskId, work.occurrenceId, work.taskVersion);
        if (work.state === 'processed') return result('processed', prior.values.at(-1) ?? null);
        if (work.state !== 'leased' || !work.lease || work.lease.token !== lease.token || work.lease.generation !== lease.generation
          || work.lease.until !== lease.until || lease.generation !== binding.generation || Date.parse(lease.until) <= at) return result('stale');
        const current = await task(binding, work.taskId);
        if (!currentTask(current, work)) { await transition(binding, work, 'cancelled', changeId); return result('stopped'); }
        if (Date.parse(work.dueAt) > at || Date.parse(current!.occurrence.dueAt) > at) return result('not_due', null, work.dueAt);
        const prefs = await preferences(recipient), recipientScope = ownerScope(binding.scope), category = current!.kind;
        const baseKey = category === 'ordinary' ? reminderLocalTime(instant, prefs.timeZone).day : work.occurrenceId;
        const key = firestoreTaskRecipientBatchKey(binding.scope, recipient.actorUserId, baseKey);
        const batchId = firestoreTaskReminderBatchId(recipientScope, category, key), batchRef = data.ref('task_reminder_batches', 'task-reminder-batch', batchId);
        const batchSnapshot = await binding.transaction.get(batchRef);
        let batch: z.infer<typeof firestoreTaskReminderBatchSchema> | null = null;
        if (batchSnapshot.exists) {
          matchTags(batchSnapshot.data(), recipientScope);
          batch = data.open('task-reminder-batch', batchId, recipientScope, firestoreTaskReminderBatchSchema, batchSnapshot);
          if (batch.id !== batchId || batch.recipientUserId !== recipient.actorUserId || batch.category !== category || batch.key !== key) domainReject('batch_binding', 500);
        }
        const evidence = { authorized: true, assigneeEligible: current!.assigneeUserId === recipient.actorUserId,
          deliveryUnknown: prior.notifications.some(value => value.state === 'unknown'),
          initialAt: prior.values.find(value => value.phase === 'initial')?.createdAt ?? null,
          followUpAt: prior.values.find(value => value.phase === 'follow_up')?.createdAt ?? null,
          lastOrdinaryBatchAt: category === 'ordinary' && batch?.state === 'sealed' ? batch.createdAt : null };
        const decision = reminderDecision(current!, prefs, evidence, instant);
        const phase = decision === 'initial' || decision === 'follow_up' ? decision : null;
        let receipt: TaskReminder | null = prior.values.at(-1) ?? null;
        if (phase) receipt = { id: firestoreTaskReminderId(binding.scope, work.occurrenceId, phase), batchId, taskId: work.taskId,
          occurrenceId: work.occurrenceId, taskVersion: work.taskVersion, phase, createdAt: instant };
        const nextAt = phase === 'follow_up' || category === 'appointment' && phase === 'initial' ? null
          : nextReminderCheck(current!, prefs, phase === 'initial' ? { ...evidence, initialAt: instant } : evidence, instant);
        const state = decision === 'unknown' ? 'unknown' : nextAt ? 'pending' : 'processed';
        const changed = { ...work, state: state as FirestoreReminderOutbox['state'], lease: null, ...(nextAt ? { dueAt: nextAt } : {}) };
        const prepared = await binding.prepareChange(changeId, 'tasks', false);
        const background = phase && !binding.sharedAccess?.classMember ? await prepareFirestoreBackgroundWork(data, binding.transaction, { kind: 'task-agent', scope: binding.scope,
          resourceId: work.taskId, basis: receipt!.id, generation: binding.generation, authorizationVersion: binding.authorizationVersion }, instant) : null;
        const workEnvelope = sealOutbox(binding.scope, changed);
        const batchValue = phase && !batch ? { id: batchId, recipientUserId: recipient.actorUserId, category, key, state: 'open' as const, createdAt: instant } : null;
        const batchEnvelope = batchValue ? { ...data.tags(recipientScope), ...data.seal('task-reminder-batch', batchId, recipientScope, firestoreTaskReminderBatchSchema, batchValue) } : null;
        const notification = phase ? { id: receipt!.id, reminderId: receipt!.id, taskId: work.taskId, occurrenceId: work.occurrenceId,
          taskVersion: work.taskVersion, recipientUserId: recipient.actorUserId, createdAt: instant, state: 'pending' as const } : null;
        const reminderEnvelope = phase ? { ...data.tags(binding.scope), taskId: work.taskId, occurrenceId: work.occurrenceId,
          ...data.seal('task-reminder', receipt!.id, binding.scope, firestoreTaskReminderSchema, receipt!, work.taskVersion) } : null;
        const notificationEnvelope = notification ? { ...data.tags(binding.scope), state: notification.state,
          ...data.seal('task-notification-outbox', notification.id, binding.scope, firestoreTaskNotificationOutboxSchema, notification, work.taskVersion) } : null;
        if (Date.parse(lease.until) <= now()) return result('stale');
        prepared.commit(); background?.commit(); binding.transaction.set(row.ref, workEnvelope);
        if (batchEnvelope) binding.transaction.create(batchRef, batchEnvelope);
        if (reminderEnvelope) binding.transaction.create(data.ref('task_reminders', 'task-reminder', receipt!.id), reminderEnvelope);
        if (notificationEnvelope) binding.transaction.create(data.ref('notification_outbox', 'task-notification-outbox', notification!.id), notificationEnvelope);
        return result(state === 'pending' ? 'deferred' : state, receipt, nextAt);
      });
    },
    async process(job) {
      const claimed = await worker.claim(job);
      return claimed.state === 'claimed' ? worker.complete(job, claimed.lease) : claimed;
    },
    async due(userId, childId, limit = 25) {
      domainParse(z.number().int().min(1).max(50), limit); domainParse(uuid, childId);
      if (!options.enabled) return [];
      const identityEmail = await currentAuth(userId), instant = new Date(now()).toISOString();
      return authority.runTransaction(userId, childId, async binding => {
        if (binding.identityEmail !== identityEmail) domainReject('task_auth_denied', 403);
        const tags = data.tags(binding.scope);
        const base = () => data.collection('task_outbox').where('workspaceTag', '==', tags.workspaceTag).where('epochTag', '==', tags.epochTag)
          .where('userTag', '==', tags.userTag).where('childTag', '==', tags.childTag);
        const pending = await binding.transaction.get(base().where('state', '==', 'pending').where('dueAt', '<=', instant).orderBy('dueAt').limit(limit));
        const expired = await binding.transaction.get(base().where('state', '==', 'leased').where('leaseUntil', '<=', instant).orderBy('leaseUntil').limit(limit));
        const jobs: FirestoreTaskDelivery[] = [];
        for (const snapshot of [...pending.docs, ...expired.docs].slice(0, limit)) {
          const taskId = domainParse(uuid, snapshot.get('taskId'), 'invalid_document', 500), taskVersion = domainParse(version, snapshot.get('taskVersion'), 'invalid_document', 500);
          const row = await outbox(binding, taskId, taskVersion);
          if (!row || row.ref.path !== snapshot.ref.path) domainReject('outbox_binding', 500);
          const work = row.value;
          if (work.generation !== binding.generation || work.authorizationVersion !== binding.authorizationVersion) continue;
          jobs.push({ kind: 'task-reminder', scope: { ...binding.scope }, taskId, taskVersion, occurrenceId: work.occurrenceId,
            authorizationVersion: work.authorizationVersion, generation: work.generation, scheduledAt: work.dueAt });
        }
        return jobs;
      });
    },
    async dispatchTransaction(raw, mode, visit) {
      const job = domainParse(firestoreTaskDeliverySchema, raw);
      if (!['enqueue', 'settle'].includes(mode) || typeof visit !== 'function') domainReject('invalid_input', 400);
      if (!options.enabled) return result('disabled');
      return execute(job, async binding => {
        bindingMatches(binding, job);
        const row = await outbox(binding, job.taskId, job.taskVersion);
        if (!row) return result('stopped'); jobMatches(job, row.value);
        const work = row.value;
        // Settlement records transport evidence only. It cannot claim or change consumer work.
        if (mode === 'settle') return { state: 'ready' as const, value: await visit(binding, work) };
        if (work.state === 'unknown') return result('unknown');
        if (work.state === 'failed') return result('failed');
        if (work.state !== 'pending' && work.state !== 'leased') return result('stopped');
        if (work.state === 'leased' && !work.lease || work.state === 'pending' && work.lease) domainReject('outbox_binding', 500);
        if (work.lease?.generation !== undefined && work.lease.generation !== binding.generation) domainReject('task_scope_changed');
        const at = now();
        if (work.state === 'leased' && Date.parse(work.lease!.until) > at) return result('busy');
        const current = await task(binding, job.taskId);
        if (!currentTask(current, work)) return result('stopped');
        if (work.dueAt !== job.scheduledAt || Date.parse(work.dueAt) > at || Date.parse(current!.occurrence.dueAt) > at) return result('not_due');
        return { state: 'ready' as const, value: await visit(binding, work) };
      });
    },
    async view(binding, taskIds) {
      domainParse(z.array(uuid).max(50).refine(ids => new Set(ids).size === ids.length), taskIds);
      const values: TaskReminder[] = [], work: TaskWorkState[] = [];
      for (const taskId of taskIds) {
        const current = await task(binding, taskId); if (!current) continue;
        const row = await outbox(binding, taskId, current.version);
        if (current.occurrence.state === 'scheduled') {
          const prior = await reminders(binding, taskId, current.occurrence.id, current.version);
          values.push(...prior.values.filter(value => value.taskVersion === current.version));
        }
        if (row) work.push({ taskId, taskVersion: row.value.taskVersion,
          status: row.value.state === 'leased' ? 'pending' : row.value.state === 'cancelled' ? 'stopped' : row.value.state,
          nextAt: row.value.dueAt, failures: row.value.failures });
      }
      return { reminders: values, work, workerEnabled: options.enabled === true };
    },
  };
  return worker;
}
