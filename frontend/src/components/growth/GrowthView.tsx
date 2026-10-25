import { GROWTH_KNOWLEDGE_NOTICES } from "../../../../src/shared/growth";
import { useContainerWidth } from "../useContainerWidth";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { ReadStateNotice } from "../ReadStateNotice";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { View, type ScrollView } from "react-native";
import { Text } from "react-native-paper";
import type { GrowthActions,GrowthViewModel } from "../../growth-view-model";
import { WorkspaceSwitch } from "../workspace/WorkspaceSwitch";
import { Workspace } from "../workspace/Workspace";
import { PageFrame } from "../PageFrame";
import { EmptyListCard } from "../EmptyListCard";
import { BackgroundSurface } from "../appearance/BackgroundSurface";
import { AppButton,AppSelect,AppTabPanel,SectionCard,TabToolbar,UnderlineTabs } from "../ui";
import { mobileLayout } from "../../theme";
import { GrowthConcernIndex, GrowthConcernTimeline } from "./GrowthConcernTimeline";
import { PreparationWorkspace } from "../preparations/PreparationWorkspace";
import { GrowthConcernChangeNotice } from "./GrowthConcernChangeNotice";
import { GrowthConcernActions } from "./GrowthConcernActions";
import { GrowthArchiveConcernButton } from "./GrowthArchiveConcernButton";
import { GrowthConcernManualFallback } from "./GrowthConcernManualFallback";
import { GrowthOperationRecovery } from "./GrowthOperationRecovery";
import { growthRefreshNotice } from "../../growth-view-model";
import { growthStyles as s } from "./growth-styles";

