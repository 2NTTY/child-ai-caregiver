import { BackgroundSurface } from "../appearance/BackgroundSurface";
import { exportAttachment } from '../../platform/file-export';
import { pickImportPackage } from '../../platform/package-import';
import { exportSeriesReferences, libraryPickLimit, readSeriesReferences } from '../../production/library-package';
import { EmptyListCard } from "../EmptyListCard";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SourceDocumentCard } from "./SourceDocumentCard";
import { PlatformCardJoin } from './PlatformCardJoin';
import { AppDialog } from "../AppDialog";
import { sourceSeries } from "../../../../src/shared/source-series";
import { useFocusEffect, useRouter, useLocalSearchParams, type Href } from "expo-router";
import { usePreviewNavigation } from "../../preview/PreviewNavigationGuard";
import { selectedLibraryEditions, type PersonalLibraryItem } from "../../../../src/shared/personal-library";
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
import { AppButton, AppSelect, AppTabPanel, UnderlineTabs, TabToolbar } from "../ui";
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
      <Metadata label="年齡依據">{source.applicability.ageBasis === "any" ? "未限年齡依據" : source.applicability.ageBasis === "corrected" ? "校正年齡" : "實際年齡"}</Metadata>
      <Metadata label="月齡範圍">{source.applicability.minAgeMonths ?? "未提供下限"} 至 {source.applicability.maxAgeMonths ?? "未提供上限"}{source.applicability.maxAgeMonthsExclusive ? "（不含上限）" : ""}</Metadata>
      {source.applicability.conditions.length ? <Metadata label="適用條件">{source.applicability.conditions.join("；")}</Metadata> : null}
      <AppButton label={technical ? "收起版本識別" : "查看版本識別"} expanded={technical} variant="quiet" density="compact" onPress={() => setTechnical(value => !value)} />
      {technical ? <View style={styles.details}><Metadata label="來源">{source.sourceId}</Metadata><Metadata label="版本">{source.versionId}</Metadata><Metadata label="片段">{source.chunkId}</Metadata>
        <Metadata label="版本校驗">{source.versionHash}</Metadata><Metadata label="內容校驗">{source.contentHash}</Metadata><Metadata label="取得時間">{memoryDateLabel(source.fetchedAt)}</Metadata></View> : null}
    </View> : null}
  </View>;
}
type MaintenanceEntry = (sourceId: string) => ReactNode;
const topicArt: Record<string, { icon: AppIconName; tint: string }> = {
  feeding: { icon: 'silverware-fork-knife', tint: colors.paleAmber },
  development: { icon: 'sprout', tint: colors.sage },
  vision: { icon: 'eye', tint: colors.paleTeal },
  checkup: { icon: 'clipboard-check-outline', tint: colors.paleTeal },
};
function CatalogDocument({ item, maintenanceEntry }: { item: PersonalLibraryItem; maintenanceEntry?: MaintenanceEntry }) {
  const [metadata, setMetadata] = useState(false), [linkFailed, setLinkFailed] = useState(false);
  const fetched = item.lastSuccessfulCheckAt ?? item.fetchedAt;
  return <SourceDocumentCard testID={`memory-catalog-source-${item.sourceId}`} title={item.title}
    byline={`${item.coverage ?? '部分收錄'} · ${item.classification === 'official_guidance' ? '官方指引' : '近期資訊'}`}>
    <View style={styles.actions}>
      <AppButton label="開啟來源網站" variant="secondary" density="compact" onPress={() => {
        setLinkFailed(false); void Linking.openURL(item.url).catch(() => setLinkFailed(true));
      }} />
      <AppButton label={metadata ? '收起資料' : '版本資料'} expanded={metadata} variant="quiet" density="compact" onPress={() => setMetadata(value => !value)} />
    </View>
    {linkFailed ? <Text selectable style={styles.warning}>未能開啟：{item.url}</Text> : null}
    {metadata ? <View style={styles.historyEntry}>
      <Metadata label="發布版本">{item.versionId}</Metadata>
      {item.preference?.mode === 'fixed' && item.preference.selectedVersionId ? <Metadata label="已選快照">{item.preference.selectedVersionId}</Metadata> : null}
      {item.publishedAt ? <Metadata label="發布">{memoryDateLabel(item.publishedAt)}</Metadata> : null}
      {fetched ? <Metadata label="最近取得">{memoryDateLabel(fetched)}</Metadata> : null}
      {item.lastCheckedAt ? <Metadata label="最近檢查">{memoryDateLabel(item.lastCheckedAt)}</Metadata> : null}
      {item.methods?.length ? <Metadata label="整理方式">{item.methods.join('、')}</Metadata> : null}
    </View> : null}
    {maintenanceEntry?.(item.sourceId)}
  </SourceDocumentCard>;
}
function CatalogSeries({ items, workspace, details, onOpen, onClose, maintenanceEntry, width, requestedDocument }: {
  items: PersonalLibraryItem[]; workspace: MemoryReferenceWorkspaceValue; details: boolean;
  onOpen: () => void; onClose: () => void; maintenanceEntry?: MaintenanceEntry; requestedDocument?: string; width: `${number}%`;
}) {
  const [section, setSection] = useState<'files' | 'settings'>('files');
  const tabsId = useId();
  useEffect(() => { if (!details) setSection('files'); }, [details]);
  const [exportNotice, setExportNotice] = useState(''), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [exporting, setExporting] = useState(false), [fingerprint, setFingerprint] = useState('');
  const exportLock = useRef(false), [shareFile, setShareFile] = useState<(() => Promise<void>) | null>(null);
  const first = items[0]!, series = first.series ?? sourceSeries(first), preference = first.preference;
  const busy = workspace.reads?.referencesBusy || !workspace.model.online || workspace.model.references.state !== 'ready';
  const change = (action: SeriesPreferenceAction) => {
    const update = seriesPreferenceChange(series.id, items, action);
    if (update) workspace.reads?.setLibraryPreference?.(update);
    else {
      setExportNotice('來源設定已更新。請在重新載入後再選一次。');
      workspace.reads?.refreshContext?.();
    }
  };
  const firstDocument = requestedDocument && items.find(item => item.sourceId === requestedDocument);
  const documents = firstDocument ? [firstDocument, ...items.filter(item => item !== firstDocument)] : items;
  const requiresSelection = items.some(item => item.preference?.eligible === false);
  const enabled = preference?.enabled !== false;
  const state = !enabled ? '已停用' : requiresSelection ? '待選版本' : preference?.mode === 'fixed' ? '已固定'
    : preference?.mode === 'follow' ? '已跟隨' : '使用中';
  const fileCount = `${workspace.model.references.data?.hasMore ? '已載入 ' : ''}${items.length} 份文件`;
  const art = items.flatMap(item => item.topics ?? []).map(topic => topicArt[topic]).find(Boolean);
  return <View style={{ width }} testID={`memory-catalog-series-${series.id}`}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${series.name}，${fileCount}，${state}`} accessibilityState={{ expanded: details }}
      onPress={onOpen}
      style={({ pressed }) => [styles.cover, pressed && styles.coverPressed]}>
      <View style={[styles.coverBody, { backgroundColor: art?.tint ?? colors.quietSurface }]}>
        <View style={styles.coverTop}><AppIcon name={art?.icon ?? 'book-open-variant'} size={30} color={colors.ink} />
          <View style={styles.coverState}><Text style={styles.stateText}>{state}</Text></View></View>
        <Text style={styles.coverTitle}>{series.name}</Text>
      </View>
      <View style={styles.coverFooter}><Text style={styles.count}>{fileCount}</Text><AppIcon name="arrow-right" size={18} /></View>
    </Pressable>
    {details ? <AppDialog visible onDismiss={onClose} accessibilityLabel={series.name}>
      <AppDialog.Title>{series.name}</AppDialog.Title>
      <AppDialog.Content style={styles.dialogTabs}><UnderlineTabs id={tabsId} label="來源內容" items={[{key:'files',label:'文件'}, {key:'settings',label:'設定與匯出'}]} value={section} onChange={setSection} /></AppDialog.Content>
      <AppDialog.ScrollArea style={styles.scrollArea}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.dialogContent}>
      {requiresSelection && enabled ? <Text style={styles.warning}>收錄範圍已更改。請在「設定與匯出」選用新版本。</Text> : null}
      <AppTabPanel tabsId={tabsId} tabKey="files" active={section === 'files'}><View style={styles.section}>
        <PlatformCardJoin seriesId={series.id} />
        {documents.map(item => <CatalogDocument key={item.sourceId} item={item} maintenanceEntry={maintenanceEntry} />)}
      </View></AppTabPanel>
      <AppTabPanel tabsId={tabsId} tabKey="settings" active={section === 'settings'}><View style={styles.section}>
      {preference ? <Metadata label="我的設定">{state} · {preference.mode === 'fixed' ? '固定快照' : preference.mode === 'follow' ? '跟隨同範圍更新' : '平台發布版'}</Metadata> : null}
      {preference && workspace.reads?.setLibraryPreference && !workspace.model.references.data?.hasMore ? <View style={styles.actions}>
        <AppButton label={enabled ? '停用來源' : '啟用來源'} variant="secondary" disabled={busy} onPress={() => change('toggle')} />
        <AppButton label="固定目前版本" variant="quiet" disabled={busy || preference.revision > 0 && preference.mode === 'fixed' && !requiresSelection && items.every(item => item.preference?.selectedVersionId === item.versionId)} onPress={() => change('fixed')} />
        <AppButton label="跟隨同範圍更新" variant="quiet" disabled={busy || preference.mode === 'follow'} onPress={() => change('follow')} />
        {preference.mode !== 'platform' ? <AppButton label="使用平台版本" variant="quiet" disabled={busy} onPress={() => change('platform')} /> : null}
      </View> : null}
      {workspace.model.references.data?.hasMore ? <Text style={styles.meta}>載入所有來源後可更改設定及匯出。</Text> : null}
    {workspace.reads?.exportLibraryArchive && !workspace.model.references.data?.hasMore ? <View style={styles.actions}>
      <Text style={styles.meta}>分享原文請註明出處，僅限非商業用途。</Text>
      <AppButton label={exporting ? '正在匯出…' : '匯出來源庫 ZIP'} variant="secondary"
        disabled={busy || exporting || !selectedLibraryEditions(items).length} onPress={async () => {
          if (exportLock.current || !workspace.reads?.exportLibraryArchive) return;
          exportLock.current = true; setExporting(true); setExportNotice(''); setFingerprint(''); setShareFile(null);
          try {
            const result = await workspace.reads.exportLibraryArchive({ seriesId: series.id, editions: selectedLibraryEditions(items) });
            if (active.current && result) { setExportNotice(result.message); setFingerprint(result.sha256); setShareFile(() => result.share ?? null); }
          } catch (error) { if (active.current) setExportNotice(error instanceof Error ? error.message : '暫未能匯出知識包。'); }
          finally { exportLock.current = false; if (active.current) setExporting(false); }
        }} />
      {shareFile ? <AppButton label="分享這個 ZIP" variant="quiet" disabled={busy || exporting} onPress={() => {
        void shareFile().catch(error => { if (active.current && error?.name !== 'AbortError') setExportNotice('未能開啟系統分享選單。'); });
      }} /> : null}
      {fingerprint ? <Metadata label="ZIP SHA-256">{fingerprint}</Metadata> : null}
    </View> : null}
    {items.every(item => item.versionHash) && !workspace.model.references.data?.hasMore ? <AppButton label="匯出版本參照 ZIP" variant="quiet" disabled={busy}
      onPress={() => { void exportSeriesReferences(items).then(bytes => exportAttachment(new Uint8Array(bytes), 'application/zip', series.id + '.zip', () => active.current))
        .then(message => { if (active.current) setExportNotice(message); }, () => { if (active.current) setExportNotice('未能匯出版本參照。'); }); }} /> : null}
    {exportNotice ? <Text accessibilityLiveRegion="polite" style={styles.meta}>{exportNotice}</Text> : null}
      </View></AppTabPanel></ScrollView></AppDialog.ScrollArea>
      <AppDialog.Actions><AppButton label="關閉" onPress={onClose} variant="secondary" density="compact" /></AppDialog.Actions>
    </AppDialog> : null}
  </View>;
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
function ReferenceSection({ model, workspace, maintenanceEntry, width }: { maintenanceEntry?: MaintenanceEntry; model: MemoryReferenceModel; workspace: MemoryReferenceWorkspaceValue; width: number }) {
  const sources = visibleKnowledgeReferences(model.references), catalog = model.references.data?.catalog;
  const { series: originalSeries, sourceDocument } = useLocalSearchParams<{ series?: string; sourceDocument?: string }>();
  const currentDocument = sourceDocument && catalog?.find(item => item.sourceId === sourceDocument);
  const requested = currentDocument ? (currentDocument.series ?? sourceSeries(currentDocument)).id : originalSeries;
  const [opened, setOpened] = useState<string | undefined>(requested);
  useEffect(() => { setOpened(requested); }, [requested, sourceDocument]);
  useFocusEffect(useCallback(() => () => setOpened(undefined), []));
  const [filter, setFilter] = useState('all');
  const [showRegistered, setShowRegistered] = useState(false);
  // Relative widths stay aligned when the Web shell's reading scale changes.
  const cardWidth = width >= 650 ? '32%' : width >= 340 ? '49%' : '100%';
  const tags = [...new Set((catalog ?? []).flatMap(item => [item.classification, ...(item.topics ?? [])]))];
  const registered = model.references.data?.registered ?? [];
  const institutions = new Map<string, { name: string; series: Map<string, PersonalLibraryItem[]> }>();
  for (const item of catalog ?? []) {
    const series = item.series ?? sourceSeries(item);
    const institution = institutions.get(series.institutionId) ?? { name: item.publisher, series: new Map<string, PersonalLibraryItem[]>() };
    const documents = institution.series.get(series.id) ?? [];
    documents.push(item); institution.series.set(series.id, documents); institutions.set(series.institutionId, institution);
  }
  const shown = [...institutions].map(([id, institution]) => ({ id, name: institution.name,
    series: [...institution.series].filter(([, documents]) => filter === 'all' || documents.some(item => item.classification === filter || item.topics?.includes(filter))) }))
    .filter(institution => institution.series.length);
  return <View style={styles.section}>
    {originalSeries && requested !== originalSeries && currentDocument ? <Text style={styles.meta}>這份文件現歸入「{(currentDocument.series ?? sourceSeries(currentDocument)).name}」。聊天引用保留當時的系列及版本。</Text> : null}
    {catalog?.length ? <Text accessibilityRole="header" style={styles.sectionTitle}>平台來源卡</Text> : null}
    <View style={styles.tools}>
      {tags.length > 1 ? <View style={styles.filter}><AppSelect label="篩選來源庫" showLabel={false} value={filter} onChange={setFilter} options={[{ value: 'all', label: '全部來源' },
        ...tags.map(value => ({ value, label: referenceFilters[value] ?? value }))]} /></View> : null}
      {catalog && workspace.reads?.setLibraryPreference && model.references.state === 'ready' && !model.references.data?.hasMore
        ? <ImportLibrary catalog={catalog} workspace={workspace} /> : null}
    </View>
    {model.references.state !== 'ready' ? <ReadNotice read={model.references} unavailable="參考來源暫未提供" /> : null}
    {catalog ? shown.map(institution => <View key={institution.id} style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{institution.name}</Text>
      <View style={styles.deck}>{institution.series.map(([key, items]) => <CatalogSeries key={key} items={items} width={cardWidth}
        workspace={workspace} requestedDocument={key === requested ? sourceDocument : undefined} details={key === opened} onOpen={() => setOpened(key)} onClose={() => setOpened(undefined)} maintenanceEntry={maintenanceEntry} />)}</View>
    </View>) : sources.map(source => <ReferenceCard key={source.chunkId} source={source} />)}
    {(catalog?.length ?? 0) > 0 && !shown.length ? <Text style={styles.meta}>沒有符合篩選的來源庫。</Text> : null}
    {filter === 'all' && registered.length ? <View style={styles.details}>
      <AppButton label={`未發布來源（${registered.length}）`} expanded={showRegistered} variant="quiet" density="compact" onPress={() => setShowRegistered(value => !value)} />
      {showRegistered && registered.map(item => <View key={item.sourceId} style={styles.document}>
        <Text style={styles.cardTitle}>{item.series.name}</Text><Text style={styles.meta}>{item.publisher} · {item.kind === 'pdf' ? 'PDF' : '網頁'}</Text>
        <Text selectable style={styles.meta}>{item.url}</Text>
        <Text style={styles.meta}>{({ registered: '已登記來源', pending: '待核對或發布', withdrawn: '已停用或失效' })[item.status]}{item.live ? ' · 可按次即時搜尋' : ''}</Text>
        {item.lastCheckedAt ? <Metadata label="最近檢查">{memoryDateLabel(item.lastCheckedAt)}</Metadata> : null}
      </View>)}</View> : null}
    {model.online && model.references.state === 'ready' && !sources.length && !catalog?.length && !registered.length
      ? <EmptyListCard title={model.references.data?.hasMore ? '仍有來源未載入' : '暫無可讀來源'} /> : null}
    {requested && catalog && ![...institutions.values()].some(item => item.series.has(requested)) && !model.references.data?.hasMore
      ? <Text style={styles.meta}>原系列已不在目前目錄，舊引用仍可從聊天查看。</Text> : null}
    {['error', 'unavailable', 'stale'].includes(model.references.state) && workspace.reads?.refreshContext ? <AppButton label="重新讀取參考" variant="quiet" disabled={!model.online || workspace.reads.referencesBusy} onPress={workspace.reads.refreshContext} /> : null}
    {model.references.data?.hasMore && workspace.reads?.loadMoreReferences ? <AppButton label="載入更多來源" variant="quiet" disabled={!model.online || workspace.reads.referencesBusy} onPress={workspace.reads.loadMoreReferences} /> : null}
  </View>;
}
type MemoryReferenceViewProps = { maintenanceEntry?: MaintenanceEntry; tabActions?: ReactNode; confirmerDisplay?: MemoryConfirmerDisplay; onPrepareQuestion?: (question: string) => void; activeTab?: Tab; onTabChange?: (tab: Tab) => void };
function ScopedMemoryReferenceView({ workspace, maintenanceEntry, confirmerDisplay, onPrepareQuestion, tabActions, activeTab, onTabChange }: MemoryReferenceViewProps & { workspace: MemoryReferenceWorkspaceValue }) {
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
    <AppTabPanel tabsId={tabsId} tabKey="references" active={tab === "references"}><ReferenceSection model={model} width={container.width} maintenanceEntry={maintenanceEntry} workspace={workspace} /></AppTabPanel>
  </View>;
}
export function MemoryReferenceView({ maintenanceEntry, confirmerDisplay, onPrepareQuestion, tabActions, activeTab, onTabChange }: MemoryReferenceViewProps) {
  const workspace = useMemoryReferenceWorkspace();
  const currentDisplay = workspace && confirmerDisplay?.scopeKey === workspace.scopeKey && confirmerDisplay.childId === workspace.model.childId ? confirmerDisplay : undefined;
  return workspace ? <ScopedMemoryReferenceView key={workspace.scopeKey} maintenanceEntry={maintenanceEntry} workspace={workspace} tabActions={tabActions} confirmerDisplay={currentDisplay} onPrepareQuestion={onPrepareQuestion} activeTab={activeTab} onTabChange={onTabChange} />
    : <ReadStateNotice state="unavailable" title="暫不能查看記憶與參考" message="請先選擇有權查看的孩子。">{tabActions}</ReadStateNotice>;
}
const styles = StyleSheet.create({
  root: { width: "100%", minWidth: 0, gap: spacing.lg },
  section: { gap: spacing.md, minWidth: 0 },
  sectionTitle: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section },
  tools: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: spacing.sm },
  filter: { width: 178, maxWidth: '100%', flexShrink: 1 },
  importControl: { alignItems: 'flex-start', gap: spacing.xs, minWidth: 0, maxWidth: '100%' },
  deck: { flexDirection: 'row', flexWrap: 'wrap', columnGap: '2%', rowGap: spacing.md },
  cover: { flexGrow: 1, borderColor: colors.line, borderWidth: 1, borderRadius: radius.medium, overflow: 'hidden', backgroundColor: colors.paper },
  coverPressed: { borderColor: colors.ink, opacity: 0.82 },
  coverBody: { flexGrow: 1, minHeight: 122, padding: spacing.lg, justifyContent: 'space-between', gap: spacing.xl },
  coverTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs, flexWrap: 'wrap' },
  coverTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 20, lineHeight: 28, fontWeight: '700' },
  coverState: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.paper },
  stateText: { fontFamily: chineseFont, color: colors.ink, ...readingType.meta },
  coverFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs, minHeight: 44, paddingHorizontal: spacing.lg },
  count: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.row, flexShrink: 1 },
  dialogTabs: { paddingBottom: 0 },
  scrollArea: { paddingHorizontal: 0, flexShrink: 1 },
  dialogContent: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md },
  document: { gap: spacing.sm, padding: spacing.md, backgroundColor: colors.canvas, borderRadius: radius.small, minWidth: 0 },
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
