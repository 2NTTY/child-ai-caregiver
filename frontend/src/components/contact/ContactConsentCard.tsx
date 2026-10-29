import { RouteTextLink } from "../RouteTextLink";
import { JournalSection } from "../journal/JournalLayout";
import { AppStatusBadge } from "../AppStatusBadge";
import { usePreviewLeaveGuard } from "../../preview/PreviewNavigationGuard";
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Platform, View} from 'react-native';
import {HelperText, Text} from 'react-native-paper';
import {useForm, useWatch, useFormState } from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import type {ContactActions, ContactBinding, ContactViewModel} from '../../contact-view-model';
import {contactChannelLabels, sameContactBinding} from '../../contact-view-model';
import {AppCheckbox} from '../AppCheckbox';
import {AppButton} from '../ui';
import {contactConsentFormSchema, contactConsentProjection, type ConsentFormValues} from './contact-form';
import {MotionDisclosure, MotionFeedback, MotionList} from '../../motion';
import {useContactFeedback} from './contact-motion';
import {contactStyles as s} from './contact-styles';

type ContactConsentProps = {model: ContactViewModel; actions: ContactActions};
export function ContactConsentCard(props: ContactConsentProps) {
  const {model} = props, page = model.page!;
  const [editing, setEditing] = useState(false);
  const feedback = useContactFeedback(model, 'consent', JSON.stringify([page.consent.enabled, page.consent.allowBackup, page.consent.bindings]));
  return <JournalSection testID="contact-consent" title="本人的接收同意" description={`只管理你在${model.childName}這個資料空間的同意，不代其他家庭成員同意。`} action={<AppButton expanded={editing} label={editing ? "收起選項" : "管理同意"} accessibilityLabel={editing ? "收起本人接收選項" : "管理本人接收同意"} density="compact" variant="secondary" onPress={() => setEditing(value => !value)} />}>
    <MotionFeedback active={model.operation === 'saved' && !model.busy && !model.pending && model.load === 'ready'} triggerKey={feedback.trigger} scopeKey={feedback.scopeKey} style={s.stack} testID="contact-consent-feedback">
      <View style={s.row}><AppStatusBadge label={page.consent.enabled ? '已允許接收' : '未允許接收'} tone={page.consent.enabled ? 'success' : 'neutral'} /><AppStatusBadge label={page.consent.allowBackup ? '後備接收已同意' : '後備接收未同意'} tone={page.consent.allowBackup ? 'success' : 'neutral'} /></View>
      <Text style={s.meta}>已保存版本 {page.consent.version}</Text>
      <Text style={s.meta}>已保存渠道次序：{page.consent.bindings.length ? page.consent.bindings.map(item => contactChannelLabels[item.channel]).join(' → ') : '沒有'}</Text>
    </MotionFeedback>
    <MotionDisclosure expanded={editing} scopeKey={`${model.scopeKey}:${model.userId}`}><View style={s.editor}><ContactConsentForm key={model.epoch} {...props} /></View></MotionDisclosure>
  </JournalSection>;
}
function ContactConsentForm({model, actions}: ContactConsentProps) {
  const page = model.page!, basis = useRef(page.consent.version), [confirm, setConfirm] = useState(false), [adopt, setAdopt] = useState(false);
  const {control, setValue, handleSubmit} = useForm<ConsentFormValues>({defaultValues: {enabled: page.consent.enabled, allowBackup: page.consent.allowBackup, bindings: page.consent.bindings.map(item => ({...item}))}, resolver: zodResolver(contactConsentFormSchema(page.availableBindings))});
  const { isDirty } = useFormState({ control });
  usePreviewLeaveGuard(isDirty);
  const values = useWatch({control}) as ConsentFormValues, parsed = contactConsentFormSchema(page.availableBindings).safeParse(values), stale = basis.current !== page.consent.version;
  const rowRefs = useRef(new Map<string, View>()), choiceRefs = useRef(new Map<string, View>()), removeRefs = useRef(new Map<string, View>()), listFocusRef = useRef<View>(null);
  const listScope = `${model.scopeKey}:${model.userId}:${model.access}:${model.epoch}`;
  const bindingFocus = useRef<{scope: string; kind: 'remove' | 'move'; sourceId: string; targets: string[]; expectedOrder?: string; control?: HTMLElement} | null>(null);
  const editable = !model.locked;
  useEffect(() => {setConfirm(false); setAdopt(false);}, [model.confirmationEpoch]);
  useLayoutEffect(() => {
    const intent = bindingFocus.current;
    if (!intent || Platform.OS !== 'web') return;
    if (intent.scope !== listScope || !editable || !values.enabled) {bindingFocus.current = null; return;}
    const liveIds = new Set(values.bindings.map(item => `${item.channel}:${item.bindingId}`));
    if (intent.kind === 'remove' ? liveIds.has(intent.sourceId) : [...liveIds].join('\u0000') !== intent.expectedOrder) return;
    bindingFocus.current = null;
    // The new index and disabled states are committed. Prefer a row control
    // whose eligibility does not change when that row becomes the first row.
    const candidates = [intent.control, ...intent.targets.filter(id => liveIds.has(id)).map(id => removeRefs.current.get(id)), choiceRefs.current.get(intent.sourceId), listFocusRef.current];
    for (const candidate of candidates) {
      const surface = candidate as unknown as HTMLElement | null | undefined;
      const target = candidate === listFocusRef.current || surface?.matches('button,[role="button"],[role="checkbox"],[tabindex="0"]') ? surface : surface?.querySelector<HTMLElement>('button,[role="button"],[tabindex="0"]');
      if (!target?.isConnected || !target.getClientRects().length || target.hasAttribute('disabled') || target.getAttribute('aria-disabled') === 'true' || target.closest('[inert]')) continue;
      target.focus({preventScroll: true});
      if (document.activeElement === target) break;
    }
  }, [values.bindings, values.enabled, editable, listScope]);
  function edit() {actions.markDirty('consent'); setConfirm(false); setAdopt(false);}
  function choose(binding: ContactBinding, selected: boolean) {
    const id = `${binding.channel}:${binding.bindingId}`, row = rowRefs.current.get(id) as unknown as HTMLElement | undefined;
    bindingFocus.current = null;
    if (!selected && Platform.OS === 'web' && row?.contains(document.activeElement)) {
      const index = values.bindings.findIndex(item => sameContactBinding(item, binding));
      const survivors = [...values.bindings.slice(index + 1), ...values.bindings.slice(0, index).reverse()];
      bindingFocus.current = {scope: listScope, kind: 'remove', sourceId: id, targets: survivors.map(item => `${item.channel}:${item.bindingId}`)};
    }
    setValue('bindings', selected ? [...values.bindings.filter(item => item.channel !== binding.channel), {...binding}] : values.bindings.filter(item => !sameContactBinding(item, binding)), {shouldDirty: true}); edit();
  }
  function moveForward(binding: ContactBinding) {
    const index = values.bindings.findIndex(item => sameContactBinding(item, binding));
    if (!editable || !values.enabled || index <= 0) return;
    const next = [...values.bindings];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    const id = `${binding.channel}:${binding.bindingId}`, row = rowRefs.current.get(id) as unknown as HTMLElement | undefined;
    bindingFocus.current = Platform.OS === 'web' && row?.contains(document.activeElement)
      ? {scope: listScope, kind: 'move', sourceId: id, targets: [id], expectedOrder: next.map(item => `${item.channel}:${item.bindingId}`).join('\u0000'), control: document.activeElement as HTMLElement} : null;
    setValue('bindings', next, {shouldDirty: true}); edit();
  }
  return <><Text style={s.meta}>未提交選項基準 {basis.current}</Text>
    <RouteTextLink href={{pathname: "/settings", params: {section: "notifications"}}} label="管理本人通知渠道" />
    {!page.availableBindings.length ? <Text style={s.meta}>目前沒有可選的本人綁定；先到設定綁定渠道。仍可撤回已有同意。</Text> : null}
    <AppCheckbox label="允許透過以下本人渠道接收一般任務提示" checked={values.enabled} disabled={!editable} onChange={value => {setValue('enabled', value, {shouldDirty: true}); edit();}} />
    <AppCheckbox label="我也同意具備這個孩子的後備接收資格" checked={values.allowBackup} disabled={!editable || !values.enabled} onChange={value => {setValue('allowBackup', value, {shouldDirty: true}); edit();}} />
    <JournalSection level={3} title="選擇接收渠道" description="每種渠道最多一個；下方次序只用於已明確授權的失敗切換。">
    {page.availableBindings.map(binding => <AppCheckbox key={`${binding.channel}:${binding.bindingId}`} ref={node => {const id = `${binding.channel}:${binding.bindingId}`; if (node) choiceRefs.current.set(id, node); else choiceRefs.current.delete(id);}} label={`${contactChannelLabels[binding.channel]}（${binding.label}）`} checked={values.bindings.some(item => sameContactBinding(item, binding))} disabled={!editable || !values.enabled} onChange={value => choose(binding, value)} />)}
    <View ref={listFocusRef} tabIndex={-1}><MotionList items={values.bindings.map((binding, index) => ({...binding, index}))} keyExtractor={binding => `${binding.channel}:${binding.bindingId}`} scopeKey={listScope} regionKey="contact-consent-bindings" eligible={editable} style={s.stack} onBeforeExitFocus={removed => !!bindingFocus.current && bindingFocus.current.kind === 'remove' && bindingFocus.current.scope === listScope && removed.includes(bindingFocus.current.sourceId)} renderItem={(binding, {exiting}) => {
      const index = values.bindings.findIndex(item => sameContactBinding(item, binding));
      return <View ref={node => {const id = `${binding.channel}:${binding.bindingId}`; if (node) rowRefs.current.set(id, node); else rowRefs.current.delete(id);}} style={s.box}><Text style={s.body}>{(index >= 0 ? index : binding.index) + 1}. {contactChannelLabels[binding.channel]}（{page.availableBindings.find(item => sameContactBinding(item, binding))?.label ?? '原綁定已不在可用清單，保留原選項'}）</Text>
        <View style={s.row}><AppButton label={`向前移動${contactChannelLabels[binding.channel]}`} variant="quiet" disabled={!editable || !values.enabled || index <= 0 || exiting} onPress={() => moveForward(binding)} />
          <AppButton ref={node => {const id = `${binding.channel}:${binding.bindingId}`; if (node) removeRefs.current.set(id, node); else removeRefs.current.delete(id);}} label={`移除${contactChannelLabels[binding.channel]}接收選項`} variant="quiet" disabled={!editable || !values.enabled || index < 0 || exiting} onPress={() => choose(binding, false)} /></View></View>;
    }} /></View>
    </JournalSection>
    <Text style={s.meta}>只在渠道明確拒絕、且任務已授權切換時，才按上述次序嘗試下一個；處理中或結果未知不盲目重送。</Text>
    {!values.enabled ? <Text style={s.body}>保存撤回時，後備同意及接收次序會一併清除；不會刪除設定中的渠道綁定。</Text> : null}
    {!parsed.success ? <HelperText type="error">{parsed.error.issues[0]?.message}</HelperText> : null}
    {stale ? <View style={s.box}><Text style={s.warning}>本人同意版本已改變。原選項保留，請核對上方最新狀態及目前渠道。</Text><AppCheckbox label="我已核對本人同意的最新版本與渠道" checked={adopt} disabled={!editable} onChange={setAdopt} /><AppButton label="保留選項並採用最新同意版本" variant="secondary" disabled={!editable || !adopt} onPress={() => {basis.current = page.consent.version; edit();}} /></View> : null}
    <JournalSection level={3} title="確認這次同意" description="選項保存後才生效；不會在此發送通知。"><AppCheckbox label="我確認保存以上本人接收及後備同意" checked={confirm} disabled={!editable || stale || !parsed.success} onChange={setConfirm} />
    <AppButton label="確認保存本人接收同意" disabled={!editable || stale || !parsed.success || !confirm} onPress={handleSubmit(value => {actions.markDirty('consent'); const input = contactConsentProjection(value, basis.current); actions.save({kind: 'consent', input}, [input.enabled ? '允許本人接收一般提示' : '撤回本人接收同意', input.allowBackup ? '同意後備資格' : '沒有後備資格', `渠道次序：${input.bindings.map(item => contactChannelLabels[item.channel]).join(' → ') || '沒有'}`]);})} />
    </JournalSection>
  </>;
}
