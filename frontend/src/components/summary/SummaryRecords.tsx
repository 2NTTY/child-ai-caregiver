import { JournalAside, JournalColumns, JournalMain, JournalSection } from "../journal/JournalLayout";
import { AppStatusBadge } from "../AppStatusBadge";
import type {ReactNode} from 'react';
import {View} from 'react-native';
import {Text} from 'react-native-paper';
import {careKindOptions} from '../../care-view-model';
import type {SummaryPage, SummaryRecord} from '../../summary-view-model';
import {summaryTime} from '../../summary-view-model';
import type {TaskView} from '../../task-view-model';
import {taskStateLabels} from '../../task-view-model';
import {MotionReveal, type MotionTrigger} from '../../motion';
import {AppButton, SectionHeader} from '../ui';
import {EmptyListCard} from '../EmptyListCard';
import {SummaryDisclosure} from './SummaryDisclosure';
import {summaryStyles as s} from './summary-styles';

type SummaryMotion = {scopeKey: string; triggerKey: MotionTrigger; eligible: boolean};
const kindLabel = (kind: SummaryRecord['kind']) => careKindOptions.find(item => item.value === kind)!.label;

// Controls use the authoritative row; only read-only text crosses a motion snapshot.
function Readout<T>({value, regionKey, motion, children}: {value: T; regionKey: string; motion: SummaryMotion; children: (shown: T) => ReactNode}) {
  return <MotionReveal value={value} contentKey={JSON.stringify(value)} scopeKey={motion.scopeKey} regionKey={regionKey}
    triggerKey={motion.triggerKey} eligible={motion.eligible} preset="summary" style={s.smallStack} testID={`${regionKey}-motion`}>{children}</MotionReveal>;
}

function RecordSource({record, onRecord, motion}: {record: SummaryRecord; onRecord: (id: string) => void; motion: SummaryMotion}) {
  return <View style={s.item} testID={`summary-record-${record.id}`}>
    <Readout value={record} regionKey={`summary-record-${record.id}-text`} motion={motion}>{shown => <>
      <Text style={s.title}>{kindLabel(shown.kind)}</Text><Text selectable style={s.reading}>{shown.text}</Text>
      {shown.quantity ? <Text style={s.body}>原數值：{shown.quantity.precision === 'approximate' ? '約 ' : ''}{shown.quantity.rawValue} {shown.quantity.unit}</Text> : null}
      <Text style={s.meta}>事件：{shown.eventTime.at ? summaryTime(shown.eventTime.at, shown.eventTime.timeZone) : '未知'} · {shown.eventTime.precision === 'approximate' ? '約數' : shown.eventTime.precision === 'exact' ? '明確' : '未知'} · {shown.eventTime.timeZone}</Text>
    </>}</Readout>
    <SummaryDisclosure label="記錄來源與確認詳情" scopeKey={`${motion.scopeKey}:${record.id}`}>
      <Text selectable style={s.meta}>事件時間原文：{record.eventTime.rawText || '未記錄'}</Text><Text selectable style={s.meta}>來源：{record.source}</Text><Text selectable style={s.meta}>確認／更正原因：{record.reason}</Text>
      <Text style={s.meta}>確認者：{record.confirmedBy} · 確認：{summaryTime(record.confirmedAt)} · 建立：{summaryTime(record.createdAt)}</Text><Text selectable style={s.meta}>版本 {record.version} · 記錄識別：{record.id}</Text>
    </SummaryDisclosure>
    <View style={s.row}><AppButton label="查看原記錄及更正歷史" density="compact" variant="secondary" onPress={() => onRecord(record.id)} /></View>
  </View>;
}

function TaskSource({task, onTask, motion, group}: {task: TaskView; onTask: (id: string) => void; motion: SummaryMotion; group: string}) {
  return <View style={s.item}>
    <Readout value={task} regionKey={`summary-${group}-${task.id}-text`} motion={motion}>{shown => <>
      <Text style={s.title}>{shown.title}</Text><View style={s.row}><AppStatusBadge label={taskStateLabels[shown.occurrence.state]} tone={shown.occurrence.state === "completed" ? "success" : shown.occurrence.state === "needs_review" ? "warning" : shown.occurrence.state === "cancelled" ? "neutral" : "info"} />{group === "conflict" ? <AppStatusBadge label="安排有衝突" tone="warning" /> : null}<Text style={s.meta}>{summaryTime(shown.occurrence.dueAt, shown.occurrence.timeZone)}</Text></View>
      <Text style={s.meta}>負責人：{shown.assigneeUserId ? '見原安排' : '未指定'} · {shown.occurrence.timeZone}</Text>
    </>}</Readout>
    <View style={s.row}><AppButton label="核對這項任務" density="compact" variant="quiet" onPress={() => onTask(task.id)} /></View>
    <SummaryDisclosure label="安排詳情與來源版本" scopeKey={`${motion.scopeKey}:${task.id}`}>
      <Text selectable style={s.body}>{task.details}</Text><Text style={s.meta}>建立者：{task.createdBy} · 更新：{summaryTime(task.updatedAt)}</Text><Text selectable style={s.meta}>原任務 {task.id} · 版本 {task.version} · 事項 {task.occurrence.id}</Text>
    </SummaryDisclosure>
  </View>;
}

