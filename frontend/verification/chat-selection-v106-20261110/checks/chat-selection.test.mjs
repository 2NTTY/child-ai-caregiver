import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {host,choices,catalog} from './host.mjs';
import {loadRealDocument} from './real-lifecycle.mjs';
import {chatScreen} from './chat-harness.mjs';
import * as oldChoices from '../history/public-v105/dist/experiments/workbench-compare/design-choices.mjs';

// Independent pins copied from the sealed read-only diagnosis, not the builder.
const sources=JSON.parse(fs.readFileSync(new URL('chat-sources.json',import.meta.url),'utf8'));
const admitted=sources.filter(x=>['harbour','care'].includes(x.variant));
const count=h=>h.ids['choice-list'].children.length;
const oldRoot=new URL('../history/public-v105/dist/experiments/workbench-compare/',import.meta.url);
const context=(id,route='/chat?previewScenario=ready')=>({version:catalog.versions.find(v=>v.id===id),actualRoute:route,observation:{sourceIdentityObserved:true,route},rendered:true,visible:true});
async function initial({variant='harbour',side='left',historical=false}={}){
 const h=host(historical?{appRoot:oldRoot,choiceModule:oldChoices}:undefined);
 h.ids.route.value='chat';h.ids[side+'-version'].value=variant;h.setAnswer(true);await h.click('apply');h.setAnswer(false);
 await chatScreen(h,side);const life=await loadRealDocument(h,side);return {h,life,side};
}
async function bootstrap(h,life,side='left'){
 await life.replace('/',{deliver:false});await chatScreen(h,side);await life.flush();
 await life.replace('/chat');await chatScreen(h,side,{ready:true});
}
async function exported(h){await h.click('copy-choices');return JSON.parse(h.copied.at(-1).slice(h.copied.at(-1).indexOf('{')));}

// Break caught: startup branding becomes interactive before Chat data/surface is ready.
for(const variant of ['harbour','care'])test(`${variant} Chat startup remains inert and honestly waiting`,async()=>{
 const {h}=await initial({variant});assert.equal(h.frame('left').inert,true);assert.equal(h.frame('left').tabIndex,-1);
 assert.equal(h.ids['left-pick'].disabled,true);assert.match(h.ids['left-unavailable'].textContent,/等候.*助手/);
 assert.match(h.ids['left-pick-note'].textContent,/等候|未就緒/);assert.doesNotMatch(h.ids['left-pick-note'].textContent,/已在這側切換|已.*驗收/);
 await h.click('left-pick');assert.equal(count(h),0);
});

// Break caught: Home bootstrap locks Chat, admission ignores source, or pending controls rename the loaded pick.
for(const expected of admitted)test(`${expected.variant} Chat survives bootstrap and exports independently pinned loaded source`,async()=>{
 const side=expected.variant==='care'?'right':'left';const {h,life}=await initial({variant:expected.variant,side});await bootstrap(h,life,side);
 assert.equal(h.ids[side+'-pick'].disabled,false);assert.equal(h.frame(side).inert,false);assert.equal(h.ids[side+'-part-pick'].disabled,true);assert.equal(h.ids[side+'-parts'].hidden,true);
 assert.match(h.ids[side+'-pick-note'].textContent,/可選整個頁面/);
 h.ids[side+'-version'].value='original';h.ids.route.value='photos';await h.event('resize',{});await h.click('swap');
 assert.equal(h.ids[side+'-pick'].disabled,false);assert.match(h.ids[side+'-pick-note'].textContent,/可選整個頁面/);
 await h.click(side+'-pick');await h.click(side+'-pick');assert.equal(count(h),1);const {selections}=await exported(h),pick=selections[0];
 assert.equal(pick.variantId,expected.variant);for(const key of ['sourceReference','main','mainSha256','payloadPath','payloadSha256'])assert.equal(pick[key],expected[key],key);
 assert.equal(pick.catalogSha256,'c42b5657bb29b029f761c239a21573bc4a07ff03249316195be858f58d7b19e1');
 assert.equal(pick.route,'chat');assert.equal(pick.actualPath,'/chat');assert.equal(pick.partId,'page');
});

