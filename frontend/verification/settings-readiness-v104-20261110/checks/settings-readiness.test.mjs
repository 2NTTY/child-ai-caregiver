import test from 'node:test';
import assert from 'node:assert/strict';
import {host} from './host.mjs';
import {loadRealDocument} from './real-lifecycle.mjs';
const count=h=>h.ids['choice-list'].children.length;
async function initial({variant='original',side='left',appRoot}={}){
 const h=host(appRoot?{appRoot}:undefined);h.ids.route.value='settings';h.ids[side+'-version'].value=variant;h.setAnswer(true);await h.click('apply');h.setAnswer(false);
 h.screen(side,{page:'settings'});const life=await loadRealDocument(h,side);return {h,life,side};
}
async function bootstrap(h,life,side='left'){
 await life.replace('/',{deliver:false});h.screen(side,{page:'settings'});await life.flush();
 await life.replace('/settings');h.screen(side,{ready:true,page:'settings'});
}

test('Settings startup logo is not a selectable design or interactive page',async()=>{
 const {h}=await initial();assert.match(h.frame('left').appRoot.textContent,/正在開啟/);
 assert.equal(h.ids['left-pick'].disabled,true);assert.equal(h.frame('left').inert,true);
 await h.click('left-pick');assert.equal(count(h),0);
});
for(const variant of ['original','harbour','care','journal','uiux-upgrade'])test(`${variant} Settings first surface survives the observed bootstrap Home without mislabeling its source`,async()=>{
 const {h,life}=await initial({variant});await bootstrap(h,life);assert.equal(h.ids['left-pick'].disabled,false);assert.equal(h.frame('left').inert,false);
 h.ids['left-version'].value=variant==='care'?'original':'care';h.ids.route.value='growth';await h.click('left-pick');assert.equal(count(h),1);await h.click('copy-choices');
 const selected=JSON.parse(h.copied[0].slice(h.copied[0].indexOf('{'))).selections;assert.equal(selected[0].variantId,variant);assert.equal(selected[0].route,'settings');assert.equal(selected[0].actualPath,'/settings');assert.equal(selected[0].partId,'page');
});
test('Settings readiness rejects generic, missing, hidden, inert, loading and zero-size surfaces',async()=>{
 const {h}=await initial();
 for(const shape of [{page:'home'},{hidden:true},{inert:true},{display:'none'},{opacity:'0'},{noRect:true},{data:'error'},{data:'loading'}]){
  h.screen('left',{ready:true,page:'settings',...shape});assert.equal(h.ids['left-pick'].disabled,true,JSON.stringify(shape));assert.equal(h.frame('left').inert,true,JSON.stringify(shape));
 }
 h.screen('left',{ready:true,page:'settings'});assert.equal(h.ids['left-pick'].disabled,false);
});
test('Settings queued bootstrap observations cannot retroactively lock a newly armed exact document',async()=>{
 const {h,life}=await initial();await life.replace('/',{deliver:false});const old={source:h.frame('left').contentWindow,origin:'https://preview.example',data:structuredClone(life.marker())};
 await life.replace('/settings',{deliver:false});h.screen('left',{ready:true,page:'settings'});await life.flush();assert.equal(h.ids['left-pick'].disabled,false);
 await h.event('message',old);assert.equal(h.ids['left-pick'].disabled,false);
 await life.navigate('/tasks');assert.equal(h.ids['left-pick'].disabled,true);
});
test('Settings post-arm navigation and Back remain locked through Cancel; explicit new document keeps choices',async()=>{
 const {h,life}=await initial();await bootstrap(h,life);await h.click('left-pick');assert.equal(count(h),1);const frame=h.frame('left');
 await life.navigate('/tasks');assert.equal(h.ids['left-pick'].disabled,true);assert.equal(frame.inert,false);
 await life.navigate('/settings');h.screen('left',{ready:true,page:'settings'});assert.equal(h.ids['left-pick'].disabled,true);await h.event('pageshow',{persisted:true});
 await h.click('apply');assert.equal(h.frame('left'),frame);assert.equal(h.ids['left-pick'].disabled,true);assert.equal(count(h),1);
 h.setAnswer(true);await h.click('apply');h.screen('left',{page:'settings'});await loadRealDocument(h,'left');h.screen('left',{ready:true,page:'settings'});
 assert.notEqual(h.frame('left'),frame);assert.equal(h.ids['left-pick'].disabled,false);assert.equal(count(h),1);
});
test('Settings source configuration and changed-document failures cannot be cleared by a valid visible Settings surface',async()=>{
 const h=host();h.ids.route.value='settings';h.setAnswer(true);await h.click('apply');h.screen('left',{ready:true,page:'settings'});
 h.frame('left').contentWindow.__HISTORICAL_COMPARE_CONFIG__=Object.freeze({route:'settings'});await h.load('left','/settings');assert.equal(h.ids['left-pick'].disabled,true);assert.match(h.ids['left-source'].textContent,/畫面來源核對未通過/);
 const good=host();good.ids.route.value='settings';good.setAnswer(true);await good.click('apply');good.screen('left',{ready:true,page:'settings'});await good.load('left','/settings');assert.equal(good.ids['left-pick'].disabled,false);
 good.emit('left','/settings',9,{documentId:'c'.repeat(32)});await good.frame('left').fire('load');good.screen('left',{ready:true,page:'settings'});
 assert.equal(good.ids['left-pick'].disabled,true);assert.match(good.ids['left-source'].textContent,/文件已重新載入/);
});
test('Settings cannot arm until the current marker has actually been accepted',async()=>{
 const {h,life}=await initial();await life.replace('/settings',{deliver:false});h.screen('left',{ready:true,page:'settings'});assert.equal(h.ids['left-pick'].disabled,true);
 await life.flush();assert.equal(h.ids['left-pick'].disabled,false);
});
test('Chat and Photos remain unselectable even with a ready Settings surface present',async()=>{
 for(const route of ['chat','photos']){const h=host();h.ids.route.value=route;h.setAnswer(true);await h.click('apply');h.screen('left',{ready:true,page:'settings'});await loadRealDocument(h,'left');assert.equal(h.ids['left-pick'].disabled,true);await h.click('left-pick');assert.equal(count(h),0);}
});
test('preserved public v103 reproduces the independently observed initial Settings/Home lock',async()=>{
 const {h,life}=await initial({appRoot:new URL('../history/public-v103/dist/experiments/workbench-compare/',import.meta.url)});await bootstrap(h,life);
 assert.equal(h.ids['left-pick'].disabled,true);assert.match(h.ids['left-source'].textContent,/頁面與開啟目標不同。首次接受文件後。開啟目標：設定；目前頁面：首頁；標記頁面：首頁/);
});
test('Settings section browsing does not admit hidden account content and returning account is not a cross-page visit',async()=>{
 const {h,life}=await initial();await bootstrap(h,life);assert.equal(h.ids['left-pick'].disabled,false);
 const {surface}=h.screen('left',{ready:true,page:'settings',hidden:true});surface.textContent='隱藏帳戶';
 await life.replace('/settings?section=model');assert.equal(h.frame('left').inert,false);assert.equal(h.ids['left-pick'].disabled,true);
 await h.click('left-pick');assert.equal(count(h),0);
 await life.replace('/settings?section=account');h.screen('left',{ready:true,page:'settings'});assert.equal(h.ids['left-pick'].disabled,false);
 await h.click('left-pick');assert.equal(count(h),1);
});
test('Settings absent account witness and unrelated ready pages cannot be picked',async()=>{
 const {h}=await initial();h.screen('left',{ready:true,page:'tasks'});assert.equal(h.ids['left-pick'].disabled,true);
 const shape=h.screen('left',{ready:true,page:'settings'});shape.surface.remove();await h.event('resize',{});
 assert.equal(h.ids['left-pick'].disabled,true);await h.click('left-pick');assert.equal(count(h),0);
});
