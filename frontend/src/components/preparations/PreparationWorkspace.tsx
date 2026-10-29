import { historyPage } from "../history/history-page";
import { HistoryPager } from "../history/HistoryPager";
import { EmptyListCard } from "../EmptyListCard";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Platform, StyleSheet, View, type ScrollView } from "react-native";
import { Text } from "react-native-paper";
import {
  canArchivePreparation, canChangePreparation, preparationDateLabel, preparationPurposeLabel, searchPreparationHistory,
  type PreparationDateRange, type PreparationDocumentView,
} from "../../preparation-view-model";
import { usePreparationWorkspace, type PreparationWorkspaceValue } from "../../workspaces/PreparationWorkspace";
import { WriteRecoveryNotice } from "../WriteRecoveryNotice";
import { chineseFont, colors, radius, readingType, spacing } from "../../theme";
import { AppCheckbox } from "../AppCheckbox";
import { AppIcon, type AppIconName } from "../AppIcon";
import { AppStatusBadge, type AppStatusTone } from "../AppStatusBadge";
import { AppButton } from "../ui";
import { useReaderPosition } from "../../navigation/ReaderPosition";
import { serializeHistoryRoute, type HistoryRouteState } from "../../navigation/route-state";
import { ReadStateNotice } from "../ReadStateNotice";
import { useReaderReturn } from "../../navigation/useReaderReturn";
import { ReadTargetLink } from "../ReadTargetLink";
import { ManualFormDialog } from "../FormDialog";
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
    return reading.pageError ? null : <Text style={styles.body}>{reading.pageBusy ? "正在讀取歸檔準備單" : "歸檔準備單尚未讀取成功，請繼續讀取。"}</Text>;
  }
  const partial = history ? reading?.archiveHasMore : reading?.activeHasMore;
  if (ready) return <EmptyListCard testID="preparation-empty" title={partial ? "已載入頁面暫無符合條件的準備單" : history ? "這裏還沒有符合條件的準備單" : "目前沒有已備妥的準備單"}
    detail={partial ? "仍有更多文件未載入，可繼續讀取。" : history ? "試試其他搜尋或日期。" : "可以直接新增準備單，先核對用途、日期和需要。"} />;
  const title = condition === "loading" ? "正在讀取準備單" : condition === "unavailable" ? "暫時未能取得準備單"
    : condition === "lost" ? "孩子權限已失效" : "準備單最新狀態尚未核對";
  const detail = condition === "loading" ? "" : condition === "unavailable" ? "請重新讀取。"
    : condition === "lost" ? "準備單及歷史內容已隱藏，請先確認孩子的存取權。" : "請連線後重新讀取，不能據此判斷沒有準備單。";
  return <View testID="preparation-empty" style={styles.empty}><Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>{title}</Text>{detail ? <Text style={styles.body}>{detail}</Text> : null}</View>;
}

function PreparationMetadata({ icon, label, value }: { icon: AppIconName; label: string; value: string }) {
  return <View accessible accessibilityLabel={`${label}：${value}`} style={styles.metadataItem}>
    <AppIcon name={icon} size={14} /><Text style={styles.meta}>{value}</Text>
  </View>;
}

