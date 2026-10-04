import { brand } from "../../branding";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View, type ScrollView as NativeScrollView } from "react-native";
import { Text } from "react-native-paper";
import { MotionDetail, MotionEntrance, MotionList, MotionReveal } from "../../motion";
import { AppIcon } from "../AppIcon";
import { careKindOptions, type CareFilter, type CareRecordsActions, type CareRecordsViewModel } from "../../care-view-model";
import { chineseFont, colors, radius, readingType, spacing, workspaceType } from "../../theme";
import { PageFrame } from "../PageFrame";
import { AppButton, AppSelect, AppTextField, SectionCard, SectionHeader } from "../ui";
import { OperationNotice } from "../OperationNotice";
import { ReadStateNotice } from "../ReadStateNotice";
import { CareRecordDetail } from "./CareRecordDetail";
import { CareRecordForm } from "./CareRecordForm";
import { CareRecordDelete } from "./CareRecordDelete";

export function CareRecordsView({ model, actions, previewControls, onPhotos }: { model: CareRecordsViewModel; actions: CareRecordsActions; previewControls?: ReactNode; onPhotos?: () => void }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<CareFilter>("all");
  const [width, setWidth] = useState(0);
  const scrollRef = useRef<NativeScrollView>(null);
  const scrollPosition = useRef(0);
  const listAnchor = useRef<{ id: string | null; position: number; context: string; nextIds: string[]; previousIds: string[] } | null>(null);
  const rowRefs = useRef(new Map<string, View>());
  const listFocusRef = useRef<View>(null);
  const [visitedId, setVisitedId] = useState<string | null>(null);
  const loading = model.list.state === "loading" || model.list.state === "loading_more";
  const previousLoading = useRef(loading);
  useLayoutEffect(() => { previousLoading.current = loading; }, [loading]);
  const locked = ["saving", "unknown"].includes(model.operation.state);
  const occupied = locked || !!model.draft || !!model.deletion;
  const showPanel = !!(model.detail || model.draft || model.deletion);
  const split = width >= 780;
  const listContext = JSON.stringify([model.child.id, model.list.activeQuery, model.list.activeKind]);
  const previousPanel = useRef(showPanel);
  const previousDraftMode = useRef(model.draft?.mode);
  const [createdDetailId, setCreatedDetailId] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (previousDraftMode.current === "create" && !model.draft && model.detail && model.operation.state === "saved") setCreatedDetailId(model.detail.record.id);
    previousDraftMode.current = model.draft?.mode;
  }, [model.draft?.mode, model.detail?.record.id, model.operation.state]);
  const restoreFrame = useRef<number | null>(null);
  const returnState = useRef({ showPanel, split, context: listContext, access: model.access });
  returnState.current = { showPanel, split, context: listContext, access: model.access };
  useLayoutEffect(() => () => {
    if (restoreFrame.current !== null) cancelAnimationFrame(restoreFrame.current);
    restoreFrame.current = null;
  }, []);
  useEffect(() => {
    listAnchor.current = null; setVisitedId(null); setCreatedDetailId(null);
  }, [model.child.id, model.access, listContext]);
  useLayoutEffect(() => {
    const returning = previousPanel.current && !showPanel;
    const entering = !previousPanel.current && showPanel;
    previousPanel.current = showPanel;
    const anchor = listAnchor.current;
    if (entering || model.access === "lost" || anchor?.context !== listContext) {
      if (restoreFrame.current !== null) cancelAnimationFrame(restoreFrame.current);
      restoreFrame.current = null;
    }
    if (model.access !== "lost") {
      if (!split && entering) scrollRef.current?.scrollTo({ y: 0, animated: false });
      if (returning && anchor?.context === listContext) {
        // Refs are committed here. Do not defer focus to a frame that an
        // unrelated records-array render can cancel after consuming the return.
        if (Platform.OS === "web") {
          const surviving = new Set(model.list.records.map(record => record.id));
          const candidates = [anchor.id, ...anchor.nextIds, ...anchor.previousIds]
            .filter((id): id is string => !!id && surviving.has(id))
            .map(id => rowRefs.current.get(id));
          for (const candidate of [...candidates, listFocusRef.current]) {
            const target = candidate as unknown as HTMLElement | null | undefined;
            if (!target?.isConnected || !target.getClientRects().length || target.closest("[inert]") || target.hasAttribute("disabled") || target.getAttribute("aria-disabled") === "true") continue;
            target.focus({ preventScroll: true });
            if (document.activeElement === target) break;
          }
        }
        if (!split) restoreFrame.current = requestAnimationFrame(() => {
          restoreFrame.current = null;
          const current = returnState.current;
          if (!current.showPanel && !current.split && current.access !== "lost" && current.context === anchor.context) scrollRef.current?.scrollTo({ y: anchor.position, animated: false });
        });
      }
    }
  }, [showPanel, split, model.access, listContext, model.list.records]);
  function rememberList(id: string | null) {
    const ids = model.list.records.map(record => record.id);
    const index = id ? ids.indexOf(id) : -1;
    listAnchor.current = { id, position: scrollPosition.current, context: listContext, nextIds: index >= 0 ? ids.slice(index + 1) : [], previousIds: index >= 0 ? ids.slice(0, index).reverse() : [] };
    if (id) setVisitedId(id);
  }
  const detailPresentation = model.detail ?? (model.draft?.basis ? { record: model.draft.basis, historyOpen: false, history: [], historyLoading: false, hasMoreHistory: false } : null);
  const motionScope = `${model.child.id}:${model.access}`;
  const revealIntent = ["saving", "saved"].includes(model.operation.state) ? model.operation.reference : null;
  const listVisible = split || !showPanel;
  const search = () => { listAnchor.current = null; setVisitedId(null); actions.search(query, kind); };
  const listReadState = model.list.state === "loading" || model.list.state === "loading_more" ? "loading" : model.list.state === "error" ? "error" : model.list.state === "stale" ? "stale" : model.list.records.length ? "ready" : "empty";
  const readMessage = model.list.state === "loading" ? "正在讀取記錄…" : model.list.state === "loading_more" ? "正在載入下一頁；已載入記錄保留。" : model.list.message ?? (listReadState === "empty" ? model.list.hasMore ? "這一頁未找到符合內容，但仍有未掃描的記錄；請載入下一頁。" : "已載入範圍沒有符合條件的已確認記錄。" : "");
  const operationTitle = model.operation.state === "conflict" ? "版本衝突 · 尚未保存" : model.operation.state === "unknown" ? "尚未確認這次結果" : model.operation.state === "saving" ? "正在處理原操作" : model.operation.state === "saved" ? model.operation.kind === "delete" ? "已確認刪除（預覽）" : "已確認保存（預覽）" : model.operation.state === "failed" ? "原操作未成功" : "待確認 · 尚未保存";
  return <PageFrame title="照顧記錄" density="compact" description="保留日常觀察的原文與來源；事件時間、加入時間及更正版本分開顯示。" eyebrow={`${brand.name} · 孩子資料`} scrollRef={scrollRef} scrollTestID="care-page-scroll"
    onScroll={event => { if (split || !showPanel) scrollPosition.current = event.nativeEvent.contentOffset.y; }}>
    <View style={styles.context}><View style={styles.contextCopy}><Text style={styles.title}>{model.child.name}的記錄</Text><Text style={styles.body}>{model.child.summary}</Text></View>
      <View style={styles.actions}>{onPhotos ? <AppButton label="照片與記錄" density="compact" variant="secondary" onPress={onPhotos} disabled={occupied || loading} /> : null}<AppButton label="新增記錄" density="compact" onPress={() => { rememberList(null); actions.startCreate(); }} disabled={model.access !== "editable" || occupied || loading} /></View></View>
    <Text style={styles.meta}>{model.dataLabel}</Text>
    {!model.online ? <View style={styles.notice}><Text style={styles.noticeText}>目前離線。已載入資料可能不是最新；本次草稿保留，恢復連線後由你重試。</Text></View> : null}
    {model.access === "read_only" ? <View style={styles.notice}><Text style={styles.noticeText}>你是檢視者，可閱讀記錄及歷史；新增、更正及刪除須由擁有人或照顧者處理。</Text></View> : null}
    <OperationNotice state={model.operation.state} visible={!(model.operation.state === "needs_confirmation" && model.draft?.reviewedValues)} title={operationTitle} message={model.operation.message} referenceLabel={model.operation.reference ? `合成操作參考：${model.operation.reference}；不是 Server opId。` : undefined}>
      {model.operation.state === "unknown" ? <AppButton label={model.checkLabel} disabled={!model.online} onPress={actions.checkOriginalOperation} /> : null}
      {model.operation.state === "unknown" && model.operation.retryAvailable ? <AppButton label="重試同一原操作" disabled={!model.online} onPress={actions.retryOriginalOperation} /> : null}
    </OperationNotice>
    {model.access === "lost" ? <SectionCard><SectionHeader title="已無權查看這個孩子" /><Text style={styles.body}>記錄、歷史與草稿已清除。請返回有權存取的孩子或重新確認登入身份。</Text></SectionCard> : <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={[styles.columns, !split && styles.stack]}>
      <MotionDetail activeKey={showPanel ? "panel" : "list"} scopeKey={motionScope} direction="back" compact={!split && !showPanel} style={[styles.listColumn, !listVisible && styles.hidden]}><View ref={listFocusRef} testID="care-record-list" tabIndex={-1} accessibilityElementsHidden={!listVisible} importantForAccessibility={listVisible ? "auto" : "no-hide-descendants"} aria-hidden={!listVisible} pointerEvents={listVisible ? "auto" : "none"}><SectionCard><SectionHeader title="已確認記錄" density="compact" subtitle="按最初加入時間排列；搜尋內容不寫入 URL。" />
        <AppTextField dense label="搜尋照顧記錄" accessibilityLabel="搜尋照顧記錄" maxLength={200} value={query} onChangeText={setQuery} onSubmitEditing={search} disabled={occupied} />
        <View style={styles.actions}><AppSelect label="篩選種類" value={kind} options={[{ value: "all", label: "全部" }, ...careKindOptions]} onChange={setKind} disabled={occupied} />
          <AppButton label="搜尋記錄" density="compact" onPress={search} disabled={!model.online || loading || occupied} /><AppButton label="清除搜尋" density="compact" variant="quiet" disabled={!model.online || loading || occupied} onPress={() => { listAnchor.current = null; setVisitedId(null); setQuery(""); setKind("all"); actions.search("", "all"); }} /></View>
        <Text style={styles.meta}>目前條件：{model.list.activeQuery || "不限文字"} · {model.list.activeKind === "all" ? "全部種類" : careKindOptions.find(item => item.value === model.list.activeKind)?.label}{model.list.state !== "loading" ? `；已載入 ${model.list.records.length} 筆。` : "。"}</Text>
        <ReadStateNotice state={listReadState} message={readMessage}>{model.list.state === "error" ? <AppButton label="重試搜尋" density="compact" onPress={search} disabled={!model.online} /> : model.list.state === "stale" ? <AppButton label="重新搜尋" density="compact" onPress={search} disabled={!model.online} /> : null}</ReadStateNotice>
        {model.list.state !== "loading" && model.list.state !== "error" ? <>
          <MotionList items={model.list.records} keyExtractor={record => record.id} scopeKey={`${listContext}:${model.access}:${listVisible ? "visible" : "hidden"}`} regionKey="care-records" style={styles.list} eligible={model.operation.state === "saved" && !loading && !previousLoading.current && listVisible} renderItem={(record, { exiting }) => {
            const option = careKindOptions.find(item => item.value === record.current.values.kind)!;
            return <Pressable key={record.id} testID={`care-row-${record.id}`} ref={node => { if (node) rowRefs.current.set(record.id, node); else rowRefs.current.delete(record.id); }} accessibilityRole="button" accessibilityLabel={`查看${record.title}`} aria-current={model.detail?.record.id === record.id ? "true" : undefined} disabled={occupied || exiting} onPress={() => { rememberList(record.id); actions.openRecord(record.id); }} style={({ pressed }) => [styles.row, model.detail?.record.id === record.id && styles.selectedRow, pressed && styles.pressed]}>
              <View style={styles.icon}><AppIcon name={option.icon} size={23} color={colors.teal} /></View><View style={styles.rowCopy}><Text style={styles.rowTitle}>{record.title}</Text><MotionReveal value={record.current.values.text} contentKey={record.current.values.text} scopeKey={`${motionScope}:${record.id}`} regionKey="record-text" triggerKey={revealIntent} eligible={model.operation.state === "saved" && listVisible && !exiting} preset="local">{text => <Text numberOfLines={2} style={styles.body}>{text}</Text>}</MotionReveal>
                <Text style={styles.meta}>事件：{record.current.values.eventTimeRaw || "未知"}</Text><Text style={styles.meta}>加入：{record.createdAtLabel}</Text><Text style={styles.version}>已確認 · 版本 {record.current.version}{model.detail?.record.id === record.id ? " · 正在查看" : visitedId === record.id ? " · 上次查看" : ""}</Text></View><AppIcon name="chevron-right" size={18} />
            </Pressable>;
          }} />
        </> : null}
        {model.list.state !== "loading" ? <Text style={styles.meta}>已掃描 {model.list.scanned} 筆；以上數量不是全部記錄總數。</Text> : null}
        {model.list.hasMore && model.list.state !== "error" ? <AppButton label="載入下一頁" variant="secondary" loading={model.list.state === "loading_more"} disabled={!model.online || loading || occupied} onPress={actions.loadMore} /> : model.list.state === "ready" ? <Text style={styles.meta}>這次搜尋已到最後一頁。</Text> : null}
      </SectionCard></View></MotionDetail>
      <MotionDetail activeKey={showPanel ? "panel" : "list"} scopeKey={motionScope} direction="forward" compact={!split && showPanel} style={[styles.panel, !split && styles.fullPanel, !showPanel && styles.hidden]}>{model.deletion ? <CareRecordDelete model={model} actions={actions} /> : model.draft ? <CareRecordForm key={model.draft.key} model={model} actions={actions} /> : null}
        {detailPresentation ? <View style={!model.detail && styles.hidden} accessibilityElementsHidden={!model.detail} importantForAccessibility={model.detail ? "auto" : "no-hide-descendants"} aria-hidden={!model.detail} pointerEvents={model.detail ? "auto" : "none"}><MotionEntrance triggerKey={createdDetailId} scopeKey={motionScope} preset="detail-add" enabled={!!model.detail && model.detail.record.id === createdDetailId}><CareRecordDetail detail={detailPresentation} actions={actions} canEdit={model.access === "editable"} online={model.online} active={!!model.detail} revealIntent={revealIntent} revealEligible={model.operation.state === "saved" && !!model.detail} /></MotionEntrance></View> : null}
      </MotionDetail>
    </View>}
    {previewControls}
  </PageFrame>;
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  hidden: { display: "none" },
  columns: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg }, stack: { flexDirection: "column" }, listColumn: { flex: 1, minWidth: 0, width: "100%" }, panel: { width: 360, minWidth: 0 }, fullPanel: { width: "100%" },
  context: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.softLine }, contextCopy: { flexGrow: 1, flexShrink: 1, gap: spacing.xs },
  title: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section, fontWeight: "700" }, body: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool }, meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm }, loading: { flexDirection: "row", alignItems: "center", gap: spacing.md }, operation: { backgroundColor: colors.white, padding: spacing.lg, borderRadius: radius.medium, gap: spacing.sm },
  notice: { backgroundColor: colors.paleAmber, padding: spacing.md, borderRadius: radius.small, gap: spacing.sm }, noticeText: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.tool },
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.softLine, paddingVertical: spacing.md, minHeight: 90 }, selectedRow: { borderLeftWidth: 3, borderLeftColor: colors.teal, paddingLeft: spacing.sm }, rowCopy: { flex: 1, minWidth: 0, gap: spacing.xs }, rowTitle: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.row, fontWeight: "700" },
  icon: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.paleTeal, alignItems: "center", justifyContent: "center" }, version: { fontFamily: chineseFont, color: colors.deepTeal, ...readingType.meta }, pressed: { opacity: 0.65 },
});
