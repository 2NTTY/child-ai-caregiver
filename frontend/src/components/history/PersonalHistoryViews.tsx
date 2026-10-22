import { BackgroundSurface } from "../appearance/BackgroundSurface";
import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { historyMessageQuestion, messageChannelLabel, visiblePersonalHistory, visiblePersonalMessages, type HistoryDateRange } from "../../history-view-model";
import { memoryDateLabel } from "../../memory-reference-view-model";
import { usePersonalHistoryWorkspace, type PersonalHistoryOwner } from "../../production/usePersonalHistory";
import { chineseFont, colors, readingType, spacing } from "../../theme";
import { EmptyListCard } from "../EmptyListCard";
import { ReadStateNotice } from "../ReadStateNotice";
import { AppButton } from "../ui";
import { VoiceMessage } from "../../production/VoiceMessage";
import { HistoryMessageDetail } from "./HistoryMessageDetail";

export function PersonalConversationHistoryView({ searchText, dateRange, onPrepareQuestion }: {
  searchText: string; dateRange: HistoryDateRange; onPrepareQuestion(question: string): void;
}) {
  const owner = usePersonalHistoryWorkspace(), current = useRef(owner); current.current = owner;
  const scope = owner?.scopeKey;
  useEffect(() => {
    if (!scope || !owner) return;
    const timer = setTimeout(() => {
      const latest = current.current;
      if (latest && latest.scopeKey === scope && latest.history.data?.query !== searchText) latest.actions.searchHistory(searchText);
    }, 300);
    return () => clearTimeout(timer);
  }, [scope, searchText, owner?.online]);
  if (!owner) return <ReadStateNotice state="unavailable" title="對話歷史暫未提供" />;
  const read = owner.history, matches = visiblePersonalHistory(read, dateRange);
  return <View style={styles.list}>
    <BackgroundSurface padded><Text style={styles.meta}>只查閱你與這位孩子的對話。每次最多掃 100 則，返回最多 10 個命中；日期篩選只包括已掃過的結果。</Text></BackgroundSurface>
    {read.state === "loading" ? <ReadStateNotice state="loading" title="正在搜尋對話…" />
      : read.state === "error" ? <ReadStateNotice state="error" title="暫時讀不到對話歷史"><AppButton label="重新搜尋" variant="secondary" disabled={!owner.online || owner.busy.history} onPress={() => owner.actions.searchHistory(searchText)} /></ReadStateNotice>
      : read.state === "unavailable" ? <ReadStateNotice state="unavailable" title={owner.online ? "正在準備對話搜尋…" : "連線後才可讀取對話歷史"} />
      : <>
        {read.state === "stale" || !owner.online ? <ReadStateNotice state="stale" title="最新歷史尚未核對" message="目前保留已載入結果。" /> : null}
        {read.data?.query !== searchText ? <BackgroundSurface padded><Text style={styles.meta}>正在套用新搜尋條件；以下是先前的結果。</Text></BackgroundSurface> : null}
        {matches.map(match => <BackgroundSurface padded key={match.id} style={styles.entry} testID={`history-message-${match.id}`}>
          <Text style={styles.meta}>{match.role === "user" ? "你的訊息" : "助手回覆"} · {memoryDateLabel(match.createdAt)}</Text>
          <Text selectable style={styles.body}>{match.excerpt}</Text><Text style={styles.meta}>搜尋摘要，原文尚未完整讀取</Text>
          <AppButton label="查看原文" variant="quiet" density="compact" disabled={!owner.online || owner.busy.message} onPress={() => owner.actions.readMessage(match.id)} />
        </BackgroundSurface>)}
        {!matches.length && read.state === "ready" && owner.online && owner.access !== "revoked" && read.data.query === searchText ? <EmptyListCard testID="conversation-history-empty" title={read.data.complete ? "沒有符合篩選的對話" : "已搜尋的範圍未有符合結果"}
          detail={read.data.complete ? "本次搜尋已完整掃過可讀歷史。" : "仍有歷史未搜尋，可繼續搜尋。"} /> : null}
        {read.data ? <BackgroundSurface padded><Text style={styles.meta}>已掃 {read.data.scanned} 則 · {read.data.complete ? "本次搜尋已完整掃過可讀歷史" : "搜尋尚未完整，仍有歷史未掃過"}</Text></BackgroundSurface> : null}
        {read.data?.nextCursor ? <AppButton label={owner.busy.history ? "正在繼續搜尋…" : "繼續搜尋歷史"} variant="secondary" disabled={!owner.online || owner.busy.history || read.data.query !== searchText} onPress={owner.actions.moreHistory} /> : null}
        {read.state === "stale" ? <AppButton label="重新搜尋" variant="quiet" disabled={!owner.online || owner.busy.history} onPress={() => owner.actions.searchHistory(searchText)} /> : null}
      </>}
    {owner.message.data?.voice ? <VoiceMessage key={scope + owner.message.data.id} messageId={owner.message.data.id} voice={owner.message.data.voice} /> : null}
    <HistoryMessageDetail read={owner.message} busy={owner.busy.message} online={owner.online} onMore={owner.actions.moreMessage} onClose={owner.actions.closeMessage}
      onPrepareQuestion={message => { if (current.current && current.current.scopeKey === scope && current.current.message.data === message) onPrepareQuestion(historyMessageQuestion(owner.childName, message)); }} />
  </View>;
}

