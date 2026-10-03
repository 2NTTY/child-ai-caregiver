import { usePreviewLeaveGuard } from "../../preview/PreviewNavigationGuard";
import {useEffect, useRef, useState} from 'react';
import {View} from 'react-native';
import {HelperText, Text} from 'react-native-paper';
import {Controller, useFieldArray, useForm, useWatch, useFormState } from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import type {SummaryActions, SummaryViewModel} from '../../summary-view-model';
import {summaryBasis, summaryBasisChanged, summaryPeriodLabel, summaryTime} from '../../summary-view-model';
import {AppCheckbox} from '../AppCheckbox';
import {AppButton, AppSelect, AppTextField, SectionCard, SectionHeader} from '../ui';
import {preparationDefaults, preparationFormSchema, preparationProjection, type PreparationFormValues} from './summary-form';
import {summaryStyles as s} from './summary-styles';

export function PreparationCard({model, actions}: {model: SummaryViewModel; actions: SummaryActions}) {
  const page = model.page!;
  const basis = useRef(summaryBasis(page));
  const [shared, setShared] = useState(false), [basisConsent, setBasisConsent] = useState(false);
  const {control, handleSubmit, setValue} = useForm<PreparationFormValues>({defaultValues: preparationDefaults(page), resolver: zodResolver(preparationFormSchema), mode: 'onBlur'});
  const { isDirty } = useFormState({ control });
  usePreviewLeaveGuard(isDirty);
  const questions = useFieldArray({control, name: 'questions'}), checklist = useFieldArray({control, name: 'checklist'});
  const values = useWatch({control}), parsed = preparationFormSchema.safeParse(values);
  const stale = summaryBasisChanged(basis.current, page);
  const fieldsAvailable = model.online && !model.readFailed && !model.pending && model.access === 'editable' && page.canManage;
  const editable = fieldsAvailable && !model.busy;
  const appointmentValid = !values.appointmentTaskId || page.appointments.some(task => task.id === values.appointmentTaskId);
  useEffect(() => {setShared(false); setBasisConsent(false);}, [model.confirmationEpoch]);
  function edit(reviewChange = false) {actions.markDirty(); setShared(false); setBasisConsent(false); if (!reviewChange) setValue('reviewed', false, {shouldDirty: true});}
  function field(name: `questions.${number}.text` | `checklist.${number}.text`, label: string) {return <Controller name={name} control={control} render={({field: input, fieldState}) => <View>
    <AppTextField ref={input.ref} label={label} accessibilityLabel={label} value={input.value} multiline disabled={!fieldsAvailable} editable={editable} error={!!fieldState.error} onBlur={input.onBlur} onChangeText={value => {if (!editable) return; input.onChange(value); edit();}} />
    {fieldState.error ? <HelperText type="error">{fieldState.error.message}</HelperText> : null}</View>} />;}
  const appointmentOptions = [{value: '', label: '沒有指定預約'}, ...page.appointments.map(task => ({value: task.id, label: `${task.title} · ${summaryTime(task.occurrence.dueAt, task.occurrence.timeZone)}`})), ...(!appointmentValid && values.appointmentTaskId ? [{value: values.appointmentTaskId, label: '原預約已不在目前清單（保留草稿）'}] : [])];
  return <SectionCard testID="summary-preparation"><SectionHeader density="compact" title="家庭共享到診準備" icon="clipboard-check-outline" subtitle="問題、清單、預約選擇及核對標記會共享給有權讀取這個孩子的家庭成員。" />
    <Text style={s.meta}>已保存版本 {page.preparation.version} · {page.preparation.reviewed ? '曾標記已核對' : '未核對'}。目前來源：{page.reviewCurrent ? '仍與全部來源吻合' : '未核對或來源已變，須重新核對'}。</Text>
    <Text selectable style={s.meta}>已保存核對依據：{page.preparation.reviewedBasis ?? '沒有'} · 期間：{page.preparation.period ? summaryPeriodLabel(page.preparation.period) : '沒有'}</Text>
    <Text style={s.meta}>已保存預約：{page.preparation.appointmentTaskId ? page.appointments.find(task => task.id === page.preparation.appointmentTaskId)?.title ?? page.preparation.appointmentTaskId : '沒有指定'}</Text>
    {page.preparation.updatedAt ? <Text style={s.meta}>最後保存：{page.preparation.updatedBy} · {summaryTime(page.preparation.updatedAt)}</Text> : null}
    {!page.canManage ? <Text style={s.warning}>目前只有檢視權限，不能修改或保存。</Text> : null}
    <Text selectable style={s.meta}>草稿基準：共享準備版本 {basis.current.expectedVersion} · {basis.current.basisVersion} · {summaryPeriodLabel(basis.current.period)}</Text>
    {model.dirty ? <View style={s.box}><Text style={s.title}>目前已保存內容，供比較</Text>{page.preparation.questions.map((text, index) => <Text key={index} style={s.body}>已保存問題 {index + 1}：{text}</Text>)}{page.preparation.checklist.map((item, index) => <Text key={index} style={s.body}>已保存準備 {index + 1}：{item.done ? '已完成' : '未完成'} · {item.text}</Text>)}<Text style={s.meta}>本頁未保存草稿及原依據保留，更新摘要不會悄悄覆寫。</Text></View> : null}
    {stale ? <View style={s.box}><Text style={s.warning}>草稿與目前摘要／共享準備版本不同，不能直接保存。先核對來源及家庭成員的最新修改。</Text>
      <AppCheckbox label="我已核對最新來源及共享準備，保留草稿並採用目前依據" checked={basisConsent} disabled={!editable} onChange={setBasisConsent} />
      <AppButton label="明確改用目前摘要依據" variant="secondary" disabled={!editable || !basisConsent} onPress={() => {basis.current = summaryBasis(page); edit();}} /></View> : null}
    <Controller name="appointmentTaskId" control={control} render={({field: input}) => <AppSelect label="到診預約安排" value={input.value} options={appointmentOptions} disabled={!editable} onChange={value => {input.onChange(value); edit();}} />} />
    {!appointmentValid ? <HelperText type="error">原預約已不在目前待處理清單；請明確另選或選「沒有指定」，不會自動移除。</HelperText> : null}
    <Text style={s.title}>到診問題 · 最多 12 條</Text>
    {questions.fields.map((item, index) => <View key={item.id} style={s.item}>{field(`questions.${index}.text`, `到診問題 ${index + 1}`)}<AppButton label={`移除到診問題 ${index + 1}`} variant="quiet" disabled={!editable} onPress={() => {questions.remove(index); edit();}} /></View>)}
    {!questions.fields.length ? <Text style={s.meta}>尚未記錄問題；不會由模型替你新增已確認內容。</Text> : null}
    <AppButton label="新增到診問題" variant="secondary" disabled={!editable || questions.fields.length >= 12} onPress={() => {questions.append({text: ''}); edit();}} />
    <Text style={s.title}>準備清單 · 最多 16 項</Text>
    {checklist.fields.map((item, index) => <View key={item.id} style={s.item}>{field(`checklist.${index}.text`, `到診準備 ${index + 1}`)}
      <Controller name={`checklist.${index}.done`} control={control} render={({field: input}) => <AppCheckbox label={`到診準備 ${index + 1} 已完成`} checked={input.value} disabled={!editable} onChange={value => {input.onChange(value); edit();}} />} />
      <AppButton label={`移除到診準備 ${index + 1}`} variant="quiet" disabled={!editable} onPress={() => {checklist.remove(index); edit();}} /></View>)}
    <AppButton label="新增到診準備" variant="secondary" disabled={!editable || checklist.fields.length >= 16} onPress={() => {checklist.append({text: '', done: false}); edit();}} />
    <Text style={s.meta}>問題最多 500 字，準備項目最多 300 字；不截短。依正式契約，保存內容會移除兩端空白；原草稿保留，下方顯示實際保存內容。</Text>
    {parsed.success ? <View style={s.box} testID="summary-save-review"><Text style={s.title}>保存前核對</Text>{parsed.data.questions.map((item, index) => <Text key={index} selectable style={s.body}>問題 {index + 1}：{item.text}</Text>)}{parsed.data.checklist.map((item, index) => <Text key={index} selectable style={s.body}>準備 {index + 1}：{item.done ? '已完成' : '未完成'} · {item.text}</Text>)}<Text style={s.meta}>核對標記：{parsed.data.reviewed ? '已核對' : '未核對'}</Text></View> : <HelperText type="error">請核對空白欄位及字數；不會自動刪項或截短。</HelperText>}
    <Controller name="reviewed" control={control} render={({field: input}) => <AppCheckbox label="我已逐項核對問題、準備清單及目前摘要來源" checked={input.value} disabled={!editable || stale} onChange={value => {input.onChange(value); edit(true);}} />} />
    <AppCheckbox label="我確認把以上到診準備與有權家庭成員共享" checked={shared} disabled={!editable || stale || !parsed.success || !appointmentValid} onChange={setShared} />
    <AppButton label="確認保存家庭共享到診準備" disabled={!editable || stale || !shared || !parsed.success || !appointmentValid} onPress={handleSubmit(raw => {actions.markDirty(); const input = preparationProjection(raw, basis.current); actions.save(input, page.appointments.find(task => task.id === input.appointmentTaskId)?.title ?? '沒有指定預約');})} />
    {model.dirty ? <AppButton label="放棄草稿並載入已保存準備" variant="quiet" disabled={!model.online || model.busy || !!model.pending || model.readFailed} onPress={actions.discard} /> : null}
  </SectionCard>;
}