function PreparationDocumentDetail({ document, workspace, onClose, onHistory, onPrepareQuestion, hideReturnAction = false, headingRef, headingLevel = 2, onRestore, restoreRef }: {
  document: PreparationDocumentView; workspace: PreparationWorkspaceValue; onClose(): void; onHistory?(): void; onPrepareQuestion?: (question: string) => void; hideReturnAction?: boolean; headingRef?: RefObject<View | null>; headingLevel?: 2 | 3; onRestore?(document: PreparationDocumentView): void; restoreRef?: RefObject<View | null>;
}) {
  const evidenceId = useId();
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
  useLayoutEffect(() => { setArchiveAsked(false); setSourceOpen(false); }, [document.id, document.version, document.readState, workspace.scopeKey]);
  useLayoutEffect(() => { if (!pending) setCheckingItem(null); }, [pending]);
  return <View testID="preparation-document-detail" style={styles.document}>
    {!hideReturnAction ? <AppButton label={archived ? "返回歸檔清單" : "返回準備單清單"} variant="quiet" density="compact" onPress={onClose} /> : null}
    <View style={styles.documentHeader}>
      <View ref={headingRef} tabIndex={-1} accessibilityRole="header" aria-level={headingLevel} accessibilityLabel={revision?.title ?? "暫不能查看這份準備"} testID="preparation-reader-heading"><Text style={styles.documentTitle}>{revision?.title ?? "暫不能查看這份準備"}</Text></View>
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
    {workspace.model.scope.role === "viewer" || workspace.model.condition === "read_only" ? <Text style={styles.body}>目前為唯讀，可以打開文件，不能改清單或歸檔。</Text> : null}
    {archived ? <View style={styles.archiveNote}><AppStatusBadge label="保留使用時的版本" tone="info" /><Text style={styles.body}>歸檔於 {preparationDateLabel(document.archivedAt)}。這份內容保留作回看，不會再出現在待用清單。</Text></View> : null}
    {content && !content.complete ? <View style={styles.warning} testID="preparation-version-content">
      <Text style={styles.body}>{content.invalidated ? "這個版本的來源已失效，正文已隱藏。" : content.error ? "這個版本未能讀取，可沿同一版本繼續。" : content.busy ? "正在讀取這個版本…" : `已讀取 ${content.loadedCharacters}／${content.totalCharacters} 字，完成後可閱讀正文。`}</Text>
      {!content.invalidated ? <AppButton label={content.error ? "重試讀取這個版本" : "繼續載入這個版本"} variant="quiet" disabled={content.busy || !reading?.online} onPress={() => reading?.continueVersion()} /> : null}
    </View> : null}
    {document.historical ? <View style={styles.row}><AppStatusBadge label="較早修訂，唯讀" tone="info" /><AppButton label="回到目前正文" variant="quiet" onPress={() => reading?.closeVersion()} /></View> : null}
    {revision?.sections.map(section => <View key={section.id} style={styles.section}>
      <View style={styles.row}><Text accessibilityRole="header" aria-level={headingLevel === 3 ? 4 : 3} style={styles.sectionTitle}>{section.title}</Text>{section.kind === "checklist" ? <Text style={styles.meta}>{section.items.filter(item => item.checked).length}／{section.items.length} 項已核對</Text> : null}</View>
      {section.items.map((item, index) => section.kind === "checklist"
        ? archived || !canCheck && !(keepReadControls || keepFailedReadControls || keepCheckingControl && (!!workspace.model.checkSave || checkingItem?.sectionId === section.id && checkingItem.itemId === item.id)) ? <View key={item.id} accessible accessibilityLabel={`${item.checked ? "已核對" : "未核對"}：${item.text}`} style={styles.textRow}><AppIcon name={item.checked ? "checkbox-marked" : "checkbox-blank-outline"} size={22} color={colors.teal} /><Text style={styles.reading}>{item.text}</Text></View>
          : <AppCheckbox key={item.id} label={item.text} checked={!!item.checked} disabled={!canCheck} onChange={value => {
            if (!canCheck) return;
            setCheckingItem({ sectionId: section.id, itemId: item.id });
            workspace.actions.checkItem(document.id, document.version, section.id, item.id, value);
          }} />
        : <View key={item.id} style={styles.textRow}><Text style={styles.bullet}>{section.kind === "questions" ? `${index + 1}.` : "·"}</Text><Text style={styles.reading}>{item.text}</Text></View>)}
    </View>)}
    {revision ? <View style={styles.section}>
      <AppButton label="來源與版本" variant="quiet" density="compact" expanded={sourceOpen} controls={evidenceId} onPress={() => { setSourceOpen(value => !value); if (!sourceOpen && index && !index.started) reading?.loadVersions(document.id); }} />
      {sourceOpen ? <View nativeID={evidenceId} style={styles.stack}>
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
          <Text style={styles.body}>較早修訂按需讀取，這份清單只涵蓋已載入版本。</Text>
          {index.versions.map(version => <AppButton key={version.snapshotId} label={`正文版本 ${version.snapshotVersion} · ${preparationDateLabel(version.generatedAt)}${version.invalidated ? " · 來源已失效" : ""}`} variant="quiet" density="compact" disabled={version.invalidated || !reading?.online} onPress={() => reading?.readVersion(document.id, version.snapshotId, version.snapshotVersion)} />)}
          {index.error ? <Text accessibilityRole="alert" style={styles.warningText}>未能讀取較早修訂。</Text> : null}
          {!index.started || index.hasMore || index.error ? <AppButton label={index.busy ? "正在讀取修訂…" : index.error ? "重試讀取修訂" : "載入更多修訂"} variant="quiet" disabled={index.busy || !reading?.online} onPress={() => reading?.loadVersions(document.id)} /> : null}
        </View> : null}
        <Text selectable style={styles.meta}>文件：{document.id}{"\n"}正文：{revision.id}{"\n"}來源：{revision.sourceRefs.map(ref => `${ref.id} · v${ref.version}`).join("；")}</Text>
      </View> : null}
    </View> : null}
    {!archived && workspace.model.capabilities?.refresh && document.readState !== "ready" ? <AppButton label="按目前共享來源整理新版本" variant="secondary"
      onPress={() => workspace.actions.refreshDocument?.(document.id, document.version)} /> : null}
    {archived && !document.historical && workspace.model.capabilities?.restore ? <AppButton ref={restoreRef} label="恢復這份準備單" variant="secondary" onPress={() => onRestore ? onRestore(document) : workspace.actions.restoreDocument?.(document.id, document.version)} /> : null}
    {!archived ? <View style={styles.footer}>
      {workspace.model.notice && workspace.model.condition !== "refresh_failed" ? <Text accessibilityLiveRegion="polite" style={styles.body}>{workspace.model.notice}</Text> : null}
      <View style={styles.actions}><AppButton label="到助手補充／更新" variant="quiet" disabled={!revision || !workspace.model.online || !onPrepareQuestion} onPress={() => onPrepareQuestion?.(`請幫我更新${workspace.model.child.displayName}的「${revision!.title}」準備單；先核對現有資料及未確認的地方。`)} />
        <AppButton label="使用完畢，歸檔" variant="quiet" disabled={!canArchive} onPress={() => setArchiveAsked(true)} /></View>
      {archiveAsked && canArchive ? <View testID="preparation-archive-confirm" style={styles.archiveNote}>
        <Text style={styles.body}>把「{revision?.title}」移到歷史？會保留目前版本，只歸檔這一份準備單。</Text>
        {workspace.model.archiveNotice ? <Text style={styles.body}>{workspace.model.archiveNotice}</Text> : null}
        <View style={styles.actions}><AppButton label="歸檔這份準備" onPress={() => workspace.actions.archiveDocument(document.id, document.version)} /><AppButton label="繼續使用" variant="secondary" onPress={() => setArchiveAsked(false)} /></View>
      </View> : null}
    </View> : onHistory ? <AppButton label="查看準備單歷史" variant="secondary" onPress={onHistory} /> : null}
  </View>;
}

