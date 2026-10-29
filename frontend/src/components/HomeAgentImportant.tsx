import { RouteTextLink } from "./RouteTextLink";
import { homeTargetHref } from "../home-target";
import { AppStatusBadge } from "./AppStatusBadge";
import { useId, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { HomeActions, HomeViewModel } from "../view-model";
import { homeAgentScope } from "../home-agent-entry";
import { selectHomeAgentImportant, type HomeAgentImportantItem } from "../home-overview";
import { chineseFont, colors, radius, readingType, spacing } from "../theme";
import { AppButton } from "./ui";
import { AppIcon } from "./AppIcon";
import { OperationNotice } from "./OperationNotice";
import { ReadStateNotice } from "./ReadStateNotice";

function timeLabel(value: string | null): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}
function importantStatusLabel(item: HomeAgentImportantItem) { return item.source.status === "unknown" ? "結果未知" : item.statusLabel; }
function ImportantStatus({ item }: { item: HomeAgentImportantItem }) {
  return <AppStatusBadge label={importantStatusLabel(item)}
    tone={item.source.status === "unknown" || item.proposal?.status === "pending" ? "warning" : item.proposal?.status === "accepted" ? "success" : "info"} />;
}
function ImportantLead({ item, scopeKey, synthetic, loadedAt }: { item: HomeAgentImportantItem; scopeKey: string | null; synthetic?: boolean; loadedAt: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const sourceId = `home-agent-reason-${useId()}`;
  const createdAt = timeLabel(item.source.createdAt);
  return <View testID={`home-agent-important-item-${item.id}`} style={styles.lead}>
    <View style={styles.leadCopy}>
      <ImportantStatus item={item} />
      <Text accessibilityRole="header" {...(Platform.OS === "web" ? { "aria-level": 3 } : {})} style={styles.title}>{item.title}</Text>
      <Text style={styles.body}>{item.whyNow ?? item.detail}</Text>
    </View>
    <View style={styles.leadActions}>
      <View style={styles.action}><RouteTextLink href={homeTargetHref(item.action.target)} scopeKey={scopeKey} label={item.action.label} /></View>
      <Pressable accessibilityRole="button" accessibilityLabel="為甚麼提醒我？" accessibilityState={{ expanded }} aria-expanded={expanded} aria-controls={sourceId}
        onPress={() => setExpanded(value => !value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
        style={({ pressed }) => [styles.sourceToggle, focused && styles.sourceToggleFocused, pressed && styles.pressed]}>
        <Text style={[styles.sourceToggleLabel, hovered && styles.sourceToggleHovered]}>為甚麼提醒我？</Text><AppIcon name={expanded ? "chevron-up" : "chevron-down"} size={18} importantForAccessibility="no" />
      </Pressable>
    </View>
    <View nativeID={sourceId} style={[styles.source, !expanded && styles.hiddenSource]} aria-hidden={!expanded}
      accessibilityElementsHidden={!expanded} importantForAccessibility={expanded ? "auto" : "no-hide-descendants"}>
      {item.whyNow && item.whyNow !== item.detail ? <Text style={styles.body}>{item.detail}</Text> : null}
      {item.sourceLabel ? <Text style={styles.meta}>來源：{item.sourceLabel}</Text> : null}
      {createdAt || loadedAt ? <Text style={styles.meta}>{[
        createdAt ? `建立於 ${createdAt}` : null,
        loadedAt ? `${synthetic ? "示例" : "讀取於"} ${loadedAt}` : null,
      ].filter(Boolean).join(" · ")}</Text> : null}
    </View>
  </View>;
}
function AdditionalReminder({ item, scopeKey }: { item: HomeAgentImportantItem; scopeKey: string | null }) {
  return <RouteTextLink testID={`home-agent-important-item-${item.id}`} href={homeTargetHref(item.action.target)} scopeKey={scopeKey}
    label={`${importantStatusLabel(item)}，${item.title}，${item.action.label}`} style={styles.additional}>
    <View style={styles.additionalCopy}>
      <ImportantStatus item={item} />
      <Text style={styles.rowTitle}>{item.title}</Text>
      <Text style={styles.body}>{item.whyNow ?? item.detail}</Text>
      {item.sourceLabel ? <Text style={styles.meta}>依據：{item.sourceLabel}</Text> : null}
      <Text style={styles.destination}>{item.action.label}</Text>
    </View><AppIcon name="chevron-right" size={20} importantForAccessibility="no" />
  </RouteTextLink>;
}

// The owning adapter supplies authorized Agent items and their order. This view only navigates.
export function HomeAgentImportant({ model, actions }: { model: HomeViewModel; actions: HomeActions }) {
  const section = selectHomeAgentImportant(model);
  const operation = model.operation;
  if (!section && operation.state === "none") return null;
  const loadedAt = timeLabel(section?.loadedAt ?? null);
  // A loading snapshot can retain explicitly supplied, same-scope items and disclosure state.
  const items = section?.state === "ready" || section?.state === "loading" ? section.items : [];
  const lead = items[0];
  const remaining = items.slice(1, 3);
  return <View style={styles.stack}>
    {operation.state !== "none" ? <View testID="home-operation-recovery" style={styles.recovery}>
      <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>你的操作狀態</Text>
      <OperationNotice state={operation.state} title={operation.title} message={operation.detail}>
        {operation.state !== "saving" ? <AppButton label={operation.state === "unknown" ? "查核這次結果" : "查看原操作"} variant="secondary" onPress={actions.reviewOperation} /> : null}
      </OperationNotice>
    </View> : null}
    {section && section.state !== "unsupported" ? <View testID="home-agent-important" style={styles.important}>
      <View style={styles.heading}>
        <View style={styles.headingCopy}><AppIcon name="star-four-points" color={colors.teal} size={20} importantForAccessibility="no" /><Text accessibilityRole="header" {...(Platform.OS === "web" ? { "aria-level": 2 } : {})} style={styles.sectionTitle}>先看重要事項</Text></View>
        {lead && section.synthetic ? <Text style={styles.meta}>合成示例</Text> : null}
      </View>
      <ReadStateNotice state={section.state === "ready" ? section.items.length ? "ready" : "empty" : section.state} refreshing={section.state === "loading" && !!lead}
        message={section.detail ?? (section.state === "unavailable" ? "暫時無法顯示助手提醒" : section.state === "loading" ? "正在讀取助手提醒…"
          : section.state === "error" ? "暫時無法讀取助手提醒" : section.items.length ? undefined : "目前沒有助手提醒")}>
        {section.state === "error" ? <AppButton label="重新讀取提醒" variant="quiet" disabled={model.connection !== "online"} onPress={actions.refresh} /> : null}
        {section.state === "unavailable" ? <RouteTextLink href="/chat" scopeKey={model.scopeKey ?? null} label="前往助手" /> : null}
      </ReadStateNotice>
      {lead ? <ImportantLead key={JSON.stringify([homeAgentScope(model), lead.id])} item={lead} scopeKey={model.scopeKey ?? null} synthetic={section.synthetic} loadedAt={loadedAt} /> : null}
      {remaining.map(item => <AdditionalReminder key={item.id} item={item} scopeKey={model.scopeKey ?? null} />)}
      {section.state === "ready" && section.items.length > 3 ? <View style={styles.more}><RouteTextLink href="/chat" scopeKey={model.scopeKey ?? null} label={`另有 ${section.items.length - 3} 項，開啟助手查看`} /></View> : null}
      {model.connection !== "online" && lead ? <Text style={styles.meta}>目前未連線，顯示較早的提醒</Text> : null}
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({
  stack: { gap: spacing.lg }, important: { backgroundColor: colors.white, borderLeftWidth: 3, borderLeftColor: colors.teal, padding: spacing.lg, gap: spacing.lg },
  heading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  headingCopy: { minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sectionTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 18, lineHeight: 28, fontWeight: "700", flexShrink: 1 },
  lead: { minWidth: 0, gap: spacing.lg }, leadCopy: { gap: spacing.sm },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: 18, lineHeight: 28, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.body },
  meta: { fontFamily: chineseFont, color: colors.muted, fontSize: 14, lineHeight: 22 },
  leadActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  sourceToggle: { backgroundColor: "transparent", borderWidth: 1, borderColor: "transparent", borderRadius: radius.small, paddingHorizontal: spacing.sm, flexDirection: "row", alignItems: "center", alignSelf: "flex-start", maxWidth: "100%", minHeight: 48, gap: spacing.xs },
  sourceToggleLabel: { fontFamily: chineseFont, color: colors.teal, ...readingType.body, flexShrink: 1 },
  sourceToggleFocused: { borderColor: colors.teal }, sourceToggleHovered: { textDecorationLine: "underline" },
  source: { gap: spacing.sm, padding: spacing.md, backgroundColor: colors.neutralSurface }, hiddenSource: { display: "none" }, action: { alignSelf: "flex-start", maxWidth: "100%" },
  additional: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.sm, borderTopWidth: 1, borderTopColor: colors.softLine },
  additionalCopy: { flex: 1, minWidth: 0, gap: spacing.sm }, rowTitle: { fontFamily: chineseFont, color: colors.ink, ...readingType.body, fontWeight: "700" },
  destination: { fontFamily: chineseFont, color: colors.teal, ...readingType.body, fontWeight: "600" },
  pressed: { backgroundColor: colors.pressedOverlay }, recovery: { gap: spacing.sm }, more: { alignItems: "flex-start" },
});