export function GrowthView({model,actions,onTask,onRecord,onHistory,onChat,onPrepareQuestion,onPreparationHistory,previewTools,managementTools,tab="concerns",onTabChange}:{
  model:GrowthViewModel;actions:GrowthActions;onTask:(id:string)=>void;onRecord?:(id?:string)=>void;onHistory?:()=>void;onChat?:()=>void;
  onPrepareQuestion?:(question:string)=>void;onPreparationHistory?:()=>void;previewTools?:React.ReactNode;managementTools?:React.ReactNode;
  tab?:"concerns"|"preparation";onTabChange:(tab:"concerns"|"preparation")=>void;
}){
  const containerLayout = useContainerWidth();
  const wide = containerLayout.width >= 880;
  const compact = containerLayout.width < mobileLayout.breakpoint;
  const scrollRef = useRef<ScrollView>(null), scrollPosition = useRef(0);
  useLayoutEffect(() => { scrollPosition.current = 0; scrollRef.current?.scrollTo({ y: 0, animated: false }); }, [model.scopeKey, tab]);
  const page=model.access === "lost" ? null : model.page;
  const [selectedConcern, setSelectedConcern] = useState<string | null>(null);
  const concerns = page?.concerns?.state === "ready" ? page.concerns.items.filter(item => item.childId === model.childId) : [];
  const listedConcerns = concerns.filter(item => item.status !== "closed");
  const concern = listedConcerns.find(item => item.id === selectedConcern) ?? listedConcerns[0] ?? null;
  useEffect(() => { setSelectedConcern(null); }, [model.scopeKey, model.access === "lost"]);
  const refreshed = model.notice === growthRefreshNotice;
  const showLoading = model.load === "loading" && !page;
  const showStatus = !model.online || model.access !== "editable" || model.load === "error" || !!model.notice && !refreshed || model.refreshPending;
  const refreshButton = model.pending || model.load === "error" || model.refreshPending || model.operation === "conflict" ? <AppButton label={compact ? model.pending ? "核對原操作" : "重讀" : model.pending ? "重讀並核對原操作" : "重新讀取"} accessibilityLabel={model.pending?"重讀並核對原操作":"重讀成長關注並保留草稿"} variant="secondary" density="compact" style={compact ? undefined : s.headerRefreshButton} disabled={model.busy||!model.online||model.access==="lost"} onPress={actions.refresh} /> : null;
  const unavailableAdvice = !!concern && page?.items.some(item => concern.attentionIds.includes(item.id) && !item.sourceAvailable);
  const sourceNotice = unavailableAdvice && page?.notices.includes(GROWTH_KNOWLEDGE_NOTICES.region)
    ? "目前未能將已確認地區用於建議篩選；原有資料已保留。"
    : unavailableAdvice && page?.notices.includes(GROWTH_KNOWLEDGE_NOTICES.age) ? "建議來源只適用於 0–10 歲。"
    : unavailableAdvice && page?.notices.includes("首批關注只適用香港；沒有把香港時程套用至其他地區。") ? "這項建議只適用於香港地區。"
    : unavailableAdvice && page?.notices.includes("需要有效的出生日期才可套用本批年齡規則；約數年齡會保留，沒有推算精準提醒窗口。") ? "年齡建議未能核對，請核對孩子出生日期。" : null;
  const evaluationFailed = page?.notices.includes("背景評估已達有限重試上限，需核查故障；沒有假稱已完成。");
  return <PageFrame scrollRef={scrollRef} scrollTestID="growth-scroll" density="compact" title="關注" onScroll={event => { scrollPosition.current = event.nativeEvent.contentOffset.y; }}>
    {tab === "concerns" ? <>
    <StatusAnnouncement eventKey={`${model.operation}:${model.notice}`} message={refreshed ? "" : model.notice} urgent={model.operation === "failed"} />
    <StatusAnnouncement eventKey={model.access} message={model.access === "lost" ? "已無權存取；舊資料及未提交內容已清除。" : ""} urgent={model.access === "lost"} />
    {showLoading ? <ReadStateNotice state="loading" scopeKey={model.scopeKey} message="正在讀取關注…" /> : null}
    {showStatus ? <BackgroundSurface padded style={s.smallStack} testID="growth-status-surface">
      {!model.online?<Text style={s.warning}>目前離線；資料未代表最新狀態，不能提交，沒有離線操作佇列。</Text>:null}
      {model.access==="read_only"?<Text style={s.meta}>目前只有閱讀權限；不能更改關注、接受候選或確認近況。</Text>:null}
      {model.access==="lost"?<Text style={s.warning}>已無權存取；舊關注、草稿及操作已清除。</Text>:null}
      {model.load==="error"&&!model.notice?<Text style={s.warning}>尚未成功讀取目前狀態；保留的草稿不能提交。</Text>:null}
      {model.notice && !refreshed?<Text style={model.operation==="unknown"||model.operation==="conflict"||model.operation==="failed"?s.warning:s.body}>{model.notice}</Text>:null}
      {model.refreshPending?<Text style={s.meta}>有更新等候核對，未提交草稿沒有被自動覆寫。</Text>:null}
    </BackgroundSurface> : null}
    {model.dirty?<SectionCard testID="growth-drafts"><Text style={s.body}>未送出的草稿及確認保留原版本；重新讀取不會自動覆寫。</Text>
      {model.missingTargets.length ? <Text style={s.warning}>部分草稿的來源未能核對，相關操作已暫停。</Text> : null}
      <AppButton label="放棄草稿並重新核對" variant="quiet" disabled={model.busy||!model.online||model.access==="lost"} onPress={actions.askDiscard} />
      {model.discardAsked?<><Text style={s.warning}>會清除未送出的表單。結果未知的原請求仍會保留並鎖定。</Text><AppButton label="確認放棄未提交草稿" variant="secondary" disabled={model.busy||!model.online||model.access==="lost"} onPress={actions.discardDrafts} /></>:null}
    </SectionCard>:null}
    <GrowthOperationRecovery model={model} actions={actions} />
    </> : null}
    <View ref={containerLayout.ref} onLayout={containerLayout.onLayout} style={s.workspace}>
      <TabToolbar testID="growth-tabs-toolbar" actions={tab === "concerns" ? <View style={s.headerActions} testID="growth-refresh-toolbar">
        {refreshButton}
        {onHistory ? <AppButton label={compact ? "歷史" : "查看關注歷史"} accessibilityLabel="查看關注歷史" variant="secondary" density="compact" onPress={onHistory} /> : null}
      </View> : undefined}>
        <WorkspaceSwitch id="growth-workspace" label="關注與準備" items={[{key: "concerns", label: "持續關注", description: "追蹤同一主題的變化與跟進"}, {key: "preparation", label: "行前準備", description: "把問題、物品與步驟整理成清單"}]} value={tab} onChange={onTabChange} />
      </TabToolbar>
      <AppTabPanel tabsId="growth-workspace" tabKey="concerns" active={tab === "concerns"} style={s.stack}>
        {tab === "concerns" ? <>
        <GrowthConcernChangeNotice model={model} actions={actions} />
        {evaluationFailed ? <BackgroundSurface padded><Text style={s.warning}>成長建議暫停更新。</Text></BackgroundSurface> : null}
        {page ? <>
          <View style={s.stack}>
            {listedConcerns.length ? <BackgroundSurface padded style={s.watchlist} testID="growth-index-surface">
              <Text accessibilityRole="header" style={s.title}>追蹤中的主題</Text>
              {wide ? <GrowthConcernIndex items={listedConcerns} selectedId={concern?.id ?? null} onSelect={setSelectedConcern} />
                : listedConcerns.length ? <AppSelect label="選擇關注" showLabel={false} value={concern?.id ?? ""} options={listedConcerns.map(item => ({value: item.id, label: item.title}))} onChange={setSelectedConcern} /> : null}
            </BackgroundSurface> : null}
            <BackgroundSurface padded style={s.readingWorkspace} testID="growth-detail-surface">
              {sourceNotice ? <Text style={s.warning}>{sourceNotice}</Text> : null}
              <GrowthConcernActions scopeKey={model.scopeKey} hasManagement={!!managementTools || !!(concern && page.canManage)}
                primary={<>
                  {onChat && (concern || page.concerns?.state === "ready" && model.load !== "error" && model.online) ? <AppButton label={concern ? "與助手跟進" : "與助手討論"} variant="primary" density="compact" disabled={!model.online} onPress={onChat} /> : null}
                  <GrowthConcernManualFallback model={model} actions={actions} concern={concern} />
                </>}>
                {managementTools}
                {concern && page.canManage ? <GrowthArchiveConcernButton concern={concern} scopeKey={model.scopeKey} authorityVersion={page.authorityVersion}
                  disabled={model.locked || model.dirty || page.concerns?.state !== "ready"}
                  onConfirm={() => actions.archiveConcern(concern.id, concern.version, page.authorityVersion)} /> : null}
              </GrowthConcernActions>
              {concern ? <GrowthConcernTimeline concern={concern} page={page} onRecord={onRecord} onTask={onTask} />
                : page.concerns?.state === "ready" && model.load !== "error" ? model.online ? <EmptyListCard title="暫無持續關注" detail="可以先與助手討論想留意的成長近況。" testID="growth-concerns-empty" /> : null : <View style={s.archiveEmpty} testID="growth-concerns-unavailable">
                  <Text accessibilityRole="header" style={s.concernTitle}>{model.load === "error" || page.concerns?.state === "error" ? "關注歷程未能讀取" : page.concerns?.state === "loading" ? "正在讀取關注歷程" : "關注歷程尚未接通"}</Text>
                </View>}
            </BackgroundSurface>
          </View>
        </> : !showLoading && model.access !== "lost" && model.load !== "error" ? <BackgroundSurface padded style={s.archiveEmpty}><Text style={s.body}>目前未能取得關注資料。</Text></BackgroundSurface> : null}
        {previewTools ? <Workspace.Section title="可接續的成長建議" detail="先核對來源與適用情況，再選擇要跟進的內容。">{previewTools}</Workspace.Section> : null}
        </> : null}
      </AppTabPanel>
      <AppTabPanel tabsId="growth-workspace" tabKey="preparation" active={tab === "preparation"} style={s.stack}>
        {tab === "preparation" ? <PreparationWorkspace onPrepareQuestion={onPrepareQuestion} onHistory={onPreparationHistory}
          scrollRef={scrollRef} getScrollPosition={() => scrollPosition.current} /> : null}
      </AppTabPanel>
    </View>
  </PageFrame>;
}
