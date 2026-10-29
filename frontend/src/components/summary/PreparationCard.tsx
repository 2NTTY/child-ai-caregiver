import { usePreviewLeaveGuard } from "../../preview/PreviewNavigationGuard";
import {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {Platform, View} from 'react-native';
import {HelperText, Text} from 'react-native-paper';
import {Controller, useFieldArray, useForm, useWatch, useFormState } from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import type {SummaryActions, SummaryViewModel} from '../../summary-view-model';
import {summaryBasis, summaryBasisChanged, summaryPeriodLabel, summaryTime} from '../../summary-view-model';
import {AppCheckbox} from '../AppCheckbox';
import {AppButton, AppSelect, AppTextField} from '../ui';
import {preparationDefaults, preparationFormSchema, preparationProjection, type PreparationFormValues} from './summary-form';
import {MotionFeedback, MotionList} from '../../motion';
import {summaryStyles as s} from './summary-styles';
import {AppStatusBadge} from '../AppStatusBadge';
import {PreparationSheet} from './PreparationSheet';
import {SummaryDisclosure} from './SummaryDisclosure';
import {EmptyListCard} from '../EmptyListCard';
import {FormErrorSummary, FormFieldMessage} from '../FormErrorSummary';

export type PreparationDraftStatus = {scopeKey: string; formEpoch: number; stale: boolean; appointmentMissing: boolean};
type PreparationProps = {model: SummaryViewModel; actions: SummaryActions; onAgent?: () => void; onRecord?: (id: string) => void; onTask?: (id: string) => void; onDraftStatusChange?: (status: PreparationDraftStatus) => void};
export function PreparationCard(props: PreparationProps) {
  const {model} = props, page = model.page!, scopeKey = `${model.scopeKey}:${model.access}`;
  const latest = useRef(props); latest.current = props;
  const departure = useRef<{ scope: string; epoch: number; resolve(accepted: boolean): void } | null>(null);
  const discardDraft = () => {
    const current = latest.current;
    if (current.model.scopeKey !== model.scopeKey || current.model.formEpoch !== model.formEpoch || current.model.access === 'lost') return false;
    // Submitted originals already live in the owner. The existing navigation
    // guard still decides which destinations can retain that pending operation.
    if (current.model.pending) return true;
    if (!current.model.dirty) return true;
    if (!current.actions.discard()) return false;
    return new Promise<boolean>(resolve => { departure.current = {scope: model.scopeKey, epoch: model.formEpoch, resolve}; });
  };
  useEffect(() => {
    const intent = departure.current;
    if (!intent) return;
    if (model.scopeKey !== intent.scope || model.access === 'lost' || model.formEpoch !== intent.epoch || model.pending || model.busy || !model.dirty) {
      departure.current = null;
      intent.resolve(model.scopeKey === intent.scope && model.access !== 'lost' && model.formEpoch === intent.epoch + 1 && !model.dirty && !model.pending && !model.busy);
    }
  }, [model.scopeKey, model.access, model.formEpoch, model.dirty, model.pending, model.busy]);
  // A presentation teardown is never authorization to mutate the owner.
  useEffect(() => () => { departure.current?.resolve(false); departure.current = null; }, []);
  const contentKey = JSON.stringify([page.preparation, page.reviewCurrent, page.appointments.find(task => task.id === page.preparation.appointmentTaskId)?.title]);
  const feedback = useRef({scopeKey, before: contentKey, reference: null as string | null, trigger: null as string | null});
  if (feedback.current.scopeKey !== scopeKey) feedback.current = {scopeKey, before: contentKey, reference: null, trigger: null};
  if (model.pending && feedback.current.reference !== model.pending.reference) {
    feedback.current.reference = model.pending.reference; feedback.current.before = contentKey;
  }
  if (model.operation === 'saved' && !model.busy && !model.pending && feedback.current.reference) {
    feedback.current.trigger = feedback.current.before !== contentKey ? feedback.current.reference : null;
    feedback.current.reference = null;
  } else if (['none', 'failed', 'conflict'].includes(model.operation) && !model.pending) feedback.current.reference = null;
  return <View style={s.preparationFrame} testID="summary-preparation"><View style={s.smallStack}><Text accessibilityRole="header" aria-level={2} style={s.sectionTitle}>到診準備單</Text><Text style={s.body}>問題、清單、預約選擇及核對標記會共享給有權讀取這個孩子的家庭成員。</Text></View>
    <MotionFeedback active={model.operation === 'saved' && !model.busy && !model.pending && !model.readFailed} triggerKey={feedback.current.trigger} scopeKey={scopeKey} style={s.smallStack} testID="preparation-saved-feedback">
    <AppStatusBadge label={page.reviewCurrent ? '已核對，仍與目前來源吻合' : page.preparation.reviewed ? '來源已改變，須重新核對' : '到診準備尚未核對'} tone={page.reviewCurrent ? 'success' : 'warning'} />
    <Text style={s.meta}>家庭共享 · {page.preparation.updatedAt ? `最近保存：${page.preparation.updatedBy ?? '未提供保存者'} · ${summaryTime(page.preparation.updatedAt)}` : '尚未有保存時間'}</Text>
    <SummaryDisclosure label="已保存準備的來源與版本" scopeKey={scopeKey}>
    <Text style={s.meta}>已保存版本 {page.preparation.version} · {page.preparation.reviewed ? '曾標記已核對' : '未核對'}</Text>
    <Text selectable style={s.meta}>已保存核對依據：{page.preparation.reviewedBasis ?? '沒有'} · 期間：{page.preparation.period ? summaryPeriodLabel(page.preparation.period) : '沒有'}</Text>
    <Text style={s.meta}>已保存預約：{page.preparation.appointmentTaskId ? page.appointments.find(task => task.id === page.preparation.appointmentTaskId)?.title ?? page.preparation.appointmentTaskId : '沒有指定'}</Text>
    {page.preparation.updatedAt ? <Text style={s.meta}>最後保存：{page.preparation.updatedBy} · {summaryTime(page.preparation.updatedAt)}</Text> : null}
    </SummaryDisclosure>
    </MotionFeedback>
    <PreparationForm key={model.formEpoch} {...props} onDiscard={discardDraft} />
  </View>;
}
function PreparationForm({model, actions, onAgent, onRecord, onTask, onDraftStatusChange, onDiscard}: PreparationProps & {onDiscard(): boolean | Promise<boolean>}) {
  const page = model.page!;
  const basis = useRef(summaryBasis(page));
  const [shared, setShared] = useState(false), [basisConsent, setBasisConsent] = useState(false);
  const [editing, setEditing] = useState(false);
  const readingRef = useRef<View>(null), editorRef = useRef<View>(null), previousEditing = useRef(false);
  useLayoutEffect(() => {
    if (previousEditing.current === editing) return;
    previousEditing.current = editing;
    if (Platform.OS === 'web') ((editing ? editorRef : readingRef).current as unknown as HTMLElement | null)?.focus({preventScroll: true});
  }, [editing]);
  const {control, handleSubmit, setValue, setFocus} = useForm<PreparationFormValues>({defaultValues: preparationDefaults(page), resolver: zodResolver(preparationFormSchema), mode: 'onSubmit'});
  const { isDirty } = useFormState({ control });
  usePreviewLeaveGuard(isDirty, false, "child", undefined, false, undefined, onDiscard);
  const questions = useFieldArray({control, name: 'questions'}), checklist = useFieldArray({control, name: 'checklist'});
  const values = useWatch({control}), parsed = preparationFormSchema.safeParse(values);
  const formId = useId();
  const fieldId = (kind: 'questions' | 'checklist', id: string) => `${formId}-${kind}-${id}`;
  // The existing live save-preview parse already decides whether shared consent
  // is available. Expose those same issues; do not create a second validation state.
  const messages = new Map<string, string>();
  let formError = '';
  if (!parsed.success) for (const issue of parsed.error.issues) {
    const [kind, index, field] = issue.path;
    if ((kind === 'questions' || kind === 'checklist') && typeof index === 'number' && field === 'text') messages.set(`${kind}.${index}.text`, issue.message);
    else if (kind === 'appointmentTaskId') messages.set('appointmentTaskId', '請明確選擇已載入的預約，或選「沒有指定預約」。');
    else formError = '準備內容未能通過核對；問題最多 12 條、清單最多 16 項，原文不會自動刪除或截短。';
  }
  const rowRefs = useRef(new Map<string, View>()), addQuestionRef = useRef<View>(null), addChecklistRef = useRef<View>(null);
  const formScope = `${model.scopeKey}:${model.formEpoch}:${model.access}`;
  const appendFocus = useRef<{kind: 'questions' | 'checklist'; scope: string; beforeIds: Set<string>} | null>(null);
  const questionRows = questions.fields.map((item, index) => ({...item, index, text: values.questions?.[index]?.text ?? item.text, error: messages.get(`questions.${index}.text`)}));
  const checklistRows = checklist.fields.map((item, index) => ({...item, index, text: values.checklist?.[index]?.text ?? item.text, done: values.checklist?.[index]?.done ?? item.done, error: messages.get(`checklist.${index}.text`)}));
  const stale = summaryBasisChanged(basis.current, page);
  const emptyReady = model.access !== 'lost' && (model.dirty || !stale && model.online && !model.readFailed && !model.busy && !model.pending
    && (model.operation === 'none' || model.operation === 'saved'));
  const fieldsAvailable = model.online && !model.readFailed && !model.pending && model.access === 'editable' && page.canManage;
  const editable = fieldsAvailable && !model.busy;
  const appointmentValid = !values.appointmentTaskId || page.appointments.some(task => task.id === values.appointmentTaskId);
  const appointmentError = !appointmentValid ? '原預約已不在目前待處理清單；請明確另選或選「沒有指定」，不會自動移除。' : messages.get('appointmentTaskId');
  const errorEntries = [
    ...(appointmentError ? [{field: 'appointmentTaskId', label: '到診預約安排', message: appointmentError}] : []),
    ...questionRows.flatMap(item => item.error ? [{field: `questions.${item.index}.text`, label: `到診問題 ${item.index + 1}`, message: item.error}] : []),
    ...checklistRows.flatMap(item => item.error ? [{field: `checklist.${item.index}.text`, label: `到診準備 ${item.index + 1}`, message: item.error}] : []),
  ];
  useEffect(() => {setShared(false); setBasisConsent(false);}, [model.confirmationEpoch]);
  useEffect(() => {onDraftStatusChange?.({scopeKey: model.scopeKey, formEpoch: model.formEpoch, stale, appointmentMissing: !appointmentValid});}, [onDraftStatusChange, model.scopeKey, model.formEpoch, stale, appointmentValid]);
  function edit(reviewChange = false) {actions.markDirty(); setShared(false); setBasisConsent(false); if (!reviewChange) setValue('reviewed', false, {shouldDirty: true});}
  function appendRow(kind: 'questions' | 'checklist') {
    const rows = kind === 'questions' ? questions : checklist;
    if (!editable || rows.fields.length >= (kind === 'questions' ? 12 : 16)) return;
    appendFocus.current = {kind, scope: formScope, beforeIds: new Set(rows.fields.map(item => item.id))};
    // MotionList commits the Controller after RHF's append effect has run.
    // Complete this explicit focus request from that new input's committed ref.
    if (kind === 'questions') questions.append({text: ''}, {shouldFocus: false});
    else checklist.append({text: '', done: false}, {shouldFocus: false});
    edit();
  }
  function focusAppendedField(kind: 'questions' | 'checklist', id: string, node: {focus: () => void} | null) {
    const intent = appendFocus.current;
    if (!intent || !node) return;
    if (intent.scope !== formScope || !editable) {appendFocus.current = null; return;}
    const rows = kind === 'questions' ? questions : checklist;
    if (intent.kind !== kind || intent.beforeIds.has(id) || rows.fields[rows.fields.length - 1]?.id !== id) return;
    appendFocus.current = null;
    node.focus();
  }
  function removeRow(kind: 'questions' | 'checklist', index: number, id: string) {
    const rows = kind === 'questions' ? questions : checklist;
    const node = rowRefs.current.get(id) as unknown as HTMLElement | undefined;
    if (Platform.OS === 'web' && node?.contains(document.activeElement)) {
      const nextIndex = index + 1 < rows.fields.length ? index + 1 : index - 1;
      if (nextIndex >= 0) {
        const nextRow = rowRefs.current.get(rows.fields[nextIndex].id) as unknown as HTMLElement | undefined;
        const input = nextRow?.querySelector<HTMLElement>('input,textarea');
        if (input) input.focus({preventScroll: true});
        else setFocus(`${kind}.${nextIndex}.text`);
      }
      else {
        const add = (kind === 'questions' ? addQuestionRef : addChecklistRef).current as unknown as HTMLElement | null;
        const target = add?.matches('button,[role="button"],[tabindex="0"]') ? add : add?.querySelector<HTMLElement>('button,[role="button"],[tabindex="0"]');
        target?.focus({preventScroll: true});
      }
    }
    rows.remove(index); edit();
  }
  function field(kind: 'questions' | 'checklist', id: string, index: number, label: string) {
    const name = `${kind}.${index}.text` as const, error = messages.get(name), nativeID = fieldId(kind, id);
    return <Controller name={name} control={control} render={({field: input}) => <View>
      <AppTextField ref={node => {input.ref(node); focusAppendedField(kind, id, node);}} nativeID={nativeID} label={label} accessibilityLabel={label} value={input.value} multiline disabled={!fieldsAvailable} editable={editable}
        error={!!error} aria-invalid={!!error} aria-describedby={error ? `${nativeID}-message` : undefined} onBlur={input.onBlur} onChangeText={value => {if (!editable) return; input.onChange(value); edit();}} />
      <FormFieldMessage id={`${nativeID}-message`} error={error} />
    </View>} />;
  }
  const appointmentOptions = [{value: '', label: '沒有指定預約'}, ...page.appointments.map(task => ({value: task.id, label: `${task.title} · ${summaryTime(task.occurrence.dueAt, task.occurrence.timeZone)}`})), ...(!appointmentValid && values.appointmentTaskId ? [{value: values.appointmentTaskId, label: '原預約已不在目前清單（保留草稿）'}] : [])];
  return <>
    {!page.canManage ? <Text style={s.warning}>目前只有檢視權限，不能修改或保存。</Text> : null}
    {model.dirty ? <AppStatusBadge label="本頁草稿未保存" tone="warning" /> : null}
    {model.pending ? <AppStatusBadge label={model.pending.confirmed ? "保存已確認 · 最新準備待讀回" : "原保存結果未知 · 先查核"} tone="warning" /> : null}
    {stale ? <Text style={s.warning}>原草稿依據與目前資料不同，保存已暫停；請在修改時核對最新來源及家庭修改。</Text> : null}
    {!appointmentValid ? <Text style={s.warning}>草稿中的原預約已不在目前清單，原選擇仍保留。</Text> : null}
    <View ref={readingRef} tabIndex={-1} accessibilityLabel="到診準備單閱讀內容" style={editing && s.hidden}>{!editing ? <PreparationSheet model={model} values={values as PreparationFormValues} editable={editable} stale={stale} onEdit={() => setEditing(true)} onAgent={onAgent} onRecord={onRecord} onTask={onTask} /> : null}</View>
    <View ref={editorRef} tabIndex={-1} accessibilityLabel="修改到診準備單" testID="preparation-editor" style={[s.stack, !editing && s.hidden]} aria-hidden={!editing} accessibilityElementsHidden={!editing} importantForAccessibility={editing ? 'auto' : 'no-hide-descendants'} pointerEvents={editing ? 'auto' : 'none'}>
    <View style={s.row}><AppButton label={model.dirty ? "返回準備單（保留草稿）" : "取消修改，返回準備單"} variant="quiet" onPress={() => setEditing(false)} /></View>
    <FormErrorSummary entries={editing && editable ? errorEntries : []} onFocus={name => {
      if (editing && editable && errorEntries.some(entry => entry.field === name)) setFocus(name as 'appointmentTaskId' | `questions.${number}.text` | `checklist.${number}.text`);
    }} />
    {formError ? <Text accessibilityRole="alert" style={s.warning}>{formError}</Text> : null}
    <Text style={s.body}>修改只留在本頁；返回閱讀不會保存或丟棄草稿。</Text>
    <SummaryDisclosure label="目前草稿依據" scopeKey={formScope}><Text selectable style={s.meta}>草稿基準：共享準備版本 {basis.current.expectedVersion} · {basis.current.basisVersion} · {summaryPeriodLabel(basis.current.period)}</Text></SummaryDisclosure>
    {model.dirty ? <View style={s.box}><Text style={s.title}>目前已保存內容，供比較</Text>{page.preparation.questions.map((text, index) => <Text key={index} style={s.body}>已保存問題 {index + 1}：{text}</Text>)}{page.preparation.checklist.map((item, index) => <Text key={index} style={s.body}>已保存準備 {index + 1}：{item.done ? '已完成' : '未完成'} · {item.text}</Text>)}<Text style={s.body}>本頁未保存草稿及原依據保留，更新摘要不會悄悄覆寫。</Text></View> : null}
    {stale ? <View style={s.box}><Text style={s.warning}>草稿與目前摘要／共享準備版本不同，不能直接保存。先核對來源及家庭成員的最新修改。</Text>
      <AppCheckbox label="我已核對最新來源及共享準備，保留草稿並採用目前依據" checked={basisConsent} disabled={!editable} onChange={setBasisConsent} />
      <AppButton label="明確改用目前摘要依據" variant="secondary" disabled={!editable || !basisConsent} onPress={() => {basis.current = summaryBasis(page); edit();}} /></View> : null}
    <Controller name="appointmentTaskId" control={control} render={({field: input}) => <AppSelect ref={input.ref} id={`${formId}-appointment`} invalid={!!appointmentError} describedBy={appointmentError ? `${formId}-appointment-message` : undefined} label="到診預約安排" value={input.value} options={appointmentOptions} disabled={!editable} onChange={value => {input.onChange(value); edit();}} />} />
    <FormFieldMessage id={`${formId}-appointment-message`} error={appointmentError} />
    <Text style={s.title}>到診問題 · 最多 12 條</Text>
    <MotionList items={questionRows} keyExtractor={item => item.id} scopeKey={`${model.scopeKey}:${model.formEpoch}:${model.access}:questions`} regionKey="preparation-questions" eligible={editable} style={s.stack} renderItem={(item, {exiting}) => {
      const index = questions.fields.findIndex(row => row.id === item.id), removed = exiting || index < 0, label = `到診問題 ${(removed ? item.index : index) + 1}`;
      return <View ref={node => {if (node) rowRefs.current.set(item.id, node); else rowRefs.current.delete(item.id);}} style={s.item}>
        {removed ? <View><AppTextField label={label} value={item.text} multiline disabled error={!!item.error} />{item.error ? <HelperText type="error">{item.error}</HelperText> : null}</View> : field('questions', item.id, index, label)}
        <AppButton label={`移除${label}`} variant="quiet" disabled={!editable || removed} onPress={() => removeRow('questions', index, item.id)} />
      </View>;
    }} />
    {!questions.fields.length && emptyReady ? <EmptyListCard title="目前準備草稿沒有到診問題" detail="可使用「新增到診問題」補充；新增內容仍須核對及保存。" icon="help-circle" testID="preparation-editor-questions-empty" /> : null}
    <AppButton ref={addQuestionRef} label="新增到診問題" variant="secondary" disabled={!editable || questions.fields.length >= 12} onPress={() => appendRow('questions')} />
    <Text style={s.title}>準備清單 · 最多 16 項</Text>
    <MotionList items={checklistRows} keyExtractor={item => item.id} scopeKey={`${model.scopeKey}:${model.formEpoch}:${model.access}:checklist`} regionKey="preparation-checklist" eligible={editable} style={s.stack} renderItem={(item, {exiting}) => {
      const index = checklist.fields.findIndex(row => row.id === item.id), removed = exiting || index < 0, label = `到診準備 ${(removed ? item.index : index) + 1}`;
      return <View ref={node => {if (node) rowRefs.current.set(item.id, node); else rowRefs.current.delete(item.id);}} style={s.item}>
        {removed ? <View><AppTextField label={label} value={item.text} multiline disabled error={!!item.error} />{item.error ? <HelperText type="error">{item.error}</HelperText> : null}</View> : field('checklist', item.id, index, label)}
        {removed ? <AppCheckbox label={`${label} 已完成`} checked={item.done} disabled onChange={() => {}} /> : <Controller name={`checklist.${index}.done`} control={control} render={({field: input}) => <AppCheckbox label={`${label} 已完成`} checked={input.value} disabled={!editable} onChange={value => {input.onChange(value); edit();}} />} />}
        <AppButton label={`移除${label}`} variant="quiet" disabled={!editable || removed} onPress={() => removeRow('checklist', index, item.id)} />
      </View>;
    }} />
    {!checklist.fields.length && emptyReady ? <EmptyListCard title="目前準備草稿沒有清單項目" detail="可使用「新增到診準備」補充；新增內容仍須核對及保存。" icon="preparation-outline" testID="preparation-editor-checklist-empty" /> : null}
    <AppButton ref={addChecklistRef} label="新增到診準備" variant="secondary" disabled={!editable || checklist.fields.length >= 16} onPress={() => appendRow('checklist')} />
    <Text style={s.body}>問題最多 500 字，準備項目最多 300 字；不截短。依正式契約，保存內容會移除兩端空白；原草稿保留，下方顯示實際保存內容。</Text>
    {parsed.success ? <View style={s.box} testID="summary-save-review"><Text style={s.title}>保存前核對</Text>{parsed.data.questions.map((item, index) => <Text key={index} selectable style={s.body}>問題 {index + 1}：{item.text}</Text>)}{parsed.data.checklist.map((item, index) => <Text key={index} selectable style={s.body}>準備 {index + 1}：{item.done ? '已完成' : '未完成'} · {item.text}</Text>)}<Text style={s.meta}>核對標記：{parsed.data.reviewed ? '已核對' : '未核對'}</Text></View> : null}
    <Controller name="reviewed" control={control} render={({field: input}) => <AppCheckbox label="我已逐項核對問題、準備清單及目前摘要來源" checked={input.value} disabled={!editable || stale} onChange={value => {input.onChange(value); edit(true);}} />} />
    <AppCheckbox label="我確認把以上到診準備與有權家庭成員共享" checked={shared} disabled={!editable || stale || !parsed.success || !appointmentValid} onChange={setShared} />
    <AppButton label="確認保存家庭共享到診準備" disabled={!editable || stale || !shared || !parsed.success || !appointmentValid} onPress={handleSubmit(raw => {actions.markDirty(); const input = preparationProjection(raw, basis.current); actions.save(input, page.appointments.find(task => task.id === input.appointmentTaskId)?.title ?? '沒有指定預約');})} />
    {model.dirty ? <AppButton label="放棄草稿並載入已保存準備" variant="quiet" disabled={!model.online || model.busy || !!model.pending || model.readFailed} onPress={actions.discard} /> : null}
    </View>
  </>;
}
