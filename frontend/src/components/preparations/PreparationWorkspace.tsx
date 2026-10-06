import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Platform, Pressable, StyleSheet, View, type ScrollView } from "react-native";
import { Text } from "react-native-paper";
import {
  canChangePreparation, preparationDateLabel, preparationPurposeLabel, preparationPurposes, searchPreparationHistory,
  type PreparationCondition, type PreparationDateRange, type PreparationDocumentView, type PreparationPurpose,
} from "../../preparation-view-model";
import { usePreparationWorkspace, type PreparationWorkspaceValue } from "../../workspaces/PreparationWorkspace";
import { WriteRecoveryNotice } from "../WriteRecoveryNotice";
import { chineseFont, colors, radius, readingType, spacing } from "../../theme";
import { AppCheckbox } from "../AppCheckbox";
import { AppStatusBadge, type AppStatusTone } from "../AppStatusBadge";
import { AppButton, AppSelect } from "../ui";
import { useContainerWidth } from "../useContainerWidth";

const stateLabels: Record<PreparationDocumentView["readState"], { label: string; tone: AppStatusTone; detail: string }> = {
  ready: { label: "可查閱", tone: "success", detail: "" },
  stale: { label: "來源已有更新", tone: "warning", detail: "這份準備使用較早資料，內容保留作參考；請先核對更新後的來源，再改動或歸檔。" },
  restricted: { label: "來源權限已改變", tone: "warning", detail: "這份準備涉及目前不可查看的私人來源，正文及清單已隱藏。歷史快照亦不會繞過來源權限。" },
  invalidated: { label: "來源已失效", tone: "warning", detail: "原來源已失效，暫停展示準備內容及清單；不能再把舊內容當作有效準備。" },
  unknown: { label: "來源狀態未知", tone: "warning", detail: "尚未確認這份準備的來源及版本，內容暫不展示，也不能修改或歸檔。" },
};
function PreparationEmptyState({ workspace, history = false }: { workspace: PreparationWorkspaceValue; history?: boolean }) {
  const { condition } = workspace.model;
  const title = condition === "loading" ? "正在讀取準備單" : condition === "unavailable" ? "暫時未能取得準備單"
    : condition === "lost" ? "孩子權限已失效" : history ? "這裏還沒有符合條件的準備單" : "目前沒有已備妥的準備單";
  const detail = condition === "loading" ? "資料讀取完成前，先不展示舊文件。" : condition === "unavailable" ? "這不代表沒有文件；目前無法確認準備及歸檔狀態。"
    : condition === "lost" ? "準備單及歷史內容已隱藏，請先確認孩子的存取權。" : history ? "可調整搜尋或日期；沒有刪除其他準備單。" : "可以先到助手交代用途、日期和需要，之後在這裏打開已整理的文件。";
  return <View testID="preparation-empty" style={styles.empty}><Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text><Text style={styles.meta}>{detail}</Text></View>;
}

function PreparationRow({ document, selected, onPress, rowRef }: { document: PreparationDocumentView; selected: boolean; onPress(): void; rowRef(node: View | null): void }) {
  const state = stateLabels[document.readState], revision = document.revision;
  return <Pressable ref={rowRef} testID={`preparation-row-${document.id}`} accessibilityRole="button"
    accessibilityLabel={`開啟${revision?.title ?? "暫不能查看的準備單"}`} accessibilityState={{ selected }} aria-selected={selected}
    onPress={onPress} style={({ pressed }) => [styles.documentRow, selected && styles.selectedRow, pressed && (selected ? styles.selectedPressedRow : styles.pressedRow)]}>
    <View style={styles.row}><Text style={styles.eyebrow}>{preparationPurposeLabel(document.purpose)}</Text><AppStatusBadge label={document.status === "archived" && document.readState === "ready" ? "已歸檔" : state.label} tone={document.status === "archived" && document.readState === "ready" ? "neutral" : state.tone} /></View>
    <Text accessibilityRole="header" style={styles.rowTitle}>{revision?.title ?? "暫不能查看的準備單"}</Text>
    <Text style={styles.body}>{revision?.summary ?? state.detail}</Text>
    <View style={styles.row}><Text style={styles.meta}>{document.status === "archived" ? `歸檔 ${preparationDateLabel(document.archivedAt)}` : `使用日期 ${preparationDateLabel(revision?.eventDate ?? null)}`}</Text><Text style={styles.openLabel}>打開準備單 ›</Text></View>
  </Pressable>;
}

