import { EmptyListCard } from "../EmptyListCard";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { agentTime, type AgentInboxActions, type AgentInboxModel } from "../../agent-view-model";
import { chineseFont, colors, radius, readingType, spacing, workspaceType } from "../../theme";
import { AppIcon } from "../AppIcon";
import { AppButton, SectionCard, SectionHeader } from "../ui";
import { StatusAnnouncement } from "../StatusAnnouncement";

function timeLabel(value: string): string {
  return Number.isFinite(Date.parse(value)) ? `${agentTime(value)}` : "時間資料無效，請重新讀取";
}

export function AgentInboxView({ model, actions }: { model: AgentInboxModel; actions: AgentInboxActions }) {
  const loading = model.state === "loading";
  const denied = model.state === "denied";
  const ready = model.state === "ready";
  const entries = ready ? model.entries.slice(0, 20) : [];
  const readMessage = model.state === "idle" ? "尚未讀取私人背景結果。請按下方按鈕手動讀取。"
    : loading ? "正在讀取私人背景結果，請稍候。"
      : model.state === "failed" ? "未能讀取私人背景結果。恢復連線後可手動重新讀取。"
        : denied ? "已失去讀取私人背景結果的權限，原清單已隱藏。" : null;
  const announcementKey = readMessage ? `read:${model.state}` : !model.online ? "offline" : model.locked ? "locked" : "ready";
  const announcementMessage = readMessage
    ?? (!model.online ? "目前離線，恢復連線後才可讀取私人背景結果。"
      : model.locked ? "目前有原操作待查核，暫時不能切換或收起私人背景結果。"
        : "私人背景結果已讀取，請開啟個別結果核對內容、候選及來源。");
  return <View testID="agent-inbox-view" style={styles.root}>
    <StatusAnnouncement eventKey={announcementKey} message={announcementMessage} urgent={model.state === "failed"} />
    <SectionCard style={styles.card}>
    <SectionHeader title="私人背景結果" icon="lock-outline" subtitle="由你手動讀取，最多展示 20 項；內容只供本人查看。" />
    <Text style={styles.meta}>這份清單展示已保存的背景運行結果。請開啟個別結果核對內容、候選及來源。</Text>
    <AppButton label="讀取私人背景結果" variant="secondary" disabled={!model.online || model.locked || loading || denied}
      loading={loading} onPress={actions.refresh} style={styles.button} />
    {readMessage ? <View style={[styles.note, model.state === "failed" && styles.errorNote, denied && styles.warningNote]}>
      <AppIcon name="information-outline" size={18} color={model.state === "failed" ? colors.errorInk : denied ? colors.warningInk : colors.muted} />
      <Text style={[styles.noteCopy, model.state === "failed" && styles.error, denied && styles.warning]}>{readMessage}</Text>
    </View> : null}
    {!model.online ? <View style={[styles.note, styles.warningNote]}>
      <AppIcon name="information-outline" size={18} color={colors.warningInk} />
      <Text style={[styles.noteCopy, styles.warning]}>目前離線，恢復連線後才可讀取私人背景結果；所示清單只是上次讀取的快照。</Text>
    </View> : null}
    {model.locked && !denied ? <Text style={styles.warning}>目前有原操作待查核，暫時不能切換或收起私人背景結果。</Text> : null}
    {ready ? <>
      <Text style={styles.meta}>清單讀取時間：{model.loadedAt ? timeLabel(model.loadedAt) : "未知"}</Text>
      {entries.length === 0 ? model.online ? <EmptyListCard title="目前沒有私人背景結果" /> : null : entries.map(entry => {
        const selected = entry.runId === model.selectedRunId;
        return <View key={entry.runId} accessibilityState={{ selected }} aria-selected={selected}
          style={[styles.entry, selected && styles.selectedEntry]}>
          <Text accessibilityRole="header" aria-level={2} style={styles.title}>{entry.label}</Text>
          <Text style={styles.meta}>運行建立：{timeLabel(entry.createdAt)}</Text>
          {selected ? <View style={styles.selectedLabel}><AppIcon name="eye" size={18} color={colors.teal} /><Text style={styles.meta}>目前展示此結果</Text></View> : null}
          <AppButton label={`查看私人背景結果：${entry.label}`} variant="quiet"
            disabled={model.locked || !model.online || loading} onPress={() => actions.select(entry.runId)} style={styles.button} />
        </View>;
      })}
      {model.selectedRunId ? <AppButton expanded label="收起私人背景結果" variant="quiet" disabled={model.locked}
        onPress={actions.collapse} style={styles.button} /> : null}
    </> : null}
  </SectionCard></View>;
}

const styles = StyleSheet.create({
  root: { minWidth: 0, width: "100%" }, card: { gap: spacing.md, minWidth: 0 },
  entry: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.medium, padding: spacing.md, gap: spacing.sm, minWidth: 0 },
  selectedEntry: { borderColor: colors.teal },
  title: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section, flexShrink: 1, minWidth: 0 },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, flexShrink: 1, minWidth: 0 },
  selectedLabel: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  note: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, backgroundColor: colors.quietSurface, borderRadius: radius.small, padding: spacing.md, minWidth: 0 },
  noteCopy: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool, flex: 1, minWidth: 0 },
  warningNote: { backgroundColor: colors.paleAmber, borderLeftWidth: 3, borderLeftColor: colors.amber },
  errorNote: { backgroundColor: colors.paleCoral, borderLeftWidth: 3, borderLeftColor: colors.coral },
  warning: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.tool },
  error: { color: colors.errorInk }, button: { alignSelf: "stretch", maxWidth: "100%", minWidth: 0 },
});
