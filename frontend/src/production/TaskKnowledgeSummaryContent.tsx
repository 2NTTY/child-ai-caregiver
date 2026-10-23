import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Text } from "react-native-paper";
import { AppDialog } from "../components/AppDialog";
import { AppScrollView } from "../components/AppScrollView";
import { AppCheckbox } from "../components/AppCheckbox";
import { ReadStateNotice } from "../components/ReadStateNotice";
import { AppDateField, AppTimeZoneSelect } from "../components/DateTimeFields";
import { AppButton, AppSelect, SectionCard, SectionHeader } from "../components/ui";
import { PreparationCard } from "../components/summary/PreparationCard";
import { SummaryRecords } from "../components/summary/SummaryRecords";
import { SummaryDisclosure } from "../components/summary/SummaryDisclosure";
import { summaryPeriodSchema } from "../components/summary/summary-form";
import { summaryPeriodLabel, summaryTime } from "../summary-view-model";
import { summaryStyles as s } from "../components/summary/summary-styles";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { useProductionTaskKnowledgeSummary } from "./TaskKnowledgeDomains";

export function TaskKnowledgeSummaryContent({ preparation = false, onRecord, onTask, onAgent }: {
  preparation?: boolean; onRecord(id: string): void; onTask(id: string): void; onAgent?(): void;
}) {
  const owner = useProductionTaskKnowledgeSummary();
  const [open, setOpen] = useState(false), navigate = usePreviewNavigation();
  const latest = useRef(owner); latest.current = owner;
  useEffect(() => () => { const value = latest.current; if (value?.model.dirty && !value.model.pending && !value.model.busy) value.actions.discard(); }, []);
  if (!owner) return <ReadStateNotice state="loading" message="正在讀取摘要…" />;
  const { model, actions } = owner, page = model.page;
  const emptyReady = !!page && model.online && !model.readFailed && !model.pending && model.access !== "lost"
    && (model.operation === "none" || model.operation === "saved");
  const canRetry = model.online && !model.busy && !model.readFailed && model.access === "editable" && !!page?.canManage && !!model.pending?.checked && !model.pending.confirmed;
  const locked = model.busy || !!model.pending || model.access === "lost";
  const quietRead = model.busy && emptyReady;
  return <View style={s.stack}>
    <SectionCard><SectionHeader density="compact" title={preparation ? "單一到診準備" : "已確認照顧摘要"} subtitle={model.dataLabel}
      action={model.readFailed || model.pending ? <AppButton label={model.pending ? "查原收據及更新摘要" : "重新讀取摘要"} variant="secondary" density="compact" disabled={!model.online || model.busy || model.access === "lost" || !summaryPeriodSchema.safeParse(model.query).success} onPress={actions.refresh} /> : undefined} />
      <SummaryDisclosure label="選擇摘要期間" scopeKey={model.scopeKey}>
        <AppDateField label="摘要開始日" value={model.query.startDay} disabled={locked} preserveFocusWhenDisabled={quietRead} onChange={startDay => actions.updateQuery({ ...model.query, startDay })} />
        <AppSelect label="摘要期間" value={model.query.period} options={[{ value: "day", label: "一日" }, { value: "week", label: "連續七日" }]} disabled={locked} preserveFocusWhenDisabled={quietRead} onChange={period => actions.updateQuery({ ...model.query, period })} />
        <AppTimeZoneSelect value={model.query.timeZone} disabled={locked} preserveFocusWhenDisabled={quietRead} onChange={timeZone => actions.updateQuery({ ...model.query, timeZone })} />
        <AppButton label="套用期間" variant="secondary" density="compact" disabled={locked || !model.online || !summaryPeriodSchema.safeParse(model.query).success} preserveFocusWhenDisabled={quietRead} onPress={actions.refresh} />
      </SummaryDisclosure>
      {!model.online ? <Text style={s.warning}>目前離線；已有資料可能過時，沒有離線提交佇列。</Text> : null}
      {model.readFailed && !model.notice ? <Text style={s.warning}>最新摘要未能核對，暫停保存；目前已顯示資料可能過時。</Text> : null}
      {model.notice ? <Text accessibilityLiveRegion="polite" style={s.meta}>{model.notice}</Text> : null}
      {page ? <><Text style={s.meta}>{summaryPeriodLabel(page.period)} · 整理於 {summaryTime(page.generatedAt, page.period.timeZone)}</Text>
        {preparation ? <AppButton label={model.access === "editable" ? "查看／人工修改共享到診準備" : "查看共享到診準備"} variant="secondary" disabled={model.access === "lost"} onPress={() => setOpen(true)} />
          : <SummaryRecords page={page} onRecord={onRecord} onTask={onTask} emptyReady={emptyReady} motion={{ scopeKey: model.scopeKey, triggerKey: null, eligible: false }} />}
      </> : model.access === "lost" ? <Text style={s.body}>已無權讀取這位孩子的摘要。</Text> : model.busy ? <ReadStateNotice state="loading" scopeKey={model.scopeKey} message="正在讀取摘要…" /> : !model.readFailed ? <Text style={s.body}>摘要尚未取得。</Text> : null}
    </SectionCard>
    {model.pending ? <SectionCard><SectionHeader density="compact" title={model.pending.confirmed ? "原保存已確認，摘要待讀回" : "原保存結果待核對"} />
      <Text style={s.warning}>{model.pending.confirmed ? "不能再次提交；先查收據及讀取最新摘要。" : "原內容、版本及操作識別保留，不能另建一次保存。"}</Text>
      <SummaryDisclosure label="原保存內容與依據" scopeKey={model.scopeKey}>
        <Text style={s.meta}>{model.pending.reference ? `原操作：${model.pending.reference}` : "原操作識別由傳輸層保留，尚未有確認收據。"} · 準備版本 {model.pending.input.expectedVersion}</Text>
        <Text selectable style={s.meta}>原摘要依據：{model.pending.input.basisVersion} · {summaryPeriodLabel(model.pending.input.period)}</Text>
        <Text style={s.body}>原預約：{model.pending.appointmentLabel} · {model.pending.input.reviewed ? "已核對" : "未核對"}</Text>
        {model.pending.input.questions.map((text, index) => <Text key={index} selectable style={s.body}>問題 {index + 1}：{text}</Text>)}
        {model.pending.input.checklist.map((item, index) => <Text key={index} selectable style={s.body}>準備 {index + 1}：{item.done ? "已完成" : "未完成"} · {item.text}</Text>)}
      </SummaryDisclosure>
      {!model.pending.confirmed ? <><AppCheckbox label="我已核對目前摘要，同意用原操作識別及內容重試" checked={model.originalConsent} disabled={!canRetry} onChange={actions.setOriginalConsent} />
        <AppButton label="明確重試原到診準備保存" disabled={!canRetry || !model.originalConsent} onPress={actions.retryOriginal} /></> : null}
    </SectionCard> : null}
    <AppDialog visible={open && !!page && model.access !== "lost"} onDismiss={() => navigate(() => { actions.discard(); setOpen(false); })} accessibilityLabel="家庭共享到診準備">
      <AppDialog.Title>家庭共享到診準備</AppDialog.Title>
      <AppDialog.ScrollArea><AppScrollView>
        {model.pending ? <View style={s.stack}><Text style={s.warning}>{model.notice}</Text><AppButton label="查原收據及更新摘要" variant="secondary" disabled={!model.online || model.busy} onPress={actions.refresh} />
          {!model.pending.confirmed ? <><AppCheckbox label="我同意沿原識別、原內容及版本重試" checked={model.originalConsent} disabled={!canRetry} onChange={actions.setOriginalConsent} /><AppButton label="明確重試原保存" disabled={!canRetry || !model.originalConsent} onPress={actions.retryOriginal} /></> : null}
        </View> : null}
        {page ? <PreparationCard model={model} actions={actions} onRecord={onRecord} onTask={onTask} onAgent={onAgent} /> : null}</AppScrollView></AppDialog.ScrollArea>
      <AppDialog.Actions><AppButton label="返回準備單" variant="quiet" onPress={() => navigate(() => { actions.discard(); setOpen(false); })} /></AppDialog.Actions>
    </AppDialog>
  </View>;
}
