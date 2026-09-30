import { z } from "zod";
import type { GrowthDecision, GrowthFactRef, GrowthTopic, GrowthTopicDecision } from "../../growth-view-model.ts";
import type { TaskAssigneeView, TaskFormValues } from "../../task-view-model.ts";
import { emptyTaskForm, taskFormSchema, taskValuesFromForm } from "../tasks/task-form.ts";

export type GrowthFormValues = TaskFormValues & { action:"accept"|"snooze"|"dismiss";taskMode:"none"|"create";until:string;closeNote:string };
export function growthFormDefaults(title:string,details:string):GrowthFormValues {return {...emptyTaskForm(),title,details,action:"accept",taskMode:"none",until:"",closeNote:""};}
export function growthFormSchema(assignees:TaskAssigneeView[],now=Date.now()){
  return z.object({title:z.string(),details:z.string(),kind:z.enum(["ordinary","appointment"]),assigneeUserId:z.string(),dueAt:z.string(),timeZone:z.string(),note:z.string(),outcome:z.enum(["","completed","cancelled"]),
    action:z.enum(["accept","snooze","dismiss"]),taskMode:z.enum(["none","create"]),until:z.string(),closeNote:z.string()}).superRefine((value,context)=>{
      if(value.action==="accept"&&value.taskMode==="create"){
        const result=taskFormSchema("create",assignees).safeParse(value);
        if(!result.success)for(const issue of result.error.issues)context.addIssue({code:"custom",path:issue.path,message:issue.message});
      }
      if(value.action==="snooze"&&(!z.iso.datetime({offset:true}).safeParse(value.until).success||Date.parse(value.until)<=now))context.addIssue({code:"custom",path:["until"],message:"請選擇將來的明確日期與時間。"});
      if(value.action==="dismiss"&&value.closeNote.length>1000)context.addIssue({code:"custom",path:["closeNote"],message:"關閉備註最多 1,000 字；不會截短原文。"});
    });
}
export function growthDecisionProjection(value:GrowthFormValues,version:number,authorityVersion:string):GrowthDecision{
  const basis={expectedVersion:version,authorityVersion,confirm:true as const};
  if(value.action==="snooze")return {...basis,action:value.action,until:value.until};
  if(value.action==="dismiss")return {...basis,action:value.action,note:value.closeNote};
  return {...basis,action:"accept",task:value.taskMode==="none"?{kind:"none"}:{kind:"create",values:taskValuesFromForm(value)}};
}
export function growthContextProjection(topic:GrowthTopic,authorityVersion:string,values:Record<string,string>):GrowthTopicDecision{
  if(topic.inputs.some(input=>input.conflict))throw new Error("Conflicting facts require memory review");
  const selected=topic.inputs.filter(input=>values[input.key]&&input.choices.some(choice=>choice.value===values[input.key]));
  if(!selected.length)throw new Error("Select at least one supplied context option");
  if(selected.some(input=>input.key.length>80||values[input.key].length>80))throw new Error("Supplied context option exceeds the contract limit");
  const facts=new Map<string,GrowthFactRef>();
  for(const input of topic.inputs)for(const fact of input.factRefs){if(facts.has(fact.id)&&facts.get(fact.id)!.version!==fact.version)throw new Error("Fact versions disagree");facts.set(fact.id,{...fact});}
  if(facts.size>200)throw new Error("Too many fact references for a context confirmation");
  return {action:"confirm_context",expectedVersion:topic.version,authorityVersion,confirm:true,confirmShared:true,
    values:Object.fromEntries(selected.map(input=>[input.key,values[input.key]])),expectedFacts:Array.from(facts.values()).sort((a,b)=>a.id.localeCompare(b.id))};
}
export const growthFactBasis=(topic:GrowthTopic)=>JSON.stringify(topic.inputs.map(input=>[input.key,input.factRefs]));
