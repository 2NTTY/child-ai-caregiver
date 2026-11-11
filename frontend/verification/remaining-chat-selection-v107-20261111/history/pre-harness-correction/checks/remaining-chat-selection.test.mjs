import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {host,choices,catalog} from './host.mjs';
import {loadRealDocument} from './real-lifecycle.mjs';
import {chatScreen} from './chat-harness.mjs';
import * as v106Choices from '../history/public-v106/dist/experiments/workbench-compare/design-choices.mjs';

// Copied from the separately sealed investigation, never derived from candidate catalog/build output.
const sources=JSON.parse(fs.readFileSync(new URL('remaining-chat-sources.json',import.meta.url),'utf8'));
const ids=['original','journal','uiux-upgrade'];
const v106Root=new URL('../history/public-v106/dist/experiments/workbench-compare/',import.meta.url);
const count=h=>h.ids['choice-list'].children.length;
const context=(id,route='/chat?previewScenario=ready')=>({version:catalog.versions.find(v=>v.id===id),actualRoute:route,observation:{sourceIdentityObserved:true,route},rendered:true,visible:true});
async function initial(variant,{side='left',historical=false}={}){
 const h=host(historical?{appRoot:v106Root,choiceModule:v106Choices}:undefined);
 h.ids.route.value='chat';h.ids[side+'-version'].value=variant;h.setAnswer(true);await h.click('apply');h.setAnswer(false);
 await chatScreen(h,side);const life=await loadRealDocument(h,side);return {h,life,side};
}
async function bootstrap(h,life,side='left'){
 await life.replace('/',{deliver:false});await chatScreen(h,side);await life.flush();
 await life.replace('/chat');await chatScreen(h,side,{ready:true});
}
async function exported(h){await h.click('copy-choices');const s=h.copied.at(-1);return {text:s,json:JSON.parse(s.slice(s.indexOf('{')))};}

const badWitnesses=[['missing',{missing:true}],['hidden',{hidden:true}],['inert',{inert:true}],['aria-hidden',{ariaHidden:true}],['display-none',{style:{display:'none'}}],['visibility-hidden',{style:{visibility:'hidden'}}],['transparent',{style:{opacity:'0'}}],['zero-width',{rect:{width:0,height:90}}],['zero-height',{rect:{width:120,height:0}}]];
const badGates=[['loading',{ready:false}],['error-data',{data:'error'}],['loading-data',{data:'loading'}],['loading-state',{gate:{'data-startup-state':'loading'}}],['busy',{gate:{'aria-busy':'true'}}],['missing-gate',{gate:{'data-testid':'unrelated'}}],['hidden-parent',{ancestor:{hidden:true}}],['inert-parent',{ancestor:{inert:true}}],['aria-hidden-parent',{ancestor:{ariaHidden:true}}],['display-none-parent',{ancestor:{style:{display:'none'}}}],['visibility-hidden-parent',{ancestor:{style:{visibility:'hidden'}}}],['transparent-parent',{ancestor:{style:{opacity:'0'}}}]];

