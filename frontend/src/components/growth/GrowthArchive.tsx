import { AppStatusBadge } from "../AppStatusBadge";
import { AppIcon } from "../AppIcon";
import { AppCheckbox } from "../AppCheckbox";
import { AppDialog } from "../AppDialog";
import { AppScrollView } from "../AppScrollView";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Platform, Pressable, StyleSheet, View, useWindowDimensions, type ScrollView } from "react-native";
import { Text } from "react-native-paper";
import type { GrowthArchiveEntry, GrowthArchiveProjection, GrowthArchiveSource, GrowthViewModel } from "../../growth-view-model";
import { growthTime } from "../../growth-view-model";
import { chineseFont, colors, mobileLayout, radius, readingType, spacing } from "../../theme";
import { AppButton, AppSelect } from "../ui";
import { archiveEntryReadable, archiveReadableSource, archiveReadingView, filterArchiveItems, growthReportExportRequest, growthReportPurposes, standardGrowthReportSections,
  type ArchiveFilter, type ArchiveReadingItem, type GrowthReportExportRequest, type GrowthReportPurpose } from "./growth-archive-view";
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

function SourceDisclosure({sources, onRecord}: {sources: GrowthArchiveSource[]; onRecord?: (source: GrowthArchiveSource) => void}) {
  return <View style={s.archiveSources}>{sources.map(source => <View key={source.id} style={s.smallStack}>
    <Text style={s.title}>{source.label}</Text>
    <Text selectable style={s.body}>{source.excerpt}</Text>
    <Text style={s.meta}>{source.timeLabel} · 來源版本 {source.version}</Text>
    {source.recordId && onRecord ? <AppButton label={`查看原始${source.label}`} variant="quiet" onPress={() => onRecord(source)} /> : null}
  </View>)}</View>;
}