type ReadingProps = { scrollRef?: RefObject<ScrollView | null>; getScrollPosition?(): number };

function ActivePreparationReader({ workspace, documents, onHistory, onPrepareQuestion, scrollRef, getScrollPosition }: ReadingProps & {
  workspace: PreparationWorkspaceValue; documents: readonly PreparationDocumentView[]; onHistory?(): void; onPrepareQuestion?: (question: string) => void;
}) {
  const selected = workspace.model.selected?.status === "active" ? workspace.model.selected : null;
  const listRef = useRef<View>(null), headingRef = useRef<View>(null), localScroll = useRef<ScrollView>(null);
  const position = useReaderReturn({ enabled: workspace.model.condition !== "lost", scopeKey: JSON.stringify([workspace.scopeKey, "preparation"]), selectedId: selected?.id ?? null,
    listRef, readerRef: headingRef, scrollRef: scrollRef ?? localScroll });
  const close = () => { position.returning(); workspace.actions.closeDocument(); };
  return <View style={styles.stack}>
    {workspace.model.justArchivedId ? <View accessibilityLiveRegion="polite" testID="preparation-archive-success" style={styles.archiveNote}>
      <AppStatusBadge label={workspace.model.dataLabel?.startsWith("Server") ? "已歸檔" : "已在本次預覽歸檔"} tone="success" /><Text style={styles.body}>這份準備單已移到歷史，使用時的版本仍保留。</Text>
      {onHistory ? <AppButton label="到歷史查看" variant="quiet" onPress={onHistory} /> : null}
      <AppButton label="繼續看其他準備" variant="quiet" onPress={close} />
    </View> : null}
    <View testID="preparation-index-surface" aria-hidden={!!selected} style={[styles.index, selected && styles.hidden]}>
      <View ref={listRef} tabIndex={-1} accessibilityLabel="準備單清單" testID="preparation-document-list" style={styles.list}>
        {documents.length ? documents.map(document => {
          const state = stateLabels[document.readState], revision = document.revision, title = revision?.title ?? "暫不能查看的準備單";
          return <ReadTargetLink key={document.id} ref={node => position.rowRef(document.id, node)} testID={`preparation-row-${document.id}`}
            href={{ pathname: "/growth", params: { tab: "preparation", documentId: document.id } }}
            label={`查看準備單：${title}，${state.label}${revision?.eventDate ? `，使用 ${preparationDateLabel(revision.eventDate)}` : ""}`} style={styles.indexRow}
            onOpen={() => { position.remember(document.id, getScrollPosition?.()); workspace.actions.selectDocument(document.id); }}>
            <Text style={styles.rowTitle}>{title}</Text>
            <View style={styles.row}><Text style={styles.meta}>{preparationPurposeLabel(document.purpose)}</Text><AppStatusBadge label={state.label} tone={state.tone} />
              {revision?.eventDate ? <Text style={styles.meta}>使用 {preparationDateLabel(revision.eventDate)}</Text> : null}</View>
          </ReadTargetLink>;
        }) : <PreparationEmptyState workspace={workspace} />}
      </View>
    </View>
    {selected ? <PreparationDocumentDetail key={`${workspace.scopeKey}:${selected.id}`} document={selected} workspace={workspace}
      headingRef={headingRef} onClose={close} onHistory={onHistory} onPrepareQuestion={onPrepareQuestion} /> : null}
  </View>;
}

