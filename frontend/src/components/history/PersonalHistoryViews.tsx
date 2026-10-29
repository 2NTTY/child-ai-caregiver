import { historyPage, historyVersionId } from "./history-page";
import { HistoryPager } from "./HistoryPager";
import { useEffect, useRef, type RefObject } from "react";
import { StyleSheet, View, type ScrollView } from "react-native";
import { ActivityIndicator, Text } from "react-native-paper";
import { historyMessageQuestion, messageChannelLabel, visiblePersonalHistory, visiblePersonalMessages, type HistoryDateRange } from "../../history-view-model";
import { memoryDateLabel } from "../../memory-reference-view-model";
import { usePersonalHistoryWorkspace, type PersonalHistoryOwner } from "../../production/usePersonalHistory";
import { chineseFont, colors, readingType, spacing } from "../../theme";
import { EmptyListCard } from "../EmptyListCard";
import { ReadStateNotice } from "../ReadStateNotice";
import { AppButton } from "../ui";
import { VoiceMessage } from "../../production/VoiceMessage";
import { HistoryMessageDetail } from "./HistoryMessageDetail";
import { ReadTargetLink } from "../ReadTargetLink";
import { serializeHistoryRoute, type HistoryRouteState } from "../../navigation/route-state";
import { useReaderReturn } from "../../navigation/useReaderReturn";
import { useMotionPreferences } from "../../motion/preferences";