// Break caught: UI promises all Chat designs are selectable despite a partial resolver policy.
test('Chat option states H/C-only scope; each loaded side uses its own policy rather than pending controls',async()=>{
 const h=host();const option=h.ids.route.children.find(x=>x.value==='chat');assert.match(option.textContent,/Harbour/);assert.match(option.textContent,/Care/);assert.match(option.textContent,/可挑選/);assert.doesNotMatch(option.textContent,/暫不可挑選/);
 h.ids.route.value='chat';h.ids['left-version'].value='harbour';h.ids['right-version'].value='journal';h.setAnswer(true);await h.click('apply');
 const left=await loadRealDocument(h,'left');await loadRealDocument(h,'right');await chatScreen(h,'right',{ready:true});
 h.ids['left-version'].value='journal';h.ids['right-version'].value='care';h.ids.route.value='tasks';await h.event('resize',{});
 assert.equal(h.ids['left-pick'].disabled,true);assert.match(h.ids['left-pick-note'].textContent,/等候|未就緒/);
 assert.equal(h.ids['right-pick'].disabled,true);assert.match(h.ids['right-pick-note'].textContent,/這個版本|此版本/);assert.match(h.ids['right-pick-note'].textContent,/不可|未.*可/);
 await left.replace('/chat');await chatScreen(h,'left',{ready:true});assert.equal(h.ids['left-pick'].disabled,false);assert.equal(h.ids['right-pick'].disabled,true);
});

// Break caught: missing or hidden fixed witness is ignored by the host.
const deniedShapes=[['missing',{missing:true}],['hidden',{hidden:true}],['inert',{inert:true}],['aria-hidden',{ariaHidden:true}],['display-none',{style:{display:'none'}}],['visibility-hidden',{style:{visibility:'hidden'}}],['transparent',{style:{opacity:'0'}}],['zero-width',{rect:{width:0,height:90}}],['zero-height',{rect:{width:120,height:0}}]];
for(const key of ['toolbar','panel'])for(const [label,shape]of deniedShapes)test(`Chat ${key} ${label} denies arming until that witness is visible`,async()=>{
 const {h}=await initial();await chatScreen(h,'left',{ready:true,witnesses:{[key]:shape}});assert.equal(h.ids['left-pick'].disabled,true);assert.equal(h.frame('left').inert,true);
 await h.click('left-pick');assert.equal(count(h),0);await chatScreen(h,'left',{ready:true});assert.equal(h.ids['left-pick'].disabled,false);
});

// Break caught: frontend-preview-ready alone admits loading/error data or obscured ancestors.
for(const [label,shape]of [['loading',{ready:false}],['error-data',{data:'error'}],['loading-data',{data:'loading'}],['loading-state',{gate:{'data-startup-state':'loading'}}],['busy',{gate:{'aria-busy':'true'}}],['missing-gate',{gate:{'data-testid':'unrelated'}}],['hidden-parent',{ancestor:{hidden:true}}],['inert-parent',{ancestor:{inert:true}}],['aria-hidden-parent',{ancestor:{ariaHidden:true}}]])test(`Chat ${label} gate remains unavailable`,async()=>{
 const {h}=await initial();await chatScreen(h,'left',{ready:true,...shape});assert.equal(h.ids['left-pick'].disabled,true);assert.equal(h.frame('left').inert,true);
 await chatScreen(h,'left',{ready:true});assert.equal(h.ids['left-pick'].disabled,false);
});

test('Chat rejects a ready unrelated page and blank/error text even when identity is valid',async()=>{
 const {h}=await initial();h.screen('left',{ready:true,page:'growth'});assert.equal(h.ids['left-pick'].disabled,true);
 await chatScreen(h,'left',{ready:true,text:''});assert.equal(h.ids['left-pick'].disabled,true);
 await chatScreen(h,'left',{ready:true,text:'Something went wrong'});assert.equal(h.ids['left-pick'].disabled,true);
 await chatScreen(h,'left',{ready:true});assert.equal(h.ids['left-pick'].disabled,false);
});

