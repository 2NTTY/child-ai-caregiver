import { BackgroundSurface } from "../appearance/BackgroundSurface";
import { exportAttachment } from '../../platform/file-export';
import { pickImportPackage } from '../../platform/package-import';
import { exportSeriesReferences, libraryPickLimit, readSeriesReferences } from '../../production/library-package';
import { EmptyListCard } from "../EmptyListCard";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SourceLibrary, LibraryAction, LibraryRow, LibrarySheet, type PersonalCardRows } from './SourceLibrary';
import { PlatformCardJoin } from './PlatformCardJoin';
import { AppDialog } from "../AppDialog";
import { AppRadioItem } from "../AppRadioItem";
import { childHealthSeries, libraryArchiveMaxEditions, sourceSeries, type LibrarySelectionCommand, type ManageSeries } from "../../../../src/shared/source-series";
import { useFocusEffect, useRouter, useLocalSearchParams, type Href } from "expo-router";
import { usePreviewNavigation } from "../../preview/PreviewNavigationGuard";
import { childHealthStatus, libraryDocumentChoice, platformLibraryJoin, selectedLibraryEditions, type PersonalLibraryItem } from "../../../../src/shared/personal-library";
import { historyMessageQuestion, personalWorkQuestion } from "../../history-view-model";
import { PersistentWorkCards } from "../history/PersistentWorkCards";
import { HistoryMessageDetail } from "../history/HistoryMessageDetail";
import { Text } from "react-native-paper";
import { factIsApplicable, factSourceLabel, factStatusLabels, factUnavailableReason, visibilityLabels, type MemoryFactView, type MemorySummaryView } from "../../memory-view-model";
import { memoryClarificationQuestion, memoryConfirmerLabel, memoryDateLabel, visibleKnowledgeReferences, visibleMemoryFacts, visibleMemoryHistory,
  seriesPreferenceChange, type SeriesPreferenceAction, type KnowledgeReferenceView, type MemoryConfirmerDisplay, type MemoryReadProjection, type MemoryReferenceModel, type MemoryReferenceWorkspaceValue } from "../../memory-reference-view-model";
import { useMemoryReferenceWorkspace } from "../../workspaces/MemoryReferenceWorkspace";
import { chineseFont, colors, radius, readingType, spacing, workspaceType } from "../../theme";
import { AppStatusBadge } from "../AppStatusBadge";
import { AppIcon, type AppIconName } from "../AppIcon";
import { ReadStateNotice } from "../ReadStateNotice";
import { AppButton, AppSelectionTrigger, AppTabPanel, UnderlineTabs, TabToolbar } from "../ui";
import { useContainerWidth } from "../useContainerWidth";

