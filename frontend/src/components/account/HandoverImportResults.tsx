import { useLayoutEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import type { HandoverImportView, HandoverImportResult, HandoverImportResourceSection } from '../../../../src/shared/handover-imports';
import { handoverResultResourceSection, canReadHandoverSourceHistory, type HandoverImportOwner, type HandoverImportResultsState, type HandoverSourceHistoryState } from '../../production/HandoverImportOwner';
import { AppCheckbox } from '../AppCheckbox';
import { AppButton, AppSelect } from '../ui';
import { chineseFont, colors, readingType, spacing } from '../../theme';
import { HandoverImportHistory } from './HandoverImportHistory';

const modules = { care: '照護記錄', profile: '孩子資料', tasks: '待辦', memory: '記憶與摘要', sources: '私人來源', documents: '文件與準備單' };
const resources: Record<HandoverImportResourceSection, string> = { care: '照護記錄', profile: '孩子資料', tasks: '待辦',
  memory_facts: '記憶事實', memory_topics: '記憶話題', instructions: '私人交代', summary_history: '摘要歷史', private_sources: '私人來源',
  documents: '文件', visit_preparation: '到診準備' };
const historyLabels = { care_history: '照護記錄來源歷史', profile_history: '孩子資料來源歷史', task_history: '待辦來源歷史',
  memory_fact_history: '記憶事實來源歷史', memory_topic_history: '記憶話題來源歷史', private_source_history: '私人來源管理歷史',
  document_versions: '文件來源版本索引', document_content: '文件來源修訂', visit_preparation_history: '到診準備來源歷史' };
const outcomes = { created: '已新增', updated: '已更新', skipped: '已略過', conflict: '有衝突' };
const reasons: Record<string, string> = {
  target_changed: '接收資料曾被修改，已保留目前內容。', target_deleted: '接收項目已刪除，未自動恢復。',
  target_version_conflict: '接收版本已變更，未處理此項。', target_not_deleted: '接收項目目前未刪除，未採用恢復。',
  source_version_conflict: '同一來源版本的內容不一致，未覆蓋。', source_history_conflict: '同一來源歷史版本的內容不一致，未覆蓋。',
  history_parent_not_imported: '尚未保存對應的目前項目，來源歷史未保存。',
  history_parent_version_unavailable: '對應目前項目的來源版本不足，來源歷史未保存。',
  history_already_imported: '這個來源歷史版本已保存。', already_imported: '這個來源版本已保存。',
  older_source: '來源版本較舊，已保留接收資料。', empty_profile: '來源沒有目前孩子資料，未清除接收資料。',
  input_processing: '原抓取或提取尚未結清，未更新此私人來源。', input_linked: '此私人來源已連結照護記錄，未更新。',
  inputs_capacity: '接收對象的私人來源容量已滿，未新增。',
  document_revision_index: '版本索引已核對，內容由對應來源修訂保存。',
};
const selectable = (row: HandoverImportResult) => row.outcome === 'conflict' && row.sourceSection === null
  && row.availableResolution !== null && row.currentResource !== null && handoverResultResourceSection(row) !== null;

/** Metadata and explicit choices only; the controller freezes the Server-provided versions. */
export function HandoverImportResults({ controller, batch, results, history, identityKey, locked }: {
  controller: HandoverImportOwner; batch: HandoverImportView; results: HandoverImportResultsState; identityKey: string; locked: boolean;
  history?: HandoverSourceHistoryState | null;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  useLayoutEffect(() => { setSelected([]); }, [identityKey, results.revision]);
  const target = batch.targets.find(row => row.sourceChildId === results.sourceChildId);
  const terminal = ['completed', 'cancelled', 'failed'].includes(batch.state);
  const disabled = locked || !terminal || !results.loaded || !!results.error;
  const chosen = results.items.filter(row => selected.includes(row.id) && selectable(row));
  const replace = chosen.filter(row => row.availableResolution === 'replace_current').map(row => row.id);
  const restore = chosen.filter(row => row.availableResolution === 'restore_deleted').map(row => row.id);
  function select(row: HandoverImportResult, checked: boolean) {
    setSelected(before => checked ? [...before.filter(id => id !== row.id
      && results.items.some(item => item.id === id && item.availableResolution === row.availableResolution)), row.id] : before.filter(id => id !== row.id));
  }
  function change(sourceChildId: string, module: HandoverImportResultsState['module']) {
    controller.selectResults(batch.id, sourceChildId, module); void controller.readResults();
  }
  return <View style={styles.group}>
    <Text style={styles.title}>逐項匯入結果</Text>
    <AppSelect label="來源孩子 ID" value={results.sourceChildId} disabled={locked}
      options={batch.targets.map(row => ({ value: row.sourceChildId, label: row.sourceChildId }))}
      onChange={id => { const next = batch.targets.find(row => row.sourceChildId === id); if (next?.sections[0]) change(id, next.sections[0]); }} />
    <AppSelect label="結果模組" value={results.module} disabled={locked}
      options={(target?.sections ?? []).map(module => ({ value: module, label: modules[module] }))}
      onChange={module => change(results.sourceChildId, module)} />
    <Text style={styles.body}>這裏顯示來源、版本及處理結果，不包含正文差異。已讀取 {results.items.length} 項{results.loaded && !results.nextCursor ? '，本範圍已讀完。' : '，尚未代表整包結果。'}</Text>
    {!terminal ? <Text style={styles.body}>{batch.state === 'interrupted' ? '原批次經還原後中斷，不能從此另建衝突處理批次。'
      : '原批次仍在執行，先取消或等候完成，才可處理衝突。'}</Text> : null}
    <View style={styles.actions}>
      <AppButton label="重新讀取此範圍結果" variant="quiet" disabled={locked} onPress={() => { void controller.readResults(); }} />
      <AppButton label="收起逐項結果" variant="quiet" disabled={locked} onPress={controller.closeResults} />
    </View>
    {results.error ? <Text accessibilityLiveRegion="polite" style={styles.body}>{results.error}</Text> : null}
    {results.loaded && !results.items.length ? <Text style={styles.body}>{results.nextCursor ? '暫未讀到符合項目，可繼續載入。' : '此範圍未有逐項結果。'}</Text> : null}
    {results.items.map(row => <View key={row.id} style={styles.item}>
      <Text style={styles.title}>{row.sourceSection ? historyLabels[row.sourceSection] : resources[handoverResultResourceSection(row)!] ?? modules[row.module]} · {outcomes[row.outcome]}</Text>
      <Text style={styles.body}>來源項目 {row.sourceResourceId} · 版本 {row.sourceVersion}</Text>
      <Text style={styles.body}>處理時間 {new Date(row.at).toLocaleString('zh-HK')}</Text>
      {row.reason ? <Text style={styles.body}>{reasons[row.reason] ?? `處理原因：${row.reason}`}</Text> : null}
      <Text style={styles.body}>{row.recordedResource ? `原收據接收項目 ${row.recordedResource.id} · 版本 ${row.recordedResource.version}` : '原收據沒有接收項目。'}</Text>
      {row.currentResource ? <Text style={styles.body}>目前接收項目 {row.currentResource.id} · 版本 {row.currentResource.version}{row.currentResource.deleted ? ' · 已刪除' : ''}</Text> : null}
      {canReadHandoverSourceHistory(row) ? <AppButton label={history?.resultId === row.id ? '收起來源歷史' : '查看來源歷史'}
        variant="quiet" expanded={history?.resultId === row.id} disabled={locked && history?.resultId !== row.id}
        onPress={() => { if (history?.resultId === row.id) controller.closeSourceHistory(); else void controller.openSourceHistory(row.id); }} /> : null}
      {history?.resultId === row.id ? <HandoverImportHistory controller={controller} history={history} locked={locked} /> : null}
      {selectable(row) && terminal ? <AppCheckbox label={row.availableResolution === 'replace_current' ? '選取此衝突作明確覆蓋' : '選取此已刪項目作明確恢復'}
        accessibilityLabel={`${row.sourceResourceId}：${row.availableResolution === 'replace_current' ? '覆蓋衝突' : '恢復已刪項目'}`}
        checked={selected.includes(row.id)} disabled={disabled} onChange={checked => select(row, checked)} /> : null}
    </View>)}
    {results.nextCursor ? <AppButton label="載入更多逐項結果" variant="quiet" disabled={locked} onPress={() => { void controller.readResults(true); }} /> : null}
    {terminal && results.items.some(selectable) ? <>
      <Text style={styles.body}>每次選擇同一處理方式，只處理你在已讀結果中勾選的項目，並非整包或尚未讀取的衝突。將使用上面顯示的目前版本建立新批次，原批次及收據保留。</Text>
      <View style={styles.actions}>
        <AppButton label={`覆蓋所選衝突（${replace.length} 項）`} variant="secondary" disabled={disabled || !replace.length}
          onPress={() => { void controller.resolveResults('replace_current', replace); }} />
        <AppButton label={`恢復所選已刪項目（${restore.length} 項）`} variant="secondary" disabled={disabled || !restore.length}
          onPress={() => { void controller.resolveResults('restore_deleted', restore); }} />
      </View>
    </> : null}
  </View>;
}
const styles = StyleSheet.create({ group: { gap: spacing.md, paddingTop: spacing.md }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  item: { gap: spacing.sm, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  title: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: '700' },
  body: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
});
