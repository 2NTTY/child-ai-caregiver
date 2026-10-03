import { useEffect,useRef,useState } from "react";
import { Linking } from "react-native";
import { Text } from "react-native-paper";
import type { HomeChild } from "../view-model";
import { usePreview } from "../preview/PreviewContext";
import { useGrowthPreview,type GrowthCondition,type GrowthOutcome,type GrowthRead } from "../preview/useGrowthPreview";
import { growthSourceUrl } from "../growth-view-model";
import { GrowthView } from "../components/growth/GrowthView";
import { growthStyles as s } from "../components/growth/growth-styles";
import { AppButton,AppSelect,SectionCard,SectionHeader } from "../components/ui";
import { PageFrame } from "../components/PageFrame";

function GrowthWorkspace({child,online,identity,server,onIdentity,onServer,onTask,onMemory}:{child:HomeChild;online:boolean;identity:string;server:string;onIdentity:()=>void;onServer:()=>void;onTask:()=>void;onMemory:()=>void}){
  const preview=useGrowthPreview(child,online,identity,server),[tools,setTools]=useState(false),[linkError,setLinkError]=useState("");
  const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  function source(url:string){const safe=growthSourceUrl(url);if(!safe)return;void Linking.openURL(safe).catch(()=>{if(alive.current)setLinkError("未能開啟來源網頁，請稍後再試。");});}
  return <GrowthView model={preview.model} actions={preview.actions} onTask={onTask} onMemory={onMemory} onSource={source} previewTools={<SectionCard>
    <SectionHeader density="compact" title="合成關注情境" subtitle="不執行正式規則、背景處理或外發。" icon="information-outline" />
    {linkError?<Text style={s.warning}>{linkError}</Text>:null}
    <AppButton label={tools?"收起關注情境":"顯示關注情境"} variant="quiet" onPress={()=>setTools(value=>!value)} />
    {tools?<>
      <AppSelect label="關注資料情境" value={preview.condition} options={([{value:"normal",label:"一般"},{value:"empty",label:"沒有關注"},{value:"loading",label:"載入中"},{value:"read_error",label:"讀取失敗"},{value:"read_only",label:"唯讀"},{value:"lost",label:"失去存取"},{value:"source_unavailable",label:"來源或依據不可用"},{value:"fact_conflict",label:"近況衝突"},{value:"linked_task",label:"已有待覆核任務"},{value:"no_assignee",label:"沒有合資格負責人"}] as {value:GrowthCondition;label:string}[])} onChange={preview.changeCondition} />
      <AppSelect label="關注提交結果" value={preview.outcome} options={([{value:"success",label:"成功"},{value:"failed",label:"這次提交未獲接受"},{value:"unknown",label:"結果未知"},{value:"conflict",label:"版本衝突"}] as {value:GrowthOutcome;label:string}[])} onChange={preview.setOutcome} />
      <AppSelect label="關注重讀結果" value={preview.readScenario} options={([{value:"same",label:"同一對象仍可讀"},{value:"changed",label:"基準或授權版本已變"},{value:"missing",label:"最新頁面沒有原對象"},{value:"source_unavailable",label:"來源或依據已失效"}] as {value:GrowthRead;label:string}[])} onChange={preview.setReadScenario} />
      <Text style={s.meta}>預覽身份：{identity} · Server：{server}。切換會清理草稿及舊操作。</Text><AppButton label="切換關注預覽帳戶" variant="secondary" onPress={onIdentity} /><AppButton label="切換關注預覽 Server" variant="secondary" onPress={onServer} />
    </>:null}
  </SectionCard>} />;
}
export function GrowthScreen(){
  const {model,actions}=usePreview();const child=model.children.find(item=>item.id===model.selectedChildId);
  const [identity,setIdentity]=useState("合成媽媽"),[server,setServer]=useState("合成 A");
  return child?<GrowthWorkspace key={JSON.stringify([child.id,identity,server])} child={child} online={model.connection==="online"} identity={identity} server={server} onIdentity={()=>setIdentity(value=>value==="合成媽媽"?"合成爸爸":"合成媽媽")} onServer={()=>setServer(value=>value==="合成 A"?"合成 B":"合成 A")} onTask={()=>actions.open("tasks")} onMemory={()=>actions.open("memory")} />:
    <PageFrame density="compact" title="成長階段關注" description="先選擇有權存取的孩子。"><SectionCard><Text>沒有選擇孩子，不顯示其他孩子的關注。</Text><AppButton label="查看子女檔案" onPress={()=>actions.open("profile")} /></SectionCard></PageFrame>;
}
