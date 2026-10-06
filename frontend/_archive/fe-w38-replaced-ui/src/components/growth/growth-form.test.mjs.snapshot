import assert from "node:assert/strict";
import test from "node:test";
import { growthContextProjection,growthDecisionProjection,growthFormDefaults,growthFormSchema } from "./growth-form.ts";
import { growthSourceUrl } from "../../growth-view-model.ts";

test("Acknowledgement ignores hidden task fields; task creation preserves raw content and requires eligible assignment",()=>{
  const defaults=growthFormDefaults("  原標題  ","  原內容  ");
  const schema=growthFormSchema([{userId:"mom",name:"媽媽"}],Date.parse("2026-10-01T00:00:00Z"));
  assert.deepEqual(growthDecisionProjection(schema.parse(defaults),3,"authority-old"),{action:"accept",expectedVersion:3,authorityVersion:"authority-old",confirm:true,task:{kind:"none"}});
  assert.equal(schema.safeParse({...defaults,taskMode:"create"}).success,false);
  const create={...defaults,taskMode:"create",assigneeUserId:"mom",dueAt:"2030-10-02T09:00:00+08:00"};
  const projected=growthDecisionProjection(schema.parse(create),3,"authority-old");
  assert.equal(projected.task.values.title,defaults.title);assert.equal(projected.task.values.details,defaults.details);assert.equal(projected.task.values.dueAt,create.dueAt);
  assert.equal(schema.safeParse({...create,assigneeUserId:"unknown"}).success,false);
  const long={...create,details:"a".repeat(2001)};assert.equal(schema.safeParse(long).success,false);assert.equal(long.details.length,2001);
});
test("Context confirms only explicit finite choices while freezing all original fact references",()=>{
  const topic={id:"preschool_development",title:"學前發展",version:8,disabled:false,inputs:[
    {key:"one",label:"一",choices:[{value:"yes",label:"是"}],value:null,conflict:false,factRefs:[{id:"b",version:2}]},
    {key:"two",label:"二",choices:[{value:"no",label:"否"}],value:null,conflict:false,factRefs:[{id:"a",version:3},{id:"b",version:2}]},
  ]};
  const value=growthContextProjection(topic,"authority-old",{one:"yes",two:"",unlisted:"no"});
  assert.deepEqual(value.values,{one:"yes"});assert.deepEqual(value.expectedFacts,[{id:"a",version:3},{id:"b",version:2}]);assert.equal(value.confirmShared,true);assert.equal(value.expectedVersion,8);
  assert.throws(()=>growthContextProjection(topic,"authority-old",{}),/Select/);
  assert.throws(()=>growthContextProjection({...topic,inputs:topic.inputs.map(input=>({...input,conflict:true}))},"authority-old",{one:"yes"}),/Conflicting/);
  assert.throws(()=>growthContextProjection({...topic,inputs:[...topic.inputs,{...topic.inputs[0],factRefs:[{id:"b",version:7}]}]},"authority-old",{one:"yes"}),/versions disagree/);
});
test("Snooze requires an explicit future instant and source links remain restricted to credential-free HTTPS",()=>{
  const now=Date.parse("2026-10-01T00:00:00Z");
  const schema=growthFormSchema([],now);
  const defaults={...growthFormDefaults("",""),action:"snooze"};
  assert.equal(schema.safeParse({...defaults,until:"2026-09-30T09:00:00+08:00"}).success,false);
  assert.equal(schema.safeParse({...defaults,until:"2030-10-02T09:00:00"}).success,false);
  const within="2026-10-02T09:00:00+08:00";
  assert.equal(schema.safeParse({...defaults,until:within}).success,true);
  const boundary=new Date(now+366*86400000).toISOString();
  const beyond=new Date(now+366*86400000+1).toISOString();
  assert.equal(schema.safeParse({...defaults,until:boundary}).success,true);
  const result=schema.safeParse({...defaults,until:beyond});
  assert.equal(result.success,false);
  assert.equal(result.error.issues.find(issue=>issue.path[0]==="until")?.message,"最多可延後 366 天；請選擇較早的時間。");
  assert.equal(growthDecisionProjection(schema.parse({...defaults,until:within}),3,"authority-old").until,within);
  for(const url of ["javascript:alert(1)","http://example.com","https://user:pass@example.com"," https://example.com"])assert.equal(growthSourceUrl(url),null);
  assert.equal(growthSourceUrl("https://www.fhs.gov.hk/"),"https://www.fhs.gov.hk/");
});
