import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from '../src/shared/family.ts';
import { firestoreNotificationPreferencesSchema } from './firestore-task-worker.ts';
import type { Child } from '../src/shared/records.ts';
import type { OnlineContext, OnlineCommand, OnlineSubmission, OnlineReceipt, OnlineChanges } from '../src/shared/online.ts';
import type { Workspace } from './workspaces.ts';
import { taskCreateSchema, taskChangeSchema, type CareTask, type TaskPage, type TaskHistory, type TaskRevision } from '../src/shared/tasks.ts';
import { validateCreateChild } from '../src/shared/inputs.ts';
import { onlineCommandSchema, onlineSubmissionSchema, onlineRoute } from './online-routing.ts';
import { changeTask } from './task-policy.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { workRecoveryScopeSchema, type WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, firestoreChildSchema, firestoreChangeSchema,
  firestoreTaskSchema, firestoreTaskRevisionSchema, firestoreReminderOutboxSchema, firestoreReminderOutboxId,
  sealFirestoreReminderOutbox, type FirestoreDomainOptions, type FirestoreReminderOutbox } from './firestore-domain-data.ts';

import { createFirestoreOnlineReceipts, isFirestoreOnlinePending } from './firestore-online-receipts.ts';

const NIL = '00000000-0000-0000-0000-000000000000';
const decimal = firestoreChangeSchema.shape.changeSeq, uuid = z.uuid();
const preferencesInput = firestoreNotificationPreferencesSchema.omit({ version: true }).extend({
  expectedVersion: z.number().int().min(0).max(2147483646),
}).strict().refine(value => value.quietStart !== value.quietEnd);

const cursorSchema = z.object({ scope: workRecoveryScopeSchema, changeSeq: decimal, filter: z.literal('children'),
  createdAt: z.iso.datetime({ offset: true }), childId: uuid }).strict();
const taskPath = /^\/api\/children\/([0-9a-f-]{36})\/tasks(?:\/([0-9a-f-]{36})\/change)?$/iu;
export interface FirestoreChildrenPage { children: Child[]; nextCursor: string | null }
export interface FirestoreChildrenQuery { list(userId: string, cursor?: string | null): Promise<FirestoreChildrenPage> }
export interface FirestoreTasksQuery {
  list(userId: string, childId: string, afterId?: string | null): Promise<TaskPage>;
  get(userId: string, childId: string, taskId: string): Promise<CareTask | null>;
  detail?(userId: string, childId: string, taskId: string): Promise<({ task: CareTask } & Pick<TaskPage, 'reminders' | 'work' | 'workerEnabled'>) | null>;
  history(userId: string, childId: string, taskId: string, beforeVersion?: number | null): Promise<TaskHistory | null>;
}
export interface FirestoreOnlineStore {
  spaces(userId: string): Promise<Workspace[]>;
  context(userId: string, command: OnlineCommand): Promise<OnlineContext>;
  submit(userId: string, submission: OnlineSubmission): Promise<OnlineReceipt>;
  lookup(userId: string, opId: string): Promise<OnlineReceipt | { state: 'unconfirmed' }>;
  changes(userId: string, workspaceId: string, epoch: string, cursor: string): Promise<OnlineChanges>;
  readonly children: FirestoreChildrenQuery;
  readonly tasks: FirestoreTasksQuery;
  /** Shared transaction primitive for online commands and authorized Agent operations. */
  prepareTask(binding: FirestoreAuthorityTransaction, childId: string, taskId: string | undefined, raw: unknown, operationId: string):
    Promise<{ task: CareTask; changeSeq: string; commit(): void }>;
  notificationPreferences?(userId: string): Promise<NotificationPreferences>;
}

