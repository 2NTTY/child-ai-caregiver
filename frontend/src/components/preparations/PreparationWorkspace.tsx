import { HistoryCardGrid } from "../history/HistoryCards";
import { EmptyListCard } from "../EmptyListCard";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Platform, Pressable, StyleSheet, View, type ScrollView } from "react-native";
import { Text } from "react-native-paper";
import {
  canArchivePreparation, canChangePreparation, preparationDateLabel, preparationPurposeLabel, preparationPurposes, searchPreparationHistory,
  type PreparationCondition, type PreparationDateRange, type PreparationDocumentView, type PreparationPurpose,
} from "../../preparation-view-model";
import { usePreparationWorkspace, type PreparationWorkspaceValue } from "../../workspaces/PreparationWorkspace";
import { WriteRecoveryNotice } from "../WriteRecoveryNotice";
import { chineseFont, colors, radius, readingType, spacing } from "../../theme";
import { AppCheckbox } from "../AppCheckbox";
import { AppIcon, type AppIconName } from "../AppIcon";
import { AppStatusBadge, type AppStatusTone } from "../AppStatusBadge";
import { AppButton, AppSelect } from "../ui";
import { useContainerWidth } from "../useContainerWidth";
import { SummaryDisclosure } from "../summary/SummaryDisclosure";
import { FormDialog, ManualFormDialog } from "../FormDialog";
import { DocumentCreateForm } from "./DocumentCreateForm";

const stateLabels: Record<PreparationDocumentView["readState"], { label: string; tone: AppStatusTone; detail: string }> = {
  ready: { label: "可查閱", tone: "success", detail: "" },
  stale: { label: "來源已有更新", tone: "warning", detail: "這份準備使用較早資料，內容保留作參考；如已使用完畢，可直接歸檔並保留此版本；如要改清單，請先核對更新後的來源。" },
  restricted: { label: "來源權限已改變", tone: "warning", detail: "來源權限已改變，正文及清單暫不可讀，不能修改或歸檔。" },
  invalidated: { label: "來源已失效", tone: "warning", detail: "來源已失效，正文及清單暫不可讀，不能修改或歸檔。" },
  unknown: { label: "來源狀態未知", tone: "warning", detail: "尚未確認這份準備的來源及版本，內容暫不展示，也不能修改或歸檔。" },
};
function PreparationEmptyState({ workspace, history = false }: { workspace: PreparationWorkspaceValue; history?: boolean }) {
  const { condition } = workspace.model;
  if (condition === "refresh_failed") return null;
  const ready = workspace.model.online && ["ready", "empty", "read_only"].includes(condition);
  const reading = workspace.model.reading;
  if (ready && history && reading && (!reading.archiveReady || reading.pageBusy || reading.pageError)) {
    return reading.pageError ? null : <Text style={styles.meta}>{reading.pageBusy ? "正在讀取歸檔準備單" : "歸檔準備單尚未讀取成功，請繼續讀取。"}</Text>;
  }
  const partial = history ? reading?.archiveHasMore : reading?.activeHasMore;
  if (ready) return <EmptyListCard testID="preparation-empty" title={partial ? "已載入頁面暫無符合條件的準備單" : history ? "這裏還沒有符合條件的準備單" : "目前沒有已備妥的準備單"}
    detail={partial ? "仍有更多文件未載入，可繼續讀取。" : history ? "試試其他搜尋或日期。" : "可以先到助手交代用途、日期和需要，之後在這裏打開已整理的文件。"} />;
  const title = condition === "loading" ? "正在讀取準備單" : condition === "unavailable" ? "暫時未能取得準備單"
    : condition === "lost" ? "孩子權限已失效" : "準備單最新狀態尚未核對";
  const detail = condition === "loading" ? "" : condition === "unavailable" ? "請重新讀取。"
    : condition === "lost" ? "準備單及歷史內容已隱藏，請先確認孩子的存取權。" : "請連線後重新讀取，不能據此判斷沒有準備單。";
  return <View testID="preparation-empty" style={styles.empty}><Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>{detail ? <Text style={styles.meta}>{detail}</Text> : null}</View>;
}

function PreparationMetadata({ icon, label, value }: { icon: AppIconName; label: string; value: string }) {
  return <View accessible accessibilityLabel={`${label}：${value}`} style={styles.metadataItem}>
    <AppIcon name={icon} size={14} /><Text style={styles.meta}>{value}</Text>
  </View>;
}

