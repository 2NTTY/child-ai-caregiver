import { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { chunkTreatmentSchema, type ChunkTreatment } from '../../../../src/shared/source-series';
import type { TreatmentView, TreatmentCommand } from '../../../../src/shared/admin-knowledge-treatment';
import { AdminApiError, adminError, type AdminOwner } from '../../production/AdminOwner';
import { colors, spacing } from '../../theme';
import { AppCheckbox } from '../AppCheckbox';
import { AppButton, AppSelect, AppTextField, SectionHeader } from '../ui';

const kinds = [
  { value: 'detailed', label: '精細保留' }, { value: 'overview', label: '概括整理' },
  { value: 'structured', label: '結構化保存' }, { value: 'excluded', label: '不進問答索引' },
] as const;
const labels = { draft: '待審草稿', reviewed: '已審核', withdrawn: '已撤回' };
const messages: Record<string, string> = {
  knowledge_review_baseline_changed: '發布版本或原文觀察已更改。請重新核對目前版本。',
  knowledge_treatment_content_changed: '這份候選同時改動了文件內容，請沿原有整份文件審核流程處理。',
  knowledge_version_unreviewed: '這份草稿尚未通過核對。', knowledge_vectors_incomplete: '部分片段缺少相容向量，請先完成既有索引維護。',
  knowledge_treatment_invalid: '請核對欄位值是否逐字來自原文，以及每項資料的格式。',
  knowledge_treatment_unchanged: '所選整理方式與現行版本相同。', knowledge_source_unavailable: '來源已失效或停用。',
  knowledge_treatment_maintenance: '維護寫入現已暫停。', knowledge_review_incomplete_diff: '核對紀錄須逐一交代所有改動片段。',
  invalid_input: '請核對輸入及核對紀錄的格式。'
};
function assessmentForm(view: TreatmentView) {
  const changes = view.chunks.filter(c => JSON.stringify(c.previousTreatment) !== JSON.stringify(c.treatment));
  return JSON.stringify({
    comparedVersionId: view.baseId, comparedHash: view.baseHash, observationHash: view.observationHash,
    changes: changes.map(c => ({ key: c.key, oldQuote: c.sourceExcerpt || null, newQuote: c.sourceExcerpt || null, meaning: '', explanation: '' })),
    checks: { age: '', numbersAndUnits: '', timing: '', conditions: '', exceptions: '', prohibitions: '', withdrawal: '' },
    questions: [{ query: '', expectedKeys: [], reason: '' }], growthRuleImpact: '', growthRuleReason: '', decision: 'hold'
  }, null, 2);
}
function describe(treatment: ChunkTreatment) {
  const label = kinds.find(row => row.value === treatment.kind)!.label;
  if (treatment.kind === 'structured') return label + ' · ' + treatment.fields.map(f => f.label + '＝' + f.value).join('、');
  return treatment.kind === 'excluded' ? label + ' · ' + treatment.reason : label;
}
function errorText(error: unknown) {
  if (error instanceof AdminApiError && messages[error.code]) return messages[error.code];
  return adminError(error);
}

export function AdminKnowledgeTreatments({ admin, sourceId, versionId, locked, onVersion }: {
  admin: AdminOwner; sourceId: string; versionId?: string; locked: boolean; onVersion: (id: string) => void;
}) {
  const [view, setView] = useState<TreatmentView | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [key, setKey] = useState('');
  const [treatment, setTreatment] = useState<ChunkTreatment>({ kind: 'detailed', policyVersion: 1 });
  const [record, setRecord] = useState('');
  const [checked, setChecked] = useState(false);
  const live = useRef(false);
  const sending = useRef(false);
  useEffect(() => {
    let active = true;
    live.current = true;
    void admin.readTreatment(sourceId, versionId).then(data => {
      if (active) {
        setView(data);
        const first = data.chunks.find(c => JSON.stringify(c.treatment) !== JSON.stringify(c.previousTreatment)) ?? data.chunks[0]!;
        setKey(first.key);
        setTreatment(first.treatment);
        if (!data.published && data.state === 'draft') setRecord(value => value || assessmentForm(data));
      }
    }).catch(error => {
      if (active) {
        setView(null);
        setNotice(errorText(error));
      }
    });
    return () => {
      active = false;
      live.current = false;
    };
  }, [admin, sourceId, versionId, reload]);
  const segment = view?.chunks.find(c => c.key === key);
  const disabled = locked || busy;
  function chooseKind(kind: ChunkTreatment['kind']) {
    if (treatment.kind === kind) return;
    if (segment?.treatment.kind === kind) { setTreatment(segment.treatment); return; }
    if (kind === 'structured') setTreatment({ kind, policyVersion: 1, fields: [{ label: '', value: '' }] });
    else if (kind === 'excluded') setTreatment({ kind, policyVersion: 1, reason: '' });
    else setTreatment({ kind, policyVersion: 1 });
  }
  async function submit(action: TreatmentCommand['action']) {
    if (!view || !segment || disabled || sending.current) return;
    const base = { baseId: view.baseId, baseHash: view.baseHash }, edition = { ...base, versionId: view.versionId, versionHash: view.versionHash };
    let command: TreatmentCommand;
    if (action === 'draft') {
      const parsed = chunkTreatmentSchema.safeParse(treatment);
      if (!parsed.success) { setNotice('請填妥整理方式所需的欄位或原因。'); return; }
      command = { action, ...base, changes: [{ key, treatment: parsed.data }] };
    } else if (action === 'review') {
      if (!checked) return;
      let assessment: unknown;
      try { assessment = JSON.parse(record); } catch { setNotice('核對紀錄須為有效 JSON。'); return; }
      command = { action, ...edition, sourceAndTermsChecked: true, assessment };
    } else command = { action, ...edition };
    sending.current = true;
    setBusy(true);
    setNotice('');
    try {
      const result = await admin.submitTreatment(sourceId, command);
      if (!live.current) return;
      if (action === 'draft') { onVersion(result.versionId); return; }
      setNotice(result.state === 'held' ? '候選已擱置。' : result.state === 'published' ? '已發布此版本。' : '已保存此版本的核對結果。');
      setReload(n => n + 1);
    } catch (error) {
      if (live.current) setNotice(errorText(error));
    } finally {
      sending.current = false;
      if (live.current) setBusy(false);
    }
  }
  return <View style={styles.card}>
    <SectionHeader title="文件整理方式" subtitle={view?.title ?? sourceId} />
    {notice ? <Text accessibilityLiveRegion="polite">{notice}</Text> : null}
    <AppButton label="讀回文件版本" variant="quiet" disabled={disabled} onPress={() => setReload(n => n + 1)} />
    {view && segment ? <>
      <Text selectable>目前發布版本 {view.baseId} · {view.baseHash}</Text>
      <Text selectable>{view.published ? '已發布' : labels[view.state]} · {view.versionId} · {view.versionHash}</Text>
      {view.observationHash ? <Text selectable>原文觀察 {view.observationHash}</Text> : null}
      <AppButton label="查看來源原文" variant="quiet" onPress={() => { void Linking.openURL(view.url).catch(() => setNotice('未能開啟原文。')); }} />
      <AppButton label="查看來源使用條款" variant="quiet" onPress={() => { void Linking.openURL(view.termsUrl).catch(() => setNotice('未能開啟條款。')); }} />
      <AppSelect label="文件片段" value={key} disabled={disabled} options={view.chunks.map(c => ({ value: c.key, label: c.section + ' · ' + c.key }))}
        onChange={next => { const row = view.chunks.find(c => c.key === next)!; setKey(next); setTreatment(row.treatment); }} />
      {!view.published ? <Text selectable>目前發布版的整理方式　{describe(segment.previousTreatment)}</Text> : null}
      {segment.sourceExcerpt ? <Text selectable>{segment.sourceExcerpt}</Text> : null}
      <AppSelect label="整理方式" value={treatment.kind} options={[...kinds]} disabled={disabled || !view.published} onChange={chooseKind} />
      {treatment.kind === 'excluded' ? <AppTextField label="不進問答索引的原因" accessibilityLabel="不進問答索引的原因" value={treatment.reason} maxLength={240} editable={view.published && !disabled}
        onChangeText={reason => setTreatment({ ...treatment, reason })} /> : null}
      {treatment.kind === 'structured' ? <>
        {treatment.fields.map((field, i) => <View key={i} style={styles.fields}>
          {(['label', 'value'] as const).map(prop => <AppTextField key={prop} label={(prop === 'label' ? '欄位名稱' : '原文值') + ' ' + (i + 1)}
            accessibilityLabel={(prop === 'label' ? '欄位名稱' : '原文值') + ' ' + (i + 1)} value={field[prop]} maxLength={prop === 'label' ? 80 : 300} editable={view.published && !disabled}
            onChangeText={v => setTreatment({ ...treatment, fields: treatment.fields.map((f, n) => i === n ? { ...f, [prop]: v } : f) })} />)}
          {view.published && treatment.fields.length > 1 ? <AppButton variant="quiet" label={'移除欄位 ' + (i + 1)} disabled={disabled}
            onPress={() => setTreatment({ ...treatment, fields: treatment.fields.filter((_, n) => i !== n) })} /> : null}
        </View>)}
        {view.published && treatment.fields.length < 16 ? <AppButton label="新增原文欄位" variant="quiet" disabled={disabled}
          onPress={() => setTreatment({ ...treatment, fields: [...treatment.fields, { label: '', value: '' }] })} /> : null}
      </> : null}
      {view.published ? <AppButton label="保存整理方式草稿" disabled={disabled} onPress={() => void submit('draft')} /> : view.state === 'draft' ? <>
        <AppTextField label="版本核對紀錄（JSON）" accessibilityLabel="版本核對紀錄（JSON）" multiline value={record} editable={!disabled} onChangeText={setRecord} />
        <Text>可貼上已完成的核對紀錄，或填妥各項核對。變更含義填 changed 或 unchanged，成長規則影響填 none、requires_review 或 reviewed，核對決定填 approve 或 hold。</Text>
        <AppCheckbox label="已核對這份原文及使用條款" checked={checked} disabled={disabled} onChange={setChecked} />
        <AppButton label="提交核對決定" disabled={disabled || !checked || !record.trim()} onPress={() => void submit('review')} />
      </> : view.state === 'reviewed' ? <AppButton label="發布已審核的整理方式" disabled={disabled} onPress={() => void submit('publish')} /> : null}
    </> : null}
  </View>;
}
const styles = StyleSheet.create({
  card: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.softLine },
  fields: { gap: spacing.sm }
});