function PreparationDocumentDetail({ document, workspace, onClose, onHistory, onPrepareQuestion }: {
  document: PreparationDocumentView; workspace: PreparationWorkspaceValue; onClose(): void; onHistory?(): void; onPrepareQuestion?: (question: string) => void;
}) {
  const [sourceOpen, setSourceOpen] = useState(false), [archiveAsked, setArchiveAsked] = useState(false);
  const revision = document.revision, state = stateLabels[document.readState], archived = document.status === "archived";
  const pending = !!workspace.model.operation && ["saving", "unknown", "conflict"].includes(workspace.model.operation.state);
  const editable = canChangePreparation(document, workspace.model.scope) && !pending;
  const canCheck = editable && workspace.model.capabilities?.checkItem === true;
  const canArchive = editable && workspace.model.capabilities?.archive === true;
  const checked = revision?.sections.flatMap(section => section.kind === "checklist" ? section.items : []) ?? [];
  useLayoutEffect(() => { setArchiveAsked(false); setSourceOpen(false); }, [document.id, document.version, document.readState, workspace.scopeKey]);
  return <View testID="preparation-document-detail" style={styles.document}>
    <AppButton label={archived ? "返回歸檔清單" : "返回準備單清單"} variant="secondary" density="compact" onPress={onClose} />
    <View style={styles.documentHeader}>
      <View style={styles.row}><Text style={styles.eyebrow}>{preparationPurposeLabel(document.purpose)} · {workspace.model.child.displayName}</Text>
        <AppStatusBadge label={archived ? "已歸檔" : state.label} tone={archived ? "neutral" : state.tone} /></View>
      <Text accessibilityRole="header" style={styles.documentTitle}>{revision?.title ?? "暫不能查看這份準備"}</Text>
      {revision ? <><Text style={styles.body}>{revision.summary}</Text>
        <Text style={styles.meta}>使用日期 {preparationDateLabel(revision.eventDate)} · 更新 {preparationDateLabel(revision.updatedAt)}</Text>
        <Text style={styles.meta}>資料截至 {preparationDateLabel(revision.sourceAsOf)}（香港時間）</Text></> : null}
    </View>
    {state.detail ? <View style={styles.warning}><AppStatusBadge label={state.label} tone={state.tone} /><Text style={styles.body}>{state.detail}</Text></View> : null}
    {!workspace.model.online ? <Text accessibilityRole="alert" style={styles.warningText}>目前離線，只可閱讀已載入內容；清單及歸檔暫停。</Text> : null}
    {workspace.model.scope.role === "viewer" || workspace.model.condition === "read_only" ? <Text style={styles.meta}>目前為唯讀，可以打開文件，不能改清單或歸檔。</Text> : null}
    {archived ? <View style={styles.archiveNote}><AppStatusBadge label="保留使用時的版本" tone="info" /><Text style={styles.meta}>歸檔於 {preparationDateLabel(document.archivedAt)}。這份內容保留作回看，不會再出現在待用清單。</Text></View> : null}
    {revision?.sections.map(section => <View key={section.id} style={styles.section}>
      <View style={styles.row}><Text accessibilityRole="header" style={styles.sectionTitle}>{section.title}</Text>{section.kind === "checklist" ? <Text style={styles.meta}>{checked.filter(item => item.checked).length}／{checked.length} 項已核對</Text> : null}</View>
      {section.items.map((item, index) => section.kind === "checklist"
        ? archived || !canCheck ? <View key={item.id} style={styles.textRow}><Text style={styles.checkMark}>{item.checked ? "☑" : "☐"}</Text><Text style={styles.reading}>{item.text}</Text></View>
          : <AppCheckbox key={item.id} label={item.text} checked={!!item.checked} onChange={value => workspace.actions.checkItem(document.id, document.version, section.id, item.id, value)} />
        : <View key={item.id} style={styles.textRow}><Text style={styles.bullet}>{section.kind === "questions" ? `${index + 1}.` : "·"}</Text><Text style={styles.reading}>{item.text}</Text></View>)}
    </View>)}
    {revision ? <View style={styles.section}>
      <AppButton label="來源與版本" variant="quiet" density="compact" expanded={sourceOpen} onPress={() => setSourceOpen(value => !value)} />
      {sourceOpen ? <View style={styles.stack}>
        <Text style={styles.meta}>正文版本 {revision.number} · 文件版本 {document.version}</Text>
        {document.sources.map(source => <Text key={source.id} style={styles.meta}>{source.label} · {source.visibility === "private" ? "私人來源" : "家庭來源"} · 資料更新 {preparationDateLabel(source.updatedAt)}{source.version !== revision.sourceRefs.find(ref => ref.id === source.id)?.version ? " · 已有較新版本" : ""}</Text>)}
        <Text selectable style={styles.meta}>文件：{document.id}{"\n"}正文：{revision.id}{"\n"}來源：{revision.sourceRefs.map(ref => `${ref.id} · v${ref.version}`).join("；")}</Text>
      </View> : null}
    </View> : null}
    {!archived ? <View style={styles.footer}>
      {workspace.model.notice ? <Text accessibilityLiveRegion="polite" style={styles.meta}>{workspace.model.notice}</Text> : null}
      <View style={styles.actions}><AppButton label="使用完畢，歸檔" variant="primary" disabled={!canArchive} onPress={() => setArchiveAsked(true)} />
        <AppButton label="到助手補充／更新" variant="secondary" disabled={!revision || !workspace.model.online || !onPrepareQuestion} onPress={() => onPrepareQuestion?.(`請幫我更新${workspace.model.child.displayName}的「${revision!.title}」準備單；先核對現有資料及未確認的地方。`)} /></View>
      {archiveAsked && canArchive ? <View testID="preparation-archive-confirm" style={styles.archiveNote}>
        <Text style={styles.body}>把「{revision?.title}」移到歷史？會保留目前版本，只歸檔這一份準備單。</Text>
        {workspace.model.archiveNotice ? <Text style={styles.meta}>{workspace.model.archiveNotice}</Text> : null}
        <View style={styles.actions}><AppButton label="歸檔這份準備" onPress={() => workspace.actions.archiveDocument(document.id, document.version)} /><AppButton label="繼續使用" variant="secondary" onPress={() => setArchiveAsked(false)} /></View>
      </View> : null}
    </View> : onHistory ? <AppButton label="查看準備單歷史" variant="secondary" onPress={onHistory} /> : null}
  </View>;
}

