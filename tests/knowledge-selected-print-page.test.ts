import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { assembleKnowledgePdfWindows, readKnowledgePdfWindow, type WindowReading } from '../server/knowledge-pdf-windows.ts';
import { selectedPrintWindow } from '../server/knowledge-pdf-layout.ts';
import { checkKnowledgeObservation } from '../server/knowledge-observation.ts';
import { campaignMaterialWatches } from '../server/platform-materials.ts';

const definition = campaignMaterialWatches.find(row => row.kind === 'pdf' && Boolean(row.leafletPage))!;
const hash = 'b'.repeat(64), observedHash = 'a'.repeat(64);
const observed = {url:definition.url,title:'Fixture booklet',text:'',sourcePublishedAt:null,sourceUpdatedAt:null,sourceDateText:null,
  nativeWindowMethod:'native-pdf-window/1' as const,extraction:{format:'text_pdf' as const,contentHash:hash,totalPages:8,pageStart:1,pageEnd:8,complete:false}};
const candidate = {watchId:definition.id,definition,observed,observationHash:observedHash,previousObservationHash:null};
const scope = {physicalPage:5,question:'How does the weekly chart work?',fields:[{key:'goal',label:'Goal'},{key:'reward',label:'Reward'}]};
const facts = {goal:'Locate the workshop',reward:'A blue pass'};
const findings = [{page:5,status:'content' as const,reason:'The physical page contains a chart.'}];
const checks = {age:'Checked',numbersAndUnits:'Checked',timing:'Checked',conditions:'Checked',exceptions:'Checked',prohibitions:'Checked',withdrawal:'Checked'};
const reading:WindowReading = {parentHash:hash,sliceHash:'c'.repeat(64),method:'native-pdf-window/1',first:5,last:5,firstRead:5,lastRead:5,
  organizeKey:'knowledge-window-organize:'+'1'.repeat(64),reviewKey:'knowledge-window-review:'+'2'.repeat(64),
  pages:findings,organizePages:findings,originalLocations:{'pages-5-5':{physicalPage:5,kind:'visual_page'}},
  selectedPage:{scope,organize:facts,review:facts},
  chunks:[{key:'pages-5-5',section:scope.question,text:scope.question+'\nGoal：Locate the workshop\nReward：A blue pass',sourceExcerpt:'',originalKind:'visual_page',pageStart:5,pageEnd:5,
    keywords:['chart'],treatment:{kind:'overview',policyVersion:1},applicability:{region:'HK',ageBasis:'unconfirmed',minAgeMonths:null,maxAgeMonths:null,topics:['parenting'],conditions:[],use:'original_lookup'}}],
  previousChanges:{},checks,explanations:{'pages-5-5':'The two readings match.'}};

test('a scoped window certifies only physical page five of the original eight-page edition',()=>{
  const input = {candidate,baseline:null,windows:[reading],fetchedAt:'2026-01-01T00:00:00Z',packVersion:'fixture',growthRules:[],selectedPage:scope};
  const prepared=assembleKnowledgePdfWindows(input);
  assert.deepEqual(prepared.source.extraction,{...observed.extraction,pageStart:5,pageEnd:5,complete:false});
  const original={content_hash:observedHash,unavailable:false,document:observed,url:definition.url};
  const verify=(proof?:boolean|{physicalPage:number})=>checkKnowledgeObservation(prepared.source,{enabled:true,definition},original,observedHash,proof);
  verify({physicalPage:5});
  assert.throws(()=>verify(),/window_review_required/);
  assert.throws(()=>verify(true),/window_review_required/);
  assert.throws(()=>verify({physicalPage:4}),/window_review_required/);
  assert.throws(()=>assembleKnowledgePdfWindows({...input,selectedPage:{...scope,physicalPage:6}}));
  const textEdition={...observed,text:'An optional text layer',nativeWindowMethod:undefined,extraction:{...observed.extraction,complete:true}};
  checkKnowledgeObservation(prepared.source,{enabled:true,definition},{...original,document:textEdition},observedHash,{physicalPage:5});
  assert.throws(()=>assembleKnowledgePdfWindows({...input,windows:[{...reading,selectedPage:{scope,organize:facts,review:{...facts,reward:'Different'}}}]}));
});

test('an independent disagreement or hold on the chart never produces a reviewed window',async()=>{
  const bytes=Buffer.from('%PDF-synthetic attachment'), sliceHash=createHash('sha256').update(bytes).digest('hex');
  for (const verdict of [{decision:'approve',facts:{...facts,reward:'Different'}},{decision:'hold',facts}]) {
    const calls:string[]=[];
    await assert.rejects(readKnowledgePdfWindow({candidate,baseline:null,range:selectedPrintWindow(scope,8),selectedPage:scope,
      bytes,sliceHash,textLayers:[],async completeText(request) {
        calls.push(request.role!);
        assert.ok(!request.user.includes(facts.goal));
        return JSON.stringify({decision:'approve',finding:'Read the chart',facts,...(calls.length===2?{...verdict,checks}:{})});
      }}),/knowledge_window_review_held/);
    assert.deepEqual(calls,['knowledge_organize','knowledge_review']);
  }
});
