import {useState, type ReactNode} from 'react';
import {View} from 'react-native';
import {Text} from 'react-native-paper';
import {careKindOptions} from '../../care-view-model';
import type {SummaryPage, SummaryRecord} from '../../summary-view-model';
import {summaryTime} from '../../summary-view-model';
import type {TaskView} from '../../task-view-model';
import {taskStateLabels} from '../../task-view-model';
import {MotionDisclosure, MotionReveal, type MotionTrigger} from '../../motion';
import {AppButton, SectionCard, SectionHeader} from '../ui';
import {summaryStyles as s} from './summary-styles';

type SummaryMotion = {scopeKey: string; triggerKey: MotionTrigger; eligible: boolean};
const kindLabel = (kind: SummaryRecord['kind']) => careKindOptions.find(item => item.value === kind)!.label;

// Only read-only data crosses the covered handoff. Controls always receive the
// current authoritative row, and never live inside an old presentation snapshot.
function Readout<T>({value, regionKey, motion, children}: {value: T; regionKey: string; motion: SummaryMotion; children: (shown: T) => ReactNode}) {
  return <MotionReveal value={value} contentKey={JSON.stringify(value)} scopeKey={motion.scopeKey} regionKey={regionKey}
    triggerKey={motion.triggerKey} eligible={motion.eligible} preset="summary" style={s.smallStack} testID={`${regionKey}-motion`}>{children}</MotionReveal>;
}

function RecordSource({record, onRecord, motion}: {record: SummaryRecord; onRecord: (id: string) => void; motion: SummaryMotion}) {
  const [open, setOpen] = useState(false);
  return <View style={s.item} testID={`summary-record-${record.id}`}>
    <Readout value={record} regionKey={`summary-record-${record.id}-text`} motion={motion}>{shown => <>
      <Text style={s.title}>{kindLabel(shown.kind)} · 版本 {shown.version}</Text><Text selectable style={s.body}>{shown.text}</Text>
      {shown.quantity ? <Text style={s.meta}>原數值：{shown.quantity.precision === 'approximate' ? '約 ' : ''}{shown.quantity.rawValue} {shown.quantity.unit}</Text> : null}
      <Text style={s.meta}>事件：{shown.eventTime.at ? summaryTime(shown.eventTime.at, shown.eventTime.timeZone) : '未知'} · {shown.eventTime.precision === 'approximate' ? '約數' : shown.eventTime.precision === 'exact' ? '明確' : '未知'} · {shown.eventTime.timeZone}</Text>
    </>}</Readout>
    <AppButton label={open ? '收起記錄來源' : '展開記錄來源'} variant="quiet" onPress={() => setOpen(value => !value)} />
    <MotionDisclosure expanded={open} scopeKey={`${motion.scopeKey}:${record.id}`}><View style={s.smallStack}>
      <Readout value={record} regionKey={`summary-record-${record.id}-source`} motion={{...motion, eligible: motion.eligible && open}}>{shown => <>
        <Text selectable style={s.meta}>事件時間原文：{shown.eventTime.rawText || '未記錄'}</Text><Text selectable style={s.meta}>來源：{shown.source}</Text><Text selectable style={s.meta}>確認／更正原因：{shown.reason}</Text>
        <Text style={s.meta}>確認者：{shown.confirmedBy} · 確認：{summaryTime(shown.confirmedAt)} · 建立：{summaryTime(shown.createdAt)}</Text><Text selectable style={s.meta}>記錄識別：{shown.id}</Text>
      </>}</Readout>
      <AppButton label="查看原記錄及完整更正歷史" variant="secondary" onPress={() => onRecord(record.id)} />
    </View></MotionDisclosure>
  </View>;
}

