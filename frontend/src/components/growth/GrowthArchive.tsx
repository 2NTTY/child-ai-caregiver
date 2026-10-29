import { serializeSummaryRoute, type SummarySelection } from "../../navigation/route-state";
import { AppStatusBadge } from "../AppStatusBadge";
import { ReadTargetLink } from "../ReadTargetLink";
import { AppCheckbox } from "../AppCheckbox";
import { AppDialog } from "../AppDialog";
import { AppScrollView } from "../AppScrollView";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Platform, StyleSheet, View, useWindowDimensions, type ScrollView } from "react-native";
import { Text } from "react-native-paper";
import type { GrowthArchiveEntry, GrowthArchiveProjection, GrowthArchiveSource, GrowthViewModel } from "../../growth-view-model";
import { growthTime } from "../../growth-view-model";
import { chineseFont, colors, mobileLayout, radius, readingType, spacing } from "../../theme";
import { AppButton, AppSelect } from "../ui";
import { archiveEntryReadable, archiveReadableSource, archiveReadingView, filterArchiveItems, growthReportExportRequest, growthReportPurposes, standardGrowthReportSections,
  type ArchiveFilter, type ArchiveReadingItem, type GrowthReportExportHandler, type GrowthReportExportResult, type GrowthReportPurpose } from "./growth-archive-view";
import { useInteractionDensity } from "../useInteractionDensity";
import { growthStyles as s } from "./growth-styles";

const stateCopy: Record<GrowthArchiveProjection["state"], {title: string; detail: string}> = {
  unavailable: {title: "成長報告暫未能讀取", detail: "有可閱讀的報告時，會在這裏顯示。"},
  loading: {title: "正在讀取成長報告", detail: "稍後即可查看已取得的內容。"},
  not_generated: {title: "還沒有成長報告", detail: "日常的記錄會成為日後回看的片段。"},
  generating: {title: "正在整理新版本", detail: "你可以先閱讀現有內容。"},
  ready: {title: "可閱讀", detail: ""},
  needs_update: {title: "有新資料待整理", detail: "這份報告尚未涵蓋最新資料。"},
  insufficient: {title: "先留住已有的片段", detail: "目前資料還不足以整理完整報告。"},
  error: {title: "暫時未能更新報告", detail: "已有的內容仍可繼續閱讀。"},
  invalidated: {title: "這份報告暫時無法閱讀", detail: "來源或閱讀權限已改變，需要重新核對。"},
};
const entryLabels: Record<GrowthArchiveEntry["status"], string> = {
  confirmed_record: "家長已確認的記錄", agent_summary: "Agent 整理", source_summary: "共享來源整理", unverified: "尚待核對",
};

const reportVersionLabel = (version: number) => Number.isInteger(version) && version > 0 ? `版本 ${version}` : "版本未提供";
const reportDateLabel = (value: string) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? growthTime(value) : "整理時間未提供";

function SourceDisclosure({sources, onRecord}: {sources: GrowthArchiveSource[]; onRecord?: (source: GrowthArchiveSource) => void}) {
  return <View style={s.archiveSources}>{sources.map(source => <View key={source.id} style={s.smallStack}>
    <Text style={s.title}>{source.label}</Text>
    <Text selectable style={a.reading}>{source.excerpt}</Text>
    <Text style={s.meta}>{source.timeLabel} · 來源版本 {source.version}</Text>
    {source.recordId && onRecord ? <ReadTargetLink href={`/care?tab=records&recordId=${encodeURIComponent(source.recordId)}`} label={`查看原始${source.label}，來源版本 ${source.version}`} onOpen={() => onRecord(source)} style={a.readLink}><Text style={a.readLinkLabel}>查看原始{source.label}</Text></ReadTargetLink> : null}
  </View>)}</View>;
}

function reportHref(selection: SummarySelection) {
  return { pathname: "/summary" as const, params: serializeSummaryRoute({ ...selection, tab: "archive" }) };
}
function periodSelection(periodId: string): SummarySelection {
  return { periodId, documentId: null, snapshotId: null, snapshotVersion: null };
}
function ReportChapter({title, children}: {title: string; children: ReactNode}) {
  return <View style={a.chapter}>
    <Text accessibilityRole="header" aria-level={3} style={a.reportSectionTitle}>{title}</Text>
    <View style={a.chapterBody}>{children}</View>
  </View>;
}