// The original owner retains selection, version reads and pending restores.
function PreparationHistoryReader({ workspace, documents, route, onPrepareQuestion, scrollRef, getScrollPosition, signature }: ReadingProps & {
  workspace: PreparationWorkspaceValue; documents: readonly PreparationDocumentView[]; route: HistoryRouteState; signature: string;
  onPrepareQuestion?: (question: string) => void;
}) {
  const selected = workspace.model.selected?.id === route.selectedId && workspace.model.selected.status === "archived"
    && workspace.model.documents.some(item => item.id === route.selectedId) ? workspace.model.selected : null;
  const listRef = useRef<View>(null), headingRef = useRef<View>(null), localScroll = useRef<ScrollView>(null);
  const returnRef = useRef<View>(null), restoreRef = useRef<View>(null), authority = useReaderPosition();
  const scope = JSON.stringify([workspace.scopeKey, workspace.model.scope.authorityKey, "history-preparations"]);
  const position = useReaderReturn({ enabled: workspace.model.condition !== "lost" && (!route.selectedId || !!selected),
    scopeKey: JSON.stringify([scope, signature, route.page]), selectedId: selected?.id ?? null, listRef, readerRef: headingRef, scrollRef: scrollRef ?? localScroll });
  const restore = useRef<{ scope: string; signature: string; id: string; version: number; operation: typeof workspace.model.operation; trigger: HTMLElement; authority: typeof authority } | null>(null);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const moved = (event: FocusEvent) => { if (restore.current && event.target !== restore.current.trigger && event.target !== document.body) restore.current = null; };
    document.addEventListener("focusin", moved); return () => document.removeEventListener("focusin", moved);
  }, []);
  useLayoutEffect(() => {
    const intent = restore.current; if (!intent) return;
    if (scope !== intent.scope || signature !== intent.signature || route.selectedId !== intent.id || workspace.model.condition === "lost" || !intent.authority.meta.isCurrent()
      || ["failed", "conflict"].includes(workspace.model.operation?.state ?? "none")) { restore.current = null; return; }
    const result = workspace.model.selected;
    if (workspace.model.busy || workspace.model.operation === intent.operation || workspace.model.operation?.state !== "saved"
      || !result || result.id !== intent.id || result.version <= intent.version || result.status !== "active") return;
    restore.current = null;
    if (!intent.trigger.isConnected && document.activeElement === document.body) (returnRef.current as unknown as HTMLElement | null)?.focus({ preventScroll: true });
  }, [workspace.model, scope, signature, route.selectedId]);
  const close = () => { restore.current = null; position.returning(); workspace.actions.closeDocument(); };
  return <View style={styles.stack}>
    <View testID="preparation-history-index" aria-hidden={!!route.selectedId} style={[styles.index, !!route.selectedId && styles.hidden]}>
      <View ref={listRef} tabIndex={-1} accessibilityLabel="已歸檔準備單清單" testID="preparation-document-list" style={styles.list}>
        {documents.length ? documents.map(document => {
          const state = stateLabels[document.readState], title = document.revision?.title ?? "暫不能查看的準備單";
          return <ReadTargetLink key={document.id} ref={node => position.rowRef(document.id, node)} testID={`preparation-row-${document.id}`}
            href={{ pathname: "/history", params: serializeHistoryRoute({ ...route, category: "preparations", selectedId: document.id }) }}
            label={`查看已歸檔準備：${title}，${state.label}，歸檔 ${preparationDateLabel(document.archivedAt)}`} style={styles.indexRow}
            onOpen={() => { position.remember(document.id, getScrollPosition?.()); workspace.actions.selectDocument(document.id); }}>
            <Text style={styles.rowTitle}>{title}</Text><View style={styles.row}><Text style={styles.meta}>{preparationPurposeLabel(document.purpose)}</Text>
              <Text style={styles.meta}>歸檔 {preparationDateLabel(document.archivedAt)}</Text><AppStatusBadge label={document.readState === "ready" ? "已歸檔" : state.label} tone={document.readState === "ready" ? "neutral" : state.tone} /></View>
          </ReadTargetLink>;
        }) : <PreparationEmptyState workspace={workspace} history />}
      </View>
    </View>
    {route.selectedId ? <View testID={selected ? "preparation-history-reader" : "preparation-history-unavailable"} style={styles.historyReader}>
      <AppButton ref={returnRef} label="返回歸檔清單" variant="quiet" onPress={close} />
      {selected ? <PreparationDocumentDetail key={`${workspace.scopeKey}:${selected.id}`} document={selected} workspace={workspace} headingLevel={3}
        headingRef={headingRef} onClose={close} onPrepareQuestion={onPrepareQuestion} hideReturnAction restoreRef={restoreRef}
        onRestore={documentValue => {
          const trigger = restoreRef.current as unknown as HTMLElement | null;
          restore.current = Platform.OS === "web" && trigger && document.activeElement === trigger && authority.meta.isCurrent()
            ? { scope, signature, id: documentValue.id, version: documentValue.version, operation: workspace.model.operation, trigger, authority } : null;
          workspace.actions.restoreDocument?.(documentValue.id, documentValue.version);
        }} /> : <ReadStateNotice state={workspace.model.condition === "loading" ? "loading" : "unavailable"} message={workspace.model.condition === "loading" ? "正在讀取這份準備單…" : "這份文件目前不在可讀的歸檔準備單，沒有代選其他文件。"} />}
    </View> : null}
  </View>;
}

