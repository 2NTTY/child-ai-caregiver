import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { growthProposals,growthBasisChanged,nextGrowthCheck } from "../server/growth-rules.ts";
import type { MemoryContext } from "../src/shared/memory.ts";
import type { KnowledgeEvidence,KnowledgeSourceInput } from "../src/shared/knowledge.ts";
const now=new Date("2026-09-28T00:00:00Z");
function context():MemoryContext{return {profile:{childId:"synthetic-child",version:1,confirmedBy:"synthetic-parent",confirmedAt:now.toISOString(),reason:null,
  data:{age:{kind:"birth_date",date:"2026-03-28"},dueDate:null,gestationalWeeksRaw:null,region:"HK",language:"zh-HK",allergies:null,specialNeeds:null,preferences:null,source:"synthetic",validUntil:null}},
  profileApplicable:true,facts:[],topics:[],summary:null,recentMessages:[],conflictingKeys:[],unavailableFactKeys:[],truncated:{facts:false,topics:false,messages:false}};}
function sources():KnowledgeEvidence[]{
  const raw=JSON.parse(readFileSync(new URL("../knowledge/hk-official-seed.json",import.meta.url),"utf8"));
  const entries:KnowledgeSourceInput[]=raw.sources??raw;
  return entries.flatMap(source=>source.chunks.map(chunk=>({...source,...chunk,chunkId:chunk.key,versionId:"synthetic-version",versionHash:"synthetic",
    contentHash:createHash("sha256").update(JSON.stringify(chunk)).digest("hex"),checkedAt:now.toISOString(),reviewState:"reviewed" as const})));
}
test("growth advice requires exact age and the reviewed published chunk",()=>{
  const ctx=context(),evidence=sources(),value=growthProposals(ctx,evidence,now).proposals[0];
  assert.equal(value?.topicId,"solid_food");
  assert.equal(value.basis.values["growth.solid_food"],"unknown");
  assert.match(value.whyNow,/沒有判定家長漏做/u);
  assert.equal(growthProposals(ctx,evidence.map(item=>({...item,contentHash:"changed"})),now).proposals.length,0);
  ctx.profile.data!.age={kind:"approximate",rawValue:"6",unit:"months",asOf:"2026-09-28"};
  assert.equal(growthProposals(ctx,evidence,now).proposals.length,0);
  assert.equal(nextGrowthCheck(ctx,now),null);
});
test("a closed basis changes only with substantive confirmed information, stage or rule",()=>{
  const basis=growthProposals(context(),sources(),now).proposals[0].basis;
  assert.equal(growthBasisChanged(basis,{...basis,values:{...basis.values}}),false);
  const known={...basis,values:{"growth.solid_food":"not_started"}};
  assert.equal(growthBasisChanged(known,basis),false);
  assert.equal(growthBasisChanged(basis,known),true);
});
