import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View, type PressableStateCallbackType } from "react-native";
import { ActivityIndicator, Text } from "react-native-paper";
import type { ChatMessageView, ChatReplyPhase } from "../../chat-view-model";
import { colors, spacing } from "../../theme";
import { AppIcon } from "../AppIcon";
import { AppButton } from "../ui";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { AnswerSources, CitationText, type LocateAnswerSource } from "./AnswerSources";
import { chatColors, chatFont, chatLayout, chatType } from "./chat-presentation";
import { MotionDisclosure } from "../../motion";
import { useMotionPreferences } from "../../motion/preferences";
import { CHAT_ACTIVITY_LABELS, CHAT_MESSAGE_COPY, CHAT_PHASE_LABELS } from "./chat-copy";

const phaseLabels = CHAT_PHASE_LABELS;
const activityLabels = CHAT_ACTIVITY_LABELS;

export function ChatProgressIndicator() {
  const motion = useMotionPreferences();
  return <View accessible={false} aria-hidden style={styles.progressIndicator}>
    {motion.enabled ? <ActivityIndicator size={14} color={chatColors.secondary} />
      : <View testID="chat-progress-static" style={styles.progressStatic} />}
  </View>;
}

export function ChatMessage({ message, children, header, footer, testID, embedded = false, onStop, onCheck, onLocateSource, onOpenSource, degraded, phaseLabel }: {
  message: ChatMessageView; children?: ReactNode; header?: ReactNode; footer?: ReactNode; testID?: string; embedded?: boolean;
  onStop?: () => void; onCheck?: () => void; onLocateSource?: LocateAnswerSource; onOpenSource?: (id: string) => void; degraded?: boolean; phaseLabel?: string;
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
        message={phaseLabel ?? phaseLabels[message.phase ?? "complete"]} urgent={message.phase === "failed"} /> : null}
      {assistant && message.phase && (message.phase !== "complete" || activities.length > 0) ? <View testID="chat-message-phase" style={styles.statusRow}>
        {active ? <ChatProgressIndicator /> : null}
        <Text style={[styles.status, attention && styles.warning, message.phase === "failed" && styles.error]}>{phaseLabel ?? phaseLabels[message.phase]}</Text>
        {active && onStop ? <AppButton label={CHAT_MESSAGE_COPY.stopReply} variant="quiet" density="compact" onPress={onStop} /> : null}
        {attention && onCheck ? <AppButton label={CHAT_MESSAGE_COPY.checkOriginal} variant="quiet" density="compact" onPress={onCheck} /> : null}
      </View> : null}
      {assistant && activities.length ? <View style={styles.process}>
        <Pressable testID="chat-process-toggle" accessibilityRole="button" accessibilityLabel={CHAT_MESSAGE_COPY.processToggle}
          accessibilityState={{ expanded: processOpen }} aria-expanded={processOpen} onPress={() => setProcessOpen(value => !value)}
          style={({ pressed, hovered, focused }: PressableStateCallbackType & { hovered?: boolean; focused?: boolean }) => [styles.processToggle, (pressed || hovered) && styles.pressed, focused && styles.focused]}>
          <Text style={styles.processLabel}>{CHAT_MESSAGE_COPY.processToggle} · {activities.length} 項{activities.some(item => item.state === "failed" || item.state === "unknown") ? CHAT_MESSAGE_COPY.processPendingNote : ""}</Text>
          <AppIcon name={processOpen ? "chevron-up" : "chevron-down"} size={16} color={chatColors.secondary} />
        </Pressable>
        <MotionDisclosure expanded={processOpen} scopeKey={message.id}><View testID="chat-process-details" style={styles.processDetails}>{activities.map((activity, index) => <View key={activity.id} style={[styles.activity, index > 0 && styles.divider]}>
          <View style={styles.statusRow}><Text style={styles.activityTitle}>{activity.label}</Text><Text style={activity.state === "failed" ? [styles.warning, styles.error] : activity.state === "unknown" ? styles.warning : styles.meta}>{activityLabels[activity.state]}</Text></View>
          {activity.summary ? <Text style={styles.meta}>{activity.summary}</Text> : null}
        </View>)}</View></MotionDisclosure>
      </View> : null}
      {header}
      {assistant && message.sources !== undefined ? <AnswerSources sources={message.sources} onLocateSource={onLocateSource} onOpenSource={onOpenSource} degraded={degraded}>{body}</AnswerSources> : body}
      {message.note ? <Text style={[styles.meta, !assistant && styles.userNote]}>{message.note}</Text> : null}
    </View>
    {footer ? <View testID="chat-message-actions" style={[styles.messageActions, !assistant && styles.userActions]}>{footer}</View> : null}
  </View>;
}

const styles = StyleSheet.create({
  row: { width: "100%", minWidth: 0, gap: 4 }, userRow: { alignItems: "flex-end" },
  content: { minWidth: 0, gap: chatLayout.paragraphGap }, assistant: { width: "100%" },
  user: { maxWidth: "82%", backgroundColor: chatColors.userBubble, borderRadius: 20, paddingVertical: 12, paddingHorizontal: 16 }, embedded: { padding: 0, borderWidth: 0, borderRadius: 0, backgroundColor: "transparent" },
  body: { fontFamily: chatFont, color: chatColors.ink, ...chatType.body, minWidth: 0, flexShrink: 1 },
  meta: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.meta, minWidth: 0, flexShrink: 1 }, userNote: { textAlign: "right" },
  statusRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm, minWidth: 0 },
  status: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.tool, flexShrink: 1 },
  progressIndicator: { width: 16, height: 20, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  progressStatic: { width: 8, height: 8, borderRadius: 4, backgroundColor: chatColors.secondary },
  messageActions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4, minWidth: 0 }, userActions: { justifyContent: "flex-end" },
  warning: { fontFamily: chatFont, color: colors.warningInk, ...chatType.tool, flexShrink: 1 },
  error: { color: colors.errorInk },
  process: { minWidth: 0 }, processToggle: { backgroundColor: "transparent", borderRadius: 10, paddingHorizontal: spacing.sm, alignSelf: "flex-start", minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm, minWidth: 0 },
  processLabel: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.tool, minWidth: 0, flexShrink: 1 },
  processDetails: { gap: spacing.sm, paddingBottom: spacing.sm }, activity: { gap: spacing.xs, minWidth: 0 },
  divider: { paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: chatColors.line },
  activityTitle: { fontFamily: chatFont, color: chatColors.ink, ...chatType.tool, fontWeight: "600", flexShrink: 1 }, pressed: { backgroundColor: chatColors.hover },
  focused: { outlineColor: chatColors.focus, outlineWidth: 2, outlineStyle: "solid" },
});