function PreparationRow({ document, selected, onPress, rowRef, history = false }: { document: PreparationDocumentView; selected: boolean; history?: boolean; onPress(): void; rowRef(node: View | null): void }) {
  const state = stateLabels[document.readState], revision = document.revision;
  return <Pressable ref={rowRef} testID={`preparation-row-${document.id}`} accessibilityRole="button"
    accessibilityLabel={`開啟${revision?.title ?? "暫不能查看的準備單"}`} accessibilityState={{ selected }} aria-selected={selected}
    onPress={onPress} style={({ pressed }) => [styles.documentRow, history && styles.historyCard, selected && (history ? styles.selectedHistoryRow : styles.selectedRow), pressed && (selected ? styles.selectedPressedRow : styles.pressedRow)]}>
    <Text numberOfLines={history ? 2 : undefined} accessibilityRole="header" style={styles.rowTitle}>{revision?.title ?? "暫不能查看的準備單"}</Text>
    <Text numberOfLines={history ? 3 : undefined} style={styles.body}>{revision?.summary ?? state.detail}</Text>
    <View style={styles.row}><PreparationMetadata icon="preparation-outline" label="用途" value={preparationPurposeLabel(document.purpose)} /><AppStatusBadge label={document.status === "archived" && document.readState === "ready" ? "已歸檔" : state.label} tone={document.status === "archived" && document.readState === "ready" ? "neutral" : state.tone} /></View>
    {document.status === "archived" || revision?.eventDate || !history ? <View style={styles.row}>
      {document.status === "archived" ? <PreparationMetadata icon="history" label="歸檔日期" value={`歸檔 ${preparationDateLabel(document.archivedAt)}`} />
        : revision?.eventDate ? <PreparationMetadata icon="calendar-outline" label="使用日期" value={`使用 ${preparationDateLabel(revision.eventDate)}`} /> : null}
      {!history ? <Text style={styles.openLabel}>打開準備單 ›</Text> : null}
    </View> : null}
  </Pressable>;
}

