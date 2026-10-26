import { View } from "react-native";
import { Text } from "react-native-paper";
import type { SummaryViewModel } from "../../summary-view-model";
import { summaryPeriodLabel, summaryTime } from "../../summary-view-model";
import { AppStatusBadge } from "../AppStatusBadge";
import { AppIcon } from "../AppIcon";
import { AppButton } from "../ui";
import { EmptyListCard } from "../EmptyListCard";
import type { PreparationFormValues } from "./summary-form";
import { SummaryDisclosure } from "./SummaryDisclosure";
import { summaryStyles as s } from "./summary-styles";

export function PreparationSheet({ model, values, onEdit, onAgent, onRecord, onTask, editable, stale = false }: {
  model: SummaryViewModel; values: PreparationFormValues; onEdit(): void; editable: boolean;
  onAgent?: () => void; onRecord?: (id: string) => void; onTask?: (id: string) => void; stale?: boolean;
}) {
  const page = model.page!;
  const appointment = page.appointments.find(task => task.id === values.appointmentTaskId);
  const missingAppointment = !!values.appointmentTaskId && !appointment;
  const questions = values.questions ?? [], checklist = values.checklist ?? [];
  const emptyReady = model.online && !model.readFailed && !model.busy && !model.pending && model.access !== "lost"
    && (model.operation === "none" || model.operation === "saved");
  const draftEmptyReady = model.dirty && model.access !== "lost";
  const preparationEmptyReady = draftEmptyReady || emptyReady && !stale;
  const agentBlocked = model.dirty || !!model.pending || model.busy || !model.online || model.readFailed || model.access === "lost";
  return <View style={s.preparationSheet} testID="preparation-reading-sheet">
    <View style={s.preparationHeading}>
      <View style={s.smallStack}>
        <Text style={s.reportEyebrow}>這次到診</Text>
        <Text accessibilityRole="header" aria-level={3} style={s.reportTitle}>{appointment?.title ?? (missingAppointment ? "原預約暫未能核對" : "尚未指定預約")}</Text>
        <Text style={s.body}>日期：{appointment ? summaryTime(appointment.occurrence.dueAt, appointment.occurrence.timeZone) : "尚未提供"}</Text>
        <Text style={s.body}>負責人：{appointment ? "名稱未提供，請查看原安排" : "尚未指定"}</Text>
        {appointment ? <SummaryDisclosure label="預約來源與負責人識別" scopeKey={`${model.scopeKey}:${appointment.id}`}><Text style={s.meta}>原安排：{appointment.id} · 負責人識別：{appointment.assigneeUserId} · 版本 {appointment.version}</Text></SummaryDisclosure> : null}
        {appointment ? <Text style={s.meta}>{appointment.occurrence.timeZone} · 這是家庭安排，不表示機構已確認預約。</Text> : <Text style={s.meta}>{missingAppointment ? "原選擇保留，沒有自動改選；請核對目前可用預約。" : "可在修改準備單時選擇已載入的家庭安排。"}</Text>}
      </View>
      <View style={s.row}>
        {onAgent ? <AppButton label="請 Agent 整理／更新" variant="accent" disabled={agentBlocked} onPress={onAgent} /> : null}
        <AppButton label={model.dirty ? "繼續修改準備單" : "修改準備單"} variant="secondary" disabled={!editable} onPress={onEdit} />
        {appointment && onTask ? <AppButton label="前往待辦核對" variant="quiet" onPress={() => onTask(appointment.id)} /> : null}
      </View>
      {!onAgent ? <Text style={s.meta}>助手整理暫不可用。</Text> : null}
      {model.dirty ? <Text style={s.warning}>以下是本頁未保存草稿；先保存或明確放棄修改，再交給助手。</Text> : null}
    </View>
    <View style={s.preparationSection} testID="preparation-reading-questions">
      <Text accessibilityRole="header" aria-level={3} style={s.title}>想問的問題</Text>
      {questions.length ? questions.map((question, index) => <View key={index} style={s.preparationListRow}><Text style={s.preparationNumber}>{index + 1}</Text><Text selectable style={[s.reading, s.preparationItemCopy]}>{question.text || "空白問題，待補充"}</Text></View>) : preparationEmptyReady ? <EmptyListCard title={draftEmptyReady ? "目前草稿沒有到診問題" : "已載入的準備單沒有到診問題"} detail="可在修改準備單時補充想問的問題。" icon="help-circle" testID="preparation-reading-questions-empty" /> : null}
      {questions.length ? <AppStatusBadge label={model.dirty ? "問題草稿 · 未保存" : page.reviewCurrent ? "問題已核對" : "問題待核對"} tone={!model.dirty && page.reviewCurrent ? "success" : "warning"} /> : null}
    </View>
    <View style={s.preparationSection} testID="preparation-reading-observations">
      <Text accessibilityRole="header" aria-level={3} style={s.title}>可供核對的近期觀察</Text>
      <Text style={s.meta}>{summaryPeriodLabel(page.period)} · 只列本期間已載入的原記錄，尚未取得與這次預約的關聯整理。</Text>
      {page.records.length ? page.records.map(record => <View key={record.id} style={s.preparationObservation}>
        <AppStatusBadge label="家長已確認的原記錄" tone="success" />
        <Text selectable style={s.reading}>{record.text}</Text>
        <Text style={s.meta}>{record.eventTime.at ? summaryTime(record.eventTime.at, record.eventTime.timeZone) : "事件時間未提供"} · 來源：{record.source || "未提供"}</Text>
        <View style={s.row}>{onRecord ? <AppButton label="前往記錄核對" variant="quiet" density="compact" onPress={() => onRecord(record.id)} /> : null}
          <SummaryDisclosure label="確認資料" scopeKey={`${model.scopeKey}:${record.id}`}><Text style={s.meta}>{record.confirmedBy || "確認者未提供"} · {summaryTime(record.confirmedAt)} · 版本 {record.version}</Text><Text style={s.meta}>{record.reason || "確認原因未提供"}</Text></SummaryDisclosure>
        </View>
      </View>) : emptyReady ? <EmptyListCard title="本期間已載入的原記錄清單為空" detail="目前沒有可展示的觀察來源；沒有記錄不等於沒有發生。" icon="notebook-outline" testID="preparation-reading-observations-empty" /> : null}
      {page.missing.unknownEventTime > 0 ? <AppStatusBadge label={`${page.missing.unknownEventTime} 筆原記錄事件時間未知，未納入本期間`} tone="warning" /> : null}
    </View>
    <View style={s.preparationSection} testID="preparation-reading-checklist">
      <Text accessibilityRole="header" aria-level={3} style={s.title}>要帶的物品與準備</Text>
      {checklist.length ? checklist.map((item, index) => <View key={index} style={s.preparationListRow}>
        <AppIcon name={item.done ? "check-circle" : "checkbox-blank-outline"} size={19} />
        <View style={s.preparationItemCopy}><Text selectable style={s.reading}>{item.text || "空白準備項目，待補充"}</Text><AppStatusBadge label={item.done ? model.dirty ? "草稿已勾選 · 未保存" : "已回報準備好" : "尚待準備"} tone={item.done && !model.dirty ? "success" : "warning"} /></View>
      </View>) : preparationEmptyReady ? <EmptyListCard title={draftEmptyReady ? "目前草稿沒有準備清單項目" : "已載入的準備單沒有準備清單項目"} detail="可在修改準備單時補充要帶的物品與準備。" icon="preparation-outline" testID="preparation-reading-checklist-empty" /> : null}
    </View>
  </View>;
}