type Tab = "short" | "long" | "references";
const tabs: { key: Tab; label: string }[] = [
  { key: "short", label: "短期脈絡" }, { key: "long", label: "長期記憶" }, { key: "references", label: "參考資料" },
];
function ReadNotice({ read, unavailable, empty, emptyTitle = "暫無可顯示的資料", online = true, children }: {
  read: MemoryReadProjection<unknown>; unavailable: string; empty?: boolean; emptyTitle?: string; online?: boolean; children?: ReactNode;
}) {
  if (read.state === "loading") return <ReadStateNotice state="loading" title="正在讀取…" />;
  if (read.state === "error") return <ReadStateNotice state="error" title="暫時讀不到資料" message="請稍後重新讀取。" />;
  if (read.state === "unavailable") return <ReadStateNotice state="unavailable" title={unavailable} />;
  return <>{read.state === "stale" ? <ReadStateNotice state="stale" title="目前顯示上次讀取的資料" message="最新狀態尚未確認，請連線後再核對。" /> : null}
    {empty ? read.state === "ready" && online ? <EmptyListCard title={emptyTitle} /> : <BackgroundSurface padded><Text style={styles.meta}>尚未取得可確認的最新資料</Text></BackgroundSurface> : children}</>;
}
function Metadata({ label, children }: { label: string; children: ReactNode }) {
  return <Text selectable style={styles.meta}>{label}：{children}</Text>;
}
const factSources: Record<MemoryFactView["source"]["kind"], { label: string; icon: AppIconName }> = {
  private_chat: { label: "私人聊天", icon: "message-text-outline" },
  care_record: { label: "照顧記錄", icon: "notebook-outline" },
  manual: { label: "手動描述", icon: "pencil-outline" },
  imported: { label: "匯入資料包", icon: "file-document-outline" },
};
function factConfirmer(fact: Readonly<MemoryFactView>, display?: MemoryConfirmerDisplay) {
  return fact.confirmationBasis === "imported_source" && fact.confirmedBy !== null
    ? `來源確認：${fact.confirmedBy}` : memoryConfirmerLabel(fact.confirmedBy, display);
}
function FactCard({ fact, model, workspace, confirmerDisplay, onQuestion }: {
  fact: Readonly<MemoryFactView>; model: MemoryReferenceModel; workspace: MemoryReferenceWorkspaceValue; onQuestion?: (fact: Readonly<MemoryFactView>) => void;
  confirmerDisplay?: MemoryConfirmerDisplay;
}) {
  const [details, setDetails] = useState(false), [historyOpen, setHistoryOpen] = useState(false);
  const history = model.longTerm.data?.histories[fact.id];
  const versions = visibleMemoryHistory(model, fact);
  const currentHistory = history?.factVersion === fact.version ? history : undefined;
  const available = factIsApplicable(fact);
  const source = factSources[fact.source.kind];
  return <View testID={`memory-reference-fact-${fact.id}`} style={styles.factRow}>
    <View style={styles.titleRow}><Text accessibilityRole="header" style={styles.factTopic}>{fact.key}</Text>
      {fact.status !== "confirmed" || !available ? <AppStatusBadge label={factStatusLabels[fact.status]} tone={fact.status === "candidate" ? "warning" : "neutral"} /> : null}</View>
    <Text selectable style={styles.factContent}>{fact.content}</Text>
    <View style={styles.factContext}>
      <View style={styles.metadataLine}><AppIcon name={fact.visibility === "private" ? "lock-outline" : "account-group-outline"} size={15} /><Text accessibilityLabel={`可見範圍：${visibilityLabels[fact.visibility]}`} style={styles.meta}>{visibilityLabels[fact.visibility]}</Text></View>
      <Pressable testID={`memory-fact-source-${fact.id}`} accessibilityRole="button" accessibilityLabel={`${details ? "收起" : "查看"}來源：${source.label}`} accessibilityState={{ expanded: details }} aria-expanded={details}
        onPress={() => { setDetails(value => !value); setHistoryOpen(false); }} style={({ pressed }) => [styles.sourceTrigger, pressed && styles.sourcePressed]}>
        <AppIcon name={source.icon} size={15} color={colors.deepTeal} /><Text style={styles.sourceLabel}>{source.label}</Text><AppIcon name={details ? "chevron-up" : "chevron-down"} size={14} color={colors.deepTeal} />
      </Pressable>
    </View>
    {!available ? <Text style={styles.warning}>{factUnavailableReason(fact)}</Text> : null}
    {details ? <View style={styles.details}>
      {onQuestion ? <View style={styles.actions}><AppButton label="請 Agent 核對" variant="quiet" density="compact" onPress={() => onQuestion(fact)} /></View> : null}
      <Metadata label="來源">{factSourceLabel(fact.source)}</Metadata>
      <Metadata label="記憶版本">{fact.version}</Metadata>
      <Metadata label="來源狀態">{fact.sourceState === "current" ? "目前版本" : "來源已更改，須重新核對"}</Metadata>
      <Metadata label="確認者">{factConfirmer(fact, confirmerDisplay)}</Metadata>
      <Metadata label="確認時間">{memoryDateLabel(fact.confirmedAt)}</Metadata>
      {fact.validUntil ? <Metadata label="有效至">{memoryDateLabel(fact.validUntil)}</Metadata> : null}
      {fact.reason ? <Metadata label="最近變更原因">{fact.reason}</Metadata> : null}
      {fact.source.kind === "care_record" ? <Metadata label="原記錄">{fact.source.recordId} · 版本 {fact.source.version}</Metadata> : null}
      {fact.source.kind === "imported" && fact.source.original.kind === "care_record" ? <Metadata label="來源原記錄">{fact.source.original.recordId} · 版本 {fact.source.original.version}</Metadata> : null}
      <AppButton label={historyOpen ? "收起版本記錄" : "查看版本記錄"} expanded={historyOpen} variant="quiet" density="compact" onPress={() => {
        if (!historyOpen && !currentHistory && model.online) workspace.reads?.readFactHistory?.(fact.id, fact.version);
        setHistoryOpen(value => !value);
      }} />
      {historyOpen ? <View style={styles.history}>
        {currentHistory?.state === "loading" ? <Text style={styles.meta}>正在讀取版本記錄…</Text>
          : !currentHistory || currentHistory.state === "unavailable" ? <Text style={styles.meta}>版本記錄暫未提供</Text>
          : currentHistory.state === "error" ? <Text style={styles.warning}>暫時讀不到版本記錄</Text>
          : versions.length === 0 ? model.online && model.longTerm.state === "ready" ? <EmptyListCard title={currentHistory.hasMore ? "已載入頁面暫無版本記錄" : "暫無可顯示的版本記錄"} detail={currentHistory.hasMore ? "仍有版本未載入，可繼續讀取。" : undefined} /> : <Text style={styles.meta}>版本記錄尚未重新核對</Text> : versions.map(version => <View key={version.version} style={styles.historyEntry}>
            <Text style={styles.cardTitle}>版本 {version.version} · {factStatusLabels[version.status]}</Text>
            <Text selectable style={styles.body}>{version.content}</Text>
            <Text style={styles.meta}>{visibilityLabels[version.visibility]} · {factSourceLabel(version.source)}</Text>
            <Metadata label="確認者">{factConfirmer(version, confirmerDisplay)}</Metadata>
            <Metadata label="確認時間">{memoryDateLabel(version.confirmedAt)}</Metadata>
            {version.validUntil ? <Metadata label="有效至">{memoryDateLabel(version.validUntil)}</Metadata> : null}
            <Metadata label="適用狀態">{factUnavailableReason(version)}</Metadata>
            {version.reason ? <Metadata label="原因">{version.reason}</Metadata> : null}
          </View>)}
        {currentHistory?.hasMore ? workspace.reads?.loadMoreFactHistory ? <AppButton label="載入更多版本" variant="quiet" disabled={!model.online} onPress={() => workspace.reads?.loadMoreFactHistory?.(fact.id, fact.version)} />
          : <Text style={styles.meta}>仍有版本記錄未載入</Text> : null}
      </View> : null}
    </View> : null}
  </View>;
}
function SummaryCard({ summary }: { summary: Readonly<MemorySummaryView> }) {
  const [details, setDetails] = useState(false);
  return <View style={styles.summary}><View style={styles.summaryTitle}><AppIcon name="file-document-outline" size={19} /><Text accessibilityRole="header" style={styles.cardTitle}>對話摘要</Text></View>
    <Text selectable style={styles.body} numberOfLines={details ? undefined : 4}>{summary.text}</Text>
    <AppButton label={details ? "收起摘要" : "查看完整摘要及來源"} expanded={details} variant="quiet" density="compact" onPress={() => setDetails(value => !value)} />
    {details ? <View style={styles.details}><Metadata label="建立時間">{memoryDateLabel(summary.createdAt)}</Metadata><Metadata label="摘要版本">{summary.version}</Metadata>
      <Metadata label="摘要識別">{summary.id}</Metadata>{summary.previousId ? <Metadata label="前一摘要">{summary.previousId}</Metadata> : null}
      <Metadata label="已涵蓋訊息">{summary.coveredMessageIds.join("、") || "未提供"}</Metadata><Metadata label="最後涵蓋訊息">{summary.lastCoveredMessageId}</Metadata>
      </View> : null}
  </View>;
}
function readableReferenceUrl(value: string): string | null {
  // Match the HTTPS/no-credentials source contract without normalising the original URL.
  if (!/^https:\/\//iu.test(value) || /[\u0000-\u0020\u007f\\]/u.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password ? value : null;
  } catch { return null; }
}
function ReferenceCard({ source }: { source: KnowledgeReferenceView }) {
  const [details, setDetails] = useState(false), [technical, setTechnical] = useState(false), [linkFailed, setLinkFailed] = useState(false);
  const sourceUrl = readableReferenceUrl(source.url);
  return <View testID={`memory-reference-source-${source.sourceId}-${source.chunkId}`} style={styles.card}>
    <Text accessibilityRole="header" style={styles.cardTitle}>{source.title}</Text>
    <Text style={styles.meta}>{source.publisher}</Text>
    {source.section ? <Text style={styles.meta}>{source.section}</Text> : null}
    <Text selectable style={styles.body}>{source.sourceExcerpt}</Text>
    {source.usageScope === "internal_noncommercial" ? <Text style={styles.warning}>限內部非商業參考</Text> : null}
    {source.sourceDateText || source.sourcePublishedAt ? <View style={styles.metadataLine}><AppIcon name="calendar-month-outline" size={15} /><Text accessibilityLabel={`來源日期：${source.sourceDateText || memoryDateLabel(source.sourcePublishedAt)}`} style={styles.meta}>{source.sourceDateText || memoryDateLabel(source.sourcePublishedAt)}</Text></View> : null}
    {source.url && !sourceUrl ? <Text style={styles.warning}>來源網址未能安全開啟，可在來源資料核對原文。</Text> : null}
    <View style={styles.actions}>{sourceUrl ? <AppButton label="閱讀來源" variant="quiet" density="compact" onPress={() => { setLinkFailed(false); void Linking.openURL(sourceUrl).catch(() => setLinkFailed(true)); }} /> : null}
      <AppButton label={details ? "收起來源資料" : "查看來源資料"} expanded={details} variant="quiet" density="compact" onPress={() => { setDetails(value => !value); setTechnical(false); }} /></View>
    {linkFailed ? <Text style={styles.warning}>暫未能開啟來源，可複製下方網址。</Text> : null}
    {details || linkFailed ? <View style={styles.details}>
      {source.url ? <Metadata label="原文網址">{source.url}</Metadata> : null}<Metadata label="發布時間">{memoryDateLabel(source.sourcePublishedAt)}</Metadata>
      <Metadata label="來源更新">{memoryDateLabel(source.sourceUpdatedAt)}</Metadata><Metadata label="最近覆核">{memoryDateLabel(source.checkedAt)}</Metadata>
      <Metadata label="最近成功取得">{memoryDateLabel(source.lastSuccessfulCheckAt)}</Metadata>{source.validUntil ? <Metadata label="有效至">{memoryDateLabel(source.validUntil)}</Metadata> : null}
      <Metadata label="地區">{source.applicability.region || "未提供"}</Metadata>
      {source.applicability.ageBasis === 'publisher' || source.applicability.ageBasis === 'unconfirmed'
        ? <Metadata label="原文對象">{source.applicability.publisherAudience ?? '未有指明'}</Metadata>
        : <Metadata label="年齡依據">{source.applicability.ageBasis === "any" ? "未限年齡依據" : source.applicability.ageBasis === "corrected" ? "校正年齡" : "實際年齡"}</Metadata>}
      <Metadata label="月齡範圍">{source.applicability.minAgeMonths ?? "未提供下限"} 至 {source.applicability.maxAgeMonths ?? "未提供上限"}{source.applicability.maxAgeMonthsExclusive ? "（不含上限）" : ""}</Metadata>
      {source.applicability.conditions.length ? <Metadata label="適用條件">{source.applicability.conditions.join("；")}</Metadata> : null}
      <AppButton label={technical ? "收起版本識別" : "查看版本識別"} expanded={technical} variant="quiet" density="compact" onPress={() => setTechnical(value => !value)} />
      {technical ? <View style={styles.details}><Metadata label="來源">{source.sourceId}</Metadata><Metadata label="版本">{source.versionId}</Metadata><Metadata label="片段">{source.chunkId}</Metadata>
        <Metadata label="版本校驗">{source.versionHash}</Metadata><Metadata label="內容校驗">{source.contentHash}</Metadata><Metadata label="取得時間">{memoryDateLabel(source.fetchedAt)}</Metadata></View> : null}
    </View> : null}
  </View>;
}
type MaintenanceEntry = (sourceId: string) => ReactNode;
type ReadingMedia = { url: string; title: string; transcriptUrl?: string };
function mediaLinks(media?: { links: string[]; pages?: ReadingMedia[] }): ReadingMedia[] {
  const pages = new Map(media?.pages?.map(page => [page.url, page]));
  return (media?.links ?? []).map(url => {
    const page = pages.get(url);
    if (page) return page;
    const link = new URL(url), file = link.pathname.split('/').pop() ?? '';
    if (link.hostname === 'www.youtube.com') return { url, title: 'YouTube 影片 · ' + link.searchParams.get('v') };
    const kind = /\.(mp3|m4a)$/iu.test(file) ? '音訊' : '影片';
    return { url, title: '家庭健康服務' + kind + ' · ' + file.replace(/\.[^.]+$/u, '') };
  });
}
function MaterialLink({ url, label, name = label, kind, onFailure }: {
  url: string; label: string; name?: string; kind: 'document' | 'media' | 'transcript'; onFailure(url: string): void;
}) {
  return <Pressable accessibilityRole="link" accessibilityLabel={name}
    {...(Platform.OS === 'web' ? { href: url, hrefAttrs: { target: '_blank', rel: 'noopener noreferrer' } }
      : { onPress: () => { void Linking.openURL(url).catch(() => onFailure(url)); } })}
    style={({ pressed }) => [styles.materialLink, kind === 'document' ? styles.documentLink : Platform.OS === 'web' && styles.webMediaTarget, kind === 'media' && styles.mediaLink, pressed && styles.sourcePressed]}>
    <Text style={kind === 'document' ? styles.materialTitle : kind === 'media' ? styles.mediaTitle : styles.transcriptText}>{label}</Text>
  </Pressable>;
}
function documentStatus(item: PersonalLibraryItem) {
  const choice = libraryDocumentChoice(item);
  return !choice?.selectedVersionId ? '未採用' : !choice.enabled ? '已停用' : !choice.eligible ? '待選版本'
    : choice.mode === 'fixed' ? '已固定版本' : '已跟隨更新';
}
const sourceDate = (value: string) => new Date(value).toLocaleDateString('zh-HK', { timeZone: 'Asia/Hong_Kong' });
function CatalogDocument({ item, onRead }: {
  item: PersonalLibraryItem & { sourceDateText?: string | null }; onRead(): void;
}) {
  const media = mediaLinks(item.media);
  const revision = item.sourceDateText?.trim() || (item.sourceUpdatedAt ? '原文更新於 ' + sourceDate(item.sourceUpdatedAt) : undefined);
  const [expanded, setExpanded] = useState(false), [failedUrl, setFailedUrl] = useState('');
  const status = documentStatus(item);
  const showStatus = status !== '已跟隨更新' && !(status === '未採用' && item.childHealth?.adopted === 0);
  const notes = [showStatus ? status : '', !expanded && media.length ? `${media.length} 項影音` : ''].filter(Boolean);
  const hasDetails = !!(media.length || revision || item.validUntil);
  return <View testID={`memory-catalog-source-${item.sourceId}`} style={styles.materialRow}>
    <View style={styles.materialHeading}><View style={styles.materialMain}>
      <MaterialLink url={item.url} label={item.title} kind="document" onFailure={setFailedUrl} />
      {notes.length ? <Text style={styles.meta}>{notes.join(' · ')}</Text> : null}
    </View>{hasDetails ? <Pressable accessibilityRole="button" accessibilityLabel={item.title + '的教材詳情'}
      accessibilityState={{ expanded }} aria-expanded={expanded}
      onPress={() => { if (!expanded) onRead(); setExpanded(!expanded); setFailedUrl(''); }}
      style={({ pressed }) => [styles.materialToggle, pressed && styles.sourcePressed]}>
      <AppIcon name={expanded ? 'chevron-up' : 'chevron-down'} size={20} />
    </Pressable> : null}</View>
    {expanded && hasDetails ? <View style={styles.materialDetails}>
      {revision ? <Text style={styles.meta}>{revision}</Text> : null}
      {item.validUntil ? <Text style={styles.meta}>有效至 {sourceDate(item.validUntil)}</Text> : null}
      {media.length ? <View style={styles.mediaGroup}><Text accessibilityRole="header" style={styles.mediaHeading}>相關影音</Text>
        {media.map(({ url, title, transcriptUrl }) => <View key={url} style={styles.mediaRow}>
          <MaterialLink kind="media" url={url} label={title} onFailure={setFailedUrl} />
          {transcriptUrl ? <MaterialLink kind="transcript" url={transcriptUrl} label="文字稿" name={`${title}的官方文字稿`} onFailure={setFailedUrl} /> : null}
        </View>)}
      </View> : null}
    </View> : null}
    {failedUrl ? <Text selectable style={styles.warning}>未能開啟：{failedUrl}</Text> : null}
  </View>;
}
function CatalogChoice({ label, value, onChange, options, action }: {
  label: string; value: string; onChange(value: string): void; options: { value: string; label: string }[];
  action?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const trigger = useRef<View>(null);
  const filter = <AppSelectionTrigger ref={trigger} label={label + '：' + (options.find(row => row.value === value)?.label ?? value)}
    expanded={expanded} onPress={() => setExpanded(!expanded)} />;
  return <View>{action ? <View style={styles.seriesTools}><View style={styles.seriesFilter}>{filter}</View>{action}</View> : filter}
    {expanded ? <View accessibilityRole="radiogroup" accessibilityLabel={label}>{options.map(row =>
      <AppRadioItem key={row.value} {...row} checked={row.value === value} onPress={() => {
        onChange(row.value); setExpanded(false); if (Platform.OS === 'web') trigger.current?.focus();
      }} />)}</View> : null}
  </View>;
}
function CatalogDetail({ items, workspace, initialSection, onClose, onJoin, maintenanceEntry, requestedDocument }: {
  items: PersonalLibraryItem[]; workspace: MemoryReferenceWorkspaceValue; initialSection: 'files' | 'settings';
  onClose(): void; onJoin?: () => void; maintenanceEntry?: MaintenanceEntry; requestedDocument?: string;
}) {
  const [section, setSection] = useState(initialSection);
  const [settingsSource, setSettingsSource] = useState(requestedDocument ?? items[0]?.sourceId);
  const tabsId = useId();
  const [category, setCategory] = useState('all'), [archivePart, setArchivePart] = useState('0');
  const [exportNotice, setExportNotice] = useState(''), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [exporting, setExporting] = useState(false), [fingerprint, setFingerprint] = useState('');
  const exportLock = useRef(false), [shareFile, setShareFile] = useState<(() => Promise<void>) | null>(null);
  const first = items[0]!, managed = first.childHealth, series = managed ? childHealthSeries : first.series ?? sourceSeries(first), preference = first.preference;
  const categories = managed?.categoryCounts?.map(row => row.name) ?? [...new Set(items.flatMap(item => item.childHealth?.categories ?? []))];
  const selected = section === 'settings' ? selectedLibraryEditions(items) : [];
  const parts = Math.ceil(selected.length / libraryArchiveMaxEditions);
  const start = Math.min(Number(archivePart), Math.max(0, parts - 1)) * libraryArchiveMaxEditions;
  const archiveEditions = selected.slice(start, start + libraryArchiveMaxEditions);
  const busy = workspace.reads?.referencesBusy || !workspace.model.online || workspace.model.references.state !== 'ready' || !!workspace.model.references.data?.hasMore;
  const change = (action: SeriesPreferenceAction) => {
    if (managed) {
      const operation: ManageSeries['operation'] = action === 'platform' ? 'remove' : action === 'toggle' ? managed.enabled ? 'disable' : 'enable' : action;
      workspace.reads?.setLibraryPreference?.({ action: 'manage', seriesId: childHealthSeries.id, operation, expectedState: managed.stateHash });
      return;
    }
    const update = seriesPreferenceChange(series.id, items, action);
    if (update) workspace.reads?.setLibraryPreference?.(workspace.model.references.data?.hasMore && !update.adopt
      ? { ...update, wholeSeries: true } : update);
    else {
      setExportNotice('來源設定已更新。請在重新載入後再選一次。');
      workspace.reads?.refreshContext?.();
    }
  };
  const firstDocument = requestedDocument && items.find(item => item.sourceId === requestedDocument);
  const documents = (firstDocument ? [firstDocument, ...items.filter(item => item !== firstDocument)] : items)
    .filter(item => !managed || category === 'all' || item.childHealth?.categories.includes(category));
  const requiresSelection = managed ? items.some(item => { const choice = libraryDocumentChoice(item); return choice?.selectedVersionId && !choice.eligible; })
    : preference?.mode !== 'platform' && items.some(item => item.preference?.eligible === false);
  const enabled = managed ? managed.enabled > 0 : preference?.enabled !== false;
  const state = managed ? childHealthStatus(managed) : preference?.mode === 'platform' ? '未下載' : !enabled ? '已停用' : requiresSelection ? '待選版本'
    : preference?.mode === 'fixed' ? '已固定' : preference?.mode === 'follow' ? '已跟隨' : '使用中';
  const selectedDocument = items.find(item => item.sourceId === settingsSource) ?? first;
  const choice = libraryDocumentChoice(selectedDocument);
  const currentPinned = choice?.enabled && choice.mode === 'fixed' && choice.selectedVersionId === selectedDocument.versionId;
  const pin = (item: PersonalLibraryItem) => {
    if (!managed || !item.versionHash) return;
    workspace.reads?.setLibraryPreference?.({ seriesId: childHealthSeries.id, expectedRevision: managed.revision,
      imported: true, enabled: true, mode: 'fixed', editions: [{ sourceId: item.sourceId, versionHash: item.versionHash }] });
  };
  return <AppDialog visible onDismiss={onClose} accessibilityLabel={series.name} style={managed ? styles.materialDialog : undefined}>
      <View style={styles.sheetHeading}><Text accessibilityRole="header" style={styles.sectionTitle}>{series.name}</Text><LibraryAction name="關閉" icon="close" onPress={onClose} /></View>
      <AppDialog.Content style={styles.dialogTabs}><UnderlineTabs id={tabsId} label="來源內容" items={[{key:'files',label:'文件'}, {key:'settings',label:'設定與匯出'}]} value={section} onChange={setSection} /></AppDialog.Content>
      <AppDialog.ScrollArea style={styles.scrollArea}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.dialogContent}>
      {workspace.model.references.state !== 'ready' ? <View style={styles.section}>
        <Text accessibilityLiveRegion="polite" style={styles.warning}>未能確認最新來源設定。</Text>
        {workspace.reads?.refreshContext ? <LibraryAction label="重新讀取參考" disabled={!workspace.model.online || workspace.reads.referencesBusy} onPress={workspace.reads.refreshContext} /> : null}
      </View> : null}
      {requiresSelection && enabled ? <Text style={styles.warning}>收錄範圍已更改。請在「設定與匯出」選用新版本。</Text> : null}
      <AppTabPanel tabsId={tabsId} tabKey="files" active={section === 'files'}><View style={styles.section}>
        {onJoin ? <LibraryAction label="加入目前的卡" tone="join" disabled={busy} onPress={onJoin} /> : null}
        {managed && categories.length > 0 ? <CatalogChoice label="分類" value={category} onChange={setCategory}
          options={[{ value: 'all', label: '全部' }, ...categories.map(value => ({ value, label: value }))]}
          action={!onJoin && !busy && managed.adopted < managed.total ? <PlatformCardJoin seriesId={series.id} compact /> : undefined} /> : null}
        <View style={styles.materialList}>{documents.map(item =>
          <CatalogDocument key={item.sourceId} item={item} onRead={() => setSettingsSource(item.sourceId)} />)}</View>
      </View></AppTabPanel>
      <AppTabPanel tabsId={tabsId} tabKey="settings" active={section === 'settings'}><View style={styles.section}>
      {preference ? <Metadata label="我的設定">{managed ? `${state}，${managed.enabled} 份已啟用` : state + ' · ' + (preference.mode === 'fixed' ? '固定快照' : preference.mode === 'follow' ? '跟隨同範圍更新' : '平台發布版')}</Metadata> : null}
      {(managed ? managed.adopted > 0 : preference && preference.mode !== 'platform') && workspace.reads?.setLibraryPreference ? <View style={styles.actions}>
        <AppButton label={enabled ? '停用來源' : '啟用來源'} variant="secondary" disabled={busy} onPress={() => change('toggle')} />
        <AppButton label="固定目前版本" variant="quiet" disabled={busy || !managed && (workspace.model.references.data?.hasMore || preference?.mode === 'fixed' && !requiresSelection && items.every(item => item.preference?.selectedVersionId === item.versionId))} onPress={() => change('fixed')} />
        <AppButton label="跟隨同範圍更新" variant="quiet" disabled={busy || (managed ? managed.fixed === 0 : preference?.mode === 'follow')} onPress={() => change('follow')} />
        <AppButton label="從我的參考資料刪除" variant="quiet" disabled={busy} onPress={() => change('platform')} />
      </View> : null}
      {section === 'settings' && (managed || maintenanceEntry) ? <View style={styles.documentSettings}>
        <CatalogChoice label="個別教材" value={selectedDocument.sourceId} onChange={setSettingsSource}
          options={items.map(item => ({ value: item.sourceId, label: item.title }))} />
        <Text style={styles.meta}>{documentStatus(selectedDocument)}</Text>
        {managed && selectedDocument.versionHash && workspace.reads?.setLibraryPreference && !currentPinned
          ? <LibraryAction label={choice?.enabled && choice.selectedVersionId ? '固定這份教材的目前版本' : '採用這份教材的固定版本'}
              disabled={busy} onPress={() => pin(selectedDocument)} /> : null}
        {!managed ? maintenanceEntry?.(selectedDocument.sourceId) : null}
      </View> : null}
      {workspace.model.references.data?.hasMore ? <Text style={styles.meta}>{managed ? '載入所有教材後可匯出。' : '載入所有來源後可固定目前版本及匯出。'}</Text> : null}
      {managed && parts > 1 && !workspace.model.references.data?.hasMore ? <CatalogChoice label="匯出教材範圍" value={String(start / libraryArchiveMaxEditions)} onChange={setArchivePart}
        options={Array.from({ length: parts }, (_, index) => ({ value: String(index), label: `第 ${index * libraryArchiveMaxEditions + 1} 至 ${Math.min(selected.length, (index + 1) * libraryArchiveMaxEditions)} 份` }))} /> : null}
    {workspace.reads?.exportLibraryArchive && !workspace.model.references.data?.hasMore ? <View style={styles.actions}>
      <Text style={styles.meta}>分享原文請註明出處，僅限非商業用途。</Text>
      <AppButton label={exporting ? '正在匯出…' : '匯出來源庫 ZIP'} variant="secondary"
        disabled={busy || exporting || !archiveEditions.length} onPress={async () => {
          if (exportLock.current || !workspace.reads?.exportLibraryArchive) return;
          exportLock.current = true; setExporting(true); setExportNotice(''); setFingerprint(''); setShareFile(null);
          try {
            const result = await workspace.reads.exportLibraryArchive({ seriesId: series.id, editions: archiveEditions });
            if (active.current && result) { setExportNotice(result.message); setFingerprint(result.sha256); setShareFile(() => result.share ?? null); }
          } catch (error) { if (active.current) setExportNotice(error instanceof Error ? error.message : '暫未能匯出知識包。'); }
          finally { exportLock.current = false; if (active.current) setExporting(false); }
        }} />
      {shareFile ? <AppButton label="分享這個 ZIP" variant="quiet" disabled={busy || exporting} onPress={() => {
        void shareFile().catch(error => { if (active.current && error?.name !== 'AbortError') setExportNotice('未能開啟系統分享選單。'); });
      }} /> : null}
      {fingerprint ? <Metadata label="ZIP SHA-256">{fingerprint}</Metadata> : null}
    </View> : null}
    {items.every(item => item.versionHash) && !workspace.model.references.data?.hasMore ? <AppButton label="匯出版本參照 ZIP" variant="quiet" disabled={busy || !archiveEditions.length}
      onPress={() => { void exportSeriesReferences(items.filter(item => archiveEditions.some(ref => ref.sourceId === item.sourceId))).then(bytes => exportAttachment(new Uint8Array(bytes), 'application/zip', series.id + '.zip', () => active.current))
        .then(message => { if (active.current) setExportNotice(message); }, () => { if (active.current) setExportNotice('未能匯出版本參照。'); }); }} /> : null}
    {exportNotice ? <Text accessibilityLiveRegion="polite" style={styles.meta}>{exportNotice}</Text> : null}
      </View></AppTabPanel></ScrollView></AppDialog.ScrollArea>
    </AppDialog>;
}
function ImportLibrary({ catalog, workspace }: { catalog: readonly PersonalLibraryItem[]; workspace: MemoryReferenceWorkspaceValue }) {
  const [pending, setPending] = useState<Awaited<ReturnType<typeof readSeriesReferences>> | null>(null);
  const [notice, setNotice] = useState(''), [reading, setReading] = useState(false);
  const life = useRef<AbortController | null>(null);
  useEffect(() => () => { life.current?.abort(); }, []);
  const select = async () => {
    life.current?.abort();
    const controller = new AbortController(); life.current = controller;
    setPending(null); setNotice(''); setReading(true);
    try {
      const file = await pickImportPackage(controller.signal, libraryPickLimit);
      if (!file) return;
      try {
        const result = await readSeriesReferences(file, catalog);
        if (!controller.signal.aborted) setPending(result);
      } finally { file.release(); }
    } catch (error) {
      if (!controller.signal.aborted) setNotice(error instanceof Error && error.message === 'library_reference_unavailable'
        ? '包內有尚未發布的文件。請將完整知識包及 SHA-256 交給管理員匯入。'
        : '未能核對 ZIP。請選取完整的版本參照包。');
    } finally { if (!controller.signal.aborted) setReading(false); }
  };
  return <View style={styles.importControl}><AppButton label={reading ? '正在核對…' : '匯入 ZIP'} accessibilityLabel="匯入來源庫 ZIP" density="compact" variant="secondary"
    disabled={reading || !workspace.model.online || workspace.reads?.referencesBusy} onPress={() => { void select(); }} />
    {notice ? <Text style={styles.warning}>{notice}</Text> : null}
    {pending ? <View style={styles.details}><Text>{pending.series.name} · {pending.editions.length} 份文件</Text>
      <AppButton label="選用包內固定版本" disabled={!workspace.model.online || workspace.reads?.referencesBusy} onPress={() => {
        workspace.reads?.setLibraryPreference?.({ seriesId: pending.series.id, expectedRevision: pending.revision, enabled: true,
          mode: 'fixed', imported: true, editions: pending.editions }); setPending(null);
      }} /></View> : null}</View>;
}
const referenceFilters: Record<string, string> = { official_guidance: '官方指引', recent_information: '近期資訊',
  feeding: '餵食', development: '兒童發展', play: '遊戲', vision: '視力', checkup: '健康檢查' };