function PreparationDocumentDetail({ document, workspace, onClose, onHistory, onPrepareQuestion, hideReturnAction = false }: {
  document: PreparationDocumentView; workspace: PreparationWorkspaceValue; onClose(): void; onHistory?(): void; onPrepareQuestion?: (question: string) => void; hideReturnAction?: boolean;
}) {
  const [sourceOpen, setSourceOpen] = useState(false), [archiveAsked, setArchiveAsked] = useState(false);
  const [checkingItem, setCheckingItem] = useState<{ sectionId: string; itemId: string } | null>(null);
  const revision = document.revision, state = stateLabels[document.readState], archived = document.status === "archived";
  const reading = workspace.model.reading, index = reading?.indexes.find(value => value.documentId === document.id);
  const content = reading?.content?.documentId === document.id ? reading.content : null;
  const operationPending = !!workspace.model.operation &&
    (["saving", "unknown"].includes(workspace.model.operation.state) || !!workspace.model.operation.recovery);
  const pending = workspace.model.busy || operationPending;
  const editable = canChangePreparation(document, workspace.model.scope) && !pending;
  const canCheck = editable && workspace.model.capabilities?.checkItem === true;
  const keepCheckingControl = pending && !document.historical && document.readState === "ready"
    && document.childId === workspace.model.scope.childId && workspace.model.scope.online
    && workspace.model.scope.role !== "viewer" && ["ready", "unknown"].includes(workspace.model.scope.condition);
  const keepReadControls = keepCheckingControl && workspace.model.busy && workspace.model.scope.condition === "ready";
  const shownCheckSnapshot = useRef<string | null>(null);
  const checkSnapshot = JSON.stringify([workspace.scopeKey, workspace.model.scope.authorityKey, workspace.model.scope.role, document.childId, document.id, document.version, revision?.id, revision?.number]);
  const keepFailedReadControls = shownCheckSnapshot.current === checkSnapshot && !operationPending
    && workspace.model.condition === "refresh_failed" && workspace.model.scope.condition === "refresh_failed"
    && !document.historical && document.status === "active" && document.readState === "ready"
    && document.childId === workspace.model.scope.childId && workspace.model.online && workspace.model.scope.online
    && workspace.model.scope.role !== "viewer";
  useLayoutEffect(() => {
    if (canCheck) shownCheckSnapshot.current = checkSnapshot;
    else if (shownCheckSnapshot.current !== checkSnapshot || !keepReadControls && !keepFailedReadControls) shownCheckSnapshot.current = null;
  }, [canCheck, checkSnapshot, keepReadControls, keepFailedReadControls]);
  const canArchive = canArchivePreparation(document, workspace.model.scope) && !pending && workspace.model.capabilities?.archive === true;
  const checked = revision?.sections.flatMap(section => section.kind === "checklist" ? section.items : []) ?? [];
  useLayoutEffect(() => { setArchiveAsked(false); setSourceOpen(false); }, [document.id, document.version, document.readState, workspace.scopeKey]);
  useLayoutEffect(() => { if (!pending) setCheckingItem(null); }, [pending]);
  return <View testID="preparation-document-detail" style={styles.document}>
    {!hideReturnAction ? <AppButton label={archived ? "返回歸檔清單" : "返回準備單清單"} variant="secondary" density="compact" onPress={onClose} /> : null}
    <View style={styles.documentHeader}>
      <Text accessibilityRole="header" style={styles.documentTitle}>{revision?.title ?? "暫不能查看這份準備"}</Text>
      {revision ? <Text style={styles.body}>{revision.summary}</Text> : null}
      <View style={styles.row}><PreparationMetadata icon="preparation-outline" label="用途" value={preparationPurposeLabel(document.purpose)} />
        <PreparationMetadata icon="account-child-outline" label="孩子" value={workspace.model.child.displayName} />
        <AppStatusBadge label={archived ? "已歸檔" : state.label} tone={archived ? "neutral" : state.tone} /></View>
      {revision ? <View style={styles.row}>
        {revision.eventDate ? <PreparationMetadata icon="calendar-outline" label="使用日期" value={`使用 ${preparationDateLabel(revision.eventDate)}`} /> : null}
        <PreparationMetadata icon="history" label="更新日期" value={`更新 ${preparationDateLabel(revision.updatedAt)}`} />
        <PreparationMetadata icon="file-document-outline" label="資料截至" value={`資料截至 ${preparationDateLabel(revision.sourceAsOf)}`} />
      </View> : null}
    </View>
    {state.detail && !content ? <View style={styles.warning}><AppStatusBadge label={state.label} tone={state.tone} /><Text style={styles.body}>{state.detail}</Text></View> : null}
    {!workspace.model.online ? <Text accessibilityRole="alert" style={styles.warningText}>目前離線，只可閱讀已載入內容；清單及歸檔暫停。</Text> : null}
    {workspace.model.scope.role === "viewer" || workspace.model.condition === "read_only" ? <Text style={styles.meta}>目前為唯讀，可以打開文件，不能改清單或歸檔。</Text> : null}
    {archived ? <View style={styles.archiveNote}><AppStatusBadge label="保留使用時的版本" tone="info" /><Text style={styles.meta}>歸檔於 {preparationDateLabel(document.archivedAt)}。這份內容保留作回看，不會再出現在待用清單。</Text></View> : null}
    {content && !content.complete ? <View style={styles.warning} testID="preparation-version-content">
      <Text style={styles.body}>{content.invalidated ? "這個版本的來源已失效，正文已隱藏。" : content.error ? "這個版本未能讀取，可沿同一版本繼續。" : content.busy ? "正在讀取這個版本…" : `已讀取 ${content.loadedCharacters}／${content.totalCharacters} 字，完成後可閱讀正文。`}</Text>
      {!content.invalidated ? <AppButton label={content.error ? "重試讀取這個版本" : "繼續載入這個版本"} variant="quiet" disabled={content.busy || !reading?.online} onPress={() => reading?.continueVersion()} /> : null}
    </View> : null}
    {document.historical ? <View style={styles.row}><AppStatusBadge label="較早修訂，唯讀" tone="info" /><AppButton label="回到目前正文" variant="quiet" onPress={() => reading?.closeVersion()} /></View> : null}
    {revision?.sections.map(section => <View key={section.id} style={styles.section}>
      <View style={styles.row}><Text accessibilityRole="header" style={styles.sectionTitle}>{section.title}</Text>{section.kind === "checklist" ? <Text style={styles.meta}>{checked.filter(item => item.checked).length}／{checked.length} 項已核對</Text> : null}</View>
      {section.items.map((item, index) => section.kind === "checklist"
        ? archived || !canCheck && !(keepReadControls || keepFailedReadControls || keepCheckingControl && (!!workspace.model.checkSave || checkingItem?.sectionId === section.id && checkingItem.itemId === item.id)) ? <View key={item.id} style={styles.textRow}><Text style={styles.checkMark}>{item.checked ? "☑" : "☐"}</Text><Text style={styles.reading}>{item.text}</Text></View>
          : <AppCheckbox key={item.id} label={item.text} checked={!!item.checked} disabled={!canCheck} onChange={value => {
            if (!canCheck) return;
            setCheckingItem({ sectionId: section.id, itemId: item.id });
            workspace.actions.checkItem(document.id, document.version, section.id, item.id, value);
          }} />
        : <View key={item.id} style={styles.textRow}><Text style={styles.bullet}>{section.kind === "questions" ? `${index + 1}.` : "·"}</Text><Text style={styles.reading}>{item.text}</Text></View>)}
    </View>)}
    {revision ? <View style={styles.section}>
      <AppButton label="來源與版本" variant="quiet" density="compact" expanded={sourceOpen} onPress={() => { setSourceOpen(value => !value); if (!sourceOpen && index && !index.started) reading?.loadVersions(document.id); }} />
      {sourceOpen ? <View style={styles.stack}>
        <Text style={styles.meta}>正文版本 {revision.number} · 文件版本 {document.version}</Text>
        {document.sources.map(source => <View key={source.id} style={styles.stack}>
          <PreparationMetadata icon="file-document-outline" label="來源" value={source.label} />
          <View style={styles.row}>
            <PreparationMetadata icon={source.visibility === "private" ? "lock-outline" : "account-group-outline"} label="來源可見範圍" value={source.visibility === "private" ? "私人來源" : "家庭來源"} />
            <PreparationMetadata icon="calendar-outline" label="來源日期" value={preparationDateLabel(source.updatedAt)} />
            {source.version !== revision.sourceRefs.find(ref => ref.id === source.id)?.version ? <Text style={styles.warningText}>已有較新版本</Text> : null}
          </View>
        </View>)}
        {index ? <View style={styles.stack} testID="preparation-version-index">
          <Text style={styles.meta}>較早修訂按需讀取，這份清單只涵蓋已載入版本。</Text>
          {index.versions.map(version => <AppButton key={version.snapshotId} label={`正文版本 ${version.snapshotVersion} · ${preparationDateLabel(version.generatedAt)}${version.invalidated ? " · 來源已失效" : ""}`} variant="quiet" density="compact" disabled={version.invalidated || !reading?.online} onPress={() => reading?.readVersion(document.id, version.snapshotId, version.snapshotVersion)} />)}
          {index.error ? <Text accessibilityRole="alert" style={styles.warningText}>未能讀取較早修訂。</Text> : null}
          {!index.started || index.hasMore || index.error ? <AppButton label={index.busy ? "正在讀取修訂…" : index.error ? "重試讀取修訂" : "載入更多修訂"} variant="quiet" disabled={index.busy || !reading?.online} onPress={() => reading?.loadVersions(document.id)} /> : null}
        </View> : null}
        <Text selectable style={styles.meta}>文件：{document.id}{"\n"}正文：{revision.id}{"\n"}來源：{revision.sourceRefs.map(ref => `${ref.id} · v${ref.version}`).join("；")}</Text>
      </View> : null}
    </View> : null}
    {!archived && workspace.model.capabilities?.refresh && document.readState !== "ready" ? <AppButton label="按目前共享來源整理新版本" variant="secondary"
      onPress={() => workspace.actions.refreshDocument?.(document.id, document.version)} /> : null}
    {archived && !document.historical && workspace.model.capabilities?.restore ? <AppButton label="恢復這份準備單" variant="secondary" onPress={() => workspace.actions.restoreDocument?.(document.id, document.version)} /> : null}
    {!archived ? <View style={styles.footer}>
      {workspace.model.notice && workspace.model.condition !== "refresh_failed" ? <Text accessibilityLiveRegion="polite" style={styles.meta}>{workspace.model.notice}</Text> : null}
      <View style={styles.actions}><AppButton label="到助手補充／更新" variant="secondary" disabled={!revision || !workspace.model.online || !onPrepareQuestion} onPress={() => onPrepareQuestion?.(`請幫我更新${workspace.model.child.displayName}的「${revision!.title}」準備單；先核對現有資料及未確認的地方。`)} />
        <AppButton label="使用完畢，歸檔" variant="quiet" disabled={!canArchive} onPress={() => setArchiveAsked(true)} /></View>
      {archiveAsked && canArchive ? <View testID="preparation-archive-confirm" style={styles.archiveNote}>
        <Text style={styles.body}>把「{revision?.title}」移到歷史？會保留目前版本，只歸檔這一份準備單。</Text>
        {workspace.model.archiveNotice ? <Text style={styles.meta}>{workspace.model.archiveNotice}</Text> : null}
        <View style={styles.actions}><AppButton label="歸檔這份準備" onPress={() => workspace.actions.archiveDocument(document.id, document.version)} /><AppButton label="繼續使用" variant="secondary" onPress={() => setArchiveAsked(false)} /></View>
      </View> : null}
    </View> : onHistory ? <AppButton label="查看準備單歷史" variant="secondary" onPress={onHistory} /> : null}
  </View>;
}

