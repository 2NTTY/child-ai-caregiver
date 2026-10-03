import { usePreviewLeaveGuard } from "../../preview/PreviewNavigationGuard";
import {useEffect, useRef, useState} from 'react';
import {View} from 'react-native';
import {HelperText, Text} from 'react-native-paper';
import {Controller, useForm, useWatch, useFormState } from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import type {TaskView} from '../../task-view-model';
import type {ContactActions, ContactViewModel} from '../../contact-view-model';
import {contactChannelLabels, contactName} from '../../contact-view-model';
import {summaryTime} from '../../summary-view-model';
import {taskStateLabels} from '../../task-view-model';
import {AppCheckbox} from '../AppCheckbox';
import {AppDateTimeField, AppTimeZoneSelect} from '../DateTimeFields';
import {AppButton, AppSelect, SectionCard, SectionHeader} from '../ui';
import {contactBackupRecipients, contactGrantFormSchema, contactGrantProjection, contactRevokeProjection, emptyContactGrant, type GrantFormValues} from './contact-form';
import {MotionDisclosure, MotionFeedback} from '../../motion';
import {contactStyles as s} from './contact-styles';

export function ContactTaskCard({task, missing, model, actions, onTask}: {task: TaskView; missing: boolean; model: ContactViewModel; actions: ContactActions; onTask: (id: string) => void}) {
  const page = model.page!, grant = page.grants.find(item => item.taskId === task.id), primary = page.recipients.find(item => item.userId === task.assigneeUserId), backups = contactBackupRecipients(page, task.assigneeUserId);
  const basis = useRef({taskVersion: task.version, grantVersion: grant?.version ?? 0}), [open, setOpen] = useState(false), [confirm, setConfirm] = useState(false), [revoke, setRevoke] = useState(false), [adopt, setAdopt] = useState(false);
  const defaults: GrantFormValues = grant ? {...emptyContactGrant(), allowFollowUp: grant.allowFollowUp, allowFallback: grant.allowFallback, backupUserId: grant.backupUserId ?? '', validUntil: grant.validUntil, timeZone: task.occurrence.timeZone} : {...emptyContactGrant(), timeZone: task.occurrence.timeZone};
  const {control, handleSubmit, setValue} = useForm<GrantFormValues>({defaultValues: defaults, resolver: zodResolver(contactGrantFormSchema(backups.map(item => item.userId)))});
  const { isDirty } = useFormState({ control });
  usePreviewLeaveGuard(isDirty);
  const values = useWatch({control}) as GrantFormValues, parsed = contactGrantFormSchema(backups.map(item => item.userId)).safeParse(values);
  const stale = basis.current.taskVersion !== task.version || basis.current.grantVersion !== (grant?.version ?? 0), editable = !model.locked && !missing;
  const eligible = task.occurrence.state === 'scheduled' && !!primary?.enabled && primary.channels.length > 0;
  const backupValid = !values.backupUserId || backups.some(item => item.userId === values.backupUserId);
  useEffect(() => {setConfirm(false); setRevoke(false); setAdopt(false);}, [model.confirmationEpoch]);
  function edit() {actions.markDirty(`grant:${task.id}`); setConfirm(false); setRevoke(false); setAdopt(false);}
  const backupOptions = [{value: '', label: '沒有指定後備接收者'}, ...backups.map(item => ({value: item.userId, label: item.name})), ...(!backupValid ? [{value: values.backupUserId, label: '原後備已不符合資格（保留原選項）'}] : [])];
  return <SectionCard testID={`contact-task-${task.id}`}><SectionHeader density="compact" title={task.title} icon="clipboard-check-outline" />
    <Text style={s.body}>事項：{taskStateLabels[task.occurrence.state]} · 目前任務版本 {task.version}</Text><Text style={s.meta}>到期：{summaryTime(task.occurrence.dueAt, task.occurrence.timeZone)} · {task.occurrence.timeZone}</Text>
    <Text style={s.body}>主要接收者：{contactName(page, task.assigneeUserId)}（依任務負責人）</Text><Text style={s.meta}>目前渠道：{primary?.channels.map(channel => contactChannelLabels[channel]).join('、') || '沒有可接收渠道'}</Text>
    {grant ? <View style={s.box}><MotionFeedback active={model.operation === 'saved'} triggerKey={`${grant.enabled}:${grant.version}`} scopeKey={`${model.scopeKey}:${task.id}`}><Text style={s.body}>已保存授權：{grant.enabled ? '開啟' : '撤回'} · 版本 {grant.version} · 任務依據 {grant.taskVersion}</Text></MotionFeedback><Text style={s.meta}>期限：{summaryTime(grant.validUntil)} · 跟進：{grant.allowFollowUp ? '最多一次' : '不允許'} · 已知失敗切換：{grant.allowFallback ? '允許' : '不允許'}</Text><Text style={s.meta}>後備：{grant.backupUserId ? contactName(page, grant.backupUserId) : '沒有'}</Text>{grant.enabled && (Date.parse(grant.validUntil) <= Date.now() || grant.taskVersion !== task.version) ? <Text style={s.warning}>保存的授權已過期或任務依據已變；不能當作目前可執行。仍可明確撤回。</Text> : null}</View> : <Text style={s.meta}>這個任務尚無已保存聯絡授權。</Text>}
    {missing ? <Text style={s.warning}>這是保留草稿的原任務；已不在目前有限清單。沒有推定已刪除，不能據此提交新授權。</Text> : null}
    <View style={s.row}><AppButton label="查看這個任務" variant="quiet" onPress={() => onTask(task.id)} /><AppButton label={open ? '收起任務聯絡選項' : '管理任務聯絡授權'} variant="secondary" onPress={() => setOpen(value => !value)} /></View>
    <MotionDisclosure expanded={open} scopeKey={`${model.scopeKey}:${task.id}`}><View style={s.stack}>
      <Text style={s.meta}>未提交選項基準：任務 {basis.current.taskVersion} · 授權 {basis.current.grantVersion}</Text>
      <Text style={s.body}>只在任務到期時發送一般提示；不包含孩子原文或任意訊息，不會立即發送。</Text>
      {!eligible ? <Text style={s.warning}>只有已排期且負責人已同意可用渠道的任務可開啟授權。已有授權仍可撤回。</Text> : null}
      <Controller name="allowFollowUp" control={control} render={({field}) => <AppCheckbox label="允許最多一次到期後跟進" checked={field.value} disabled={!editable} onChange={value => {field.onChange(value); edit();}} />} />
      <Controller name="allowFallback" control={control} render={({field}) => <AppCheckbox label="只在明確投遞失敗時允許渠道及後備切換" checked={field.value} disabled={!editable} onChange={value => {field.onChange(value); if (!value) setValue('backupUserId', '', {shouldDirty: true}); edit();}} />} />
      <Controller name="backupUserId" control={control} render={({field}) => <AppSelect label="後備接收者" value={field.value} options={backupOptions} disabled={!editable || !values.allowFallback} onChange={value => {field.onChange(value); edit();}} />} />
      <Controller name="timeZone" control={control} render={({field}) => <AppTimeZoneSelect value={field.value} disabled={!editable} onChange={value => {field.onChange(value); edit();}} />} />
      <Controller name="validUntil" control={control} render={({field}) => <AppDateTimeField label="聯絡授權期限" timeZone={values.timeZone} value={field.value} disabled={!editable} onChange={value => {field.onChange(value); edit();}} />} />
      {!parsed.success ? <HelperText type="error">{parsed.error.issues[0]?.message}</HelperText> : null}
      <Text style={s.meta}>期限須明確且不超過 365 日。投遞結果未知或仍處理中時，不會按已知失敗規則切換。</Text>
      {stale ? <View style={s.box}><Text style={s.warning}>任務或授權版本已改變；原選項保留，請核對最新負責人、期限及同意。</Text><AppCheckbox label="我已核對這個任務與授權的最新版本" checked={adopt} disabled={!editable} onChange={setAdopt} /><AppButton label="保留選項並採用最新任務授權版本" variant="secondary" disabled={!editable || !adopt} onPress={() => {basis.current = {taskVersion: task.version, grantVersion: grant?.version ?? 0}; edit();}} /></View> : null}
      <AppCheckbox label="我確認以上接收者、一般提示及聯絡期限" checked={confirm} disabled={!editable || stale || !eligible || !parsed.success} onChange={setConfirm} />
      <AppButton label="確認保存任務聯絡授權" disabled={!editable || stale || !eligible || !parsed.success || !confirm} onPress={handleSubmit(value => {edit(); actions.save({kind: 'authorization', taskId: task.id, input: contactGrantProjection(value, basis.current.taskVersion, basis.current.grantVersion)}, [task.title, `主要接收者：${contactName(page, task.assigneeUserId)}`, `後備：${value.backupUserId ? contactName(page, value.backupUserId) : '沒有'}`, `期限：${summaryTime(value.validUntil, value.timeZone)}`, value.allowFollowUp ? '最多一次跟進' : '不跟進', value.allowFallback ? '只在明確失敗時切換' : '不切換']);})} />
      {grant?.enabled ? <View style={s.item}><AppCheckbox label="我確認撤回這個任務的已保存聯絡授權" checked={revoke} disabled={!editable || stale} onChange={setRevoke} /><AppButton label="確認撤回任務聯絡授權" variant="secondary" disabled={!editable || stale || !revoke} onPress={() => {edit(); actions.save({kind: 'authorization', taskId: task.id, input: contactRevokeProjection(grant, task.version)}, [task.title, '撤回已保存授權；不保證召回已在投遞中的通知']);}} /><Text style={s.meta}>撤回沿已保存選項及期限，不要求為撤回另填新期限；不能保證召回已在處理中的投遞。</Text></View> : null}
    </View></MotionDisclosure>
  </SectionCard>;
}