export function GrowthArchive({model, wide, scrollRef, onRecord, onExportReport, exportBusy, footerActions, footerDetails}: {
  model: GrowthViewModel; wide: boolean; scrollRef: RefObject<ScrollView | null>; onRecord?: (id?: string) => void;
  onExportReport?: (request: GrowthReportExportRequest) => void;
  exportBusy?: boolean;
  footerActions?: ReactNode; footerDetails?: ReactNode;
}) {
  const {authorized, state, items, current} = archiveReadingView(model);
  const touch = useInteractionDensity();
  const compactControls = useWindowDimensions().width >= mobileLayout.breakpoint && !touch;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [filter, setFilter] = useState<ArchiveFilter>("all");
  const [opened, setOpened] = useState<string[]>([]);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportKey, setExportKey] = useState<string | null>(null);
  const [purpose, setPurpose] = useState<GrowthReportPurpose>("family");
  const [includeSources, setIncludeSources] = useState(true);
  const [includeRevision, setIncludeRevision] = useState(false);
  const [chapter, setChapter] = useState("profile");
  const contextKey = JSON.stringify([model.scopeKey, model.childId]);
  const previousContext = useRef(contextKey);
  const contextChanged = previousContext.current !== contextKey;
  const selected = selectedKey === null || contextChanged ? current : items.find(item => item.key === selectedKey) ?? null;
  const archive = selected?.snapshot ?? null;
  const exportItem = items.find(item => item.key === exportKey) ?? null;
  const sectionRefs = useRef(new Map<string, View>());
  const reportRef = useRef<View>(null);
  const jumpToReport = useRef(false);
  const latest = useRef({model, archive, contextKey, exportOpen, exportKey});
  latest.current = {model, archive, contextKey, exportOpen, exportKey};
  useEffect(() => {
    previousContext.current = contextKey;
    setSelectedKey(null); setHistoryOpen(false); setFilter("all"); setPurpose("family"); setExportKey(null);
    setIncludeSources(true); setIncludeRevision(false); jumpToReport.current = false;
  }, [contextKey]);
  useEffect(() => {
    setOpened([]); setRevisionOpen(false); setExportOpen(false); setChapter("profile");
  }, [contextKey, model.page?.authorityVersion, archive?.id, archive?.version, selected?.key, authorized]);

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
    jumpToReport.current = true; setSelectedKey(item.key); setHistoryOpen(false);
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
  function requestExport() {
    if (!onExportReport || !exportItem || !latest.current.exportOpen || latest.current.exportKey !== exportKey
      || latest.current.contextKey !== contextKey || latest.current.model.page?.authorityVersion !== model.page?.authorityVersion) return;
    const request = growthReportExportRequest(latest.current.model, exportItem, purpose, includeSources, includeRevision);
    if (request) onExportReport(request);
  }
  const visibleItems = filterArchiveItems(items, filter);
  const rangePeriods = items.some(item => item.period?.kind === "range");
  const periods = items.length > 0 && (items.length > 1 || selectedKey !== null && !selected) ? <View style={s.stack}>
    <View style={s.row}><AppButton label={historyOpen ? "收起其他期間" : rangePeriods ? "翻閱其他期間／版本" : "翻閱年度／季度"} expanded={historyOpen} variant="quiet" onPress={() => setHistoryOpen(value => !value)} />
      {current && selectedKey !== null && selectedKey !== current.key ? <AppButton label="回到目前報告" variant="secondary" onPress={() => selectArchive(current)} /> : null}
    </View>
    {historyOpen && !contextChanged ? <View style={a.history} testID="growth-archive-library">
      <Text style={s.meta}>{rangePeriods ? "已取得的期間與版本" : "已取得的年度與季度"}</Text>
      <View style={a.filters} accessibilityLabel="檔案期間類別">
        {(rangePeriods ? [{key: "all", label: "全部"}, {key: "range", label: "日期範圍"}] as const
          : [{key: "all", label: "全部"}, {key: "year", label: "年度"}, {key: "quarter", label: "季度"}] as const).map(option =>
          <Pressable key={option.key} accessibilityRole="button" accessibilityLabel={`顯示${option.label}成長檔案`} accessibilityState={{selected: filter === option.key}}
            aria-pressed={filter === option.key} onPress={() => setFilter(option.key)} style={[a.filterButton, filter === option.key && a.filterSelected]}>
            <Text style={[a.filterText, filter === option.key && a.filterTextSelected]}>{option.label}</Text>
          </Pressable>)}
      </View>
      <View style={wide ? a.archiveGrid : s.stack}>
        {visibleItems.map(item => {
          const version = Number.isInteger(item.snapshot.version) && item.snapshot.version > 0 ? `版本 ${item.snapshot.version}` : "版本未提供";
          const generatedAt = typeof item.snapshot.generatedAt === "string" && Number.isFinite(Date.parse(item.snapshot.generatedAt))
            ? `整理於 ${growthTime(item.snapshot.generatedAt)}` : "整理時間未提供";
          const metadata = `${version} · ${generatedAt}`;
          return <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={`閱讀${item.period?.label ?? item.snapshot.periodLabel}，${metadata}${item.period?.coverage === "partial" ? "，部分內容" : ""}`}
          accessibilityState={{selected: selected?.key === item.key}} aria-pressed={selected?.key === item.key} onPress={() => selectArchive(item)}
          testID={`growth-archive-card-${item.key}`} style={[a.archiveCard, wide && a.archiveCardWide, selected?.key === item.key && a.archiveCardSelected]}>
          <AppIcon name="book-open-variant" size={22} />
          <View style={a.cardCopy}><Text style={s.title}>{item.period?.label ?? "成長報告"}</Text><Text style={s.meta}>{item.snapshot.periodLabel}{item.period?.coverage === "partial" ? " · 部分內容" : ""}</Text>
            <Text style={s.meta}>{metadata}</Text></View>
          <AppIcon name="chevron-right" size={18} />
        </Pressable>;
        })}
      </View>
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
      <Text style={s.meta}>{archive.coverageNote}</Text>
      <Text style={s.meta}>整理內容不等於已確認的新事實，也不是發展評估。</Text>
      <Text style={s.meta}>檔案版本 {archive.version} · 整理於 {growthTime(archive.generatedAt)}</Text>
      {archive.revisionChanges.map(change => <Text key={change.id} style={s.body}>{change.sourceIds.length > 0 && change.sourceIds.every(id => readableSource(id)) ? change.text : "一項更新的來源需要重新核對，暫不顯示內容。"}</Text>)}
      <Text selectable style={s.meta}>來源基準：{archive.sourceBasisVersion}</Text>
    </View> : null}
    {footerDetails}
  </View>;
  if (!archive) return <View style={s.stack}>{periods}<View style={s.archiveEmpty} testID="growth-archive-unavailable">
    <Text accessibilityRole="header" style={s.concernTitle}>{state === "ready" ? "暫時沒有可閱讀的成長報告" : stateCopy[state].title}</Text>
    <Text style={s.body}>{state === "ready" ? rangePeriods ? "可翻閱其他已取得的期間與版本。" : "可翻閱其他已取得的年度與季度。" : stateCopy[state].detail}</Text>
  </View>{footerActions || footerDetails ? footer : null}</View>;
  const sections = standardGrowthReportSections(model, archive);
  const canExport = !exportBusy && model.online && !!onExportReport && !!exportItem && !!growthReportExportRequest(model, exportItem, purpose, includeSources, includeRevision);
  return <View style={s.stack} testID="growth-living-archive">
    <View ref={reportRef} tabIndex={-1} style={a.reportHeader} testID="growth-current-report">
      <View style={a.headerRow}>
        <View style={a.headerCopy}>
          <Text style={a.kicker}>{selected?.period?.kind === "range" ? "成長報告" : selected?.key === current?.key ? "標準成長報告" : selected?.period?.label ?? "成長報告"}</Text>
          <Text accessibilityRole="header" style={a.reportTitle}>{archive.title ?? `${model.childName}的成長報告`}</Text>
        </View>
        <AppButton label="導出報告" variant="accent" onPress={() => {setExportKey(selected?.key ?? null); setExportOpen(true);}} />
      </View>
      <View style={s.row}><Text style={s.meta}>{archive.periodLabel}</Text>{selected?.period?.coverage === "partial" ? <AppStatusBadge label="部分內容" tone="warning" /> : null}</View>
      <Text style={s.meta}>最近整理：{growthTime(archive.generatedAt)}</Text>
    </View>
    {periods}
    {state !== "ready" ? <View style={s.archiveUpdate} accessibilityRole="summary"><Text style={s.title}>{stateCopy[state].title}</Text><Text style={s.body}>{stateCopy[state].detail}</Text></View> : null}
    <View style={[a.reportDocument, wide && a.reportDocumentWide]} testID="growth-standard-report">
      {!wide && sections.length > 1 ? <AppSelect key={JSON.stringify([model.scopeKey, model.childId, model.page?.authorityVersion, archive.id, archive.version, selected?.key])}
        label="跳到欄目" value={chapter} options={sections.map(section => ({value: section.id, label: section.title}))}
        onChange={Platform.OS === "web" ? setChapter : goTo} onSelectionClosed={Platform.OS === "web" ? goTo : undefined} /> : null}
      {sections.map((section, index) => <View key={section.id} ref={node => {if (node) sectionRefs.current.set(section.id, node); else sectionRefs.current.delete(section.id);}} tabIndex={-1}
        style={[a.reportSection, index > 0 && a.reportSectionDivider]} testID={`growth-report-${section.id}`}>
        <Text accessibilityRole="header" style={a.reportSectionTitle}>{section.title}</Text>
        {section.id === "profile" ? <View style={a.profileFacts} testID="growth-report-profile-facts">
          <View style={a.profileFact}><Text style={s.meta}>孩子</Text><Text style={s.title}>{model.childName}</Text></View>
          <View style={a.profileFact}><Text style={s.meta}>年齡</Text><Text style={s.body}>{archive.ageLabel || "未提供"}</Text></View>
          <View style={[a.profileFact, a.profilePeriod]}><Text style={s.meta}>記錄範圍</Text><Text style={s.body}>{archive.periodLabel}</Text></View>
        </View> : null}
        {section.entries.map(entry => {
          const sources = entry.sourceIds.map(readableSource);
          const readable = archiveEntryReadable(model, archive, entry);
          const disclosed = !contextChanged && opened.includes(entry.id);
          const fieldLabel = entry.title ?? (section.id === "profile" ? "近況摘要" : "已記錄的觀察");
          return <View key={entry.id} style={[a.reportEntry, wide && a.reportEntryWide]} testID={`growth-report-entry-${entry.id}`}>
            {readable ? <>
              <View style={[a.reportField, wide && a.reportFieldWide]}>
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
      </View>)}
    </View>
    {footer}
    <AppDialog visible={exportOpen && authorized && !contextChanged} onDismiss={() => setExportOpen(false)} testID="growth-report-export">
      <AppDialog.Title>導出成長報告</AppDialog.Title>
      <AppDialog.ScrollArea style={a.exportScrollArea}><AppScrollView contentContainerStyle={a.exportContent}>
        <Text style={s.body}>按用途整理同一份成長記錄</Text>
        <View style={s.smallStack} accessibilityRole="radiogroup" accessibilityLabel="報告用途">
          {growthReportPurposes.map(option => <Pressable key={option.id} accessibilityRole="radio" accessibilityLabel={option.label}
            accessibilityState={{checked: purpose === option.id}} aria-checked={purpose === option.id} onPress={() => setPurpose(option.id)}
            style={[a.purpose, purpose === option.id && a.purposeSelected]}>
            <AppIcon name={purpose === option.id ? "radiobox-marked" : "radiobox-blank"} size={20} />
            <View style={a.cardCopy}><Text style={s.title}>{option.label}</Text><Text style={s.body}>{option.detail}</Text></View>
          </Pressable>)}
        </View>
        <AppSelect label="報告期間" value={exportKey ?? ""} options={items.map(item => ({value: item.key, label: `${item.period?.label ?? item.snapshot.periodLabel}${item.period?.coverage === "partial" ? " · 部分內容" : ""}`}))} onChange={setExportKey} />
        {exportItem?.period?.coverage === "partial" ? <Text style={s.warning}>{exportItem.period.coverageLabel}</Text> : null}
        <View style={s.smallStack}><Text style={s.title}>附加內容</Text>
          <AppCheckbox label="原始記錄與依據" checked={includeSources} onChange={setIncludeSources} />
          <AppCheckbox label="本版更新說明" checked={includeRevision} onChange={setIncludeRevision} />
        </View>
        {!onExportReport ? <View testID="growth-export-unavailable" style={a.exportNotice}><Text style={s.title}>報告版型預覽</Text>
          <Text style={s.body}>可先選擇用途與內容；報告生成及 PDF 下載暫未接通。</Text>
        </View> : null}
      </AppScrollView></AppDialog.ScrollArea>
      <AppDialog.Actions><AppButton label="關閉" variant="secondary" onPress={() => setExportOpen(false)} />
        <AppButton label={exportBusy ? "正在準備 PDF…" : onExportReport ? "下載這個版本的 PDF" : "PDF 下載暫不可用"} disabled={!canExport} onPress={requestExport} />
      </AppDialog.Actions>
    </AppDialog>
  </View>;
}

const a = StyleSheet.create({
  reportHeader: {gap: spacing.sm, minWidth: 0, paddingVertical: spacing.sm},
  headerRow: {flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: spacing.md},
  headerCopy: {gap: spacing.xs, minWidth: 0, flexShrink: 1},
  reportTitle: {fontFamily: chineseFont, color: colors.ink, fontSize: 24, lineHeight: 34, fontWeight: "700"},
  kicker: {fontFamily: chineseFont, ...readingType.meta, color: colors.muted, fontWeight: "600"},
  reportDocument: {backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: radius.small, padding: spacing.lg, gap: spacing.md, minWidth: 0, maxWidth: 1040},
  reportDocumentWide: {paddingHorizontal: spacing.xl, paddingVertical: spacing.lg},
  reportSection: {gap: spacing.md, paddingVertical: spacing.sm, minWidth: 0},
  reportSectionDivider: {borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.lg},
  reportSectionTitle: {fontFamily: chineseFont, color: colors.ink, fontSize: 18, lineHeight: 28, fontWeight: "700"},
  profileFacts: {flexDirection: "row", flexWrap: "wrap", gap: spacing.md, minWidth: 0},
  profileFact: {flexBasis: 120, flexGrow: 1, minWidth: 0, gap: spacing.xs},
  profilePeriod: {flexBasis: 240, flexShrink: 1},
  reportEntry: {gap: spacing.sm, paddingVertical: spacing.sm, minWidth: 0},
  reportEntryWide: {flexDirection: "row", alignItems: "flex-start", gap: spacing.xl},
  reportField: {gap: spacing.xs, minWidth: 0},
  reportFieldWide: {width: 152, flexShrink: 0},
  reportEntryCopy: {flexGrow: 1, flexShrink: 1, flexBasis: "auto", minWidth: 0, gap: spacing.sm},
  history: {gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.line},
  filters: {flexDirection: "row", flexWrap: "wrap", gap: spacing.sm},
  filterButton: {borderWidth: 1, borderColor: colors.controlOutline, borderRadius: radius.small, paddingHorizontal: spacing.lg, minHeight: 44, alignItems: "center", justifyContent: "center"},
  filterSelected: {backgroundColor: colors.ink, borderColor: colors.ink},
  filterText: {fontFamily: chineseFont, ...readingType.tool, color: colors.ink, fontWeight: "600"},
  filterTextSelected: {color: colors.white},
  archiveGrid: {flexDirection: "row", flexWrap: "wrap", alignItems: "stretch", gap: spacing.md},
  archiveCard: {minWidth: 0, borderWidth: 1, borderColor: colors.controlOutline, borderRadius: radius.small, padding: spacing.md,
    flexDirection: "row", alignItems: "center", gap: spacing.md},
  archiveCardWide: {width: "48%", flexGrow: 1, maxWidth: "100%"},
  archiveCardSelected: {borderColor: "transparent", backgroundColor: colors.sage},
  cardCopy: {flex: 1, minWidth: 0, gap: spacing.xs},
  entryMeta: {flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, minWidth: 0},
  entryStatus: {alignSelf: "center", justifyContent: "center", minWidth: 0, maxWidth: "100%"},
  compactDisclosure: {minHeight: 32, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm},
  footer: {maxWidth: 1040, minWidth: 0, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.md},
  footerActions: {flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, minWidth: 0},
  reportDetails: {gap: spacing.sm, paddingVertical: spacing.sm, minWidth: 0},
  purpose: {flexDirection: "row", gap: spacing.md, alignItems: "center", padding: spacing.md, borderWidth: 1, borderColor: colors.controlOutline, borderRadius: radius.small},
  purposeSelected: {backgroundColor: colors.sage, borderColor: "transparent"},
  exportScrollArea: {paddingHorizontal: 0, minHeight: 0},
  exportContent: {padding: spacing.lg, gap: spacing.lg},
  exportNotice: {gap: spacing.xs, padding: spacing.md, backgroundColor: colors.paleAmber, borderRadius: radius.small},
});
