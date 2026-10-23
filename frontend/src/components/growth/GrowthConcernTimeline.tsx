import { AppStatusBadge } from "../AppStatusBadge";
import { AppIcon } from "../AppIcon";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { growthConcernFollowUpLabel, growthConcernTimelineEntries, growthStateLabels, growthTime, type GrowthConcern, type GrowthPage } from "../../growth-view-model";
import { taskStateLabels } from "../../task-view-model";
import { AppButton, SectionHeader } from "../ui";
import { growthStyles as s } from "./growth-styles";
import { spacing } from "../../theme";

const eventLabels = {agent_proposal: "助手提議", observation: "原始觀察", pending_record: "待核對記錄", confirmed_action: "已確認操作"};
const concernLabels = {proposed: "待家長核對", following: "持續關注", closed: "已結束"};
export function GrowthConcernIndex({items, selectedId, onSelect}: {items: GrowthConcern[]; selectedId: string | null; onSelect: (id: string) => void}) {
  return <View style={s.concernIndex}><Text style={s.eyebrow}>關注索引</Text>{items.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`查看關注：${item.title}`} aria-current={selectedId === item.id ? "true" : undefined} onPress={() => onSelect(item.id)} style={({pressed}) => [s.concernRow, selectedId === item.id && s.concernSelected, pressed && (selectedId === item.id ? s.selectedPressed : s.pressed)]}>
    <View style={s.row}><Text style={[s.title, {flex: 1}]}>{item.title}</Text><AppIcon name="chevron-right" size={16} /></View><AppStatusBadge label={concernLabels[item.status]} tone={item.status === "proposed" ? "warning" : item.status === "following" ? "info" : "neutral"} />{selectedId === item.id ? <Text style={s.meta}>正在查看</Text> : null}
  </Pressable>)}</View>;
}
export function GrowthConcernTimeline({concern, page, onRecord, onTask}: {concern: GrowthConcern; page: GrowthPage; onRecord?: (id?: string) => void; onTask: (id: string) => void}) {
  const entries = growthConcernTimelineEntries(concern, page);
  const followUpLabel = growthConcernFollowUpLabel(concern);
  return <View style={s.timelinePanel} testID="growth-concern-timeline" accessibilityLabel={`關注：${concern.title}`}>
    <View style={s.concernHeading} testID="growth-concern-summary">
      <View style={s.row}><Text accessibilityRole="header" style={s.eyebrow}>關注說明</Text><AppStatusBadge label={concernLabels[concern.status]} tone={concern.status === "proposed" ? "warning" : concern.status === "following" ? "info" : "neutral"} /></View>
      <Text style={s.concernSummary}>{concern.reason}</Text>
    </View>
    {followUpLabel ? <Text style={s.meta}>{followUpLabel}</Text> : null}
    <SectionHeader density="compact" title="跟進記錄" />
    <View style={s.timeline}>{entries.map((entry, index) => {
      const marker = <>
        {index > 0 ? <View pointerEvents="none" style={[s.timelineLine, s.timelineLineBefore]} testID={`growth-timeline-line-before-${index}`} /> : null}
        {index < entries.length - 1 ? <View pointerEvents="none" style={[s.timelineLine, s.timelineLineAfter]} testID={`growth-timeline-line-after-${index}`} /> : null}
        <View pointerEvents="none" style={[s.timelineDot, entry.kind === "event" && entry.event.kind === "pending_record" && s.timelinePending]} testID={`growth-timeline-dot-${index}`} />
      </>;
      if (entry.kind === "attention_state") {
        const { item } = entry;
        return <View key={`attention:${item.id}:${item.version}`} style={s.timelineEvent} testID={`growth-attention-state-${item.id}`}>
          {marker}
          <View style={s.row}><AppStatusBadge label={`建議${growthStateLabels[item.state]}`} tone="neutral" /><View accessible accessibilityLabel={`狀態更新：${Number.isNaN(Date.parse(item.updatedAt)) ? "時間未提供" : growthTime(item.updatedAt)}`} style={styles.metadataItem}><AppIcon name="history" size={14} /><Text style={s.meta}>更新 {Number.isNaN(Date.parse(item.updatedAt)) ? "時間未提供" : growthTime(item.updatedAt)}</Text></View></View>
          <Text style={s.title}>{item.title}</Text>
          {item.note ? <Text style={s.reading}>{item.note}</Text> : null}
          {!item.sourceAvailable ? <Text style={s.meta}>原建議的來源或依據已失效；這裏只保留處理狀態，不作目前建議。</Text> : null}
          <Text style={s.meta}>{item.taskId ? `已連結任務${item.taskState ? ` · 讀取時：${taskStateLabels[item.taskState]}` : " · 狀態未提供"}；目前狀態以任務為準。` : "沒有連結任務；不代表已完成行動。"}</Text>
          {item.taskId ? <AppButton label="查看已連結跟進" variant="quiet" onPress={() => onTask(item.taskId!)} /> : null}
        </View>;
      }
      const { event } = entry;
      const eventTime = Number.isNaN(Date.parse(event.at)) ? "時間未提供" : growthTime(event.at);
      return <View key={`event:${event.id}`} style={s.timelineEvent}>
      {marker}
      <Text style={s.title}>{event.title}</Text><Text style={s.reading}>{event.text}</Text>
      <View style={s.row}>
        {event.kind === "pending_record" || event.kind === "confirmed_action" ? <AppStatusBadge label={eventLabels[event.kind]} tone={event.kind === "pending_record" ? "warning" : "success"} />
          : <View accessible accessibilityLabel={`事件種類：${eventLabels[event.kind]}`} style={styles.metadataItem}><AppIcon name={event.kind === "agent_proposal" ? "star-four-points" : "notebook-outline"} size={14} /><Text style={s.meta}>{eventLabels[event.kind]}</Text></View>}
        <View accessible accessibilityLabel={`事件時間：${eventTime}`} style={styles.metadataItem}><AppIcon name="clock-outline" size={14} /><Text style={s.meta}>{eventTime}</Text></View>
      </View>
      {event.recordId && onRecord ? <AppButton label="查看原始記錄" variant="quiet" onPress={() => onRecord(event.recordId)} /> : null}
      {event.kind === "pending_record" && onRecord ? <AppButton label="前往待核對記錄" variant="quiet" onPress={() => onRecord()} /> : null}
      {event.taskId ? <AppButton label="查看已連結跟進" variant="quiet" onPress={() => onTask(event.taskId!)} /> : null}
    </View>;})}</View>
    {!concern.historyComplete ? <Text style={s.meta}>只列已取得的事件；較早經過仍未完整載入。</Text> : null}
    {concern.measurement?.points.length ? <View style={s.divider}><SectionHeader density="compact" title={concern.measurement.label} subtitle="只列來源提供的量測原值，不推算百分位或異常。" />{concern.measurement.points.map(point => <View key={point.id} style={s.confirmedRow}><Text style={s.body}>{point.value} {point.unit}</Text><Text style={s.meta}>{growthTime(point.at)}</Text>{onRecord ? <AppButton label="核對量測來源" variant="quiet" onPress={() => onRecord(point.sourceRecordId)} /> : null}</View>)}</View> : null}
  </View>;
}

const styles = StyleSheet.create({
  metadataItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minWidth: 0, maxWidth: "100%", flexShrink: 1 },
});
