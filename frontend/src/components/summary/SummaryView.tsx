import {useId, useLayoutEffect, useRef, useState} from 'react';
import {Platform, View} from 'react-native';
import {Text} from 'react-native-paper';
import {ReadStateNotice} from "../ReadStateNotice";
import type {SummaryActions, SummaryViewModel} from '../../summary-view-model';
import {sameSummaryPeriod, summaryPeriodLabel, summaryTime} from '../../summary-view-model';
import {MotionReveal} from '../../motion';
import {AppCheckbox} from '../AppCheckbox';
import {AppDateField, AppTimeZoneSelect} from '../DateTimeFields';
import {PageFrame} from '../PageFrame';
import {StatusAnnouncement} from '../StatusAnnouncement';
import {useContainerWidth} from '../useContainerWidth';
import {AppButton, AppSelect, AppTabPanel, SectionCard, SectionHeader, UnderlineTabs} from '../ui';
import {summaryPeriodSchema} from './summary-form';
import {PreparationCard, type PreparationDraftStatus} from './PreparationCard';
import {SummaryDisclosure} from './SummaryDisclosure';
import {SummaryRecords} from './SummaryRecords';
import {summaryStyles as s} from './summary-styles';

export function SummaryView({model, actions, onRecord, onTask, onAgent, previewTools, recoveryMode = false, onReturn}: {model: SummaryViewModel; actions: SummaryActions; onRecord: (id: string) => void; onTask: (id: string) => void; onAgent?: () => void; previewTools?: React.ReactNode; recoveryMode?: boolean; onReturn?: () => void}) {
  const queryLayout = useContainerWidth(), wideQuery = queryLayout.width >= 680;
  const tabsId = useId();
  const [draftStatus, setDraftStatus] = useState<PreparationDraftStatus | null>(null);
  const reportHeadingRef = useRef<View>(null), returnFocus = useRef(false);
  const [view, setView] = useState<{scope: string; mode: 'report' | 'preparation'}>({scope: model.scopeKey, mode: recoveryMode ? 'preparation' : 'report'});
  const mode = view.scope === model.scopeKey && model.access !== 'lost' ? view.mode : recoveryMode ? 'preparation' : 'report';
  useLayoutEffect(() => {
    if (mode === 'report' && returnFocus.current) {
      returnFocus.current = false;
      if (Platform.OS === 'web') (reportHeadingRef.current as unknown as HTMLElement | null)?.focus({preventScroll: true});
    }
  }, [mode]);
  const [periodEditor, setPeriodEditor] = useState({scope: model.scopeKey, open: !model.page});
  const [refreshTrigger, setRefreshTrigger] = useState<number | null>(null);
  const refreshSerial = useRef(0);
  const page = model.page, queryValid = summaryPeriodSchema.safeParse(model.query).success;
  const emptyReady = !!page && model.online && !model.readFailed && !model.busy && !model.pending && model.access !== 'lost'
    && (model.operation === 'none' || model.operation === 'saved');
  const revealEligible = !!page && model.online && !model.busy && !model.readFailed && !model.pending && model.access !== 'lost'
    && (model.operation === 'none' || model.operation === 'saved');
  const revealTrigger = !model.busy && !revealEligible ? null : refreshTrigger;
  function refresh() {setRefreshTrigger(++refreshSerial.current); actions.refresh();}
  const basisKey = page ? JSON.stringify([page.childName, page.profile, page.period, page.endDayExclusive, page.generatedAt, page.basisVersion]) : 'empty';
  const canRetry = model.online && !model.busy && !model.readFailed && model.access === 'editable' && !!page?.canManage && !!model.pending?.checked && !model.pending.confirmed;
  const currentDraftStatus = draftStatus?.scopeKey === model.scopeKey && draftStatus.formEpoch === model.formEpoch ? draftStatus : null;
  const queryChanged = !!page && !sameSummaryPeriod(page.period, model.query);
  return <PageFrame density="compact" title={recoveryMode ? `${model.childName}的舊共享準備與原操作查核` : `${model.childName}的照顧摘要`} description={recoveryMode ? "查看舊共享準備、來源與原操作結果。" : "回看已確認的照顧資料與近期觀察。"}>
    {recoveryMode && onReturn ? <AppButton label="返回成長" variant="secondary" onPress={onReturn} /> : null}
    <StatusAnnouncement eventKey={`${model.operation}:${model.notice}`} message={model.notice} urgent={model.operation === 'failed'} />
    <StatusAnnouncement eventKey={model.access} message={model.access === 'lost' ? '已無權存取；舊資料及未提交內容已清除。' : ''} urgent={model.access === 'lost'} />
    <View style={s.periodToolbar}>
      <SummaryDisclosure label={page ? `調整期間 · ${summaryPeriodLabel(page.period)}` : '選擇摘要期間'} scopeKey={model.scopeKey}
        expanded={periodEditor.scope === model.scopeKey ? periodEditor.open : !page} onExpandedChange={open => setPeriodEditor({scope: model.scopeKey, open})}>
        <View ref={queryLayout.ref} onLayout={queryLayout.onLayout} style={wideQuery ? s.queryRow : s.stack}>
          <View style={wideQuery ? s.queryField : undefined}><AppDateField label="摘要開始日" value={model.query.startDay} disabled={model.busy || !!model.pending || model.access === 'lost'} onChange={value => actions.updateQuery({...model.query, startDay: value})} /></View>
          <View style={wideQuery ? s.queryField : undefined}><AppSelect label="摘要期間" value={model.query.period} options={[{value: 'day', label: '一日'}, {value: 'week', label: '連續七日'}]} disabled={model.busy || !!model.pending || model.access === 'lost'} onChange={value => actions.updateQuery({...model.query, period: value})} /></View>
          <View style={wideQuery ? s.queryField : undefined}><AppTimeZoneSelect value={model.query.timeZone} disabled={model.busy || !!model.pending || model.access === 'lost'} onChange={value => actions.updateQuery({...model.query, timeZone: value})} /></View>
        </View>
        {!queryValid ? <Text style={s.warning}>請輸入有效開始日與 IANA 時區。</Text> : null}
        <View style={s.row}><AppButton label="套用期間並更新報告" density="compact" variant="secondary" disabled={!model.online || model.busy || model.access === 'lost' || !!model.pending || !queryValid} onPress={refresh} /></View>
      </SummaryDisclosure>
      {queryChanged ? <Text style={s.warning}>新選項尚未套用，目前仍顯示：{summaryPeriodLabel(page!.period)}。</Text> : null}
      {model.busy && model.operation === 'saving' ? <Text style={s.meta}>正在保存…</Text> : model.busy && !page ? <ReadStateNotice state="loading" scopeKey={model.scopeKey} message="正在讀取摘要…" /> : null}
      {!model.online ? <Text style={s.warning}>目前離線；草稿及原操作只留本頁，不會排隊提交。</Text> : null}
      {model.access === 'lost' ? <Text style={s.warning}>已無權存取；舊資料、草稿及原操作已清除。</Text> : null}
      {model.readFailed && page && !model.notice ? <Text style={s.warning}>目前摘要尚未重新核對，暫停保存；已顯示資料可能過時。</Text> : null}
      {model.notice ? <Text style={model.operation === 'saved' ? s.body : s.warning}>{model.notice}</Text> : null}
      {(model.readFailed || model.pending) && model.access !== 'lost' ? <View style={s.row}><AppButton label={model.pending ? '先查原收據及更新摘要' : '重新讀取摘要'} density="compact" variant="secondary" disabled={!model.online || model.busy || !model.pending && !queryValid} onPress={refresh} /></View> : null}
    </View>
    {/* Recovery stays visible in both modes, independent of the mounted editor. */}
    {model.pending ? <SectionCard testID="summary-pending"><SectionHeader density="compact" title={model.pending.confirmed ? '原保存已確認，摘要待讀回' : '原保存操作待核對'} icon="information-outline" />
      <Text style={s.warning}>{model.pending.confirmed ? '不能再次提交；先查收據及讀取最新摘要。' : '結果尚未確認。保留原識別、內容及版本，不能另建一次保存。'}</Text>
      <SummaryDisclosure label="核對原操作內容與版本" scopeKey={`${model.scopeKey}:${model.pending.reference}`}>
        <Text selectable style={s.meta}>原操作：{model.pending.reference}（合成參考） · 準備版本 {model.pending.input.expectedVersion} · 摘要 {model.pending.input.basisVersion}</Text><Text style={s.body}>{summaryPeriodLabel(model.pending.input.period)}</Text><Text style={s.body}>原預約：{model.pending.appointmentLabel} · 核對標記：{model.pending.input.reviewed ? '已核對' : '未核對'}</Text>
        {model.pending.input.questions.map((text, index) => <Text key={index} selectable style={s.body}>原問題 {index + 1}：{text}</Text>)}{model.pending.input.checklist.map((item, index) => <Text key={index} selectable style={s.body}>原準備 {index + 1}：{item.done ? '已完成' : '未完成'} · {item.text}</Text>)}
      </SummaryDisclosure>
      {!model.pending.confirmed ? <><AppCheckbox label="我已核對目前摘要，同意用原操作識別及內容重試" checked={model.originalConsent} disabled={!canRetry} onChange={actions.setOriginalConsent} /><AppButton label="以原操作明確重試到診準備" disabled={!canRetry || !model.originalConsent} onPress={actions.retryOriginal} /></> : null}
    </SectionCard> : null}
    {page ? <View style={s.stack}>
      <UnderlineTabs id={tabsId} label={recoveryMode ? '舊共享準備及原依據' : '摘要閱讀與到診準備'} items={[{key: 'report', label: recoveryMode ? '核對原摘要依據' : '閱讀摘要'}, {key: 'preparation', label: model.dirty ? '到診準備 · 未保存' : '到診準備'}]} value={mode} onChange={next => setView({scope: model.scopeKey, mode: next})} />
      {mode === 'report' && (currentDraftStatus?.stale || model.operation === 'conflict' && model.readFailed) ? <Text style={s.warning}>到診準備的原依據與目前資料有差異，保存已暫停。請進入到診準備核對最新來源及家庭修改。</Text> : null}
      {mode === 'report' && currentDraftStatus?.appointmentMissing ? <Text style={s.warning}>草稿中的預約已不在目前清單；請進入到診準備明確另選，原草稿仍保留。</Text> : null}
      {model.dirty && mode === 'report' ? <Text style={s.warning}>到診準備有未保存草稿，切回後可繼續核對；離開此頁前仍須處理草稿。</Text> : null}
      <AppTabPanel tabsId={tabsId} tabKey="report" active={mode === 'report'}>
        <View style={s.report} testID="summary-report">
          <View ref={reportHeadingRef} tabIndex={-1} accessibilityLabel="摘要閱讀內容" style={s.reportHeader}>
            <MotionReveal value={page} contentKey={basisKey} scopeKey={model.scopeKey} regionKey="summary-basis" triggerKey={revealTrigger} eligible={revealEligible && mode === 'report'} preset="summary" style={s.smallStack} testID="summary-basis-motion">{shown => <>
              <Text style={s.reportEyebrow}>已確認記錄 · {shown.period.period === 'day' ? '一日回顧' : '七日回顧'}</Text>
              <Text accessibilityRole="header" style={s.reportTitle}>{shown.period.startDay} 起{shown.period.period === 'day' ? '一日' : '七日'}</Text>
              <Text style={s.meta}>至 {shown.endDayExclusive}（不包括此日） · {shown.period.timeZone}</Text>
              <Text style={s.meta}>{shown.profile.ageLabel}</Text>
            </>}</MotionReveal>
          </View>
          <SummaryRecords key={model.scopeKey} page={page} onRecord={onRecord} onTask={onTask} emptyReady={emptyReady} motion={{scopeKey: model.scopeKey, triggerKey: revealTrigger, eligible: revealEligible && mode === 'report'}} />
          <SummaryDisclosure label="報告依據、更新時間與版本" scopeKey={model.scopeKey}>
            <Text style={s.meta}>生成：{summaryTime(page.generatedAt, page.period.timeZone)}</Text><Text selectable style={s.meta}>依據版本：{page.basisVersion}</Text>
            <Text style={s.meta}>檔案版本 {page.profile.version} · 來源：{page.profile.source}</Text>
            {page.profile.confirmedAt ? <Text style={s.meta}>檔案核對：{page.profile.confirmedBy} · {summaryTime(page.profile.confirmedAt)} · {page.profile.reason ?? '未記錄'}</Text> : null}
          </SummaryDisclosure>
          <View style={s.reportFooter}><Text style={s.meta}>只整理有來源的記錄，不作診斷；沒有記錄不等於沒有發生。</Text><Text style={s.meta}>目前只提供頁內閱讀及家庭準備；PDF／下載尚未提供。</Text></View>
        </View>
      </AppTabPanel>
      <AppTabPanel tabsId={tabsId} tabKey="preparation" active={mode === 'preparation'} style={s.stack}>
        <View style={s.row}><AppButton label={recoveryMode ? "核對原摘要依據" : "返回閱讀摘要"} density="compact" variant="quiet" onPress={() => {returnFocus.current = true; setView({scope: model.scopeKey, mode: 'report'});}} /></View>
        <PreparationCard key={model.scopeKey} model={model} actions={actions} onAgent={onAgent} onRecord={onRecord} onTask={onTask} onDraftStatusChange={setDraftStatus} />
      </AppTabPanel>
    </View> : null}
    {previewTools}
  </PageFrame>;
}