// Break caught: an unaccepted/foreign/mismatched marker grants readiness.
test('Chat needs the exact current accepted sequence and window/origin/identity',async()=>{
 const {h,life}=await initial();await life.replace('/chat',{deliver:false});await chatScreen(h,'left',{ready:true});assert.equal(h.ids['left-pick'].disabled,true);
 const good={source:h.frame('left').contentWindow,origin:'https://preview.example',data:structuredClone(life.marker())};
 const cases=[{...good,source:{}},{...good,origin:'https://foreign.example'},{...good,ports:[{}]},...['epoch','variant','mainSha256','caseId','caseSha256','caseKey','documentId'].map(key=>({...good,data:{...good.data,[key]:'wrong'}})),{...good,data:{...good.data,sequence:1}},{...good,data:{...good.data,route:'/tasks'}}];
 for(const bad of cases){await h.event('message',bad);assert.equal(h.ids['left-pick'].disabled,true);assert.equal(h.frame('left').inert,true);}
 await life.replace('/chat',{deliver:false});await life.flush();assert.equal(h.ids['left-pick'].disabled,false);
});

test('queued pre-arm Home does not retroactively lock Chat; a post-arm cross-page message still does',async()=>{
 const {h,life}=await initial();await life.replace('/',{deliver:false});const old={source:h.frame('left').contentWindow,origin:'https://preview.example',data:structuredClone(life.marker())};
 await life.replace('/chat',{deliver:false});await chatScreen(h,'left',{ready:true});await life.flush();assert.equal(h.ids['left-pick'].disabled,false);
 await h.event('message',old);assert.equal(h.ids['left-pick'].disabled,false);
 await life.replace('/tasks',{deliver:false});await life.replace('/chat',{deliver:false});await life.flush();await chatScreen(h,'left',{ready:true});assert.equal(h.ids['left-pick'].disabled,true);
});

for(const variant of ['harbour','care'])test(`${variant} cross-page lock survives return/BFCache/Cancel; new Open replaces epochs and retains choices`,async()=>{
 const {h,life}=await initial({variant});await bootstrap(h,life);assert.equal(h.ids['left-pick'].disabled,false);await h.click('left-pick');const f=h.frame('left'),oldName=f.name;
 await life.navigate('/');assert.equal(h.ids['left-pick'].disabled,true);assert.equal(f.inert,false);
 await life.navigate('/chat');await chatScreen(h,'left',{ready:true});await h.event('pagehide',{persisted:true});await h.event('pageshow',{persisted:true});
 assert.equal(h.ids['left-pick'].disabled,true);await h.click('apply');assert.equal(h.frame('left'),f);assert.equal(h.frame('left').name,oldName);assert.equal(count(h),1);
 h.setAnswer(true);await h.click('apply');assert.notEqual(h.frame('left').name,oldName);assert.equal(count(h),1);await loadRealDocument(h,'left');await chatScreen(h,'left',{ready:true});assert.equal(h.ids['left-pick'].disabled,false);
});

test('Chat source configuration failure is sticky after correcting configuration and surface',async()=>{
 const h=host();h.ids.route.value='chat';h.ids['left-version'].value='harbour';h.setAnswer(true);await h.click('apply');
 h.frame('left').contentWindow.__HISTORICAL_COMPARE_CONFIG__=Object.freeze({route:'chat'});await h.load('left','/chat');await chatScreen(h,'left',{ready:true});assert.equal(h.ids['left-pick'].disabled,true);assert.match(h.ids['left-source'].textContent,/畫面來源核對未通過/);
 delete h.frame('left').contentWindow.__HISTORICAL_COMPARE_CONFIG__;await h.load('left','/chat');await chatScreen(h,'left',{ready:true});assert.equal(h.ids['left-pick'].disabled,true);
});

test('Chat changed-document failure cannot heal and retired document messages cannot restore choice',async()=>{
 const h=host();h.ids.route.value='chat';h.ids['left-version'].value='care';h.setAnswer(true);await h.click('apply');await h.load('left','/chat');await chatScreen(h,'left',{ready:true});assert.equal(h.ids['left-pick'].disabled,false);
 const old=h.emit('left','/chat',2);h.emit('left','/chat',3,{documentId:'c'.repeat(32)});await h.frame('left').fire('load');await chatScreen(h,'left',{ready:true});assert.equal(h.ids['left-pick'].disabled,true);assert.match(h.ids['left-source'].textContent,/文件已重新載入/);
 await h.event('message',old);await chatScreen(h,'left',{ready:true});assert.equal(h.ids['left-pick'].disabled,true);
});

