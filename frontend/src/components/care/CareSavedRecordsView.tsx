import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { careKindOptions, type CareFilter, type CareRecordsActions, type CareRecordsViewModel } from "../../care-view-model";
import { chineseFont, colors, radius, readingType, spacing } from "../../theme";
import { AppButton, AppSelect, AppTextField } from "../ui";
import { AppStatusBadge } from "../AppStatusBadge";
import { ReadStateNotice } from "../ReadStateNotice";
import { CareWriteNotice } from "./CareReviewHistoryView";
import { CareRecordDetail } from "./CareRecordDetail";
import { FormDialog } from "../FormDialog";
import { CareRecordForm } from "./CareRecordForm";
import { CareRecordDelete } from "./CareRecordDelete";
import { HistoryCardGrid, HistoryEntryCard } from "../history/HistoryCards";

// History consumes the same Care owner. The current page replaces, never appends to, the visible list.
export function CareSavedRecordsView(props: { model: CareRecordsViewModel; actions: CareRecordsActions }) { const returnFocus = useRef<View>(null); return <View ref={returnFocus} tabIndex={-1} accessibilityLabel="已保存記錄"><CareWriteNotice {...props} /><CareSavedRecordsBody {...props} history />
  <FormDialog formKey={props.model.draft?.key} visible={!!props.model.draft && props.model.access !== "lost"} scopeKey={props.model.scopeKey ?? props.model.child.id} title="記錄資料" returnFocusRef={returnFocus} onClose={props.actions.closePanel} recovery={<CareWriteNotice {...props} />}>
    {props.model.draft ? <CareRecordForm key={props.model.draft.key} {...props} /> : null}
  </FormDialog></View>; }
