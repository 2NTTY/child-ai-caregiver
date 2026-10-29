import { AppStatusBadge } from "../AppStatusBadge";
import { AppIcon } from "../AppIcon";
import { useState } from "react";
import { Link, type Href } from "expo-router";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { growthConcernFollowUpLabel, growthConcernTimelineEntries, growthStateLabels, growthTime, type GrowthConcern, type GrowthPage } from "../../growth-view-model";
import { taskStateLabels } from "../../task-view-model";
import { SectionHeader } from "../ui";
import { OwnedRouteTextLink } from "../OwnedRouteTextLink";
import { growthStyles as s } from "./growth-styles";
import { spacing } from "../../theme";

const eventLabels = {agent_proposal: "助手提議", observation: "原始觀察", pending_record: "待核對記錄", confirmed_action: "已確認操作"};
const concernLabels = {proposed: "待家長核對", following: "持續關注", closed: "已結束"};
export function GrowthConcernIndex({items, selectedId, href, onSelect}: {items: GrowthConcern[]; selectedId: string | null; href(id: string): Href; onSelect: (id: string) => void}) {
  return <View style={s.concernIndex}>{items.map(item => <GrowthConcernLink key={item.id} item={item} selected={selectedId === item.id} href={href(item.id)} onOpen={() => onSelect(item.id)} />)}</View>;
}
function GrowthConcernLink({ item, selected, href, onOpen }: { item: GrowthConcern; selected: boolean; href: Href; onOpen(): void }) {
  const [focused, setFocused] = useState(false), [hovered, setHovered] = useState(false), [pressed, setPressed] = useState(false);
  return <Link href={href} asChild onPress={event => {
    type Click = { defaultPrevented?: boolean; button?: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean };
    const click = event as unknown as Click & { nativeEvent?: Click };
    if (Platform.OS === "web" && [click, click.nativeEvent].some(value => value && (value.defaultPrevented || value.metaKey || value.ctrlKey || value.shiftKey || value.altKey || value.button !== undefined && value.button !== 0))) return;
    event.preventDefault(); onOpen();
  }}><Pressable accessibilityRole="link" accessibilityLabel={`查看關注：${item.title}`} aria-current={selected ? "true" : undefined} accessibilityState={Platform.OS === "web" ? undefined : { selected }}
    onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setPressed(false); }} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
    style={StyleSheet.flatten([s.concernRow, selected && s.concernSelected, (hovered || pressed) && (selected ? s.selectedPressed : s.pressed), focused && s.concernFocused])}>
    <View style={s.row}><Text style={[s.title, s.concernLinkTitle]}>{item.title}</Text><AppIcon name="chevron-right" size={16} /></View><AppStatusBadge label={concernLabels[item.status]} tone={item.status === "proposed" ? "warning" : item.status === "following" ? "info" : "neutral"} />{selected ? <Text style={s.meta}>正在查看</Text> : null}
  </Pressable></Link>;
}
type ConcernReadingProps = {concern: GrowthConcern; page: GrowthPage; onRecord?: (id?: string) => void; onTask: (id: string) => void};

export function GrowthConcernSummary({concern}: {concern: GrowthConcern}) {
  const followUpLabel = growthConcernFollowUpLabel(concern);
  return <View style={s.smallStack}>
    <View style={s.concernHeading} testID="growth-concern-summary">
      <Text accessibilityRole="header" aria-level={2} style={s.concernTitle}>{concern.title}</Text>
      <Text selectable style={s.concernSummary}>{concern.reason}</Text>
      <View style={s.row}><AppStatusBadge label={concernLabels[concern.status]} tone={concern.status === "proposed" ? "warning" : concern.status === "following" ? "info" : "neutral"} /></View>
    </View>
    {followUpLabel ? <Text style={s.meta}>{followUpLabel}</Text> : null}
  </View>;
}

export function GrowthConcernTimeline(props: ConcernReadingProps) {
  return <View style={s.timelinePanel} testID="growth-concern-timeline" accessibilityLabel={`關注：${props.concern.title}`}>
    <GrowthConcernSummary concern={props.concern} />
    <GrowthConcernEvents {...props} />
  </View>;
}

