import { useEffect, useRef, type RefObject } from "react";
import { Platform, StyleSheet, View, type ScrollView } from "react-native";
import { Text } from "react-native-paper";
import { authorizedCareCaptureReview, careKindOptions, careReviewChronological, careReviewPrioritize, careReviewMatchesQuery, careReviewIsImportantPending, careReviewDomainLabel, careReviewUsesCareOwner, careCaptureReadiness, careImportantReviewReadiness, careReviewPageSize, careReviewPage, careReviewWindow, type CareCaptureReview, type CareRecordsActions, type CareRecordsViewModel } from "../../care-view-model";
import { serializeHistoryRoute, type HistoryRouteState } from "../../navigation/route-state";
import { useReaderPosition } from "../../navigation/ReaderPosition";
import { useReaderReturn } from "../../navigation/useReaderReturn";
import { chineseFont, colors, readingType, spacing } from "../../theme";
import { AppButton, AppSelect } from "../ui";
import { AppStatusBadge } from "../AppStatusBadge";
import { OperationNotice } from "../OperationNotice";
import { ReadStateNotice } from "../ReadStateNotice";
import { ReadTargetLink } from "../ReadTargetLink";
import { HistoryPager } from "../history/HistoryPager";
import { CareCaptureDetail } from "./CareCaptureDetail";
import { FormDialog } from "../FormDialog";
import { CareRecordForm } from "./CareRecordForm";

export type CareReviewStatusFilter = HistoryRouteState["status"];
type Props = { historyRoute: HistoryRouteState; onHistoryRouteChange(next: HistoryRouteState, mode: "push" | "replace"): void; model: CareRecordsViewModel; actions: CareRecordsActions; searchText?: string; scrollRef?: RefObject<ScrollView | null>; getScrollPosition?(): number };

export function CareWriteNotice({ model, actions }: { model: CareRecordsViewModel; actions: CareRecordsActions }) {
  const title = model.operation.state === "conflict" ? "版本衝突 · 尚未保存" : model.operation.state === "unknown" ? "尚未確認這次結果" : model.operation.state === "saving" ? "正在處理原操作" : model.operation.state === "saved" ? model.operation.kind === "delete" ? "已確認刪除" : model.operation.kind === "review" ? "已確認重要內容" : "已確認保存" : model.operation.state === "failed" ? "原操作未成功" : "待確認 · 尚未保存";
  return <OperationNotice state={model.operation.state} visible={!(model.operation.state === "needs_confirmation" && model.draft?.reviewedValues)} title={title} message={model.operation.message} referenceLabel={model.operation.referenceLabel ?? (model.operation.reference ? `原操作參考：${model.operation.reference}` : undefined)}>
    {model.operation.state === "unknown" ? <AppButton label={model.checkLabel} disabled={!model.online} onPress={actions.checkOriginalOperation} /> : null}
    {model.operation.state === "unknown" && model.operation.retryAvailable ? <AppButton label="重試同一原操作" disabled={!model.online} onPress={actions.retryOriginalOperation} /> : null}
  </OperationNotice>;
}

function rowStatus(item: CareCaptureReview) {
  const important = careReviewIsImportantPending(item);
  return item.operationValidity?.state === "expired" ? `${important ? "重要 · " : ""}原操作已過期` : item.sourceState !== "ready" ? "來源需重新核對" : item.writeState === "unknown" ? "結果未知" : item.writeState === "failed" ? "保存失敗" : important ? "重要 · 待確認" : item.reviewState === "pending" ? "寫入前確認" : item.reviewState === "skipped" ? "已略過" : item.writeState === "saved" ? (item.savedRecord?.current.version ?? 1) > 1 ? "已更正" : "已保存" : item.reviewState === "confirmed" ? "已明確確認" : null;
}
function rowTime(item: CareCaptureReview) { return item.writeState === "saved" && item.savedRecord ? item.savedRecord.current.confirmedAtLabel ? `確認於 ${item.savedRecord.current.confirmedAtLabel}` : "確認時間未知" : item.sourceContext?.dateLabel ?? item.createdAtLabel ?? "未提供對話日期"; }
function rowText(item: CareCaptureReview) { return item.sourceState === "unavailable" ? item.title : item.originalText || item.title; }
function rowLabel(item: CareCaptureReview) {
  const text = Array.from(rowText(item).replace(/\s+/g, " ").trim());
  return `核對${item.title}：${text.slice(0, 100).join("")}${text.length > 100 ? "…" : ""}，${rowStatus(item) ?? "核對記錄"}，${rowTime(item)}`;
}

