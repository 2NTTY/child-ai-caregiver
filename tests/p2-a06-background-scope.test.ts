import assert from "node:assert/strict";
import test from "node:test";
import { FinishReason } from "@google/genai";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import { createProductAgent } from "../server/product-agent.ts";
import { readAiConfig } from "../server/ai-config.ts";
import type { ProductAgentResult } from "../src/shared/product-agent.ts";

test("private continuation reads owned work and prior result without mutation or external tools", async () => {
  const userId="synthetic-owner",childId="1ebcb39d-a2db-4b8c-a432-7ffcb3de5808",runId="d4a1b662-d13d-476b-bf52-40a28aa1a1a7";
  const previousId="7de5a0e8-e106-4485-b7d2-3b572741da39",workId="a4b1f891-837e-4b8c-9afb-584d835f4339";
  const scope={userId,childId,workspaceId:"synthetic-space",authorizationVersion:"1",dataVersion:"epoch:1"};
  const requestSizes: number[]=[];
  let observed: Record<string, unknown>|undefined;
  let calls=0, reads=0, saved:ProductAgentResult|null=null, claimed=false;
  const prior={runId:previousId,status:"completed",stopReason:null,provenance:null,text:"原".repeat(5000),tools:[],citations:[],retrievalMode:"not_used",counts:{modelCalls:1,toolCalls:1,queryEmbeddings:0},proposals:[]} as ProductAgentResult;
  const runtime=createAgentRuntime({config:readAiConfig({AI_ENABLED:"true",GCP_PROJECT_ID:"synthetic-project"}),
    usage:{reserve:async()=>true,record:async()=>{}},provider:{generate:async request=>{
      requestSizes.push(JSON.stringify({contents:request.contents,config:request.config}).length);
      for(const name of ["save_work","request_confirmation","propose_task","contact_caregiver","generate_family_document","propose_fact_revision"])
        assert.equal(Object.hasOwn(request.toolsDict,name),false,name);
      assert.ok(request.toolsDict.read_work && request.toolsDict.read_background_result && request.toolsDict.present_answer);
      const step=calls++;
      assert.ok(request.toolsDict.load_capabilities);
      assert.equal(Boolean(request.toolsDict.read_family_documents),step>0);
      if(step===2){const replies=request.contents.flatMap(c=>c.parts??[]).filter(p=>p.functionResponse?.name==="read_background_result");
        observed=replies.at(-1)?.functionResponse?.response as Record<string,unknown>|undefined;}
      const list=step===0 ? [{id:"context",name:"read_context",args:{}},{id:"work",name:"read_work",args:{workId,cursor:null}},{id:"readers",name:"load_capabilities",args:{capabilities:["documents"]}}]
        : step===1 ? [{id:"old-result",name:"read_background_result",args:{runId:previousId,offset:4000,limit:1000}}]
        : [{id:"answer",name:"present_answer",args:{kind:"clarification",paragraphs:[{text:"資料有更新；請回到原工作核對下一步。",citationIds:[]}]}}];
      return {content:{role:"model",parts:list.map(functionCall=>({functionCall}))},finishReason:FinishReason.STOP};
    }}});
  const options={runtime,store:{claim:async()=>{const created=!claimed;claimed=true;return {runId,scope,created,state:"running",expiresAt:new Date(Date.now()+90000).toISOString()};},authorize:async()=>true,
    readWork:async(u:string,c:string)=>{assert.equal(u,userId);assert.equal(c,childId);reads++;return {items:[{id:workId,goal:"本人待答工作",status:"waiting",version:1}],complete:true,nextCursor:null};},
    finish:async(_scope:unknown,value:ProductAgentResult)=>{saved=value;return true;},get:async(u:string,c:string,id:string)=>{assert.equal(u,userId);assert.equal(c,childId);return id===previousId?prior:saved;}},
    memory:{context:async(_u:string,_c:string,visibility:string)=>{assert.equal(visibility,"private");return {profile:{childId,data:null},profileApplicable:false,facts:[],topics:[],summary:null,recentMessages:[],conflictingKeys:[],unavailableFactKeys:[],truncated:{messages:false}};}},
    tasks:{list:async()=>({items:[],eligibleAssignees:[],nextAfterId:null})},chat:{},
    knowledge:{createRun:()=>({search:async()=>({mode:"vector_keyword",chunks:[]}),revalidateCitations:async()=>true})},
    // Even if a caller supplies these services, the trusted continuation scope does not expose their tools.
    contact:{options:async()=>{throw Error("No external contact");}},actions:{},documents:{},concerns:{},sources:{}
  } as unknown as Parameters<typeof createProductAgent>[0];
  const agent=createProductAgent(options),input={userId,childId,reference:previousId,context:{eventType:"work_continuation",textPartial:true,works:Array.from({length:5},(_,i)=>({workId,goal:`Synthetic work ${i}`,sourceSummary:"合".repeat(550)}))},authorize:async()=>true};
  const result=await agent.background(input);assert.equal(result?.status,"completed",JSON.stringify({result,requestSizes}));assert.equal(calls,3);assert.equal(reads,1);
  assert.ok(result?.tools.every(tool=>tool.status==="succeeded"),JSON.stringify(result?.tools));
  const page=(observed?.data as {result?:Record<string,unknown>}|undefined)?.result;
  assert.ok(page,JSON.stringify(observed));
  assert.equal(typeof page.text,"string");
  const pageText=page.text as string;
  assert.ok(pageText.length>0 && pageText.length<=1000,JSON.stringify({reason:"Remaining context permits a bounded, nonempty page",requestSizes,page}));
  assert.equal(pageText,"原".repeat(pageText.length));
  const end=4000+pageText.length;
  assert.equal(page.complete,end===5000);assert.equal(page.nextOffset,end<5000?end:null);
  assert.equal(page.budgetLimited,end<5000);
  assert.equal(page.evidenceUse,"historical_result_not_current_evidence");
  assert.deepEqual(await agent.background(input),result);assert.equal(calls,3,"Original event never generates twice");
});