function PreparationListGrid({ history, children }: { history: boolean; children: ReactNode }) {
  return history ? <HistoryCardGrid testID="preparation-history-cards">{children}</HistoryCardGrid> : <>{children}</>;
}

type ReadingProps = { scrollRef?: RefObject<ScrollView | null>; getScrollPosition?(): number };

function PreparationReader({ workspace, documents, history = false, onHistory, onPrepareQuestion, scrollRef, getScrollPosition }: ReadingProps & {
  workspace: PreparationWorkspaceValue; documents: readonly PreparationDocumentView[]; history?: boolean; onHistory?(): void; onPrepareQuestion?: (question: string) => void;
}) {
  const layout = useContainerWidth(), wide = layout.width >= 840;
  const selected = workspace.model.selected?.status === (history ? "archived" : "active") && documents.some(item => item.id === workspace.model.selected!.id) ? workspace.model.selected : null;
  const archivedSelection = !history && workspace.model.justArchivedId;
  const rowRefs = useRef(new Map<string, View>()), listRef = useRef<View>(null), panelRef = useRef<View>(null);
  const returnFocus = useRef<View>(null), readerKey = useRef<string | null>(null);
  if (history && selected) readerKey.current = `${workspace.scopeKey}:${selected.id}`;
  const anchor = useRef<{ id: string; y: number; scope: string } | null>(null), previousSelected = useRef<string | null>(null);
  const previousPanel = useRef<View | null>(null), returnState = useRef({ scope: workspace.scopeKey, selected: workspace.model.selected?.id, condition: workspace.model.condition });
  returnState.current = { scope: workspace.scopeKey, selected: workspace.model.selected?.id, condition: workspace.model.condition };
  useLayoutEffect(() => {
    const before = previousSelected.current, closingPanel = previousPanel.current as unknown as HTMLElement | null;
    previousSelected.current = selected?.id ?? null; previousPanel.current = panelRef.current;
    // History uses an independent modal and leaves the list viewport untouched.
    // The regular preparation workspace retains its existing split/return flow.
    if (history) return;
    if (!before && selected && !wide) {
      scrollRef?.current?.scrollTo({ y: 0, animated: false });
      if (Platform.OS === "web") (panelRef.current as unknown as HTMLElement | null)?.focus({ preventScroll: true });
    } else if (before && !selected && anchor.current?.scope === workspace.scopeKey) {
      if (!wide) scrollRef?.current?.scrollTo({ y: anchor.current.y, animated: false });
      if (Platform.OS !== "web" || typeof document === "undefined" || workspace.model.condition === "lost") return;
      const saved = anchor.current;
      const candidates = () => [rowRefs.current.get(saved.id), listRef.current] as unknown as (HTMLElement | null | undefined)[];
      const neutralFocus = (target: Element | null) => !target?.isConnected || target === document.body || target === document.documentElement;
      const active = document.activeElement;
      // A filter, navigation or another control may already have claimed focus.
      if (!neutralFocus(active) && active !== closingPanel && !closingPanel?.contains?.(active) && !candidates().includes(active as HTMLElement)) return;
      const restore = () => {
        for (const target of candidates()) {
          if (!target?.isConnected || !target.getClientRects().length || target.closest?.('[hidden], [inert], [aria-hidden="true"]')) continue;
          if (typeof window !== "undefined" && ["hidden", "collapse"].includes(window.getComputedStyle(target).visibility)) continue;
          try { target.focus({ preventScroll: true }); } catch { continue; }
          if (document.activeElement === target) return;
        }
      };
      restore();
      if (typeof requestAnimationFrame !== "function") return;
      // One post-layout chance only, without overriding newer selection, scope or focus.
      const restored = document.activeElement;
      let focusMoved = false;
      const onFocus = (event: FocusEvent) => { if (event.target !== restored) focusMoved = true; };
      document.addEventListener("focusin", onFocus, true);
      const frame = requestAnimationFrame(() => {
        document.removeEventListener("focusin", onFocus, true);
        const current = returnState.current;
        if (focusMoved || current.scope !== saved.scope || current.selected || current.condition === "lost" || anchor.current !== saved) return;
        if (neutralFocus(document.activeElement)) restore();
      });
      return () => { cancelAnimationFrame(frame); document.removeEventListener("focusin", onFocus, true); };
    }
  }, [selected?.id, wide, workspace.scopeKey, workspace.model.condition, history]);
  return <View ref={layout.ref} onLayout={layout.onLayout} style={styles.stack}>
    {archivedSelection ? <View accessibilityLiveRegion="polite" testID="preparation-archive-success" style={styles.archiveNote}>
      <AppStatusBadge label={workspace.model.dataLabel?.startsWith("Server") ? "已歸檔" : "已在本次預覽歸檔"} tone="success" /><Text style={styles.body}>這份準備單已移到歷史，使用時的版本仍保留。</Text>
      {onHistory ? <AppButton label="到歷史查看" variant="secondary" onPress={onHistory} /> : null}
      <AppButton label="繼續看其他準備" variant="quiet" density="compact" onPress={workspace.actions.closeDocument} />
    </View> : null}
    <View style={[styles.stack, !history && wide && selected && styles.split]}>
      {history || !selected || wide ? <View ref={listRef} tabIndex={-1} accessibilityLabel={history ? "已歸檔準備單清單" : "準備單清單"} testID="preparation-document-list" style={[styles.list, !history && wide && selected && styles.listColumn]}>
        {documents.length ? <PreparationListGrid history={history}>{documents.map(document => <PreparationRow history={history} key={document.id} document={document} selected={selected?.id === document.id}
          rowRef={node => { if (node) rowRefs.current.set(document.id, node); else rowRefs.current.delete(document.id); }}
          onPress={() => { returnFocus.current = rowRefs.current.get(document.id) ?? null; if (!history) anchor.current = { id: document.id, y: getScrollPosition?.() ?? 0, scope: workspace.scopeKey }; workspace.actions.selectDocument(document.id); }} />)}</PreparationListGrid>
          : <PreparationEmptyState workspace={workspace} history={history} />}
      </View> : null}
      {!history && selected ? <View ref={panelRef} tabIndex={-1} style={styles.detailColumn}><PreparationDocumentDetail key={`${workspace.scopeKey}:${selected.id}`} document={selected} workspace={workspace}
        onClose={workspace.actions.closeDocument} onHistory={onHistory} onPrepareQuestion={onPrepareQuestion} /></View> : null}
    </View>
    {history ? <FormDialog key={readerKey.current} visible={!!selected && workspace.model.condition !== "lost"} scopeKey={workspace.scopeKey} formKey={readerKey.current ?? undefined} title="準備單詳情" dismissMode="local"
      returnFocusRef={returnFocus} fallbackFocusRef={listRef} onClose={workspace.actions.closeDocument}
      recovery={workspace.model.operation ? <WriteRecoveryNotice plainLanguage showReference={false} operation={workspace.model.operation} recovery={workspace.recovery} online={workspace.model.online} /> : null}
      closeOutcome={{ revision: workspace.model, ready: !workspace.model.selected }}>
      {selected ? <PreparationDocumentDetail document={selected} workspace={workspace} onClose={workspace.actions.closeDocument} onPrepareQuestion={onPrepareQuestion} hideReturnAction /> : null}
    </FormDialog> : null}
  </View>;
}