type ReadingProps = { scrollRef?: RefObject<ScrollView | null>; getScrollPosition?(): number };

function PreparationReader({ workspace, documents, history = false, onHistory, onPrepareQuestion, scrollRef, getScrollPosition }: ReadingProps & {
  workspace: PreparationWorkspaceValue; documents: readonly PreparationDocumentView[]; history?: boolean; onHistory?(): void; onPrepareQuestion?: (question: string) => void;
}) {
  const layout = useContainerWidth(), wide = layout.width >= 840;
  const selected = workspace.model.selected?.status === (history ? "archived" : "active") && documents.some(item => item.id === workspace.model.selected!.id) ? workspace.model.selected : null;
  const archivedSelection = !history && workspace.model.justArchivedId;
  const rowRefs = useRef(new Map<string, View>()), listRef = useRef<View>(null), panelRef = useRef<View>(null);
  const anchor = useRef<{ id: string; y: number; scope: string } | null>(null), previousSelected = useRef<string | null>(null);
  useLayoutEffect(() => {
    const before = previousSelected.current; previousSelected.current = selected?.id ?? null;
    if (!before && selected && !wide) {
      scrollRef?.current?.scrollTo({ y: 0, animated: false });
      if (Platform.OS === "web") (panelRef.current as unknown as HTMLElement | null)?.focus({ preventScroll: true });
    } else if (before && !selected && anchor.current?.scope === workspace.scopeKey) {
      if (!wide) scrollRef?.current?.scrollTo({ y: anchor.current.y, animated: false });
      if (Platform.OS === "web") ((rowRefs.current.get(anchor.current.id) ?? listRef.current) as unknown as HTMLElement | null)?.focus({ preventScroll: true });
    }
  }, [selected?.id, wide, workspace.scopeKey]);
  return <View ref={layout.ref} onLayout={layout.onLayout} style={styles.stack}>
    {archivedSelection ? <View accessibilityLiveRegion="polite" testID="preparation-archive-success" style={styles.archiveNote}>
      <AppStatusBadge label="已在本次預覽歸檔" tone="success" /><Text style={styles.body}>這份準備單已移到歷史，使用時的版本仍保留。</Text>
      {onHistory ? <AppButton label="到歷史查看" variant="secondary" onPress={onHistory} /> : null}
      <AppButton label="繼續看其他準備" variant="quiet" density="compact" onPress={workspace.actions.closeDocument} />
    </View> : null}
    <View style={[styles.stack, wide && selected && styles.split]}>
      {!selected || wide ? <View ref={listRef} tabIndex={-1} testID="preparation-document-list" style={[styles.list, wide && selected && styles.listColumn]}>
        {documents.length ? documents.map(document => <PreparationRow key={document.id} document={document} selected={selected?.id === document.id}
          rowRef={node => { if (node) rowRefs.current.set(document.id, node); else rowRefs.current.delete(document.id); }}
          onPress={() => { anchor.current = { id: document.id, y: getScrollPosition?.() ?? 0, scope: workspace.scopeKey }; workspace.actions.selectDocument(document.id); }} />)
          : <PreparationEmptyState workspace={workspace} history={history} />}
      </View> : null}
      {selected ? <View ref={panelRef} tabIndex={-1} style={styles.detailColumn}><PreparationDocumentDetail key={`${workspace.scopeKey}:${selected.id}`} document={selected} workspace={workspace}
        onClose={workspace.actions.closeDocument} onHistory={onHistory} onPrepareQuestion={onPrepareQuestion} /></View> : null}
    </View>
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
  return <View testID="preparation-workspace" style={styles.workspace}>
    {workspace.model.operation ? <WriteRecoveryNotice operation={workspace.model.operation} recovery={workspace.recovery} online={workspace.model.online} /> : null}
    {!selected ? <Text style={styles.meta}>待用準備單{["loading", "unavailable", "lost"].includes(workspace.model.condition) ? "" : ` · ${active.length} 份`}</Text> : null}
    <PreparationReader workspace={workspace} documents={active} onHistory={onHistory} onPrepareQuestion={onPrepareQuestion} scrollRef={scrollRef} getScrollPosition={getScrollPosition} />
    {!selected ? <View testID="preparation-list-actions" style={styles.intentControls}>
      {onHistory ? <AppButton label="查看已歸檔" variant="secondary" density="compact" onPress={onHistory} /> : null}
      <View style={styles.purposeField}><AppSelect label="用途" value={purpose} options={preparationPurposes.map(item => ({ value: item.key, label: item.label }))} onChange={setPurpose} /></View>
      <AppButton label="到助手準備下一份" variant="accent" disabled={!workspace.model.online || workspace.model.condition === "lost" || !onPrepareQuestion} onPress={() => onPrepareQuestion?.(`請幫我為${workspace.model.child.displayName}整理一份${preparationPurposeLabel(purpose)}。先和我確認用途、日期、已知安排及仍未確定的資料。`)} />
    </View> : null}
    {previewControls}
  </View>;
}

