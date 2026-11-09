import {z} from 'zod';
import type {ContactBinding, ContactConsentDecision, ContactGrant, ContactGrantDecision, ContactPage} from '../../contact-view-model.ts';
import {sameContactBinding} from '../../contact-view-model.ts';

const binding = z.object({channel: z.enum(['web_push', 'telegram', 'native_push']), bindingId: z.uuid(), bindingVersion: z.number().int().positive()});
export function contactConsentFormSchema(available: ContactBinding[]) {return z.object({enabled: z.boolean(), allowBackup: z.boolean(), bindings: z.array(binding).max(3)}).superRefine((value, context) => {
  if (value.enabled && (!value.bindings.length || new Set(value.bindings.map(item => item.channel)).size !== value.bindings.length || value.bindings.some(item => !available.some(current => sameContactBinding(current, item))))) context.addIssue({code: 'custom', path: ['bindings'], message: '每渠道最多選一個目前可用的本人綁定，至少選一個。'});
});}
export type ConsentFormValues = {enabled: boolean; allowBackup: boolean; bindings: ContactBinding[]};
export const contactConsentProjection = (value: ConsentFormValues, expectedVersion: number): ContactConsentDecision => ({expectedVersion, enabled: value.enabled, allowBackup: value.enabled && value.allowBackup, bindings: value.enabled ? value.bindings.map(item => ({...item})) : [], confirm: true});
export interface GrantFormValues {allowFollowUp: boolean; allowFallback: boolean; backupUserId: string; validUntil: string; timeZone: string}
export const emptyContactGrant = (): GrantFormValues => ({allowFollowUp: false, allowFallback: false, backupUserId: '', validUntil: '', timeZone: 'Asia/Hong_Kong'});
export const contactExpiryValid = (value: string, now = Date.now()) => z.iso.datetime({offset: true}).safeParse(value).success && Date.parse(value) > now && Date.parse(value) <= now + 365 * 86400000;
export function contactGrantFormSchema(backupIds: string[], now = Date.now()) {return z.object({allowFollowUp: z.boolean(), allowFallback: z.boolean(), backupUserId: z.string(), validUntil: z.string(), timeZone: z.string()}).superRefine((value, context) => {
  if (!contactExpiryValid(value.validUntil, now)) context.addIssue({code: 'custom', path: ['validUntil'], message: '請選擇將來的明確期限，最長 365 日。'});
  if (value.backupUserId && (!value.allowFallback || !backupIds.includes(value.backupUserId))) context.addIssue({code: 'custom', path: ['backupUserId'], message: '後備須已同意接收及後備資格，並啟用已知失敗切換。'});
});}
export const contactBackupRecipients = (page: ContactPage, primaryUserId: string) => page.recipients.filter(item => item.userId !== primaryUserId && item.enabled && item.allowBackup && item.channels.length > 0);
export function contactGrantProjection(value: GrantFormValues, expectedTaskVersion: number, expectedVersion: number): ContactGrantDecision {return {expectedVersion, expectedTaskVersion, enabled: true, allowFollowUp: value.allowFollowUp, allowFallback: value.allowFallback, backupUserId: value.allowFallback ? value.backupUserId || null : null, validUntil: value.validUntil, confirm: true, content: 'generic_notice', trigger: 'task_due'};}
export const contactRevokeProjection = (grant: ContactGrant, currentTaskVersion: number): ContactGrantDecision => ({expectedVersion: grant.version, expectedTaskVersion: currentTaskVersion, enabled: false, allowFollowUp: grant.allowFollowUp, allowFallback: grant.allowFallback, backupUserId: grant.backupUserId, validUntil: grant.validUntil, confirm: true, content: 'generic_notice', trigger: 'task_due'});