export function PreparationWorkspace({ onHistory, onPrepareQuestion, previewControls, scrollRef, getScrollPosition }: ReadingProps & {
  onHistory?(): void; onPrepareQuestion?: (question: string) => void; previewControls?: ReactNode;
}) {
  const workspace = usePreparationWorkspace();
  const [purpose, setPurpose] = useState<PreparationPurpose>("appointment");
  if (!workspace) return <Text style={styles.meta}>先選擇有權查看的孩子，再打開準備單。</Text>;
  const active = workspace.model.documents.filter(document => document.status === "active");
  const selected = workspace.model.selected?.status === "active";
  const quietRead = !!workspace.model.busy && workspace.model.online && ["ready", "empty", "read_only"].includes(workspace.model.condition)
    && !workspace.model.dirty && (!workspace.model.operation || workspace.model.operation.state === "none");
  return <View testID="preparation-workspace" style={styles.workspace}>
    <Text testID="preparation-check-save" style={styles.meta}>{workspace.model.checkSave === "queued" ? "勾選尚未同步，稍後自動保存。"
      : workspace.model.checkSave === "saving" ? "正在背景保存，可繼續勾選。"
      : workspace.model.checkSave === "unknown" ? "勾選結果待核對，未保存的修改仍保留。"
      : workspace.model.checkSave === "conflict" ? "清單需要重新核對，未保存的修改仍保留。" : "勾選會在背景自動保存。"}</Text>
    {workspace.model.checkSave === "conflict" && workspace.model.canReapplyChecks ? <View style={styles.row}>
      <AppButton label="按目前版本重新套用勾選" variant="quiet" onPress={workspace.actions.reapplyChecks} />
      <AppButton label="捨棄未保存勾選" variant="quiet" onPress={workspace.actions.discardChecks} />
    </View> : null}
    {workspace.model.operation ? <WriteRecoveryNotice plainLanguage showReference={false} operation={workspace.model.operation} recovery={workspace.recovery} online={workspace.model.online} /> : null}
    {workspace.model.condition === "refresh_failed" ? <Text testID="preparation-refresh-error" accessibilityRole="alert" style={styles.warningText}>{active.length ? "更新失敗，顯示上次內容" : "準備單更新失敗"}</Text> : null}
    {!selected ? <Text style={styles.meta}>待用準備單{!workspace.model.online || !["ready", "empty", "read_only"].includes(workspace.model.condition) ? "" : ` · ${active.length} 份`}</Text> : null}
    {!selected ? <View testID="preparation-list-actions" style={styles.intentControls}>
      <AppButton label="到助手準備下一份" variant="secondary" density="compact" disabled={!workspace.model.online || workspace.model.condition === "lost" || !onPrepareQuestion} onPress={() => onPrepareQuestion?.(`請幫我為${workspace.model.child.displayName}整理一份${preparationPurposeLabel(purpose)}。先和我確認用途、日期、已知安排及仍未確定的資料。`)} />
      <View style={styles.purposeField}><AppSelect label="用途" value={purpose} options={preparationPurposes.map(item => ({ value: item.key, label: item.label }))} onChange={setPurpose} /></View>
    </View> : null}
    <PreparationReader workspace={workspace} documents={active} onHistory={onHistory} onPrepareQuestion={onPrepareQuestion} scrollRef={scrollRef} getScrollPosition={getScrollPosition} />
    {!selected && workspace.model.reading?.activeHasMore ? <AppButton label={workspace.model.reading.pageBusy ? "正在載入…" : "載入更多準備單"} variant="quiet" disabled={workspace.model.reading.pageBusy || !workspace.model.reading.online} onPress={() => workspace.model.reading?.loadMoreDocuments("active")} /> : null}
    {workspace.model.reading?.pageError ? <Text accessibilityRole="alert" style={styles.warningText}>未能載入更多文件，已取得的內容保留。</Text> : null}
    <View testID="preparation-secondary-actions" style={styles.intentControls}>
      {!selected && onHistory ? <AppButton label="查看已歸檔" variant="quiet" density="compact" onPress={onHistory} /> : null}
      {workspace.actions.refresh && (["unavailable", "refresh_failed", "unknown"].includes(workspace.model.condition) || workspace.model.operation?.recovery === "check") ? <AppButton label={workspace.model.busy && !quietRead ? "正在處理文件…" : workspace.model.operation?.recovery === "check" ? "重新載入" : "重新載入"}
        variant="quiet" density="compact" disabled={workspace.model.busy || !workspace.model.online || workspace.model.condition === "lost"} preserveFocusWhenDisabled={quietRead} onPress={workspace.actions.refresh} /> : null}
    </View>
    {workspace.actions.createDocument && workspace.actions.markDraft && workspace.actions.discardDraft && workspace.model.scope.role !== "viewer" ? <ManualFormDialog label="手動建立準備單" title="建立準備單" scopeKey={workspace.scopeKey}
      recovery={workspace.model.operation ? <WriteRecoveryNotice plainLanguage showReference={false} operation={workspace.model.operation} recovery={workspace.recovery} online={workspace.model.online && !workspace.model.busy} /> : null}>
      <DocumentCreateForm kind="preparation" purpose={purpose} owner={{ authorityVersion: workspace.model.authorityVersion ?? "", locked: workspace.model.locked ?? true,
        editingLocked: workspace.model.editingLocked, createDraft: workspace.model.createDraft, dirty: workspace.model.dirty ?? false, epoch: workspace.model.epoch ?? 0, operation: workspace.model.operation, retainedDraftId: workspace.model.retainedDraftId,
        createDocument: workspace.actions.createDocument, markDraft: workspace.actions.markDraft, discardDraft: workspace.actions.discardDraft }} />
    </ManualFormDialog> : null}
    {previewControls}
  </View>;
}

