import assert from "node:assert/strict";
import test from "node:test";
import { FinishReason } from "@google/genai";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import { createProductAgent } from "../server/product-agent.ts";
import { readAiConfig } from "../server/ai-config.ts";
import type { ProductAgentResult } from "../src/shared/product-agent.ts";

test("background contact tool records one intent and reports it after closing generation fails",async()=>{
 const userId="synthetic-caregiver",childId="1ebcb39d-a2db-4b8c-a432-7ffcb3de5808";
 const taskId="7de5a0e8-e106-4485-b7d2-3b572741da39",runId="d4a1b662-d13d-476b-bf52-40a28aa1a1a7";
 const requestId="f49a222e-77e4-4980-ae87-4c335b2b5c39";
 let calls=0,writes=0,claimed=false,saved:ProductAgentResult|null=null;
 const runtime=createAgentRuntime({config:readAiConfig({AI_ENABLED:"true",GCP_PROJECT_ID:"synthetic-project"}),usage:{reserve:async()=>true,record:async()=>{}},provider:{generate:async request=>{
  assert.ok(request.toolsDict.contact_caregiver);
  assert.equal(request.toolsDict.propose_fact,undefined);
  const n=calls++;
  if(n===2)throw new Error("Scripted closing failure");
  const functionCall=n===0?{id:"options",name:"read_contact_options",args:{taskId}}:{id:"contact",name:"contact_caregiver",args:{taskId,taskVersion:1,grantVersion:2,recipientUserId:userId}};
  return {content:{role:"model",parts:[{functionCall}]},finishReason:FinishReason.STOP};
 }}});
 const options={runtime,
  store:{claim:async()=>{const created=!claimed;claimed=true;return {runId,scope:{userId,childId,workspaceId:"synthetic",authorizationVersion:"1",dataVersion:"epoch:1"},created,expiresAt:new Date(Date.now()+90000).toISOString()};},
   authorize:async()=>true,finish:async(_scope:unknown,value:ProductAgentResult)=>{saved=value;return true;},get:async()=>saved},
  memory:{},chat:{listForUser:async()=>{throw new Error("No private context for a background contact");}},tasks:{},
  knowledge:{createRun:()=>({})},
  contact:{options:async()=>({eligible:true,taskId,taskVersion:1,grantVersion:2,recipientUserId:userId}),
   request:async(actor:string,child:string,value:{runId:string;taskId:string})=>{assert.equal(actor,userId);assert.equal(child,childId);assert.equal(value.runId,runId);assert.equal(value.taskId,taskId);writes++;return {id:requestId,state:"pending",attempts:[]};}},
 } as unknown as Parameters<typeof createProductAgent>[0];
 const agent=createProductAgent(options),input={userId,childId,reference:taskId,context:{},authorize:async()=>true};
 const first=await agent.background(input);
 assert.equal(first?.status,"stopped");assert.equal(writes,1,JSON.stringify(first));assert.equal(calls,3);
 assert.match(first!.text,/已記錄獲授權聯絡請求/);
 assert.ok(first!.tools.some(tool=>tool.name==="contact_caregiver"&&tool.reference===requestId&&tool.status==="succeeded"));
 assert.deepEqual(await agent.background(input),first);assert.equal(writes,1);assert.equal(calls,3);
});
