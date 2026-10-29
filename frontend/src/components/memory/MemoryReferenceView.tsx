import { Link } from "expo-router";
import { serializeMemoryRoute, type MemoryRouteState } from "../../navigation/route-state";
import { ReadTargetLink } from "../ReadTargetLink";
import { useReaderPosition } from "../../navigation/ReaderPosition";
import { useReaderReturn } from "../../navigation/useReaderReturn";
import { WorkspaceSwitch } from "../workspace/WorkspaceSwitch";
import { BackgroundSurface } from "../appearance/BackgroundSurface";
import { EmptyListCard } from "../EmptyListCard";
import { useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Linking, Platform, Pressable, StyleSheet, View, type ScrollView } from "react-native";
import type { PersonalLibraryItem } from "../../../../src/shared/personal-library";
import { personalWorkStatusLabels, personalWorkQuestion } from "../../history-view-model";
import { PersistentWorkReader } from "../history/PersistentWorkReader";
import { Text } from "react-native-paper";
import { factIsApplicable, factSourceLabel, factStatusLabels, factUnavailableReason, visibilityLabels, type MemoryFactView, type MemorySummaryView } from "../../memory-view-model";
import { memoryClarificationQuestion, memoryConfirmerLabel, memoryDateLabel, visibleKnowledgeReferences, visibleMemoryFacts, visibleMemoryHistory,
  type KnowledgeReferenceView, type MemoryConfirmerDisplay, type MemoryReadProjection, type MemoryReferenceModel, type MemoryReferenceWorkspaceValue } from "../../memory-reference-view-model";
import { useMemoryReferenceWorkspace } from "../../workspaces/MemoryReferenceWorkspace";
import { chineseFont, colors, readingType, spacing, workspaceType } from "../../theme";
import { AppStatusBadge } from "../AppStatusBadge";
import { AppIcon } from "../AppIcon";
import { ReadStateNotice } from "../ReadStateNotice";
import { AppButton, AppTabPanel } from "../ui";

