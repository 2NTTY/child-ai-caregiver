import {useState} from 'react';
import {View} from 'react-native';
import {Text} from 'react-native-paper';
import type {SummaryActions, SummaryViewModel} from '../../summary-view-model';
import {sameSummaryPeriod, summaryPeriodLabel, summaryTime} from '../../summary-view-model';
import {AppCheckbox} from '../AppCheckbox';
import {AppDateField, AppTimeZoneSelect} from '../DateTimeFields';
import {PageFrame} from '../PageFrame';
import {AppButton, AppSelect, SectionCard, SectionHeader} from '../ui';
import {summaryPeriodSchema} from './summary-form';
import {PreparationCard} from './PreparationCard';
import {SummaryRecords} from './SummaryRecords';
import {summaryStyles as s} from './summary-styles';

export function SummaryView({model, actions, onRecord, onTask, previewTools}: {model: SummaryViewModel; actions: SummaryActions; onRecord: (id: string) => void; onTask: (id: string) => void; previewTools?: React.ReactNode}) {
  const [wide, setWide] = useState(false), [wideQuery, setWideQuery] = useState(false);
  const page = model.page, queryValid = summaryPeriodSchema.safeParse(model.query).success;
  const canRetry = model.online && !model.busy && !model.readFailed && model.access === 'editable' && !!page?.canManage && !!model.pending?.checked && !model.pending.confirmed;
  return <PageFrame title="照顧摘要與到診準備" description={`整理${model.childName}的已確認記錄及來源，再由家長核對到診問題與安排。未有記錄不等於事情沒有發生。`}>
    <SectionCard><SectionHeader title="選擇整理期間" icon="calendar-outline" subtitle={model.dataLabel} />
      <View onLayout={event => setWideQuery(event.nativeEvent.layout.width >= 680)} style={wideQuery ? s.queryRow : s.stack}>
        <View style={wideQuery ? s.queryField : undefined}><AppDateField label="摘要開始日" value={model.query.startDay} disabled={model.busy || !!model.pending || model.access === 'lost'} onChange={value => actions.updateQuery({...model.query, startDay: value})} /></View>
        <View style={wideQuery ? s.queryField : undefined}><AppSelect label="摘要期間" value={model.query.period} options={[{value: 'day', label: '一日'}, {value: 'week', label: '連續七日'}]} disabled={model.busy || !!model.pending || model.access === 'lost'} onChange={value => actions.updateQuery({...model.query, period: value})} /></View>
        <View style={wideQuery ? s.queryField : undefined}><AppTimeZoneSelect value={model.query.timeZone} disabled={model.busy || !!model.pending || model.access === 'lost'} onChange={value => actions.updateQuery({...model.query, timeZone: value})} /></View>
      </View>
      {!queryValid ? <Text style={s.warning}>請輸入有效開始日與 IANA 時區。</Text> : null}
      <AppButton label={model.pending ? '先查原收據及更新摘要' : '產生／更新摘要並保留草稿'} variant="secondary" disabled={!model.online || model.busy || model.access === 'lost' || !model.pending && !queryValid} onPress={actions.refresh} />
      {page && !sameSummaryPeriod(page.period, model.query) ? <Text style={s.warning}>新選項尚未套用，目前仍顯示：{summaryPeriodLabel(page.period)}。</Text> : null}
      {model.busy ? <Text style={s.meta}>正在讀取／提交，尚未確認最新狀態。</Text> : null}
      {!model.online ? <Text style={s.warning}>目前離線；草稿及原操作只留本頁，不會排隊提交。</Text> : null}
      {model.access === 'lost' ? <Text style={s.warning}>已無權存取；舊資料、草稿及原操作已清除。</Text> : null}
      {model.readFailed && page ? <Text style={s.warning}>目前摘要尚未重新核對，暫停保存；已顯示資料可能過時。</Text> : null}
      {model.notice ? <Text accessibilityLiveRegion="polite" style={model.operation === 'saved' ? s.body : s.warning}>{model.notice}</Text> : null}
    </SectionCard>
    {model.pending ? <SectionCard testID="summary-pending"><SectionHeader title="原保存操作待核對" icon="information-outline" />
      <Text selectable style={s.meta}>原操作：{model.pending.reference}（合成參考） · 準備版本 {model.pending.input.expectedVersion} · 摘要 {model.pending.input.basisVersion}</Text><Text style={s.body}>{summaryPeriodLabel(model.pending.input.period)}</Text><Text style={s.body}>原預約：{model.pending.appointmentLabel} · 核對標記：{model.pending.input.reviewed ? '已核對' : '未核對'}</Text>
      {model.pending.input.questions.map((text, index) => <Text key={index} selectable style={s.body}>原問題 {index + 1}：{text}</Text>)}{model.pending.input.checklist.map((item, index) => <Text key={index} selectable style={s.body}>原準備 {index + 1}：{item.done ? '已完成' : '未完成'} · {item.text}</Text>)}
      {model.pending.confirmed ? <Text style={s.warning}>原保存已確認；最新摘要仍待讀取，不能重送或另建一次保存。</Text> : <Text style={s.meta}>查收據後，只有尚未確認的原操作可明確重試，保留同一識別、內容及版本。</Text>}
      <AppCheckbox label="我已核對目前摘要，同意用原操作識別及內容重試" checked={model.originalConsent} disabled={!canRetry} onChange={actions.setOriginalConsent} /><AppButton label="以原操作明確重試到診準備" disabled={!canRetry || !model.originalConsent} onPress={actions.retryOriginal} />
    </SectionCard> : null}
    {page ? <>
      <SectionCard><SectionHeader title={`${page.childName} · 摘要依據`} icon="account-child-outline" /><Text style={s.body}>{page.profile.ageLabel}</Text><Text style={s.meta}>檔案版本 {page.profile.version} · 來源：{page.profile.source}</Text>
        {page.profile.confirmedAt ? <Text style={s.meta}>檔案核對：{page.profile.confirmedBy} · {summaryTime(page.profile.confirmedAt)} · {page.profile.reason ?? '未記錄'}</Text> : null}
        <Text style={s.body}>期間：{page.period.startDay} 至 {page.endDayExclusive}（不包括結束日） · {page.period.timeZone}</Text><Text selectable style={s.meta}>生成：{summaryTime(page.generatedAt, page.period.timeZone)} · 依據版本：{page.basisVersion}</Text><Text style={s.meta}>數值保留原單位及約數，沒有混加不同單位或讀取便條內的數字；更正後需重新讀取。</Text>
      </SectionCard>
      <View onLayout={event => setWide(event.nativeEvent.layout.width >= 980)} style={wide ? s.columns : s.stack}><View style={wide ? s.column : s.full}><SummaryRecords page={page} onRecord={onRecord} onTask={onTask} /></View><View style={wide ? s.column : s.full}><PreparationCard key={model.formEpoch} model={model} actions={actions} /></View></View>
    </> : null}
    {previewTools}
  </PageFrame>;
}
