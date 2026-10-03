import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { ActivityIndicator, Text } from "react-native-paper";
import type { ChatMessageView, ChatReplyPhase } from "../../chat-view-model";
import { chineseFont, colors, radius, readingType, spacing, typeScale } from "../../theme";
import { AppIcon } from "../AppIcon";
import { AppButton } from "../ui";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { AnswerSources, CitationText, type LocateAnswerSource } from "./AnswerSources";

const phaseLabels: Record<ChatReplyPhase, string> = {
  thinking: "思考中", streaming: "正在回覆", complete: "回覆已結束", stopped: "已停止 · 回覆未完成",
  failed: "回覆失敗", unknown: "結果未知 · 待查核", awaiting_confirmation: "等候你的確認",
};
const activityLabels = { running: "處理中", succeeded: "已回報", failed: "失敗", unknown: "未知", pending: "待確認" } as const;

export function ChatMessage({ message, children, footer, testID, embedded = false, onStop, onCheck, onLocateSource, onOpenSource, degraded }: {
  message: ChatMessageView; children?: ReactNode; footer?: ReactNode; testID?: string; embedded?: boolean;
  onStop?: () => void; onCheck?: () => void; onLocateSource?: LocateAnswerSource; onOpenSource?: (id: string) => void; degraded?: boolean;
}) {
  const [processOpen, setProcessOpen] = useState(false);
  const assistant = message.role === "assistant", active = message.phase === "thinking" || message.phase === "streaming";
  const attention = message.phase === "failed" || message.phase === "unknown";
  const activities = message.activities ?? [];
  const body = children ?? (message.text ? message.sources !== undefined
    ? <CitationText style={styles.body}>{message.text}</CitationText>
    : <Text selectable style={styles.body}>{message.text}</Text> : null);
  return <View testID={testID ?? "chat-message"} nativeID={`chat-message-${message.id}`} style={[styles.row, !assistant && styles.userRow]}>
    <View style={[styles.content, assistant ? styles.assistant : styles.user, embedded && styles.embedded]}>
      {assistant ? <StatusAnnouncement eventKey={`${message.id}:${message.phase ?? "complete"}`}
        message={phaseLabels[message.phase ?? "complete"]} urgent={message.phase === "failed"} /> : null}
      {assistant && message.phase && (message.phase !== "complete" || activities.length > 0) ? <View testID="chat-message-phase" style={styles.statusRow}>
        {active ? <ActivityIndicator size={14} color={colors.deepTeal} /> : null}
        <Text style={[styles.status, attention && styles.warning, message.phase === "failed" && styles.error]}>{phaseLabels[message.phase]}</Text>
        {active && onStop ? <AppButton label="停止回覆" variant="quiet" onPress={onStop} /> : null}
        {attention && onCheck ? <AppButton label="查核原回覆" variant="quiet" onPress={onCheck} /> : null}
      </View> : null}
      {assistant && activities.length ? <View style={styles.process}>
        <Pressable testID="chat-process-toggle" accessibilityRole="button" accessibilityLabel="執行過程"
          accessibilityState={{ expanded: processOpen }} aria-expanded={processOpen} onPress={() => setProcessOpen(value => !value)}
          style={({ pressed }) => [styles.processToggle, pressed && styles.pressed]}>
          <Text style={styles.meta}>執行過程 · {activities.length} 項{activities.some(item => item.state === "failed" || item.state === "unknown") ? " · 有結果待核對" : ""}</Text>
          <AppIcon name={processOpen ? "chevron-up" : "chevron-down"} size={16} />
        </Pressable>
        {processOpen ? <View testID="chat-process-details" style={styles.processDetails}>{activities.map((activity, index) => <View key={activity.id} style={[styles.activity, index > 0 && styles.divider]}>
          <View style={styles.statusRow}><Text style={styles.activityTitle}>{activity.label}</Text><Text style={activity.state === "failed" ? [styles.warning, styles.error] : activity.state === "unknown" ? styles.warning : styles.meta}>{activityLabels[activity.state]}</Text></View>
          {activity.summary ? <Text style={styles.meta}>{activity.summary}</Text> : null}
        </View>)}</View> : null}
      </View> : null}
      {assistant && message.sources !== undefined ? <AnswerSources sources={message.sources} onLocateSource={onLocateSource} onOpenSource={onOpenSource} degraded={degraded}>{body}</AnswerSources> : body}
      {message.note ? <Text style={[styles.meta, !assistant && styles.userNote]}>{message.note}</Text> : null}
      {footer}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  row: { width: "100%", minWidth: 0, flexDirection: "row" }, userRow: { justifyContent: "flex-end" },
  content: { minWidth: 0, gap: spacing.md }, assistant: { flex: 1, paddingVertical: spacing.md },
  user: { maxWidth: "82%", backgroundColor: colors.paleTeal, borderRadius: radius.medium, padding: spacing.md }, embedded: { padding: 0, borderWidth: 0, borderRadius: 0, backgroundColor: "transparent" },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.body, minWidth: 0, flexShrink: 1 },
  meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 21, minWidth: 0, flexShrink: 1 }, userNote: { textAlign: "right" },
  statusRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm, minWidth: 0 },
  status: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.caption, lineHeight: 21, fontWeight: "700", flexShrink: 1 },
  warning: { fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.caption, lineHeight: 21, flexShrink: 1 },
  error: { color: colors.errorInk },
  process: { minWidth: 0 }, processToggle: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm, minWidth: 0 },
  processDetails: { gap: spacing.sm, paddingBottom: spacing.sm }, activity: { gap: spacing.xs, minWidth: 0 },
  divider: { paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.softLine },
  activityTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.caption, lineHeight: 21, fontWeight: "700", flexShrink: 1 }, pressed: { opacity: 0.7 },
});
