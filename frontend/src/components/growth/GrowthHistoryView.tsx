import { historyPage, historyVersionId } from "../history/history-page";
import { HistoryPager } from "../history/HistoryPager";
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { Platform, StyleSheet, View, type ScrollView } from "react-native";
import { Text } from "react-native-paper";
import { growthArchivedConcerns, growthConcernAtCapacity, growthConcernCanRestore } from "../../growth-view-model";
import { useGrowthWorkspace, type GrowthWorkspaceValue } from "../../workspaces/GrowthWorkspace";
import type { HistoryRouteState } from "../../navigation/route-state";
import { serializeHistoryRoute } from "../../navigation/route-state";
import { useReaderReturn } from "../../navigation/useReaderReturn";
import { useReaderPosition } from "../../navigation/ReaderPosition";
import { ReadTargetLink } from "../ReadTargetLink";
import { ReadStateNotice } from "../ReadStateNotice";
import { AppButton } from "../ui";
import { GrowthConcernTimeline } from "./GrowthConcernTimeline";
import { GrowthOperationRecovery } from "./GrowthOperationRecovery";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { chineseFont, colors, readingType, spacing } from "../../theme";

type Props = {
  route: HistoryRouteState; onSelect(id: string | null): void; onPageChange(page: number): void;
  searchText: string; dateRange: { from: string | null; to: string | null };
  onRecord?: (id?: string) => void; onTask(id: string): void; onReview?(): void;
  scrollRef?: RefObject<ScrollView | null>; getScrollPosition?(): number;
};
const closedAt = (value: string | null | undefined) => value && !Number.isNaN(Date.parse(value))
  ? `結束於 ${new Date(value).toLocaleDateString("zh-HK", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "numeric", day: "numeric" })}` : "結束日期未提供";

/** Historical versions have an explicit URL reader, not an editable active-workspace mode. */
export function GrowthHistoryView(props: Props) {
  const workspace = useGrowthWorkspace();
  const returnControl = useRef<View>(null);
  const restoreFocus = useRef<{ scope: string; signature: string; id: string; version: number; authority: string; trigger: HTMLElement; previous: GrowthWorkspaceValue["model"]["lastConcernChange"] } | null>(null);
  const { meta: { isCurrent } } = useReaderPosition();
  const signature = JSON.stringify([props.route, props.searchText, props.dateRange]);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const moved = (event: FocusEvent) => { if (restoreFocus.current && event.target !== restoreFocus.current.trigger && event.target !== document.body) restoreFocus.current = null; };
    document.addEventListener("focusin", moved, true);
    return () => document.removeEventListener("focusin", moved, true);
  }, []);
  useLayoutEffect(() => {
    const intent = restoreFocus.current;
    if (!intent) return;
    if (!workspace || workspace.scopeKey !== intent.scope || signature !== intent.signature || workspace.model.access === "lost" || !isCurrent()) { restoreFocus.current = null; return; }
    const { model } = workspace, change = model.lastConcernChange;
    if (["failed", "conflict"].includes(model.operation)) { restoreFocus.current = null; return; }
    if (!change || change === intent.previous) return;
    if (change.action !== "restore" || change.scopeKey !== intent.scope || change.authorityVersion !== intent.authority || change.id !== intent.id || change.version <= intent.version) { restoreFocus.current = null; return; }
    if (model.busy || model.pending || model.page?.concerns?.state !== "ready") return;
    const restored = model.page.concerns.items.find(item => item.id === intent.id && item.childId === model.childId && item.version === change.version && item.status !== "closed");
    restoreFocus.current = null;
    if (restored && !intent.trigger.isConnected && document.activeElement === document.body) (returnControl.current as unknown as HTMLElement | null)?.focus({ preventScroll: true });
  }, [workspace, signature, isCurrent]);
  if (!workspace) return <ReadStateNotice state="loading" message="正在讀取關注歷史。" />;
  const { model, actions } = workspace;
  if (model.access === "lost") return <ReadStateNotice state="unavailable" message="已無權查看這位孩子的關注歷史。" />;
  if (!model.page || model.page.concerns?.state !== "ready") return <View style={styles.stack}><GrowthOperationRecovery model={model} actions={actions} includeRefresh />
    <ReadStateNotice state={model.load === "loading" ? "loading" : "unavailable"} message={model.load === "loading" ? "正在讀取關注歷史。" : "暫未能讀取關注歷史。"} /></View>;
  const archived = growthArchivedConcerns(model, props.searchText, props.dateRange);
  const selected = archived.find(item => historyVersionId(item.id, item.version) === props.route.selectedId) ?? null;
  const notice = model.operation === "saved" && model.notice.startsWith("已結束這條關注") ? "已結束關注。"
    : model.operation === "saved" && model.notice.startsWith("已恢復這條關注") ? "已恢復關注。" : model.notice;
  return <View style={styles.stack} testID="growth-history">
    <StatusAnnouncement eventKey={`${model.operation}:${notice}`} message={notice} urgent={model.operation === "failed"} />
    {notice ? <Text style={[styles.body, ["unknown", "failed", "conflict"].includes(model.operation) && styles.warning]}>{notice}</Text> : null}
    <GrowthOperationRecovery model={model} actions={actions} includeRefresh />
    {!model.online ? <Text style={styles.warning}>目前離線，內容可能未更新。</Text> : null}
    {model.load === "error" ? <Text style={styles.warning}>未能更新關注歷史，請稍後重試。</Text> : null}
    {props.route.selectedId && !selected ? <View testID="growth-history-unavailable" style={styles.stack}>
      <ReadStateNotice state="unavailable" message="這個版本不在目前已載入的已結束清單，沒有代選其他內容。" />
      <AppButton ref={returnControl} label="返回關注歷史清單" variant="quiet" onPress={() => props.onSelect(null)} />
    </View> : <LoadedGrowthHistory {...props} workspace={workspace} archived={archived} selected={selected} onRestore={(concern, trigger) => {
      const element = Platform.OS === "web" ? trigger as unknown as HTMLElement | null : null;
      if (element && document.activeElement === element && isCurrent()) restoreFocus.current = { scope: workspace.scopeKey, signature, id: concern.id, version: concern.version, authority: model.page!.authorityVersion, trigger: element, previous: model.lastConcernChange };
      actions.restoreConcern(concern.id, concern.version, model.page!.authorityVersion);
    }} />}
  </View>;
}