export function PreparationWorkspace({ onHistory, onPrepareQuestion, previewControls, scrollRef, getScrollPosition, selectedDocumentId, onDocumentChange }: ReadingProps & {
  selectedDocumentId: string | null; onDocumentChange(id: string | null): void;
  onHistory?(): void; onPrepareQuestion?: (question: string) => void; previewControls?: ReactNode;
}) {
  const source = usePreparationWorkspace();
  const workspace = source ? { ...source, model: { ...source.model, selected: source.model.selected?.id === selectedDocumentId ? source.model.selected : null },
    actions: { ...source.actions, selectDocument: onDocumentChange, closeDocument: () => onDocumentChange(null) } } : null;
  if (!workspace) return <Text style={styles.body}>先選擇有權查看的孩子，再打開準備單。</Text>;
  const active = workspace.model.documents.filter(document => document.status === "active");
  const selected = workspace.model.selected?.status === "active";
  const requested = selectedDocumentId ? active.find(document => document.id === selectedDocumentId) : null;
  const awaitingSelection = !!requested && !selected;
  const unavailableSelection = !!selectedDocumentId && !requested && !["loading", "lost"].includes(workspace.model.condition);
  const canCreate = workspace.actions.createDocument && workspace.actions.markDraft && workspace.actions.discardDraft && workspace.model.scope.role !== "viewer";
  const quietRead = !!workspace.model.busy && workspace.model.online && ["ready", "empty", "read_only"].includes(workspace.model.condition)
    && !workspace.model.dirty && (!workspace.model.operation || workspace.model.operation.state === "none");
  return <View testID="preparation-workspace" style={styles.workspace}>
    {unavailableSelection ? <View testID="preparation-requested-unavailable" style={styles.stack}>
      <Text style={styles.body}>這份準備單不在目前已載入且可讀的清單，沒有代選其他文件。</Text><AppButton label="返回準備單清單" variant="quiet" onPress={() => onDocumentChange(null)} />
    </View> : null}
    {workspace.model.checkSave ? <Text testID="preparation-check-save" style={styles.body}>{workspace.model.checkSave === "queued" ? "勾選尚未同步，稍後自動保存。"
      : workspace.model.checkSave === "saving" ? "正在背景保存，可繼續勾選。"
      : workspace.model.checkSave === "unknown" ? "勾選結果待核對，未保存的修改仍保留。" : "清單需要重新核對，未保存的修改仍保留。"}</Text> : null}
    {workspace.model.checkSave === "conflict" && workspace.model.canReapplyChecks ? <View style={styles.row}>
      {workspace.actions.reapplyChecks ? <AppButton label="按目前版本重新套用勾選" variant="quiet" onPress={workspace.actions.reapplyChecks} /> : null}
      {workspace.actions.discardChecks ? <AppButton label="捨棄未保存勾選" variant="quiet" onPress={workspace.actions.discardChecks} /> : null}
    </View> : null}
    {workspace.model.operation ? <WriteRecoveryNotice plainLanguage showReference={false} operation={workspace.model.operation} recovery={workspace.recovery} online={workspace.model.online} /> : null}
    {workspace.model.condition === "refresh_failed" ? <Text testID="preparation-refresh-error" accessibilityRole="alert" style={styles.warningText}>{active.length ? "更新失敗，顯示上次內容" : "準備單更新失敗"}</Text> : null}
    <View testID="preparation-list-actions" style={styles.intentControls}>
    {canCreate ? <ManualFormDialog label="新增準備單" title="新增準備單" triggerVariant={selectedDocumentId ? "quiet" : "primary"} scopeKey={workspace.scopeKey}
      recovery={workspace.model.operation ? <WriteRecoveryNotice plainLanguage showReference={false} operation={workspace.model.operation} recovery={workspace.recovery} online={workspace.model.online && !workspace.model.busy} /> : null}>
      <DocumentCreateForm kind="preparation" owner={{ authorityVersion: workspace.model.authorityVersion ?? "", locked: workspace.model.locked ?? true,
        editingLocked: workspace.model.editingLocked, createDraft: workspace.model.createDraft, dirty: workspace.model.dirty ?? false, epoch: workspace.model.epoch ?? 0, operation: workspace.model.operation, retainedDraftId: workspace.model.retainedDraftId,
        createDocument: workspace.actions.createDocument!, markDraft: workspace.actions.markDraft!, discardDraft: workspace.actions.discardDraft! }} />
    </ManualFormDialog> : null}
      {!selectedDocumentId && onPrepareQuestion ? <AppButton label="與助手討論" variant="quiet" disabled={!workspace.model.online || workspace.model.condition === "lost"}
        onPress={() => onPrepareQuestion(`請幫我為${workspace.model.child.displayName}準備下一次安排。先和我確認用途、日期、已知安排及仍未確定的資料。`)} /> : null}
    </View>
    {!selectedDocumentId ? <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>待用準備單{!workspace.model.online || !["ready", "empty", "read_only"].includes(workspace.model.condition) ? "" : ` · ${active.length} 份`}</Text> : null}
    {awaitingSelection ? <Text testID="preparation-reader-loading" style={styles.body}>正在打開這份準備單…</Text>
      : unavailableSelection ? null : <ActivePreparationReader workspace={workspace} documents={active} onHistory={onHistory} onPrepareQuestion={onPrepareQuestion} scrollRef={scrollRef} getScrollPosition={getScrollPosition} />}
    {!selected && workspace.model.reading?.activeHasMore ? <AppButton label={workspace.model.reading.pageBusy ? "正在載入…" : "載入更多準備單"} variant="quiet" disabled={workspace.model.reading.pageBusy || !workspace.model.reading.online} onPress={() => workspace.model.reading?.loadMoreDocuments("active")} /> : null}
    {workspace.model.reading?.pageError ? <Text accessibilityRole="alert" style={styles.warningText}>未能載入更多文件，已取得的內容保留。</Text> : null}
    <View testID="preparation-secondary-actions" style={styles.intentControls}>
      {!selected && onHistory ? <AppButton label="查看已歸檔" variant="quiet" density="compact" onPress={onHistory} /> : null}
      {workspace.actions.refresh && (["unavailable", "refresh_failed", "unknown"].includes(workspace.model.condition) || workspace.model.operation?.recovery === "check") ? <AppButton label={workspace.model.busy && !quietRead ? "正在處理文件…" : workspace.model.operation?.recovery === "check" ? "重新載入" : "重新載入"}
        variant="quiet" density="compact" disabled={workspace.model.busy || !workspace.model.online || workspace.model.condition === "lost"} preserveFocusWhenDisabled={quietRead} onPress={workspace.actions.refresh} /> : null}
    </View>
    {previewControls}
  </View>;
}

