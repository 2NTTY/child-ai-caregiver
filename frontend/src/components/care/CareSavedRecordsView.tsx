import { ReadTargetLink } from "../ReadTargetLink";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Platform, StyleSheet, View, type ScrollView } from "react-native";
import { Text } from "react-native-paper";
import { careKindOptions, type CareFilter, type CareRecordsActions, type CareRecordView, type CareRecordsViewModel } from "../../care-view-model";
import { chineseFont, colors, readingType, spacing } from "../../theme";
import { AppButton, AppSelect, AppTextField } from "../ui";
import { AppStatusBadge } from "../AppStatusBadge";
import { ReadStateNotice } from "../ReadStateNotice";
import { CareWriteNotice } from "./CareReviewHistoryView";
import { CareRecordDetail } from "./CareRecordDetail";
import { FormDialog } from "../FormDialog";
import { CareRecordForm } from "./CareRecordForm";
import { CareRecordDelete } from "./CareRecordDelete";
import { serializeHistoryRoute, type HistoryRouteState } from "../../navigation/route-state";
import { useReaderPosition } from "../../navigation/ReaderPosition";
import { useReaderReturn } from "../../navigation/useReaderReturn";

function recordReadLabel(record: CareRecordView) {
  const original = record.current.values.text || record.title;
  const points = Array.from(original.replace(/\s+/g, " ").trim());
  const excerpt = points.slice(0, 100).join("") + (points.length > 100 ? "…" : "");
  return `查看記錄：${excerpt}${original !== record.title ? `，${record.title}` : ""}，家庭共享，${record.current.values.eventTimeRaw || "事件時間未知"}，${record.current.version > 1 ? "已更正" : "已保存"}`;
}

