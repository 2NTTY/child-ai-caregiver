import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { MemoryReadProjection } from "../../memory-reference-view-model";
import { memoryDateLabel } from "../../memory-reference-view-model";
import type { HistoryMessageRead } from "../../history-view-model";
import { chineseFont, colors, radius, readingType, spacing } from "../../theme";
import { ReadStateNotice } from "../ReadStateNotice";
import { AppButton } from "../ui";

export function HistoryMessageDetail({ read, busy, online, onMore, onClose, onPrepareQuestion, embedded = false }: {
  embedded?: boolean; read: MemoryReadProjection<HistoryMessageRead>; busy?: boolean; online: boolean;
  onMore?: () => void; onClose?: () => void; onPrepareQuestion?: (message: HistoryMessageRead) => void;
}) {
  if (read.state === "unavailable") return null;
  const message = read.data;
  return <View style={embedded ? styles.content : styles.detail} testID="history-message-detail">
    {!embedded ? <View style={styles.row}><Text accessibilityRole="header" aria-level={2} style={styles.title}>訊息原文</Text>
      {onClose ? <AppButton label="關閉原文" variant="quiet" density="compact" onPress={onClose} /> : null}</View> : null}
    {read.state === "loading" ? <ReadStateNotice state="loading" title="正在讀取原文…" />
      : read.state === "error" ? <ReadStateNotice state="error" title="暫時讀不到原文" message="請從原訊息重新讀取。" />
      : message ? <>
        {read.state === "stale" ? <ReadStateNotice state="stale" title="最新一段未能讀取" message="目前保留已讀部分，可連線後繼續。" /> : null}
        <Text style={styles.meta}>{message.role === "user" ? "你的訊息" : "助手回覆"} · {memoryDateLabel(message.createdAt)}</Text>
        <Text selectable style={styles.body}>{message.text}</Text>
        <Text style={styles.meta}>{message.nextOffset === null ? "這則原文已完整讀取" : `已讀取 ${message.text.length}／${message.totalCharacters} 字，仍有原文未讀取`}</Text>
        <View style={styles.row}>
          {message.nextOffset !== null && onMore ? <AppButton label={busy ? "正在續讀…" : "繼續讀取原文"} variant="secondary" density="compact" disabled={!online || busy} onPress={onMore} /> : null}
          {onPrepareQuestion ? <AppButton label="帶回助手" variant="quiet" density="compact" disabled={busy} onPress={() => onPrepareQuestion(message)} /> : null}
        </View>
      </> : null}
  </View>;
}
const styles = StyleSheet.create({
  content: { gap: spacing.md, minWidth: 0 },
  detail: { padding: spacing.lg, borderWidth: 1, borderColor: colors.line, borderRadius: radius.medium, backgroundColor: colors.paper, gap: spacing.md, minWidth: 0 },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  title: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700", flexGrow: 1 },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.body },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
});
