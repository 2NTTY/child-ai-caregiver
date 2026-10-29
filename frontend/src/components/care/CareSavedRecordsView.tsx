import { Link, type Href } from "expo-router";
import type { HistoryCareNavigation } from "../../navigation/useHistoryCareRoute";
import { PreviewLink } from "../../preview/PreviewNavigationGuard";
import { useRef, useState, type ReactNode, type Ref } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { careKindOptions, type CareFilter, type CareRecordsActions, type CareRecordsViewModel } from "../../care-view-model";
import { chineseFont, colors, readingType, spacing } from "../../theme";
import { AppButton, AppSelect, AppTextField } from "../ui";
import { AppStatusBadge } from "../AppStatusBadge";
import { AppIcon } from "../AppIcon";
import { useQuietReadFocus } from "../useQuietReadFocus";
import { ReadStateNotice } from "../ReadStateNotice";
import { CareWriteNotice } from "./CareReviewHistoryView";
import { CareRecordDetail } from "./CareRecordDetail";
import { FormDialog } from "../FormDialog";
import { CareRecordForm } from "./CareRecordForm";
import { CareRecordDelete } from "./CareRecordDelete";
import { HistoryCardGrid } from "../history/HistoryCards";

// History consumes the same Care owner. The current page replaces, never appends to, the visible list.
export function CareSavedRecordsView(props: { model: CareRecordsViewModel; actions: CareRecordsActions; navigation: HistoryCareNavigation }) { return <View accessibilityLabel="已保存記錄"><CareWriteNotice {...props} /><CareSavedRecordsBody {...props} history /></View>; }
export function CareSavedRecordsList(props: { model: CareRecordsViewModel; actions: CareRecordsActions; recordHref?(id: string): Href }) { return <CareSavedRecordsBody {...props} inlineDetail={false} />; }
function CareSavedRecordsBody({ model, actions: ownerActions, navigation, recordHref, inlineDetail = true, history = false }: { model: CareRecordsViewModel; actions: CareRecordsActions; navigation?: HistoryCareNavigation; recordHref?(id: string): Href; inlineDetail?: boolean; history?: boolean }) {
  const actions = navigation ? { ...ownerActions, closePanel: navigation.close } : ownerActions;
  const detail = !history || navigation?.recordId === model.detail?.record.id ? model.detail : null;
  const missing = history && !!navigation?.recordId && !detail && !model.draft && !model.deletion;
  const [query, setQuery] = useState(model.list.activeQuery), [kind, setKind] = useState<CareFilter>(model.list.activeKind);
  const occupied = ["saving", "unknown"].includes(model.operation.state) || !!model.draft || !!model.deletion;
  const listRef = useRef<View>(null), cardRefs = useRef(new Map<string, View>());
  const context = JSON.stringify([model.scopeKey ?? model.child.id, model.child.id, model.access, model.list.activeQuery, model.list.activeKind, model.list.page ?? 1]);
  const anchor = useRef<{ id: string; context: string } | null>(null);
  const returnFocusRef = useRef<View | null>(null);
  returnFocusRef.current = anchor.current?.context === context ? cardRefs.current.get(anchor.current.id) ?? null : null;
  // Keep one modal focus owner across reading, correction and deletion.
  const readerKey = useRef<string | null>(null);
  if (history && detail && !model.draft && !model.deletion) readerKey.current = `${model.scopeKey ?? model.child.id}:${detail.record.id}`;
  const dialogVisible = history && model.access !== "lost" && !!(detail || model.draft || model.deletion);
  const loading = ["loading", "loading_more"].includes(model.list.state);
  const hasSnapshot = model.list.hasSnapshot ?? model.list.records.length > 0;
  const filtered = !!model.list.activeQuery.trim() || model.list.activeKind !== "all";
  const empty = model.online && (model.list.state === "ready" || loading && hasSnapshot) && !model.list.records.length && model.list.message === null;
  const showSearch = !empty || filtered || !!query.trim() || kind !== "all" || model.list.hasPrevious || model.list.hasMore;
  const readState = !model.list.records.length && !model.online ? "stale" : loading && !hasSnapshot ? "loading" : model.list.state === "error" ? "error" : model.list.state === "stale" ? hasSnapshot ? "stale" : "unavailable" : model.list.message ? "unavailable" : model.list.records.length ? "ready" : "empty";
  const readMessage = model.list.message ?? (!model.list.records.length && !model.online ? "目前離線，記錄尚未核對。" : loading && !hasSnapshot ? "正在讀取記錄…" : model.list.state === "error" ? "未能讀取記錄，請重試。" : model.list.state === "stale" ? model.online ? "記錄尚待重新核對。" : "目前離線，記錄尚未核對。" : empty ? filtered ? "沒有符合篩選的已保存記錄" : model.list.hasMore || model.list.hasPrevious ? "此頁暫無已保存記錄" : "暫無已保存記錄" : "");
  if (model.access === "lost") return <ReadStateNotice state="unavailable" message="目前沒有權限查看這個孩子的記錄。" />;
  if (!history && inlineDetail && model.deletion) return <CareRecordDelete model={model} actions={actions} />;
  if (!history && inlineDetail && model.detail) return <CareRecordDetail detail={model.detail} actions={actions} canEdit={model.access === "editable"} online={model.online} />;
  return <><View ref={history ? listRef : undefined} tabIndex={history ? -1 : undefined} accessibilityLabel={history ? "已保存照顧記錄清單" : undefined} testID={history ? "care-history-list" : undefined} style={s.workspace}>
    {missing && navigation ? <ReadStateNotice state={navigation.waiting ? "unavailable" : model.detailRead?.id === navigation.recordId && model.detailRead.state === "error" ? "error" : "loading"}
      message={navigation.waiting ? "先查核原操作，再讀取所選記錄。" : model.detailRead?.id === navigation.recordId && model.detailRead.state === "error" ? "這項記錄暫不能開啟；沒有顯示另一筆內容。" : "正在讀取所選記錄…"}>
      <AppButton label="重新核對所選記錄" variant="secondary" disabled={!model.online || occupied || navigation.waiting} onPress={navigation.retry} />
      <AppButton label="返回記錄清單" variant="quiet" disabled={occupied || navigation.waiting} onPress={navigation.close} />
    </ReadStateNotice> : null}
    {showSearch ? <View style={s.searchToolbar}><View style={s.searchField}><AppTextField label="搜尋已保存記錄" accessibilityLabel="搜尋已保存記錄" placeholder="記錄內容或來源…" value={query} onChangeText={setQuery} maxLength={200} disabled={occupied} /></View>
    <View style={s.controls}><View style={s.filter}><AppSelect<CareFilter> label="種類" value={kind} options={[{ value: "all", label: "全部" }, ...careKindOptions]} onChange={setKind} disabled={occupied} /></View>
      <AppButton label="搜尋" density="compact" disabled={occupied || loading || !model.online} onPress={() => actions.search(query, kind)} /></View></View> : null}
    <ReadStateNotice state={readState} message={readMessage}>
      {(model.list.state === "error" || model.list.state === "stale") ? <AppButton label="重新讀取記錄" density="compact" variant="quiet" disabled={occupied || loading || !model.online} onPress={() => actions.search(model.list.activeQuery, model.list.activeKind)} /> : null}
      {empty && filtered ? <AppButton label="清除篩選" variant="quiet" density="compact" disabled={occupied || loading || !model.online} onPress={() => { if (occupied || loading || !model.online) return; setQuery(""); setKind("all"); actions.search("", "all"); }} /> : null}
    </ReadStateNotice>
    <SavedRecordsGrid history={history}>{(loading && !hasSnapshot ? [] : model.list.records).map(record => {
      const content = <><Text numberOfLines={history ? 2 : undefined} style={s.title}>{record.title}</Text><Text numberOfLines={history ? 3 : 2} style={s.body}>{record.current.values.text}</Text>
        <AppStatusBadge label={record.current.version > 1 ? "已更正" : "已保存"} tone="success" />{history ? <Text style={s.meta}>{record.current.confirmedAtLabel ?? "確認時間未知"} · 版本 {record.current.version}</Text> : null}</>;
      return history ? navigation ? <HistorySavedRecordLink key={record.id} id={record.id} testID={`care-history-card-${record.id}`} href={navigation.href(record.id)} cardRef={node => { if (node) cardRefs.current.set(record.id, node); else cardRefs.current.delete(record.id); }} label={`查看${record.title}`} disabled={occupied || loading || navigation.waiting} quietRefresh={loading && hasSnapshot && !occupied}
        onActivate={() => navigation.open(record.id, () => { anchor.current = { id: record.id, context }; returnFocusRef.current = cardRefs.current.get(record.id) ?? null; })}>{content}</HistorySavedRecordLink> : null
        : <SavedRecordCard key={record.id} id={record.id} href={recordHref?.(record.id)} label={savedRecordAccessibilityLabel(record.current.values.text || record.title)} disabled={occupied || loading} quietRefresh={loading && hasSnapshot && !occupied} onPress={() => actions.openRecord(record.id)}>
          <View style={s.recordLabels}>{record.current.values.text ? <Text style={s.recordKind}>{record.title}</Text> : null}<AppStatusBadge label={record.current.version > 1 ? "已更正" : "已保存"} tone="success" /></View>
          <Text numberOfLines={3} style={s.recordText}>{record.current.values.text || record.title}</Text>
          <View style={s.recordLabels}><AppIcon name="clock-outline" size={14} /><Text accessibilityLabel={`確認時間：${record.current.confirmedAtLabel ?? "未知"}`} style={[s.meta, { flex: 1 }]}>{record.current.confirmedAtLabel == null ? "確認時間未知" : `確認於 ${record.current.confirmedAtLabel}`}</Text></View>
        </SavedRecordCard>;
    })}</SavedRecordsGrid>
    {model.list.hasPrevious || model.list.hasMore ? <View style={s.controls}><AppButton label="上一頁" density="compact" variant="secondary" onPress={() => actions.previousPage?.()} disabled={occupied || loading || !model.online || !model.list.hasPrevious || !actions.previousPage} /><Text style={s.meta}>第 {model.list.page ?? 1} 頁</Text><AppButton label="下一頁" density="compact" variant="secondary" onPress={actions.loadMore} disabled={occupied || loading || !model.online || !model.list.hasMore || model.list.state === "stale"} /></View> : null}
  </View>
    {history ? <FormDialog key={readerKey.current} dismissMode={model.draft || model.deletion ? "guarded" : "local"} formKey={model.draft?.key ?? readerKey.current ?? undefined} visible={dialogVisible} scopeKey={model.scopeKey ?? model.child.id}
      title={model.draft ? "記錄資料" : model.deletion ? "刪除照顧記錄" : "照顧記錄詳情"} returnFocusRef={returnFocusRef} fallbackFocusRef={!anchor.current || anchor.current.context === context ? listRef : undefined} onClose={actions.closePanel}
      closeOutcome={{ revision: model, ready: !detail && !model.draft && !model.deletion && model.operation.state === "none" }} recovery={<CareWriteNotice model={model} actions={actions} />}>
      {model.draft ? <CareRecordForm key={model.draft.key} model={model} actions={actions} /> : model.deletion ? <CareRecordDelete model={model} actions={actions} /> : detail ? <CareRecordDetail detail={detail} actions={actions} canEdit={model.access === "editable"} online={model.online} reading={loading} active={false} onReturnToList={actions.closePanel} /> : null}
    </FormDialog> : null}
  </>;
}
type SavedRecordRowProps = { id: string; label: string; disabled: boolean; quietRefresh: boolean; cardRef?: Ref<View>; testID?: string; children: ReactNode };
function useSavedRecordControl({ id, label, disabled, quietRefresh, cardRef, testID, children }: SavedRecordRowProps, role: "link" | "button", onPress?: () => void) {
  const readFocus = useQuietReadFocus(disabled, quietRefresh);
  const [focused, setFocused] = useState(false), [hovered, setHovered] = useState(false), [pressed, setPressed] = useState(false);
  return <Pressable ref={node => { readFocus.host.current = node; if (typeof cardRef === "function") return cardRef(node); else if (cardRef) cardRef.current = node; }} testID={testID ?? `care-saved-card-${id}`} accessibilityRole={role} accessibilityLabel={label}
    accessibilityState={{ disabled }} aria-disabled={disabled} disabled={role === "link" && Platform.OS === "web" ? disabled : readFocus.nativeDisabled} onPress={role === "link" ? undefined : () => { if (!disabled) onPress?.(); }}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
    style={StyleSheet.flatten([s.row, focused && s.focused, (pressed || hovered) && !disabled && s.pressed])}>{children}</Pressable>;
}
function SavedRecordCard({ href, onPress, ...props }: SavedRecordRowProps & { href?: Href; onPress(): void }) {
  const row = useSavedRecordControl(props, href ? "link" : "button", onPress);
  // RN Web maps disabled anchors to aria-disabled, not a native disabled button.
  // Keep the real link host stable through quiet refresh; PreviewLink checks both
  // current and captured disabled state while preserving modified-click semantics.
  return href ? <PreviewLink href={href} disabled={props.disabled}>{row}</PreviewLink> : row;
}
/** History selection belongs to its original-owner adapter, including deferred guard admission. */
function HistorySavedRecordLink({ href, onActivate, ...props }: SavedRecordRowProps & { href: Href; onActivate(): void }) {
  const row = useSavedRecordControl(props, "link");
  const currentDisabled = useRef(props.disabled); currentDisabled.current = props.disabled;
  return <Link href={href} asChild onPress={event => {
    if (props.disabled || currentDisabled.current) { event.preventDefault(); return; }
    type Click = { defaultPrevented?: boolean; button?: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean };
    const click = event as unknown as Click & { nativeEvent?: Click };
    if (Platform.OS === "web" && [click, click.nativeEvent].some(value => value && (value.defaultPrevented || value.metaKey || value.ctrlKey || value.shiftKey || value.altKey || value.button !== undefined && value.button !== 0))) return;
    event.preventDefault(); onActivate();
  }}>{row}</Link>;
}
function savedRecordAccessibilityLabel(text: string) { const characters = Array.from(text); return `查看${characters.slice(0, 100).join("")}${characters.length > 100 ? "…" : ""}`; }
function SavedRecordsGrid({ history, children }: { history: boolean; children: ReactNode }) { return history ? <HistoryCardGrid testID="care-history-cards">{children}</HistoryCardGrid> : <>{children}</>; }
const s = StyleSheet.create({
  workspace: { gap: spacing.md, minWidth: 0 },
  searchToolbar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.line },
  searchField: { flexGrow: 1, flexBasis: 240, minWidth: 0, maxWidth: "100%" },
  controls: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center", maxWidth: "100%" }, filter: { flexGrow: 1, minWidth: 0 },
  row: { minWidth: 0, paddingVertical: spacing.lg, paddingHorizontal: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.line, borderLeftWidth: 3, borderLeftColor: "transparent", backgroundColor: colors.paper, gap: spacing.sm },
  focused: { borderLeftColor: colors.teal, backgroundColor: colors.paleTeal }, pressed: { backgroundColor: colors.paleTeal },
  recordLabels: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  recordKind: { fontFamily: chineseFont, ...readingType.meta, color: colors.muted, flexShrink: 1 }, recordText: { fontFamily: chineseFont, ...readingType.body, color: colors.ink },
  title: { fontFamily: chineseFont, ...readingType.tool, fontWeight: "700", color: colors.ink }, body: { fontFamily: chineseFont, ...readingType.tool, color: colors.ink }, meta: { fontFamily: chineseFont, ...readingType.meta, color: colors.muted },
});
