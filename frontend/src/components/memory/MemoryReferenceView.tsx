import { useMemoryReaderPresentation, type MemoryReaderDisclosure } from "../../navigation/RoutePresentation";
import { BackgroundSurface } from "../appearance/BackgroundSurface";
import { EmptyListCard } from "../EmptyListCard";
import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Linking, Platform, Pressable, StyleSheet, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { PreviewLink, usePreviewNavigation } from "../../preview/PreviewNavigationGuard";
import type { PersonalLibraryItem } from "../../../../src/shared/personal-library";
import { historyMessageQuestion, personalWorkQuestion } from "../../history-view-model";
import { PersistentWorkCards } from "../history/PersistentWorkCards";
import { HistoryMessageDetail } from "../history/HistoryMessageDetail";
import { Text } from "react-native-paper";
import { factIsApplicable, factSourceLabel, factStatusLabels, factUnavailableReason, visibilityLabels, type MemoryFactView, type MemorySummaryView } from "../../memory-view-model";
import { memoryClarificationQuestion, memoryConfirmerLabel, memoryDateLabel, visibleKnowledgeReferences, visibleMemoryFacts, visibleMemoryHistory,
  type KnowledgeReferenceView, type MemoryConfirmerDisplay, type MemoryReadProjection, type MemoryReferenceModel, type MemoryReferenceWorkspaceValue } from "../../memory-reference-view-model";