for(const expected of sources){const variant=expected.variant;
 // Break caught: any newly admitted design skips the existing initial readiness wait.
 test(`${variant} Chat startup stays inert with honest waiting until real readiness`,async()=>{
  const {h}=await initial(variant);assert.equal(h.frame('left').inert,true);assert.equal(h.frame('left').tabIndex,-1);assert.equal(h.ids['left-pick'].disabled,true);
  assert.match(h.ids['left-unavailable'].textContent,/等候.*助手/);assert.match(h.ids['left-pick-note'].textContent,/等候|未就緒/);assert.doesNotMatch(h.ids['left-pick-note'].textContent,/已在這側切換|已.*驗收/);
  await h.click('left-pick');assert.equal(count(h),0);
 });

 // Break caught: bootstrap Home locks new Chat or pending controls corrupt the loaded receipt.
 test(`${variant} ready Chat survives Home bootstrap and exports its independent loaded pins`,async()=>{
  const side=variant==='journal'?'right':'left';const {h,life}=await initial(variant,{side});await bootstrap(h,life,side);
  assert.equal(h.ids[side+'-pick'].disabled,false);assert.equal(h.frame(side).inert,false);assert.equal(h.ids[side+'-part-pick'].disabled,true);assert.equal(h.ids[side+'-parts'].hidden,true);
  h.ids[side+'-version'].value='care';h.ids.route.value='photos';await h.event('resize',{});await h.click('swap');
  assert.equal(h.ids[side+'-pick'].disabled,false);assert.match(h.ids[side+'-pick-note'].textContent,/可選整個頁面/);
  await h.click(side+'-pick');await h.click(side+'-pick');assert.equal(count(h),1);const {json}=await exported(h);assert.equal(json.schema,'yuy-design-choices-v1');const pick=json.selections[0];
  assert.equal(pick.variantId,variant);for(const key of ['sourceReference','main','mainSha256','payloadPath','payloadSha256'])assert.equal(pick[key],expected[key],key);
  assert.equal(pick.catalogSha256,'c42b5657bb29b029f761c239a21573bc4a07ff03249316195be858f58d7b19e1');assert.equal(pick.route,'chat');assert.equal(pick.actualPath,'/chat');assert.equal(pick.partId,'page');
 });

 // Break caught: either required witness becomes optional, hidden or geometrically empty.
 for(const key of ['toolbar','panel'])test(`${variant} Chat ${key} rejects all missing hidden and zero-size shapes before arming`,async()=>{
  for(const [label,shape]of badWitnesses){const {h}=await initial(variant);await chatScreen(h,'left',{ready:true,witnesses:{[key]:shape}});
   assert.equal(h.ids['left-pick'].disabled,true,label);assert.equal(h.frame('left').inert,true,label);await h.click('left-pick');assert.equal(count(h),0,label);
   await chatScreen(h,'left',{ready:true});assert.equal(h.ids['left-pick'].disabled,false,label);
  }
 });

 // Break caught: generic ready name bypasses data/error/nonbusy or ancestor visibility.
 test(`${variant} Chat ready name cannot bypass data state busy or visible ancestors`,async()=>{
  for(const [label,shape]of badGates){const {h}=await initial(variant);await chatScreen(h,'left',{ready:true,...shape});assert.equal(h.ids['left-pick'].disabled,true,label);assert.equal(h.frame('left').inert,true,label);
   await chatScreen(h,'left',{ready:true});assert.equal(h.ids['left-pick'].disabled,false,label);
  }
 });

 test(`${variant} Chat rejects unrelated surface blank and error text with valid identity`,async()=>{
  const {h}=await initial(variant);h.screen('left',{ready:true,page:'growth'});assert.equal(h.ids['left-pick'].disabled,true);
  for(const text of ['', 'Something went wrong']){await chatScreen(h,'left',{ready:true,text});assert.equal(h.ids['left-pick'].disabled,true);}
  await chatScreen(h,'left',{ready:true});assert.equal(h.ids['left-pick'].disabled,false);
 });

 // Break caught: foreign/stale/mismatched identity or an unaccepted current sequence grants a pick.
 test(`${variant} Chat requires exact accepted window origin epoch document sequence and source`,async()=>{
  const {h,life}=await initial(variant);await life.replace('/chat',{deliver:false});await chatScreen(h,'left',{ready:true});assert.equal(h.ids['left-pick'].disabled,true);
  const good={source:h.frame('left').contentWindow,origin:'https://preview.example',data:structuredClone(life.marker())};
  const cases=[{...good,source:{}},{...good,origin:'https://foreign.example'},{...good,ports:[{}]},...['epoch','variant','mainSha256','caseId','caseSha256','caseKey','documentId'].map(key=>({...good,data:{...good.data,[key]:'wrong'}})),{...good,data:{...good.data,sequence:1}},{...good,data:{...good.data,route:'/tasks'}}];
  for(const bad of cases){await h.event('message',bad);assert.equal(h.ids['left-pick'].disabled,true);assert.equal(h.frame('left').inert,true);}
  await life.replace('/chat',{deliver:false});await life.flush();assert.equal(h.ids['left-pick'].disabled,false);
 });

 test(`${variant} pre-arm Home queue is tolerated but post-arm cross-page queue permanently locks`,async()=>{
  const {h,life}=await initial(variant);await life.replace('/',{deliver:false});const old={source:h.frame('left').contentWindow,origin:'https://preview.example',data:structuredClone(life.marker())};
  await life.replace('/chat',{deliver:false});await chatScreen(h,'left',{ready:true});await life.flush();assert.equal(h.ids['left-pick'].disabled,false);
  await h.event('message',old);assert.equal(h.ids['left-pick'].disabled,false);
  await life.replace('/tasks',{deliver:false});await life.replace('/chat',{deliver:false});await life.flush();await chatScreen(h,'left',{ready:true});assert.equal(h.ids['left-pick'].disabled,true);
 });

 test(`${variant} cross-page lock survives modeled return BFCache Cancel and fresh Open preserves choices`,async()=>{
  const {h,life}=await initial(variant);await bootstrap(h,life);assert.equal(h.ids['left-pick'].disabled,false);await h.click('left-pick');const frame=h.frame('left'),name=frame.name;
  await life.navigate('/');assert.equal(h.ids['left-pick'].disabled,true);assert.equal(frame.inert,false);
  await life.navigate('/chat');await chatScreen(h,'left',{ready:true});await h.event('pagehide',{persisted:true});await h.event('pageshow',{persisted:true});assert.equal(h.ids['left-pick'].disabled,true);
  await h.click('apply');assert.equal(h.frame('left'),frame);assert.equal(h.frame('left').name,name);assert.equal(count(h),1);
  h.setAnswer(true);await h.click('apply');assert.notEqual(h.frame('left').name,name);assert.equal(count(h),1);await loadRealDocument(h,'left');await chatScreen(h,'left',{ready:true});assert.equal(h.ids['left-pick'].disabled,false);
 });

 test(`${variant} correcting mismatched configuration cannot heal the sticky source failure`,async()=>{
  const h=host();h.ids.route.value='chat';h.ids['left-version'].value=variant;h.setAnswer(true);await h.click('apply');
  h.frame('left').contentWindow.__HISTORICAL_COMPARE_CONFIG__=Object.freeze({route:'chat'});await h.load('left','/chat');await chatScreen(h,'left',{ready:true});assert.equal(h.ids['left-pick'].disabled,true);assert.match(h.ids['left-source'].textContent,/畫面來源核對未通過/);
  delete h.frame('left').contentWindow.__HISTORICAL_COMPARE_CONFIG__;await h.load('left','/chat');await chatScreen(h,'left',{ready:true});assert.equal(h.ids['left-pick'].disabled,true);
 });

 test(`${variant} changed document and retired messages cannot restore a choice`,async()=>{
  const {h}=await initial(variant);await chatScreen(h,'left',{ready:true});assert.equal(h.ids['left-pick'].disabled,false);
  const old=h.emit('left','/chat',2);h.emit('left','/chat',3,{documentId:'c'.repeat(32)});await h.frame('left').fire('load');await chatScreen(h,'left',{ready:true});assert.equal(h.ids['left-pick'].disabled,true);assert.match(h.ids['left-source'].textContent,/文件已重新載入/);
  await h.event('message',old);await chatScreen(h,'left',{ready:true});assert.equal(h.ids['left-pick'].disabled,true);
 });

 // Break caught: opening known Chat also admits Photos, nonpage parts or unpinned/unknown sources.
 test(`${variant} resolver permits only pinned Chat page and rejects Photos parts altered identity and context`,()=>{
  const good=context(variant);assert.ok(choices.resolveChoice(good));assert.equal(choices.resolveChoice(context(variant,'/photos')),null);
  for(const part of ['header-actions','filters','date-list','calendar-layout','unknown'])assert.equal(choices.resolveChoice(good,part),null);
  for(const key of ['id','sourceReference','main','mainSha256'])assert.equal(choices.resolveChoice({...good,version:{...good.version,[key]:'wrong'}}),null);
  for(const bad of [{...good,rendered:false},{...good,visible:false},{...good,observation:null},{...good,observation:{sourceIdentityObserved:true,route:'/tasks'}},context(variant,'/chat/private'),context(variant,'//foreign.example/chat')])assert.equal(choices.resolveChoice(bad),null);
 });

 test(`${variant} preference deduplicates and exports no message draft query or case data`,()=>{
  const list=choices.createChoiceList(),c={...context(variant,'/chat?token=private-token&child=private-child#private-fragment'),messages:['private-message'],draft:'private-draft',caseId:'private-case'};
  assert.equal(list.add(c).status,'added');assert.equal(list.add(c).status,'duplicate');assert.equal(list.items().length,1);assert.equal(list.items()[0].actualPath,'/chat');
  const text=list.summary();assert.match(text,/設計偏好/);assert.match(text,/貼回對話/);assert.doesNotMatch(text,/private-|token=|child=|caseId|caseSha256|messages|draft/);assert.equal(list.remove(list.items()[0].id),true);assert.equal(list.items().length,0);
 });
}

