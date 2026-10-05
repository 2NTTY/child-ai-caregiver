import { useContainerWidth } from "../useContainerWidth";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { Text } from "react-native-paper";
import type { GrowthActions,GrowthAttempt,GrowthViewModel } from "../../growth-view-model";
import { AppCheckbox } from "../AppCheckbox";
import { PageFrame } from "../PageFrame";
import { AppButton,SectionCard,SectionHeader } from "../ui";
import { GrowthConcernIndex, GrowthConcernTimeline } from "./GrowthConcernTimeline";
import { GrowthAttentionCard } from "./GrowthAttentionCard";
import { GrowthTopicCard } from "./GrowthTopicCard";
import { growthStyles as s } from "./growth-styles";

function OriginalRequest({attempt}:{attempt:GrowthAttempt}){
  const input=attempt.input;
  return <View testID="growth-original-request" style={s.smallStack}><Text style={s.title}>{attempt.label}</Text><Text style={s.meta}>原版本 {input.expectedVersion} · 原授權基準 {input.authorityVersion}</Text>
    {attempt.kind==="item"?(attempt.input.action==="accept"?(attempt.input.task.kind==="none"?<Text style={s.body}>只記錄已知悉，不建立任務。</Text>:attempt.input.task.kind==="create"?<>
      <Text style={s.body}>{attempt.input.task.values.title}</Text><Text selectable style={s.body}>{attempt.input.task.values.details}</Text><Text style={s.meta}>原負責人：{attempt.assigneeLabel??attempt.input.task.values.assigneeUserId} · 時間：{attempt.input.task.values.dueAt} · 時區：{attempt.input.task.values.timeZone}</Text>
    </>:<Text style={s.body}>原連結任務：{attempt.input.task.id} · 版本 {attempt.input.task.expectedVersion}</Text>):attempt.input.action==="snooze"?<Text style={s.body}>原延後時間：{attempt.input.until}</Text>:<Text selectable style={s.body}>原關閉備註：{attempt.input.note||"沒有備註"}</Text>):
      attempt.input.action==="set_enabled"?<Text style={s.body}>{attempt.input.enabled?"重新啟用主題":"永久停用主題"}</Text>:<>
        {(attempt.summary??Object.entries(attempt.input.values).map(([key,value])=>`${key} · ${value}`)).map((text,index)=><Text key={index} selectable style={s.body}>原選擇：{text}</Text>)}
        {attempt.input.expectedFacts.map(fact=><Text key={fact.id} selectable style={s.meta}>原已確認資料：{fact.id} · 版本 {fact.version}</Text>)}
      </>}
    <Text style={s.meta}>查回沿原對象、完整內容及基準；不另建請求或默換新版本。</Text>
  </View>;
}
export function GrowthView({model,actions,onTask,onMemory,onSource,onRecord,onSummary,previewTools}:{model:GrowthViewModel;actions:GrowthActions;onTask:(id:string)=>void;onMemory:()=>void;onSource:(url:string)=>void;onRecord?:(id?:string)=>void;onSummary?:()=>void;previewTools?:React.ReactNode}){
  const containerLayout = useContainerWidth();
  const wide = containerLayout.width >= 880;
  const page=model.page;
  const [selectedConcern, setSelectedConcern] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const concerns = page?.concerns?.state === "ready" ? page.concerns.items.filter(item => item.childId === page.items[0]?.childId || !page.items.length) : [];
  const concern = concerns.find(item => item.id === selectedConcern) ?? concerns[0] ?? null;
  useEffect(() => {setSelectedConcern(null); setSettingsOpen(false);}, [model.scopeKey]);
  const retryDisabled=model.busy||!model.online||model.access!=="editable"||model.load!=="ready"||!page?.canManage||!model.pending?.reviewed||!!model.pending?.reconfirm||!model.originalConsent;
  return <PageFrame density="compact" title="成長與關注" description={`按${model.childName}的已確認情況查看理由、來源及下一步；供觀察、安排及諮詢準備，不作診斷或醫療分流。`}>
    <StatusAnnouncement eventKey={`${model.operation}:${model.notice}`} message={model.notice} urgent={model.operation === "failed"} />
    <StatusAnnouncement eventKey={model.access} message={model.access === "lost" ? "已無權存取；舊資料及未提交內容已清除。" : ""} urgent={model.access === "lost"} />
    <View style={s.toolbar}><SectionHeader density="compact" title="關注如何開始，後來有何變化" subtitle={model.dataLabel} icon="chart-bar" />
      <AppButton label={model.busy?"正在讀取／提交…":model.pending?"重讀並核對原操作":"重讀成長關注並保留草稿"} variant="secondary" disabled={model.busy||!model.online||model.access==="lost"} onPress={actions.refresh} />
      {!model.online?<Text style={s.warning}>目前離線；資料未代表最新狀態，不能提交，沒有離線操作佇列。</Text>:null}
      {model.access==="read_only"?<Text style={s.meta}>目前只有閱讀權限；不能接受、確認近況或更改主題。</Text>:null}
      {model.access==="lost"?<Text style={s.warning}>已無權存取；舊關注、草稿及操作已清除。</Text>:null}
      {model.load==="loading"?<Text style={s.meta}>正在讀取，未確認最新狀態。</Text>:null}
      {model.load==="error"?<Text style={s.warning}>尚未成功讀取目前狀態；保留的草稿不能提交。</Text>:null}
      {model.notice?<Text style={model.operation==="unknown"||model.operation==="conflict"||model.operation==="failed"?s.warning:s.body}>{model.notice}</Text>:null}
      {model.refreshPending?<Text style={s.meta}>有更新等候核對，未提交草稿沒有被自動覆寫。</Text>:null}
    </View>
    {model.dirty?<SectionCard testID="growth-drafts"><Text style={s.body}>未送出的草稿及確認保留原版本；重新讀取不會自動覆寫。</Text>
      <AppButton label="放棄草稿並重新核對" variant="quiet" disabled={model.busy||!model.online||model.access==="lost"} onPress={actions.askDiscard} />
      {model.discardAsked?<><Text style={s.warning}>會清除未送出的表單。結果未知的原請求仍會保留並鎖定。</Text><AppButton label="確認放棄未提交草稿" variant="secondary" disabled={model.busy||!model.online||model.access==="lost"} onPress={actions.discardDrafts} /></>:null}
    </SectionCard>:null}
    {model.pending?<SectionCard testID="growth-pending"><SectionHeader density="compact" title={model.pending.reconfirm?"這次提交未獲接受":"原操作結果待核對"} icon="information-outline" />
      <OriginalRequest attempt={model.pending.attempt} />
      <AppCheckbox label="我已核對並同意查回同一份原內容及版本" checked={model.originalConsent} disabled={model.busy||!model.online||model.access!=="editable"||model.load!=="ready"||!page?.canManage||!model.pending.reviewed||model.pending.reconfirm} onChange={actions.setOriginalConsent} />
      <AppButton label="明確查回原操作" disabled={retryDisabled} onPress={actions.retryOriginal} />
    </SectionCard>:null}
    {page?<>
      {page.notices.map((text,index)=><Text key={index} style={s.meta}>{text}</Text>)}
      <View ref={containerLayout.ref} onLayout={containerLayout.onLayout} style={wide?s.columns:s.stack}>
        <View style={wide?s.indexAside:s.full}>
          <GrowthConcernIndex items={concerns} selectedId={concern?.id ?? null} onSelect={setSelectedConcern} />
          {onSummary ? <AppButton label="整理回顧與到診資料" variant="quiet" onPress={onSummary} /> : null}
        </View>
        <View style={wide?s.main:s.full}>
          {page.concerns?.label ? <Text style={s.meta}>{page.concerns.label}</Text> : null}
          {concern ? <GrowthConcernTimeline concern={concern} page={page} onRecord={onRecord} onTask={onTask} /> : <View style={s.timelinePanel}><Text style={s.title}>{page.concerns?.state === "ready" ? "目前沒有已取得的關注時間軸" : page.concerns?.state === "loading" ? "正在讀取關注時間軸" : page.concerns?.state === "error" ? "關注時間軸未能讀取" : "關注時間軸尚未接通"}</Text><Text style={s.body}>既有階段關注仍可在下方核對；時間軸不是助手記憶或話題，也不以缺席資料推斷沒有關注。</Text></View>}
          <View style={s.divider}><SectionHeader density="compact" title="可核對的階段建議" subtitle="沿用已取得的成長計劃；接受只代表知悉，安排跟進需另行確認。" />
            {page.items.length ? page.items.map(item => <View key={`${model.scopeKey}:${item.id}`} style={concern && !concern.attentionIds.includes(item.id) ? s.hidden : undefined}><GrowthAttentionCard item={item} page={page} model={model} actions={actions} onSource={onSource} onTask={onTask} /></View>) : <Text style={s.body}>目前沒有已保存的階段建議。沒有提示不代表已接受專業評估。</Text>}
            {page.historyHasMore?<Text style={s.meta}>目前只列有限歷史，還有較早記錄未顯示；不是完整歷史。</Text>:null}
          </View>
        </View>
      </View>
      <View style={s.divider}><SectionHeader density="compact" title="家庭近況與階段設定" subtitle="使用既有四階段計劃；與助手記憶／話題分開管理。" action={<AppButton label={settingsOpen ? "收起階段設定" : "核對近況與設定"} variant="quiet" onPress={() => setSettingsOpen(value => !value)} />} />
        <View style={[s.stack, !settingsOpen && s.hidden]} accessibilityElementsHidden={!settingsOpen} importantForAccessibility={settingsOpen ? "auto" : "no-hide-descendants"} aria-hidden={!settingsOpen}>
          {page.topics.map(topic=><GrowthTopicCard key={`${model.scopeKey}:${topic.id}`} topic={topic} model={model} actions={actions} onMemory={onMemory} />)}
        </View>
      </View>
    </>:null}
    {previewTools}
  </PageFrame>;
}
