import { usePreviewLeaveGuard } from "./PreviewNavigationGuard";
import { useEffect,useRef,useState } from "react";
import type { GrowthAttention,GrowthAttempt,GrowthConcernChange,GrowthDecision,GrowthPage,GrowthPending,GrowthTopic,GrowthTopicDecision,GrowthViewModel } from "../growth-view-model";
import { growthActionable,growthConcernCanRestore,growthRefreshNotice,growthStateLabels } from "../growth-view-model";
import { growthFixture } from "./growthFixture";
import type { HomeChild } from "../view-model";

export type GrowthCondition="normal"|"empty"|"loading"|"read_error"|"read_only"|"lost"|"source_unavailable"|"fact_conflict"|"linked_task"|"no_assignee";
export type GrowthOutcome="success"|"failed"|"unknown"|"conflict";
export type GrowthRead="same"|"changed"|"missing"|"source_unavailable";
const clone=<T,>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;

// Component-memory simulation only. Production uses GrowthApi and the original frozen-request rules.
export function useGrowthPreview(child:HomeChild,online:boolean,identity:string,server:string){
  const scopeKey=JSON.stringify([server,identity,child.id,child.accessRole ?? "viewer"]);
  const [page,setPage]=useState<GrowthPage|null>(()=>growthFixture(child.id,{scopeKey,ageLabel:child.ageLabel}));
  const pageRef=useRef(page);pageRef.current=page;
  const [condition,setCondition]=useState<GrowthCondition>("normal"),[outcome,setOutcome]=useState<GrowthOutcome>("success"),[readScenario,setReadScenario]=useState<GrowthRead>("same");
  const [busy,setBusy]=useState(false),[readFailed,setReadFailed]=useState(false);
  const [pending,setPending]=useState<GrowthPending|null>(null),[originalConsent,setOriginalConsent]=useState(false);
  const originalConsentRef=useRef(originalConsent);originalConsentRef.current=originalConsent;
  const pendingRef=useRef(pending);pendingRef.current=pending;
  const [operation,setOperation]=useState<GrowthViewModel["operation"]>("none"),[notice,setNotice]=useState("");
  const [dirty,setDirty]=useState(false),[discardAsked,setDiscardAsked]=useState(false),[epoch,setEpoch]=useState(0),[resetCounts,setResetCounts]=useState<Record<string,number>>({});
  const [refreshPending,setRefreshPending]=useState(false),[missingTargets,setMissingTargets]=useState<string[]>([]);
  const [lastConcernChange,setLastConcernChange]=useState<GrowthConcernChange|null>(null);
  const dirtyKeys=useRef(new Set<string>()),timer=useRef<ReturnType<typeof setTimeout>|null>(null),alive=useRef(true),generation=useRef(0),flight=useRef<"read"|GrowthAttempt|null>(null);
  const onlineRef=useRef(online);onlineRef.current=online;
  const access=condition==="lost"?"lost":condition==="read_only"||!child.accessRole||child.accessRole==="viewer"?"read_only":"editable";
  const accessRef=useRef(access);accessRef.current=access;
  usePreviewLeaveGuard(dirty, busy || !!pending);
  const load=condition==="loading"||busy&&flight.current==="read"?"loading":readFailed||condition==="read_error"?"error":"ready";
  const readableRef=useRef(load==="ready");readableRef.current=load==="ready";
  function save(value:GrowthPage|null){pageRef.current=value;setPage(value);}
  function savePending(value:GrowthPending|null){pendingRef.current=value;setPending(value);originalConsentRef.current=false;setOriginalConsent(false);}
  function cancel(){generation.current++;if(timer.current)clearTimeout(timer.current);timer.current=null;flight.current=null;setBusy(false);}
  function later(action:()=>void){const token=generation.current;timer.current=setTimeout(()=>{timer.current=null;if(!alive.current||token!==generation.current||!onlineRef.current||accessRef.current==="lost")return;flight.current=null;setBusy(false);action();},420);}
  function resetForm(attempt:GrowthAttempt){const key=`${attempt.kind}:${attempt.id}`;dirtyKeys.current.delete(key);setDirty(dirtyKeys.current.size>0);setResetCounts(value=>({...value,[key]:(value[key]??0)+1}));setDiscardAsked(false);}
  function apply(attempt:GrowthAttempt){
    const current=pageRef.current;if(!current)return;
    if(attempt.kind==="concern"){
      const original=current.concerns?.items.find(item=>item.id===attempt.id&&item.childId===child.id);
      const restoring=attempt.input.action==="restore";
      if(!original)return;
      if(restoring?!growthConcernCanRestore(original):original.status==="closed")return;
      const at=new Date().toISOString();
      save({...current,concerns:{...current.concerns!,items:current.concerns!.items.map(item=>item.id!==attempt.id?item:{...item,
        status:restoring?original.statusBeforeArchive!:"closed",version:item.version+1,archivedAt:restoring?null:at,
        statusBeforeArchive:restoring?undefined:original.status as "proposed"|"following",
        events:[...item.events,{id:`preview-concern-${attempt.input.action}:${item.id}:${item.version+1}`,at,kind:"confirmed_action",
          title:restoring?"家長恢復這條關注":"家長結束這條關注",
          text:restoring?"已回到持續關注，保留原來的核對狀態與前後經過。已連結的任務及記錄維持原狀。":"已移到關注歷史，原有內容保留。已連結的任務及待核對記錄維持原狀。",
          sourceLabel:restoring?"家長明確恢復關注":"家長確認結束關注"}]})}});
      setLastConcernChange({scopeKey,authorityVersion:current.authorityVersion,id:original.id,version:original.version+1,action:attempt.input.action});
      setNotice(restoring?"已恢復這條關注，原有經過與核對狀態保留；沒有改動已連結任務。":"已結束這條關注，可撤銷或稍後在歷史恢復；原有記錄及已連結任務保持不變。");
    }else if(attempt.kind==="item"){
      const input=attempt.input;
      const items=current.items.map(item=>item.id!==attempt.id?item:{...item,version:item.version+1,state:input.action==="accept"?"accepted" as const:input.action==="snooze"?"snoozed" as const:"dismissed" as const,
        lastAction:input.action,actorUserId:identity,updatedAt:"2026-10-01T03:00:00Z",snoozeUntil:input.action==="snooze"?input.until:null,note:input.action==="dismiss"?input.note:"",
        ...(input.action==="accept"&&input.task.kind==="create"?{taskId:`preview-task-${attempt.id}`,taskState:"scheduled" as const}:{})});
      save({...current,items});setNotice(`已模擬保存：${growthStateLabels[items.find(item=>item.id===attempt.id)!.state]}。接受不代表已預約或任務完成。`);
    }else{
      const input=attempt.input;
      const topics=current.topics.map(topic=>topic.id!==attempt.id?topic:{...topic,version:topic.version+1,
        ...(input.action==="set_enabled"?{disabled:!input.enabled}:{inputs:topic.inputs.map(field=>({...field,value:input.values[field.key]??field.value}))})});
      save({...current,topics});setNotice(input.action==="set_enabled"?(input.enabled?"已模擬重新啟用未來評估；舊關閉紀錄保持終態。":"已模擬永久停用主題；不代表連結任務已取消。"):"已模擬保存明確選擇的家庭共享近況；未選欄位保持原狀。");
    }
    setReadFailed(false);savePending(null);setOperation("saved");resetForm(attempt);
  }
  function submit(attempt:GrowthAttempt,retry=false){
    if(!alive.current||flight.current||!onlineRef.current||accessRef.current!=="editable"||!readableRef.current||!pageRef.current?.canManage||(!retry&&pendingRef.current)||(retry&&(!pendingRef.current?.reviewed||pendingRef.current.reconfirm||!originalConsentRef.current)))return;
    const frozen=clone(attempt);flight.current=frozen;setBusy(true);setOriginalConsent(false);setOperation("saving");setNotice("正在模擬提交；尚未確認保存。");
    later(()=>{
      if(outcome==="success"){apply(frozen);return;}
      savePending({attempt:frozen,reviewed:false,reconfirm:outcome==="failed"||outcome==="conflict"});setReadFailed(true);setOperation(outcome==="unknown"?"unknown":outcome==="conflict"?"conflict":"failed");
      setNotice(outcome==="unknown"?"結果未知。原對象、完整內容、版本及授權基準保留；先重讀，再明確查回同一份原請求，沒有 opId 或自動重送。":outcome==="conflict"?"關注／授權或已確認資料版本有衝突；草稿保留，先重讀並重新核對。":"這次提交未獲接受。先重讀目前狀態；不能憑此拒絕判定較早的未知操作結果。");
    });
  }
  function refresh(){
    if(!alive.current||flight.current||!onlineRef.current||accessRef.current==="lost")return;
    flight.current="read";setBusy(true);setOriginalConsent(false);setRefreshPending(false);
    later(()=>{
      if(condition==="read_error"){setReadFailed(true);setNotice("讀取失敗，原草稿及原操作保留，停止新的變更。");return;}
      const current=pageRef.current;if(!current)return;
      let latest=clone(current);const original=pendingRef.current;
      if(readScenario==="changed")latest={...latest,authorityVersion:latest.authorityVersion+":new",items:latest.items.map(item=>({...item,version:item.version+1})),topics:latest.topics.map(topic=>({...topic,version:topic.version+1})),concerns:latest.concerns?{...latest.concerns,items:latest.concerns.items.map(item=>({...item,version:item.version+1}))}:undefined};
      if(readScenario==="source_unavailable")latest={...latest,items:latest.items.map(item=>({...item,sourceAvailable:false})),concerns:latest.concerns?{...latest.concerns,state:"unavailable",items:[]}:undefined};
      if(readScenario==="missing")latest={...latest,items:[],topics:[],concerns:latest.concerns?{...latest.concerns,items:[]}:undefined};
      const found=!!original&&(original.attempt.kind==="item"?latest.items.some(item=>item.id===original.attempt.id):original.attempt.kind==="concern"?latest.concerns?.items.some(item=>item.id===original.attempt.id&&item.childId===child.id)??false:latest.topics.some(topic=>topic.id===original.attempt.id));
      const missing:string[]=[];
      for(const item of current.items)if(dirtyKeys.current.has(`item:${item.id}`)&&!latest.items.some(value=>value.id===item.id)){latest.items.push({...item,sourceAvailable:false});missing.push(`item:${item.id}`);}
      for(const topic of current.topics)if(dirtyKeys.current.has(`topic:${topic.id}`)&&!latest.topics.some(value=>value.id===topic.id)){latest.topics.push(topic);missing.push(`topic:${topic.id}`);}
      save(latest);setMissingTargets(missing);setReadFailed(false);
      if(original?.reconfirm){savePending(null);setNotice("這次提交未獲接受，最新狀態已讀取。保留的草稿仍採原基準；先核對，再明確放棄草稿及重新確認。沒有自動換新版本。");}
      else if(original){savePending({...original,reviewed:found});setNotice(found?"已讀取原對象；原操作結果仍未確認。重新同意後，查回只使用原內容及原版本。":"最新頁面未找到原對象，不能重試；新變更繼續停止，原內容仍保留。");}
      else setNotice(missing.length?"部分草稿對象未在最新頁面；保留舊資料及草稿供核對，相關操作停止。":growthRefreshNotice);
    });
  }
  function changeCondition(next:GrowthCondition){
    if(next!=="lost"&&(flight.current||pendingRef.current||dirtyKeys.current.size))return;
    cancel();dirtyKeys.current.clear();setDirty(false);setDiscardAsked(false);setEpoch(value=>value+1);setMissingTargets([]);savePending(null);setReadFailed(false);setOperation("none");setLastConcernChange(null);setCondition(next);
    if(next==="lost"){save(null);setNotice("身份／孩子存取權已改變；舊關注、草稿及操作已清除。");return;}
    const fresh=growthFixture(child.id,{scopeKey,ageLabel:child.ageLabel});
    if(next==="empty"){fresh.items=[];if(fresh.concerns)fresh.concerns={...fresh.concerns,items:[]};if(fresh.archive)fresh.archive={...fresh.archive,state:"not_generated",snapshot:null};}
    if(next==="loading"){
      if(fresh.archive)fresh.archive={...fresh.archive,state:"loading",snapshot:null,history:[]};
      if(fresh.concerns)fresh.concerns={...fresh.concerns,state:"loading",items:[]};
    }
    if(next==="read_error"){
      if(fresh.archive)fresh.archive={...fresh.archive,state:"error",snapshot:null,history:[]};
      if(fresh.concerns)fresh.concerns={...fresh.concerns,state:"error",items:[]};
    }
    if(next==="read_only")fresh.canManage=false;
    if(next==="source_unavailable"){
      fresh.items=fresh.items.map(item=>({...item,sourceAvailable:false}));
      if(fresh.concerns)fresh.concerns={...fresh.concerns,state:"unavailable",items:[]};
      if(fresh.archive)fresh.archive={...fresh.archive,state:"invalidated",snapshot:null};
    }
    if(next==="fact_conflict")fresh.topics[2].inputs[0].conflict=true;
    if(next==="linked_task")fresh.items[0]={...fresh.items[0],taskId:"preview-linked-task",taskState:"needs_review"};
    if(next==="no_assignee")fresh.eligibleAssignees=[];
    save(fresh);setNotice("");
  }
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;if(timer.current)clearTimeout(timer.current);flight.current=null;pendingRef.current=null;};},[]);
  useEffect(()=>{
    if(online)return;
    const attempt=flight.current;cancel();setReadFailed(true);setOriginalConsent(false);
    if(attempt&&attempt!=="read")savePending({attempt,reviewed:false,reconfirm:false});
    else if(pendingRef.current)savePending({...pendingRef.current,reviewed:false});
    if(attempt&&attempt!=="read"||pendingRef.current)setOperation("unknown");
    setNotice("目前離線，資料未代表最新狀態。草稿只保留在本頁記憶中，沒有排隊提交；回線後手動重讀。");
  },[online]);
  const model:GrowthViewModel={scopeKey,childId:child.id,childName:child.displayName,dataLabel:"全部只屬合成預覽，未接駁 Server 或背景 Agent。",online,access,load,page:page?{...page,canManage:page.canManage&&access==="editable"}:null,busy,
    locked:busy||!online||load!=="ready"||access!=="editable"||!!pending||!page?.canManage,pending,originalConsent,operation,notice,dirty,discardAsked,epoch,resetCounts,refreshPending,missingTargets,lastConcernChange};
  return {model,condition,outcome,readScenario,changeCondition,setOutcome,setReadScenario,actions:{
    refresh,markDirty(key:string){dirtyKeys.current.add(key);setDirty(true);setDiscardAsked(false);},askDiscard(){setDiscardAsked(true);},
    discardDrafts(){if(!discardAsked||busy||!online||access==="lost")return;dirtyKeys.current.clear();setDirty(false);setDiscardAsked(false);setEpoch(value=>value+1);setOriginalConsent(false);refresh();},
    setOriginalConsent(value:boolean){originalConsentRef.current=value;setOriginalConsent(value);},retryOriginal(){if(pendingRef.current)submit(pendingRef.current.attempt,true);},
    archiveConcern(id:string,expectedVersion:number,authorityVersion:string){
      const current=pageRef.current,concern=current?.concerns?.items.find(item=>item.id===id&&item.childId===child.id);
      if(model.locked||dirtyKeys.current.size||current?.concerns?.state!=="ready"||!concern||concern.status==="closed"||concern.version!==expectedVersion||current.authorityVersion!==authorityVersion)return;
      const input={action:"archive" as const,expectedVersion,authorityVersion,confirm:true as const};
      submit({kind:"concern",id,input,body:JSON.stringify(input),label:`結束關注：${concern.title}`});
    },
    restoreConcern(id:string,expectedVersion:number,authorityVersion:string){
      const current=pageRef.current,concern=current?.concerns?.items.find(item=>item.id===id&&item.childId===child.id);
      if(model.locked||dirtyKeys.current.size||current?.concerns?.state!=="ready"||!concern||concern.status!=="closed"||concern.version!==expectedVersion||current.authorityVersion!==authorityVersion)return;
      if(!growthConcernCanRestore(concern)){setNotice("尚未取得這條關注歸檔前的核對狀態，暫未能恢復；請先重新讀取。");return;}
      const input={action:"restore" as const,expectedVersion,authorityVersion,confirm:true as const};
      submit({kind:"concern",id,input,body:JSON.stringify(input),label:`恢復關注：${concern.title}`});
    },
    decide(item:GrowthAttention,input:GrowthDecision){const current=pageRef.current;const latest=current?.items.find(value=>value.id===item.id);if(model.locked||!latest||!growthActionable(latest)||latest.version!==input.expectedVersion||current?.authorityVersion!==input.authorityVersion||current.topics.find(topic=>topic.id===item.topicId)?.disabled)return;
      const task=input.action==="accept"&&input.task.kind==="create"?input.task.values:null;const assigneeLabel=task?current.eligibleAssignees.find(person=>person.userId===task.assigneeUserId)?.name:undefined;
      submit({kind:"item",id:item.id,input:clone(input),body:JSON.stringify(input),label:`${input.action==="accept"?"接受":input.action==="snooze"?"延後":"關閉"}：${item.title}`,...(assigneeLabel?{assigneeLabel}:{})});},
    updateTopic(topic:GrowthTopic,input:GrowthTopicDecision){const current=pageRef.current;const latest=current?.topics.find(value=>value.id===topic.id);if(model.locked||!latest||latest.version!==input.expectedVersion||current?.authorityVersion!==input.authorityVersion||missingTargets.includes(`topic:${topic.id}`))return;
      const values=input.action==="confirm_context"?input.values:null;const summary=values?topic.inputs.filter(field=>values[field.key]!==undefined).map(field=>`${field.label}：${field.choices.find(choice=>choice.value===values[field.key])?.label??values[field.key]}`):undefined;
      submit({kind:"topic",id:topic.id,input:clone(input),body:JSON.stringify(input),label:`主題設定：${topic.title}`,...(summary?{summary}:{})});},
  }};
}
