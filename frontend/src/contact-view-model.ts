import type {TaskAssigneeView, TaskView} from './task-view-model';
import {channelDeliveryLabels} from './channel-view-model.ts';

// Presentation projections only; ContactApi and the shared input schemas stay authoritative.
export type ContactChannel = 'web_push' | 'telegram' | 'native_push';
export interface ContactBinding {channel: ContactChannel; bindingId: string; bindingVersion: number}
export interface ContactConsent {userId: string; version: number; enabled: boolean; allowBackup: boolean; bindings: ContactBinding[]}
export interface ContactConsentDecision {expectedVersion: number; enabled: boolean; allowBackup: boolean; bindings: ContactBinding[]; confirm: true}
export interface ContactGrantDecision {
  expectedVersion: number; expectedTaskVersion: number; enabled: boolean; allowFollowUp: boolean; allowFallback: boolean;
  backupUserId: string | null; validUntil: string; confirm: true; content: 'generic_notice'; trigger: 'task_due';
}
export interface ContactGrant {
  taskId: string; version: number; taskVersion: number; enabled: boolean; primaryUserId: string; backupUserId: string | null;
  allowFollowUp: boolean; allowFallback: boolean; validUntil: string; authorizedBy: string; updatedAt: string;
  content: 'generic_notice'; trigger: 'task_due';
}
export interface ContactAttempt {
  id: string; recipientUserId: string; channel: ContactChannel; grantVersion: number; taskVersion: number;
  status: 'sending' | 'accepted' | 'rejected' | 'unknown' | 'stopped'; reason: string | null;
  providerStatus: number | null; messageId: number | null; attemptedAt: string; finishedAt: string | null; acknowledgedAt: string | null;
}
export interface ContactRequest {
  id: string; taskId: string; taskVersion: number; occurrenceId: string; phase: 'initial' | 'follow_up';
  state: 'pending' | 'accepted' | 'rejected' | 'unknown' | 'stopped' | 'coalesced'; reason: string | null;
  nextAt: string; groupedTo: string | null; createdAt: string; attempts: ContactAttempt[];
}
export interface ContactPage {
  canManage: boolean; workerEnabled: boolean; consent: ContactConsent; availableBindings: (ContactBinding & {label: string})[];
  recipients: (TaskAssigneeView & {enabled: boolean; allowBackup: boolean; channels: ContactChannel[]})[];
  tasks: TaskView[]; tasksHaveMore: boolean; grants: ContactGrant[]; requests: ContactRequest[]; historyLimited: boolean;
}
export type ContactDecision = {kind: 'consent'; input: ContactConsentDecision}
  | {kind: 'authorization'; taskId: string; input: ContactGrantDecision}
  | {kind: 'acknowledge'; attemptId: string; input: {confirmReceived: true}};
export interface ContactPending {reference: string; decision: ContactDecision; body: string; labels: string[]; confirmed: boolean; reviewed: boolean}
export interface ContactViewModel {
  scopeKey: string; childName: string; userId: string; dataLabel: string; page: ContactPage | null;
  online: boolean; access: 'editable' | 'read_only' | 'lost'; load: 'ready' | 'loading' | 'error'; busy: boolean; locked: boolean;
  notice: string; operation: 'none' | 'saving' | 'saved' | 'failed' | 'unknown' | 'conflict' | 'confirmed_unread';
  pending: ContactPending | null; originalConsent: boolean; dirty: boolean; epoch: number; confirmationEpoch: number; missingTasks: string[];
}
export interface ContactActions {
  refresh(): void; markDirty(key: string): void; discard(): void;
  save(decision: ContactDecision, labels: string[]): void; setOriginalConsent(value: boolean): void; retryOriginal(): void;
}
export const contactChannelLabels: Record<ContactChannel, string> = {web_push: 'Web Push', telegram: 'Telegram', native_push: 'Android FCM'};
export const contactRequestLabels: Record<ContactRequest['state'], string> = {pending: '待處理', accepted: '渠道已接受', rejected: '渠道已拒絕', unknown: '投遞結果未知', stopped: '已停止', coalesced: '今天已有普通提示，未另行發送'};
export const contactAttemptLabels = channelDeliveryLabels;
export const sameContactBinding = (a: ContactBinding, b: ContactBinding) => a.channel === b.channel && a.bindingId === b.bindingId && a.bindingVersion === b.bindingVersion;
export const contactMayAcknowledge = (attempt: ContactAttempt, userId: string) => attempt.recipientUserId === userId && attempt.acknowledgedAt === null && ['sending', 'accepted', 'unknown'].includes(attempt.status);
export const contactName = (page: ContactPage, userId: string) => page.recipients.find(item => item.userId === userId)?.name ?? '目前未列出的接收者';