export function PersonalNotificationHistoryView({ searchText, dateRange }: { searchText: string; dateRange: HistoryDateRange }) {
  const owner = usePersonalHistoryWorkspace();
  return <PersonalNotificationContent owner={owner} searchText={searchText} dateRange={dateRange} />;
}

/** Both entry points render the same personal owner; Portal receives this owner explicitly. */
export function PersonalNotificationContent({ owner, searchText = "", dateRange = { from: null, to: null }, recent = false }: {
  owner: PersonalHistoryOwner | null; searchText?: string; dateRange?: HistoryDateRange; recent?: boolean;
}) {
  const current = useRef(owner); current.current = owner;
  const scope = owner?.scopeKey;
  useEffect(() => {
    const latest = current.current;
    if (scope && latest?.online && latest.notifications.state === "unavailable" && !latest.notificationUnavailable) latest.actions.loadNotifications();
  }, [scope, owner?.online]);
  if (!owner) return <ReadStateNotice state="unavailable" title="本人消息暫未提供" />;
  const read = owner.notifications;
  const matches = visiblePersonalMessages(read.data?.items ?? [], searchText, dateRange), items = recent ? matches.slice(0, 5) : matches;
  const retry = <AppButton label="重新讀取消息" variant="secondary" disabled={!owner.online || owner.busy.notifications} onPress={owner.actions.loadNotifications} />;
  return <View style={styles.list}>
    {read.state === "loading" ? <ReadStateNotice state="loading" title="正在讀取消息…" scopeKey={scope} />
      : read.state === "error" ? <ReadStateNotice state="error" title="暫時讀不到消息">{retry}</ReadStateNotice>
      : read.state === "unavailable" ? <ReadStateNotice state="unavailable" title={owner.notificationUnavailable ? "消息內容暫未提供" : owner.online ? "正在準備消息…" : "連線後才可讀取消息"}>{owner.notificationUnavailable ? retry : null}</ReadStateNotice>
      : <>
        {read.state === "stale" || !owner.online ? <ReadStateNotice state="stale" title="目前顯示較早的消息" /> : null}
        {!recent ? <Text style={styles.meta}>搜尋與日期只篩已載入消息。</Text> : null}
        {items.map(item => <BackgroundSurface padded key={item.id} style={styles.entry} testID="personal-notification-entry">
          <Text style={styles.meta}>{notificationTime(item.sentAt)} · {item.scope.kind === "child" ? item.scope.childName : "本人帳戶"}</Text>
          {item.contents.map((content, index) => <View key={`${content.channel}:${index}`} style={styles.messageContent}>
            {content.title ? <Text style={styles.title}>{content.title}</Text> : null}
            <Text selectable style={styles.body}>{content.body}</Text>
            <Text style={styles.meta}>{messageChannelLabel(content.channel)}{item.contents.length > 1 ? ` · ${notificationTime(content.sentAt)}` : ""}</Text>
          </View>)}
        </BackgroundSurface>)}
        {!items.length && read.state === "ready" && owner.online && owner.access !== "revoked" ? read.data?.complete
          ? <EmptyListCard testID="notification-history-empty" title={searchText || dateRange.from || dateRange.to ? "已載入消息沒有符合篩選的內容" : "暫未有可展示的消息內容"} />
          : <ReadStateNotice state="unavailable" title="已載入部分未有符合的消息" message="仍有記錄未讀取。" /> : null}
        {items.length ? <Text style={styles.meta}>只顯示已保存的通知內容；較早記錄可能不齊，不包括帳戶驗證電郵。</Text> : null}
        {!recent && read.data ? <Text style={styles.meta}>已載入 {read.data.items.length} 則{read.data.complete ? "" : " · 尚有記錄未載入"}</Text> : null}
        {!recent && read.data?.nextCursor ? <AppButton label={owner.busy.notifications ? "正在讀取…" : "載入更多消息"} variant="secondary" disabled={!owner.online || owner.busy.notifications} onPress={owner.actions.moreNotifications} /> : null}
        {read.state === "stale" ? retry : null}
      </>}
  </View>;
}
function notificationTime(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "時間未提供";
  return new Intl.DateTimeFormat("zh-HK", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
const styles = StyleSheet.create({
  messageContent: { gap: spacing.xs, minWidth: 0 },
  list: { gap: spacing.md, minWidth: 0 },
  entry: { gap: spacing.sm, minWidth: 0, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.softLine },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  title: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.body },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
});