export function GrowthArchive({model, scrollRef, onRecord, onExportReport, exportBusy, active = true, footerActions, footerDetails, selection, onSelectionChange}: {
  selection?: SummarySelection; onSelectionChange?: (selection: SummarySelection) => void;
  model: GrowthViewModel; scrollRef: RefObject<ScrollView | null>; onRecord?: (id?: string) => void;
  onExportReport?: GrowthReportExportHandler;
  exportBusy?: boolean;
  active?: boolean;
  footerActions?: ReactNode; footerDetails?: ReactNode;
}) {
  const {authorized, state, items, current} = archiveReadingView(model);
  const reading = authorized ? model.page?.archive?.reading : undefined;
  const touch = useInteractionDensity();
  const compactControls = useWindowDimensions().width >= mobileLayout.breakpoint && !touch;
  const [localSelectedKey, setSelectedKey] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [filter, setFilter] = useState<ArchiveFilter>("all");
  const [opened, setOpened] = useState<string[]>([]);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportKey, setExportKey] = useState<string | null>(null);
  const [purpose, setPurpose] = useState<GrowthReportPurpose>("family");
  const [includeSources, setIncludeSources] = useState(true);
  const [includeRevision, setIncludeRevision] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<{ key: string; state: "pending" | GrowthReportExportResult["state"]; message: string } | null>(null);
  const exportAttempt = useRef({ generation: 0, pending: false });
  const exportButton = useRef<View>(null), exportFeedbackRef = useRef<View>(null);
  const [chapter, setChapter] = useState("profile");
  const contextKey = JSON.stringify([model.scopeKey, model.childId]);
  const previousContext = useRef(contextKey);
  const contextChanged = previousContext.current !== contextKey;
  const selectedKey = selection ? selection.periodId ?? (selection.snapshotId && selection.snapshotVersion ? `${selection.snapshotId}:${selection.snapshotVersion}` : null) : localSelectedKey;
  const requested = !!selection && !!(selection.periodId || selection.documentId || selection.snapshotId || selection.snapshotVersion);
  const version = selection?.documentId ? reading?.indexes.find(index => index.documentId === selection.documentId)?.versions.find(item => item.snapshotId === selection.snapshotId && item.snapshotVersion === selection.snapshotVersion && !item.invalidated) : undefined;
  const selected = contextChanged ? null : !selection ? selectedKey === null ? current : items.find(item => item.key === selectedKey) ?? null
    : !requested ? current : selection.periodId ? items.find(item => item.key === selection.periodId) ?? null
      : version ? items.find(item => item.snapshot.id === version.snapshotId && item.snapshot.version === version.snapshotVersion) ?? null : null;
  const requestedVersion = useRef("");
  useEffect(() => {
    if (!selection?.documentId || !version || !reading?.online || selected) { requestedVersion.current = ""; return; }
    const key = `${contextKey}:${selection.documentId}:${version.snapshotId}:${version.snapshotVersion}`;
    if (requestedVersion.current === key) return;
    requestedVersion.current = key; reading.readVersion(selection.documentId, version.snapshotId, version.snapshotVersion);
  }, [contextKey, selection?.documentId, version, reading?.online, selected]);
  useEffect(() => { if (requested && !selected) setHistoryOpen(true); }, [requested, selected?.key]);
  const archive = selected?.snapshot ?? null;
  const exportItem = items.find(item => item.key === exportKey) ?? null;
  const sectionRefs = useRef(new Map<string, View>());
  const reportRef = useRef<View>(null);
  const jumpToReport = useRef(false);
  const exportIntentKey = JSON.stringify([contextKey, model.page?.authorityVersion, selected?.key, archive?.id, archive?.version,
    active, authorized, model.online, exportKey, exportItem?.snapshot.id, exportItem?.snapshot.version, purpose, includeSources, includeRevision]);
  const latest = useRef({model, archive, contextKey, exportOpen, exportKey, exportIntentKey, active});
  latest.current = {model, archive, contextKey, exportOpen, exportKey, exportIntentKey, active};
  function clearExportFeedback() { exportAttempt.current.generation++; exportAttempt.current.pending = false; setExportFeedback(null); }
  function selectPurpose(next: GrowthReportPurpose) {
    if (next === purpose) return;
    clearExportFeedback(); setPurpose(next);
  }
  function closeExport() { clearExportFeedback(); setExportOpen(false); }
  useLayoutEffect(() => { clearExportFeedback(); }, [exportIntentKey, exportOpen]);
  useEffect(() => () => { exportAttempt.current.generation++; exportAttempt.current.pending = false; }, []);
  useEffect(() => {
    previousContext.current = contextKey;
    setSelectedKey(null); setHistoryOpen(false); setFilter("all"); setPurpose("family"); setExportKey(null);
    setIncludeSources(true); setIncludeRevision(false); jumpToReport.current = false;
  }, [contextKey]);
  useEffect(() => { if (historyOpen) reading?.ensureArchived(); }, [historyOpen, reading?.archiveStarted, reading?.pageBusy, contextKey]);
  useEffect(() => {
    setOpened([]); setRevisionOpen(false); setExportOpen(false); setChapter("profile");
  }, [contextKey, model.page?.authorityVersion, archive?.id, archive?.version, selected?.key, authorized, active]);

  function scrollTarget(target: View | null | undefined) {
    if (!target) return;
    const scroll = scrollRef.current;
    if (Platform.OS === "web") {
      const element = target as unknown as HTMLElement;
      const viewport = scroll?.getScrollableNode() as HTMLElement | undefined;
      if (!element.isConnected || element.getClientRects().length === 0) return;
      if (viewport) scroll?.scrollTo({y: Math.max(0, viewport.scrollTop + element.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 12), animated: false});
      element.focus({preventScroll: true});
      return;
    }
    const inner = (scroll as (ScrollView & {getInnerViewRef?(): View | null}) | null)?.getInnerViewRef?.() ?? scroll?.getInnerViewNode();
    if (scroll && inner) target.measureLayout(inner, (_x, y) => scroll.scrollTo({y: Math.max(0, y - 12), animated: false}), () => {});
  }
  useLayoutEffect(() => {
    if (jumpToReport.current && authorized && !contextChanged) {scrollTarget(reportRef.current); jumpToReport.current = false;}
  }, [selected?.key, historyOpen, authorized]);
  function selectArchive(item: ArchiveReadingItem) {
    if (latest.current.contextKey !== contextKey || !archiveReadingView(latest.current.model).items.some(value => value.key === item.key
      && value.snapshot.id === item.snapshot.id && value.snapshot.version === item.snapshot.version)) return;
    if (onSelectionChange) { onSelectionChange(periodSelection(item.key)); return; }
    reading?.closeVersion(); jumpToReport.current = true; setSelectedKey(item.key); setHistoryOpen(false);
  }
  function selectVersion(documentId: string, version: { snapshotId: string; snapshotVersion: number }) {
    const next = latest.current;
    const currentReading = archiveReadingView(next.model).authorized ? next.model.page?.archive?.reading : undefined;
    const available = currentReading?.indexes.find(index => index.documentId === documentId)?.versions.find(item => item.snapshotId === version.snapshotId && item.snapshotVersion === version.snapshotVersion && !item.invalidated);
    if (next.contextKey !== contextKey || next.model.page?.authorityVersion !== model.page?.authorityVersion || !currentReading?.online || !available) return;
    if (onSelectionChange) onSelectionChange({ periodId: null, documentId, snapshotId: available.snapshotId, snapshotVersion: available.snapshotVersion });
    else { currentReading.readVersion(documentId, available.snapshotId, available.snapshotVersion); setSelectedKey(available.snapshotId + ":" + available.snapshotVersion); jumpToReport.current = true; }
  }
  const readableSource = (id: string) => archive ? archiveReadableSource(model, archive, id) : undefined;
  function openRecord(source: GrowthArchiveSource) {
    const next = latest.current;
    if (next.contextKey !== contextKey || next.model.page?.authorityVersion !== model.page?.authorityVersion || !next.archive || !archive || next.archive.id !== archive.id || next.archive.version !== archive.version) return;
    const valid = archiveReadableSource(next.model, next.archive, source.id);
    if (valid?.recordId && valid.recordId === source.recordId && valid.version === source.version) onRecord?.(valid.recordId);
  }
  function toggle(id: string) {
    const next = latest.current;
    const entry = next.archive?.sections.flatMap(section => section.entries).find(value => value.id === id);
    if (next.contextKey !== contextKey || next.model.page?.authorityVersion !== model.page?.authorityVersion || next.archive?.id !== archive?.id || next.archive?.version !== archive?.version
      || !entry || !archiveEntryReadable(next.model, next.archive!, entry)) return;
    setOpened(values => values.includes(id) ? values.filter(value => value !== id) : [...values, id]);
  }
  function goTo(id: string) {
    if (!authorized || !sections.some(section => section.id === id)) return;
    setChapter(id); scrollTarget(sectionRefs.current.get(id));
  }
  async function requestExport() {
    if (exportBusy || exportAttempt.current.pending || !active || !onExportReport || !exportItem || !latest.current.exportOpen || latest.current.exportKey !== exportKey
      || latest.current.contextKey !== contextKey || latest.current.model.page?.authorityVersion !== model.page?.authorityVersion) return;
    const request = growthReportExportRequest(latest.current.model, exportItem, purpose, includeSources, includeRevision);
    if (!request || !latest.current.model.online) return;
    const generation = ++exportAttempt.current.generation;
    exportAttempt.current.pending = true;
    const isCurrent = () => generation === exportAttempt.current.generation && latest.current.active && latest.current.exportOpen
      && latest.current.exportIntentKey === exportIntentKey
      && !!growthReportExportRequest(latest.current.model, exportItem, purpose, includeSources, includeRevision);
    setExportFeedback({ key: exportIntentKey, state: "pending", message: "正在核對這個版本並準備 PDF。" });
    // Move only the submitting control's focus before Paper disables it; never reclaim focus on settlement.
    if (Platform.OS === "web" && typeof document !== "undefined") {
      const button = exportButton.current as unknown as HTMLElement | null;
      if (button?.contains(document.activeElement)) (exportFeedbackRef.current as unknown as HTMLElement | null)?.focus({ preventScroll: true });
    }
    try {
      const result = await onExportReport(request, isCurrent);
      if (isCurrent()) setExportFeedback(result ? { key: exportIntentKey, ...result } : null);
    } catch {
      if (isCurrent()) setExportFeedback({ key: exportIntentKey, state: "error", message: "PDF 未能取得，沒有改用其他版本。請重新讀取並核對來源後再試。" });
    } finally { if (isCurrent()) exportAttempt.current.pending = false; }
  }
  const visibleItems = filterArchiveItems(items, filter);
  const rangePeriods = items.some(item => item.period?.kind === "range");
  const periods = reading || items.length > 0 && (items.length > 1 || requested || selectedKey !== null && !selected) ? <View style={s.stack}>
    <View style={s.row}><AppButton label={historyOpen ? "收起其他期間" : rangePeriods ? "翻閱其他期間／版本" : "翻閱年度／季度"} expanded={historyOpen} variant="quiet" onPress={() => setHistoryOpen(value => !value)} />
      {current && selectedKey !== null && selectedKey !== current.key ? <ReadTargetLink href={reportHref(periodSelection(current.key))} label="回到目前報告" onOpen={() => selectArchive(current)} style={a.readLink}><Text style={a.readLinkLabel}>回到目前報告</Text></ReadTargetLink> : null}
    </View>
    {historyOpen && !contextChanged ? <View style={a.history} testID="growth-archive-library">
      <Text style={s.meta}>{rangePeriods ? "已取得的期間與版本" : "已取得的年度與季度"}</Text>
      <AppSelect label="檔案期間類別" value={filter} onChange={setFilter} options={[
        {value: "all", label: "全部"}, {value: "year", label: "年度"}, {value: "quarter", label: "季度"},
        ...(rangePeriods ? [{value: "range", label: "日期範圍"} as const] : []),
      ]} />
      <View style={a.archiveLedger}>
        {visibleItems.map(item => {
          const version = reportVersionLabel(item.snapshot.version);
          const generatedAt = typeof item.snapshot.generatedAt === "string" && Number.isFinite(Date.parse(item.snapshot.generatedAt))
            ? `整理於 ${reportDateLabel(item.snapshot.generatedAt)}` : "整理時間未提供";
          const metadata = `${version} · ${generatedAt}`;
          return <ReadTargetLink key={item.key} href={reportHref(periodSelection(item.key))}
            label={`閱讀${item.period?.label ?? item.snapshot.periodLabel}，${metadata}${item.period?.coverage === "partial" ? "，部分內容" : ""}`}
            current={selected?.key === item.key ? "page" : undefined} onOpen={() => selectArchive(item)}
            testID={`growth-archive-card-${item.key}`} style={[a.archiveRow, selected?.key === item.key && a.archiveRowSelected]}>
            <View style={a.cardCopy}><Text style={s.title}>{item.period?.label ?? "成長報告"}</Text><Text style={s.meta}>{item.snapshot.periodLabel}{item.period?.coverage === "partial" ? " · 部分內容" : ""}</Text>
              <Text style={s.meta}>{metadata}</Text></View>
            <Text style={a.readLinkLabel}>閱讀報告</Text>
          </ReadTargetLink>;
        })}
      </View>
      {reading ? <View style={s.stack} testID="growth-document-reading">
        <Text style={s.body}>只涵蓋已載入文件與版本；較早修訂及歸檔按需讀取。</Text>
        <View style={s.row}>
          {reading.activeHasMore ? <AppButton label="載入更多報告" variant="quiet" disabled={reading.pageBusy || !reading.online} onPress={() => reading.loadMoreDocuments("active")} /> : null}
          {!reading.archiveStarted || reading.archiveHasMore || reading.pageError ? <AppButton label={reading.pageError ? "重試載入歸檔報告" : "載入更多歸檔報告"} variant="quiet" disabled={reading.pageBusy || !reading.online} onPress={() => reading.loadMoreDocuments("archived")} /> : null}
        </View>
        {reading.pageError ? <Text accessibilityRole="alert" style={s.warning}>未能載入更多報告，已取得的內容保留。</Text> : null}
        {reading.indexes.map(index => <View key={index.documentId} style={s.smallStack}>
          <AppButton label={index.busy ? "正在讀取修訂…" : index.started ? index.hasMore ? "載入「" + index.title + "」更多修訂" : "「" + index.title + "」已載入修訂" : "查看「" + index.title + "」較早修訂"} variant="quiet" disabled={index.busy || !reading.online || index.started && !index.hasMore && !index.error} onPress={() => reading.loadVersions(index.documentId)} />
          {index.error ? <Text accessibilityRole="alert" style={s.warning}>未能讀取較早修訂，請再試一次。</Text> : null}
          {index.versions.map(version => {
            const currentVersion = selection?.documentId === index.documentId && selection.snapshotId === version.snapshotId && selection.snapshotVersion === version.snapshotVersion;
            return <ReadTargetLink key={`${version.snapshotId}:${version.snapshotVersion}`} current={currentVersion ? "page" : undefined}
            href={reportHref({ periodId: null, documentId: index.documentId, snapshotId: version.snapshotId, snapshotVersion: version.snapshotVersion })}
            label={"閱讀「" + index.title + "」版本 " + version.snapshotVersion + "，" + growthTime(version.generatedAt) + (version.invalidated ? "，來源已失效" : "")}
            availability={version.invalidated || !reading.online ? "unavailable" : "ready"}
            onOpen={() => selectVersion(index.documentId, version)} style={[a.readLink, currentVersion && a.archiveRowSelected]}>
            <Text style={a.readLinkLabel}>{"版本 " + version.snapshotVersion + " · " + growthTime(version.generatedAt) + (version.invalidated ? " · 來源已失效" : "")}</Text>
          </ReadTargetLink>;})}
        </View>)}
        {reading.content && !reading.content.complete ? <View style={s.smallStack} testID="growth-version-content">
          <Text style={s.body}>{reading.content.invalidated ? "這個版本的來源已失效，正文已隱藏。" : reading.content.error ? "這個版本未能讀取，可沿同一版本繼續。" : reading.content.busy ? "正在讀取這個版本…" : "已讀取 " + reading.content.loadedCharacters + "／" + reading.content.totalCharacters + " 字，完成後可閱讀正文。"}</Text>
          {!reading.content.invalidated ? <AppButton label={reading.content.error ? "重試讀取這個版本" : "繼續載入這個版本"} variant="quiet" disabled={reading.content.busy || !reading.online} onPress={reading.continueVersion} /> : null}
        </View> : null}
      </View> : null}
      {!visibleItems.length ? <Text style={s.body}>暫時沒有已取得的{filter === "year" ? "年度" : filter === "quarter" ? "季度" : "日期範圍"}檔案。</Text> : null}
    </View> : null}
  </View> : null;
  const footer = <View style={a.footer} testID="growth-archive-footer">
    <View style={a.footerActions} testID="growth-archive-footer-actions">
      {archive ? <AppButton expanded={revisionOpen} label={revisionOpen ? "收起報告資料" : "報告資料"} variant="quiet" density="compact"
        onPress={() => setRevisionOpen(value => !value)} /> : null}
      {footerActions}
    </View>
    {archive && revisionOpen && !contextChanged ? <View style={a.reportDetails} testID="growth-archive-revision">
      <Text style={s.body}>{archive.coverageNote}</Text>
      <Text style={s.body}>整理內容不等於已確認的新事實，也不是發展評估。</Text>
      <Text style={s.meta}>檔案版本 {archive.version} · 整理於 {growthTime(archive.generatedAt)}</Text>
      {archive.revisionChanges.map(change => <Text key={change.id} style={s.body}>{change.sourceIds.length > 0 && change.sourceIds.every(id => readableSource(id)) ? change.text : "一項更新的來源需要重新核對，暫不顯示內容。"}</Text>)}
      <Text selectable style={s.meta}>來源基準：{archive.sourceBasisVersion}</Text>
    </View> : null}
    {footerDetails}
  </View>;
  if (!archive) return <View style={s.stack}>{requested ? <Text style={s.body}>目前不能查看這份報告。只可選目前已載入且可讀取的期間或版本，沒有代選其他報告。</Text> : null}{periods}<View style={s.archiveEmpty} testID="growth-archive-unavailable">
    <Text accessibilityRole="header" aria-level={2} style={s.concernTitle}>{state === "ready" ? "暫時沒有可閱讀的成長報告" : stateCopy[state].title}</Text>
    <Text style={s.body}>{state === "ready" ? rangePeriods ? "可翻閱其他已取得的期間與版本。" : "可翻閱其他已取得的年度與季度。" : stateCopy[state].detail}</Text>
  </View>{footerActions || footerDetails ? footer : null}</View>;
  const sections = standardGrowthReportSections(model, archive);
  const feedback = exportOpen && exportFeedback?.key === exportIntentKey ? exportFeedback : null;
  const preparingExport = exportBusy || feedback?.state === "pending";
  const canExport = !preparingExport && model.online && !!onExportReport && !!exportItem && !!growthReportExportRequest(model, exportItem, purpose, includeSources, includeRevision);
  return <View style={s.stack} testID="growth-living-archive">
    <View ref={reportRef} tabIndex={-1} style={a.reportHeader} testID="growth-current-report">
      <View style={a.headerRow}>
        <View style={a.headerCopy}>
          <Text accessibilityRole="header" aria-level={2} style={a.reportTitle}>{archive.title ?? `${model.childName}的成長報告`}</Text>
        </View>
        <AppButton label="導出報告" variant="secondary" onPress={() => {clearExportFeedback(); setExportKey(selected?.key ?? null); setExportOpen(true);}} />
      </View>
      <View style={a.reportDateline}><Text style={a.periodLabel}>{archive.periodLabel}</Text>{selected?.period?.coverage === "partial" ? <AppStatusBadge label="部分內容" tone="warning" /> : null}</View>
      <Text style={a.supporting}>最近整理：{reportDateLabel(archive.generatedAt)} · {reportVersionLabel(archive.version)}</Text>
    </View>
    {periods}
    {state !== "ready" ? <View style={s.archiveUpdate} accessibilityRole="summary"><Text style={s.title}>{stateCopy[state].title}</Text><Text style={s.body}>{stateCopy[state].detail}</Text></View> : null}
    <View style={a.reportDocument} testID="growth-standard-report">
      <View style={a.reportNarrative} testID="growth-report-narrative">
      {sections.length > 1 ? <AppSelect key={JSON.stringify([contextKey, selectedKey])}
        label="跳到欄目" value={chapter} options={sections.map(section => ({value: section.id, label: section.title}))}
        onChange={Platform.OS === "web" ? setChapter : goTo} onSelectionClosed={Platform.OS === "web" ? goTo : undefined} /> : null}
      {sections.map((section, index) => <View key={section.id} ref={node => {if (node) sectionRefs.current.set(section.id, node); else sectionRefs.current.delete(section.id);}} tabIndex={-1}
        style={[a.reportSection, index > 0 && a.reportSectionDivider]} testID={`growth-report-${section.id}`}>
        <ReportChapter title={section.title}>
        {section.id === "profile" ? <View style={a.profileFacts} testID="growth-report-profile-facts">
          <View style={a.profileFact}><Text style={s.meta}>孩子</Text><Text style={s.title}>{model.childName}</Text></View>
          <View style={a.profileFact}><Text style={s.meta}>年齡</Text><Text style={s.body}>{archive.ageLabel || "未提供"}</Text></View>
        </View> : null}
        {section.entries.map(entry => {
          const sources = entry.sourceIds.map(readableSource);
          const readable = archiveEntryReadable(model, archive, entry);
          const disclosed = !contextChanged && opened.includes(entry.id);
          const fieldLabel = entry.title ?? (section.id === "profile" ? "近況摘要" : "已記錄的觀察");
          return <View key={entry.id} style={a.reportEntry} testID={`growth-report-entry-${entry.id}`}>
            {readable ? <>
              <View style={a.reportField}>
                <Text style={s.title}>{fieldLabel}</Text>
                {entry.timeLabel ? <Text style={s.meta}>{entry.timeLabel}</Text> : null}
              </View>
              <View style={a.reportEntryCopy}>
                <Text selectable style={entry.status === "unverified" ? s.archiveUnverified : s.reading}>{entry.text}</Text>
                <View style={a.entryMeta} testID={`growth-archive-entry-tools-${entry.id}`}>
                  <View style={a.entryStatus}><AppStatusBadge label={entryLabels[entry.status]} tone={entry.status === "confirmed_record" ? "success" : entry.status === "unverified" ? "warning" : "info"} /></View>
                  <AppButton label={disclosed ? "收起依據" : "查看依據"} accessibilityLabel={`${disclosed ? "收起" : "查看"}${fieldLabel}的依據`}
                    expanded={disclosed} variant="quiet" density="compact" onPress={() => toggle(entry.id)} style={compactControls ? a.compactDisclosure : undefined} />
                </View>
                {disclosed ? <SourceDisclosure sources={sources as GrowthArchiveSource[]} onRecord={onRecord ? openRecord : undefined} /> : null}
              </View>
            </> : <Text style={s.warning}>這項內容的來源已改變或未能核對，暫不顯示。</Text>}
          </View>;
        })}
        </ReportChapter>
      </View>)}
      </View>
    </View>
    {footer}
    <AppDialog visible={exportOpen && active && authorized && !contextChanged} onDismiss={closeExport} testID="growth-report-export">
      <AppDialog.Title>導出成長報告</AppDialog.Title>
      <AppDialog.ScrollArea style={a.exportScrollArea}><AppScrollView contentContainerStyle={a.exportContent}>
        <AppSelect label="報告用途" value={purpose} options={growthReportPurposes.map(option => ({ value: option.id, label: option.label }))} onChange={selectPurpose} />
        <Text style={s.body}>{growthReportPurposes.find(option => option.id === purpose)?.detail}</Text>
        <AppSelect label="報告期間" value={exportKey ?? ""} options={items.map(item => ({value: item.key, label: `${item.period?.label ?? item.snapshot.periodLabel}${item.period?.coverage === "partial" ? " · 部分內容" : ""}`}))} onChange={value => {clearExportFeedback(); setExportKey(value);}} />
        {exportItem?.period?.coverage === "partial" ? <Text style={s.warning}>{exportItem.period.coverageLabel}</Text> : null}
        <View style={s.smallStack}><Text style={s.title}>附加內容</Text>
          <AppCheckbox label="原始記錄與依據" checked={includeSources} onChange={value => {clearExportFeedback(); setIncludeSources(value);}} />
          <AppCheckbox label="本版更新說明" checked={includeRevision} onChange={value => {clearExportFeedback(); setIncludeRevision(value);}} />
        </View>
        {!onExportReport ? <View testID="growth-export-unavailable" style={a.exportNotice}><Text style={s.title}>報告版型預覽</Text>
          <Text style={s.body}>可先選擇用途與內容；報告生成及 PDF 下載暫未接通。</Text>
        </View> : null}
      </AppScrollView></AppDialog.ScrollArea>
      <View ref={exportFeedbackRef} tabIndex={-1} testID="growth-export-feedback" accessibilityRole={feedback?.state === "error" ? "alert" : undefined}
        accessibilityLiveRegion={feedback?.state === "error" ? "assertive" : "polite"} aria-atomic style={feedback ? a.exportFeedback : undefined}>
        <Text style={feedback?.state === "error" ? s.warning : s.body}>{feedback?.message ?? ""}</Text>
      </View>
      <AppDialog.Actions><AppButton label="關閉" variant="secondary" onPress={closeExport} />
        <AppButton ref={exportButton} label={preparingExport ? "正在準備 PDF…" : onExportReport ? "下載這個版本的 PDF" : "PDF 下載暫不可用"} disabled={!canExport} onPress={requestExport} />
      </AppDialog.Actions>
    </AppDialog>
  </View>;
}