export function PreparationHistoryView({ searchText, dateRange, onPrepareQuestion, previewControls, scrollRef, getScrollPosition }: ReadingProps & {
  searchText: string; dateRange: PreparationDateRange; onPrepareQuestion?: (question: string) => void; previewControls?: ReactNode;
}) {
  const workspace = usePreparationWorkspace();
  if (!workspace) return <Text style={styles.meta}>先選擇有權查看的孩子，再查看準備單歷史。</Text>;
  const documents = searchPreparationHistory(workspace.model.documents, searchText, dateRange);
  const available = !["loading", "unavailable", "lost"].includes(workspace.model.condition);
  const unknownDates = workspace.model.documents.filter(document => document.status === "archived" && !document.archivedAt).length;
  return <View testID="preparation-history" style={styles.workspace}>
    {previewControls}
    {workspace.model.operation ? <WriteRecoveryNotice operation={workspace.model.operation} recovery={workspace.recovery} online={workspace.model.online} /> : null}
    <Text style={styles.meta}>只搜尋可查看的已歸檔準備單：標題、內容、用途及來源名稱。日期按歸檔時間，並非使用日期。{available ? "只涵蓋目前已載入資料。" : "目前尚未取得可確認的結果。"}</Text>
    {unknownDates ? <Text style={styles.meta}>{unknownDates} 份未提供歸檔時間，套用日期範圍時不會把它們歸入任何日期。</Text> : null}
    {available ? <Text style={styles.meta}>{documents.length} 份符合</Text> : null}
    <PreparationReader workspace={workspace} documents={documents} history onPrepareQuestion={onPrepareQuestion} scrollRef={scrollRef} getScrollPosition={getScrollPosition} />
  </View>;
}

const styles = StyleSheet.create({
  workspace: { gap: spacing.lg, minWidth: 0 }, stack: { gap: spacing.md, minWidth: 0 }, row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  sectionTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 18, lineHeight: 28, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool }, meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  eyebrow: { fontFamily: chineseFont, color: colors.deepTeal, ...readingType.meta, fontWeight: "700", flexGrow: 1, flexShrink: 1 },
  intentControls: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.md }, purposeField: { flexGrow: 1, minWidth: 180 },
  list: { gap: spacing.md, minWidth: 0, flex: 1 }, listColumn: { flex: 0.8 }, detailColumn: { flex: 1.4, minWidth: 0 }, split: { flexDirection: "row", alignItems: "flex-start" },
  documentRow: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.medium, backgroundColor: colors.controlSurface, borderWidth: 1, borderColor: colors.line, minWidth: 0 },
  selectedRow: { borderColor: "transparent", borderWidth: 2, backgroundColor: colors.paleTeal }, pressedRow: { backgroundColor: colors.quietSurface }, selectedPressedRow: { backgroundColor: colors.selectedNav },
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