export function PersonalConversationHistoryView({ searchText, dateRange, onPrepareQuestion, route, onSelect, onPageChange, scrollRef, getScrollPosition }: {
  searchText: string; dateRange: HistoryDateRange; onPrepareQuestion(question: string): void;
  route: HistoryRouteState; onSelect(id: string | null): void; onPageChange(page: number): void;
  scrollRef?: RefObject<ScrollView | null>; getScrollPosition?(): number;
}) {
  const owner = usePersonalHistoryWorkspace(), current = useRef(owner); current.current = owner;
  const scope = owner?.scopeKey, filterKey = JSON.stringify([searchText, dateRange.from, dateRange.to]);
  // Preserve the original bounded server-search capability and its debounce.
  useEffect(() => {
    if (!scope || !owner) return;
    const timer = setTimeout(() => {
      const latest = current.current;
      if (latest && latest.scopeKey === scope && latest.history.data?.query !== searchText) latest.actions.searchHistory(searchText);
    }, 300);
    return () => clearTimeout(timer);
  }, [scope, searchText, owner?.online]);
  const requestedMessage = useRef<{ scope: string; id: string | null; query: string | undefined } | null>(null);
  useEffect(() => {
    if (!scope || !owner || owner.access === "revoked") { requestedMessage.current = null; return; }
    if (!owner.online) return;
    // A new server query closes its prior original in the existing owner.
    // Resolve the still-accepted exact URL again after that query publishes;
    // a same-query background refresh does not create a new read intent.
    const before = requestedMessage.current, query = owner.history.data?.query;
    if (before?.scope === scope && before.id === route.selectedId && (query === undefined || before.query === query)) return;
    requestedMessage.current = { scope, id: route.selectedId, query };
    if (route.selectedId) owner.actions.readMessage(route.selectedId);
    else if (owner.message.data || owner.busy.message) owner.actions.closeMessage();
  }, [scope, route.selectedId, owner?.online, owner?.access, owner?.history.data?.query]);
  const matches = owner ? visiblePersonalHistory(owner.history, dateRange) : [], page = historyPage(matches, route.page);
  const listRef = useRef<View>(null), readerRef = useRef<View>(null), localScroll = useRef<ScrollView>(null);
  const position = useReaderReturn({ scopeKey: JSON.stringify([scope, owner?.access, "conversation-history", filterKey, page.page]), selectedId: route.selectedId,
    enabled: !!owner && owner.access !== "revoked", listRef, readerRef, scrollRef: scrollRef ?? localScroll });
  const close = () => { position.returning(); onSelect(null); };
  if (!owner) return <ReadStateNotice headingLevel={3} state="unavailable" title="對話歷史暫未提供" />;
  if (owner.access === "revoked") return <ReadStateNotice headingLevel={3} state="unavailable" title="對話權限已失效" message="對話摘要及原文已隱藏。" />;
  const read = owner.history, selectedRead = owner.message.scopeKey === scope && (!owner.message.data || owner.message.data.id === route.selectedId);
  const retry = <AppButton label="重新搜尋" variant="secondary" disabled={!owner.online || owner.busy.history} onPress={() => owner.actions.searchHistory(searchText)} />;
  return <View style={styles.list} testID="conversation-history">
    <Text style={styles.body}>只查閱你與這位孩子的對話。每次最多掃 100 則，返回最多 10 個命中；日期只篩已掃過的結果。</Text>
    {read.state === "loading" ? <ReadStateNotice headingLevel={3} state="loading" title="正在搜尋對話…" />
      : read.state === "error" ? <ReadStateNotice headingLevel={3} state="error" title="暫時讀不到對話歷史">{retry}</ReadStateNotice>
      : read.state === "unavailable" ? <ReadStateNotice headingLevel={3} state="unavailable" title={owner.online ? "正在準備對話搜尋…" : "連線後才可讀取對話歷史"} /> : null}
    {read.state === "stale" || !owner.online ? <ReadStateNotice headingLevel={3} state="stale" title="最新歷史尚未核對" message="目前保留已載入結果。">{retry}</ReadStateNotice> : null}
    {read.data && read.data.query !== searchText ? <Text style={styles.body}>正在套用新搜尋條件；目前保留先前的結果。</Text> : null}
    <View testID="conversation-history-index" aria-hidden={!!route.selectedId} style={[styles.list, !!route.selectedId && styles.hidden]}>
      <View ref={listRef} tabIndex={-1} accessibilityLabel="助手對話歷史清單" testID="conversation-history-list">
        {page.items.map(match => <ReadTargetLink key={match.id} ref={node => position.rowRef(match.id, node)} testID={`history-message-${match.id}`}
          href={{ pathname: "/history", params: serializeHistoryRoute({ ...route, category: "conversations", selectedId: match.id }) }}
          label={`閱讀${match.role === "user" ? "你的訊息" : "助手回覆"}原文：${match.excerpt}，${memoryDateLabel(match.createdAt)}`}
          availability={!owner.online ? "unavailable" : owner.busy.message ? "refreshing" : "ready"} style={styles.historyRow}
          onOpen={() => { const latest = current.current; if (!latest || latest.scopeKey !== scope || latest.access === "revoked") return; position.remember(match.id, getScrollPosition?.()); onSelect(match.id); }}>
          <Text numberOfLines={3} style={styles.body}>{match.excerpt}</Text>
          <Text style={styles.meta}>{match.role === "user" ? "你的訊息" : "助手回覆"} · {memoryDateLabel(match.createdAt)}</Text>
          <Text style={styles.meta}>搜尋摘要 · 原文按需讀取</Text>
        </ReadTargetLink>)}
      </View>
      {!matches.length && read.state === "ready" && owner.online && read.data.query === searchText ? <EmptyListCard testID="conversation-history-empty" title={read.data.complete ? "沒有符合篩選的對話" : "已搜尋的範圍未有符合結果"}
        detail={read.data.complete ? "本次搜尋已完整掃過可讀歷史。" : "仍有歷史未搜尋，可繼續搜尋。"} /> : null}
      <HistoryPager page={page.page} total={page.total} onChange={onPageChange} />
      {read.data?.nextCursor ? <AppButton label={owner.busy.history ? "正在繼續搜尋…" : "繼續搜尋歷史"} variant="secondary" disabled={!owner.online || owner.busy.history || read.data.query !== searchText} onPress={owner.actions.moreHistory} /> : null}
    </View>
    {read.data ? <Text style={styles.body}>已掃 {read.data.scanned} 則 · {read.data.complete ? "本次搜尋已完整掃過可讀歷史" : "搜尋尚未完整，仍有歷史未掃過"}</Text> : null}
    {route.selectedId ? <View style={styles.reader} testID="conversation-history-reader">
      <AppButton label="返回助手對話歷史" variant="quiet" onPress={close} />
      <View ref={readerRef} tabIndex={-1} accessibilityLabel="訊息原文" testID="conversation-history-reader-heading"><Text accessibilityRole="header" aria-level={3} style={styles.readerTitle}>訊息原文</Text></View>
      {selectedRead ? <>
        {owner.message.data?.voice ? <VoiceMessage key={scope + owner.message.data.id} messageId={owner.message.data.id} voice={owner.message.data.voice} /> : null}
        <HistoryMessageDetail headingLevel={3} read={owner.message} busy={owner.busy.message} online={owner.online} onMore={owner.actions.moreMessage}
          onPrepareQuestion={message => { if (current.current?.scopeKey === scope && current.current.message.data === message && message.id === route.selectedId) onPrepareQuestion(historyMessageQuestion(owner.childName, message)); }} />
      </> : <ReadStateNotice headingLevel={3} state={owner.busy.message ? "loading" : "unavailable"} message={owner.busy.message ? "正在讀取指定訊息的原文…" : "指定原文尚未讀取，沒有代選其他訊息。"} />}
      {owner.message.state === "error" || owner.message.state === "unavailable" || !selectedRead ? <AppButton label="重新讀取這則原文" variant="secondary" disabled={!owner.online || owner.busy.message} onPress={() => owner.actions.readMessage(route.selectedId!)} /> : null}
    </View> : null}
  </View>;
}

