import { JournalAside, JournalColumns, JournalMain, JournalSection } from "../journal/JournalLayout";
import { BackgroundSurface } from "../appearance/BackgroundSurface";
import { EmptyListCard } from "../EmptyListCard";
import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import type { Href } from "expo-router";
import type { MemoryReaderNavigation } from "../../navigation/useMemoryRouteSelection";
import { useMemoryReaderDisclosures } from "../../navigation/MemoryReaderViewState";
import { MemoryTopicLink } from "./MemoryTopicLink";
import type { PersonalLibraryItem } from "../../../../src/shared/personal-library";
import { historyMessageQuestion, personalWorkQuestion } from "../../history-view-model";
import { PersistentWorkCards } from "../history/PersistentWorkCards";
import { HistoryMessageDetail } from "../history/HistoryMessageDetail";
import { Text } from "react-native-paper";
import { factIsApplicable, factSourceLabel, factStatusLabels, factUnavailableReason, visibilityLabels, type MemoryFactView, type MemorySummaryView } from "../../memory-view-model";
import { memoryClarificationQuestion, memoryConfirmerLabel, memoryDateLabel, visibleKnowledgeReferences, visibleMemoryFacts, visibleMemoryHistory,
  type KnowledgeReferenceView, type MemoryConfirmerDisplay, type MemoryReadProjection, type MemoryReferenceModel, type MemoryReferenceWorkspaceValue } from "../../memory-reference-view-model";
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
};
type FactDisclosure = { details: boolean; historyOpen: boolean };
const closedDisclosure: FactDisclosure = { details: false, historyOpen: false };
function FactCard({ fact, model, workspace, confirmerDisplay, onQuestion, disclosure, onDisclosure }: {
  disclosure: FactDisclosure; onDisclosure(next: FactDisclosure): void;
  fact: Readonly<MemoryFactView>; model: MemoryReferenceModel; workspace: MemoryReferenceWorkspaceValue; onQuestion?: (fact: Readonly<MemoryFactView>) => void;
  confirmerDisplay?: MemoryConfirmerDisplay;
}) {
  const { details, historyOpen } = disclosure;
  const history = model.longTerm.data?.histories[fact.id];
  const versions = visibleMemoryHistory(model, fact);
  const currentHistory = history?.factVersion === fact.version ? history : undefined;
  const available = factIsApplicable(fact);
  const source = factSources[fact.source.kind];
  return <View testID={`memory-reference-fact-${fact.id}`} style={styles.card}>
    <View style={styles.titleRow}><Text accessibilityRole="header" aria-level={3} style={styles.factTopic}>{fact.key}</Text>
      <AppStatusBadge label={factStatusLabels[fact.status]} tone={fact.status === "confirmed" && available ? "success" : fact.status === "candidate" ? "warning" : "neutral"} /></View>
    <Text selectable style={styles.factContent}>{fact.content}</Text>
    <View style={styles.factContext}>
      <View style={styles.metadataLine}><AppIcon name={fact.visibility === "private" ? "lock-outline" : "account-group-outline"} size={15} /><Text accessibilityLabel={`可見範圍：${visibilityLabels[fact.visibility]}`} style={styles.meta}>{visibilityLabels[fact.visibility]}</Text></View>
      <Pressable testID={`memory-fact-source-${fact.id}`} accessibilityRole="button" accessibilityLabel={`${details ? "收起" : "查看"}來源：${source.label}`} accessibilityState={{ expanded: details }} aria-expanded={details}
        onPress={() => { onDisclosure({ details: !details, historyOpen: false }); }} style={({ pressed }) => [styles.sourceTrigger, pressed && styles.sourcePressed]}>
        <AppIcon name={source.icon} size={15} color={colors.deepTeal} /><Text style={styles.sourceLabel}>{source.label}</Text><AppIcon name={details ? "chevron-up" : "chevron-down"} size={14} color={colors.deepTeal} />
      </Pressable>
    </View>
    {!available ? <Text style={styles.warning}>{factUnavailableReason(fact)}</Text> : null}
    {onQuestion ? <View style={styles.actions}><AppButton label="請 Agent 核對" variant="quiet" density="compact" onPress={() => onQuestion(fact)} /></View> : null}
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
        onDisclosure({ details, historyOpen: !historyOpen });
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
/** One active body; the scoped parent retains only reversible disclosure booleans. */
function MemoryFactReader({ facts, model, workspace, confirmerDisplay, onQuestion, width, navigation, disclosures, setDisclosure }: {
  facts: readonly Readonly<MemoryFactView>[]; model: MemoryReferenceModel; workspace: MemoryReferenceWorkspaceValue;
  confirmerDisplay?: MemoryConfirmerDisplay; onQuestion?: (fact: Readonly<MemoryFactView>) => void; width: number;
  navigation: MemoryReaderNavigation; disclosures: Record<string, FactDisclosure & { version: number }>;
  setDisclosure(fact: Readonly<MemoryFactView>, next: FactDisclosure): void;
}) {
  const selected = navigation.factId === null ? facts.find(fact => fact.status === "confirmed") ?? facts[0] : facts.find(fact => fact.id === navigation.factId);
  const groups = [{ title: "已確認", facts: facts.filter(fact => fact.status === "confirmed") }, { title: "待核對與停用", facts: facts.filter(fact => fact.status !== "confirmed") }];
  const retained = selected ? disclosures[selected.id] : undefined;
  return <JournalColumns style={styles.factWorkspace}>
    <JournalAside style={styles.topicIndex}>
      {width < 720 ? <AppSelect label="記憶主題" value={selected?.id ?? ""} options={facts.map(fact => ({ value: fact.id, label: fact.status === "confirmed" ? fact.key : `${fact.key}（${factStatusLabels[fact.status]}）` }))} onChange={() => {}} onSelectionClosed={navigation.selectFact} />
        : <View accessibilityLabel="記憶主題" style={styles.topicList}>{groups.filter(group => group.facts.length).map(group => <View key={group.title}>
          <Text style={styles.indexGroup}>{group.title}</Text>{group.facts.map(fact => <MemoryTopicLink key={fact.id} href={navigation.href(fact.id)} title={fact.key}
            detail={fact.status === "confirmed" ? fact.content : factStatusLabels[fact.status]} selected={selected?.id === fact.id} onOpen={() => navigation.selectFact(fact.id)} />)}
        </View>)}</View>}
    </JournalAside>
    <JournalMain style={styles.factReader}>{selected ? <FactCard key={`${selected.id}:${selected.version}`} fact={selected} model={model} workspace={workspace}
      disclosure={retained?.version === selected.version ? retained : closedDisclosure} onDisclosure={next => setDisclosure(selected, next)} confirmerDisplay={confirmerDisplay} onQuestion={onQuestion} />
      : <ReadStateNotice state="unavailable" title="這項記憶未在目前載入的資料中" message="可選另一個主題，或繼續讀取尚未載入的記憶；不會改選其他事實。" />}</JournalMain>
  </JournalColumns>;
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
type MemoryReferenceViewProps = { navigation: MemoryReaderNavigation; tabActions?: ReactNode; confirmerDisplay?: MemoryConfirmerDisplay; onPrepareQuestion?: (question: string) => void };
function ScopedMemoryReferenceView({ workspace, confirmerDisplay, onPrepareQuestion, tabActions, navigation }: MemoryReferenceViewProps & { workspace: MemoryReferenceWorkspaceValue }) {
  const { model } = workspace;
  const tab = navigation.tab;
  const facts = useMemo(() => visibleMemoryFacts(model), [model]);
  const { disclosures, setDisclosure: rememberDisclosure } = useMemoryReaderDisclosures(workspace.scopeKey, model.longTerm.data ? facts : null);
  const tabsId = useId(), container = useContainerWidth();
  const current = useRef<MemoryReferenceWorkspaceValue | null>(workspace);
  current.current = workspace;
  useLayoutEffect(() => {
    current.current = workspace;
    return () => { if (current.current === workspace) current.current = null; };
  }, [workspace]);
  const onQuestion = onPrepareQuestion ? (fact: Readonly<MemoryFactView>) => {
    // A stale card callback cannot use the next child or a replaced fact version.
    if (current.current !== workspace || !visibleMemoryFacts(current.current.model).some(item => item.id === fact.id && item.version === fact.version)) return;
    onPrepareQuestion(memoryClarificationQuestion(model.childName, fact));
  } : undefined;
  function setDisclosure(fact: Readonly<MemoryFactView>, next: FactDisclosure) {
    if (current.current !== workspace || !navigation.active || !visibleMemoryFacts(workspace.model).some(item => item.id === fact.id && item.version === fact.version)) return;
    rememberDisclosure(fact.id, fact.version, next);
  }
  return <View ref={container.ref} onLayout={container.onLayout} style={styles.root}>
    <TabToolbar actions={tabActions} stacked={container.width < 480}><UnderlineTabs id={tabsId} label="記憶與參考分類" items={tabs} value={tab} onChange={navigation.changeTab} /></TabToolbar>
    <AppTabPanel tabsId={tabsId} tabKey="short" active={tab === "short"}><View style={styles.section}>
      <ReadNotice read={model.shortTerm} unavailable="目前工作脈絡暫未提供" online={model.online} emptyTitle="目前暫無可顯示的工作脈絡" empty={model.shortTerm.data?.works ? model.shortTerm.data.works.length === 0 && model.shortTerm.data.messages.length === 0 : model.shortTerm.data?.messages.length === 0}>
        {model.shortTerm.data?.works ? <PersistentWorkCards items={model.shortTerm.data.works} online={model.online} busy={workspace.reads?.messageBusy}
          onMessage={workspace.reads?.readWorkMessage ? id => {
            if (current.current !== workspace || !current.current.model.shortTerm.data?.works?.some(work => work.sourceMessageIds.includes(id))) return;
            workspace.reads?.readWorkMessage?.(id);
          } : undefined}
          onResource={path => { if (current.current === workspace) navigation.openResource(path as Href); }}
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
        <JournalSection title="記憶原文">
          {tab === "long" && navigation.active ? facts.length ? <MemoryFactReader facts={facts} navigation={navigation} disclosures={disclosures} setDisclosure={setDisclosure} model={model} workspace={workspace} confirmerDisplay={confirmerDisplay} onQuestion={onQuestion} width={container.width} /> : model.longTerm.state === "ready" && model.online ? <EmptyListCard title="已載入資料中沒有記憶" detail={model.longTerm.data.hasMoreFacts ? "仍有記憶未載入，可繼續讀取。" : undefined} /> : <BackgroundSurface padded><Text style={styles.meta}>記憶尚未重新核對</Text></BackgroundSurface> : null}
        </JournalSection>
        {model.longTerm.data?.hasMoreFacts ? workspace.reads?.loadMoreFacts ? <AppButton label="載入更多記憶" variant="quiet" disabled={!model.online} onPress={workspace.reads.loadMoreFacts} />
          : <BackgroundSurface padded><Text style={styles.meta}>仍有記憶未載入</Text></BackgroundSurface> : null}
        <SummaryCard key={`${model.longTerm.data?.summary?.id}:${model.longTerm.data?.summary?.version}`} summary={model.longTerm.data?.summary ?? null} emptyReady={model.longTerm.state === "ready" && model.online} />

      </ReadNotice>
    </View></AppTabPanel>
    <AppTabPanel tabsId={tabsId} tabKey="references" active={tab === "references"}><ReferenceSection model={model} workspace={workspace} /></AppTabPanel>
  </View>;
}
export function MemoryReferenceView({ confirmerDisplay, onPrepareQuestion, tabActions, navigation }: MemoryReferenceViewProps) {
  const workspace = useMemoryReferenceWorkspace();
  const currentDisplay = workspace && confirmerDisplay?.scopeKey === workspace.scopeKey && confirmerDisplay.childId === workspace.model.childId ? confirmerDisplay : undefined;
  return workspace ? <ScopedMemoryReferenceView key={workspace.scopeKey} workspace={workspace} navigation={navigation} tabActions={tabActions} confirmerDisplay={currentDisplay} onPrepareQuestion={onPrepareQuestion} />
    : <ReadStateNotice state="unavailable" title="暫不能查看記憶與參考" message="請先選擇有權查看的孩子。">{tabActions}</ReadStateNotice>;
}
const styles = StyleSheet.create({
  factWorkspace: { gap: spacing.xl },
  topicIndex: { flexBasis: 220, flexGrow: 1 }, factReader: { flexBasis: 460, flexGrow: 3, paddingHorizontal: spacing.lg, backgroundColor: colors.white },
  topicList: { gap: spacing.lg, minWidth: 0 },
  indexGroup: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, paddingHorizontal: spacing.sm },
  root: { width: "100%", minWidth: 0, gap: spacing.lg },
  section: { gap: spacing.md, minWidth: 0 },
  sectionTitle: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section },
  card: { borderBottomWidth: 1, borderColor: colors.line, paddingVertical: spacing.lg, gap: spacing.md, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", flexWrap: "wrap", gap: spacing.sm, minWidth: 0 },
  cardTitle: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section, flexShrink: 1 },
  factTopic: { fontFamily: chineseFont, color: colors.deepTeal, ...readingType.tool, fontWeight: "700", flex: 1, minWidth: 0 },
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
