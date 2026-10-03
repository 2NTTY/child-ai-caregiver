import { usePreviewLeaveGuard } from "../../preview/PreviewNavigationGuard";
import { useRef,useState } from "react";
import { View } from "react-native";
import { HelperText,Text } from "react-native-paper";
import { Controller,useForm,useWatch, useFormState } from "react-hook-form";
import type { GrowthActions,GrowthTopic,GrowthViewModel } from "../../growth-view-model";
import { AppCheckbox } from "../AppCheckbox";
import { AppButton,AppSelect,SectionCard,SectionHeader } from "../ui";
import { growthContextProjection,growthFactBasis } from "./growth-form";
import { growthStyles as s } from "./growth-styles";

export function GrowthTopicCard({topic,model,actions,onMemory}:{topic:GrowthTopic;model:GrowthViewModel;actions:GrowthActions;onMemory:()=>void}){
  const [open,setOpen]=useState(false),[shared,setShared]=useState(false),[enabled,setEnabled]=useState(false),[error,setError]=useState("");
  const basis=useRef<{topic:GrowthTopic;authorityVersion:string}|null>(null);
  // Wire keys can contain punctuation; use stable local field names instead of RHF path parsing.
  const {control,getValues}=useForm<Record<string,string>>({defaultValues:Object.fromEntries(topic.inputs.map((_,index)=>[`choice_${index}`,""]))});
  const { isDirty } = useFormState({ control });
  usePreviewLeaveGuard(isDirty);
  const choices=useWatch({control});
  const authorityVersion=model.page!.authorityVersion;
  const captured=basis.current??{topic,authorityVersion};
  const changed=!!basis.current&&(captured.topic.version!==topic.version||captured.authorityVersion!==authorityVersion||growthFactBasis(captured.topic)!==growthFactBasis(topic));
  const disabled=model.locked||changed||model.missingTargets.includes(`topic:${topic.id}`);
  const conflict=topic.inputs.some(input=>input.conflict);
  const chosen=(inputIndex:number)=>choices[`choice_${inputIndex}`]??"";
  const selected=topic.inputs.filter((input,index)=>chosen(index)&&input.choices.some(choice=>choice.value===chosen(index)));
  function mark(){if(!basis.current)basis.current={topic:JSON.parse(JSON.stringify(topic)) as GrowthTopic,authorityVersion};actions.markDirty(`topic:${topic.id}`);}
  function save(){if(disabled||!shared||conflict)return;try{const fields=getValues();const values=Object.fromEntries(captured.topic.inputs.map((input,index)=>[input.key,fields[`choice_${index}`]??""]));const input=growthContextProjection(captured.topic,captured.authorityVersion,values);setError("");actions.updateTopic(captured.topic,input);}catch{setError("請核對有限選項及原資料版本；衝突的近況需到記憶區覆核。");}}
  return <SectionCard testID={`growth-topic-${topic.id}`}><SectionHeader density="compact" title={topic.title} subtitle={topic.disabled?"已永久停用":"已啟用"} icon="sprout" />
    <AppButton label={open?`收起${topic.title}設定`:`查看${topic.title}設定`} variant="quiet" onPress={()=>setOpen(value=>!value)} />
    {open?<View style={s.smallStack}>
      <Text style={s.meta}>只保存這次明確選擇的近況；未知或不選的欄位保持原狀。已確認資料會供獲授權家庭成員查看。</Text>
      {changed?<Text style={s.warning}>主題、資料或授權版本已改變，原選擇保留；先核對最新內容，再明確放棄草稿並重新核對。</Text>:null}
      {conflict?<><Text style={s.warning}>近況存在衝突，這裏不能直接覆蓋。請先到記憶區覆核。</Text><AppButton label="到記憶區核對" variant="secondary" onPress={onMemory} /></>:null}
      {topic.inputs.map((input,index)=><View key={input.key} style={s.smallStack}><Text style={s.title}>{input.label}</Text>
        <Text style={s.meta}>目前已確認：{input.conflict?"資料有衝突":input.choices.find(choice=>choice.value===input.value)?.label??"尚未確認"}</Text>
        {model.page?.canManage?<Controller name={`choice_${index}`} control={control} render={({field})=><AppSelect label={`${topic.title}：${input.label}`} value={field.value??""} options={[{value:"",label:"這次不確認此項"},...input.choices]} disabled={disabled||input.conflict} onChange={value=>{field.onChange(value);mark();setShared(false);setError("");}} />}/>:null}
      </View>)}
      {model.page?.canManage?<>
        {topic.inputs.length?<>
          {!selected.length?<Text style={s.meta}>至少明確選擇一項近況；不知道可以留空。</Text>:null}
          {selected.map(input=><Text key={input.key} style={s.body}>這次確認：{input.label} · {input.choices.find(choice=>choice.value===chosen(topic.inputs.indexOf(input)))?.label}</Text>)}
          <AppCheckbox label={`我同意保存${topic.title}所選近況為家庭共享已確認資料`} checked={shared} disabled={disabled||conflict||!selected.length} onChange={value=>{mark();setShared(value);}} />
          <AppButton label={`明確保存${topic.title}所選近況`} disabled={disabled||conflict||!selected.length||!shared} onPress={save} />
        </>:null}
        <View style={s.divider}><AppCheckbox label={topic.disabled?`我同意重新啟用${topic.title}`:`我同意永久停用${topic.title}`} checked={enabled} disabled={disabled} onChange={value=>{mark();setEnabled(value);}} />
          <AppButton label={topic.disabled?`明確重新啟用${topic.title}`:`明確永久停用${topic.title}`} variant="secondary" disabled={disabled||!enabled}
            onPress={()=>actions.updateTopic(captured.topic,{action:"set_enabled",authorityVersion:captured.authorityVersion,expectedVersion:captured.topic.version,confirm:true,enabled:captured.topic.disabled})} />
          <Text style={s.meta}>重新啟用只恢復未來適用性評估；已關閉的舊記錄保持終態，連結任務另行核對。</Text>
        </View>
      </>:null}
      {error?<HelperText type="error" accessibilityRole="alert">{error}</HelperText>:null}
    </View>:null}
  </SectionCard>;
}