export function PreparationHistoryView({ searchText, dateRange, onPrepareQuestion, previewControls, scrollRef, getScrollPosition, route, onSelect, onPageChange }: ReadingProps & {
  route: HistoryRouteState; onSelect(id: string | null): void; onPageChange(page: number): void; searchText: string; dateRange: PreparationDateRange; onPrepareQuestion?: (question: string) => void; previewControls?: ReactNode;
}) {
  const source = usePreparationWorkspace();
  const workspace = source ? { ...source, model: { ...source.model, selected: source.model.selected?.id === route.selectedId ? source.model.selected : null },
    actions: { ...source.actions, selectDocument: onSelect, closeDocument: () => onSelect(null) } } : null;
  const reading = workspace?.model.reading;
  useEffect(() => { reading?.ensureArchived(); }, [workspace?.scopeKey, reading?.archiveStarted, reading?.pageBusy]);
  if (!workspace) return <Text style={styles.body}>先選擇有權查看的孩子，再查看準備單歷史。</Text>;
  const documents = searchPreparationHistory(workspace.model.documents, searchText, dateRange);
  const available = workspace.model.online && ["ready", "empty", "read_only"].includes(workspace.model.condition)
    && (!reading || reading.archiveReady && !reading.pageBusy && !reading.pageError);
  const unknownDates = workspace.model.documents.filter(document => document.status === "archived" && !document.archivedAt).length;
  const page = historyPage(documents, route.page);
  return <View testID="preparation-history" style={styles.workspace}>
    {previewControls}
    {workspace.model.operation ? <WriteRecoveryNotice plainLanguage showReference={false} operation={workspace.model.operation} recovery={workspace.recovery} online={workspace.model.online} /> : null}
    {workspace.actions.refresh && (["unavailable", "refresh_failed", "unknown"].includes(workspace.model.condition) || workspace.model.operation?.recovery === "check") ? <AppButton label="重新載入" variant="quiet" density="compact" disabled={workspace.model.busy || !workspace.model.online || workspace.model.condition === "lost"} onPress={workspace.actions.refresh} /> : null}
    {workspace.model.condition === "refresh_failed" ? <Text testID="preparation-refresh-error" accessibilityRole="alert" style={styles.warningText}>{documents.length ? "更新失敗，顯示上次內容" : "準備單更新失敗"}</Text> : null}
    {!route.selectedId ? <View style={styles.stack}><Text style={styles.body}>只搜尋可查看的已歸檔準備單：標題、內容、用途及來源名稱。日期按歸檔時間，並非使用日期。{available ? "只涵蓋目前已載入資料。" : "目前尚未取得可確認的結果。"}</Text>
    {unknownDates ? <Text style={styles.body}>{unknownDates} 份未提供歸檔時間，套用日期範圍時不會把它們歸入任何日期。</Text> : null}
    {available ? <Text style={styles.meta}>{documents.length} 份符合</Text> : null}
    <HistoryPager page={page.page} total={page.total} onChange={onPageChange} /></View> : null}
    {workspace.model.condition !== "lost" ? <PreparationHistoryReader workspace={workspace} documents={page.items} route={route} signature={JSON.stringify([{ ...route, selectedId: null }, searchText, dateRange])}
      onPrepareQuestion={onPrepareQuestion} scrollRef={scrollRef} getScrollPosition={getScrollPosition} /> : <PreparationEmptyState workspace={workspace} history />}
    {reading && (!reading.archiveStarted || reading.archiveHasMore || reading.pageError) ? <AppButton label={reading.pageBusy ? "正在載入歸檔…" : reading.pageError || !reading.archiveReady && reading.archiveStarted ? "重試載入歸檔" : "載入更多歸檔"} variant="quiet" disabled={reading.pageBusy || !reading.online} onPress={() => reading.loadMoreDocuments("archived")} /> : null}
    {reading?.pageError ? <Text accessibilityRole="alert" style={styles.warningText}>未能載入更多歸檔，已取得的內容保留。</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  hidden: { display: "none" }, index: { width: "100%", maxWidth: 880 }, indexRow: { minHeight: 56, gap: spacing.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.line },
  workspace: { gap: spacing.lg, minWidth: 0 }, stack: { gap: spacing.md, minWidth: 0 }, row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  sectionTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 18, lineHeight: 28, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.body }, meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, flexShrink: 1 },
  metadataItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minWidth: 0, maxWidth: "100%", flexShrink: 1 },
  intentControls: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  list: { gap: spacing.md, minWidth: 0, flex: 1 },
  historyReader: { width: "100%", maxWidth: 760, alignSelf: "center", gap: spacing.lg, minWidth: 0 },
  rowTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 17, lineHeight: 26, fontWeight: "700" },
  document: { gap: spacing.lg, width: "100%", maxWidth: 760, minWidth: 0, borderWidth: 0 }, documentHeader: { gap: spacing.sm, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.line },
  documentTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 20, lineHeight: 30, fontWeight: "700" },
  section: { gap: spacing.md, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.softLine },
  textRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }, reading: { fontFamily: chineseFont, color: colors.ink, fontSize: 16, lineHeight: 27, flex: 1, minWidth: 0 },
  bullet: { fontFamily: chineseFont, color: colors.teal, fontSize: 16, lineHeight: 27, minWidth: 18 },
  warning: { backgroundColor: colors.paleAmber, borderRadius: radius.small, padding: spacing.md, gap: spacing.sm }, warningText: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.body },
  archiveNote: { backgroundColor: colors.quietSurface, borderRadius: radius.small, borderWidth: 1, borderColor: colors.line, padding: spacing.md, gap: spacing.md },
  footer: { gap: spacing.md }, actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, empty: { paddingVertical: spacing.lg, gap: spacing.sm },
});
