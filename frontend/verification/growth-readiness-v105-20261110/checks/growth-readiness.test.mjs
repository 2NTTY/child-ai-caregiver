import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {host} from './host.mjs';
import {loadRealDocument} from './real-lifecycle.mjs';

const sources=JSON.parse(fs.readFileSync(new URL('growth-sources.json',import.meta.url),'utf8'));
const count=h=>h.ids['choice-list'].children.length;
async function initial({variant='original',side='left',appRoot}={}){
 const h=host(appRoot?{appRoot}:undefined);
 h.ids.route.value='growth';h.ids[side+'-version'].value=variant;h.setAnswer(true);await h.click('apply');h.setAnswer(false);
 h.screen(side,{page:'growth'});const life=await loadRealDocument(h,side);return {h,life,side};
}
async function bootstrap(h,life,side='left'){
 // The real boundary observes the Home bootstrap before the Growth surface.
 // This is a controlled DOM/history model, not a browser or React renderer.
 await life.replace('/',{deliver:false});h.screen(side,{page:'growth'});await life.flush();
 await life.replace('/growth');h.screen(side,{ready:true,page:'growth'});
}

// Break caught: immediate arming treats nonempty startup branding as a design.
test('Growth startup logo is neither selectable nor interactive',async()=>{
 const {h}=await initial();assert.match(h.frame('left').appRoot.textContent,/正在開啟/);
 assert.equal(h.ids['left-pick'].disabled,true);assert.equal(h.frame('left').inert,true);
 assert.equal(h.frame('left').tabIndex,-1);await h.click('left-pick');assert.equal(count(h),0);
});

// Break caught: bootstrap Home permanently locks Growth, or export follows
// pending selectors instead of the actual loaded and accepted source identity.
for(const expected of sources)test(`${expected.variantId} Growth survives bootstrap Home and exports its exact loaded source`,async()=>{
 const side=expected.variantId==='journal'?'right':'left';
 const {h,life}=await initial({variant:expected.variantId,side});await bootstrap(h,life,side);
 assert.equal(h.ids[side+'-pick'].disabled,false);assert.equal(h.frame(side).inert,false);
 h.ids[side+'-version'].value=expected.variantId==='care'?'original':'care';h.ids.route.value='settings';
 await h.click(side+'-pick');assert.equal(count(h),1);await h.click('copy-choices');
 const {selections}=JSON.parse(h.copied[0].slice(h.copied[0].indexOf('{')));
 assert.equal(selections.length,1);
 for(const [key,value]of Object.entries(expected))assert.equal(selections[0][key],value,key);
 assert.equal(selections[0].route,'growth');assert.equal(selections[0].actualPath,'/growth');assert.equal(selections[0].partId,'page');
});

// Break caught: either required fixed witness is ignored, or its rendered
// visibility is inferred merely from DOM text. Each case starts before arming.
const deniedShapes=[
 ['missing',{missing:true}],['hidden',{hidden:true}],['inert',{inert:true}],
 ['aria-hidden',{ariaHidden:true}],['display-none',{style:{display:'none'}}],
 ['visibility-hidden',{style:{visibility:'hidden'}}],['transparent',{style:{opacity:'0'}}],
 ['zero-width',{rect:{width:0,height:100}}],['zero-height',{rect:{width:100,height:0}}],
];
for(const witness of ['scroll','tabs'])for(const [label,shape]of deniedShapes)test(`Growth ${witness} witness ${label} denies initial selection`,async()=>{
 const {h}=await initial();h.screen('left',{ready:true,page:'growth',growthWitnesses:{[witness]:shape}});
 assert.equal(h.ids['left-pick'].disabled,true);assert.equal(h.frame('left').inert,true);
 await h.click('left-pick');assert.equal(count(h),0);
 h.screen('left',{ready:true,page:'growth'});assert.equal(h.ids['left-pick'].disabled,false);
});