export function GrowthConcernEvents({concern, page, onRecord, onTask}: ConcernReadingProps) {
  const entries = growthConcernTimelineEntries(concern, page);
  return <View style={s.timelinePanel} testID="growth-concern-events">
    <SectionHeader density="compact" level={3} title="跟進記錄" />
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
          <View style={s.row}><AppStatusBadge label={`建議${growthStateLabels[item.state]}`} tone="neutral" /><View accessible accessibilityLabel={`狀態更新：${Number.isNaN(Date.parse(item.updatedAt)) ? "時間未提供" : growthTime(item.updatedAt)}`} style={styles.metadataItem}><Text style={s.meta}>狀態更新</Text><Text style={s.meta}>{Number.isNaN(Date.parse(item.updatedAt)) ? "時間未提供" : growthTime(item.updatedAt)}</Text></View></View>
          <Text accessibilityRole="header" aria-level={4} style={s.title}>{item.title}</Text>
          {item.note ? <Text selectable style={s.reading}>{item.note}</Text> : null}
          {!item.sourceAvailable ? <Text style={s.meta}>原建議的來源或依據已失效；這裏只保留處理狀態，不作目前建議。</Text> : null}
          <Text style={s.meta}>{item.taskId ? `已連結任務${item.taskState ? ` · 讀取時：${taskStateLabels[item.taskState]}` : " · 狀態未提供"}；目前狀態以任務為準。` : "沒有連結任務；不代表已完成行動。"}</Text>
          {item.taskId ? <OwnedRouteTextLink href={{ pathname: "/tasks", params: { taskId: item.taskId } }} label="查看已連結跟進" onOpen={() => onTask(item.taskId!)} /> : null}
        </View>;
      }
      const { event } = entry;
      const eventTime = Number.isNaN(Date.parse(event.at)) ? "時間未提供" : growthTime(event.at);
      return <View key={`event:${event.id}`} style={s.timelineEvent}>
      {marker}
      <Text accessibilityRole="header" aria-level={4} style={s.title}>{event.title}</Text><Text selectable style={s.reading}>{event.text}</Text>
      <View style={s.row}>
        {event.kind === "pending_record" || event.kind === "confirmed_action" ? <AppStatusBadge label={eventLabels[event.kind]} tone={event.kind === "pending_record" ? "warning" : "success"} />
          : <View accessible accessibilityLabel={`事件種類：${eventLabels[event.kind]}`} style={styles.metadataItem}><Text style={s.meta}>事件種類</Text><Text style={s.meta}>{eventLabels[event.kind]}</Text></View>}
        <View accessible accessibilityLabel={`事件時間：${eventTime}`} style={styles.metadataItem}><Text style={s.meta}>事件時間</Text><Text style={s.meta}>{eventTime}</Text></View>
      </View>
      {event.recordId && onRecord ? <OwnedRouteTextLink href={{ pathname: "/care", params: { record: event.recordId } }} label="查看原始記錄" onOpen={() => onRecord(event.recordId)} /> : null}
      {event.kind === "pending_record" && onRecord ? <OwnedRouteTextLink href="/care" label="前往待核對記錄" onOpen={() => onRecord()} /> : null}
      {event.taskId ? <OwnedRouteTextLink href={{ pathname: "/tasks", params: { taskId: event.taskId } }} label="查看已連結跟進" onOpen={() => onTask(event.taskId!)} /> : null}
    </View>;})}</View>
    {!concern.historyComplete ? <Text style={s.meta}>只列已取得的事件；較早經過仍未完整載入。</Text> : null}
    {concern.measurement?.points.length ? <View style={s.divider}><SectionHeader density="compact" level={3} title={concern.measurement.label} subtitle="只列來源提供的量測原值，不推算百分位或異常。" />{concern.measurement.points.map(point => <View key={point.id} style={s.confirmedRow}><Text style={s.body}>{point.value} {point.unit}</Text><Text style={s.meta}>{growthTime(point.at)}</Text>{onRecord ? <OwnedRouteTextLink href={{ pathname: "/care", params: { record: point.sourceRecordId } }} label="核對量測來源" onOpen={() => onRecord(point.sourceRecordId)} /> : null}</View>)}</View> : null}
  </View>;
}

const styles = StyleSheet.create({
  metadataItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minWidth: 0, maxWidth: "100%", flexShrink: 1 },
});