function MetricResult({metric, records, onRecord, scopeKey}: {metric: SummaryPage['metrics'][number]; records: SummaryRecord[]; onRecord: (id: string) => void; scopeKey: string}) {
  const value = metric.total ?? (metric.min === metric.max ? metric.min : `${metric.min}–${metric.max}`);
  return <View style={s.metric}>
    <Text style={s.title}>{kindLabel(metric.kind)}</Text>
    <Text style={s.metricValue}>{value} <Text style={s.metricUnit}>{metric.unit}</Text></Text>
    <Text style={s.body}>{metric.samples} 筆已確認數值{metric.total !== null ? '的合計' : metric.samples === 1 ? '的記錄值' : '的範圍'}</Text>
    <Text style={s.meta}>其中 {metric.approximate} 筆為約數</Text>
    {metric.total !== null ? <Text style={s.meta}>單筆範圍 {metric.min}–{metric.max} {metric.unit}</Text> : <Text style={s.meta}>合計未提供，保留原單位</Text>}
    <SummaryDisclosure label={`核對${kindLabel(metric.kind)}的統計來源`} scopeKey={scopeKey}>
      <Text style={s.meta}>最小 {metric.min} {metric.unit} · 最大 {metric.max} {metric.unit}</Text>
      {metric.recordIds.map(id => {
        const record = records.find(item => item.id === id);
        return <View key={id} style={s.sourceRow}>
          {record ? <Text selectable style={s.body}>{record.text}</Text> : <Text style={s.meta}>此來源未列於目前記錄內容，請開啟原記錄核對。</Text>}
          <Text selectable style={s.meta}>來源記錄：{id}</Text>
          <View style={s.row}><AppButton label="查看這筆原記錄" density="compact" variant="quiet" onPress={() => onRecord(id)} /></View>
        </View>;
      })}
    </SummaryDisclosure>
  </View>;
}

export function SummaryRecords({page, onRecord, onTask, motion, emptyReady = false}: {page: SummaryPage; onRecord: (id: string) => void; onTask: (id: string) => void; motion: SummaryMotion; emptyReady?: boolean}) {
  const availableKinds = careKindOptions.filter(kind => page.counts[kind.value] > 0);
  return <>
    <JournalColumns>
      <JournalMain><JournalSection level={3} title="期間記錄" description={`已載入 ${page.records.length} 筆；逐筆閱讀，隨時回到原始依據與更正歷史。`}>
    <View style={s.reportSection}>
        {page.records.length ? page.records.map(record => <RecordSource key={record.id} record={record} onRecord={onRecord} motion={motion} />) : emptyReady ? <EmptyListCard title="本期間已載入的記錄清單為空" detail="沒有記錄不等於沒有發生。" icon="notebook-outline" testID="summary-records-empty" /> : null}
    </View>
      </JournalSection></JournalMain>
      <JournalAside>
    <View testID="summary-counts" style={s.reportSection}>
      <SummaryDisclosure label="記錄分類與數值統計" scopeKey={motion.scopeKey}>
      <View style={s.row}>{availableKinds.map(kind => <Text key={kind.value} style={s.count}>{kind.label} {page.counts[kind.value]} 筆</Text>)}</View>
      <Text style={s.meta}>只納入事件時間在上述期間內的已確認記錄；以下數值只代表已記錄樣本，並非完整期間的總量。</Text>
      {page.metrics.length ? <View style={s.metrics}>{page.metrics.map(metric => <MetricResult key={`${metric.kind}:${metric.unit}`} metric={metric} records={page.records} onRecord={onRecord} scopeKey={`${motion.scopeKey}:${metric.kind}:${metric.unit}`} />)}</View> : emptyReady ? <EmptyListCard title="已載入的記錄沒有數值統計" detail="只代表本期間已取得的記錄，並非完整期間的總量。" icon="chart-bar" testID="summary-metrics-empty" /> : null}
      </SummaryDisclosure>
    </View>

    <View style={[s.reportSection, s.chapterSection]}>
      <SectionHeader level={3} density="compact" title="閱讀時要留意" />
      {emptyReady && !page.missing.unknownEventTime && !page.missing.invalidQuantities && !page.missing.emptyKinds.length && !page.conflicts.length ? <Text style={s.meta}>本次摘要沒有列出的缺項或待覆核安排，仍只代表已取得的記錄。</Text> : null}
      {page.missing.unknownEventTime > 0 ? <Text style={s.warning}>有 {page.missing.unknownEventTime} 筆記錄的事件時間未知，未能歸入本期間。</Text> : null}
      {page.missing.unknownEventTime > 0 ? <Text style={s.meta}>此數量來自整個孩子已掃描的記錄，並非本日／本週缺漏數。</Text> : null}
      {page.missing.invalidQuantities > 0 ? <Text style={s.warning}>有 {page.missing.invalidQuantities} 個數值未能納入統計。</Text> : null}
      {page.missing.emptyKinds.length ? <Text style={s.body}>已載入的記錄未列出：{page.missing.emptyKinds.map(kindLabel).join('、')}。沒有記錄不等於沒有發生。</Text> : null}
      {page.conflicts.length ? <View style={s.attention}><Text style={s.title}>{page.conflicts.length} 項安排待覆核</Text>{page.conflicts.map(task => <TaskSource key={task.id} task={task} onTask={onTask} motion={motion} group="conflict" />)}</View> : null}
    </View>
    <View style={[s.reportSection, s.chapterSection]}><SectionHeader level={3} density="compact" title="預約與跟進" count={page.appointments.length} icon="calendar-outline" /><Text style={s.meta}>家庭台帳中的安排不代表機構已確認預約。</Text>
      {page.appointments.length ? page.appointments.map(task => <TaskSource key={task.id} task={task} onTask={onTask} motion={motion} group="appointment" />) : emptyReady ? <EmptyListCard title="已載入的待處理預約清單為空" detail="只代表目前取得的家庭安排。" icon="calendar-outline" testID="summary-appointments-empty" /> : null}
    </View>
      </JournalAside>
    </JournalColumns>
  </>;
}