// Break caught: fixed witnesses alone admit a loading/error or unrelated gate.
for(const [label,shape]of [
 ['loading',{ready:false}],['error-data',{data:'error'}],['loading-data',{data:'loading'}],
 ['loading-state',{growthGate:{'data-startup-state':'loading'}}],
 ['busy',{growthGate:{'aria-busy':'true'}}],['missing-ready-gate',{growthGate:{'data-testid':'unrelated'}}],
 ['unrelated-page',{page:'home'}],['hidden-ancestor',{hidden:true}],['inert-ancestor',{inert:true}],
])test(`Growth ${label} gate denies initial selection`,async()=>{
 const {h}=await initial();h.screen('left',{ready:true,page:'growth',...shape});
 assert.equal(h.ids['left-pick'].disabled,true);assert.equal(h.frame('left').inert,true);
 h.screen('left',{ready:true,page:'growth'});assert.equal(h.ids['left-pick'].disabled,false);
});

// Break caught: an empty concerns collection incorrectly becomes a readiness
// requirement. The test-only Growth shape contains only the fixed witnesses.
test('Growth without growth-index-surface remains selectable with fixed scroll and tabs',async()=>{
 const {h,life}=await initial();await bootstrap(h,life);
 assert.equal(h.frame('left').appRoot.querySelector('[data-testid="growth-index-surface"]'),null);
 assert.equal(h.ids['left-pick'].disabled,false);await h.click('left-pick');assert.equal(count(h),1);
});

// Break caught: a newer current marker or wrong-origin message arms a document
// before the actual observation session has accepted that marker.
test('Growth arms only after the current exact marker has been accepted',async()=>{
 const {h,life}=await initial();await life.replace('/growth',{deliver:false});h.screen('left',{ready:true,page:'growth'});
 assert.equal(h.ids['left-pick'].disabled,true);assert.equal(h.frame('left').inert,true);
 const current={source:h.frame('left').contentWindow,origin:'https://wrong.example',data:structuredClone(life.marker())};
 await h.event('message',current);assert.equal(h.ids['left-pick'].disabled,true);
 await life.flush();assert.equal(h.ids['left-pick'].disabled,false);
});

// Break caught: queued bootstrap Home gets treated as a later user navigation.
test('Growth queued bootstrap messages cannot retroactively lock the newly armed document',async()=>{
 const {h,life}=await initial();await life.replace('/',{deliver:false});
 const old={source:h.frame('left').contentWindow,origin:'https://preview.example',data:structuredClone(life.marker())};
 await life.replace('/growth',{deliver:false});h.screen('left',{ready:true,page:'growth'});await life.flush();
 assert.equal(h.ids['left-pick'].disabled,false);await h.event('message',old);assert.equal(h.ids['left-pick'].disabled,false);
 await life.navigate('/tasks');assert.equal(h.ids['left-pick'].disabled,true);
});

// Break caught: permanent cross-page lock is weakened by return, persisted
// pageshow, Cancel, or a new Open discards already selected designs.
test('Growth later cross-page visit stays locked through modeled return and Cancel; explicit Open keeps choices',async()=>{
 const {h,life}=await initial();await bootstrap(h,life);await h.click('left-pick');assert.equal(count(h),1);
 const frame=h.frame('left');await life.navigate('/tasks');assert.equal(h.ids['left-pick'].disabled,true);assert.equal(frame.inert,false);
 // This models return with the history port, not an actual browser Back.
 await life.navigate('/growth');h.screen('left',{ready:true,page:'growth'});await h.event('pageshow',{persisted:true});
 assert.equal(h.ids['left-pick'].disabled,true);await h.click('apply');assert.equal(h.frame('left'),frame);
 assert.equal(h.ids['left-pick'].disabled,true);assert.equal(count(h),1);
 h.setAnswer(true);await h.click('apply');h.screen('left',{page:'growth'});await loadRealDocument(h,'left');h.screen('left',{ready:true,page:'growth'});
 assert.notEqual(h.frame('left'),frame);assert.equal(h.ids['left-pick'].disabled,false);assert.equal(count(h),1);
});