const a = StyleSheet.create({
  exportFeedback: {paddingHorizontal: spacing.lg, paddingTop: spacing.md},
  reportHeader: {gap: spacing.md, minWidth: 0, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.line},
  headerRow: {flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: spacing.md},
  headerCopy: {gap: spacing.xs, minWidth: 0, flexShrink: 1},
  reportTitle: {fontFamily: chineseFont, color: colors.ink, fontSize: 24, lineHeight: 34, fontWeight: "700"},
  reportDocument: {gap: spacing.xl, minWidth: 0, width: "100%", maxWidth: 760},
  reportNarrative: {flexGrow: 1, flexShrink: 1, flexBasis: "auto", minWidth: 0, gap: spacing.xl},
  chapter: {gap: spacing.lg, minWidth: 0},
  chapterBody: {gap: spacing.lg, minWidth: 0},
  reportDateline: {flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md, minWidth: 0},
  periodLabel: {fontFamily: chineseFont, color: colors.ink, ...readingType.body, fontWeight: "600"},
  reading: {fontFamily: chineseFont, color: colors.ink, ...readingType.body, maxWidth: 760},
  supporting: {fontFamily: chineseFont, color: colors.muted, ...readingType.tool},
  reportSection: {gap: spacing.md, paddingVertical: spacing.sm, minWidth: 0},
  reportSectionDivider: {borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.lg},
  reportSectionTitle: {fontFamily: chineseFont, color: colors.ink, fontSize: 20, lineHeight: 28, fontWeight: "700", flexShrink: 1},
  profileFacts: {flexDirection: "row", flexWrap: "wrap", gap: spacing.lg, minWidth: 0, paddingBottom: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.softLine},
  profileFact: {flexBasis: 120, flexGrow: 1, minWidth: 0, gap: spacing.xs},
  reportEntry: {gap: spacing.md, paddingVertical: spacing.sm, minWidth: 0},
  reportField: {flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: spacing.sm, minWidth: 0},
  reportEntryCopy: {flexGrow: 1, flexShrink: 1, flexBasis: "auto", minWidth: 0, gap: spacing.sm},
  history: {gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.line},
  archiveLedger: {minWidth: 0, borderTopWidth: 1, borderTopColor: colors.line},
  archiveRow: {minWidth: 0, minHeight: 64, borderBottomWidth: 1, borderBottomColor: colors.line, padding: spacing.md,
    flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md},
  archiveRowSelected: {backgroundColor: colors.paleTeal},
  cardCopy: {flexGrow: 1, flexBasis: 260, minWidth: 0, gap: spacing.xs},
  readLink: {minHeight: 44, maxWidth: "100%", alignSelf: "flex-start", justifyContent: "center", paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, borderRadius: radius.small},
  readLinkLabel: {fontFamily: chineseFont, ...readingType.body, color: colors.teal, textDecorationLine: "underline", flexShrink: 1},
  entryMeta: {flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, minWidth: 0},
  entryStatus: {alignSelf: "center", justifyContent: "center", minWidth: 0, maxWidth: "100%"},
  compactDisclosure: {minHeight: 44, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm},
  footer: {maxWidth: 760, minWidth: 0, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.md},
  footerActions: {flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, minWidth: 0},
  reportDetails: {gap: spacing.sm, paddingVertical: spacing.sm, minWidth: 0},
  exportScrollArea: {paddingHorizontal: 0, minHeight: 0},
  exportContent: {padding: spacing.lg, gap: spacing.lg},
  exportNotice: {gap: spacing.xs, padding: spacing.md, backgroundColor: colors.paleAmber, borderRadius: radius.small},
});