/** A single authorized loaded index; read navigation never confirms a proposal. */
export function CareReviewHistoryView({ model, actions, historyRoute: route, onHistoryRouteChange, searchText = "", scrollRef, getScrollPosition }: Props) {
  const review = authorizedCareCaptureReview(model), window = careReviewWindow(careReviewChronological(review.items));
  const query = searchText.trim().toLocaleLowerCase("zh-HK");
  const sourceItems = route.older ? window.older : review.items;
  const items = careReviewPrioritize(sourceItems.filter(item => (route.status === "all" || route.status === "important_pending" && careReviewIsImportantPending(item) || route.status === "written" && item.writeState === "saved" || item.reviewState === route.status) && careReviewMatchesQuery(item, query)));
  const visiblePage = careReviewPage(items, route.page), selected = review.items.find(item => item.id === route.selectedId) ?? null;
  const locked = ["saving", "unknown"].includes(model.operation.state), occupied = locked || !!model.draft || !!model.deletion;
  const reading = ["loading", "loading_more"].includes(model.list.state), canEdit = model.access === "editable" && !reading;
  const available = model.access !== "lost", editorVisible = available && !!model.draft;
  const listRef = useRef<View>(null), readerRef = useRef<View>(null), localScroll = useRef<ScrollView>(null);
  const authority = useReaderPosition(), signature = JSON.stringify([model.scopeKey, model.child.id, model.access, route, query]);
  const savedFocus = useRef<{ signature: string; authority: typeof authority.actions; kind: "save" | "review" | "skip"; revision: CareRecordsViewModel; id: string; version: number; sourceVersion: string; priorReference: string | null; reference: string | null; trigger: HTMLElement | null } | null>(null);
  const rememberSubmit = (kind: "save" | "review" | "skip", submit: () => void) => {
    if (selected && authority.meta.isCurrent()) savedFocus.current = { signature, authority: authority.actions, kind, revision: model, id: selected.id, version: selected.version, sourceVersion: selected.sourceVersion,
      priorReference: model.operation.reference, reference: null, trigger: Platform.OS === "web" ? document.activeElement as HTMLElement : null };
    submit();
  };
  const restoreSavedFocus = () => {
    const intent = savedFocus.current; savedFocus.current = null;
    if (!intent || intent.signature !== signature || intent.authority !== authority.actions || !authority.meta.isCurrent() || !available || editorVisible) return;
    const operation = model.operation;
    const receipt = intent.kind === "skip" ? operation.state === "none" : operation.state === "saved" && !!operation.reference && operation.reference !== intent.priorReference && !!intent.reference && intent.reference === operation.reference
      && (intent.kind === "review" ? operation.kind === "review" : operation.kind !== "review" && operation.kind !== "delete");
    const published = selected?.id === intent.id && selected.version === intent.version && selected.sourceVersion === intent.sourceVersion && (intent.kind === "skip" ? selected.reviewState === "skipped" : selected.reviewState === "confirmed")
      && (intent.kind === "skip" ? selected.writeState === "not_saved" : intent.kind === "review" ? !!selected.confirmation && selected.confirmation.scopeKey === model.scopeKey && selected.confirmation.proposalVersion === intent.version && selected.confirmation.sourceVersion === intent.sourceVersion
        : selected.writeState === "saved" && !!selected.resolution?.recordId && selected.savedRecord?.id === selected.resolution.recordId && selected.savedRecord.current.version === selected.resolution.recordVersion);
    if (!receipt || !published) return;
    if (Platform.OS === "web") { if (!intent.trigger || intent.trigger.isConnected || document.activeElement !== document.body) return; (readerRef.current as unknown as HTMLElement | null)?.focus({ preventScroll: true }); }
    else readerRef.current?.focus();
  };
  useEffect(() => {
    const intent = savedFocus.current;
    if (!intent) return;
    if (intent.signature !== signature || intent.authority !== authority.actions || !authority.meta.isCurrent() || !available) { savedFocus.current = null; return; }
    if (intent.kind === "skip") { if (model !== intent.revision) restoreSavedFocus(); return; }
    if (model.operation.state === "saving" && model.operation.reference && model.operation.reference !== intent.priorReference) intent.reference = model.operation.reference;
    else if (!["saving", "unknown", "saved"].includes(model.operation.state)) savedFocus.current = null;
    // Important-content confirmation has no editor. Capture saves hand off only
    // after the original modal has released focus, through its onClosed receipt.
    else if (model.operation.state === "saved" && intent.kind === "review") restoreSavedFocus();
  }, [signature, authority, model, selected, available]);
  const position = useReaderReturn({ scopeKey: JSON.stringify([model.scopeKey, model.child.id, model.access, "history-review", query, route.status, route.older, visiblePage.page]), selectedId: selected?.id ?? null,
    enabled: available && !editorVisible && (!route.selectedId || !!selected), listRef, readerRef, scrollRef: scrollRef ?? localScroll });
  const select = (id: string) => { position.remember(id, getScrollPosition?.()); onHistoryRouteChange({ ...route, selectedId: id }, "push"); };
  const returnToList = () => { position.returning(); onHistoryRouteChange({ ...route, selectedId: null }, "replace"); };
  // Closing a pre-write adjustment retains its exact capture. The History adapter
  // waits for the original close publication and performs no redundant URL write.
  const closeEditor = () => onHistoryRouteChange(route, "replace");
  const ready = selected ? selected.reviewRequirement === "required" && selected.savedRecord ? careImportantReviewReadiness(selected, { childId: model.child.id, scopeKey: model.scopeKey ?? "", access: model.access, capabilities: review.capabilities, expectedVersion: selected.version, expectedSourceVersion: selected.sourceVersion, recordId: selected.savedRecord.id, recordVersion: selected.savedRecord.current.version, expectedScopeKey: model.scopeKey ?? "" }) : careCaptureReadiness(selected, { childId: model.child.id, access: model.access, capabilities: review.capabilities }) : null;
  const filtered = !!query || route.status !== "all";
  const emptyState = !model.online || model.list.state === "stale" ? "stale" : reading && !model.list.hasSnapshot ? "loading" : model.list.state === "error" ? "error" : model.list.message ? "unavailable" : "empty";
  const retry = <AppButton label="重新讀取記錄" variant="quiet" disabled={occupied || reading || !model.online} onPress={() => actions.search(model.list.activeQuery, model.list.activeKind)} />;
  return <View style={s.workspace} testID="care-review-history">
    <CareWriteNotice model={model} actions={actions} />
    {review.state === "ready" && review.notice ? <Text accessibilityLiveRegion="polite" style={s.body}>{review.notice}</Text> : null}
    {review.state === "ready" && items.length > 0 && ["error", "stale"].includes(model.list.state) ? <ReadStateNotice state={model.list.hasSnapshot ? "stale" : "error"} message={model.list.message ?? "未能更新記錄，請重試。"}>{retry}</ReadStateNotice> : null}
    {available && review.state !== "ready" ? <ReadStateNotice headingLevel={3} state={review.state === "loading" ? "loading" : review.state === "error" ? "error" : "unavailable"} message={review.state === "loading" ? "正在讀取核對記錄…" : review.state === "error" ? "未能讀取核對記錄，請重試。" : review.notice ?? "暫未取得這個孩子的核對記錄。"}>{model.list.state === "error" || model.list.state === "stale" ? retry : null}</ReadStateNotice> : null}
    {!available ? <ReadStateNotice state="unavailable" message="目前沒有權限查看這個孩子的核對記錄。" /> : <>
    <View testID="care-review-history-index" aria-hidden={!!route.selectedId} style={[s.workspace, !!route.selectedId && s.hidden]}>
      {route.older ? <Text style={s.body}>正在查看較早的核對記錄；移到歷史不代表已確認。</Text> : null}
      {review.state === "ready" && (sourceItems.length > 0 || filtered || review.hasMore) ? <AppSelect<CareReviewStatusFilter> label="處理狀態" value={route.status} options={[{ value: "all", label: "全部變更" }, { value: "important_pending", label: "重要待確認" }, { value: "pending", label: "所有待確認" }, { value: "written", label: "已寫入" }, { value: "confirmed", label: "已明確確認" }, { value: "skipped", label: "已略過" }]} disabled={occupied} onChange={status => onHistoryRouteChange({ ...route, status, page: 0, selectedId: null }, "replace")} /> : null}
      <View ref={listRef} tabIndex={-1} testID="care-review-list" accessibilityLabel="核對記錄清單" style={s.workspace}>
        {review.state !== "ready" ? null : !items.length ? <ReadStateNotice state={emptyState} message={emptyState !== "empty" ? emptyState === "loading" ? "正在讀取核對記錄…" : model.list.message ?? "核對記錄尚未更新，請重新讀取。" : filtered ? review.hasMore ? "已載入範圍沒有符合篩選的核對記錄" : "沒有符合篩選的核對記錄" : review.hasMore ? "已載入範圍暫無核對記錄" : "暫無核對記錄"}>{["error", "stale"].includes(emptyState) ? retry : null}</ReadStateNotice> : <View>
          {visiblePage.items.map(item => { const status = rowStatus(item), kind = item.savedRecord?.current.values.kind ?? item.proposedValues.kind;
            return <ReadTargetLink key={item.id} ref={node => position.rowRef(item.id, node)} testID="care-review-row" href={{ pathname: "/history", params: serializeHistoryRoute({ ...route, category: "review", selectedId: item.id }) }} label={rowLabel(item)}
              availability={reading && model.list.hasSnapshot && !occupied ? "refreshing" : occupied || reading ? "unavailable" : "ready"} onOpen={() => select(item.id)} style={s.row}>
              <Text numberOfLines={2} style={s.body}>{rowText(item)}</Text>
              <View style={s.labels}><Text style={s.meta}>{careReviewUsesCareOwner(item) ? careKindOptions.find(option => option.value === kind)?.label : careReviewDomainLabel(item)}</Text>{status ? <AppStatusBadge label={status} tone={item.writeState === "failed" ? "error" : ["已保存", "已更正", "已明確確認"].includes(status) ? "success" : status === "已略過" ? "neutral" : "warning"} /> : null}</View>
              <Text style={s.meta}>{item.target.kind === "update" ? "更新" : "新增"} · {item.sourceContext?.conversationLabel ?? item.sourceLabel} · {rowTime(item)}</Text>
            </ReadTargetLink>;
          })}</View>}
        {items.length ? <Text accessibilityLiveRegion="polite" style={s.meta}>第 {visiblePage.page * careReviewPageSize + 1}–{Math.min((visiblePage.page + 1) * careReviewPageSize, items.length)} 項 · 已載入 {items.length} 項</Text> : null}
        <HistoryPager page={visiblePage.page} total={items.length} pageSize={careReviewPageSize} disabled={occupied || reading} onChange={page => onHistoryRouteChange({ ...route, page, selectedId: null }, "replace")} />
        {review.hasMore ? <Text style={s.body}>仍有核對記錄未載入；這裏只搜尋及分頁已載入內容。</Text> : null}
      </View>
    </View>
    {route.selectedId ? <View testID="care-review-history-reader" style={s.reader}>
      <AppButton label="返回核對記錄清單" variant="quiet" onPress={returnToList} />
      {selected ? <><CareCaptureDetail capture={selected} headingRef={readerRef} readiness={ready?.reason ?? ""} confirmLabel={model.submitLabel}
          canConfirm={selected.writeState === "not_saved" && !!ready?.allowed && !occupied && model.online} canConfirmImportant={selected.writeState === "saved" && !!ready?.allowed && !occupied && model.online}
          onConfirmImportant={actions.confirmImportantRecord && selected.savedRecord ? () => rememberSubmit("review", () => actions.confirmImportantRecord?.(selected.id, selected.version, selected.sourceVersion, selected.savedRecord!.id, selected.savedRecord!.current.version, model.scopeKey ?? "")) : undefined}
          canEdit={canEdit && !occupied && (selected.writeState === "saved" || !!ready?.allowed)} canSkip={canEdit && !occupied && !!review.capabilities?.skip && careReviewUsesCareOwner(selected) && selected.reviewRequirement !== "required" && (!selected.operationValidity || selected.operationValidity.state === "active")}
          onConfirm={actions.confirmCapture ? () => rememberSubmit("save", () => actions.confirmCapture?.(selected.id, selected.version, selected.sourceVersion)) : undefined}
          onReview={actions.reviewCapture ? () => actions.reviewCapture?.(selected.id, selected.version, selected.sourceVersion) : undefined}
          onSkip={actions.skipCapture ? () => rememberSubmit("skip", () => actions.skipCapture?.(selected.id, selected.version)) : undefined}
          canOpenRecord={!occupied && !reading} onOpenRecord={actions.openRecord} /></>
        : <ReadStateNotice state={review.state === "loading" ? "loading" : "unavailable"} message={review.state === "loading" ? "正在讀取核對記錄…" : "這項核對記錄不在目前已載入且可讀的清單，沒有代選其他項目。"} />}
    </View> : null}
    <FormDialog visible={editorVisible} scopeKey={model.scopeKey ?? model.child.id} formKey={model.draft?.key} title="調整待確認提案" returnFocusRef={readerRef} fallbackFocusRef={listRef} onClose={closeEditor} onClosed={restoreSavedFocus}
      closeOutcome={{ revision: model, ready: !model.detail && !model.draft && !model.deletion && model.operation.state === "none" }} recovery={<CareWriteNotice model={model} actions={actions} />}>
      {model.draft ? <CareRecordForm key={model.draft.key} model={model} actions={{ ...actions, closePanel: closeEditor, submitReviewed: () => rememberSubmit("save", actions.submitReviewed) }} /> : null}
    </FormDialog>
    </>}
  </View>;
}
const s = StyleSheet.create({ workspace: { gap: spacing.md, minWidth: 0 },
  hidden: { display: "none" }, reader: { gap: spacing.lg, width: "100%", maxWidth: 760, alignSelf: "center", minWidth: 0 }, row: { minWidth: 0, minHeight: 48, paddingVertical: spacing.md, gap: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.line, borderRadius: 0 },
  labels: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: spacing.sm }, body: { fontFamily: chineseFont, ...readingType.body, color: colors.ink }, meta: { fontFamily: chineseFont, ...readingType.meta, color: colors.muted } });
