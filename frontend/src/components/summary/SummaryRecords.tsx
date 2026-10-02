import {useState} from 'react';
import {View} from 'react-native';
import {Text} from 'react-native-paper';
import {careKindOptions} from '../../care-view-model';
import type {SummaryPage, SummaryRecord} from '../../summary-view-model';
import {summaryTime} from '../../summary-view-model';
import type {TaskView} from '../../task-view-model';
import {taskStateLabels} from '../../task-view-model';
import {AppButton, SectionCard, SectionHeader} from '../ui';
import {summaryStyles as s} from './summary-styles';

const kindLabel = (kind: SummaryRecord['kind']) => careKindOptions.find(item => item.value === kind)!.label;
function RecordSource({record, onRecord}: {record: SummaryRecord; onRecord: (id: string) => void}) {
  const [open, setOpen] = useState(false);
  return <View style={s.item} testID={`summary-record-${record.id}`}><Text style={s.title}>{kindLabel(record.kind)} · 版本 {record.version}</Text><Text selectable style={s.body}>{record.text}</Text>
    {record.quantity ? <Text style={s.meta}>原數值：{record.quantity.precision === 'approximate' ? '約 ' : ''}{record.quantity.rawValue} {record.quantity.unit}</Text> : null}
    <Text style={s.meta}>事件：{record.eventTime.at ? summaryTime(record.eventTime.at, record.eventTime.timeZone) : '未知'} · {record.eventTime.precision === 'approximate' ? '約數' : record.eventTime.precision === 'exact' ? '明確' : '未知'} · {record.eventTime.timeZone}</Text>
    <AppButton label={open ? '收起記錄來源' : '展開記錄來源'} variant="quiet" onPress={() => setOpen(value => !value)} />
    {open ? <View style={s.smallStack}><Text selectable style={s.meta}>事件時間原文：{record.eventTime.rawText || '未記錄'}</Text><Text selectable style={s.meta}>來源：{record.source}</Text><Text selectable style={s.meta}>確認／更正原因：{record.reason}</Text>
      <Text style={s.meta}>確認者：{record.confirmedBy} · 確認：{summaryTime(record.confirmedAt)} · 建立：{summaryTime(record.createdAt)}</Text><Text selectable style={s.meta}>記錄識別：{record.id}</Text>
      <AppButton label="查看原記錄及完整更正歷史" variant="secondary" onPress={() => onRecord(record.id)} /></View> : null}
  </View>;
}
function TaskSource({task, onTask}: {task: TaskView; onTask: (id: string) => void}) {
  return <View style={s.item}><Text style={s.title}>{task.title}</Text><Text selectable style={s.body}>{task.details}</Text><Text style={s.meta}>{taskStateLabels[task.occurrence.state]} · {summaryTime(task.occurrence.dueAt, task.occurrence.timeZone)} · {task.occurrence.timeZone}</Text>
    <Text style={s.meta}>建立者：{task.createdBy} · 負責人：{task.assigneeUserId} · 更新：{summaryTime(task.updatedAt)}</Text><Text selectable style={s.meta}>原任務 {task.id} · 版本 {task.version} · 事項 {task.occurrence.id}</Text><AppButton label="核對這項任務" variant="quiet" onPress={() => onTask(task.id)} /></View>;
}
export function SummaryRecords({page, onRecord, onTask}: {page: SummaryPage; onRecord: (id: string) => void; onTask: (id: string) => void}) {
  const [recordsOpen, setRecordsOpen] = useState(false);
  return <>
    <SectionCard testID="summary-counts"><SectionHeader title="記錄數量與原單位" icon="chart-bar" subtitle="只有已確認且事件時間在期間內的當前版本才納入；數字由正式 Server 計算。" />
      <View style={s.row}>{careKindOptions.map(kind => <View key={kind.value} style={s.count}><Text style={s.body}>{kind.label} · {page.counts[kind.value]} 筆</Text></View>)}</View>
      {!page.metrics.length ? <Text style={s.body}>此期間沒有可列出的數值統計。零記錄不代表事件沒有發生。</Text> : null}
      {page.metrics.map((metric, index) => <View key={index} style={s.item}><Text style={s.title}>{kindLabel(metric.kind)} · {metric.unit}</Text><Text style={s.body}>樣本 {metric.samples} · 其中約數 {metric.approximate}</Text><Text style={s.body}>合計 {metric.total ?? '未提供'} · 最小 {metric.min} · 最大 {metric.max}</Text><Text selectable style={s.meta}>來源記錄：{metric.recordIds.join('、')}</Text></View>)}
      <Text style={s.warning}>整個孩子已掃描記錄中，事件時間未知：{page.missing.unknownEventTime} 筆。這不是本日／本週的缺漏數，不會假歸入期間。</Text>
      <Text style={s.meta}>未能納入數值統計的數量：{page.missing.invalidQuantities}。沒有記錄的種類：{page.missing.emptyKinds.map(kindLabel).join('、') || '沒有'}；未記錄不等於未發生。</Text>
    </SectionCard>
    <SectionCard><SectionHeader title="原始記錄及更正來源" count={page.records.length} icon="notebook-outline" /><AppButton label={recordsOpen ? '收起期間記錄' : '查看期間記錄及來源'} variant="secondary" onPress={() => setRecordsOpen(value => !value)} />
      {recordsOpen ? page.records.length ? page.records.map(record => <RecordSource key={record.id} record={record} onRecord={onRecord} />) : <Text style={s.body}>本期間沒有已列出的記錄。</Text> : null}
    </SectionCard>
    <SectionCard><SectionHeader title="家庭已確認預約安排" count={page.appointments.length} icon="calendar-outline" /><Text style={s.meta}>家庭台帳中的安排不代表機構已確認預約。</Text>
      {page.appointments.length ? page.appointments.map(task => <TaskSource key={task.id} task={task} onTask={onTask} />) : <Text style={s.body}>目前沒有列出的待處理預約。</Text>}
      <Text style={s.title}>待覆核任務 · {page.conflicts.length}</Text>{page.conflicts.length ? page.conflicts.map(task => <TaskSource key={task.id} task={task} onTask={onTask} />) : <Text style={s.meta}>目前沒有列出的待覆核任務。</Text>}
    </SectionCard>
  </>;
}
