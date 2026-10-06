import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { authorizedCareCaptureReview, careKindOptions, careReviewChronological, careReviewPrioritize, careReviewSourceGroups, careReviewSourceKey, careReviewMatchesQuery, careReviewIsImportantPending, careReviewDomainLabel, careReviewUsesCareOwner, careReviewMatchesTab, careReviewContentSummary, careCaptureReadiness, careImportantReviewReadiness, careReviewPageSize, careReviewPage, careReviewWindow, type CareReviewTab, type CareCaptureReview, type CareRecordsActions, type CareRecordsViewModel } from "../../care-view-model";
import { chineseFont, colors, readingType, spacing, workspaceType } from "../../theme";
import { AppButton, AppSelect, AppTabPanel, AppTextField, UnderlineTabs } from "../ui";
import { AppIcon } from "../AppIcon";
import { AppStatusBadge } from "../AppStatusBadge";
import { OperationNotice } from "../OperationNotice";
import { ReadStateNotice } from "../ReadStateNotice";
import { useContainerWidth } from "../useContainerWidth";
import { CareCaptureDetail } from "./CareCaptureDetail";
import { CareRecordForm } from "./CareRecordForm";
import { CareRecordDetail } from "./CareRecordDetail";
import { CareRecordDelete } from "./CareRecordDelete";

export type CareReviewStatusFilter = "all" | "written" | "important_pending" | CareCaptureReview["reviewState"];
type Props = { model: CareRecordsViewModel; actions: CareRecordsActions; searchText?: string; initialStatus?: CareReviewStatusFilter; olderOnly?: boolean; initialRecordId?: string; onOlderPending?: () => void; onHistory?: () => void };