function seriesFor(item: PersonalLibraryItem) {
  return item.childHealth ? childHealthSeries : item.series ?? sourceSeries(item);
}
function seriesEnabled(items: PersonalLibraryItem[]) {
  const managed = items[0].childHealth;
  return managed ? managed.enabled > 0 : items.some(item => !item.preference || item.preference.mode !== 'platform' && item.preference.enabled);
}
function joinSeries(items: PersonalLibraryItem[]): LibrarySelectionCommand | null {
  const first = items[0], managed = first.childHealth, seriesId = seriesFor(first).id;
  if (managed) return { action: 'manage', seriesId: childHealthSeries.id, expectedState: managed.stateHash, operation: managed.adopted ? 'enable' : 'join' };
  if (!first.preference) return null;
  const command = first.preference.mode === 'platform' ? platformLibraryJoin(items) : seriesPreferenceChange(seriesId, items, 'toggle');
  if (!command) return null;
  return { ...command, wholeSeries: true, editions: [{ sourceId: first.sourceId, versionId: first.versionId }] };
}
function ReferenceSection({ model, workspace, maintenanceEntry, personal, active }: {
  model: MemoryReferenceModel; workspace: MemoryReferenceWorkspaceValue; maintenanceEntry?: MaintenanceEntry; personal?: PersonalCardRows; active: boolean;
}) {
  const read = model.references, catalog = read.data?.catalog, sources = visibleKnowledgeReferences(read);
  const { series: original, sourceDocument, catalog: entry } = useLocalSearchParams<{ series?: string; sourceDocument?: string; catalog?: string }>();
  const groups = new Map<string, PersonalLibraryItem[]>();
  for (const item of catalog ?? []) {
    const id = seriesFor(item).id, group = groups.get(id);
    if (group) group.push(item); else groups.set(id, [item]);
  }
  const linked = sourceDocument && catalog?.find(item => item.sourceId === sourceDocument);
  const oldSeries = original && catalog?.find(item => item.series?.id === original);
  const requested = linked ? seriesFor(linked).id : oldSeries ? seriesFor(oldSeries).id : original;
  const [opened, setOpened] = useState<string | undefined>(requested), [section, setSection] = useState<'files' | 'settings'>('files');
  const [store, setStore] = useState(entry === 'platform'), [filter, setFilter] = useState('all');
  const [pending, setPending] = useState<{ id: string; before: typeof read.data } | null>(null);
  const [focusId, setFocusId] = useState(''), [notice, setNotice] = useState(''), [registeredOpen, setRegisteredOpen] = useState(false);
  const rows = useRef(new Map<string, View>()), shopRef = useRef<View>(null);
  useEffect(() => { setOpened(requested); setSection('files'); }, [requested, sourceDocument]);
  useEffect(() => { if (entry === 'platform') setStore(true); }, [entry]);
  useFocusEffect(useCallback(() => () => { setOpened(undefined); setStore(false); setPending(null); setFocusId(''); }, []));
  const busy = !!workspace.reads?.referencesBusy, complete = model.online && read.state === 'ready' && !read.data?.hasMore;
  const loadRemaining = workspace.reads?.loadAllReferences ?? workspace.reads?.loadMoreReferences;
  useEffect(() => {
    if (active && model.online && !busy && read.state === 'ready' && read.data?.hasMore) loadRemaining?.();
  }, [active, model.online, busy, read.state, read.data, loadRemaining]);
  const joined = !!pending && groups.has(pending.id) && seriesEnabled(groups.get(pending.id)!);
  useEffect(() => {
    if (!pending || busy || !complete || read.data === pending.before) return;
    setPending(null);
    if (joined) { setOpened(undefined); setStore(false); setFocusId(pending.id); setNotice('已加入目前的卡'); }
    else setNotice('已重新讀取，這張卡尚未啟用。');
  }, [pending, busy, complete, read.data, joined]);
  useEffect(() => {
    if (!focusId || store || opened) return;
    const frame = requestAnimationFrame(() => {
      const control = rows.current.get(focusId) ?? shopRef.current;
      control?.focus();
      if (Platform.OS === 'web') (control as unknown as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
      setFocusId('');
    });
    return () => cancelAnimationFrame(frame);
  }, [focusId, store, opened]);
  const open = (id: string, settings = false) => { setOpened(id); setSection(settings ? 'settings' : 'files'); };
  const openShop = () => { setStore(true); setNotice(''); setFilter('all'); setRegisteredOpen(false); };
  const closeShop = () => { setStore(false); setFocusId('shop'); };
  const join = (id: string, command: LibrarySelectionCommand) => {
    if (!workspace.reads?.setLibraryPreference || !complete || busy || pending) return;
    setPending({ id, before: read.data }); setNotice(''); workspace.reads.setLibraryPreference(command);
  };
  const openItems = opened ? groups.get(opened) : undefined;
  const enabledOpen = !!openItems && seriesEnabled(openItems);
  const priorOpen = useRef({ id: opened, enabled: enabledOpen });
  useEffect(() => {
    if (priorOpen.current.id !== opened || enabledOpen) {
      priorOpen.current = { id: opened, enabled: enabledOpen };
      return;
    }
    if (!complete || busy) return;
    if (opened && priorOpen.current.enabled) {
      setOpened(undefined); setFocusId('shop'); setNotice('已停用，可在平台卡列表重新加入。');
    }
    priorOpen.current = { id: opened, enabled: enabledOpen };
  }, [opened, enabledOpen, complete, busy]);
  const currentRows: ReactNode[] = [], storeRows: ReactNode[] = [];
  const tags = [...new Set((catalog ?? []).flatMap(item => [item.classification, ...(item.topics ?? [])]))];
  for (const [id, items] of groups) {
    const first = items[0], managed = first.childHealth, title = seriesFor(first).name, enabled = seriesEnabled(items);
    const count = managed ? managed.total + ' 份教材' : items.length + ' 份文件';
    const subtitle = (managed ? '家庭健康服務' : first.publisher) + ' · ' + count;
    const props = { title, subtitle, art: managed ? 'health' as const : 'platform' as const };
    if (enabled) currentRows.push(<LibraryRow key={id} {...props} label={title + '，' + count} testID={'memory-catalog-series-' + id}
      rowRef={node => { if (node) rows.current.set(id, node); else rows.current.delete(id); }} onOpen={() => open(id)}
      action={<LibraryAction name={title + '的操作'} icon="dots-horizontal" onPress={() => open(id, true)} />} />);
    if (store && (filter === 'all' || items.some(item => item.classification === filter || item.topics?.includes(filter)))) {
      const command = !enabled && joinSeries(items);
      storeRows.push(<LibraryRow key={id} {...props} onOpen={() => open(id)} testID={'platform-store-' + id}
        action={enabled ? <Text style={styles.meta}>✓ 已加入</Text> : <LibraryAction label="加入" name={'加入' + title} tone="join"
          disabled={!command || !model.online || !complete || busy || !!pending || !workspace.reads?.setLibraryPreference}
          onPress={() => { if (command) join(id, command); }} />} />);
    }
  }
  const retry = workspace.reads?.refreshContext;
  const status = <>
    {read.state !== 'ready' ? <ReadNotice read={read} unavailable="參考來源暫未提供" /> : null}
    {pending ? <Text accessibilityLiveRegion="polite" style={styles.meta}>{busy ? '正在加入…' : read.state !== 'ready' ? '未能確認是否已加入，請重新讀取參考。' : ''}</Text> : null}
    {read.state === 'ready' && read.data?.hasMore ? <Text accessibilityLiveRegion="polite" style={styles.meta}>正在讀取其餘平台卡…</Text> : null}
    {['error', 'unavailable', 'stale'].includes(read.state) && retry ? <LibraryAction label="重新讀取參考" disabled={!model.online || busy} onPress={retry} /> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.meta}>{notice}</Text> : null}
  </>;
  const registered = read.data?.registered ?? [];
  const detailJoin = openItems && !enabledOpen && joinSeries(openItems);
  return <View style={styles.section}>
    <SourceLibrary personal={personal} platformRows={currentRows} ready={complete && !sources.length}
      shop={(!sources.length || catalog) && <LibraryAction label="平台卡列表" icon="book-open-variant" tone="shop" buttonRef={shopRef} onPress={openShop} />}
      status={<>{status}{original && requested && original !== requested && linked ? <Text style={styles.meta}>這份文件現歸入「{seriesFor(linked).name}」。聊天引用保留當時的版本。</Text> : null}
        {requested && complete && !groups.has(requested) ? <Text style={styles.meta}>原系列已不在目前目錄，舊引用仍可從聊天查看。</Text> : null}</>} />
    {!catalog ? sources.map(source => <ReferenceCard key={source.chunkId} source={source} />) : null}
    {active && store && !openItems && (catalog || !sources.length) ? <LibrarySheet title="平台卡列表" close={closeShop}
      action={complete && (registered.length > 0 || workspace.reads?.setLibraryPreference) ? <LibraryAction name="平台卡列表選項" expanded={registeredOpen} icon="dots-horizontal" onPress={() => setRegisteredOpen(!registeredOpen)} /> : null}>
      {groups.size > 1 && tags.length > 1 ? <CatalogChoice label="分類" value={filter} onChange={setFilter} options={[{value:'all',label:'全部'}, ...tags.map(value => ({value,label:referenceFilters[value] ?? value}))]} /> : null}
      {storeRows}{complete && !storeRows.length ? <Text style={styles.meta}>暫無符合的已發布平台卡</Text> : null}{status}
      {registeredOpen && complete ? <View style={styles.details}>
        {catalog && workspace.reads?.setLibraryPreference ? <ImportLibrary catalog={catalog} workspace={workspace} /> : null}
        {registered.map(item => <View key={item.sourceId}><Text style={styles.cardTitle}>{item.series.name}</Text>
          <Text style={styles.meta}>{item.publisher} · {item.kind === 'pdf' ? 'PDF' : '網頁'} · {({registered:'已登記來源',pending:'待核對或發布',withdrawn:'已停用或失效'})[item.status]}{item.live ? ' · 可按次即時搜尋' : ''}</Text>
          <Text selectable style={styles.meta}>{item.url}</Text>{item.lastCheckedAt ? <Metadata label="最近檢查">{memoryDateLabel(item.lastCheckedAt)}</Metadata> : null}</View>)}
      </View> : null}
    </LibrarySheet> : null}
    {active && openItems && opened ? <CatalogDetail key={opened} items={openItems} workspace={workspace} initialSection={section} requestedDocument={sourceDocument}
      onJoin={detailJoin && workspace.reads?.setLibraryPreference ? () => join(opened, detailJoin) : undefined}
      maintenanceEntry={maintenanceEntry} onClose={() => { setOpened(undefined); if (!store) setFocusId(opened); }} /> : null}
  </View>;
}
type MemoryReferenceViewProps = { personal?: PersonalCardRows; maintenanceEntry?: MaintenanceEntry; tabActions?: ReactNode; confirmerDisplay?: MemoryConfirmerDisplay; onPrepareQuestion?: (question: string) => void; activeTab?: Tab; onTabChange?: (tab: Tab) => void };
function ScopedMemoryReferenceView({ workspace, personal, maintenanceEntry, confirmerDisplay, onPrepareQuestion, tabActions, activeTab, onTabChange }: MemoryReferenceViewProps & { workspace: MemoryReferenceWorkspaceValue }) {
  const { model } = workspace;
  const router = useRouter(), navigate = usePreviewNavigation();
  const { series } = useLocalSearchParams<{ series?: string }>();
  const [localTab, setLocalTab] = useState<Tab>(series ? 'references' : 'long'), [otherOpen, setOtherOpen] = useState(false);
  const tab = activeTab ?? localTab;
  const setTab = (value: Tab) => { setLocalTab(value); onTabChange?.(value); };
  const tabsId = useId(), container = useContainerWidth();
  useEffect(() => { if (series) setTab('references'); }, [series]);
  const current = useRef<MemoryReferenceWorkspaceValue | null>(workspace);
  current.current = workspace;
  useLayoutEffect(() => {
    current.current = workspace;
    return () => { if (current.current === workspace) current.current = null; };
  }, [workspace]);
  const facts = visibleMemoryFacts(model), confirmed = facts.filter(fact => fact.status === "confirmed"), other = facts.filter(fact => fact.status !== "confirmed");
  const onQuestion = onPrepareQuestion ? (fact: Readonly<MemoryFactView>) => {
    // A stale card callback cannot use the next child or a replaced fact version.
    if (current.current !== workspace || !visibleMemoryFacts(current.current.model).some(item => item.id === fact.id && item.version === fact.version)) return;
    onPrepareQuestion(memoryClarificationQuestion(model.childName, fact));
  } : undefined;
  function renderFact(fact: Readonly<MemoryFactView>) {
    return <FactCard key={`${fact.id}:${fact.version}`} fact={fact} model={model} workspace={workspace} confirmerDisplay={confirmerDisplay} onQuestion={onQuestion} />;
  }
  return <View ref={container.ref} onLayout={container.onLayout} style={styles.root}>
    <TabToolbar actions={tabActions} stacked={container.width < 480}><UnderlineTabs id={tabsId} label="記憶與參考分類" items={tabs} value={tab} onChange={setTab} /></TabToolbar>
    <AppTabPanel tabsId={tabsId} tabKey="short" active={tab === "short"}><View style={styles.section}>
      <ReadNotice read={model.shortTerm} unavailable="目前工作脈絡暫未提供" online={model.online} emptyTitle="暫無近期工作或對話" empty={model.shortTerm.data?.works ? model.shortTerm.data.works.length === 0 && model.shortTerm.data.messages.length === 0 : model.shortTerm.data?.messages.length === 0}>
        {model.shortTerm.data?.works?.length ? <View style={styles.agenda}><View style={styles.sectionHead}><AppIcon name="clipboard-check-outline" size={21} /><Text accessibilityRole="header" style={styles.sectionTitle}>工作事項</Text></View>
          <PersistentWorkCards compact items={model.shortTerm.data.works} online={model.online} busy={workspace.reads?.messageBusy}
          onMessage={workspace.reads?.readWorkMessage ? id => {
            if (current.current !== workspace || !current.current.model.shortTerm.data?.works?.some(work => work.sourceMessageIds.includes(id))) return;
            workspace.reads?.readWorkMessage?.(id);
          } : undefined}
          onResource={path => { if (current.current === workspace) navigate(() => router.push(path as Href)); }}
          onContinue={onPrepareQuestion ? work => {
            if (current.current !== workspace || !current.current.model.shortTerm.data?.works?.some(item => item.id === work.id && item.version === work.version)) return;
            onPrepareQuestion(personalWorkQuestion(model.childName, work));
          } : undefined} /></View> : null}
        {model.shortTerm.data?.messages.length ? <View style={styles.timeline}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>近期對話</Text>
          {model.shortTerm.data.messages.map(message => <View key={message.id} style={styles.turn}>
            <View style={styles.rail}><View style={[styles.dot, message.role === 'user' && styles.parentDot]} /><View style={styles.stem} /></View>
            <View style={styles.turnBody}><Text style={styles.speaker}>{message.role === 'user' ? '你' : '助手'}</Text>
              <Text selectable style={styles.body}>{message.text}</Text></View>
          </View>)}
        </View> : null}
        {model.shortTerm.data?.hasMoreWorks ? <AppButton label="載入更多工作" variant="quiet" disabled={!model.online || workspace.reads?.workBusy} onPress={() => workspace.reads?.loadMoreWork?.()} /> : null}
      </ReadNotice>
      {["error", "unavailable", "stale"].includes(model.shortTerm.state) && workspace.reads?.refreshContext ? <AppButton label="重新讀取工作脈絡" variant="quiet" disabled={!model.online || workspace.reads.workBusy} onPress={workspace.reads.refreshContext} /> : null}
      {model.shortTerm.data?.messageRead ? <HistoryMessageDetail read={model.shortTerm.data.messageRead} busy={workspace.reads?.messageBusy} online={model.online}
        onMore={workspace.reads?.loadMoreWorkMessage} onClose={workspace.reads?.closeWorkMessage} onPrepareQuestion={onPrepareQuestion ? message => {
          if (current.current !== workspace || current.current.model.shortTerm.data?.messageRead?.data !== message) return;
          onPrepareQuestion(historyMessageQuestion(model.childName, message));
        } : undefined} /> : null}
    </View></AppTabPanel>
    <AppTabPanel tabsId={tabsId} tabKey="long" active={tab === "long"}><View style={styles.section}>
      <ReadNotice read={model.longTerm} unavailable="記憶資料暫未提供">
        <View style={styles.section}><View style={styles.sectionHead}><AppIcon name="notebook-outline" size={22} /><Text accessibilityRole="header" style={styles.sectionTitle}>已確認事實</Text></View>
          {confirmed.length ? <View style={styles.notebook}>{confirmed.map(renderFact)}</View> : model.longTerm.state === "ready" && model.online ? <EmptyListCard title="暫無已確認事實" detail={model.longTerm.data.hasMoreFacts ? "仍有記憶未載入，可繼續讀取。" : undefined} /> : <BackgroundSurface padded><Text style={styles.meta}>已確認事實尚未重新核對</Text></BackgroundSurface>}
        </View>
        {model.longTerm.data?.hasMoreFacts ? workspace.reads?.loadMoreFacts ? <AppButton label="載入更多記憶" variant="quiet" disabled={!model.online} onPress={workspace.reads.loadMoreFacts} />
          : <BackgroundSurface padded><Text style={styles.meta}>仍有記憶未載入</Text></BackgroundSurface> : null}
        {model.longTerm.data?.summary ? <SummaryCard key={`${model.longTerm.data.summary.id}:${model.longTerm.data.summary.version}`} summary={model.longTerm.data.summary} /> : null}
        {other.length ? <View style={styles.section}><AppButton label={otherOpen ? "收起待核對與停用資料" : `待核對與停用（${other.length}）`} expanded={otherOpen} variant="quiet" onPress={() => setOtherOpen(value => !value)} />
          {otherOpen ? <View style={styles.notebook}>{other.map(renderFact)}</View> : null}</View> : null}
      </ReadNotice>
    </View></AppTabPanel>
    <AppTabPanel tabsId={tabsId} tabKey="references" active={tab === "references"}><ReferenceSection model={model} active={tab === "references"} personal={personal} maintenanceEntry={maintenanceEntry} workspace={workspace} /></AppTabPanel>
  </View>;
}
export function MemoryReferenceView({ personal, maintenanceEntry, confirmerDisplay, onPrepareQuestion, tabActions, activeTab, onTabChange }: MemoryReferenceViewProps) {
  const workspace = useMemoryReferenceWorkspace();
  const currentDisplay = workspace && confirmerDisplay?.scopeKey === workspace.scopeKey && confirmerDisplay.childId === workspace.model.childId ? confirmerDisplay : undefined;
  return workspace ? <ScopedMemoryReferenceView key={workspace.scopeKey} personal={personal} maintenanceEntry={maintenanceEntry} workspace={workspace} tabActions={tabActions} confirmerDisplay={currentDisplay} onPrepareQuestion={onPrepareQuestion} activeTab={activeTab} onTabChange={onTabChange} />
    : <ReadStateNotice state="unavailable" title="暫不能查看記憶與參考" message="請先選擇有權查看的孩子。">{tabActions}</ReadStateNotice>;
}
const styles = StyleSheet.create({
  root: { width: "100%", minWidth: 0, gap: spacing.lg },
  section: { gap: spacing.md, minWidth: 0 },
  sectionTitle: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section },
  importControl: { alignItems: 'flex-start', gap: spacing.xs, minWidth: 0, maxWidth: '100%' },
  dialogTabs: { paddingBottom: 0 },
  sheetHeading: { marginTop: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: spacing.lg },
  materialDialog: { maxWidth: 720 },
  seriesTools: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  seriesFilter: { maxWidth: '100%', flexShrink: 1 },
  materialList: { minWidth: 0, borderTopWidth: 1, borderColor: colors.line },
  materialRow: { minWidth: 0, paddingVertical: spacing.xs, borderBottomWidth: 1, borderColor: colors.softLine },
  materialHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  materialMain: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.sm },
  materialLink: { minWidth: 44, minHeight: 44, alignItems: 'flex-start', justifyContent: 'center' },
  documentLink: { minWidth: 0, flexBasis: 300, flexGrow: 1, flexShrink: 1, maxWidth: '100%' },
  webMediaTarget: { minHeight: 38 },
  mediaLink: { flex: 1, minWidth: 0 },
  materialTitle: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section, textDecorationLine: 'underline' },
  materialToggle: { width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.small },
  materialDetails: { minWidth: 0, gap: spacing.xs, paddingVertical: spacing.sm },
  mediaGroup: { width: '100%', maxWidth: 420 },
  mediaHeading: { color: colors.muted, fontFamily: chineseFont, ...readingType.meta, fontWeight: '600' },
  mediaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.softLine },
  mediaTitle: { color: colors.deepTeal, fontFamily: chineseFont, ...readingType.tool, textDecorationLine: 'underline' },
  transcriptText: { color: colors.deepTeal, fontFamily: chineseFont, ...readingType.meta, textDecorationLine: 'underline' },
  documentSettings: { gap: spacing.xs, alignItems: 'flex-start', minWidth: 0 },
  scrollArea: { paddingHorizontal: 0, flexShrink: 1 },
  dialogContent: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  notebook: { borderTopWidth: 2, borderTopColor: colors.ink, minWidth: 0 },
  factRow: { borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: spacing.md, gap: spacing.xs, minWidth: 0 },
  summary: { gap: spacing.sm, borderLeftWidth: 3, borderLeftColor: colors.sage, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.quietSurface },
  summaryTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  agenda: { gap: spacing.sm, minWidth: 0 },
  timeline: { gap: spacing.sm, minWidth: 0 },
  turn: { flexDirection: 'row', gap: spacing.md, minWidth: 0 },
  rail: { width: 12, alignItems: 'center', paddingTop: 6 },
  dot: { width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.sage },
  parentDot: { backgroundColor: colors.paper },
  stem: { width: 1, flexGrow: 1, backgroundColor: colors.line, marginTop: spacing.xs },
  speaker: { color: colors.muted, fontFamily: chineseFont, ...readingType.meta, fontWeight: '700' },
  turnBody: { flex: 1, gap: spacing.xs, paddingBottom: spacing.md },
  card: { backgroundColor: colors.paper, borderColor: colors.line, borderWidth: 1, borderRadius: radius.medium, padding: spacing.lg, gap: spacing.sm, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", flexWrap: "wrap", gap: spacing.sm, minWidth: 0 },
  cardTitle: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section, flexShrink: 1 },
  factTopic: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, flex: 1, minWidth: 0 },
  factContent: { fontFamily: chineseFont, color: colors.ink, fontSize: 18, lineHeight: 28, fontWeight: "600", flexShrink: 1 },
  factContext: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, minWidth: 0 },
  metadataLine: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minWidth: 0, flexShrink: 1 },
  sourceTrigger: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minHeight: 36, paddingHorizontal: spacing.xs, borderRadius: radius.small, minWidth: 0, flexShrink: 1 },
  sourceLabel: { fontFamily: chineseFont, color: colors.deepTeal, ...readingType.meta, flexShrink: 1 },
  sourcePressed: { backgroundColor: colors.paleTeal },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.body, flexShrink: 1 },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, flexShrink: 1 },
  warning: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.tool, flexShrink: 1 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, minWidth: 0 },
  details: { borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.sm, gap: spacing.sm, minWidth: 0 },
  history: { gap: spacing.md, minWidth: 0 }, historyEntry: { borderLeftWidth: 2, borderLeftColor: colors.sage, paddingLeft: spacing.md, gap: spacing.xs, minWidth: 0 },
});
