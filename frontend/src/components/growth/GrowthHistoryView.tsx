import { useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Button, Text } from "react-native-paper";
import { growthArchivedConcerns, growthConcernAtCapacity, growthConcernCanRestore } from "../../growth-view-model";
import { useGrowthWorkspace } from "../../workspaces/GrowthWorkspace";
import { EmptyListCard } from "../EmptyListCard";
import { ReadStateNotice } from "../ReadStateNotice";
import { AppButton } from "../ui";
import { AppIcon } from "../AppIcon";
import { useInteractionDensity } from "../useInteractionDensity";
import { GrowthConcernTimeline } from "./GrowthConcernTimeline";
import { GrowthOperationRecovery } from "./GrowthOperationRecovery";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { growthStyles as s } from "./growth-styles";
import { chineseFont, colors, mobileLayout, radius, spacing } from "../../theme";

export function GrowthHistoryView({ searchText, dateRange, onRecord, onTask }: {
  searchText: string; dateRange: { from: string | null; to: string | null };
  onRecord?: (id?: string) => void; onTask: (id: string) => void;
}) {
  const workspace = useGrowthWorkspace();
  const [selection, setSelection] = useState<{ scopeKey: string; id: string } | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null), [hoveredId, setHoveredId] = useState<string | null>(null);
  const { width } = useWindowDimensions(), touch = useInteractionDensity();
  const touchTarget = width < mobileLayout.breakpoint || touch;
  if (!workspace) return <Text style={s.meta}>正在讀取關注歷史。</Text>;
  const { model, actions, scopeKey } = workspace;
  if (model.access === "lost") return <Text style={s.warning}>已無權查看這位孩子的關注歷史。</Text>;
  if (!model.page || model.page.concerns?.state !== "ready") return <View style={s.stack}><GrowthOperationRecovery model={model} actions={actions} includeRefresh /><Text style={s.meta}>{model.load === "loading" ? "正在讀取關注歷史。" : "暫未能讀取關注歷史。"}</Text></View>;
  const archived = growthArchivedConcerns(model, searchText, dateRange);
  const selected = selection?.scopeKey === scopeKey ? archived.find(item => item.id === selection.id) : null;
  const notice = model.operation === "saved" && model.notice.startsWith("已結束這條關注") ? "已結束關注。"
    : model.operation === "saved" && model.notice.startsWith("已恢復這條關注") ? "已恢復關注。" : model.notice;
  const restore = (concern: typeof archived[number]) => <Button mode="text" compact accessibilityLabel={`恢復關注：${concern.title}`} style={styles.restoreAction}
    contentStyle={[styles.restoreContent, touchTarget && styles.restoreTouchTarget]} labelStyle={styles.restoreLabel} textColor={colors.ink}
    icon={({ size, color }) => <AppIcon name="history" size={size} color={color} importantForAccessibility="no" />}
    disabled={model.locked || model.dirty || !growthConcernCanRestore(concern)}
    onPress={event => { event.stopPropagation(); actions.restoreConcern(concern.id, concern.version, model.page!.authorityVersion); }}>恢復</Button>;
  return <View style={s.stack} testID="growth-history">
    <StatusAnnouncement eventKey={`${model.operation}:${notice}`} message={notice} urgent={model.operation === "failed"} />
    {notice ? <Text style={model.operation === "unknown" || model.operation === "failed" || model.operation === "conflict" ? s.warning : s.body}>{notice}</Text> : null}
    <GrowthOperationRecovery model={model} actions={actions} includeRefresh />
    {!model.online ? <Text style={s.warning}>目前離線，內容可能未更新。</Text> : null}
    {model.load === "error" ? <Text style={s.warning}>未能更新關注歷史，請稍後重試。</Text> : null}
    {selected ? <View style={styles.concernCard} testID={`growth-history-detail-${selected.id}`}>
      <View style={styles.actions}>
        <AppButton label="返回關注歷史" variant="quiet" style={styles.action} onPress={() => setSelection(null)} />
        {model.page.canManage ? restore(selected) : null}
      </View>
      {model.page.canManage && !growthConcernCanRestore(selected) ? <Text style={s.meta}>{growthConcernAtCapacity(selected) ? "已達歷史容量限制" : "未取得原狀態，暫未能恢復。"}</Text> : null}
      <GrowthConcernTimeline concern={selected} page={model.page} onRecord={onRecord} onTask={onTask} />
    </View> : <>
      {!archived.length && model.online && model.load === "ready" ? <EmptyListCard testID="growth-history-empty" title={searchText || dateRange.from || dateRange.to ? "沒有符合篩選的關注" : "暫無已結束關注"} /> : null}
      {!archived.length && model.online && model.load === "loading" ? <ReadStateNotice state="loading" title="正在讀取關注歷史…" /> : null}
      {archived.map(concern => <View key={concern.id} style={styles.concernListCard} testID={`growth-history-${concern.id}`}>
        <View style={styles.concernRow}>
          <Pressable accessibilityRole="button" accessibilityLabel={`查看已結束關注：${concern.title}`} onPress={() => setSelection({ scopeKey, id: concern.id })}
            onFocus={() => setFocusedId(concern.id)} onBlur={() => setFocusedId(null)} onHoverIn={() => setHoveredId(concern.id)} onHoverOut={() => setHoveredId(null)}
            style={({ pressed }) => [styles.readAction, hoveredId === concern.id && styles.readHovered, focusedId === concern.id && styles.readFocused, pressed && styles.readPressed]}>
            <View style={styles.concernSummary}>
              <Text accessibilityRole="header" style={s.title}>{concern.title}</Text>
              <Text style={s.meta}>{concern.archivedAt && !Number.isNaN(Date.parse(concern.archivedAt)) ? `結束於 ${new Date(concern.archivedAt).toLocaleDateString("zh-HK", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "numeric", day: "numeric" })}` : "結束日期未提供"}</Text>
            </View>
            <AppIcon name="chevron-right" size={18} color={colors.muted} importantForAccessibility="no" />
          </Pressable>
          {model.page?.canManage ? restore(concern) : null}
        </View>
        {model.page?.canManage && !growthConcernCanRestore(concern) ? <Text style={[s.meta, styles.restoreUnavailable]}>{growthConcernAtCapacity(concern) ? "已達歷史容量限制" : "未取得原狀態，暫未能恢復。"}</Text> : null}
      </View>)}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  concernCard: { minWidth: 0, borderWidth: 1, borderColor: colors.line, borderRadius: radius.small, backgroundColor: colors.controlSurface, padding: spacing.lg, gap: spacing.md },
  concernListCard: { minWidth: 0, borderWidth: 1, borderColor: colors.line, borderRadius: radius.small, backgroundColor: colors.controlSurface },
  concernRow: { flexDirection: "row", alignItems: "center", minWidth: 0, paddingRight: spacing.xs },
  concernSummary: { flex: 1, minWidth: 0, gap: spacing.xs },
  readAction: { flex: 1, minWidth: 0, minHeight: 64, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.small, borderWidth: 2, borderColor: "transparent" },
  readHovered: { backgroundColor: colors.quietSurface },
  readFocused: { borderColor: colors.ink },
  readPressed: { backgroundColor: colors.paleTeal },
  actions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm, minWidth: 0 },
  action: { alignSelf: "center" },
  restoreAction: { alignSelf: "center", flexShrink: 0, borderWidth: 0, borderRadius: radius.small },
  restoreContent: { minHeight: 40 },
  restoreTouchTarget: { minHeight: mobileLayout.touchTarget },
  restoreLabel: { fontFamily: chineseFont, fontSize: 14 },
  restoreUnavailable: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
});