export function CareSavedRecordsList(props: { model: CareRecordsViewModel; actions: CareRecordsActions }) { return <CareSavedRecordsBody {...props} inlineDetail={false} />; }
function CareSavedRecordsBody({ model, actions, inlineDetail = true, history = false }: { model: CareRecordsViewModel; actions: CareRecordsActions; inlineDetail?: boolean; history?: boolean }) {
  const [query, setQuery] = useState(model.list.activeQuery), [kind, setKind] = useState<CareFilter>(model.list.activeKind);
  const occupied = ["saving", "unknown"].includes(model.operation.state) || !!model.draft || !!model.deletion;
  const listRef = useRef<View>(null), cardRefs = useRef(new Map<string, View>());
  const context = JSON.stringify([model.scopeKey ?? model.child.id, model.child.id, model.access, model.list.activeQuery, model.list.activeKind, model.list.page ?? 1]);
  const anchor = useRef<{ id: string; context: string } | null>(null);
  const pendingReturn = useRef<{ anchor: NonNullable<typeof anchor.current>; focus: Element | null; moved: boolean; stop(): void } | null>(null);
  const cancelReturn = () => { pendingReturn.current?.stop(); pendingReturn.current = null; };
  useLayoutEffect(() => () => cancelReturn(), []);
  useLayoutEffect(() => {
    if (!history || !inlineDetail || model.access === "lost" || anchor.current?.context !== context) { cancelReturn(); anchor.current = null; return; }
    const request = pendingReturn.current;
    if (!request) return;
    if (occupied || request.anchor !== anchor.current || model.detail && model.detail.record.id !== request.anchor.id) { cancelReturn(); return; }
    if (model.detail) return; // The owner, not the click, decides when detail has closed.
    cancelReturn();
    if (request.moved || Platform.OS !== "web" || typeof document === "undefined") return;
    const active = document.activeElement;
    if (active?.isConnected && active !== document.body && active !== document.documentElement && active !== request.focus) return;
    for (const node of [cardRefs.current.get(request.anchor.id), listRef.current]) {
      const target = node as unknown as HTMLElement | null;
      if (!target?.isConnected || !target.getClientRects().length || target.closest?.('[hidden], [inert], [aria-hidden="true"]')) continue;
      if (typeof window !== "undefined" && ["hidden", "collapse"].includes(window.getComputedStyle(target).visibility)) continue;
      try { target.focus({ preventScroll: true }); } catch { continue; }
      if (document.activeElement === target) break;
    }
  }, [history, inlineDetail, context, model.detail, occupied]);
  const returnToList = () => {
    cancelReturn();
    if (anchor.current?.context === context && anchor.current.id === model.detail?.record.id && !occupied && Platform.OS === "web" && typeof document !== "undefined") {
      const request = { anchor: anchor.current, focus: document.activeElement, moved: false, stop: () => {} };
      const onFocus = (event: FocusEvent) => { if (event.target !== request.focus) request.moved = true; };
      document.addEventListener?.("focusin", onFocus, true);
      request.stop = () => document.removeEventListener?.("focusin", onFocus, true);
      pendingReturn.current = request;
    }
    actions.closePanel();
  };
  const loading = ["loading", "loading_more"].includes(model.list.state);
  const hasSnapshot = model.list.hasSnapshot ?? model.list.records.length > 0;
  const filtered = !!model.list.activeQuery.trim() || model.list.activeKind !== "all";
  const empty = model.online && model.list.state === "ready" && !model.list.records.length && model.list.message === null;
  const showSearch = !empty || filtered || !!query.trim() || kind !== "all" || model.list.hasPrevious || model.list.hasMore;
  const readState = !model.list.records.length && !model.online ? "stale" : loading && (!hasSnapshot || !model.list.records.length) ? "loading" : model.list.state === "error" ? "error" : model.list.state === "stale" ? hasSnapshot ? "stale" : "unavailable" : model.list.message ? "unavailable" : model.list.records.length ? "ready" : "empty";
  const readMessage = model.list.message ?? (!model.list.records.length && !model.online ? "目前離線，記錄尚未核對。" : loading && (!hasSnapshot || !model.list.records.length) ? "正在讀取記錄…" : model.list.state === "error" ? "未能讀取記錄，請重試。" : model.list.state === "stale" ? model.online ? "記錄尚待重新核對。" : "目前離線，記錄尚未核對。" : empty ? filtered ? "沒有符合篩選的已保存記錄" : model.list.hasMore || model.list.hasPrevious ? "此頁暫無已保存記錄" : "暫無已保存記錄" : "");
  if (model.access === "lost") return <ReadStateNotice state="unavailable" message="目前沒有權限查看這個孩子的記錄。" />;
  if (inlineDetail && model.deletion) return <CareRecordDelete model={model} actions={actions} />;
  if (inlineDetail && model.detail) return <CareRecordDetail detail={model.detail} actions={actions} canEdit={model.access === "editable"} online={model.online} onReturnToList={history ? returnToList : undefined} />;
  return <View ref={history ? listRef : undefined} tabIndex={history ? -1 : undefined} accessibilityLabel={history ? "已保存照顧記錄清單" : undefined} testID={history ? "care-history-list" : undefined} style={s.workspace}>
    {showSearch ? <><AppTextField label="搜尋已保存記錄" accessibilityLabel="搜尋已保存記錄" value={query} onChangeText={setQuery} maxLength={200} disabled={occupied} />
    <View style={s.controls}><View style={s.filter}><AppSelect<CareFilter> label="種類" value={kind} options={[{ value: "all", label: "全部" }, ...careKindOptions]} onChange={setKind} disabled={occupied} /></View>
      <AppButton label="搜尋" density="compact" disabled={occupied || loading || !model.online} onPress={() => actions.search(query, kind)} /></View></> : null}
    <ReadStateNotice state={readState} message={readMessage}>
      {(model.list.state === "error" || model.list.state === "stale") ? <AppButton label="重新讀取記錄" density="compact" variant="quiet" disabled={occupied || loading || !model.online} onPress={() => actions.search(model.list.activeQuery, model.list.activeKind)} /> : null}
      {empty && filtered ? <AppButton label="清除篩選" variant="quiet" density="compact" disabled={occupied || loading || !model.online} onPress={() => { if (occupied || loading || !model.online) return; setQuery(""); setKind("all"); actions.search("", "all"); }} /> : null}
    </ReadStateNotice>
    <SavedRecordsGrid history={history}>{(loading && !hasSnapshot ? [] : model.list.records).map(record => {
      const content = <><Text numberOfLines={history ? 2 : undefined} style={s.title}>{record.title}</Text><Text numberOfLines={history ? 3 : 2} style={s.body}>{record.current.values.text}</Text>
        <AppStatusBadge label={record.current.version > 1 ? "已更正" : "已保存"} tone="success" />{history ? <Text style={s.meta}>{record.current.confirmedAtLabel ?? "確認時間未知"} · 版本 {record.current.version}</Text> : null}</>;
      return history ? <HistoryEntryCard key={record.id} testID={`care-history-card-${record.id}`} cardRef={node => { if (node) cardRefs.current.set(record.id, node); else cardRefs.current.delete(record.id); }} accessibilityLabel={`查看${record.title}`} disabled={occupied || loading} preserveFocusWhenDisabled={loading && hasSnapshot && !occupied} onPress={() => { cancelReturn(); anchor.current = { id: record.id, context }; actions.openRecord(record.id); }} style={s.historyCard}>{content}</HistoryEntryCard>
        : <Pressable key={record.id} accessibilityRole="button" accessibilityLabel={`查看${record.title}`} disabled={occupied || loading} onPress={() => actions.openRecord(record.id)} style={s.row}>{content}</Pressable>;
    })}</SavedRecordsGrid>
    {model.list.hasPrevious || model.list.hasMore ? <View style={s.controls}><AppButton label="上一頁" density="compact" variant="secondary" onPress={() => actions.previousPage?.()} disabled={occupied || loading || !model.online || !model.list.hasPrevious || !actions.previousPage} /><Text style={s.meta}>第 {model.list.page ?? 1} 頁</Text><AppButton label="下一頁" density="compact" variant="secondary" onPress={actions.loadMore} disabled={occupied || loading || !model.online || !model.list.hasMore || model.list.state === "stale"} /></View> : null}
  </View>;
}
function SavedRecordsGrid({ history, children }: { history: boolean; children: ReactNode }) { return history ? <HistoryCardGrid testID="care-history-cards">{children}</HistoryCardGrid> : <>{children}</>; }
const s = StyleSheet.create({ historyCard: { padding: spacing.md, borderRadius: radius.medium }, workspace: { gap: spacing.md }, controls: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" }, filter: { flexGrow: 1, minWidth: 0 }, row: { padding: spacing.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.controlSurface, gap: spacing.sm }, title: { fontFamily: chineseFont, ...readingType.tool, fontWeight: "700", color: colors.ink }, body: { fontFamily: chineseFont, ...readingType.tool, color: colors.ink }, meta: { fontFamily: chineseFont, ...readingType.meta, color: colors.muted } });