// Break caught: broadening Chat map changes old view-only behavior for unadmitted variants.
for(const variant of ['original','journal','uiux-upgrade'])test(`${variant} Chat keeps view-only startup/navigation behavior without the new wait boundary`,async()=>{
 const {h,life}=await initial({variant});assert.equal(h.frame('left').inert,false);assert.equal(h.ids['left-unavailable'].hidden,true);assert.equal(h.ids['left-pick'].disabled,true);
 await chatScreen(h,'left',{ready:true});assert.equal(h.ids['left-pick'].disabled,true);
 await life.replace('/');await life.replace('/chat');await chatScreen(h,'left',{ready:true});assert.match(h.ids['left-source'].textContent,/頁面變更|頁面與開啟/);assert.equal(h.frame('left').inert,false);assert.equal(h.ids['left-pick'].disabled,true);
});

// Break caught: whitelist expands into Photos, partial Chat choices, unknown or altered source pins.
test('resolver admits only H/C Chat page and rejects all other variants, Photos, parts, wrong pins and invalid context',()=>{
 for(const id of ['original','harbour','care','journal','uiux-upgrade']){
  assert.equal(choices.resolveChoice(context(id,'/photos')),null);
  assert.equal(!!choices.resolveChoice(context(id)),['harbour','care'].includes(id));
  for(const part of ['header-actions','filters','date-list','calendar-layout','unknown'])assert.equal(choices.resolveChoice(context(id),part),null);
 }
 const good=context('harbour');for(const key of ['id','sourceReference','main','mainSha256'])assert.equal(choices.resolveChoice({...good,version:{...good.version,[key]:'wrong'}}),null);
 for(const bad of [{...good,rendered:false},{...good,visible:false},{...good,observation:null},{...good,observation:{sourceIdentityObserved:true,route:'/tasks'}},context('care','/chat/private'),context('care','//foreign.example/chat')])assert.equal(choices.resolveChoice(bad),null);
});

test('H/C choice export deduplicates and contains only design identifiers, not messages or URL/case content',()=>{
 const s=choices.createChoiceList();const query='/chat?token=private-token&child=private-child#private-fragment';
 for(const expected of admitted){const c={...context(expected.variant,query),messages:['private-message'],draft:'private-draft',caseId:'private-case'};assert.equal(s.add(c).status,'added');assert.equal(s.add(c).status,'duplicate');}
 assert.equal(s.items().length,2);assert.deepEqual(s.items().map(x=>x.variantId),['harbour','care']);assert.deepEqual(s.items().map(x=>x.actualPath),['/chat','/chat']);
 const text=s.summary();assert.match(text,/設計偏好/);assert.match(text,/貼回對話/);assert.doesNotMatch(text,/private-|token=|child=|caseId|caseSha256|messages|draft/);
 assert.equal(s.remove(s.items()[0].id),true);assert.equal(s.items().length,1);
});

// True v105 app AND policy, with separately preserved deps. Guard/lifecycle dependencies remain byte-identical.
test('frozen v105 app and resolver independently retain both original defects',async()=>{
 for(const file of ['catalog.mjs','host-actions.mjs','session.mjs','frame-entry.js','boundary.js','index.html'])assert.equal(fs.readFileSync(new URL(file,oldRoot),'utf8'),fs.readFileSync(new URL('../dist/experiments/workbench-compare/'+file,import.meta.url),'utf8'));
 for(const id of ['harbour','care'])assert.equal(oldChoices.resolveChoice(context(id)),null);
 const {h,life}=await initial({historical:true});assert.equal(h.frame('left').inert,false,'old app does not wait for Chat readiness');await bootstrap(h,life);assert.equal(h.ids['left-pick'].disabled,true);
 assert.match(h.ids['left-source'].textContent,/頁面與開啟目標不同。首次接受文件後。開啟目標：助手；目前頁面：首頁；標記頁面：首頁/);
});