// History and active Care share the same loaded index and original owner, not a second reader owner.
type HistoryReading = { route: HistoryRouteState; onPageChange(page: number): void; scrollRef?: RefObject<ScrollView | null>; getScrollPosition?(): number };
export function CareSavedRecordsView({ model, actions, route, onPageChange, scrollRef, getScrollPosition }: { model: CareRecordsViewModel; actions: CareRecordsActions } & HistoryReading) {
  const listRef = useRef<View>(null), readerRef = useRef<View>(null), localScroll = useRef<ScrollView>(null);
  const positionScope = JSON.stringify([model.scopeKey, model.child.id, model.access, "history-care", model.list.activeQuery, model.list.activeKind, route.page]);
  const authority = useReaderPosition(), unavailableRef = useRef<View>(null);
  const signature = JSON.stringify([positionScope, route.selectedId]);
  const savedFocus = useRef<{ signature: string; authority: typeof authority.actions; mode: "revise" | "delete"; id: string; version: number; priorReference: string | null; reference: string | null; trigger: HTMLElement | null } | null>(null);
  const selected = model.detail?.record.id === route.selectedId ? model.detail : null;
  const available = model.access !== "lost", editorVisible = available && !!(model.draft || model.deletion);
  const showReader = available && !!selected;
  const position = useReaderReturn({ scopeKey: positionScope,
    selectedId: showReader ? selected!.record.id : null, enabled: available && !editorVisible && (!route.selectedId || showReader), listRef, readerRef, scrollRef: scrollRef ?? localScroll });
  const close = () => { position.returning(); actions.closePanel(); };
  const submit = (mode: "revise" | "delete") => {
    const basis = mode === "delete" ? model.deletion?.basis : model.draft?.mode === "revise" ? model.draft.basis : null;
    if (basis && basis.id === route.selectedId && model.operation.state === "needs_confirmation" && authority.meta.isCurrent()) {
      savedFocus.current = { signature, authority: authority.actions, mode, id: basis.id, version: basis.current.version, priorReference: model.operation.reference, reference: null,
        trigger: Platform.OS === "web" ? document.activeElement as HTMLElement : null };
    }
    if (mode === "delete") actions.submitDeletion(); else actions.submitReviewed();
  };
  useEffect(() => {
    const intent = savedFocus.current;
    if (!intent) return;
    if (intent.signature !== signature || intent.authority !== authority.actions || !authority.meta.isCurrent() || !available) { savedFocus.current = null; return; }
    const operation = model.operation;
    if (operation.state === "saving" && operation.reference && operation.reference !== intent.priorReference) intent.reference = operation.reference;
    else if (!["saving", "unknown", "saved"].includes(operation.state)) savedFocus.current = null;
  }, [signature, authority, model.operation, available]);
  const restoreSavedFocus = () => {
    const intent = savedFocus.current; savedFocus.current = null;
    if (!intent || intent.signature !== signature || intent.authority !== authority.actions || !authority.meta.isCurrent() || !available || editorVisible) return;
    const operation = model.operation;
    const matchingReceipt = operation.state === "saved" && !!operation.reference && operation.reference !== intent.priorReference
      && (!intent.reference || operation.reference === intent.reference)
      && (intent.mode === "delete" ? operation.kind === "delete" : operation.kind !== "delete" && operation.kind !== "review");
    const published = intent.mode === "delete" ? !model.detail && !model.list.records.some(record => record.id === intent.id)
      : selected?.record.id === intent.id && selected.record.current.version > intent.version;
    if (!matchingReceipt || !published) return;
    const target = intent.mode === "delete" ? unavailableRef.current : readerRef.current;
    if (Platform.OS === "web") {
      if (!intent.trigger || intent.trigger.isConnected || document.activeElement !== document.body) return;
      (target as unknown as HTMLElement | null)?.focus({ preventScroll: true });
    } else target?.focus();
  };
  const panelActions = { ...actions, closePanel: close, submitReviewed: () => submit("revise"), submitDeletion: () => submit("delete") };
  const readerKey = useRef<string | null>(null);
  if (selected && !editorVisible) readerKey.current = `${model.scopeKey ?? model.child.id}:${selected.record.id}`;
  if (!available) return <ReadStateNotice state="unavailable" message="目前沒有權限查看這個孩子的記錄。" />;
  return <View accessibilityLabel="已保存記錄" style={s.workspace}>
    <CareWriteNotice model={model} actions={actions} />
    <SavedRecordsReadNotice model={model} actions={actions} selectedId={route.selectedId} />
    <View testID="care-history-index" aria-hidden={!!route.selectedId} style={[s.workspace, !!route.selectedId && s.hidden]}>
      <View ref={listRef} tabIndex={-1} testID="care-history-list" accessibilityLabel="已保存照顧記錄清單">
        <CareSavedRecordsBody model={model} actions={{ ...actions, openRecord: id => { position.remember(id, getScrollPosition?.()); actions.openRecord(id); } }}
          rowRef={position.rowRef} requestedPage={route.page} onPageChange={onPageChange}
          rowHref={id => ({ pathname: "/history", params: serializeHistoryRoute({ ...route, category: "care", selectedId: id }) })} />
      </View>
    </View>
    {route.selectedId ? <View testID="care-history-reader" style={s.reader}>
      {showReader ? <CareRecordDetail detail={selected!} actions={actions} canEdit={model.access === "editable"} online={model.online} reading={["loading", "loading_more"].includes(model.list.state)} active={false} headingLevel={3} headingRef={readerRef} onReturnToList={close} />
        : <><AppButton ref={unavailableRef} label="返回記錄清單" variant="quiet" onPress={close} />
          <ReadStateNotice state={model.detailRead?.id === route.selectedId && model.detailRead.state === "loading" ? "loading" : "unavailable"} message={model.detailRead?.id === route.selectedId && model.detailRead.state === "loading" ? "正在讀取所選記錄…" : "目前未能讀取所選記錄，沒有代選其他內容。"} /></>}
    </View> : null}
    <FormDialog visible={editorVisible} scopeKey={model.scopeKey ?? model.child.id} formKey={model.draft?.key ?? readerKey.current ?? undefined}
      title={model.deletion ? "刪除照顧記錄" : "記錄資料"} returnFocusRef={position.returnFocusRef} fallbackFocusRef={listRef} onClose={close} onClosed={restoreSavedFocus}
      closeOutcome={{ revision: model, ready: !model.detail && !model.draft && !model.deletion && model.operation.state === "none" }} recovery={<CareWriteNotice model={model} actions={actions} />}>
      {model.draft ? <CareRecordForm key={model.draft.key} model={model} actions={panelActions} /> : model.deletion ? <CareRecordDelete model={model} actions={panelActions} /> : null}
    </FormDialog>
  </View>;
}
type ActiveSearch = { rowRef?: (id: string, node: View | null) => void; searchText?: string; onSearchText?: (value: string) => void };
export function CareSavedRecordsList(props: { model: CareRecordsViewModel; actions: CareRecordsActions } & ActiveSearch) {
  return <CareSavedRecordsBody {...props} readNotice={<SavedRecordsReadNotice model={props.model} actions={props.actions} />} />;
}
function savedReadState(model: CareRecordsViewModel) {
  const loading = ["loading", "loading_more"].includes(model.list.state), hasSnapshot = model.list.hasSnapshot ?? model.list.records.length > 0;
  const filtered = !!model.list.activeQuery.trim() || model.list.activeKind !== "all";
  const empty = model.online && (model.list.state === "ready" || loading && hasSnapshot) && !model.list.records.length && model.list.message === null;
  const readState = !model.list.records.length && !model.online ? "stale" : loading && !hasSnapshot ? "loading" : model.list.state === "error" ? "error" : model.list.state === "stale" ? hasSnapshot ? "stale" : "unavailable" : model.list.message ? "unavailable" : model.list.records.length ? "ready" : "empty";
  const readMessage = model.list.message ?? (!model.list.records.length && !model.online ? "目前離線，記錄尚未核對。" : loading && !hasSnapshot ? "正在讀取記錄…" : model.list.state === "error" ? "未能讀取記錄，請重試。" : model.list.state === "stale" ? model.online ? "記錄尚待重新核對。" : "目前離線，記錄尚未核對。" : empty ? filtered ? "沒有符合篩選的已保存記錄" : model.list.hasMore || model.list.hasPrevious ? "此頁暫無已保存記錄" : "暫無已保存記錄" : "");
  return { loading, hasSnapshot, filtered, empty, readState, readMessage } as const;
}
function SavedRecordsReadNotice({model, actions, selectedId}: {model: CareRecordsViewModel; actions: CareRecordsActions; selectedId?: string | null}) {
  const {loading, readState, readMessage} = savedReadState(model);
  const occupied = ["saving", "unknown"].includes(model.operation.state) || !!model.draft || !!model.deletion;
  return <ReadStateNotice state={selectedId && readState === "empty" ? "ready" : readState} message={readMessage}>
    {(model.list.state === "error" || model.list.state === "stale") ? <AppButton label="重新讀取記錄" density="compact" variant="quiet" disabled={occupied || loading || !model.online} onPress={() => actions.search(model.list.activeQuery, model.list.activeKind)} /> : null}
  </ReadStateNotice>;
}
function CareSavedRecordsBody({ model, actions, requestedPage, onPageChange, searchText, onSearchText, rowRef, rowHref, readNotice }: {
  model: CareRecordsViewModel; actions: CareRecordsActions; requestedPage?: number; onPageChange?(page: number): void;
  rowHref?(id: string): { pathname: "/history"; params: ReturnType<typeof serializeHistoryRoute> }; readNotice?: ReactNode;
} & ActiveSearch) {
  const [localQuery, setLocalQuery] = useState(model.list.activeQuery), [kind, setKind] = useState<CareFilter>(model.list.activeKind);
  const query = searchText ?? localQuery, setQuery = onSearchText ?? setLocalQuery;
  const occupied = ["saving", "unknown"].includes(model.operation.state) || !!model.draft || !!model.deletion;
  const acceptedPage = Math.max(0, (model.list.page ?? 1) - 1), pageMismatch = requestedPage !== undefined && requestedPage !== acceptedPage;
  const { loading, hasSnapshot, filtered, empty } = savedReadState(model);
  const showSearch = !empty || filtered || !!query.trim() || kind !== "all" || model.list.hasPrevious || model.list.hasMore;
  if (model.access === "lost") return <ReadStateNotice state="unavailable" message="目前沒有權限查看這個孩子的記錄。" />;
  return <View style={s.workspace}>
    {showSearch ? <View style={s.searchDesk}><View style={s.searchField}><AppTextField label="搜尋已保存記錄" accessibilityLabel="搜尋已保存記錄" value={query} onChangeText={setQuery} maxLength={200} disabled={occupied} /></View>
    <View style={s.controls}><View style={s.filter}><AppSelect<CareFilter> label="種類" value={kind} options={[{ value: "all", label: "全部" }, ...careKindOptions]} onChange={setKind} disabled={occupied} /></View>
      <AppButton label="搜尋" density="compact" disabled={occupied || loading || !model.online} onPress={() => actions.search(query, kind)} /></View></View> : null}
    {readNotice}
    {empty && filtered ? <AppButton label="清除篩選" variant="quiet" density="compact" disabled={occupied || loading || !model.online} onPress={() => { if (occupied || loading || !model.online) return; setQuery(""); setKind("all"); actions.search("", "all"); }} /> : null}
    {pageMismatch ? <ReadStateNotice state={loading ? "loading" : "unavailable"} message={loading ? `正在讀取第 ${requestedPage! + 1} 頁…` : `第 ${requestedPage! + 1} 頁尚未有可用游標，沒有以其他頁面代替。`}>
      {!loading && onPageChange ? <AppButton label={`返回已讀取的第 ${acceptedPage + 1} 頁`} variant="secondary" onPress={() => onPageChange(acceptedPage)} /> : null}
    </ReadStateNotice> : null}
    <View style={s.recordGrid}>{(pageMismatch || loading && !hasSnapshot ? [] : model.list.records).map(record => <ReadTargetLink key={record.id} ref={node => rowRef?.(record.id, node)} testID={`care-saved-card-${record.id}`}
      href={rowHref?.(record.id) ?? { pathname: "/care", params: { tab: "records", recordId: record.id } }} label={recordReadLabel(record)}
      availability={loading && hasSnapshot && !occupied ? "refreshing" : occupied || loading ? "unavailable" : "ready"} onOpen={() => actions.openRecord(record.id)} style={s.indexRow}>
      <Text numberOfLines={2} style={s.recordText}>{record.current.values.text || record.title}</Text>
      <View style={s.recordLabels}><Text style={s.meta}>{record.title}</Text><AppStatusBadge label={record.current.version > 1 ? "已更正" : "已保存"} tone="success" /></View>
      <Text style={s.meta}>{record.current.values.eventTimeRaw || "事件時間未知"} · 家庭共享 · 版本 {record.current.version}</Text>
    </ReadTargetLink>)}</View>
    {!pageMismatch && (model.list.hasPrevious || model.list.hasMore) ? <View style={s.controls}><AppButton label="上一頁" density="compact" variant="secondary" onPress={() => onPageChange ? onPageChange(acceptedPage - 1) : actions.previousPage?.()} disabled={occupied || loading || !model.online || !model.list.hasPrevious || !actions.previousPage} /><Text style={s.meta}>第 {model.list.page ?? 1} 頁</Text><AppButton label="下一頁" density="compact" variant="secondary" onPress={() => onPageChange ? onPageChange(acceptedPage + 1) : actions.loadMore()} disabled={occupied || loading || !model.online || !model.list.hasMore || model.list.state === "stale"} /></View> : null}
  </View>;
}
const s = StyleSheet.create({ indexRow: { minWidth: 0, minHeight: 48, paddingVertical: spacing.md, gap: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.line, borderRadius: 0 }, hidden: { display: "none" }, reader: { gap: spacing.lg, width: "100%", maxWidth: 760, alignSelf: "center", minWidth: 0 }, searchDesk: { gap: spacing.sm, paddingBottom: spacing.md }, searchField: { minWidth: 0 }, recordGrid: { gap: 0 }, workspace: { gap: spacing.md, minWidth: 0 }, controls: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" }, filter: { flexGrow: 1, minWidth: 0 }, recordLabels: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: spacing.sm }, recordText: { fontFamily: chineseFont, ...readingType.body, color: colors.ink }, meta: { fontFamily: chineseFont, ...readingType.meta, color: colors.muted } });