import { useMemoryReferenceWorkspace } from "../../workspaces/MemoryReferenceWorkspace";
import { chineseFont, colors, radius, readingLayout, readingType, spacing, workspaceType } from "../../theme";
import { AppStatusBadge } from "../AppStatusBadge";
import { AppIcon, type AppIconName } from "../AppIcon";
import { ReadStateNotice } from "../ReadStateNotice";
import { AppButton, AppTabPanel, UnderlineTabs, TabToolbar } from "../ui";
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
};
type FactReaderState = MemoryReaderDisclosure;
const closedFactReader: FactReaderState = { details: false, historyOpen: false };
function FactCard({ fact, model, workspace, confirmerDisplay, onQuestion, readerState, onReaderState }: {
  fact: Readonly<MemoryFactView>; model: MemoryReferenceModel; workspace: MemoryReferenceWorkspaceValue; onQuestion?: (fact: Readonly<MemoryFactView>) => void;
  confirmerDisplay?: MemoryConfirmerDisplay; readerState: FactReaderState; onReaderState(state: FactReaderState): void;
}) {
  const { details, historyOpen } = readerState;
  const history = model.longTerm.data?.histories[fact.id];
  const versions = visibleMemoryHistory(model, fact);
  const currentHistory = history?.factVersion === fact.version ? history : undefined;
  const available = factIsApplicable(fact);
  const source = factSources[fact.source.kind];
  return <View testID={`memory-reference-fact-${fact.id}`} style={[styles.card, styles.factReader]}>
    <View style={styles.titleRow}><Text accessibilityRole="header" aria-level={2} style={styles.factTopic}>{fact.key}</Text>
      <AppStatusBadge label={factStatusLabels[fact.status]} tone={fact.status === "confirmed" && available ? "success" : fact.status === "candidate" ? "warning" : "neutral"} /></View>
    <Text selectable style={styles.body}>{fact.content}</Text>
    <View style={styles.factContext}>
      <View style={styles.metadataLine}><AppIcon name={fact.visibility === "private" ? "lock-outline" : "account-group-outline"} size={15} /><Text accessibilityLabel={`可見範圍：${visibilityLabels[fact.visibility]}`} style={styles.meta}>{visibilityLabels[fact.visibility]}</Text></View>
      <Pressable testID={`memory-fact-source-${fact.id}`} accessibilityRole="button" accessibilityLabel={`${details ? "收起" : "查看"}來源：${source.label}`} accessibilityState={{ expanded: details }} aria-expanded={details}
        onPress={() => { onReaderState({ details: !details, historyOpen: false }); }} style={({ pressed }) => [styles.sourceTrigger, pressed && styles.sourcePressed]}>
        <AppIcon name={source.icon} size={15} color={colors.deepTeal} /><Text style={styles.sourceLabel}>{source.label}</Text><AppIcon name={details ? "chevron-up" : "chevron-down"} size={14} color={colors.deepTeal} />
      </Pressable>
    </View>
    {!available ? <Text style={styles.warning}>{factUnavailableReason(fact)}</Text> : null}
    {onQuestion ? <View style={styles.actions}><AppButton label="請助手協助核對" variant="quiet" density="compact" onPress={() => onQuestion(fact)} /></View> : null}
    {details ? <View style={styles.details}>
      <Metadata label="來源">{factSourceLabel(fact.source)}</Metadata>
      <Metadata label="記憶版本">{fact.version}</Metadata>
      <Metadata label="來源狀態">{fact.sourceState === "current" ? "目前版本" : "來源已更改，須重新核對"}</Metadata>
      <Metadata label="確認者">{memoryConfirmerLabel(fact.confirmedBy, confirmerDisplay)}</Metadata>
      <Metadata label="確認時間">{memoryDateLabel(fact.confirmedAt)}</Metadata>
      {fact.validUntil ? <Metadata label="有效至">{memoryDateLabel(fact.validUntil)}</Metadata> : null}
      {fact.reason ? <Metadata label="最近變更原因">{fact.reason}</Metadata> : null}
      {fact.source.kind === "care_record" ? <Metadata label="原記錄">{fact.source.recordId} · 版本 {fact.source.version}</Metadata> : null}
      <AppButton label={historyOpen ? "收起版本記錄" : "查看版本記錄"} expanded={historyOpen} variant="quiet" density="compact" onPress={() => {
        if (!historyOpen && !currentHistory && model.online) workspace.reads?.readFactHistory?.(fact.id, fact.version);
        onReaderState({ details, historyOpen: !historyOpen });
      }} />
      {historyOpen ? <View style={styles.history}>
        {currentHistory?.state === "loading" ? <Text style={styles.meta}>正在讀取版本記錄…</Text>
          : !currentHistory || currentHistory.state === "unavailable" ? <Text style={styles.meta}>版本記錄暫未提供</Text>
          : currentHistory.state === "error" ? <Text style={styles.warning}>暫時讀不到版本記錄</Text>
          : versions.length === 0 ? model.online && model.longTerm.state === "ready" ? <EmptyListCard title={currentHistory.hasMore ? "已載入頁面暫無版本記錄" : "暫無可顯示的版本記錄"} detail={currentHistory.hasMore ? "仍有版本未載入，可繼續讀取。" : undefined} /> : <Text style={styles.meta}>版本記錄尚未重新核對</Text> : versions.map(version => <View key={version.version} style={styles.historyEntry}>
            <Text style={styles.cardTitle}>版本 {version.version} · {factStatusLabels[version.status]}</Text>
            <Text selectable style={styles.body}>{version.content}</Text>
            <Text style={styles.meta}>{visibilityLabels[version.visibility]} · {factSourceLabel(version.source)}</Text>
            <Metadata label="確認者">{memoryConfirmerLabel(version.confirmedBy, confirmerDisplay)}</Metadata>
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
  return <View style={styles.card}><View style={styles.titleRow}><Text accessibilityRole="header" aria-level={2} style={styles.cardTitle}>對話摘要</Text><AppStatusBadge label="私人 · 整理內容" /></View>
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
    <Text accessibilityRole="header" aria-level={3} style={styles.cardTitle}>{source.title}</Text>
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
function CatalogCard({ source }: { source: PersonalLibraryItem }) {
  const [details, setDetails] = useState(false), [linkFailed, setLinkFailed] = useState(false);
  return <View style={styles.card} testID={`memory-catalog-source-${source.sourceId}`}>
    <Text accessibilityRole="header" aria-level={3} style={styles.cardTitle}>{source.title}</Text><Text style={styles.meta}>{source.publisher}</Text>
    <Text style={styles.meta}>覆核於 {memoryDateLabel(source.checkedAt)}</Text>
    <View style={styles.actions}><AppButton label="閱讀來源" variant="quiet" density="compact" onPress={() => { setLinkFailed(false); void Linking.openURL(source.url).catch(() => setLinkFailed(true)); }} />
      <AppButton label={details ? "收起來源資料" : "查看來源資料"} expanded={details} variant="quiet" density="compact" onPress={() => setDetails(value => !value)} /></View>
    {linkFailed ? <Text style={styles.warning}>暫未能開啟來源，可複製下方網址。</Text> : null}
    {details || linkFailed ? <View style={styles.details}><Metadata label="原文網址">{source.url}</Metadata><Metadata label="來源更新">{memoryDateLabel(source.sourceUpdatedAt)}</Metadata>
      {source.validUntil ? <Metadata label="有效至">{memoryDateLabel(source.validUntil)}</Metadata> : null}</View> : null}
  </View>;
}
function ReferenceSection({ model, workspace }: { model: MemoryReferenceModel; workspace: MemoryReferenceWorkspaceValue }) {
  const sources = visibleKnowledgeReferences(model.references);
  const catalog = model.references.data?.catalog;
  const groups = [{ key: "official_guidance", title: "官方指引", detail: "公共機構及專業指引的來源資料" }, { key: "recent_information", title: "近期資訊", detail: "新聞及具時效性的參考來源" }] as const;
  return <View style={styles.section}>
    {model.references.state !== "ready" ? <ReadNotice read={model.references} unavailable="參考來源暫未提供" /> : null}
    {!["loading", "error", "unavailable"].includes(model.references.state) ? groups.map(group => {
      const entries = sources.filter(source => source.classification === group.key);
      const catalogEntries = catalog?.filter(source => source.classification === group.key);
      return <View key={group.key} style={styles.section}><BackgroundSurface padded><Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>{group.title}</Text><Text style={styles.meta}>{group.detail}</Text></BackgroundSurface>
        {catalogEntries ? catalogEntries.length ? catalogEntries.map(source => <CatalogCard key={`${source.sourceId}:${source.versionId}`} source={source} />) : model.references.state === "ready" && model.online ? <EmptyListCard title={`已載入資料中暫無${group.title}`} detail={model.references.data.hasMore ? "仍有來源未載入，可繼續讀取。" : undefined} /> : <BackgroundSurface padded><Text style={styles.meta}>最新來源尚未核對</Text></BackgroundSurface> : entries.length ? entries.map(source => <ReferenceCard key={`${source.sourceId}:${source.versionId}:${source.chunkId}`} source={source} />)
          : model.references.state === "ready" && model.online ? <EmptyListCard title={`已載入資料中暫無${group.title}`} detail={model.references.data.hasMore ? "仍有來源未載入，可繼續讀取。" : undefined} /> : <BackgroundSurface padded><Text style={styles.meta}>最新來源尚未核對</Text></BackgroundSurface>}
      </View>;
    }) : null}
    {catalog ? <BackgroundSurface padded><Text style={styles.meta}>這是來源目錄，未逐項判定適用於這位孩子；來源存在亦不代表支持某句回答。</Text></BackgroundSurface> : null}
    {["error", "unavailable", "stale"].includes(model.references.state) && workspace.reads?.refreshContext ? <AppButton label="重新讀取參考" variant="quiet" disabled={!model.online || workspace.reads.referencesBusy} onPress={workspace.reads.refreshContext} /> : null}
    {model.references.data?.hasMore ? workspace.reads?.loadMoreReferences ? <AppButton label="載入更多來源" variant="quiet" disabled={!model.online || workspace.reads.referencesBusy} onPress={workspace.reads.loadMoreReferences} />
      : <BackgroundSurface padded><Text style={styles.meta}>仍有來源未載入</Text></BackgroundSurface> : null}
  </View>;
}
type MemoryReferenceViewProps = { factHref?:(id:string)=>Href; tab?:Tab; onTabChange?:(tab:Tab)=>void; selectedFactId?:string|null; onFactChange?:(id:string|null)=>void; tabActions?: ReactNode; confirmerDisplay?: MemoryConfirmerDisplay; onPrepareQuestion?: (question: string) => void };
function ScopedMemoryReferenceView({ workspace, confirmerDisplay, onPrepareQuestion, tabActions, tab:routeTab, onTabChange, selectedFactId, onFactChange, factHref }: MemoryReferenceViewProps & { workspace: MemoryReferenceWorkspaceValue }) {
  const { model } = workspace;
  const router = useRouter(), navigate = usePreviewNavigation();
  const [localTab, setLocalTab] = useState<Tab>("long"), [otherOpen, setOtherOpen] = useState(false);
  const tab=routeTab??localTab, setTab=onTabChange??setLocalTab;
  const tabsId = useId(), container = useContainerWidth();
  const current = useRef<MemoryReferenceWorkspaceValue | null>(workspace);
  current.current = workspace;
  useLayoutEffect(() => {
    current.current = workspace;
    return () => { if (current.current === workspace) current.current = null; };
  }, [workspace]);
  const facts = useMemo(() => visibleMemoryFacts(model), [model]);
  const factById = useMemo(() => new Map(facts.map(fact => [fact.id, fact])), [facts]);
  const confirmed = facts.filter(fact => fact.status === "confirmed"), other = facts.filter(fact => fact.status !== "confirmed");
  const [localFactId, setLocalFactId] = useState<string | null>(null);
  const activeId = selectedFactId === undefined ? localFactId : selectedFactId;
  const activeFact = activeId ? factById.get(activeId) : undefined;
  const { readerStates, setReaderStates, returnTo } = useMemoryReaderPresentation(workspace.scopeKey);
  const readerKey = (fact: Readonly<MemoryFactView>) => `${workspace.scopeKey}:${fact.id}:${fact.version}`;
  const focusedRow = useRef<string | null>(null);
  const readerRef = useRef<View>(null), previousActiveId = useRef<string | null>(null);
  useLayoutEffect(() => {
    const changed = previousActiveId.current !== activeId;
    previousActiveId.current = activeId;
    if (activeId && tab === "long") returnTo.current = activeId;
    if (changed && activeId && tab === "long") readerRef.current?.focus();
  }, [activeId, tab]);
  const rowRefs = useRef(new Map<string, View>()), listRef = useRef<View>(null);
  const selectFact = (id: string | null) => { if (onFactChange) onFactChange(id); else setLocalFactId(id); };
  const returnToList = () => selectFact(null);
  useLayoutEffect(() => {
    if (!activeId && tab === "long" && returnTo.current) {
      const target = rowRefs.current.get(returnTo.current) ?? listRef.current;
      returnTo.current = null; target?.focus();
    }
  }, [activeId, tab, facts]);
  useLayoutEffect(() => {
    if (!activeId && tab === "long" && focusedRow.current && !factById.has(focusedRow.current)) {
      focusedRow.current = null; listRef.current?.focus();
    }
    const valid = new Set(facts.map(readerKey));
    setReaderStates(previous => Object.keys(previous).some(key => !valid.has(key))
      ? Object.fromEntries(Object.entries(previous).filter(([key]) => valid.has(key))) : previous);
  }, [facts, activeId, tab]);
  const onQuestion = onPrepareQuestion ? (fact: Readonly<MemoryFactView>) => {
    // A stale card callback cannot use the next child or a replaced fact version.
    if (current.current !== workspace || !visibleMemoryFacts(current.current.model).some(item => item.id === fact.id && item.version === fact.version)) return;
    onPrepareQuestion(memoryClarificationQuestion(model.childName, fact));
  } : undefined;
  function renderFactRow(fact: Readonly<MemoryFactView>) {
    const href = factHref?.(fact.id), link = Platform.OS === "web" && !!href;
    const row = <Pressable key={fact.id} ref={node => { if (node) rowRefs.current.set(fact.id, node); else rowRefs.current.delete(fact.id); }}
      testID={`memory-fact-row-${fact.id}`} accessibilityRole={link ? "link" : "button"} accessibilityLabel={`閱讀記憶：${fact.key}`}
      onFocus={() => { focusedRow.current = fact.id; }} onBlur={() => { if (focusedRow.current === fact.id) focusedRow.current = null; }}
      onPress={link ? undefined : () => selectFact(fact.id)} style={styles.factRow}>
      <Text style={styles.factTopic}>{fact.key}</Text><Text style={styles.factContent} numberOfLines={2}>{fact.content}</Text>
      <Text style={styles.meta}>{visibilityLabels[fact.visibility]} · {factStatusLabels[fact.status]} · 閱讀來源與版本</Text>
    </Pressable>;
    return link ? <PreviewLink key={fact.id} href={href!}>{row}</PreviewLink> : row;
  }
  return <View ref={container.ref} onLayout={container.onLayout} style={styles.root}>
    <TabToolbar actions={tabActions} stacked={container.width < 480}><UnderlineTabs id={tabsId} label="記憶與參考分類" items={tabs} value={tab} onChange={setTab} /></TabToolbar>
    <View style={styles.sectionIntro} testID="memory-section-purpose"><AppIcon name={tab === "long" ? "book-open-page-variant-outline" : tab === "short" ? "message-text-outline" : "book-open-variant"} size={22} color={colors.teal} /><Text style={[styles.meta, { flex: 1 }]}>{tab === "long" ? "先看已確認的資料；有疑問時，帶同原來源請助手核對。" : tab === "short" ? "接續進行中的工作，或回到原對話查看上下文。" : "查閱指引與資訊來源；是否適用，仍要按孩子情況判斷。"}</Text></View>
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
        <View style={styles.section}>
          {activeId ? <>
            <AppButton label="返回記憶清單" variant="secondary" onPress={returnToList} />
            <View ref={readerRef} tabIndex={-1} accessibilityLabel="記憶詳情">
            {activeFact ? tab === "long" ? <FactCard key={readerKey(activeFact)} fact={activeFact} model={model} workspace={workspace}
              confirmerDisplay={confirmerDisplay} onQuestion={onQuestion} readerState={readerStates[readerKey(activeFact)] ?? closedFactReader}
              onReaderState={next => { if (current.current === workspace) setReaderStates(previous => ({ ...previous, [readerKey(activeFact)]: next })); }} /> : null
              : <Text style={styles.warning}>目前不能查看這項內容；記憶可能未載入或已不能存取。</Text>}
            </View>
          </> : <View ref={listRef} tabIndex={-1} accessibilityLabel="記憶清單" style={styles.section}>
            <BackgroundSurface padded><Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>已確認事實</Text></BackgroundSurface>
            {confirmed.length ? <View style={styles.factGrid}>{confirmed.map(renderFactRow)}</View> : model.longTerm.state === "ready" && model.online ? <EmptyListCard title="已載入資料中沒有已確認事實" detail={model.longTerm.data.hasMoreFacts ? "仍有記憶未載入，可繼續讀取。" : undefined} /> : <BackgroundSurface padded><Text style={styles.meta}>已確認事實尚未重新核對</Text></BackgroundSurface>}
            {other.length ? <View style={styles.section}><AppButton label={otherOpen ? "收起待核對與停用資料" : `待核對與停用資料（已載入 ${other.length} 項）`} expanded={otherOpen} variant="quiet" onPress={() => setOtherOpen(value => !value)} />
              {otherOpen ? <View style={styles.factGrid}>{other.map(renderFactRow)}</View> : null}</View> : null}
          </View>}
        </View>
        {model.longTerm.data?.hasMoreFacts ? workspace.reads?.loadMoreFacts ? <AppButton label="載入更多記憶" variant="quiet" disabled={!model.online} onPress={workspace.reads.loadMoreFacts} />
          : <BackgroundSurface padded><Text style={styles.meta}>仍有記憶未載入</Text></BackgroundSurface> : null}
        <SummaryCard key={`${model.longTerm.data?.summary?.id}:${model.longTerm.data?.summary?.version}`} summary={model.longTerm.data?.summary ?? null} emptyReady={model.longTerm.state === "ready" && model.online} />

      </ReadNotice>
    </View></AppTabPanel>
    <AppTabPanel tabsId={tabsId} tabKey="references" active={tab === "references"}><ReferenceSection model={model} workspace={workspace} /></AppTabPanel>
  </View>;
}
export function MemoryReferenceView({ confirmerDisplay, onPrepareQuestion, tabActions, ...route }: MemoryReferenceViewProps) {
  const workspace = useMemoryReferenceWorkspace();
  const currentDisplay = workspace && confirmerDisplay?.scopeKey === workspace.scopeKey && confirmerDisplay.childId === workspace.model.childId ? confirmerDisplay : undefined;
  return workspace ? <ScopedMemoryReferenceView {...route} key={workspace.scopeKey} workspace={workspace} tabActions={tabActions} confirmerDisplay={currentDisplay} onPrepareQuestion={onPrepareQuestion} />
    : <ReadStateNotice state="unavailable" title="暫不能查看記憶與參考" message="請先選擇有權查看的孩子。">{tabActions}</ReadStateNotice>;
}
const styles = StyleSheet.create({
  sectionIntro: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderLeftWidth: 3, borderLeftColor: colors.teal, backgroundColor: colors.paleTeal },
  root: { width: "100%", minWidth: 0, gap: spacing.lg },
  section: { gap: spacing.md, minWidth: 0 },
  sectionTitle: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section },
  factGrid: { flexDirection: "row", flexWrap: "wrap", alignItems: "stretch", gap: spacing.md, minWidth: 0 },
  factRow: { width: "100%", minWidth: 0, minHeight: 44, padding: spacing.md, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.line },
  card: { backgroundColor: colors.paper, borderColor: colors.line, borderWidth: 1, borderRadius: radius.medium, padding: spacing.lg, gap: spacing.sm, minWidth: 0 },
  factReader: { width: "100%", maxWidth: readingLayout.maxWidth, alignSelf: "flex-start" },
  titleRow: { flexDirection: "row", alignItems: "flex-start", flexWrap: "wrap", gap: spacing.sm, minWidth: 0 },
  cardTitle: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section, flexShrink: 1 },
  factTopic: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, flex: 1, minWidth: 0 },
  factContent: { fontFamily: chineseFont, color: colors.ink, fontSize: 18, lineHeight: 28, fontWeight: "600", flexShrink: 1 },
  factContext: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, minWidth: 0 },
  metadataLine: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minWidth: 0, flexShrink: 1 },
  sourceTrigger: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minHeight: 44, paddingHorizontal: spacing.xs, borderRadius: radius.small, minWidth: 0, flexShrink: 1 },
  sourceLabel: { fontFamily: chineseFont, color: colors.deepTeal, ...readingType.meta, flexShrink: 1 },
  sourcePressed: { backgroundColor: colors.paleTeal },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.body, flexShrink: 1 },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, flexShrink: 1 },
  warning: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.tool, flexShrink: 1 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, minWidth: 0 },
  details: { borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.sm, gap: spacing.sm, minWidth: 0 },
  history: { gap: spacing.md, minWidth: 0 }, historyEntry: { borderLeftWidth: 2, borderLeftColor: colors.sage, paddingLeft: spacing.md, gap: spacing.xs, minWidth: 0 },
});
