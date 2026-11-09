import {DateTime} from 'luxon';
import type {HomeChild} from '../view-model';
import type {ContactAttempt, ContactPage, ContactRequest} from '../contact-view-model';
import type {TaskView} from '../task-view-model';
export const contactPreviewTaskId = '1b457e3a-12c7-4f24-9450-48f9d142a368';
export const contactPreviewAttemptId = 'f4ebd750-6cd4-4fbb-afbc-0a0323113c62';
export const contactPreviewBindings = [{channel: 'web_push' as const, bindingId: '3e55dab9-de62-43db-9599-9d244e8d1f88', bindingVersion: 2, label: '本人瀏覽器（合成）'}, {channel: 'telegram' as const, bindingId: '9476c6c1-e94a-4eb0-a816-55a6145fc491', bindingVersion: 1, label: '本人 Telegram（合成）'}];
// Saved history and eligibility examples only; this does not implement notification policy or dispatch.
export function contactFixture(child: HomeChild, userId: string): ContactPage {
  const at = DateTime.now().setZone('Asia/Hong_Kong').startOf('day').set({hour: 9}).toISO()!;
  const future = DateTime.now().plus({days: 20}).toISO()!;
  const task: TaskView = {id: contactPreviewTaskId, childId: child.id, version: 2, title: '核對這週家庭照顧安排（合成）', details: '完成仍須回任務頁明確確認。', kind: 'ordinary', assigneeUserId: 'preview-dad', createdBy: 'preview-mom', createdAt: at, updatedAt: at, occurrence: {id: 'preview-contact-occurrence', dueAt: future, timeZone: 'Asia/Hong_Kong', state: 'scheduled', terminalBasisVersion: null}};
  const attempt = (id: string, status: ContactAttempt['status'], recipientUserId = userId): ContactAttempt => ({id, recipientUserId, channel: status === 'unknown' ? 'web_push' : 'telegram', grantVersion: 1, taskVersion: task.version, status, reason: status === 'rejected' ? '渠道明確拒絕（合成）' : null, providerStatus: status === 'accepted' ? 200 : status === 'rejected' ? 403 : null, messageId: status === 'accepted' ? 123 : null, attemptedAt: at, finishedAt: status === 'sending' ? null : at, acknowledgedAt: null});
  const request = (id: string, state: ContactRequest['state'], attempts: ContactAttempt[]): ContactRequest => ({id, taskId: task.id, taskVersion: task.version, occurrenceId: task.occurrence.id, phase: 'initial', state, reason: null, nextAt: at, groupedTo: state === 'coalesced' ? 'preview-contact-accepted' : null, createdAt: at, attempts});
  return {canManage: child.accessRole !== 'viewer', workerEnabled: true, consent: {userId, version: 1, enabled: false, allowBackup: false, bindings: []}, availableBindings: contactPreviewBindings.map(item => ({...item})),
    recipients: [{userId, name: '本人（合成）', enabled: false, allowBackup: false, channels: []}, {userId: 'preview-dad', name: '爸爸（合成）', enabled: true, allowBackup: false, channels: ['telegram']}, {userId: 'preview-helper', name: '姨姨（合成）', enabled: true, allowBackup: true, channels: ['web_push']}],
    tasks: [task, {...task, id: 'preview-contact-review-task', title: '待覆核的家庭事項（合成）', occurrence: {...task.occurrence, id: 'preview-contact-review-occurrence', state: 'needs_review'}}], tasksHaveMore: true,
    grants: [{taskId: task.id, version: 1, taskVersion: task.version, enabled: true, primaryUserId: task.assigneeUserId, backupUserId: null, allowFollowUp: false, allowFallback: false, validUntil: future, authorizedBy: 'preview-mom', updatedAt: at, content: 'generic_notice', trigger: 'task_due'}], historyLimited: true,
    requests: [request('preview-contact-accepted', 'accepted', [attempt(contactPreviewAttemptId, 'accepted')]), request('preview-contact-unknown', 'unknown', [attempt('preview-contact-unknown-attempt', 'unknown')]), request('preview-contact-sending', 'pending', [attempt('preview-contact-sending-attempt', 'sending')]), request('preview-contact-rejected', 'rejected', [attempt('preview-contact-rejected-attempt', 'rejected', 'preview-dad')]), request('preview-contact-coalesced', 'coalesced', []), request('preview-contact-stopped', 'stopped', [])]};
}