test('Growth queued post-arm cross-page message locks even after the modeled path has returned',async()=>{
 const {h,life}=await initial();await bootstrap(h,life);assert.equal(h.ids['left-pick'].disabled,false);
 await life.replace('/tasks',{deliver:false});await life.replace('/growth',{deliver:false});
 await life.flush();h.screen('left',{ready:true,page:'growth'});assert.equal(h.ids['left-pick'].disabled,true);
});

// Break caught: valid surface readiness heals a recorded source failure.
test('Growth corrected configuration and ready witnesses cannot clear a source-configuration failure',async()=>{
 const h=host();h.ids.route.value='growth';h.setAnswer(true);await h.click('apply');h.screen('left',{ready:true,page:'growth'});
 h.frame('left').contentWindow.__HISTORICAL_COMPARE_CONFIG__=Object.freeze({route:'growth'});await h.load('left','/growth');
 assert.equal(h.ids['left-pick'].disabled,true);assert.match(h.ids['left-source'].textContent,/畫面來源核對未通過/);
 delete h.frame('left').contentWindow.__HISTORICAL_COMPARE_CONFIG__;await h.load('left','/growth');h.screen('left',{ready:true,page:'growth'});
 assert.equal(h.ids['left-pick'].disabled,true);assert.match(h.ids['left-source'].textContent,/畫面來源核對未通過/);
});

test('Growth changed-document failure cannot be healed by the new ready Growth surface',async()=>{
 const h=host();h.ids.route.value='growth';h.setAnswer(true);await h.click('apply');h.screen('left',{ready:true,page:'growth'});await h.load('left','/growth');
 assert.equal(h.ids['left-pick'].disabled,false);
 h.emit('left','/growth',9,{documentId:'c'.repeat(32)});await h.frame('left').fire('load');h.screen('left',{ready:true,page:'growth'});
 assert.equal(h.ids['left-pick'].disabled,true);assert.match(h.ids['left-source'].textContent,/文件已重新載入/);
 await h.frame('left').fire('load');assert.equal(h.ids['left-pick'].disabled,true);
});

// Break caught: the Growth exception expands selection to explicitly banned pages.
test('Chat and Photos remain denied with otherwise ready Growth witnesses',async()=>{
 for(const route of ['chat','photos']){
  const h=host();h.ids.route.value=route;h.setAnswer(true);await h.click('apply');h.screen('left',{ready:true,page:'growth'});await loadRealDocument(h,'left');
  assert.equal(h.ids['left-pick'].disabled,true);await h.click('left-pick');assert.equal(count(h),0);
 }
});

test('preserved public v104 reproduces the sealed first Growth Home lock',async()=>{
 const {h,life}=await initial({appRoot:new URL('../history/public-v104/dist/experiments/workbench-compare/',import.meta.url)});await bootstrap(h,life);
 assert.equal(h.ids['left-pick'].disabled,true);
 assert.match(h.ids['left-source'].textContent,/頁面與開啟目標不同。首次接受文件後。開啟目標：成長；目前頁面：首頁；標記頁面：首頁/);
});

// Break caught: same-path workspace navigation gets mistaken for a cross-page
// visit. This is not acceptance of the actual workspace section UI.
test('Growth same-path workspace query with retained fixed witnesses preserves selection eligibility',async()=>{
 const {h,life}=await initial();await bootstrap(h,life);
 await life.replace('/growth?section=preparation');h.screen('left',{ready:true,page:'growth'});
 assert.equal(h.ids['left-pick'].disabled,false);await h.click('left-pick');await h.click('copy-choices');
 const selection=JSON.parse(h.copied[0].slice(h.copied[0].indexOf('{'))).selections[0];
 assert.equal(selection.actualPath,'/growth');assert.equal(selection.route,'growth');assert.doesNotMatch(h.copied[0],/section=preparation/);
});