// Both entry points consume the same scoped review owner, never a copied candidate store.
export function CareWriteNotice({ model, actions }: { model: CareRecordsViewModel; actions: CareRecordsActions }) {
  const title = model.operation.state === "conflict" ? "版本衝突 · 尚未保存" : model.operation.state === "unknown" ? "尚未確認這次結果" : model.operation.state === "saving" ? "正在處理原操作" : model.operation.state === "saved" ? model.operation.kind === "delete" ? "已確認刪除" : model.operation.kind === "review" ? "已確認重要內容" : "已確認保存" : model.operation.state === "failed" ? "原操作未成功" : "待確認 · 尚未保存";
  return <OperationNotice state={model.operation.state} visible={!(model.operation.state === "needs_confirmation" && model.draft?.reviewedValues)} title={title} message={model.operation.message} referenceLabel={model.operation.referenceLabel ?? (model.operation.reference ? `原操作參考：${model.operation.reference}` : undefined)}>
    {model.operation.state === "unknown" ? <AppButton label={model.checkLabel} disabled={!model.online} onPress={actions.checkOriginalOperation} /> : null}
    {model.operation.state === "unknown" && model.operation.retryAvailable ? <AppButton label="重試同一原操作" disabled={!model.online} onPress={actions.retryOriginalOperation} /> : null}
  </OperationNotice>;
}
export function CareReviewHistoryView(props: Props) { return <><CareWriteNotice model={props.model} actions={props.actions} /><CareReviewWorkspace {...props} history /></>; }
export function CareReviewWorkspace({ model, actions, searchText, initialStatus = "all", olderOnly = false, initialRecordId, onOlderPending, onHistory, history = false }: Props & { history?: boolean }) {
  const review = authorizedCareCaptureReview(model), window = careReviewWindow(careReviewChronological(review.items));
  const [localQuery, setLocalQuery] = useState("");
  const [status, setStatus] = useState<CareReviewStatusFilter>(initialStatus);
  const [tab, setTab] = useState<CareReviewTab>("pending");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [sourceKey, setSourceKey] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const tabsId = useId(), layout = useContainerWidth(), wide = layout.width >= 760;
  const panelRef = useRef<View>(null), listRef = useRef<View>(null), focusRequested = useRef(false);
  const query = (searchText ?? localQuery).trim().toLocaleLowerCase("zh-HK");
  const sourceItems = history ? olderOnly ? window.older : review.items : window.recent;
  const sourceGroups = careReviewSourceGroups(careReviewChronological(sourceItems));
  const items = careReviewPrioritize(sourceItems.filter(item => (history
    ? status === "all" || status === "important_pending" && careReviewIsImportantPending(item) || status === "written" && item.writeState === "saved" || item.reviewState === status
    : careReviewMatchesTab(item, tab))
    && (sourceKey === "all" || careReviewSourceKey(item) === sourceKey) && careReviewMatchesQuery(item, query)));
  const visiblePage = careReviewPage(items, page), currentPage = visiblePage.page, pageItems = visiblePage.items;
  const sections = [
    { key: "important", label: "重要內容", items: pageItems.filter(careReviewIsImportantPending) },
    { key: "other", label: history ? "其他記錄" : tab === "pending" ? "寫入前確認" : "", items: pageItems.filter(item => !careReviewIsImportantPending(item)) },
  ];
  // Opening a row never confirms it. Keep the explicit selection after a receipt moves
  // it to another tab so the user can finish reading the result before going back.
  const selected = review.items.find(item => item.id === selectedId) ?? null;
  const locked = ["saving", "unknown"].includes(model.operation.state), occupied = locked || !!model.draft || !!model.deletion;
  const showPanel = !!selected || recordOpen && !!model.detail || !!model.draft || !!model.deletion;
  const listVisible = wide || !showPanel;
  const canEdit = model.access === "editable" && model.list.state !== "loading";
  const ready = selected ? selected.reviewRequirement === "required" && selected.savedRecord ? careImportantReviewReadiness(selected, { childId: model.child.id, scopeKey: model.scopeKey ?? "", access: model.access, capabilities: review.capabilities, expectedVersion: selected.version, expectedSourceVersion: selected.sourceVersion, recordId: selected.savedRecord.id, recordVersion: selected.savedRecord.current.version, expectedScopeKey: model.scopeKey ?? "" }) : careCaptureReadiness(selected, { childId: model.child.id, access: model.access, capabilities: review.capabilities }) : null;
  const previousDraft = useRef(model.draft);
  useEffect(() => { setPage(0); setSelectedId(null); setRecordOpen(false); setLocalQuery(""); setStatus(initialStatus); setTab("pending"); setSourceKey("all"); setFiltersOpen(false); }, [model.scopeKey, initialStatus, olderOnly]);
  useEffect(() => { setPage(0); setSelectedId(null); setRecordOpen(false); }, [query, status, sourceKey, tab]);
  useEffect(() => { if (initialRecordId && model.detail?.record.id === initialRecordId) setRecordOpen(true); }, [initialRecordId, model.detail?.record.id]);
  useEffect(() => {
    if (previousDraft.current && !previousDraft.current.captureSnapshot && !model.draft && model.operation.state === "saved" && model.detail) setRecordOpen(true);
    previousDraft.current = model.draft;
  }, [model.draft, model.operation.state, model.detail]);
  useEffect(() => {
    if (!focusRequested.current) return;
    focusRequested.current = false;
    const target = showPanel ? panelRef.current : listRef.current;
    (target as unknown as { focus?: (options: { preventScroll: boolean }) => void } | null)?.focus?.({ preventScroll: true });
  }, [selectedId, recordOpen, showPanel]);
  const closeSelection = () => { if (occupied) return; actions.closePanel(); setSelectedId(null); setRecordOpen(false); focusRequested.current = true; };
  const panelActions = { ...actions, closePanel: () => { if (!locked) { actions.closePanel(); setRecordOpen(false); } } };
  const openRecord = (id: string) => { if (occupied) return; setRecordOpen(true); focusRequested.current = true; actions.openRecord(id); };
  const changeTab = (next: CareReviewTab) => { if (occupied) return; actions.closePanel(); setTab(next); setRecordOpen(false); setSelectedId(null); };
  return <View ref={layout.ref} onLayout={layout.onLayout} style={s.workspace} testID={history ? "care-review-history" : "care-review-gate"}>
    {review.state === "ready" && review.notice ? <Text accessibilityLiveRegion="polite" style={s.notice}>{review.notice}</Text> : null}
    {history ? <View style={s.heading}><Text accessibilityRole="header" style={s.title}>{olderOnly ? "較早的核對記錄" : "核對記錄"}</Text><Text style={s.meta}>寫入結果與核對狀態會保留；移到歷史不會清除待確認事項。</Text></View>
      : <UnderlineTabs id={tabsId} label="記錄分類" items={[{ key: "pending", label: review.state === "ready" ? `待確認 ${window.pendingCount}` : "待確認" }, { key: "recorded", label: "最近已記錄" }]} value={tab} onChange={changeTab} />}
    {!history && tab === "recorded" && window.importantPendingCount > 0 ? <View style={s.importantReminder}><AppIcon name="clock-outline" size={15} color={colors.warningInk} /><Text style={s.warning}>重要內容仍待確認</Text></View> : null}
    <ReviewContent history={history} tabsId={tabsId} tab={tab}>
    <View style={[s.columns, wide && showPanel && s.split]}>
      <View ref={listRef} tabIndex={-1} style={[s.listColumn, wide && showPanel && s.narrowList, !listVisible && s.hidden]} testID="care-review-list" pointerEvents={listVisible ? "auto" : "none"} aria-hidden={!listVisible} accessibilityElementsHidden={!listVisible} importantForAccessibility={listVisible ? "auto" : "no-hide-descendants"}>
        <View style={s.filterBar}><Text style={s.filterContext}>{sourceKey === "all" ? history ? "所有已載入對話" : tab === "pending" ? "重要內容優先" : "已保存，有誤時可更正" : sourceGroups.find(group => group.key === sourceKey)?.label ?? "所選對話"}{query ? " · 已搜尋" : ""}</Text>
          <AppButton label={filtersOpen ? "收起篩選" : "篩選"} expanded={filtersOpen} density="compact" variant="quiet" disabled={occupied} onPress={() => { if (!occupied) setFiltersOpen(value => !value); }} />
        </View>
        {filtersOpen ? <View style={s.filters}>
          {searchText === undefined ? <AppTextField label="搜尋核對內容" value={localQuery} onChangeText={value => { if (!occupied) setLocalQuery(value); }} maxLength={200} disabled={occupied} /> : null}
          {history ? <AppSelect<CareReviewStatusFilter> label="處理狀態" value={status} options={[{ value: "all", label: "全部變更" }, { value: "important_pending", label: "重要待確認" }, { value: "pending", label: "所有待確認" }, { value: "written", label: "已寫入" }, { value: "confirmed", label: "已明確確認" }, { value: "skipped", label: "已略過" }]} onChange={value => { if (!occupied) setStatus(value); }} disabled={occupied} /> : null}
          <AppSelect<string> label="來源對話" value={sourceKey} options={[{ value: "all", label: "所有已載入對話" }, ...sourceGroups.map(group => ({ value: group.key, label: `${group.label} · ${group.dateLabel}` }))]} onChange={value => { if (!occupied) setSourceKey(value); }} disabled={occupied} />
        </View> : null}
        {!history && window.older.length ? <View style={s.older}><Text style={s.meta}>近期保留最多 10 頁；較早的 {window.olderPendingCount} 項待確認仍未處理。</Text>
          {window.olderPendingCount && onOlderPending ? <AppButton label="查看較早待確認" density="compact" variant="secondary" onPress={onOlderPending} disabled={occupied} /> : onHistory ? <AppButton label="查看較早記錄" density="compact" variant="secondary" onPress={onHistory} disabled={occupied} /> : null}</View> : null}
        {review.state !== "ready" ? <ReadStateNotice state={review.state === "loading" ? "loading" : review.state === "error" ? "error" : "unavailable"} title={review.state === "loading" ? "正在讀取核對記錄…" : review.state === "error" ? "未能讀取核對記錄，請重試" : "核對記錄暫不可用"} message={review.state === "unavailable" ? review.notice ?? (model.access === "lost" ? "目前沒有查看這個孩子的權限。" : "暫未取得這個孩子的核對記錄。") : ""} /> : !items.length ? <ReadStateNotice state="empty" title={query || sourceKey !== "all" || history && status !== "all" ? "沒有符合篩選條件的內容" : history ? "目前沒有核對記錄" : tab === "pending" ? window.olderPendingCount ? "近期沒有待確認內容" : "目前沒有待確認內容" : "目前沒有已記錄內容"} message={review.hasMore ? "" : !history && tab === "pending" ? window.olderPendingCount ? "較早的待確認事項仍保留，可由上方入口查看。" : "普通已保存內容可在「最近已記錄」查看，有誤時再更正。" : "可調整篩選，查看其他已載入內容。"} /> : <View style={s.list}>
          {sections.filter(section => section.items.length).map(section => <View key={section.key} style={s.groupSection}>
            {section.label ? <Text accessibilityRole="header" style={s.sectionLabel}>{section.label}</Text> : null}
            {section.items.map(item => {
              const important = careReviewIsImportantPending(item), selectedRow = selected?.id === item.id;
              const kind = item.writeState === "saved" && item.savedRecord ? item.savedRecord.current.values.kind : item.proposedValues.kind;
              const statusLabel = item.operationValidity?.state === "expired" ? `${important ? "重要 · " : ""}原操作已過期` : item.sourceState !== "ready" ? "來源需重新核對" : item.writeState === "unknown" ? "結果未知" : item.writeState === "failed" ? "保存失敗" : important ? "重要 · 待確認" : item.reviewState === "pending" ? "寫入前確認" : item.reviewState === "skipped" ? "已略過" : null;
              return <Pressable key={item.id} testID="care-review-row" accessibilityRole="button" accessibilityLabel={`核對${item.title}：${careReviewContentSummary(item)}${statusLabel ? `，${statusLabel}` : ""}`} accessibilityState={{ expanded: selectedRow, disabled: occupied }} aria-expanded={selectedRow} aria-current={selectedRow ? "true" : undefined} disabled={occupied}
                onPress={() => { if (occupied) return; actions.closePanel(); setSelectedId(selectedRow ? null : item.id); setRecordOpen(false); focusRequested.current = true; }} style={({ pressed }) => [s.row, important && s.importantRow, selectedRow && s.selected, pressed && !occupied && (selectedRow ? s.selectedPressed : s.pressed)]}>
                <View style={s.copy}><Text numberOfLines={3} style={s.rowContent}>{careReviewContentSummary(item)}</Text>
                  <Text numberOfLines={2} style={s.meta}>{item.target.kind === "update" ? "更新" : "新增"} · {careReviewUsesCareOwner(item) ? careKindOptions.find(option => option.value === kind)?.label : careReviewDomainLabel(item)} · {item.sourceContext?.conversationLabel ?? item.sourceLabel}</Text>
                  <View style={s.rowMeta}><Text style={s.meta}>{item.sourceContext?.dateLabel ?? "未提供對話日期"}</Text>{statusLabel ? <AppStatusBadge label={statusLabel} tone={item.writeState === "failed" ? "error" : "warning"} /> : null}</View>
                </View><AppIcon name={selectedRow ? "chevron-down" : "chevron-right"} size={18} />
              </Pressable>;
            })}
          </View>)}
        </View>}
        {items.length > careReviewPageSize ? <View style={s.pager}><AppButton label="上一頁" density="compact" variant="secondary" disabled={occupied || !visiblePage.hasPrevious} onPress={() => { if (occupied || !visiblePage.hasPrevious) return; setPage(currentPage - 1); setSelectedId(null); setRecordOpen(false); }} /><Text style={s.meta}>第 {currentPage + 1} 頁</Text><AppButton label="下一頁" density="compact" variant="secondary" disabled={occupied || !visiblePage.hasNext} onPress={() => { if (occupied || !visiblePage.hasNext) return; setPage(currentPage + 1); setSelectedId(null); setRecordOpen(false); }} /></View> : null}
        {review.hasMore ? <Text style={s.warning}>仍有核對記錄未載入。</Text> : null}
      </View>
      {showPanel ? <View ref={panelRef} tabIndex={-1} style={[s.detailColumn, wide && s.detailDivider]} testID="care-review-detail-panel">
        {!model.draft && !model.deletion ? <AppButton label={wide ? "收起內容" : "返回記錄清單"} variant="quiet" density="compact" disabled={occupied} onPress={closeSelection} /> : null}
        {model.deletion ? <CareRecordDelete model={model} actions={panelActions} /> : model.draft ? <CareRecordForm key={model.draft.key} model={model} actions={panelActions} /> : recordOpen && model.detail ? <CareRecordDetail detail={model.detail} actions={panelActions} canEdit={canEdit} online={model.online} /> : selected ? <CareCaptureDetail capture={selected} wide={wide && layout.width * 0.68 - spacing.lg * 2 - 1 >= 640} readiness={ready?.reason ?? ""} confirmLabel={model.submitLabel}
          canConfirm={selected.writeState === "not_saved" && !!ready?.allowed && !occupied && model.online} canConfirmImportant={selected.writeState === "saved" && !!ready?.allowed && !occupied && model.online}
          onConfirmImportant={actions.confirmImportantRecord && selected.savedRecord ? () => actions.confirmImportantRecord?.(selected.id, selected.version, selected.sourceVersion, selected.savedRecord!.id, selected.savedRecord!.current.version, model.scopeKey ?? "") : undefined} canEdit={canEdit && !occupied && (selected.writeState === "saved" || !!ready?.allowed)} canSkip={canEdit && !occupied && !!review.capabilities?.skip && careReviewUsesCareOwner(selected) && selected.reviewRequirement !== "required" && (!selected.operationValidity || selected.operationValidity.state === "active")}
          onConfirm={actions.confirmCapture ? () => actions.confirmCapture?.(selected.id, selected.version, selected.sourceVersion) : undefined}
          onReview={actions.reviewCapture ? () => actions.reviewCapture?.(selected.id, selected.version, selected.sourceVersion) : undefined}
          onSkip={actions.skipCapture ? () => actions.skipCapture?.(selected.id, selected.version) : undefined}
          onOpenRecord={openRecord} onCorrection={id => { setRecordOpen(false); actions.startCorrection(id); }} /> : null}
      </View> : null}
    </View>
    </ReviewContent>
  </View>;
}
function ReviewContent({ history, tabsId, tab, children }: { history: boolean; tabsId: string; tab: CareReviewTab; children: ReactNode }) {
  return history ? <View style={s.workspace}>{children}</View> : <AppTabPanel tabsId={tabsId} tabKey={tab} active style={s.workspace}>{children}</AppTabPanel>;
}
const s = StyleSheet.create({
  workspace: { gap: spacing.md, minWidth: 0 }, heading: { gap: spacing.xs }, title: { fontFamily: chineseFont, ...workspaceType.section, color: colors.ink, fontWeight: "700" },
  meta: { fontFamily: chineseFont, ...readingType.meta, color: colors.muted }, warning: { fontFamily: chineseFont, ...readingType.meta, color: colors.warningInk }, notice: { fontFamily: chineseFont, ...readingType.tool, color: colors.deepTeal },
  columns: { minWidth: 0, gap: spacing.lg }, split: { flexDirection: "row", alignItems: "flex-start" },
  listColumn: { minWidth: 0, gap: spacing.md }, narrowList: { flexBasis: "32%", flexGrow: 0, flexShrink: 0 },
  detailColumn: { minWidth: 0, gap: spacing.sm }, detailDivider: { flexBasis: 0, flexGrow: 1, flexShrink: 1, borderLeftWidth: 1, borderLeftColor: colors.softLine, paddingLeft: spacing.lg }, hidden: { display: "none" },
  filterBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }, filterContext: { flex: 1, minWidth: 0, fontFamily: chineseFont, ...readingType.meta, color: colors.muted }, filters: { gap: spacing.sm },
  older: { gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.softLine }, importantReminder: { flexDirection: "row", gap: spacing.xs, alignItems: "center" },
  sectionLabel: { fontFamily: chineseFont, ...readingType.meta, color: colors.muted }, groupSection: { gap: spacing.xs }, list: { gap: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.softLine, borderLeftWidth: 3, borderLeftColor: "transparent" }, importantRow: { borderLeftColor: colors.statusWarmLine },
  copy: { flex: 1, minWidth: 0, gap: spacing.xs }, rowContent: { fontFamily: chineseFont, ...workspaceType.row, color: colors.ink }, rowMeta: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, alignItems: "center" }, selected: { backgroundColor: colors.paleTeal }, pressed: { backgroundColor: colors.paleTeal }, selectedPressed: { backgroundColor: colors.selectedNav }, pager: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" },
});
