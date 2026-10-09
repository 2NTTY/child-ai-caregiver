import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { GROWTH_RULES,growthProposals,growthBasisChanged,nextGrowthCheck } from "../server/growth-rules.ts";
import { knowledgeHash,parseKnowledgeSource } from "../server/knowledge-inputs.ts";
import type { MemoryContext } from "../src/shared/memory.ts";
import type { KnowledgeEvidence,KnowledgeSourceInput } from "../src/shared/knowledge.ts";
const now=new Date("2026-09-28T00:00:00Z");
function context():MemoryContext{return {profile:{childId:"synthetic-child",version:1,confirmedBy:"synthetic-parent",confirmedAt:now.toISOString(),reason:null,
  data:{age:{kind:"birth_date",date:"2026-03-28"},dueDate:null,gestationalWeeksRaw:null,region:"HK",language:"zh-HK",allergies:null,specialNeeds:null,preferences:null,source:"synthetic",validUntil:null}},
  profileApplicable:true,facts:[],topics:[],summary:null,recentMessages:[],conflictingKeys:[],unavailableFactKeys:[],truncated:{facts:false,topics:false,messages:false}};}
// Version-contract coverage uses original pinned chunks, not approval of the current seed.
function sources(path="./fixtures/growth-reviewed-chunks-20260924.json"):KnowledgeEvidence[]{
  const raw=JSON.parse(readFileSync(new URL(path,import.meta.url),"utf8"));
  const entries:KnowledgeSourceInput[]=raw.sources??raw;
  return entries.flatMap(source=>source.chunks.map(chunk=>({...source,...chunk,chunkId:chunk.key,versionId:"synthetic-version",versionHash:"synthetic",
    contentHash:createHash("sha256").update(JSON.stringify(chunk)).digest("hex"),checkedAt:now.toISOString(),reviewState:"reviewed" as const})));
}
function importedCurrentSources():KnowledgeEvidence[]{
  const raw=JSON.parse(readFileSync(new URL("../knowledge/hk-official-seed.json",import.meta.url),"utf8"));
  const entries:unknown[]=raw.sources??raw;
  // Match knowledge-store importSource: parse first, then hash the parsed chunk.
  return entries.map(parseKnowledgeSource).flatMap(source=>source.chunks.map(chunk=>({...source,...chunk,
    chunkId:chunk.key,versionId:"synthetic-imported-version",versionHash:"synthetic",
    contentHash:knowledgeHash(chunk),checkedAt:now.toISOString(),reviewState:"reviewed" as const})));
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
test("historical original chunks actually hash to all four reviewed rule pins",()=>{
  const evidence=sources();
  assert.equal(evidence.length,GROWTH_RULES.length);
  for(const rule of GROWTH_RULES){
    const source=evidence.find(item=>item.sourceId===rule.sourceId&&item.key===rule.key);
    assert.ok(source);assert.equal(source.contentHash,rule.hash);
    const ctx=context(),birth=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-rule.start,now.getUTCDate()));
    ctx.profile.data!.age={kind:"birth_date",date:birth.toISOString().slice(0,10)};
    const result=growthProposals(ctx,evidence,now);
    assert.deepEqual(result.proposals.map(item=>item.topicId),[rule.id]);
    assert.deepEqual(result.notices,[]);
  }
});
test("raw and imported current seed hash mismatches fail closed with a source notice in every rule window",()=>{
  for(const [mode,evidence] of [["raw",sources("../knowledge/hk-official-seed.json")],["imported",importedCurrentSources()]] as const){
    for(const rule of GROWTH_RULES){
      const source=evidence.find(item=>item.sourceId===rule.sourceId&&item.key===rule.key);
      assert.ok(source);assert.notEqual(source.contentHash,rule.hash,`${mode}: ${rule.id}`);
      const ctx=context(),birth=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-rule.start,now.getUTCDate()));
      ctx.profile.data!.age={kind:"birth_date",date:birth.toISOString().slice(0,10)};
      const result=growthProposals(ctx,evidence,now);
      assert.deepEqual(result.proposals,[],`${mode}: ${rule.id}`);
      assert.equal(result.notices.length,1);
      assert.ok(result.notices[0].startsWith(rule.title));
      assert.match(result.notices[0],/已核對來源暫未可用/u);
    }
  }
});
