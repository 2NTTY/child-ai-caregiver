import { BackgroundSurface } from "../appearance/BackgroundSurface";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { ActivityIndicator, Text } from "react-native-paper";
import { historyMessageQuestion, messageChannelLabel, visiblePersonalHistory, visiblePersonalMessages, type HistoryDateRange } from "../../history-view-model";
import { memoryDateLabel } from "../../memory-reference-view-model";
import { usePersonalHistoryWorkspace, type PersonalHistoryOwner } from "../../production/usePersonalHistory";
import { chineseFont, colors, readingType, spacing } from "../../theme";
import { EmptyListCard } from "../EmptyListCard";
import { ReadStateNotice } from "../ReadStateNotice";
import { AppButton } from "../ui";
import { VoiceMessage } from "../../production/VoiceMessage";
import { FormDialog } from "../FormDialog";
import { HistoryCardGrid, HistoryEntryCard } from "./HistoryCards";
import { HistoryMessageDetail } from "./HistoryMessageDetail";
import { useMotionPreferences } from "../../motion/preferences";

export function PersonalConversationHistoryView({ searchText, dateRange, onPrepareQuestion }: {
  searchText: string; dateRange: HistoryDateRange; onPrepareQuestion(question: string): void;
}) {
  const owner = usePersonalHistoryWorkspace(), current = useRef(owner); current.current = owner;
  const scope = owner?.scopeKey;
  const filterKey = JSON.stringify([searchText, dateRange.from, dateRange.to]);
  const [selection, setSelection] = useState<{ scope: string; id: string; filterKey: string } | null>(null);
  const opened = useRef<{ scope: string; id: string } | null>(null);
  const returnFocus = useRef<View>(null), listRef = useRef<View>(null), cards = useRef(new Map<string, View>());
  useEffect(() => {
    setSelection(null);
    return () => {
      const latest = current.current;
      if (latest && opened.current?.scope === scope && latest.scopeKey === scope) latest.actions.closeMessage();
      opened.current = null;
    };
  }, [scope, filterKey, owner?.access]);
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
  const visible = owner.access !== "revoked" && selection && selection.scope === scope && selection.filterKey === filterKey;
  const selectedRead = owner.message.scopeKey === scope && (!owner.message.data || owner.message.data.id === selection?.id);
  const close = () => { opened.current = null; setSelection(null); owner.actions.closeMessage(); };
  return <View ref={listRef} tabIndex={-1} accessibilityLabel="助手對話歷史" style={styles.list}>
    <BackgroundSurface padded><Text style={styles.meta}>只查閱你與這位孩子的對話。每次最多掃 100 則，返回最多 10 個命中；日期篩選只包括已掃過的結果。</Text></BackgroundSurface>
    {read.state === "loading" ? <ReadStateNotice state="loading" title="正在搜尋對話…" />
      : read.state === "error" ? <ReadStateNotice state="error" title="暫時讀不到對話歷史"><AppButton label="重新搜尋" variant="secondary" disabled={!owner.online || owner.busy.history} onPress={() => owner.actions.searchHistory(searchText)} /></ReadStateNotice>
      : read.state === "unavailable" ? <ReadStateNotice state="unavailable" title={owner.online ? "正在準備對話搜尋…" : "連線後才可讀取對話歷史"} />
      : <>
        {read.state === "stale" || !owner.online ? <ReadStateNotice state="stale" title="最新歷史尚未核對" message="目前保留已載入結果。" /> : null}
        {read.data?.query !== searchText ? <BackgroundSurface padded><Text style={styles.meta}>正在套用新搜尋條件；以下是先前的結果。</Text></BackgroundSurface> : null}
        <HistoryCardGrid testID="conversation-history-cards">{matches.map(match => <HistoryEntryCard key={match.id} testID={`history-message-${match.id}`}
          cardRef={node => { if (node) cards.current.set(match.id, node); else cards.current.delete(match.id); }}
          accessibilityLabel={`閱讀${match.role === "user" ? "你的訊息" : "助手回覆"}原文：${match.excerpt}`}
          disabled={!owner.online || owner.busy.message} onPress={() => {
            if (!scope || current.current?.scopeKey !== scope || current.current.access === "revoked") return;
            returnFocus.current = cards.current.get(match.id) ?? null;
            opened.current = { scope, id: match.id }; setSelection({ scope, id: match.id, filterKey }); owner.actions.readMessage(match.id);
          }}>
          <Text numberOfLines={4} style={styles.body}>{match.excerpt}</Text>
          <Text style={styles.meta}>{match.role === "user" ? "你的訊息" : "助手回覆"} · {memoryDateLabel(match.createdAt)}</Text>
          <Text style={styles.meta}>搜尋摘要 · 原文按需讀取</Text>
        </HistoryEntryCard>)}</HistoryCardGrid>
        {!matches.length && read.state === "ready" && owner.online && owner.access !== "revoked" && read.data.query === searchText ? <EmptyListCard testID="conversation-history-empty" title={read.data.complete ? "沒有符合篩選的對話" : "已搜尋的範圍未有符合結果"}
          detail={read.data.complete ? "本次搜尋已完整掃過可讀歷史。" : "仍有歷史未搜尋，可繼續搜尋。"} /> : null}
        {read.data ? <BackgroundSurface padded><Text style={styles.meta}>已掃 {read.data.scanned} 則 · {read.data.complete ? "本次搜尋已完整掃過可讀歷史" : "搜尋尚未完整，仍有歷史未掃過"}</Text></BackgroundSurface> : null}
        {read.data?.nextCursor ? <AppButton label={owner.busy.history ? "正在繼續搜尋…" : "繼續搜尋歷史"} variant="secondary" disabled={!owner.online || owner.busy.history || read.data.query !== searchText} onPress={owner.actions.moreHistory} /> : null}
        {read.state === "stale" ? <AppButton label="重新搜尋" variant="quiet" disabled={!owner.online || owner.busy.history} onPress={() => owner.actions.searchHistory(searchText)} /> : null}
      </>}
    <FormDialog visible={!!visible} scopeKey={scope ?? ""} formKey={selection?.id} title="訊息原文"
      dismissMode="local" returnFocusRef={returnFocus} fallbackFocusRef={listRef} onClose={close}>
      {visible && selectedRead ? <>
        {owner.message.data?.voice ? <VoiceMessage key={scope + owner.message.data.id} messageId={owner.message.data.id} voice={owner.message.data.voice} /> : null}
        <HistoryMessageDetail embedded read={owner.message} busy={owner.busy.message} online={owner.online} onMore={owner.actions.moreMessage}
          onPrepareQuestion={message => { if (current.current?.scopeKey === scope && current.current.message.data === message && message.id === selection?.id) onPrepareQuestion(historyMessageQuestion(owner.childName, message)); }} />
      </> : visible ? <ReadStateNotice state="loading" title="正在讀取原文…" /> : null}
    </FormDialog>
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
  const motion = useMotionPreferences();
  const current = useRef(owner); current.current = owner;
  const scope = owner?.scopeKey;
  const filterKey = JSON.stringify([searchText, dateRange.from, dateRange.to]);
  const [selection, setSelection] = useState<{ scope: string; id: string; version: string; filterKey: string } | null>(null);
  const returnFocus = useRef<View>(null), listRef = useRef<View>(null), cards = useRef(new Map<string, View>());
  const selected = !recent && owner && owner.access !== "revoked" && selection && selection.scope === scope && selection.filterKey === filterKey
    ? owner.notifications.data?.items.find(item => item.id === selection.id && notificationVersion(item) === selection.version) : null;
  useEffect(() => { if (selection && !selected) setSelection(null); }, [selection, selected]);
  useEffect(() => { setSelection(null); }, [scope, filterKey, owner?.access]);
  useEffect(() => {
    const latest = current.current;
    if (scope && latest?.online && latest.notifications.state === "unavailable" && !latest.notificationUnavailable) latest.actions.loadNotifications();
  }, [scope, owner?.online]);
  if (!owner) return <ReadStateNotice state="unavailable" title="本人消息暫未提供" />;
  const read = owner.notifications;
  const matches = visiblePersonalMessages(read.data?.items ?? [], searchText, dateRange), items = recent ? matches.slice(0, 5) : matches;
  const retry = <AppButton label="重新讀取消息" variant="secondary" disabled={!owner.online || owner.busy.notifications} onPress={owner.actions.loadNotifications} />;
  return <View ref={listRef} tabIndex={recent ? undefined : -1} accessibilityLabel={recent ? undefined : "消息歷史"} style={styles.list}>
    {read.state === "loading" ? recent ? <View testID="recent-notification-loading" style={styles.row}>
      {motion.enabled ? <ActivityIndicator color={colors.teal} /> : <View testID="read-loading-static" accessible={false} aria-hidden style={styles.staticIndicator} />}
      <Text style={styles.meta}>正在讀取消息…</Text>
    </View> : <ReadStateNotice state="loading" title="正在讀取消息…" scopeKey={scope} />
      : read.state === "error" ? <ReadStateNotice state="error" title="暫時讀不到消息">{retry}</ReadStateNotice>
      : read.state === "unavailable" ? <ReadStateNotice state="unavailable" title={owner.notificationUnavailable ? "消息內容暫未提供" : owner.online ? "正在準備消息…" : "連線後才可讀取消息"}>{owner.notificationUnavailable ? retry : null}</ReadStateNotice>
      : <>
        {read.state === "stale" || !owner.online ? <ReadStateNotice state="stale" title="目前顯示較早的消息" /> : null}
        {!recent ? <Text style={styles.meta}>搜尋與日期只篩已載入消息。</Text> : null}
        {recent ? items.map(item => <BackgroundSurface padded key={item.id} style={styles.entry} testID="personal-notification-entry">
          <Text style={styles.meta}>{notificationTime(item.sentAt)} · {item.scope.kind === "child" ? item.scope.childName : "本人帳戶"}</Text>
          {item.contents.map((content, index) => <View key={`${content.channel}:${index}`} style={styles.messageContent}>
            {content.title ? <Text style={styles.title}>{content.title}</Text> : null}
            <Text selectable style={styles.body}>{content.body}</Text>
            <Text style={styles.meta}>{messageChannelLabel(content.channel)}{item.contents.length > 1 ? ` · ${notificationTime(content.sentAt)}` : ""}</Text>
          </View>)}
        </BackgroundSurface>) : <HistoryCardGrid testID="notification-history-cards">{items.map(item => {
          const content = item.contents[0];
          return <HistoryEntryCard key={item.id} testID="personal-notification-entry"
            cardRef={node => { if (node) cards.current.set(item.id, node); else cards.current.delete(item.id); }}
            accessibilityLabel={`閱讀消息：${(content.title ?? content.body).slice(0, 100)}；預覽來自${messageChannelLabel(content.channel)}`}
            onPress={() => {
              if (!scope || current.current?.scopeKey !== scope || current.current.access === "revoked") return;
              returnFocus.current = cards.current.get(item.id) ?? null; setSelection({ scope, id: item.id, version: notificationVersion(item), filterKey });
            }}>
            {content.title ? <Text numberOfLines={2} style={styles.title}>{content.title}</Text> : null}
            <Text numberOfLines={3} style={styles.body}>{content.body}</Text>
            <Text style={styles.meta}>預覽：{messageChannelLabel(content.channel)}{item.contents.length > 1 ? ` · 另有 ${item.contents.length - 1} 個渠道` : ""}</Text>
            <Text style={styles.meta}>{notificationTime(item.sentAt)} · {item.scope.kind === "child" ? item.scope.childName : "本人帳戶"}</Text>
          </HistoryEntryCard>;
        })}</HistoryCardGrid>}
        {!items.length && read.state === "ready" && owner.online && owner.access !== "revoked" ? read.data?.complete
          ? <EmptyListCard testID="notification-history-empty" title={searchText || dateRange.from || dateRange.to ? "已載入消息沒有符合篩選的內容" : "暫未有可展示的消息內容"} />
          : recent ? <ReadStateNotice state="unavailable" title="已載入部分未有符合的消息" message="仍有記錄未讀取。" />
            : <EmptyListCard testID="notification-history-empty" title="已載入部分未有符合的消息" detail="仍有記錄未讀取，可繼續載入。" /> : null}
        {items.length ? <Text style={styles.meta}>只顯示已保存的通知內容；較早記錄可能不齊，不包括帳戶驗證電郵。</Text> : null}
        {!recent && read.data ? <Text style={styles.meta}>已載入 {read.data.items.length} 則{read.data.complete ? "" : " · 尚有記錄未載入"}</Text> : null}
        {!recent && read.data?.nextCursor ? <AppButton label={owner.busy.notifications ? "正在讀取…" : "載入更多消息"} variant="secondary" disabled={!owner.online || owner.busy.notifications} onPress={owner.actions.moreNotifications} /> : null}
        {read.state === "stale" ? retry : null}
      </>}
    {!recent ? <FormDialog visible={!!selected} scopeKey={scope ?? ""} formKey={selection ? `${selection.id}:${selection.version}` : undefined} title="消息內容"
      dismissMode="local" returnFocusRef={returnFocus} fallbackFocusRef={listRef} onClose={() => setSelection(null)}>
      {selected ? <View style={styles.list} testID="notification-history-detail">
        <Text style={styles.meta}>{notificationTime(selected.sentAt)} · {selected.scope.kind === "child" ? selected.scope.childName : "本人帳戶"}</Text>
        {selected.contents.map(content => <View key={content.channel} style={styles.channelDetail}>
          <Text accessibilityRole="header" aria-level={3} style={styles.channel}>{messageChannelLabel(content.channel)}</Text>
          {content.title ? <Text selectable style={styles.title}>{content.title}</Text> : null}
          <Text selectable style={styles.body}>{content.body}</Text>
          <Text style={styles.meta}>{notificationTime(content.sentAt)}</Text>
        </View>)}
      </View> : null}
    </FormDialog> : null}
  </View>;
}
function notificationVersion(item: { contents: readonly { channel: string; contentVersion: string }[] }) {
  return item.contents.map(content => `${content.channel}:${content.contentVersion}`).sort().join("|");
}
function notificationTime(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "時間未提供";
  return new Intl.DateTimeFormat("zh-HK", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
const styles = StyleSheet.create({
  staticIndicator: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.teal },
  channelDetail: { gap: spacing.sm, minWidth: 0, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.softLine },
  channel: { fontFamily: chineseFont, color: colors.deepTeal, ...readingType.meta, fontWeight: "700" },
  messageContent: { gap: spacing.xs, minWidth: 0 },
  list: { gap: spacing.md, minWidth: 0 },
  entry: { gap: spacing.sm, minWidth: 0, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.softLine },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  title: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.body },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
});