/** F02 owner-only child/task domain, original operation receipts and durable reminder intents. */
export interface FirestoreOnlinePhotosPort { submitOnline(userId: string, submission: OnlineSubmission): Promise<OnlineReceipt> }
export interface FirestoreOnlineReminderViewPort {
  view(binding: FirestoreAuthorityTransaction, taskIds: string[]): Promise<Required<Pick<TaskPage, 'reminders' | 'work' | 'workerEnabled'>>>;
}
export interface FirestoreOnlineMutation {
  supports(path: string): boolean;
  /** Read and validate first; commit is called with the receipt in the same transaction. */
  prepare(binding: FirestoreAuthorityTransaction, submission: OnlineSubmission): Promise<{
    childId: string | null; changeSeq: string; statusCode: 200 | 201; result: unknown; commit(): void;
  }>;
}
export interface FirestoreOnlineOptions extends FirestoreDomainOptions {
  photos?: FirestoreOnlinePhotosPort; reminders?: FirestoreOnlineReminderViewPort; mutations?: readonly FirestoreOnlineMutation[];
}
export function createFirestoreOnlineStore(options: FirestoreOnlineOptions): FirestoreOnlineStore {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options), receipts = createFirestoreOnlineReceipts(options);
  const scopeFor = (binding: FirestoreAuthorityTransaction, childId: string): WorkRecoveryScope => ({ ...binding.scope, childId });
  const taskId = (id: string, taskVersion: number) => JSON.stringify([id, taskVersion]);
  function matchesTags(raw: any, scope: WorkRecoveryScope) {
    const tags = data.tags(scope);
    if (raw?.workspaceTag !== tags.workspaceTag || raw?.epochTag !== tags.epochTag || raw?.userTag !== tags.userTag
      || raw?.childTag !== tags.childTag) domainReject('projection_binding', 500);
  }
  async function readPreferences(binding: FirestoreAuthorityTransaction): Promise<NotificationPreferences> {
    const scope = binding.scope, snapshot = await binding.transaction.get(data.ref('notification_preferences', 'notification-preferences', scope.ownerUserId));
    if (!snapshot.exists) return { ...DEFAULT_NOTIFICATION_PREFERENCES };
    matchesTags(snapshot.data(), scope);
    const value = data.open('notification-preferences', scope.ownerUserId, scope, firestoreNotificationPreferencesSchema, snapshot);
    if (scope.childId !== NIL || value.version !== snapshot.get('recordVersion')) domainReject('preferences_binding', 500);
    return value;
  }
  function currentContext(binding: FirestoreAuthorityTransaction): OnlineContext {
    return { workspaceId: binding.scope.workspaceId, storageEpoch: binding.scope.storageEpoch };
  }
  async function requireChild(binding: FirestoreAuthorityTransaction, childId: string): Promise<Child> {
    const child = await binding.readChild(childId); if (!child) domainReject('not_found', 404); return child;
  }
  async function readTask(binding: FirestoreAuthorityTransaction, scope: WorkRecoveryScope, id: string): Promise<CareTask | null> {
    const snapshot = await binding.transaction.get(data.ref('tasks', 'task', id));
    if (!snapshot.exists) return null;
    matchesTags(snapshot.data(), scope);
    const task = data.open('task', id, scope, firestoreTaskSchema, snapshot);
    if (task.id !== id || task.childId !== scope.childId || task.createdBy !== scope.ownerUserId
      || task.assigneeUserId !== scope.ownerUserId || task.version !== snapshot.get('recordVersion')) domainReject('task_binding', 500);
    return task;
  }
  async function readOutbox(binding: FirestoreAuthorityTransaction, scope: WorkRecoveryScope, task: CareTask) {
    const id = firestoreReminderOutboxId(task.id, task.version), ref = data.ref('task_outbox', 'task-reminder-outbox', id);
    const snapshot = await binding.transaction.get(ref);
    if (!snapshot.exists) return null;
    matchesTags(snapshot.data(), scope);
    const job = data.open('task-reminder-outbox', id, scope, firestoreReminderOutboxSchema, snapshot);
    if (job.taskId !== task.id || job.occurrenceId !== task.occurrence.id || job.taskVersion !== task.version
      || job.ownerUserId !== scope.ownerUserId || job.workspaceId !== scope.workspaceId || job.childId !== scope.childId
      || job.storageEpoch !== scope.storageEpoch || job.taskVersion !== snapshot.get('recordVersion')) domainReject('outbox_binding', 500);
    return { id, ref, job };
  }
  const sealOutbox = (_id: string, scope: WorkRecoveryScope, job: FirestoreReminderOutbox) => sealFirestoreReminderOutbox(data, scope, job);
  const reminderView = (binding: FirestoreAuthorityTransaction, taskIds: string[]): Promise<Pick<TaskPage, 'reminders' | 'work' | 'workerEnabled'>> =>
    options.reminders ? options.reminders.view(binding, taskIds) : Promise.resolve({ workerEnabled: false });
  const children: FirestoreChildrenQuery = { async list(userId, cursor = null) {
    return authority.runTransaction(userId, null, async binding => {
      let after: z.infer<typeof cursorSchema> | null = null;
      if (cursor !== null) {
        if (typeof cursor !== 'string' || cursor.length > 8192 || !/^[A-Za-z0-9_-]+$/u.test(cursor)) domainReject('invalid_cursor', 400);
        let envelope: any;
        try { envelope = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { domainReject('invalid_cursor', 400); }
        after = data.open('children-cursor', 'children', binding.scope, cursorSchema, { exists: true, data: () => envelope } as any);
        if (firestoreDomainHash(after.scope) !== firestoreDomainHash(binding.scope) || after.changeSeq !== binding.changeSeq) domainReject('cursor_changed');
      }
      const tags = data.tags(binding.scope);
      let query = data.collection('children').where('workspaceTag', '==', tags.workspaceTag).where('epochTag', '==', tags.epochTag)
        .where('userTag', '==', tags.userTag).orderBy('createdAt', 'asc').orderBy('childId', 'asc').limit(51);
      if (after) query = query.startAfter(after.createdAt, after.childId);
      const page = await binding.transaction.get(query), result: Child[] = [];
      for (const [index, row] of page.docs.entries()) {
        const childId = domainParse(uuid, row.get('childId'), 'invalid_document', 500), scope = scopeFor(binding, childId);
        matchesTags(row.data(), scope);
        const projected = data.open('child-projection', childId, scope, firestoreChildSchema, row);
        if (projected.id !== childId || projected.workspaceId !== scope.workspaceId || projected.createdAt !== row.get('createdAt')) domainReject('projection_binding', 500);
        const child = await binding.readChild(childId);
        if (child) {
          if (firestoreDomainHash(child) !== firestoreDomainHash(projected)) domainReject('projection_binding', 500);
          if (index < 50) result.push(child);
        }
      }
      const last = page.docs[Math.min(page.docs.length, 50) - 1];
      const nextCursor = page.docs.length > 50 ? Buffer.from(JSON.stringify(data.seal('children-cursor', 'children', binding.scope, cursorSchema,
        { scope: binding.scope, changeSeq: binding.changeSeq, filter: 'children', createdAt: last.get('createdAt'), childId: last.get('childId') }))).toString('base64url') : null;
      return { children: result, nextCursor };
    });
  } };

  async function prepareTask(binding: FirestoreAuthorityTransaction, childId: string, oldId: string | undefined, raw: unknown, operationId: string) {
    domainParse(uuid, operationId); if (oldId) domainParse(uuid, oldId);
    const userId = binding.scope.ownerUserId, candidateId = randomUUID(), occurrenceId = randomUUID(), at = new Date().toISOString();
    domainParse(uuid, childId); await requireChild(binding, childId);
    const scope = scopeFor(binding, childId);
    const input = oldId ? domainParse(taskChangeSchema, raw) : domainParse(taskCreateSchema, raw);
    const old = oldId ? await readTask(binding, scope, oldId) : null;
    if (oldId && !old) domainReject('not_found', 404);
    let task: CareTask, revision: TaskRevision;
    if (old) {
      const change = domainParse(taskChangeSchema, input);
      if (change.action === 'reschedule' && change.assigneeUserId !== userId) domainReject('assignee_not_eligible', 400);
      task = changeTask(old, change, at);
      revision = { task, action: change.action, actorUserId: userId, basisVersion: change.expectedVersion, note: change.note, at };
    } else {
      const create = domainParse(taskCreateSchema, input);
      if (create.values.assigneeUserId !== userId) domainReject('assignee_not_eligible', 400);
      const { dueAt, timeZone, ...values } = create.values;
      task = { ...values, id: candidateId, childId, version: 1, createdBy: userId, createdAt: at, updatedAt: at,
        occurrence: { id: occurrenceId, dueAt, timeZone, state: 'scheduled', terminalBasisVersion: null } };
      if ((await binding.transaction.get(data.ref('tasks', 'task', candidateId))).exists) domainReject('task_conflict');
      revision = { task, action: 'create', actorUserId: userId, basisVersion: 0, note: '', at };
    }
    const revisionId = taskId(task.id, task.version), revisionRef = data.ref('task_revisions', 'task-revision', revisionId);
    if ((await binding.transaction.get(revisionRef)).exists) domainReject('revision_conflict');
    const oldOutbox = old ? await readOutbox(binding, scope, old) : null;
    const outboxId = firestoreReminderOutboxId(task.id, task.version), outboxRef = data.ref('task_outbox', 'task-reminder-outbox', outboxId);
    if ((await binding.transaction.get(outboxRef)).exists) domainReject('outbox_conflict');
    const tags = data.tags(scope);
    const unknownRows = await binding.transaction.get(data.collection('task_outbox')
      .where('workspaceTag', '==', tags.workspaceTag).where('epochTag', '==', tags.epochTag)
      .where('childTag', '==', tags.childTag).where('userTag', '==', tags.userTag)
      .where('taskId', '==', task.id).where('occurrenceId', '==', task.occurrence.id).where('state', '==', 'unknown').limit(1));
    for (const row of unknownRows.docs) {
      matchesTags(row.data(), scope);
      const taskVersion = domainParse(z.number().int().positive(), row.get('taskVersion'), 'invalid_document', 500);
      const evidence = data.open('task-reminder-outbox', firestoreReminderOutboxId(task.id, taskVersion), scope, firestoreReminderOutboxSchema, row);
      if (evidence.state !== 'unknown' || evidence.taskId !== task.id || evidence.occurrenceId !== task.occurrence.id
        || evidence.ownerUserId !== scope.ownerUserId || evidence.workspaceId !== scope.workspaceId || evidence.childId !== scope.childId
        || evidence.storageEpoch !== scope.storageEpoch || evidence.taskVersion !== taskVersion
        || taskVersion !== row.get('recordVersion') || taskVersion >= task.version) domainReject('outbox_binding', 500);
    }
    const unknown = unknownRows.docs.length > 0;
    const outbox: FirestoreReminderOutbox | null = task.occurrence.state === 'scheduled' && !unknown ? {
      taskId: task.id, occurrenceId: task.occurrence.id, taskVersion: task.version, dueAt: task.occurrence.dueAt, ...scope,
      authorizationVersion: binding.authorizationVersion, generation: binding.generation, state: 'pending', attempts: 0, failures: 0, lease: null } : null;
    const prepared = await binding.prepareChange(operationId, 'tasks', false, childId);
    const taskEnvelope = { ...data.tags(scope), taskId: task.id, ...data.seal('task', task.id, scope, firestoreTaskSchema, task, task.version) };
    const revisionEnvelope = { ...data.tags(scope), taskId: task.id, taskVersion: task.version,
      ...data.seal('task-revision', revisionId, scope, firestoreTaskRevisionSchema, revision, task.version) };
    const cancelled = oldOutbox && ['pending', 'leased'].includes(oldOutbox.job.state)
      ? sealOutbox(oldOutbox.id, scope, { ...oldOutbox.job, state: 'cancelled', lease: null }) : null;
    const outboxEnvelope = outbox ? sealOutbox(outboxId, scope, outbox) : null;
    return { task, changeSeq: prepared.changeSeq, commit() {
      prepared.commit(); binding.transaction.set(data.ref('tasks', 'task', task.id), taskEnvelope);
      binding.transaction.create(revisionRef, revisionEnvelope);
      if (cancelled && oldOutbox) binding.transaction.set(oldOutbox.ref, cancelled);
      if (outboxEnvelope) binding.transaction.create(outboxRef, outboxEnvelope);
    } };
  }
  const tasks: FirestoreTasksQuery = {
    async list(userId, childId, afterId = null) {
      domainParse(uuid, childId); if (afterId !== null) domainParse(uuid, afterId);
      return authority.runTransaction(userId, childId, async binding => {
        const tags = data.tags(binding.scope);
        let query = data.collection('tasks').where('workspaceTag', '==', tags.workspaceTag).where('epochTag', '==', tags.epochTag)
          .where('childTag', '==', tags.childTag).where('userTag', '==', tags.userTag).orderBy('taskId', 'asc').limit(51);
        if (afterId) query = query.startAfter(afterId);
        const rows = await binding.transaction.get(query), items: CareTask[] = [];
        for (const row of rows.docs.slice(0, 50)) {
          const id = domainParse(uuid, row.get('taskId'), 'invalid_document', 500);
          const task = await readTask(binding, binding.scope, id);
          if (!task) domainReject('projection_binding', 500); items.push(task);
        }
        return { items, eligibleAssignees: [{ userId, name: '本人' }], nextAfterId: rows.docs.length > 50 ? items.at(-1)!.id : null,
          ...await reminderView(binding, items.map(item => item.id)) };
      });
    },
    async get(userId, childId, id) {
      domainParse(uuid, id);
      return authority.runTransaction(userId, childId, binding => readTask(binding, binding.scope, id));
    },
    async detail(userId, childId, id) {
      domainParse(uuid, id);
      return authority.runTransaction(userId, childId, async binding => {
        const task = await readTask(binding, binding.scope, id);
        return task ? { task, ...await reminderView(binding, [id]) } : null;
      });
    },
    async history(userId, childId, id, beforeVersion = null) {
      domainParse(uuid, id); if (beforeVersion !== null) domainParse(z.number().int().positive().max(2147483647), beforeVersion);
      return authority.runTransaction(userId, childId, async binding => {
        const task = await readTask(binding, binding.scope, id); if (!task) return null;
        const tags = data.tags(binding.scope);
        let query = data.collection('task_revisions').where('workspaceTag', '==', tags.workspaceTag).where('epochTag', '==', tags.epochTag)
          .where('childTag', '==', tags.childTag).where('userTag', '==', tags.userTag).where('taskId', '==', id).orderBy('taskVersion', 'desc').limit(51);
        if (beforeVersion !== null) query = query.where('taskVersion', '<', beforeVersion);
        const rows = await binding.transaction.get(query), revisions: TaskRevision[] = [];
        for (const row of rows.docs.slice(0, 50)) {
          matchesTags(row.data(), binding.scope);
          const taskVersion = domainParse(z.number().int().positive(), row.get('taskVersion'), 'invalid_document', 500);
          const revision = data.open('task-revision', taskId(id, taskVersion), binding.scope, firestoreTaskRevisionSchema, row);
          if (revision.task.id !== id || revision.task.childId !== childId || revision.task.version !== taskVersion
            || revision.actorUserId !== userId || taskVersion > task.version || taskVersion !== row.get('recordVersion')) domainReject('revision_binding', 500);
          revisions.push(revision);
        }
        return { revisions, nextBeforeVersion: rows.docs.length > 50 ? revisions.at(-1)!.task.version : null };
      });
    },
  };
  return {
    children, tasks, prepareTask,
    notificationPreferences(userId) { return authority.runTransaction(userId, null, readPreferences); },
    async spaces(userId) {
      return authority.runTransaction(userId, null, async binding => {
        if (binding.workspaceCreatedAt === null) domainReject('domain_not_ready', 503);
        return [{ id: binding.scope.workspaceId, storageEpoch: binding.scope.storageEpoch, createdAt: binding.workspaceCreatedAt }];
      });
    },
    async context(userId, raw) {
      const command = domainParse(onlineCommandSchema, raw), route = onlineRoute(command);
      return authority.runTransaction(userId, null, async binding => {
        if (route.scope === 'child') await requireChild(binding, route.targetId!);
        if ((route.scope === 'workspace' || route.scope === 'invitation') && route.targetId !== binding.scope.workspaceId) domainReject('not_found', 404);
        return currentContext(binding);
      });
    },
    async lookup(userId, rawOpId) {
      const opId = domainParse(uuid, rawOpId);
      return authority.runTransaction(userId, null, async binding => {
        const receipt = await receipts.read(binding, opId); return receipt ? receipts.disclose(binding, receipt) : { state: 'unconfirmed' as const };
      });
    },
    async submit(userId, raw) {
      const submission = domainParse(onlineSubmissionSchema, raw);
      if (options.photos && /^\/api\/children\/[0-9a-f-]{36}\/photos(?:\/[0-9a-f-]{36}\/delete)?$/iu.test(submission.path))
        return options.photos.submitOnline(userId, submission);
      return authority.runTransaction(userId, null, async binding => {
        // Caller-wide identity is checked before looking at a changed command's target resource.
        const prior = await receipts.read(binding, submission.operation.opId);
        if (prior) {
          receipts.assertSame(binding, prior, submission);
          if (isFirestoreOnlinePending(prior)) domainReject('operation_conflict');
          return receipts.disclose(binding, prior) as Promise<OnlineReceipt>;
        }
        if (submission.operation.workspaceId !== binding.scope.workspaceId || submission.operation.storageEpoch !== binding.scope.storageEpoch) domainReject('storage_epoch_changed');
        let changeSeq: string, result: unknown, statusCode: 200 | 201, receiptChildId: string | null;
        let commitDomain: () => void;
        const mutation = options.mutations?.find(domain => domain.supports(submission.path));
        if (mutation) {
          const prepared = await mutation.prepare(binding, submission);
          changeSeq = prepared.changeSeq; result = prepared.result; statusCode = prepared.statusCode;
          receiptChildId = prepared.childId; commitDomain = prepared.commit;
        } else if (submission.path === '/api/children') {
          const validated = validateCreateChild(submission.payload);
          if (!validated.ok) domainReject('invalid_input', 400);
          const prepared = await binding.prepareChildCreation({ operationId: submission.operation.opId, displayName: validated.value.displayName });
          changeSeq = prepared.changeSeq; result = { child: prepared.result.child }; statusCode = 201;
          receiptChildId = prepared.result.child.id; commitDomain = prepared.commit;
        } else if (submission.path === '/api/notification-preferences') {
          const input = domainParse(preferencesInput, submission.payload), current = await readPreferences(binding);
          if (current.version !== input.expectedVersion) domainReject('version_conflict');
          const { expectedVersion, ...values } = input, preferences = { ...values, version: expectedVersion + 1 };
          const prepared = await binding.prepareChange(submission.operation.opId, 'preferences', false);
          const envelope = { ...data.tags(binding.scope), ...data.seal('notification-preferences', userId, binding.scope,
            firestoreNotificationPreferencesSchema, preferences, preferences.version) };
          changeSeq = prepared.changeSeq; result = { preferences }; statusCode = 200; receiptChildId = null;
          commitDomain = () => {
            prepared.commit();
            binding.transaction.set(data.ref('notification_preferences', 'notification-preferences', userId), envelope);
          };
        } else {
          // Recognized but unconnected product domains cannot return a successful synthetic mutation.
          onlineRoute(submission);
          const match = taskPath.exec(submission.path);
          if (!match) domainReject('domain_not_ready', 503);
          const childId = domainParse(uuid, match[1].toLowerCase()), oldId = match[2]?.toLowerCase();
          const prepared = await prepareTask(binding, childId, oldId, submission.payload, submission.operation.opId);
          changeSeq = prepared.changeSeq; result = { task: prepared.task }; statusCode = oldId ? 200 : 201;
          receiptChildId = childId; commitDomain = prepared.commit;
        }
        const receipt = receipts.prepareConfirmed(binding, submission, { childId: receiptChildId, changeSeq, statusCode, result });
        commitDomain(); receipt.commit();
        return receipt.receipt;
      });
    },
    async changes(userId, workspaceId, epoch, rawCursor) {
      domainParse(uuid, workspaceId); domainParse(uuid, epoch); const cursor = domainParse(decimal, rawCursor);
      return authority.runTransaction(userId, null, async binding => {
        if (workspaceId !== binding.scope.workspaceId) domainReject('not_found', 404);
        if (epoch !== binding.scope.storageEpoch) domainReject('storage_epoch_changed');
        if (BigInt(cursor) > BigInt(binding.changeSeq)) domainReject('cursor_changed');
        const accessVersion = Number(binding.authorizationVersion);
        if (!Number.isSafeInteger(accessVersion)) domainReject('domain_not_ready', 503);
        const tags = data.tags(binding.scope);
        const query = data.collection('changes').where('workspaceTag', '==', tags.workspaceTag).where('epochTag', '==', tags.epochTag)
          .where('userTag', '==', tags.userTag).where('sortKey', '>', data.sortKey(cursor)).where('sortKey', '<=', data.sortKey(binding.changeSeq))
          .orderBy('sortKey', 'asc').limit(101);
        const rows = await binding.transaction.get(query), changes: OnlineChanges['changes'] = [];
        let expected = BigInt(cursor) + 1n;
        for (const row of rows.docs.slice(0, 100)) {
          const sequence = BigInt(row.get('sortKey')).toString(), childId = domainParse(uuid.nullable(), row.get('childId'), 'invalid_document', 500);
          if (BigInt(sequence) !== expected++) domainReject('change_projection_not_ready', 503);
          const scope = scopeFor(binding, childId ?? NIL), id = JSON.stringify([workspaceId, epoch, sequence]);
          matchesTags(row.data(), scope);
          const change = data.open('change-projection', id, scope, firestoreChangeSchema, row);
          if (change.changeSeq !== sequence || change.childId !== childId || data.sortKey(sequence) !== row.get('sortKey')) domainReject('projection_binding', 500);
          if (childId) await binding.readChild(childId);
          changes.push(change);
        }
        const hasMore = rows.docs.length > 100;
        if (!hasMore && expected - 1n !== BigInt(binding.changeSeq)) domainReject('change_projection_not_ready', 503);
        return { workspaceId, storageEpoch: epoch, accessVersion, changes, hasMore,
          cursor: hasMore ? changes.at(-1)!.changeSeq : binding.changeSeq };
      });
    },
  };
}
