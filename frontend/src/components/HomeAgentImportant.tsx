import { AppStatusBadge } from "./AppStatusBadge";
import { useId, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { HomeActions, HomeViewModel } from "../view-model";
import { selectHomeAgentImportant, type HomeAgentImportantItem } from "../home-overview";
import { chineseFont, colors, radius, readingType, spacing, workspaceType } from "../theme";
import { AppButton, SectionHeader, TextLink } from "./ui";
import { AppIcon } from "./AppIcon";
import { OperationNotice } from "./OperationNotice";
import { ReadStateNotice } from "./ReadStateNotice";

function timeLabel(value: string | null): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

function ImportantLead({ item, actions, synthetic, loadedAt }: { item: HomeAgentImportantItem; actions: HomeActions; synthetic?: boolean; loadedAt: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const sourceId = `home-agent-reason-${useId()}`;
  const createdAt = timeLabel(item.source.createdAt);
  return <View testID={`home-agent-important-item-${item.id}`} style={styles.item}>
    <Text accessibilityRole="header" style={styles.title}>{item.title}</Text>
    <Text style={styles.body}>{item.whyNow ?? item.detail}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="為甚麼提醒我？" accessibilityState={{ expanded }} aria-expanded={expanded} aria-controls={sourceId}
      onPress={() => setExpanded(value => !value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [styles.sourceToggle, focused && styles.sourceToggleFocused, pressed && styles.pressed]}>
      <Text style={[styles.sourceToggleLabel, hovered && styles.sourceToggleHovered]}>為甚麼提醒我？</Text><AppIcon name={expanded ? "chevron-up" : "chevron-down"} size={16} />
    </Pressable>
    <View nativeID={sourceId} style={[styles.source, !expanded && styles.hiddenSource]} aria-hidden={!expanded}
      accessibilityElementsHidden={!expanded} importantForAccessibility={expanded ? "auto" : "no-hide-descendants"}>
      {item.whyNow && item.whyNow !== item.detail ? <Text style={styles.detail}>{item.detail}</Text> : null}
      {item.sourceLabel ? <Text style={styles.meta}>來源：{item.sourceLabel}</Text> : null}
      {createdAt || loadedAt ? <Text style={styles.meta}>{[
        createdAt ? `建立於 ${createdAt}` : null,
        loadedAt ? `${synthetic ? "示例" : "讀取於"} ${loadedAt}` : null,
      ].filter(Boolean).join(" · ")}</Text> : null}
    </View>
    <View style={styles.action}><AppButton label={item.action.label} density="compact" variant="accent" onPress={() => actions.open(item.action.destination)} /></View>
  </View>;
}

// The owning adapter supplies authorized Agent items and their order. This view only navigates.
export function HomeAgentImportant({ model, actions }: { model: HomeViewModel; actions: HomeActions }) {
  const section = selectHomeAgentImportant(model);
  if (!section) return null;
  const operation = model.operation;
  const loadedAt = timeLabel(section.loadedAt);
  const lead = section.state === "ready" ? section.items[0] : undefined;
  const remaining = section.state === "ready" ? section.items.slice(1, 3) : [];
  return <View style={styles.stack}>
    <View testID="home-agent-important" style={styles.important}>
      <View style={styles.heading}><AppIcon name="star-four-points" size={18} /><Text style={styles.eyebrow}>助手提醒你</Text>
        {lead ? <AppStatusBadge label={lead.source.status === "unknown" ? "結果未知" : lead.statusLabel} tone={lead.source.status === "unknown" || lead.proposal?.status === "pending" ? "warning" : lead.proposal?.status === "accepted" ? "success" : "info"} /> : null}
        {lead && section.synthetic ? <Text style={styles.meta}>合成示例</Text> : null}
      </View>
      <ReadStateNotice state={section.state === "ready" ? section.items.length ? "ready" : "empty" : section.state}
        message={section.state === "unavailable" ? "暫時無法顯示助手提醒" : section.state === "loading" ? "正在讀取助手提醒…"
          : section.state === "error" ? "暫時無法讀取助手提醒" : section.items.length ? undefined : "目前沒有助手提醒"}>
        {section.state === "error" ? <AppButton label="重新讀取" density="compact" variant="quiet" disabled={model.connection !== "online"} onPress={actions.refresh} /> : null}
        {section.state === "unavailable" ? <TextLink label="前往助手" onPress={() => actions.open("chat")} /> : null}
      </ReadStateNotice>
      {lead ? <ImportantLead key={lead.id} item={lead} actions={actions} synthetic={section.synthetic} loadedAt={loadedAt} /> : null}
      {model.connection !== "online" && lead ? <Text style={styles.meta}>目前離線，顯示較早的提醒</Text> : null}
    </View>
    {remaining.map(item => <Pressable key={item.id} testID={`home-agent-important-item-${item.id}`} accessibilityRole="button"
      accessibilityLabel={`${item.title}，${item.action.label}`} accessibilityHint={[item.detail, item.sourceLabel].filter(Boolean).join("；")}
      onPress={() => actions.open(item.action.destination)} style={({ pressed }) => [styles.additional, pressed && styles.pressed]}>
      <View style={styles.additionalCopy}><Text style={styles.rowTitle}>{item.title}</Text><AppStatusBadge label={item.source.status === "unknown" ? "結果未知" : item.statusLabel} tone={item.source.status === "unknown" || item.proposal?.status === "pending" ? "warning" : item.proposal?.status === "accepted" ? "success" : "info"} /><Text style={styles.meta}>{item.whyNow ?? item.detail}</Text>
        {item.sourceLabel ? <Text style={styles.meta}>依據：{item.sourceLabel}</Text> : null}</View><AppIcon name="chevron-right" size={18} />
    </Pressable>)}
    {section.state === "ready" && section.items.length > 3 ? <TextLink label={`另有 ${section.items.length - 3} 項，開啟助手查看`} onPress={() => actions.open("chat")} /> : null}
    {operation.state !== "none" ? <View testID="home-operation-recovery" style={styles.recovery}>
      <SectionHeader title="你的操作狀態" density="compact" />
      <OperationNotice state={operation.state} title={operation.title} message={operation.detail}>
        {operation.state !== "saving" ? <AppButton label={operation.state === "unknown" ? "查核這次結果" : "查看原操作"} density="compact" variant="secondary" onPress={actions.reviewOperation} /> : null}
      </OperationNotice>
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({
  stack: { gap: spacing.sm }, important: { backgroundColor: colors.paper, borderLeftWidth: 4, borderLeftColor: colors.accent, borderBottomWidth: 1, borderBottomColor: colors.softLine, borderTopRightRadius: radius.small, borderBottomRightRadius: radius.small, padding: spacing.lg, gap: spacing.sm },
  heading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  eyebrow: { fontFamily: chineseFont, color: colors.ink, ...readingType.meta, fontWeight: "700" },
  item: { gap: spacing.sm }, 
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: 18, lineHeight: 26, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool }, detail: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  sourceToggle: { backgroundColor: "transparent", borderWidth: 1, borderColor: "transparent", borderRadius: radius.small, paddingHorizontal: spacing.xs, marginLeft: -spacing.xs, flexDirection: "row", alignItems: "center", alignSelf: "flex-start", maxWidth: "100%", minHeight: 48, gap: spacing.xs },
  sourceToggleLabel: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool, flexShrink: 1 },
  sourceToggleFocused: { borderColor: colors.ink }, sourceToggleHovered: { textDecorationLine: "underline" },
  source: { gap: spacing.xs, paddingBottom: spacing.xs }, hiddenSource: { display: "none" }, action: { alignSelf: "flex-start", maxWidth: "100%" },
  additional: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.softLine },
  additionalCopy: { flex: 1, minWidth: 0, gap: spacing.xs }, rowTitle: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.row, fontWeight: "700" },
  pressed: { backgroundColor: colors.pressedOverlay }, recovery: { gap: spacing.sm },
});