function LoadedGrowthHistory({ workspace, archived, selected, onRestore, route, onSelect, onPageChange, searchText, dateRange, onRecord, onTask, onReview, scrollRef, getScrollPosition }: Props & {
  onRestore(concern: ReturnType<typeof growthArchivedConcerns>[number], trigger: View | null): void;
  workspace: GrowthWorkspaceValue; archived: ReturnType<typeof growthArchivedConcerns>; selected: ReturnType<typeof growthArchivedConcerns>[number] | null;
}) {
  const { model } = workspace;
  const restoreControl = useRef<View>(null);
  const listRef = useRef<View>(null), readerRef = useRef<View>(null), localScroll = useRef<ScrollView>(null);
  const page = historyPage(archived, route.page);
  const selectedKey = selected ? historyVersionId(selected.id, selected.version) : null;
  const position = useReaderReturn({ scopeKey: JSON.stringify([workspace.scopeKey, model.access, "history-growth", searchText, dateRange.from, dateRange.to, page.page]),
    selectedId: selectedKey, listRef, readerRef, scrollRef: scrollRef ?? localScroll });
  const close = () => { position.returning(); onSelect(null); };
  const empty = !archived.length && model.online && model.load === "ready";
  return <>
    <View testID="growth-history-index" aria-hidden={!!selected} style={[styles.stack, selected && styles.hidden]}>
      <View ref={listRef} tabIndex={-1} accessibilityLabel="已結束關注清單" style={styles.index}>
        {empty ? <ReadStateNotice state="empty" message={searchText || dateRange.from || dateRange.to ? "沒有符合篩選的關注" : "暫無已結束關注"} /> : null}
        {!archived.length && model.online && model.load === "loading" ? <ReadStateNotice state="loading" message="正在讀取關注歷史…" /> : null}
        {page.items.map(concern => {
          const id = historyVersionId(concern.id, concern.version), date = closedAt(concern.archivedAt);
          return <ReadTargetLink key={id} testID={`growth-history-${concern.id}`} ref={node => position.rowRef(id, node)}
            href={{ pathname: "/history", params: serializeHistoryRoute({ ...route, category: "growth", selectedId: id }) }}
            label={`查看已結束關注：${concern.title}，${date}，版本 ${concern.version}`} style={styles.row}
            onOpen={() => { position.remember(id, getScrollPosition?.()); onSelect(id); }}>
            <Text numberOfLines={2} style={styles.title}>{concern.title}</Text>
            <Text numberOfLines={3} style={styles.body}>{concern.reason}</Text>
            <Text style={styles.meta}>{date} · 版本 {concern.version}</Text>
          </ReadTargetLink>;
        })}
      </View>
      <HistoryPager page={page.page} total={page.total} disabled={model.locked} onChange={onPageChange} />
    </View>
    {selected ? <View testID="growth-history-reader" style={styles.reader}>
      <AppButton label="返回關注歷史清單" variant="quiet" onPress={close} />
      <View ref={readerRef} tabIndex={-1} testID="growth-history-heading" accessibilityLabel={selected.title} style={styles.stack}>
        <Text accessibilityRole="header" aria-level={3} style={styles.heading}>{selected.title}</Text>
        <Text style={styles.meta}>{closedAt(selected.archivedAt)} · 版本 {selected.version}</Text>
      </View>
      <GrowthConcernTimeline headingLevel={4} concern={selected} page={model.page!} onRecord={onRecord} onTask={onTask} onReview={onReview} />
      {model.page!.canManage ? <AppButton ref={restoreControl} label={`恢復關注：${selected.title}`} variant="secondary"
        disabled={model.locked || model.dirty || !growthConcernCanRestore(selected)}
        onPress={() => onRestore(selected, restoreControl.current)} /> : null}
      {model.page!.canManage && !growthConcernCanRestore(selected) ? <Text style={styles.body}>{growthConcernAtCapacity(selected) ? "已達歷史容量限制" : "未取得原狀態，暫未能恢復。"}</Text> : null}
    </View> : null}
  </>;
}
const styles = StyleSheet.create({
  stack: { gap: spacing.md, minWidth: 0 }, index: { minWidth: 0 }, hidden: { display: "none" },
  row: { gap: spacing.xs, minHeight: 48, minWidth: 0, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.line },
  reader: { gap: spacing.lg, width: "100%", maxWidth: 760, alignSelf: "center", minWidth: 0 },
  title: { fontFamily: chineseFont, ...readingType.body, color: colors.ink, fontWeight: "600" },
  heading: { fontFamily: chineseFont, fontSize: 20, lineHeight: 30, color: colors.ink, fontWeight: "700" },
  body: { fontFamily: chineseFont, ...readingType.body, color: colors.ink }, meta: { fontFamily: chineseFont, ...readingType.meta, color: colors.muted },
  warning: { fontFamily: chineseFont, ...readingType.body, color: colors.warningInk },
});