type NotificationReaderProps = { searchText: string; dateRange: HistoryDateRange; route: HistoryRouteState;
  onSelect(id: string | null): void; onPageChange(page: number): void; scrollRef?: RefObject<ScrollView | null>; getScrollPosition?(): number };
export function PersonalNotificationHistoryView(props: NotificationReaderProps) {
  const owner = usePersonalHistoryWorkspace();
  return <PersonalNotificationContent owner={owner} {...props} />;
}
function useNotificationLoad(owner: PersonalHistoryOwner | null) {
  const current = useRef(owner); current.current = owner;
  const scope = owner?.scopeKey;
  useEffect(() => {
    const latest = current.current;
    if (scope && latest?.online && latest.access !== "revoked" && latest.notifications.state === "unavailable" && !latest.notificationUnavailable) latest.actions.loadNotifications();
  }, [scope, owner?.online]);
}
/** The full History surface resolves only exact versions from the original loaded owner. */
export function PersonalNotificationContent({ owner, searchText, dateRange, route, onSelect, onPageChange, scrollRef, getScrollPosition }: NotificationReaderProps & { owner: PersonalHistoryOwner | null }) {
  useNotificationLoad(owner);
  const current = useRef(owner); current.current = owner;
  const scope = owner?.scopeKey, filterKey = JSON.stringify([searchText, dateRange.from, dateRange.to]);
  const selected = owner?.access !== "revoked" ? owner?.notifications.data?.items.find(item => historyVersionId(item.id, notificationVersion(item)) === route.selectedId) : null;
  const matches = visiblePersonalMessages(owner?.notifications.data?.items ?? [], searchText, dateRange), page = historyPage(matches, route.page);
  const listRef = useRef<View>(null), readerRef = useRef<View>(null), localScroll = useRef<ScrollView>(null);
  const position = useReaderReturn({ scopeKey: JSON.stringify([scope, owner?.access, "notification-history", filterKey, page.page]), selectedId: route.selectedId,
    enabled: !!owner && owner.access !== "revoked", listRef, readerRef, scrollRef: scrollRef ?? localScroll });
  const close = () => { position.returning(); onSelect(null); };
  if (!owner) return <ReadStateNotice headingLevel={3} state="unavailable" title="本人消息暫未提供" />;
  if (owner.access === "revoked") return <ReadStateNotice headingLevel={3} state="unavailable" title="消息權限已失效" message="已載入的消息內容已隱藏。" />;
  const read = owner.notifications;
  const retry = <AppButton label="重新讀取消息" variant="secondary" disabled={!owner.online || owner.busy.notifications} onPress={owner.actions.loadNotifications} />;
  return <View style={styles.list} testID="notification-history">
    {read.state === "loading" ? <ReadStateNotice headingLevel={3} state="loading" title="正在讀取消息…" scopeKey={scope} />
      : read.state === "error" ? <ReadStateNotice headingLevel={3} state="error" title="暫時讀不到消息">{retry}</ReadStateNotice>
      : read.state === "unavailable" ? <ReadStateNotice headingLevel={3} state="unavailable" title={owner.notificationUnavailable ? "消息內容暫未提供" : owner.online ? "正在準備消息…" : "連線後才可讀取消息"}>{owner.notificationUnavailable ? retry : null}</ReadStateNotice> : null}
    {read.state === "stale" || !owner.online ? <ReadStateNotice headingLevel={3} state="stale" title="目前顯示較早的消息">{retry}</ReadStateNotice> : null}
    <View testID="notification-history-index" aria-hidden={!!route.selectedId} style={[styles.list, !!route.selectedId && styles.hidden]}>
      <Text style={styles.body}>搜尋與日期只篩已載入消息。</Text>
      <View ref={listRef} tabIndex={-1} accessibilityLabel="消息歷史清單" testID="notification-history-list">
        {page.items.map(item => { const content = item.contents[0], id = historyVersionId(item.id, notificationVersion(item));
          return <ReadTargetLink key={id} ref={node => position.rowRef(id, node)} testID="personal-notification-entry"
            href={{ pathname: "/history", params: serializeHistoryRoute({ ...route, category: "notifications", selectedId: id }) }} style={styles.historyRow}
            label={`閱讀消息：${(content.title ?? content.body).slice(0, 100)}；預覽來自${messageChannelLabel(content.channel)}，${notificationTime(item.sentAt)}，${item.scope.kind === "child" ? item.scope.childName : "本人帳戶"}`}
            onOpen={() => { const latest = current.current; if (!scope || !latest || latest.scopeKey !== scope || latest.access === "revoked") return; position.remember(id, getScrollPosition?.()); onSelect(id); }}>
            {content.title ? <Text numberOfLines={2} style={styles.title}>{content.title}</Text> : null}<Text numberOfLines={3} style={styles.body}>{content.body}</Text>
            <Text style={styles.meta}>預覽：{messageChannelLabel(content.channel)}{item.contents.length > 1 ? ` · 另有 ${item.contents.length - 1} 個渠道` : ""}</Text>
            <Text style={styles.meta}>{notificationTime(item.sentAt)} · {item.scope.kind === "child" ? item.scope.childName : "本人帳戶"}</Text>
          </ReadTargetLink>;
        })}
      </View>
      {!matches.length && read.state === "ready" && owner.online ? <EmptyListCard testID="notification-history-empty" title={read.data?.complete ? searchText || dateRange.from || dateRange.to ? "已載入消息沒有符合篩選的內容" : "暫未有可展示的消息內容" : "已載入部分未有符合的消息"} detail={read.data?.complete ? undefined : "仍有記錄未讀取，可繼續載入。"} /> : null}
      <HistoryPager page={page.page} total={page.total} onChange={onPageChange} />
      {read.data?.nextCursor ? <AppButton label={owner.busy.notifications ? "正在讀取…" : "載入更多消息"} variant="secondary" disabled={!owner.online || owner.busy.notifications} onPress={owner.actions.moreNotifications} /> : null}
    </View>
    {route.selectedId ? <View testID="notification-history-reader" style={styles.reader}>
      <AppButton label="返回消息歷史" variant="quiet" onPress={close} />
      <View ref={readerRef} tabIndex={-1} accessibilityLabel="消息內容" testID="notification-history-reader-heading"><Text accessibilityRole="header" aria-level={3} style={styles.readerTitle}>消息內容</Text></View>
      {selected ? <><Text style={styles.meta}>{notificationTime(selected.sentAt)} · {selected.scope.kind === "child" ? selected.scope.childName : "本人帳戶"}</Text>
      <View testID="notification-history-detail" style={styles.list}>{selected.contents.map(content => <View key={content.channel} style={styles.channelDetail}>
        <Text accessibilityRole="header" aria-level={4} style={styles.channel}>{messageChannelLabel(content.channel)}</Text>
        {content.title ? <Text selectable style={styles.title}>{content.title}</Text> : null}<Text selectable style={styles.body}>{content.body}</Text><Text style={styles.meta}>{notificationTime(content.sentAt)}</Text>
      </View>)}</View></> : <ReadStateNotice headingLevel={3} state={read.state === "loading" ? "loading" : "unavailable"} message={read.state === "loading" ? "正在讀取消息…" : "這則消息或版本不在已載入且可讀的清單，沒有代選其他消息。"} />}
    </View> : null}
    {read.data?.items.length ? <Text style={styles.body}>只顯示已保存的通知內容；較早記錄可能不齊，不包括帳戶驗證電郵。</Text> : null}
    {read.data ? <Text style={styles.body}>已載入 {read.data.items.length} 則{read.data.complete ? "" : " · 尚有記錄未載入"}</Text> : null}
  </View>;
}

