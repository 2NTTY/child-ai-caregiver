import { Pressable, View } from "react-native";
import { Text } from "react-native-paper";
import { growthStateLabels, growthTime, type GrowthConcern, type GrowthPage } from "../../growth-view-model";
import { AppButton, SectionHeader } from "../ui";
import { growthStyles as s } from "./growth-styles";

const eventLabels = {agent_proposal: "助手提議", observation: "原始觀察", pending_record: "待核對記錄", confirmed_action: "已確認跟進"};
const concernLabels = {proposed: "待家長核對", following: "持續關注", closed: "已結束"};
export function GrowthConcernIndex({items, selectedId, onSelect}: {items: GrowthConcern[]; selectedId: string | null; onSelect: (id: string) => void}) {
  return <View style={s.concernIndex}><Text style={s.eyebrow}>關注索引</Text>{items.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`查看關注：${item.title}`} aria-current={selectedId === item.id ? "true" : undefined} onPress={() => onSelect(item.id)} style={({pressed}) => [s.concernRow, selectedId === item.id && s.concernSelected, pressed && s.pressed]}>
    <Text style={s.title}>{item.title}</Text><Text style={s.meta}>{concernLabels[item.status]}{selectedId === item.id ? " · 正在查看" : ""}</Text>
  </Pressable>)}</View>;
}
export function GrowthConcernTimeline({concern, page, onRecord, onTask}: {concern: GrowthConcern; page: GrowthPage; onRecord?: (id?: string) => void; onTask: (id: string) => void}) {
  const confirmed = page.items.filter(item => concern.attentionIds.includes(item.id) && item.state !== "proposed");
  return <View style={s.timelinePanel} testID="growth-concern-timeline">
    <View style={s.concernHeading}><Text style={s.eyebrow}>{concernLabels[concern.status]}</Text><Text accessibilityRole="header" style={s.concernTitle}>{concern.title}</Text><Text style={s.reading}>{concern.reason}</Text></View>
    <SectionHeader density="compact" title="關注的前後經過" subtitle="觀察、助手建議與家長已確認的操作分開呈現。" />
    <View style={s.timeline}>{concern.events.map(event => <View key={event.id} style={s.timelineEvent}>
      <View style={[s.timelineDot, event.kind === "pending_record" && s.timelinePending]} />
      <Text style={s.meta}>{growthTime(event.at)} · {eventLabels[event.kind]}</Text><Text style={s.title}>{event.title}</Text><Text style={s.reading}>{event.text}</Text><Text style={s.meta}>依據：{event.sourceLabel}</Text>
      {event.recordId && onRecord ? <AppButton label="查看原始記錄" variant="quiet" onPress={() => onRecord(event.recordId)} /> : null}
      {event.kind === "pending_record" && onRecord ? <AppButton label="前往待核對記錄" variant="quiet" onPress={() => onRecord()} /> : null}
      {event.taskId ? <AppButton label="查看已連結跟進" variant="quiet" onPress={() => onTask(event.taskId!)} /> : null}
    </View>)}</View>
    {confirmed.length ? <View style={s.divider}><Text style={s.title}>已有確認結果</Text>{confirmed.map(item => <View key={item.id} style={s.confirmedRow}><Text style={s.body}>{item.title} · {growthStateLabels[item.state]}</Text><Text style={s.meta}>{growthTime(item.updatedAt)} · 版本 {item.version} · {item.note || "沒有補充備註"}</Text><Text style={s.meta}>{item.taskId ? "已連結任務；狀態須以任務為準。" : "沒有連結任務；不代表已完成行動。"}</Text></View>)}</View> : null}
    {!concern.historyComplete ? <Text style={s.meta}>只列已取得的事件；較早經過仍未完整載入。</Text> : null}
    {concern.measurement?.points.length ? <View style={s.divider}><SectionHeader density="compact" title={concern.measurement.label} subtitle="只列來源提供的量測原值，不推算百分位或異常。" />{concern.measurement.points.map(point => <View key={point.id} style={s.confirmedRow}><Text style={s.body}>{point.value} {point.unit}</Text><Text style={s.meta}>{growthTime(point.at)}</Text>{onRecord ? <AppButton label="核對量測來源" variant="quiet" onPress={() => onRecord(point.sourceRecordId)} /> : null}</View>)}</View> : null}
  </View>;
}