export function PreparationHistoryView({ searchText, dateRange, onPrepareQuestion, previewControls, scrollRef, getScrollPosition }: ReadingProps & {
  searchText: string; dateRange: PreparationDateRange; onPrepareQuestion?: (question: string) => void; previewControls?: ReactNode;
}) {
  const workspace = usePreparationWorkspace();
  const reading = workspace?.model.reading;
  useEffect(() => { reading?.ensureArchived(); }, [workspace?.scopeKey, reading?.archiveStarted, reading?.pageBusy]);
  if (!workspace) return <Text style={styles.meta}>先選擇有權查看的孩子，再查看準備單歷史。</Text>;
  const documents = searchPreparationHistory(workspace.model.documents, searchText, dateRange);
  const available = workspace.model.online && ["ready", "empty", "read_only"].includes(workspace.model.condition)
    && (!reading || reading.archiveReady && !reading.pageBusy && !reading.pageError);
  const unknownDates = workspace.model.documents.filter(document => document.status === "archived" && !document.archivedAt).length;
  return <View testID="preparation-history" style={styles.workspace}>
    {previewControls}
    {workspace.model.operation ? <WriteRecoveryNotice plainLanguage showReference={false} operation={workspace.model.operation} recovery={workspace.recovery} online={workspace.model.online} /> : null}
    {workspace.actions.refresh && (["unavailable", "refresh_failed", "unknown"].includes(workspace.model.condition) || workspace.model.operation?.recovery === "check") ? <AppButton label="重新載入" variant="quiet" density="compact" disabled={workspace.model.busy || !workspace.model.online || workspace.model.condition === "lost"} onPress={workspace.actions.refresh} /> : null}
    {workspace.model.condition === "refresh_failed" ? <Text testID="preparation-refresh-error" accessibilityRole="alert" style={styles.warningText}>{documents.length ? "更新失敗，顯示上次內容" : "準備單更新失敗"}</Text> : null}
    <Text style={styles.meta}>只搜尋可查看的已歸檔準備單：標題、內容、用途及來源名稱。日期按歸檔時間，並非使用日期。{available ? "只涵蓋目前已載入資料。" : "目前尚未取得可確認的結果。"}</Text>
    {unknownDates ? <Text style={styles.meta}>{unknownDates} 份未提供歸檔時間，套用日期範圍時不會把它們歸入任何日期。</Text> : null}
    {available ? <Text style={styles.meta}>{documents.length} 份符合</Text> : null}
    <PreparationReader workspace={workspace} documents={documents} history onPrepareQuestion={onPrepareQuestion} scrollRef={scrollRef} getScrollPosition={getScrollPosition} />
    {reading && (!reading.archiveStarted || reading.archiveHasMore || reading.pageError) ? <AppButton label={reading.pageBusy ? "正在載入歸檔…" : reading.pageError || !reading.archiveReady && reading.archiveStarted ? "重試載入歸檔" : "載入更多歸檔"} variant="quiet" disabled={reading.pageBusy || !reading.online} onPress={() => reading.loadMoreDocuments("archived")} /> : null}
    {reading?.pageError ? <Text accessibilityRole="alert" style={styles.warningText}>未能載入更多歸檔，已取得的內容保留。</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  workspace: { gap: spacing.lg, minWidth: 0 }, stack: { gap: spacing.md, minWidth: 0 }, row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  sectionTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 18, lineHeight: 28, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool }, meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, flexShrink: 1 },
  metadataItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minWidth: 0, maxWidth: "100%", flexShrink: 1 },
  intentControls: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm }, purposeField: { width: 220, maxWidth: "100%", flexShrink: 0 },
  list: { gap: spacing.md, minWidth: 0, flex: 1 }, listColumn: { flex: 0.8 }, detailColumn: { flex: 1.4, minWidth: 0 }, split: { flexDirection: "row", alignItems: "flex-start" },
  historyCard: { flexGrow: 1 },
  documentRow: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.medium, backgroundColor: colors.controlSurface, borderWidth: 1, borderColor: colors.line, minWidth: 0 },
  selectedRow: { borderColor: "transparent", borderWidth: 2, backgroundColor: colors.paleTeal }, selectedHistoryRow: { backgroundColor: colors.paleTeal }, pressedRow: { backgroundColor: colors.quietSurface }, selectedPressedRow: { backgroundColor: colors.selectedNav },
  rowTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 17, lineHeight: 26, fontWeight: "700" }, openLabel: { fontFamily: chineseFont, color: colors.deepTeal, ...readingType.meta, fontWeight: "700" },
  document: { gap: spacing.lg, maxWidth: 820, minWidth: 0 }, documentHeader: { gap: spacing.sm, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.line },
  documentTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 24, lineHeight: 34, fontWeight: "700" },
  section: { gap: spacing.md, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.softLine },
  textRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }, reading: { fontFamily: chineseFont, color: colors.ink, fontSize: 16, lineHeight: 27, flex: 1, minWidth: 0 },
  bullet: { fontFamily: chineseFont, color: colors.teal, fontSize: 16, lineHeight: 27, minWidth: 18 }, checkMark: { color: colors.teal, fontSize: 21, lineHeight: 27 },
  warning: { backgroundColor: colors.paleAmber, borderRadius: radius.small, padding: spacing.md, gap: spacing.sm }, warningText: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.tool },
  archiveNote: { backgroundColor: colors.quietSurface, borderRadius: radius.small, borderWidth: 1, borderColor: colors.line, padding: spacing.md, gap: spacing.md },
  footer: { gap: spacing.md }, actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, empty: { paddingVertical: spacing.lg, gap: spacing.sm },
});
