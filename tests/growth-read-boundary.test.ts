import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import type { Pool } from "pg";
import type { MemoryContext } from "../src/shared/memory.ts";
import type { GrowthAttention } from "../src/shared/growth.ts";
import type { StorageCipher } from "../server/storage-crypto.ts";
import { agentKnowledgeFilter } from "../server/product-agent-tools.ts";
import { parseKnowledgeFilter } from "../server/knowledge-inputs.ts";
import { handleGrowthRequest } from "../server/growth-api.ts";

const childId="00000000-0000-4000-8000-000000000001", userId="synthetic-parent";
function context(region: string | null): MemoryContext {
  return {profile:{childId,version:1,confirmedBy:userId,confirmedAt:"2026-10-07T00:00:00Z",reason:null,
    data:{age:{kind:"unknown"},dueDate:null,gestationalWeeksRaw:null,region,language:"zh-HK",allergies:null,
      specialNeeds:null,preferences:null,source:"synthetic",validUntil:null}},profileApplicable:true,facts:[],topics:[],summary:null,
    recentMessages:[],conflictingKeys:[],unavailableFactKeys:[],truncated:{facts:false,topics:false,messages:false}};
}

test("free-text profiles reproduce the strict knowledge contract mismatch without a database",()=>{
  for(const region of ["合成地區 A","合成地區 B"]){
    const profile=context(region);
    assert.equal(agentKnowledgeFilter(profile).region,region);
    assert.throws(()=>parseKnowledgeFilter(agentKnowledgeFilter(profile)),z.ZodError);
    assert.equal(profile.profile.data!.region,region);
  }
});

