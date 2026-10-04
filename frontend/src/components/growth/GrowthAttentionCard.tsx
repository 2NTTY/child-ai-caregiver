import { usePreviewLeaveGuard } from "../../preview/PreviewNavigationGuard";
import { useRef,useState } from "react";
import { View } from "react-native";
import { HelperText,Text } from "react-native-paper";
import { Controller,useForm,useWatch, useFormState } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { GrowthActions,GrowthAttention,GrowthPage,GrowthViewModel } from "../../growth-view-model";
import { growthActionable,growthKindLabels,growthSourceUrl,growthStateLabels,growthTime } from "../../growth-view-model";
import { taskStateLabels } from "../../task-view-model";
import { AppCheckbox } from "../AppCheckbox";
import { AppDateTimeField,AppTimeZoneSelect } from "../DateTimeFields";
import { AppButton,AppSelect,AppTextField,SectionCard,SectionHeader } from "../ui";
import { growthDecisionProjection,growthFormDefaults,growthFormSchema,type GrowthFormValues } from "./growth-form";
import { MotionDisclosure, MotionFeedback } from "../../motion";
import { useGrowthFeedback } from "./growth-motion";
import { growthStyles as s } from "./growth-styles";

type GrowthAttentionProps = {item:GrowthAttention;page:GrowthPage;model:GrowthViewModel;actions:GrowthActions;onSource:(url:string)=>void;onTask:(id:string)=>void};
export function GrowthAttentionCard(props: GrowthAttentionProps){
  const {item, model} = props, resetCount = model.resetCounts[`item:${item.id}`] ?? 0;
  const scopeKey = `${model.scopeKey}:${model.epoch}:${model.access}:${item.id}`;
  const trigger = useGrowthFeedback(scopeKey, resetCount, JSON.stringify([item.state, item.snoozeUntil, item.note, item.taskId]));
  return <SectionCard testID={`growth-item-${item.id}`}><SectionHeader density="compact" title={item.title} icon="chart-bar" />
    <MotionFeedback active={model.operation === "saved" && !model.busy && !model.pending && model.load === "ready"} triggerKey={trigger} scopeKey={scopeKey} testID={`growth-item-feedback-${item.id}`}><Text style={s.meta}>{growthKindLabels[item.kind]} · {growthStateLabels[item.state]}</Text></MotionFeedback>
    <GrowthAttentionBody key={`${model.epoch}:${resetCount}`} {...props} />
  </SectionCard>;
}
function GrowthAttentionBody({item,page,model,actions,onSource,onTask}: GrowthAttentionProps){
  const [detailsOpen,setDetailsOpen]=useState(false),[actionsOpen,setActionsOpen]=useState(false),[taskShared,setTaskShared]=useState(false);
  const basis=useRef<{item:GrowthAttention;authorityVersion:string}|null>(null);
  const {control,handleSubmit}=useForm<GrowthFormValues>({defaultValues:growthFormDefaults(item.title,item.advice),mode:"onBlur",resolver:zodResolver(growthFormSchema(page.eligibleAssignees))});
  const { isDirty } = useFormState({ control });
  usePreviewLeaveGuard(isDirty);
  const values=useWatch({control});
  const action=values.action??"accept",taskMode=values.taskMode??"none",timeZone=values.timeZone??"Asia/Hong_Kong";
  const captured=basis.current??{item,authorityVersion:page.authorityVersion};
  const changed=!!basis.current&&(captured.item.version!==item.version||captured.authorityVersion!==page.authorityVersion);
  const disabled=model.locked||changed||!growthActionable(item)||!!page.topics.find(topic=>topic.id===item.topicId)?.disabled||model.missingTargets.includes(`item:${item.id}`);
  const activeTask=!!item.taskId&&(item.taskState==="scheduled"||item.taskState==="needs_review");
  function mark(){if(!basis.current)basis.current={item:JSON.parse(JSON.stringify(item)) as GrowthAttention,authorityVersion:page.authorityVersion};actions.markDirty(`item:${item.id}`);}
  function edit(){mark();setTaskShared(false);}
  function field(name:"title"|"details"|"closeNote",label:string,help?:string){return <Controller name={name} control={control} render={({field:input,fieldState})=><View>
    <AppTextField ref={input.ref} label={label} accessibilityLabel={label} value={input.value} multiline={name!=="title"} disabled={disabled} error={!!fieldState.error} onBlur={input.onBlur}
      onChangeText={value=>{input.onChange(value);edit();}} />{fieldState.error||help?<HelperText type={fieldState.error?"error":"info"} visible>{fieldState.error?.message??help}</HelperText>:null}
  </View>}/>;}
  const sourceUrl=growthSourceUrl(item.source.url);
  return <>
    <Text style={s.body}>為何現在：{item.whyNow}</Text>
    {item.sourceAvailable?<><Text style={s.body}>{item.advice}</Text><Text style={s.meta}>適用限制：{item.limits}</Text></>:<>
      <Text style={s.warning}>來源或適用依據已改變／暫不可用。這項提示只供歷史追溯，不能按舊建議處理。</Text><Text style={s.meta}>產生當時的限制：{item.limits}</Text>
    </>}
    {!!item.newReason?<Text style={s.meta}>新提示原因：{item.newReason}</Text>:null}
    {item.previousId?<Text selectable style={s.meta}>之前關注：{item.previousId}；舊終態保持。</Text>:null}
    {item.snoozeUntil?<Text style={s.body}>延後至：{growthTime(item.snoozeUntil)}</Text>:null}
    {item.note?<Text selectable style={s.body}>處理備註：{item.note}</Text>:null}
    <Text style={s.meta}>建立：{growthTime(item.createdAt)} · 更新：{growthTime(item.updatedAt)} · 版本 {item.version}</Text>
    {item.taskId?<View style={s.box}><Text selectable style={s.body}>連結任務：{item.taskId}</Text><Text style={s.body}>讀取當時：{item.taskState?taskStateLabels[item.taskState]:"狀態未能確認，請重讀任務"}</Text>
      <AppButton label="查看連結任務" variant="secondary" onPress={()=>onTask(item.taskId!)} /><Text style={s.meta}>接受不代表預約或完成；來源改變不代表任務已取消。</Text></View>:
      item.state==="accepted"?<Text style={s.meta}>已記錄知悉，沒有連結任務；不代表已預約或完成。</Text>:null}
    <AppButton label={detailsOpen?"收起來源及依據":"查看來源及依據"} variant="quiet" onPress={()=>setDetailsOpen(value=>!value)} />
    <MotionDisclosure expanded={detailsOpen} scopeKey={`${model.scopeKey}:${item.id}`}><View style={s.divider} testID="growth-source"><Text style={s.title}>{item.source.title} · {item.source.section}</Text><Text selectable style={s.body}>{item.source.excerpt}</Text>
      <Text selectable style={s.meta}>核對：{growthTime(item.source.checkedAt)} · 來源版本：{item.source.versionId}</Text>
      <Text selectable style={s.meta}>章節識別：{item.source.chunkId} · 內容 hash：{item.source.contentHash}</Text>
      <Text style={s.meta}>階段／規則：{item.basis.stage}／{item.basis.ruleRevision} · 檔案版本 {item.evidence.profileVersion}</Text>
      {Object.entries(item.basis.values).map(([key,value])=><Text key={key} selectable style={s.meta}>{key}：{value}</Text>)}
      {item.evidence.facts.map(fact=><Text key={fact.id} selectable style={s.meta}>已確認資料：{fact.id} · 版本 {fact.version}</Text>)}
      {sourceUrl?<AppButton label="開啟來源網頁" variant="secondary" onPress={()=>onSource(sourceUrl)} />:<Text style={s.warning}>連結未通過 HTTPS 核對，不能開啟。</Text>}
    </View></MotionDisclosure>
    {changed?<Text style={s.warning}>關注或授權基準已改變，原草稿仍保留；先核對最新內容，再明確放棄草稿並重新核對。</Text>:null}
    {page.canManage&&(growthActionable(item)||basis.current)?<>
      <AppButton label={actionsOpen?"收起處理選項":"處理這項關注"} variant="secondary" onPress={()=>setActionsOpen(value=>!value)} />
      <MotionDisclosure expanded={actionsOpen} scopeKey={`${model.scopeKey}:${item.id}`}><View style={s.divider} testID="growth-decision-form">
        <Controller name="action" control={control} render={({field:input})=><AppSelect label="關注處理方式" value={input.value} options={[{value:"accept",label:"接受並記錄知悉"},{value:"snooze",label:"稍後處理"},{value:"dismiss",label:"關閉這項關注"}]} disabled={disabled} onChange={value=>{input.onChange(value);edit();}} />}/>
        {action==="accept"?<>
          <Controller name="taskMode" control={control} render={({field:input})=><AppSelect label="接受後的安排" value={input.value} options={[{value:"none",label:"只記錄已知悉"},...(!activeTask&&page.eligibleAssignees.length?[{value:"create" as const,label:"建立共享待處理任務"}]:[])]} disabled={disabled} onChange={value=>{input.onChange(value);edit();}} />}/>
          {activeTask?<Text style={s.warning}>已有待處理／待覆核的連結任務，請先到任務區核對，不能在這裏另建一份。</Text>:null}
          {!page.eligibleAssignees.length?<Text style={s.meta}>目前沒有合資格負責人；只能記錄知悉，不能建立任務。</Text>:null}
          {taskMode==="create"?<>
            {field("title","關注任務標題","最多 160 字，保留原文。")}{field("details","關注任務內容","最多 2,000 字。")}
            <Controller name="kind" control={control} render={({field:input})=><AppSelect label="關注任務種類" value={input.value} options={[{value:"ordinary",label:"普通任務"},{value:"appointment",label:"預約事項"}]} disabled={disabled} onChange={value=>{input.onChange(value);edit();}} />}/>
            <Controller name="assigneeUserId" control={control} render={({field:input,fieldState})=><View><AppSelect label="關注任務負責人" value={input.value} options={page.eligibleAssignees.map(person=>({value:person.userId,label:person.name}))} disabled={disabled} onChange={value=>{input.onChange(value);edit();}} />{fieldState.error?<HelperText type="error">{fieldState.error.message}</HelperText>:null}</View>}/>
            <Controller name="timeZone" control={control} render={({field:input})=><AppTimeZoneSelect value={input.value} disabled={disabled} onChange={value=>{input.onChange(value);edit();}} />}/>
            <Controller name="dueAt" control={control} render={({field:input,fieldState})=><AppDateTimeField label="關注任務時間" value={input.value} timeZone={timeZone} disabled={disabled} error={fieldState.error?.message} onChange={value=>{input.onChange(value);edit();}} />}/>
            <View style={s.box} testID="growth-task-review"><Text style={s.title}>建立前核對</Text><Text style={s.body}>{values.title}</Text><Text selectable style={s.body}>{values.details}</Text><Text style={s.meta}>負責人：{page.eligibleAssignees.find(person=>person.userId===values.assigneeUserId)?.name??"尚未選擇"} · 時間：{values.dueAt||"尚未選擇"}</Text></View>
            <AppCheckbox label="我已核對時間及負責人，同意建立家庭共享任務" checked={taskShared} disabled={disabled} onChange={value=>{mark();setTaskShared(value);}} />
            <Text style={s.meta}>只建立待處理事項；預約事項不代表已向機構預約。</Text>
          </>:null}
        </>:action==="snooze"?<Controller name="until" control={control} render={({field:input,fieldState})=><AppDateTimeField label="關注延後時間" value={input.value} disabled={disabled} error={fieldState.error?.message} onChange={value=>{input.onChange(value);edit();}} />}/>:
          <>{field("closeNote","關注關閉備註","可留空，最多 1,000 字。")}<Text style={s.meta}>關閉後，相同階段及依據不再催。永久停用在主題設定處理。</Text></>}
        <AppButton label={action==="accept"?(taskMode==="create"?"明確接受並建立共享任務":"明確接受並記錄知悉"):action==="snooze"?"明確延後這項關注":"明確關閉這項關注"}
          disabled={disabled||action==="accept"&&taskMode==="create"&&(!taskShared||activeTask)} onPress={handleSubmit(values=>{mark();actions.decide(captured.item,growthDecisionProjection(values,captured.item.version,captured.authorityVersion));})} />
      </View></MotionDisclosure>
    </>:null}
  </>;
}