function TaskSource({task, onTask, motion, group}: {task: TaskView; onTask: (id: string) => void; motion: SummaryMotion; group: string}) {
  return <View style={s.item}>
    <Readout value={task} regionKey={`summary-${group}-${task.id}-text`} motion={motion}>{shown => <>
      <Text style={s.title}>{shown.title}</Text><Text selectable style={s.body}>{shown.details}</Text><Text style={s.meta}>{taskStateLabels[shown.occurrence.state]} · {summaryTime(shown.occurrence.dueAt, shown.occurrence.timeZone)} · {shown.occurrence.timeZone}</Text>
      <Text style={s.meta}>建立者：{shown.createdBy} · 負責人：{shown.assigneeUserId} · 更新：{summaryTime(shown.updatedAt)}</Text><Text selectable style={s.meta}>原任務 {shown.id} · 版本 {shown.version} · 事項 {shown.occurrence.id}</Text>
    </>}</Readout>
    <AppButton label="核對這項任務" variant="quiet" onPress={() => onTask(task.id)} />
  </View>;
}

export function SummaryRecords({page, onRecord, onTask, motion}: {page: SummaryPage; onRecord: (id: string) => void; onTask: (id: string) => void; motion: SummaryMotion}) {
  const [recordsOpen, setRecordsOpen] = useState(false);
  const counts = {counts: page.counts, metrics: page.metrics, missing: page.missing};
  return <>
    <SectionCard testID="summary-counts"><SectionHeader density="compact" title="記錄數量與原單位" icon="chart-bar" subtitle="只有已確認且事件時間在期間內的當前版本才納入；數字由正式 Server 計算。" />
      <Readout value={counts} regionKey="summary-counts" motion={motion}>{shown => <>
        <View style={s.row}>{careKindOptions.map(kind => <View key={kind.value} style={s.count}><Text style={s.body}>{kind.label} · {shown.counts[kind.value]} 筆</Text></View>)}</View>
        {!shown.metrics.length ? <Text style={s.body}>此期間沒有可列出的數值統計。零記錄不代表事件沒有發生。</Text> : null}
        {shown.metrics.map((metric, index) => <View key={index} style={s.item}><Text style={s.title}>{kindLabel(metric.kind)} · {metric.unit}</Text><Text style={s.body}>樣本 {metric.samples} · 其中約數 {metric.approximate}</Text><Text style={s.body}>合計 {metric.total ?? '未提供'} · 最小 {metric.min} · 最大 {metric.max}</Text><Text selectable style={s.meta}>來源記錄：{metric.recordIds.join('、')}</Text></View>)}
        <Text style={s.warning}>整個孩子已掃描記錄中，事件時間未知：{shown.missing.unknownEventTime} 筆。這不是本日／本週的缺漏數，不會假歸入期間。</Text>
        <Text style={s.meta}>未能納入數值統計的數量：{shown.missing.invalidQuantities}。沒有記錄的種類：{shown.missing.emptyKinds.map(kindLabel).join('、') || '沒有'}；未記錄不等於未發生。</Text>
      </>}</Readout>
    </SectionCard>
    <SectionCard><SectionHeader density="compact" title="原始記錄及更正來源" count={page.records.length} icon="notebook-outline" /><AppButton label={recordsOpen ? '收起期間記錄' : '查看期間記錄及來源'} variant="secondary" onPress={() => setRecordsOpen(value => !value)} />
      <MotionDisclosure expanded={recordsOpen} scopeKey={motion.scopeKey}><View style={s.stack}>
        {page.records.length ? page.records.map(record => <RecordSource key={record.id} record={record} onRecord={onRecord} motion={{...motion, eligible: motion.eligible && recordsOpen}} />) : <Text style={s.body}>本期間沒有已列出的記錄。</Text>}
      </View></MotionDisclosure>
    </SectionCard>
    <SectionCard><SectionHeader density="compact" title="家庭已確認預約安排" count={page.appointments.length} icon="calendar-outline" /><Text style={s.meta}>家庭台帳中的安排不代表機構已確認預約。</Text>
      {page.appointments.length ? page.appointments.map(task => <TaskSource key={task.id} task={task} onTask={onTask} motion={motion} group="appointment" />) : <Text style={s.body}>目前沒有列出的待處理預約。</Text>}
      <Text style={s.title}>待覆核任務 · {page.conflicts.length}</Text>{page.conflicts.length ? page.conflicts.map(task => <TaskSource key={task.id} task={task} onTask={onTask} motion={motion} group="conflict" />) : <Text style={s.meta}>目前沒有列出的待覆核任務。</Text>}
    </SectionCard>
  </>;
}