test("Growth GET degrades only unsupported profile filters and keeps writes strict",async t=>{
  let profile=context("HK"), fault: "knowledge" | "records" | "memory" | "decrypt" | null=null;
  let records: {payload_encrypted:string}[]=[];
  const queries: {sql:string;values:unknown[]}[]=[], scopes:string[]=[];
  const dbError=new Error("synthetic database failure"), decryptError=new Error("synthetic decryption failure");
  const query=async(sql:string,values:unknown[]=[])=>{
    queries.push({sql,values});
    if(sql.includes("FROM knowledge_sources s")){
      if(fault==="knowledge")throw dbError;
      return {rows:[],rowCount:0};
    }
    if(sql.includes("SELECT * FROM growth_attention") && fault==="records")throw dbError;
    let rows:unknown[]=[];
    if(sql.includes("SELECT * FROM growth_attention")) return {rows:records,rowCount:records.length};
    if(sql.includes("SELECT workspace_id FROM children")) rows=[{workspace_id:"synthetic-workspace"}];
    else if(sql.includes("SELECT owner_user_id")) rows=[{owner_user_id:userId,access_version:1}];
    else if(sql.includes("SELECT 1 FROM children")) rows=[{}];
    else if(sql.includes("SELECT storage_epoch")) rows=[{storage_epoch:"synthetic-epoch",access_version:"1"}];
    else if(sql.includes("FROM worker_control")) rows=[{enabled:true,generation:"synthetic-generation",storage_epoch:"synthetic-epoch"}];
    return {rows,rowCount:rows.length};
  };
  const client={query,release(){}}, pool={query,async connect(){return client;}} as unknown as Pool;
  // Use real family access, transaction borrowing, knowledge parser/query and Growth store/API.
  // Only encrypted memory and unrelated task reads are replaced with synthetic store fixtures.
  const moduleOptions=(exports:Record<string,unknown>)=>({cache:false,exports});
  t.mock.module("../server/memory.ts",moduleOptions({createMemoryStore:()=>({async context(_user:string,_child:string,scope:string){
    scopes.push(scope); if(fault==="memory")throw decryptError; return profile;
  }})}));
  t.mock.module("../server/tasks.ts",moduleOptions({createTaskStore:()=>({async list(){return {items:[],eligibleAssignees:[]};}})}));
  const {createGrowthStore}=await import("../server/growth-store.ts");
  const cipher={decrypt:(payload:string)=>{if(fault==="decrypt")throw decryptError;return payload;}} as unknown as StorageCipher;
  const store=createGrowthStore(pool,cipher);
  const request=()=>new Request("https://synthetic.invalid/api/children/"+childId+"/growth",{headers:{"x-expected-user-id":userId}});
  const get=()=>handleGrowthRequest(request(),userId,store,async()=>true);
  function reset(region:string|null){profile=context(region);fault=null;records=[];queries.length=0;scopes.length=0;}
  const knowledgeQueries=()=>queries.filter(it=>it.sql.includes("FROM knowledge_sources s"));
  const mutations=()=>queries.filter(it=>/^\s*(UPDATE|INSERT|DELETE)\b/iu.test(it.sql));

  await t.test("synthetic A/B and missing regions remain readable without HK fallback",async()=>{
    for(const region of ["合成地區 A","合成地區 B",null,""]){
      reset(region);const before=structuredClone(profile),response=await get();
      assert.equal(response.status,200);
      const {page}=await response.json();
      assert.equal(page.authorityVersion,"synthetic-epoch:1");assert.equal(page.topics.length,4);
      assert.match(page.notices.join(" "),/地域|地區/u);
      assert.equal(knowledgeQueries().length,0);assert.equal(mutations().length,0);
      assert.deepEqual(profile,before);assert.deepEqual(scopes,["family"]);
    }
  });
  await t.test("valid regions and HK aliases keep the existing exact filter",async()=>{
    for(const [region,expected]of [["HK","HK"],["香港","HK"],["Hong Kong","HK"],["CN","CN"]]){
      reset(region);assert.equal((await get()).status,200);
      assert.equal(knowledgeQueries().length,1);assert.equal(knowledgeQueries()[0].values[5],expected);
      assert.equal(profile.profile.data!.region,region);assert.equal(mutations().length,0);
    }
  });
  await t.test("ages beyond 10 years remain readable without broadening the 120-month contract",async()=>{
    for(const years of [11,19]){
      reset("HK");const date=new Date();date.setUTCFullYear(date.getUTCFullYear()-years);
      profile.profile.data!.age={kind:"birth_date",date:date.toISOString().slice(0,10)};
      const before=structuredClone(profile),response=await get();assert.equal(response.status,200);
      assert.match((await response.json()).page.notices.join(" "),/0–10/u);
      assert.equal(knowledgeQueries().length,0);assert.deepEqual(profile,before);
    }
    const exact=context("HK");exact.profile.data!.age={kind:"birth_date",date:"2016-10-07"};
    assert.equal(parseKnowledgeFilter(agentKnowledgeFilter(exact,new Date("2026-10-07T00:00:00Z"))).age!.minMonths,120);
    assert.throws(()=>parseKnowledgeFilter(agentKnowledgeFilter(exact,new Date("2026-10-08T00:00:00Z"))),z.ZodError);
  });
  const saved: GrowthAttention = {id:"00000000-0000-4000-8000-000000000002",childId,topicId:"solid_food",version:3,state:"proposed",
    title:"Synthetic saved attention",kind:"observe",whyNow:"Synthetic prior basis",advice:"Synthetic advice",limits:"Synthetic limits",
    basis:{stage:"6-12",ruleRevision:"synthetic",sourceHash:"synthetic",values:{}},evidence:{profileVersion:1,facts:[]},
    source:{sourceId:"synthetic-source",versionId:"synthetic-version",chunkId:"synthetic-chunk",contentHash:"synthetic-hash",
      url:"https://www.fhs.gov.hk/synthetic",title:"Synthetic source",section:"Synthetic section",checkedAt:"2026-10-07T00:00:00Z",excerpt:"Synthetic excerpt"},
    sourceAvailable:true,createdAt:"2026-10-06T00:00:00Z",updatedAt:"2026-10-06T00:00:00Z",snoozeUntil:null,previousId:null,
    newReason:"Synthetic reason",taskId:null,taskState:null,lastAction:"created",actorUserId:null,note:""};
  await t.test("saved candidates stay readable and unchanged while source applicability is explicitly unconfirmed",async()=>{
    reset("合成地區 A");records=[{payload_encrypted:JSON.stringify({item:saved,lastRequest:null})}];
    const before=structuredClone(records),response=await get();assert.equal(response.status,200);
    const item=(await response.json()).page.items[0];
    assert.deepEqual(item,{...saved,sourceAvailable:false});
    assert.deepEqual(records,before);assert.equal(mutations().length,0);
  });
  await t.test("database and decryption failures are not converted to successful empty pages",async()=>{
    for(const failure of ["knowledge","records","memory","decrypt"] as const){
      reset(failure==="knowledge"?"HK":"合成地區 A");fault=failure;if(failure==="decrypt")records=[{payload_encrypted:JSON.stringify({item:saved,lastRequest:null})}];
      await assert.rejects(()=>store.list(userId,childId),["memory","decrypt"].includes(failure)?decryptError:dbError);
      const response=await get();assert.equal(response.status,503);
      assert.equal((await response.json()).error.code,"growth_unavailable");
    }
  });
  await t.test("topic writes and worker evaluation retain strict validation before any mutation",async()=>{
    reset("合成地區 A");
    await assert.rejects(()=>store.topic(userId,childId,"solid_food",{authorityVersion:"synthetic-epoch:1",expectedVersion:1,confirm:true,action:"set_enabled",enabled:false}),z.ZodError);
    assert.equal(mutations().length,0);
    queries.length=0;
    await assert.rejects(()=>store.evaluate(userId,childId,{workerGeneration:"synthetic-generation",storageEpoch:"synthetic-epoch"}),z.ZodError);
    assert.equal(mutations().length,0);
    assert.equal(knowledgeQueries().length,0);
  });
});
