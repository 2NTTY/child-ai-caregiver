import { useContainerWidth } from "../useContainerWidth";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { useEffect, useRef, useState } from "react";
import { View, type ScrollView } from "react-native";
import { Text } from "react-native-paper";
import type { GrowthActions,GrowthViewModel } from "../../growth-view-model";
import { PageFrame } from "../PageFrame";
import { AppButton,AppSelect,AppTabPanel,SectionCard,UnderlineTabs } from "../ui";
import { GrowthConcernIndex, GrowthConcernTimeline } from "./GrowthConcernTimeline";
import { GrowthArchive } from "./GrowthArchive";
import { GrowthConcernChangeNotice } from "./GrowthConcernChangeNotice";
import { GrowthOperationRecovery } from "./GrowthOperationRecovery";
import { growthRefreshNotice } from "../../growth-view-model";
import { growthStyles as s } from "./growth-styles";

export function GrowthView({model,actions,onTask,onRecord,onHistory,previewTools,initialTab="concerns"}:{model:GrowthViewModel;actions:GrowthActions;onTask:(id:string)=>void;onMemory:()=>void;onSource:(url:string)=>void;onRecord?:(id?:string)=>void;onSummary?:()=>void;onHistory?:()=>void;previewTools?:React.ReactNode;initialTab?:"concerns"|"archive"}){
  const containerLayout = useContainerWidth();
  const wide = containerLayout.width >= 880;
  const scrollRef = useRef<ScrollView>(null);
  const page=model.access === "lost" ? null : model.page;
  const [tab, setTab] = useState<"concerns" | "archive">(initialTab);
  const [selectedConcern, setSelectedConcern] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const concerns = page?.concerns?.state === "ready" ? page.concerns.items.filter(item => item.childId === model.childId) : [];
  const listedConcerns = concerns.filter(item => item.status !== "closed");
  const concern = listedConcerns.find(item => item.id === selectedConcern) ?? listedConcerns[0] ?? null;
  useEffect(() => {setTab(model.access === "lost" ? "concerns" : initialTab); setSelectedConcern(null); setNotesOpen(false);}, [model.scopeKey, model.access === "lost", initialTab]);
  const refreshed = model.notice === growthRefreshNotice;
  const showLoading = model.load === "loading" && !page;
  const showStatus = !model.online || model.access !== "editable" || showLoading || model.load === "error" || !!model.notice && !refreshed || model.refreshPending;
  const refreshButton = <AppButton label={model.busy?"正在讀取／提交…":model.pending?"重讀並核對原操作":"重新讀取"} accessibilityLabel={model.busy?"正在讀取／提交…":model.pending?"重讀並核對原操作":"重讀成長關注並保留草稿"} variant="secondary" density="compact" style={s.headerRefreshButton} disabled={model.busy||!model.online||model.access==="lost"} onPress={actions.refresh} />;
  const footerActions = <>
    {tab === "archive" && onRecord && page ? <AppButton label="前往原始記錄" variant="secondary" density="compact" onPress={() => onRecord()} /> : null}
    {page?.notices.length ? <AppButton label={notesOpen ? "收起資料說明" : "資料說明"} variant="secondary" density="compact" expanded={notesOpen} onPress={() => setNotesOpen(value => !value)} /> : null}
  </>;
  const footerDetails = notesOpen && page?.notices.length ? <View style={s.smallStack}>{page.notices.map((text,index)=><Text key={index} style={s.meta}>{text}</Text>)}</View> : null;
  return <PageFrame scrollRef={scrollRef} scrollTestID="growth-scroll" density="compact" title="成長與關注" headerActions={
    <View style={s.headerTools} testID="growth-refresh-toolbar">
      <View style={s.headerActions}>
        {refreshButton}
        {onHistory ? <AppButton label="查看關注歷史" variant="secondary" density="compact" onPress={onHistory} /> : null}
      </View>
      {/* Keep read feedback and button widths stable without inserting another page row. */}
      <Text style={[s.meta, s.headerStatus]} numberOfLines={1} testID="growth-refresh-status">{model.busy && model.load === "loading" ? "正在讀取" : refreshed ? growthRefreshNotice : "\u00a0"}</Text>
    </View>
  }>
    <StatusAnnouncement eventKey={`${model.operation}:${model.notice}`} message={model.notice} urgent={model.operation === "failed"} />
    <StatusAnnouncement eventKey={model.access} message={model.access === "lost" ? "已無權存取；舊資料及未提交內容已清除。" : ""} urgent={model.access === "lost"} />
    {showStatus ? <View style={s.smallStack}>
      {!model.online?<Text style={s.warning}>目前離線；資料未代表最新狀態，不能提交，沒有離線操作佇列。</Text>:null}
      {model.access==="read_only"?<Text style={s.meta}>目前只有閱讀權限；不能接受、確認近況或更改主題。</Text>:null}
      {model.access==="lost"?<Text style={s.warning}>已無權存取；舊關注、草稿及操作已清除。</Text>:null}
      {showLoading?<Text style={s.meta}>正在讀取，未確認最新狀態。</Text>:null}
      {model.load==="error"?<Text style={s.warning}>尚未成功讀取目前狀態；保留的草稿不能提交。</Text>:null}
      {model.notice && !refreshed?<Text style={model.operation==="unknown"||model.operation==="conflict"||model.operation==="failed"?s.warning:s.body}>{model.notice}</Text>:null}
      {model.refreshPending?<Text style={s.meta}>有更新等候核對，未提交草稿沒有被自動覆寫。</Text>:null}
    </View> : null}
    {model.dirty?<SectionCard testID="growth-drafts"><Text style={s.body}>未送出的草稿及確認保留原版本；重新讀取不會自動覆寫。</Text>
      <AppButton label="放棄草稿並重新核對" variant="quiet" disabled={model.busy||!model.online||model.access==="lost"} onPress={actions.askDiscard} />
      {model.discardAsked?<><Text style={s.warning}>會清除未送出的表單。結果未知的原請求仍會保留並鎖定。</Text><AppButton label="確認放棄未提交草稿" variant="secondary" disabled={model.busy||!model.online||model.access==="lost"} onPress={actions.discardDrafts} /></>:null}
    </SectionCard>:null}
    <GrowthOperationRecovery model={model} actions={actions} />
    <View ref={containerLayout.ref} onLayout={containerLayout.onLayout} style={s.workspace}>
      <UnderlineTabs id="growth-workspace" label="成長與關注" items={[{key: "concerns", label: "持續關注"}, {key: "archive", label: "成長檔案"}]} value={tab} onChange={setTab} />
      <AppTabPanel tabsId="growth-workspace" tabKey="concerns" active={tab === "concerns"} style={s.stack}>
        <GrowthConcernChangeNotice model={model} actions={actions} />
        {page ? <>
          <View style={wide ? s.columns : s.stack}>
            <View style={wide ? s.indexAside : s.full}>
              {wide ? <GrowthConcernIndex items={listedConcerns} selectedId={concern?.id ?? null} onSelect={setSelectedConcern} />
                : listedConcerns.length ? <AppSelect label="目前關注" value={concern?.id ?? ""} options={listedConcerns.map(item => ({value: item.id, label: `${item.title}${item.status === "closed" ? " · 已結束" : item.status === "proposed" ? " · 待核對" : ""}`}))} onChange={setSelectedConcern} /> : null}
            </View>
            <View style={wide ? s.main : s.full}>
              {concern ? <GrowthConcernTimeline concern={concern} page={page} scopeKey={model.scopeKey} onRecord={onRecord} onTask={onTask}
                onArchive={page.canManage ? () => actions.archiveConcern(concern.id, concern.version, page.authorityVersion) : undefined}
                archiveDisabled={model.locked || model.dirty || page.concerns?.state !== "ready"} />
                : <View style={s.archiveEmpty} testID="growth-concerns-unavailable">
                  <Text accessibilityRole="header" style={s.concernTitle}>{page.concerns?.state === "ready" ? "目前沒有已取得的持續關注" : page.concerns?.state === "loading" ? "正在讀取關注歷程" : page.concerns?.state === "error" ? "關注歷程未能讀取" : "關注歷程尚未接通"}</Text>
                  <Text style={s.body}>沒有已取得的關注不代表沒有需要觀察的事情。</Text>
                </View>}
            </View>
          </View>
        </> : <View style={s.archiveEmpty}><Text style={s.body}>{model.access === "lost" ? "已無權查看這位孩子的關注。" : model.load === "loading" ? "正在讀取這位孩子的關注。" : "目前未能取得關注資料。"}</Text></View>}
      </AppTabPanel>
      <AppTabPanel tabsId="growth-workspace" tabKey="archive" active={tab === "archive"} style={s.stack}>
        <GrowthArchive key={model.scopeKey} model={model} wide={wide} scrollRef={scrollRef} onRecord={onRecord} footerActions={footerActions} footerDetails={footerDetails} />
      </AppTabPanel>
    </View>
    {tab === "concerns" && page?.notices.length ? <View style={s.smallStack} testID="growth-footer">
      <View style={s.compactActions}>{footerActions}</View>
      {footerDetails}
    </View> : null}
    {previewTools}
  </PageFrame>;
}