type Tab = "short" | "long" | "references";
const tabs: { key: Tab; label: string; description: string }[] = [
  { key: "long", label: "孩子的已知資料", description: "已確認事實、來源與更正版本" }, { key: "short", label: "接續目前工作", description: "回看原對話與未完的事情" }, { key: "references", label: "參考資料庫", description: "官方指引與近期資訊" },
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
function InformationLine({ label, children }: { label: string; children: ReactNode }) {
  return <Text selectable style={styles.body}>{label}：{children}</Text>;
}
const factSources: Record<MemoryFactView["source"]["kind"], string> = { private_chat: "私人聊天", care_record: "照顧記錄", manual: "手動描述" };
function FactReader({ fact, model, workspace, confirmerDisplay, onQuestion }: {
  fact: Readonly<MemoryFactView>; model: MemoryReferenceModel; workspace: MemoryReferenceWorkspaceValue; onQuestion?: (fact: Readonly<MemoryFactView>) => void;
  confirmerDisplay?: MemoryConfirmerDisplay;
}) {
  const [details, setDetails] = useState(false), [historyOpen, setHistoryOpen] = useState(false);
  const history = model.longTerm.data?.histories[fact.id];
  const versions = visibleMemoryHistory(model, fact);
  const currentHistory = history?.factVersion === fact.version ? history : undefined;
  const available = factIsApplicable(fact);
  const source = factSources[fact.source.kind];
  return <View testID={`memory-reference-fact-${fact.id}`} style={styles.factBody}>
    <Text selectable style={styles.factContent}>{fact.content}</Text>
    <View style={styles.factContext}>
      <View style={styles.metadataLine}><AppIcon name={fact.visibility === "private" ? "lock-outline" : "account-group-outline"} size={15} /><Text accessibilityLabel={`可見範圍：${visibilityLabels[fact.visibility]}`} style={styles.meta}>{visibilityLabels[fact.visibility]}</Text></View>
      <AppStatusBadge label={factStatusLabels[fact.status]} tone={fact.status === "confirmed" && available ? "success" : fact.status === "candidate" ? "warning" : "neutral"} />
      <Text style={styles.meta}>版本 {fact.version}</Text>
      <AppButton label={source} accessibilityLabel={`${details ? "收起" : "查看"}來源：${source}`} expanded={details} variant="quiet" density="compact"
        onPress={() => { setDetails(value => !value); setHistoryOpen(false); }} />
    </View>
    {!available ? <Text style={styles.warning}>{factUnavailableReason(fact)}</Text> : null}
    {onQuestion ? <View style={styles.actions}><AppButton label="帶到助手核對" variant="quiet" density="compact" onPress={() => onQuestion(fact)} /></View> : null}
    {details ? <View style={styles.details}>
      <InformationLine label="來源">{factSourceLabel(fact.source)}</InformationLine>
      <Metadata label="來源狀態">{fact.sourceState === "current" ? "目前版本" : "來源已更改，須重新核對"}</Metadata>
      <Metadata label="確認者">{memoryConfirmerLabel(fact.confirmedBy, confirmerDisplay)}</Metadata>
      <Metadata label="確認時間">{memoryDateLabel(fact.confirmedAt)}</Metadata>
      {fact.validUntil ? <Metadata label="有效至">{memoryDateLabel(fact.validUntil)}</Metadata> : null}
      {fact.reason ? <InformationLine label="最近變更原因">{fact.reason}</InformationLine> : null}
      {fact.source.kind === "care_record" ? <Metadata label="原記錄">{fact.source.recordId} · 版本 {fact.source.version}</Metadata> : null}
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
            <Metadata label="確認者">{memoryConfirmerLabel(version.confirmedBy, confirmerDisplay)}</Metadata>
            <Metadata label="確認時間">{memoryDateLabel(version.confirmedAt)}</Metadata>
            {version.validUntil ? <Metadata label="有效至">{memoryDateLabel(version.validUntil)}</Metadata> : null}
            <InformationLine label="適用狀態">{factUnavailableReason(version)}</InformationLine>
            {version.reason ? <InformationLine label="原因">{version.reason}</InformationLine> : null}
          </View>)}
        {currentHistory?.hasMore ? workspace.reads?.loadMoreFactHistory ? <AppButton label="載入更多版本" variant="quiet" disabled={!model.online} onPress={() => workspace.reads?.loadMoreFactHistory?.(fact.id, fact.version)} />
          : <Text style={styles.meta}>仍有版本記錄未載入</Text> : null}
      </View> : null}
    </View> : null}
  </View>;
}
function SummaryCard({ summary, emptyReady }: { emptyReady: boolean; summary: Readonly<MemorySummaryView> | null }) {
  const [details, setDetails] = useState(false);
  return <View style={styles.section}><View style={styles.titleRow}><Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>對話摘要</Text><AppStatusBadge label="私人 · 整理內容" /></View>
    {summary ? <><Text selectable style={styles.body}>{summary.text}</Text><Text style={styles.body}>整理自你的對話，供延續脈絡時參考</Text>
      <AppButton label={details ? "收起摘要來源" : "查看摘要來源"} expanded={details} variant="quiet" density="compact" onPress={() => setDetails(value => !value)} />
      {details ? <View style={styles.details}><Metadata label="建立時間">{memoryDateLabel(summary.createdAt)}</Metadata><Metadata label="摘要版本">{summary.version}</Metadata>
        <Metadata label="摘要識別">{summary.id}</Metadata>{summary.previousId ? <Metadata label="前一摘要">{summary.previousId}</Metadata> : null}
        <Metadata label="已涵蓋訊息">{summary.coveredMessageIds.join("、") || "未提供"}</Metadata><Metadata label="最後涵蓋訊息">{summary.lastCoveredMessageId}</Metadata>
        <Text style={styles.body}>摘要是整理出的內容，須與原訊息及事實一併核對。</Text></View> : null}</>
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
function SourceTitle({ title, url, onAttempt, onFailure }: { title: string; url: string | null; onAttempt(): void; onFailure(): void }) {
  const [focused, setFocused] = useState(false), [pressed, setPressed] = useState(false), [hovered, setHovered] = useState(false);
  if (!url) return <Text accessibilityRole="header" aria-level={3} style={styles.cardTitle}>{title}</Text>;
  return <Link href={url} target="_blank" rel="noopener noreferrer" asChild onPress={event => {
    if (Platform.OS === "web") return;
    // The platform opener retains the original failure fallback; web activation
    // belongs to the native anchor, including modified clicks and new tabs.
    event.preventDefault(); onAttempt(); void Linking.openURL(url).catch(onFailure);
  }}><Pressable accessibilityRole="link" accessibilityLabel={Platform.OS === "web" ? `${title}（新分頁開啟來源）` : `開啟來源：${title}`}
    {...(Platform.OS === "web" ? { hrefAttrs: { target: "_blank", rel: "noopener noreferrer" } } : {})}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={StyleSheet.flatten([styles.sourceLink, (pressed || hovered) && styles.sourcePressed, focused && styles.sourceFocused])}>
    <Text accessibilityRole="header" aria-level={3} style={[styles.cardTitle, styles.sourceTitle]}>{title}</Text>
  </Pressable></Link>;
}
function ReferenceEntry({ source }: { source: KnowledgeReferenceView }) {
  const [details, setDetails] = useState(false), [linkFailed, setLinkFailed] = useState(false);
  const sourceUrl = readableReferenceUrl(source.url);
  return <View testID={`memory-reference-source-${source.sourceId}-${source.chunkId}`} style={styles.sourceEntry}>
    <SourceTitle title={source.title} url={sourceUrl} onAttempt={() => setLinkFailed(false)} onFailure={() => setLinkFailed(true)} />
    <Text style={styles.meta}>{source.publisher}</Text>
    {source.section ? <Text style={styles.meta}>{source.section}</Text> : null}
    {source.sourceDateText || source.sourcePublishedAt ? <Text accessibilityLabel={`來源日期：${source.sourceDateText || memoryDateLabel(source.sourcePublishedAt)}`} style={styles.meta}>{source.sourceDateText || memoryDateLabel(source.sourcePublishedAt)}</Text> : null}
    <Text selectable style={styles.body}>{source.sourceExcerpt}</Text>
    {source.usageScope === "internal_noncommercial" ? <Text style={styles.warning}>限內部非商業參考</Text> : null}
    {source.url && !sourceUrl ? <Text style={styles.warning}>來源網址未能安全開啟，可在來源資料核對原文。</Text> : null}
    <AppButton label={details ? "收起來源與版本資料" : "查看來源與版本資料"} expanded={details} variant="quiet" density="compact" onPress={() => setDetails(value => !value)} />
    {linkFailed ? <Text accessibilityRole="alert" style={styles.warning}>暫未能開啟來源，可複製下方網址。</Text> : null}
    {details || linkFailed ? <View style={styles.details}>
      {source.url ? <Metadata label="原文網址">{source.url}</Metadata> : null}<Metadata label="發布時間">{memoryDateLabel(source.sourcePublishedAt)}</Metadata>
      <Metadata label="來源更新">{memoryDateLabel(source.sourceUpdatedAt)}</Metadata><Metadata label="最近覆核">{memoryDateLabel(source.checkedAt)}</Metadata>
      <Metadata label="最近成功取得">{memoryDateLabel(source.lastSuccessfulCheckAt)}</Metadata>{source.validUntil ? <Metadata label="有效至">{memoryDateLabel(source.validUntil)}</Metadata> : null}
      <Metadata label="地區">{source.applicability.region || "未提供"}</Metadata>
      <Metadata label="年齡依據">{source.applicability.ageBasis === "any" ? "未限年齡依據" : source.applicability.ageBasis === "corrected" ? "校正年齡" : "實際年齡"}</Metadata>
      <Metadata label="月齡範圍">{source.applicability.minAgeMonths ?? "未提供下限"} 至 {source.applicability.maxAgeMonths ?? "未提供上限"}{source.applicability.maxAgeMonthsExclusive ? "（不含上限）" : ""}</Metadata>
      {source.applicability.conditions.length ? <Metadata label="適用條件">{source.applicability.conditions.join("；")}</Metadata> : null}
      <Text style={styles.body}>發布機構與覆核日期供追溯來源；內容仍須按適用條件判斷。</Text>
      <Metadata label="來源">{source.sourceId}</Metadata><Metadata label="版本">{source.versionId}</Metadata><Metadata label="片段">{source.chunkId}</Metadata>
      <Metadata label="版本校驗">{source.versionHash}</Metadata><Metadata label="內容校驗">{source.contentHash}</Metadata><Metadata label="取得時間">{memoryDateLabel(source.fetchedAt)}</Metadata>
    </View> : null}
  </View>;
}
function CatalogEntry({ source }: { source: PersonalLibraryItem }) {
  const [details, setDetails] = useState(false), [failedUrl, setFailedUrl] = useState<string | null>(null);
  const sourceUrl = readableReferenceUrl(source.url), linkFailed = sourceUrl !== null && failedUrl === sourceUrl;
  return <View style={styles.sourceEntry} testID={`memory-catalog-source-${source.sourceId}`}>
    <SourceTitle title={source.title} url={sourceUrl} onAttempt={() => setFailedUrl(null)} onFailure={() => setFailedUrl(sourceUrl)} /><Text style={styles.meta}>{source.publisher}</Text>
    <Text style={styles.meta}>覆核於 {memoryDateLabel(source.checkedAt)}</Text>
    {!sourceUrl ? <Text style={styles.warning}>來源網址未能安全開啟，可在來源資料核對原文。</Text> : null}
    <AppButton label={details ? "收起來源資料" : "查看來源資料"} expanded={details} variant="quiet" density="compact" onPress={() => setDetails(value => !value)} />
    {linkFailed ? <Text accessibilityRole="alert" style={styles.warning}>暫未能開啟來源，可複製下方網址。</Text> : null}
    {details || linkFailed ? <View style={styles.details}><Metadata label="原文網址">{source.url}</Metadata><Metadata label="來源更新">{memoryDateLabel(source.sourceUpdatedAt)}</Metadata>
      {source.validUntil ? <Metadata label="有效至">{memoryDateLabel(source.validUntil)}</Metadata> : null}<Metadata label="來源">{source.sourceId}</Metadata><Metadata label="版本">{source.versionId}</Metadata></View> : null}
  </View>;
}
function ReferenceSection({ model, workspace }: { model: MemoryReferenceModel; workspace: MemoryReferenceWorkspaceValue }) {
  const sources = visibleKnowledgeReferences(model.references);
  const catalog = model.references.data?.catalog;
  const groups = [{ key: "official_guidance", title: "官方指引" }, { key: "recent_information", title: "近期資訊" }] as const;
  return <View testID="memory-reference-library" style={styles.referenceLibrary}>
    {!["loading", "error", "unavailable"].includes(model.references.state) ? <Text style={styles.meta}>已載入 {catalog?.length ?? sources.length} 項參考{model.references.data?.hasMore ? " · 尚有更多來源" : ""}</Text> : null}
    {catalog && !["loading", "error", "unavailable"].includes(model.references.state) ? <Text style={styles.body}>這是來源目錄，未逐項判定適用於這位孩子；來源存在亦不代表支持某句回答。</Text> : null}
    {model.references.state !== "ready" ? <ReadNotice read={model.references} unavailable="參考來源暫未提供" /> : null}
    {!["loading", "error", "unavailable"].includes(model.references.state) ? groups.map(group => {
      const entries = sources.filter(source => source.classification === group.key);
      const catalogEntries = catalog?.filter(source => source.classification === group.key);
      return <View key={group.key} style={styles.section}><Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>{group.title}</Text>
        {catalogEntries ? catalogEntries.length ? catalogEntries.map(source => <CatalogEntry key={source.sourceId} source={source} />) : model.references.state === "ready" && model.online ? <EmptyListCard title={`已載入資料中暫無${group.title}`} detail={model.references.data.hasMore ? "仍有來源未載入，可繼續讀取。" : undefined} /> : <BackgroundSurface padded><Text style={styles.meta}>最新來源尚未核對</Text></BackgroundSurface> : entries.length ? entries.map(source => <ReferenceEntry key={`${source.sourceId}:${source.versionId}:${source.chunkId}`} source={source} />)
          : model.references.state === "ready" && model.online ? <EmptyListCard title={`已載入資料中暫無${group.title}`} detail={model.references.data.hasMore ? "仍有來源未載入，可繼續讀取。" : undefined} /> : <BackgroundSurface padded><Text style={styles.meta}>最新來源尚未核對</Text></BackgroundSurface>}
      </View>;
    }) : null}
    {["error", "unavailable", "stale"].includes(model.references.state) && workspace.reads?.refreshContext ? <AppButton label="重新讀取參考" variant="quiet" disabled={!model.online || workspace.reads.referencesBusy} onPress={workspace.reads.refreshContext} /> : null}
    {model.references.data?.hasMore ? workspace.reads?.loadMoreReferences ? <AppButton label="載入更多來源" variant="quiet" disabled={!model.online || workspace.reads.referencesBusy} onPress={workspace.reads.loadMoreReferences} />
      : <BackgroundSurface padded><Text style={styles.meta}>仍有來源未載入</Text></BackgroundSurface> : null}
  </View>;
}
type MemoryReferenceViewProps = { route: MemoryRouteState; onOpenDestination(path: string): void; onRouteChange: (route: MemoryRouteState, mode?: "push" | "replace", beforeNavigate?: () => boolean | void) => void; scrollRef?: RefObject<ScrollView | null>; getScrollPosition?(): number; tabActions?: ReactNode; confirmerDisplay?: MemoryConfirmerDisplay; onPrepareQuestion?: (question: string) => void };
function ScopedMemoryReferenceView({ workspace, confirmerDisplay, onPrepareQuestion, tabActions, route, onRouteChange, onOpenDestination, scrollRef, getScrollPosition }: MemoryReferenceViewProps & { workspace: MemoryReferenceWorkspaceValue }) {
  const { model } = workspace;
  const [summaryOpen, setSummaryOpen] = useState(false);
  const tab = route.tab;
  const setTab = (next: Tab) => { if (next !== tab) onRouteChange({ ...route, tab: next, factId: null, topicId: null }); };
  const tabsId = useId();
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
  const listRef = useRef<View>(null), readerRef = useRef<View>(null), localScroll = useRef<ScrollView>(null);
  const position = useReaderReturn({ scopeKey: JSON.stringify([model.scopeKey, model.access, "memory", tab]), selectedId: tab === "long" ? route.factId : tab === "short" ? route.topicId : null,
    listRef, readerRef, scrollRef: scrollRef ?? localScroll });
  const selectedFact = route.factId ? facts.find(fact => fact.id === route.factId) : null;
  const works = model.shortTerm.data?.works;
  const selectedWork = route.topicId ? works?.find(work => work.id === route.topicId) : null;
  const selectedId = tab === "long" ? route.factId : tab === "short" ? route.topicId : null;
  const readerSurface = useRef<View>(null);
  const focusedReader = useRef<{ scopeKey: string; target: string | null; tab: Tab; node: HTMLElement } | null>(null);
  const { meta: { isCurrent: readerCurrent } } = useReaderPosition();
  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const clear = () => { focusedReader.current = null; };
    const moved = (event: FocusEvent) => { if (!(readerSurface.current as unknown as HTMLElement | null)?.contains(event.target as Node)) clear(); };
    document.addEventListener("focusin", moved); window.addEventListener("blur", clear);
    return () => { document.removeEventListener("focusin", moved); window.removeEventListener("blur", clear); clear(); };
  }, [model.scopeKey]);
  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const before = focusedReader.current;
    if (!before || before.node.isConnected) return;
    focusedReader.current = null;
    if (before.tab !== tab || before.scopeKey !== model.scopeKey || before.target !== selectedId || !readerCurrent() || document.activeElement !== document.body) return;
    (readerRef.current as unknown as HTMLElement | null)?.focus({ preventScroll: true });
  }, [model.scopeKey, tab, selectedId, selectedFact, selectedWork, readerCurrent]);

  function renderFact(fact: Readonly<MemoryFactView>) {
    const next = { ...route, tab: "long" as const, factId: fact.id, topicId: null };
    return <ReadTargetLink key={fact.id} ref={tab === "long" ? node => position.rowRef(fact.id, node) : undefined} href={{ pathname: "/memory", params: serializeMemoryRoute(next) }}
      label={`查看${fact.key}，${factStatusLabels[fact.status]}，${visibilityLabels[fact.visibility]}，版本 ${fact.version}`} style={styles.factRow}
      onOpen={() => onRouteChange(next, "push", () => position.remember(fact.id, getScrollPosition?.()))}>
      <Text style={styles.factRowTitle}>{fact.key}</Text><Text numberOfLines={2} style={styles.body}>{fact.content}</Text>
      <Text style={styles.meta}>{factStatusLabels[fact.status]} · {visibilityLabels[fact.visibility]} · 版本 {fact.version}</Text>
    </ReadTargetLink>;
  }
  return <View style={styles.root}>
    <WorkspaceSwitch<Tab> id={tabsId} label="記憶與參考分類" items={tabs} value={tab} onChange={setTab} />
    {tabActions ? <View style={styles.managementBar}><Text style={styles.meta}>目前孩子：{model.childName}</Text><View style={styles.actions}>{tabActions}</View></View> : null}
    <AppTabPanel tabsId={tabsId} tabKey="short" active={tab === "short"}><View style={styles.section}>
      <View testID="memory-work-index" aria-hidden={!!route.topicId} style={[styles.section, !!route.topicId && styles.hidden]}>
        <View ref={tab === "short" ? listRef : undefined} tabIndex={-1} accessibilityLabel="目前工作清單" style={styles.section}>
          <ReadNotice read={model.shortTerm} unavailable="目前工作脈絡暫未提供" online={model.online} emptyTitle="目前暫無可顯示的工作脈絡" empty={!works?.length && model.shortTerm.data?.messages.length === 0}>
            <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>目前工作</Text>
            <View style={styles.factList}>{works?.map(work => {
              const next = { ...route, tab: "short" as const, topicId: work.id, factId: null };
              return <ReadTargetLink key={work.id} ref={tab === "short" ? node => position.rowRef(work.id, node) : undefined} href={{ pathname: "/memory", params: serializeMemoryRoute(next) }}
                label={`查看工作：${work.goal}，${personalWorkStatusLabels[work.status]}，版本 ${work.version}`} style={styles.factRow}
                onOpen={() => onRouteChange(next, "push", () => position.remember(work.id, getScrollPosition?.()))}>
                <Text style={styles.factRowTitle}>{work.goal}</Text>{work.focus ? <Text numberOfLines={2} style={styles.body}>{work.focus}</Text> : null}
                <Text style={styles.meta}>{personalWorkStatusLabels[work.status]} · 版本 {work.version} · {memoryDateLabel(work.updatedAt)}</Text>
              </ReadTargetLink>;
            })}</View>
            {model.shortTerm.data?.messages.map(message => <View key={message.id} style={styles.section}><Text style={styles.meta}>{message.role === "user" ? "你的訊息" : "助手回覆"}</Text><Text selectable style={styles.body}>{message.text}</Text></View>)}
            {works ? <Text style={styles.body}>已載入 {works.length} 項工作{model.shortTerm.data?.hasMoreWorks ? "；仍有工作未載入。" : "。"}</Text> : null}
            {model.shortTerm.data?.hasMoreWorks ? workspace.reads?.loadMoreWork ? <AppButton label="載入更多工作" variant="quiet" disabled={!model.online || workspace.reads.workBusy} onPress={workspace.reads.loadMoreWork} /> : <Text style={styles.body}>仍有工作未載入</Text> : null}
          </ReadNotice>
        </View>
      </View>
      {route.topicId ? <View ref={tab === "short" ? readerSurface : undefined} testID="memory-work-reader" style={styles.factReader} onFocus={event => { if (Platform.OS === "web") focusedReader.current = { scopeKey: model.scopeKey, target: route.topicId, tab: "short", node: event.target as unknown as HTMLElement }; }}>
        <ReadTargetLink href={{ pathname: "/memory", params: serializeMemoryRoute({ ...route, topicId: null }) }} label="返回工作清單" style={styles.returnLink}
          onOpen={() => onRouteChange({ ...route, topicId: null }, "replace", position.returning)}><Text style={styles.linkText}>返回工作清單</Text></ReadTargetLink>
        <View ref={tab === "short" ? readerRef : undefined} tabIndex={-1} accessibilityLabel={selectedWork?.goal ?? "工作原文"} testID="memory-work-reader-heading"><Text accessibilityRole="header" aria-level={2} style={styles.readerTitle}>{selectedWork?.goal ?? "工作原文"}</Text></View>
        {selectedWork ? <><ReadNotice read={model.shortTerm} unavailable="目前工作脈絡暫未提供" />
          <PersistentWorkReader work={selectedWork} onNavigate={path => { if (current.current === workspace) onOpenDestination(path); }} onContinue={onPrepareQuestion ? work => {
            if (current.current !== workspace || !current.current.model.shortTerm.data?.works?.some(item => item.id === work.id && item.version === work.version)) return;
            onPrepareQuestion(personalWorkQuestion(model.childName, work));
          } : undefined} /></> : <ReadStateNotice state={model.shortTerm.state === "loading" ? "loading" : model.shortTerm.state === "error" ? "error" : "unavailable"}
            message={model.shortTerm.state === "loading" ? "正在讀取這項工作…" : model.shortTerm.state === "error" ? "暫時讀不到這項工作，請重新讀取。" : "這項工作不在目前可讀取的清單；沒有代選其他工作。"} />}
      </View> : null}
      {["error", "unavailable", "stale"].includes(model.shortTerm.state) && workspace.reads?.refreshContext ? <AppButton label="重新讀取工作脈絡" variant="quiet" disabled={!model.online || workspace.reads.workBusy} onPress={workspace.reads.refreshContext} /> : null}
    </View></AppTabPanel>
    <AppTabPanel tabsId={tabsId} tabKey="long" active={tab === "long"}><View style={styles.section}>
      <View testID="memory-facts-index" aria-hidden={!!route.factId} style={[styles.section, !!route.factId && styles.hidden]}>
        <View ref={tab === "long" ? listRef : undefined} tabIndex={-1} accessibilityLabel="記憶清單" style={styles.section}>
          <ReadNotice read={model.longTerm} unavailable="記憶資料暫未提供">
            <View style={styles.section}><Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>已確認事實</Text>
              {confirmed.length ? <View style={styles.factList}>{confirmed.map(renderFact)}</View> : model.longTerm.state === "ready" && model.online ? <EmptyListCard title="已載入資料中沒有已確認事實" detail={model.longTerm.data.hasMoreFacts ? "仍有記憶未載入，可繼續讀取。" : undefined} /> : <Text style={styles.body}>已確認事實尚未重新核對</Text>}
            </View>
            {other.length ? <View style={styles.section}><Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>待確認與停用資料</Text><View style={styles.factList}>{other.map(renderFact)}</View></View> : null}
            {model.longTerm.data ? <Text style={styles.body}>已載入 {facts.length} 項記憶{model.longTerm.data.hasMoreFacts ? "；仍有內容未載入。" : "。"}</Text> : null}
            {model.longTerm.data?.hasMoreFacts ? workspace.reads?.loadMoreFacts ? <AppButton label="載入更多記憶" variant="quiet" disabled={!model.online} onPress={workspace.reads.loadMoreFacts} />
              : <Text style={styles.body}>仍有記憶未載入</Text> : null}
            {model.longTerm.data?.summary ? <View style={styles.section}>
              <AppButton label={summaryOpen ? "收起對話摘要" : "查看對話摘要"} expanded={summaryOpen} variant="quiet" onPress={() => setSummaryOpen(value => !value)} />
              {summaryOpen ? <View testID="memory-summary-content"><Text style={styles.body}>摘要不是已確認事實；需要時回到原訊息核對。</Text><SummaryCard key={`${model.longTerm.data.summary.id}:${model.longTerm.data.summary.version}`} summary={model.longTerm.data.summary} emptyReady={model.longTerm.state === "ready" && model.online} /></View> : null}
            </View> : <Text style={styles.body}>{model.longTerm.state === "ready" && model.online ? "目前沒有可用摘要" : "摘要尚未重新核對"}</Text>}
          </ReadNotice>
        </View>
      </View>
      {route.factId ? <View ref={tab === "long" ? readerSurface : undefined} testID="memory-fact-reader" style={styles.factReader} onFocus={event => { if (Platform.OS === "web") focusedReader.current = { scopeKey: model.scopeKey, target: route.factId, tab: "long", node: event.target as unknown as HTMLElement }; }}>
        <ReadTargetLink href={{ pathname: "/memory", params: serializeMemoryRoute({ ...route, factId: null }) }} label="返回記憶清單" style={styles.returnLink}
          onOpen={() => onRouteChange({ ...route, factId: null }, "replace", position.returning)}><Text style={styles.linkText}>返回記憶清單</Text></ReadTargetLink>
        <View ref={tab === "long" ? readerRef : undefined} tabIndex={-1} accessibilityLabel={selectedFact?.key ?? "記憶原文"} testID="memory-fact-reader-heading">
          <Text accessibilityRole="header" aria-level={2} style={styles.readerTitle}>{selectedFact?.key ?? "記憶原文"}</Text>
        </View>
        {selectedFact ? <><ReadNotice read={model.longTerm} unavailable="記憶資料暫未提供" />
          <FactReader key={selectedFact.id} fact={selectedFact} model={model} workspace={workspace} confirmerDisplay={confirmerDisplay} onQuestion={onQuestion} /></>
          : <ReadStateNotice state={model.longTerm.state === "loading" ? "loading" : model.longTerm.state === "error" ? "error" : "unavailable"}
              message={model.longTerm.state === "loading" ? "正在讀取這項記憶…" : model.longTerm.state === "error" ? "暫時讀不到這項記憶，請重新讀取。" : "這項記憶不在目前可讀取的清單。它可能未載入、已刪除或不可讀；沒有代選其他記憶。"} />}
      </View> : null}
    </View></AppTabPanel>
    <AppTabPanel tabsId={tabsId} tabKey="references" active={tab === "references"}><ReferenceSection model={model} workspace={workspace} /></AppTabPanel>
  </View>;
}
export function MemoryReferenceView({ confirmerDisplay, onPrepareQuestion, tabActions, route, onRouteChange, onOpenDestination, scrollRef, getScrollPosition }: MemoryReferenceViewProps) {
  const workspace = useMemoryReferenceWorkspace();
  const currentDisplay = workspace && confirmerDisplay?.scopeKey === workspace.scopeKey && confirmerDisplay.childId === workspace.model.childId ? confirmerDisplay : undefined;
  return workspace ? <ScopedMemoryReferenceView key={workspace.scopeKey} workspace={workspace} route={route} onRouteChange={onRouteChange} onOpenDestination={onOpenDestination} scrollRef={scrollRef} getScrollPosition={getScrollPosition} tabActions={tabActions} confirmerDisplay={currentDisplay} onPrepareQuestion={onPrepareQuestion} />
    : <ReadStateNotice state="unavailable" title="暫不能查看記憶與參考" message="請先選擇有權查看的孩子。">{tabActions}</ReadStateNotice>;
}
const styles = StyleSheet.create({
  managementBar: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: spacing.md },
  root: { width: "100%", minWidth: 0, gap: spacing.lg },
  section: { gap: spacing.md, minWidth: 0 },
  sectionTitle: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section },
  hidden: { display: "none" }, factList: { minWidth: 0 },
  factRow: { minHeight: 64, paddingVertical: spacing.md, gap: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.line, minWidth: 0 },
  factRowTitle: { fontFamily: chineseFont, color: colors.ink, ...readingType.body, fontWeight: "600" },
  factReader: { width: "100%", maxWidth: 760, alignSelf: "flex-start", gap: spacing.lg, minWidth: 0 },
  factBody: { gap: spacing.md, minWidth: 0 },
  readerTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 24, lineHeight: 34, fontWeight: "700" },
  returnLink: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  linkText: { fontFamily: chineseFont, color: colors.teal, ...readingType.body, textDecorationLine: "underline" },
  referenceLibrary: { width: "100%", maxWidth: 760, gap: spacing.lg, minWidth: 0 },
  sourceEntry: { borderTopWidth: 0, borderBottomWidth: 1, borderBottomColor: colors.line, paddingBottom: spacing.lg, gap: spacing.sm, minWidth: 0 },
  sourceLink: { minHeight: 48, justifyContent: "center", minWidth: 0, maxWidth: "100%" },
  sourceTitle: { color: colors.teal, textDecorationLine: "underline" },
  sourcePressed: { backgroundColor: colors.pressedOverlay },
  sourceFocused: { outlineWidth: 2, outlineStyle: "solid", outlineColor: colors.ink, outlineOffset: 2 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", flexWrap: "wrap", gap: spacing.sm, minWidth: 0 },
  cardTitle: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section, flexShrink: 1 },
  factContent: { fontFamily: chineseFont, color: colors.ink, fontSize: 18, lineHeight: 28, fontWeight: "400", flexShrink: 1 },
  factContext: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, minWidth: 0 },
  metadataLine: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minWidth: 0, flexShrink: 1 },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.body, flexShrink: 1 },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, flexShrink: 1 },
  warning: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.body, flexShrink: 1 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, minWidth: 0 },
  details: { borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.sm, gap: spacing.sm, minWidth: 0 },
  history: { gap: spacing.md, minWidth: 0 }, historyEntry: { borderLeftWidth: 2, borderLeftColor: colors.sage, paddingLeft: spacing.md, gap: spacing.xs, minWidth: 0 },
});
