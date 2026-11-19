import { BackgroundSurface } from "../appearance/BackgroundSurface";
import { exportAttachment } from '../../platform/file-export';
import { pickImportPackage } from '../../platform/package-import';
import { exportSeriesReferences, libraryPickLimit, readSeriesReferences } from '../../production/library-package';
import { EmptyListCard } from "../EmptyListCard";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { sourceSeries } from "../../../../src/shared/source-series";
import { useRouter, useLocalSearchParams, type Href } from "expo-router";
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
  return <View testID={`memory-reference-fact-${fact.id}`} style={styles.card}>
    <View style={styles.titleRow}><Text accessibilityRole="header" style={styles.factTopic}>{fact.key}</Text>
      <AppStatusBadge label={factStatusLabels[fact.status]} tone={fact.status === "confirmed" && available ? "success" : fact.status === "candidate" ? "warning" : "neutral"} /></View>
    <Text selectable style={styles.factContent}>{fact.content}</Text>
    <View style={styles.factContext}>
      <View style={styles.metadataLine}><AppIcon name={fact.visibility === "private" ? "lock-outline" : "account-group-outline"} size={15} /><Text accessibilityLabel={`可見範圍：${visibilityLabels[fact.visibility]}`} style={styles.meta}>{visibilityLabels[fact.visibility]}</Text></View>
      <Pressable testID={`memory-fact-source-${fact.id}`} accessibilityRole="button" accessibilityLabel={`${details ? "收起" : "查看"}來源：${source.label}`} accessibilityState={{ expanded: details }} aria-expanded={details}
        onPress={() => { setDetails(value => !value); setHistoryOpen(false); }} style={({ pressed }) => [styles.sourceTrigger, pressed && styles.sourcePressed]}>
        <AppIcon name={source.icon} size={15} color={colors.deepTeal} /><Text style={styles.sourceLabel}>{source.label}</Text><AppIcon name={details ? "chevron-up" : "chevron-down"} size={14} color={colors.deepTeal} />
      </Pressable>
    </View>
    {!available ? <Text style={styles.warning}>{factUnavailableReason(fact)}</Text> : null}
    {onQuestion ? <View style={styles.actions}><AppButton label="請 Agent 核對" variant="quiet" density="compact" onPress={() => onQuestion(fact)} /></View> : null}
    {details ? <View style={styles.details}>
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
function SummaryCard({ summary, emptyReady }: { emptyReady: boolean; summary: Readonly<MemorySummaryView> | null }) {
  const [details, setDetails] = useState(false);
  return <View style={styles.card}><View style={styles.titleRow}><Text accessibilityRole="header" style={styles.cardTitle}>對話摘要</Text><AppStatusBadge label="私人 · 整理內容" /></View>
    {summary ? <><Text selectable style={styles.body}>{summary.text}</Text><Text style={styles.meta}>整理自你的對話，供延續脈絡時參考</Text>
      <AppButton label={details ? "收起摘要來源" : "查看摘要來源"} expanded={details} variant="quiet" density="compact" onPress={() => setDetails(value => !value)} />
      {details ? <View style={styles.details}><Metadata label="建立時間">{memoryDateLabel(summary.createdAt)}</Metadata><Metadata label="摘要版本">{summary.version}</Metadata>
        <Metadata label="摘要識別">{summary.id}</Metadata>{summary.previousId ? <Metadata label="前一摘要">{summary.previousId}</Metadata> : null}
        <Metadata label="已涵蓋訊息">{summary.coveredMessageIds.join("、") || "未提供"}</Metadata><Metadata label="最後涵蓋訊息">{summary.lastCoveredMessageId}</Metadata>
        <Text style={styles.meta}>摘要是整理出的內容，須與原訊息及事實一併核對。</Text></View> : null}</>
      : <Text style={styles.meta}>{emptyReady ? "目前沒有可用摘要" : "摘要尚未重新核對"}</Text>}
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
      <Text style={styles.meta}>發布機構與覆核日期供追溯來源；內容仍須按適用條件判斷。</Text>
      <AppButton label={technical ? "收起版本識別" : "查看版本識別"} expanded={technical} variant="quiet" density="compact" onPress={() => setTechnical(value => !value)} />
      {technical ? <View style={styles.details}><Metadata label="來源">{source.sourceId}</Metadata><Metadata label="版本">{source.versionId}</Metadata><Metadata label="片段">{source.chunkId}</Metadata>
        <Metadata label="版本校驗">{source.versionHash}</Metadata><Metadata label="內容校驗">{source.contentHash}</Metadata><Metadata label="取得時間">{memoryDateLabel(source.fetchedAt)}</Metadata></View> : null}
    </View> : null}
  </View>;
}
type MaintenanceEntry = (sourceId: string) => ReactNode;
function CatalogSeries({ items, workspace, initialOpen, maintenanceEntry }: { maintenanceEntry?: MaintenanceEntry; items: PersonalLibraryItem[]; workspace: MemoryReferenceWorkspaceValue; initialOpen: boolean }) {
  const [details, setDetails] = useState(initialOpen), [linkFailed, setLinkFailed] = useState(false);
  useEffect(() => { if (initialOpen) setDetails(true); }, [initialOpen]);
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
  const latest = items.map(item => item.publishedAt).filter((at): at is string => !!at).sort().at(-1);
  const state = preference?.enabled === false ? '本人已停用' : preference?.mode === 'fixed' ? '固定快照' : preference?.mode === 'follow' ? '跟隨同範圍已審核更新' : '使用平台有效發布版';
  const latestSourceRead = items.map(item => item.lastSuccessfulCheckAt ?? item.fetchedAt).filter((at): at is string => !!at).sort().at(-1);
  const requiresSelection = items.some(item => item.preference?.eligible === false);
  return <View style={styles.card} testID={`memory-catalog-series-${series.id}`}>
    <Text accessibilityRole="header" style={styles.cardTitle}>{series.name}</Text>
    <Text style={styles.meta}>{state} · 已載入 {items.length} 份文件</Text>
    <Text style={styles.meta}>範圍限所列文件及已收錄段落。</Text>
    {latestSourceRead ? <Metadata label="最近成功取得">{memoryDateLabel(latestSourceRead)}</Metadata> : null}
    {latest ? <Metadata label="最近發布">{memoryDateLabel(latest)}</Metadata> : null}
    {requiresSelection ? <Text style={styles.warning}>目前發布的版本或範圍有變，未選用的新內容暫不供回答。如要採用所列版本及範圍，可按「固定目前版本」。</Text> : null}
    <AppButton label={details ? '收起文件及設定' : '查看文件及設定'} expanded={details} variant="quiet" density="compact" onPress={() => setDetails(!details)} />
    {details ? <View style={styles.details}>{items.map(item => <View key={item.sourceId} style={styles.details} testID={`memory-catalog-source-${item.sourceId}`}>
      <Text style={styles.cardTitle}>{item.title}</Text>
      <Text style={styles.meta}>{item.coverage ?? '已收錄部分資料'} · {item.classification === 'official_guidance' ? '官方指引' : '近期資訊'}</Text>
      <Metadata label="發布版本">{item.versionId}</Metadata>
      {item.preference?.selectedVersionId && item.preference.mode === 'fixed' ? <Metadata label="已選快照">{item.preference.selectedVersionId}</Metadata> : null}
      <Metadata label="最近成功取得">{memoryDateLabel(item.lastSuccessfulCheckAt ?? item.fetchedAt ?? null)}</Metadata>
      <Metadata label="最近檢查">{memoryDateLabel(item.lastCheckedAt ?? null)}</Metadata>
      <Metadata label="讀取及整理方式">{item.methods?.join('、') || '未有已核對的方法'}</Metadata>
      <Text style={styles.meta}>精細保留數字、步驟和限制。概括整理保留背景。結構化欄位可按原值查找。不進問答索引的內容仍保留原文。</Text>
      {maintenanceEntry?.(item.sourceId)}
      <AppButton label="查看現行網站" variant="quiet" density="compact" onPress={() => { setLinkFailed(false); void Linking.openURL(item.url).catch(() => setLinkFailed(true)); }} />
    </View>)}
    {linkFailed ? <Text style={styles.warning}>暫未能開啟原網站。</Text> : null}
    {workspace.reads?.exportLibraryArchive && !workspace.model.references.data?.hasMore ? <View style={styles.actions}>
      <Text style={styles.meta}>知識包包含選用版本的可分享原文、來源、已驗讀法及相容索引。供註明出處的非商業分享。</Text>
      <AppButton label={exporting ? '正在匯出知識包…' : '匯出及分享來源庫 ZIP'} variant="secondary"
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
      {fingerprint ? <Metadata label="供接收者核對的 ZIP SHA-256">{fingerprint}</Metadata> : null}
    </View> : null}
    {items.every(item => item.versionHash) && !workspace.model.references.data?.hasMore ? <AppButton label="匯出版本參照 ZIP" variant="quiet" disabled={busy}
      onPress={() => { void exportSeriesReferences(items).then(bytes => exportAttachment(new Uint8Array(bytes), 'application/zip', series.id + '.zip', () => active.current))
        .then(message => { if (active.current) setExportNotice(message); }, () => { if (active.current) setExportNotice('未能匯出版本參照。'); }); }} /> : null}
    {exportNotice ? <Text accessibilityLiveRegion="polite" style={styles.meta}>{exportNotice}</Text> : null}
    {preference && workspace.reads?.setLibraryPreference && !workspace.model.references.data?.hasMore ? <View style={styles.actions}>
      <AppButton label={preference.enabled ? '本人停用' : '本人啟用'} variant="quiet" disabled={busy} onPress={() => change('toggle')} />
      <AppButton label="固定目前版本" variant="quiet" disabled={busy || preference.revision > 0 && preference.mode === 'fixed' && !requiresSelection && items.every(item => item.preference?.selectedVersionId === item.versionId)}
        onPress={() => change('fixed')} />
      <AppButton label="跟隨同範圍更新" variant="quiet" disabled={busy || preference.mode === 'follow'}
        onPress={() => change('follow')} />
      {preference.mode !== 'platform' ? <AppButton label="恢復使用平台發布版" variant="quiet" disabled={busy} onPress={() => change('platform')} /> : null}
    </View> : null}</View> : null}
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
        ? '此包包含本目錄尚未發布的文件。請把完整知識包及發送者提供的 SHA-256 交給管理員，在管理後台「公共知識 ZIP 匯入台帳」匯入。發布後才可在此選用。'
        : '未能核對這個 ZIP。請選一個來源庫的完整版本參照包。');
    } finally { if (!controller.signal.aborted) setReading(false); }
  };
  return <View style={styles.details}><AppButton label={reading ? '正在核對 ZIP…' : '匯入來源庫 ZIP'} variant="secondary"
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
function ReferenceSection({ model, workspace, maintenanceEntry }: { maintenanceEntry?: MaintenanceEntry; model: MemoryReferenceModel; workspace: MemoryReferenceWorkspaceValue }) {
  const sources = visibleKnowledgeReferences(model.references), catalog = model.references.data?.catalog;
  const { series: originalSeries, sourceDocument } = useLocalSearchParams<{ series?: string; sourceDocument?: string }>();
  const currentDocument = sourceDocument && catalog?.find(item => item.sourceId === sourceDocument);
  const requested = currentDocument ? (currentDocument.series ?? sourceSeries(currentDocument)).id : originalSeries;
  const [filter, setFilter] = useState('all');
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
    {tags.length > 1 ? <AppSelect label="篩選來源庫" value={filter} onChange={setFilter} options={[{ value: 'all', label: '全部來源庫' },
      ...tags.map(value => ({ value, label: referenceFilters[value] ?? value }))]} /> : null}
    {model.references.state !== 'ready' ? <ReadNotice read={model.references} unavailable="參考來源暫未提供" /> : null}
    {catalog && workspace.reads?.setLibraryPreference && model.references.state === 'ready' && !model.references.data?.hasMore
      ? <ImportLibrary catalog={catalog} workspace={workspace} /> : null}
    {catalog ? shown.map(institution => <View key={institution.id} style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{institution.name}</Text>
      {institution.series.map(([key, items]) => <CatalogSeries key={key} items={items} workspace={workspace} initialOpen={key === requested} maintenanceEntry={maintenanceEntry} />)}
    </View>) : sources.map(source => <ReferenceCard key={source.chunkId} source={source} />)}
    {(catalog?.length ?? 0) > 0 && !shown.length ? <Text style={styles.meta}>沒有符合篩選的來源庫。</Text> : null}
    {filter === 'all' && registered.length ? <View style={styles.details}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>已登記、未有可用庫版本</Text>
      {registered.map(item => <View key={item.sourceId} style={styles.card}>
        <Text style={styles.cardTitle}>{item.series.name}</Text><Text style={styles.meta}>{item.publisher} · {item.kind === 'pdf' ? 'PDF' : '網頁'}</Text>
        <Text selectable style={styles.meta}>{item.url}</Text>
        <Text style={styles.meta}>{({ registered: '已登記來源', pending: '待核對或發布', withdrawn: '已停用或失效' })[item.status]}{item.live ? ' · 可按次即時搜尋' : ''}</Text>
        {item.lastCheckedAt ? <Metadata label="最近檢查">{memoryDateLabel(item.lastCheckedAt)}</Metadata> : null}
      </View>)}</View> : null}
    {model.references.state === 'ready' && !sources.length && !catalog?.length && !registered.length ? <EmptyListCard title="暫無可讀來源" /> : null}
    {requested && catalog && ![...institutions.values()].some(item => item.series.has(requested)) && !model.references.data?.hasMore
      ? <Text style={styles.meta}>原系列現時未列於可讀目錄。已保存的引用保留當時名稱及版本。</Text> : null}
    {['error', 'unavailable', 'stale'].includes(model.references.state) && workspace.reads?.refreshContext ? <AppButton label="重新讀取參考" variant="quiet" disabled={!model.online || workspace.reads.referencesBusy} onPress={workspace.reads.refreshContext} /> : null}
    {model.references.data?.hasMore && workspace.reads?.loadMoreReferences ? <AppButton label="載入更多來源" variant="quiet" disabled={!model.online || workspace.reads.referencesBusy} onPress={workspace.reads.loadMoreReferences} /> : null}
  </View>;
}
type MemoryReferenceViewProps = { maintenanceEntry?: MaintenanceEntry; tabActions?: ReactNode; confirmerDisplay?: MemoryConfirmerDisplay; onPrepareQuestion?: (question: string) => void };
function ScopedMemoryReferenceView({ workspace, maintenanceEntry, confirmerDisplay, onPrepareQuestion, tabActions }: MemoryReferenceViewProps & { workspace: MemoryReferenceWorkspaceValue }) {
  const { model } = workspace;
  const router = useRouter(), navigate = usePreviewNavigation();
  const { series } = useLocalSearchParams<{ series?: string }>();
  const [tab, setTab] = useState<Tab>(series ? 'references' : 'long'), [otherOpen, setOtherOpen] = useState(false);
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
    return <View key={`${fact.id}:${fact.version}`} style={[styles.factSlot, container.width < 760 && styles.fullWidth]}>
      <FactCard fact={fact} model={model} workspace={workspace} confirmerDisplay={confirmerDisplay} onQuestion={onQuestion} /></View>;
  }
  return <View ref={container.ref} onLayout={container.onLayout} style={styles.root}>
    <TabToolbar actions={tabActions} stacked={container.width < 480}><UnderlineTabs id={tabsId} label="記憶與參考分類" items={tabs} value={tab} onChange={setTab} /></TabToolbar>
    <AppTabPanel tabsId={tabsId} tabKey="short" active={tab === "short"}><View style={styles.section}>
      <ReadNotice read={model.shortTerm} unavailable="目前工作脈絡暫未提供" online={model.online} emptyTitle="目前暫無可顯示的工作脈絡" empty={model.shortTerm.data?.works ? model.shortTerm.data.works.length === 0 && model.shortTerm.data.messages.length === 0 : model.shortTerm.data?.messages.length === 0}>
        {model.shortTerm.data?.works ? <PersistentWorkCards items={model.shortTerm.data.works} online={model.online} busy={workspace.reads?.messageBusy}
          onMessage={workspace.reads?.readWorkMessage ? id => {
            if (current.current !== workspace || !current.current.model.shortTerm.data?.works?.some(work => work.sourceMessageIds.includes(id))) return;
            workspace.reads?.readWorkMessage?.(id);
          } : undefined}
          onResource={path => { if (current.current === workspace) navigate(() => router.push(path as Href)); }}
          onContinue={onPrepareQuestion ? work => {
            if (current.current !== workspace || !current.current.model.shortTerm.data?.works?.some(item => item.id === work.id && item.version === work.version)) return;
            onPrepareQuestion(personalWorkQuestion(model.childName, work));
          } : undefined} /> : null}
        {model.shortTerm.data?.messages.map(message => <View key={message.id} style={styles.card}><Text style={styles.meta}>{message.role === "user" ? "你的訊息" : "Agent 回覆"}</Text><Text selectable style={styles.body}>{message.text}</Text></View>)}
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
        <View style={styles.section}><BackgroundSurface padded><Text accessibilityRole="header" style={styles.sectionTitle}>已確認事實</Text></BackgroundSurface>
          {confirmed.length ? <View style={styles.factGrid}>{confirmed.map(renderFact)}</View> : model.longTerm.state === "ready" && model.online ? <EmptyListCard title="已載入資料中沒有已確認事實" detail={model.longTerm.data.hasMoreFacts ? "仍有記憶未載入，可繼續讀取。" : undefined} /> : <BackgroundSurface padded><Text style={styles.meta}>已確認事實尚未重新核對</Text></BackgroundSurface>}
        </View>
        {model.longTerm.data?.hasMoreFacts ? workspace.reads?.loadMoreFacts ? <AppButton label="載入更多記憶" variant="quiet" disabled={!model.online} onPress={workspace.reads.loadMoreFacts} />
          : <BackgroundSurface padded><Text style={styles.meta}>仍有記憶未載入</Text></BackgroundSurface> : null}
        <SummaryCard key={`${model.longTerm.data?.summary?.id}:${model.longTerm.data?.summary?.version}`} summary={model.longTerm.data?.summary ?? null} emptyReady={model.longTerm.state === "ready" && model.online} />
        {other.length ? <View style={styles.section}><AppButton label={otherOpen ? "收起待核對與停用資料" : `待核對與停用資料（已載入 ${other.length} 項）`} expanded={otherOpen} variant="quiet" onPress={() => setOtherOpen(value => !value)} />
          {otherOpen ? <View style={styles.factGrid}>{other.map(renderFact)}</View> : null}</View> : null}
      </ReadNotice>
    </View></AppTabPanel>
    <AppTabPanel tabsId={tabsId} tabKey="references" active={tab === "references"}><ReferenceSection model={model} maintenanceEntry={maintenanceEntry} workspace={workspace} /></AppTabPanel>
  </View>;
}
export function MemoryReferenceView({ maintenanceEntry, confirmerDisplay, onPrepareQuestion, tabActions }: MemoryReferenceViewProps) {
  const workspace = useMemoryReferenceWorkspace();
  const currentDisplay = workspace && confirmerDisplay?.scopeKey === workspace.scopeKey && confirmerDisplay.childId === workspace.model.childId ? confirmerDisplay : undefined;
  return workspace ? <ScopedMemoryReferenceView key={workspace.scopeKey} maintenanceEntry={maintenanceEntry} workspace={workspace} tabActions={tabActions} confirmerDisplay={currentDisplay} onPrepareQuestion={onPrepareQuestion} />
    : <ReadStateNotice state="unavailable" title="暫不能查看記憶與參考" message="請先選擇有權查看的孩子。">{tabActions}</ReadStateNotice>;
}
const styles = StyleSheet.create({
  root: { width: "100%", minWidth: 0, gap: spacing.lg },
  section: { gap: spacing.md, minWidth: 0 },
  sectionTitle: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section },
  factGrid: { flexDirection: "row", flexWrap: "wrap", alignItems: "stretch", gap: spacing.md, minWidth: 0 },
  factSlot: { flexGrow: 1, flexBasis: "47%", minWidth: 0 }, fullWidth: { flexBasis: "100%" },
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
