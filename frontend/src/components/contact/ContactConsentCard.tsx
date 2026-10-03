import { usePreviewLeaveGuard } from "../../preview/PreviewNavigationGuard";
import {useEffect, useRef, useState} from 'react';
import {View} from 'react-native';
import {HelperText, Text} from 'react-native-paper';
import {useForm, useWatch, useFormState } from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import type {ContactActions, ContactBinding, ContactViewModel} from '../../contact-view-model';
import {contactChannelLabels, sameContactBinding} from '../../contact-view-model';
import {AppCheckbox} from '../AppCheckbox';
import {AppButton, SectionCard, SectionHeader} from '../ui';
import {contactConsentFormSchema, contactConsentProjection, type ConsentFormValues} from './contact-form';
import {contactStyles as s} from './contact-styles';

export function ContactConsentCard({model, actions, onSettings}: {model: ContactViewModel; actions: ContactActions; onSettings: () => void}) {
  const page = model.page!, basis = useRef(page.consent.version), [confirm, setConfirm] = useState(false), [adopt, setAdopt] = useState(false);
  const {control, setValue, handleSubmit} = useForm<ConsentFormValues>({defaultValues: {enabled: page.consent.enabled, allowBackup: page.consent.allowBackup, bindings: page.consent.bindings.map(item => ({...item}))}, resolver: zodResolver(contactConsentFormSchema(page.availableBindings))});
  const { isDirty } = useFormState({ control });
  usePreviewLeaveGuard(isDirty);
  const values = useWatch({control}) as ConsentFormValues, parsed = contactConsentFormSchema(page.availableBindings).safeParse(values), stale = basis.current !== page.consent.version;
  const editable = !model.locked;
  useEffect(() => {setConfirm(false); setAdopt(false);}, [model.confirmationEpoch]);
  function edit() {actions.markDirty('consent'); setConfirm(false); setAdopt(false);}
  function choose(binding: ContactBinding, selected: boolean) {setValue('bindings', selected ? [...values.bindings.filter(item => item.channel !== binding.channel), {...binding}] : values.bindings.filter(item => !sameContactBinding(item, binding)), {shouldDirty: true}); edit();}
  return <SectionCard testID="contact-consent"><SectionHeader density="compact" title="本人的接收同意" icon="bell-outline" subtitle={`只管理你在${model.childName}這個資料空間的同意，不代其他家庭成員同意。`} />
    <Text style={s.body}>已保存：{page.consent.enabled ? '允許接收' : '未允許接收'} · 後備資格：{page.consent.allowBackup ? '已同意' : '未同意'}</Text>
    <Text style={s.meta}>已保存版本 {page.consent.version} · 未提交選項基準 {basis.current}</Text>
    <Text style={s.meta}>已保存渠道次序：{page.consent.bindings.length ? page.consent.bindings.map(item => contactChannelLabels[item.channel]).join(' → ') : '沒有'}</Text>
    <AppButton label="到設定管理本人渠道綁定" variant="quiet" onPress={onSettings} />
    {!page.availableBindings.length ? <Text style={s.meta}>目前沒有可選的本人綁定；先到設定綁定渠道。仍可撤回已有同意。</Text> : null}
    <AppCheckbox label="允許透過以下本人渠道接收一般任務提示" checked={values.enabled} disabled={!editable} onChange={value => {setValue('enabled', value, {shouldDirty: true}); edit();}} />
    <AppCheckbox label="我也同意具備這個孩子的後備接收資格" checked={values.allowBackup} disabled={!editable || !values.enabled} onChange={value => {setValue('allowBackup', value, {shouldDirty: true}); edit();}} />
    <Text style={s.title}>已綁定渠道 · 每種最多一個</Text>
    {page.availableBindings.map(binding => <AppCheckbox key={binding.bindingId} label={`${contactChannelLabels[binding.channel]} · ${binding.label}`} checked={values.bindings.some(item => sameContactBinding(item, binding))} disabled={!editable || !values.enabled} onChange={value => choose(binding, value)} />)}
    {values.bindings.map((binding, index) => <View key={binding.bindingId} style={s.box}><Text style={s.body}>{index + 1}. {contactChannelLabels[binding.channel]} · {page.availableBindings.find(item => sameContactBinding(item, binding))?.label ?? '原綁定已不在可用清單（保留原選項）'}</Text>
      <View style={s.row}><AppButton label={`向前移動${contactChannelLabels[binding.channel]}`} variant="quiet" disabled={!editable || !values.enabled || index === 0} onPress={() => {const next = [...values.bindings]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; setValue('bindings', next, {shouldDirty: true}); edit();}} />
        <AppButton label={`移除${contactChannelLabels[binding.channel]}接收選項`} variant="quiet" disabled={!editable || !values.enabled} onPress={() => choose(binding, false)} /></View></View>)}
    <Text style={s.meta}>只在渠道明確拒絕、且任務已授權切換時，才按上述次序嘗試下一個；處理中或結果未知不盲目重送。</Text>
    {!values.enabled ? <Text style={s.body}>保存撤回時，後備同意及接收次序會一併清除；不會刪除設定中的渠道綁定。</Text> : null}
    {!parsed.success ? <HelperText type="error">{parsed.error.issues[0]?.message}</HelperText> : null}
    {stale ? <View style={s.box}><Text style={s.warning}>本人同意版本已改變。原選項保留，請核對上方最新狀態及目前渠道。</Text><AppCheckbox label="我已核對本人同意的最新版本與渠道" checked={adopt} disabled={!editable} onChange={setAdopt} /><AppButton label="保留選項並採用最新同意版本" variant="secondary" disabled={!editable || !adopt} onPress={() => {basis.current = page.consent.version; edit();}} /></View> : null}
    <AppCheckbox label="我確認保存以上本人接收及後備同意" checked={confirm} disabled={!editable || stale || !parsed.success} onChange={setConfirm} />
    <AppButton label="確認保存本人接收同意" disabled={!editable || stale || !parsed.success || !confirm} onPress={handleSubmit(value => {actions.markDirty('consent'); const input = contactConsentProjection(value, basis.current); actions.save({kind: 'consent', input}, [input.enabled ? '允許本人接收一般提示' : '撤回本人接收同意', input.allowBackup ? '同意後備資格' : '沒有後備資格', `渠道次序：${input.bindings.map(item => contactChannelLabels[item.channel]).join(' → ') || '沒有'}`]);})} />
  </SectionCard>;
}