/** A separate compact Bell composition; never owns a History selection or modal. */
export function RecentNotificationMessages({ owner }: { owner: PersonalHistoryOwner | null }) {
  useNotificationLoad(owner);
  const motion = useMotionPreferences();
  if (!owner || owner.access === "revoked") return <ReadStateNotice headingLevel={2} state="unavailable" title={owner ? "消息權限已失效" : "本人消息暫未提供"} />;
  const read = owner.notifications, items = read.data?.items.slice(0, 5) ?? [];
  const retry = <AppButton label="重新讀取消息" variant="secondary" disabled={!owner.online || owner.busy.notifications} onPress={owner.actions.loadNotifications} />;
  return <View style={styles.list} testID="recent-notification-messages">
    {read.state === "loading" ? <View testID="recent-notification-loading" style={styles.row}>{motion.enabled ? <ActivityIndicator color={colors.teal} /> : <View testID="read-loading-static" accessible={false} aria-hidden style={styles.staticIndicator} />}<Text style={styles.body}>正在讀取消息…</Text></View>
      : read.state === "error" ? <ReadStateNotice headingLevel={2} state="error" title="暫時讀不到消息">{retry}</ReadStateNotice>
      : read.state === "unavailable" ? <ReadStateNotice headingLevel={2} state="unavailable" title={owner.notificationUnavailable ? "消息內容暫未提供" : owner.online ? "正在準備消息…" : "連線後才可讀取消息"}>{owner.notificationUnavailable ? retry : null}</ReadStateNotice> : null}
    {read.state === "stale" || !owner.online ? <ReadStateNotice headingLevel={2} state="stale" title="目前顯示較早的消息">{retry}</ReadStateNotice> : null}
    {items.map(item => <View key={item.id} style={styles.entry} testID="personal-notification-entry"><Text style={styles.meta}>{notificationTime(item.sentAt)} · {item.scope.kind === "child" ? item.scope.childName : "本人帳戶"}</Text>
      {item.contents.map(content => <View key={content.channel} style={styles.messageContent}>{content.title ? <Text style={styles.title}>{content.title}</Text> : null}<Text selectable style={styles.body}>{content.body}</Text><Text style={styles.meta}>{messageChannelLabel(content.channel)}{item.contents.length > 1 ? ` · ${notificationTime(content.sentAt)}` : ""}</Text></View>)}
    </View>)}
    {!items.length && read.state === "ready" && owner.online ? read.data?.complete ? <EmptyListCard testID="notification-history-empty" title="暫未有可展示的消息內容" /> : <ReadStateNotice headingLevel={2} state="unavailable" title="已載入部分未有符合的消息" message="仍有記錄未讀取。" /> : null}
    {items.length ? <Text style={styles.body}>只顯示已保存的通知內容；較早記錄可能不齊，不包括帳戶驗證電郵。</Text> : null}
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
  hidden: { display: "none" }, historyRow: { minWidth: 0, minHeight: 48, gap: spacing.xs, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.line, borderRadius: 0 },
  reader: { width: "100%", maxWidth: 760, alignSelf: "center", minWidth: 0, gap: spacing.lg }, readerTitle: { fontFamily: chineseFont, color: colors.ink, ...readingType.body, fontWeight: "700" },
  staticIndicator: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.teal },
  channelDetail: { gap: spacing.sm, minWidth: 0, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.softLine },
  channel: { fontFamily: chineseFont, color: colors.ink, ...readingType.body, fontWeight: "700" },
  messageContent: { gap: spacing.xs, minWidth: 0 },
  list: { gap: spacing.md, minWidth: 0 },
  entry: { gap: spacing.sm, minWidth: 0, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.softLine },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  title: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.body },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
});