test('Chat option communicates concise whole-page design choice without implying composition',()=>{
 const h=host(),option=h.ids.route.children.find(x=>x.value==='chat');assert.equal(option.textContent,'助手（可挑選整頁設計）');assert.doesNotMatch(option.textContent,/完整|組合|模型/);
});

test('all three independent source pins match preserved renderer and Chat payload bytes',()=>{
 assert.deepEqual(sources.map(x=>x.variant),ids);
 for(const expected of sources){for(const [pathKey,hashKey]of [['main','mainSha256'],['payloadPath','payloadSha256']])assert.equal(crypto.createHash('sha256').update(fs.readFileSync(new URL('../dist/'+expected[pathKey],import.meta.url))).digest('hex'),expected[hashKey]);
  const old=JSON.parse(fs.readFileSync(new URL('chat-sources.json',import.meta.url),'utf8')).find(x=>x.variant===expected.variant);assert.deepEqual(expected,old);
 }
});

// A true historical negative control: BOTH app and resolver are frozen v106; unchanged deps verified.
test('true v106 app and policy retain all three no-wait bootstrap locks and resolver bans',async()=>{
 for(const file of ['catalog.mjs','host-actions.mjs','session.mjs','frame-entry.js','boundary.js','index.html'])assert.equal(fs.readFileSync(new URL(file,v106Root),'utf8'),fs.readFileSync(new URL('../dist/experiments/workbench-compare/'+file,import.meta.url),'utf8'));
 for(const variant of ids){assert.equal(v106Choices.resolveChoice(context(variant)),null);const {h,life}=await initial(variant,{historical:true});assert.equal(h.frame('left').inert,false);
  await bootstrap(h,life);assert.equal(h.ids['left-pick'].disabled,true);assert.match(h.ids['left-source'].textContent,/頁面與開啟目標不同。首次接受文件後。開啟目標：助手；目前頁面：首頁；標記頁面：首頁/);
 }
});
