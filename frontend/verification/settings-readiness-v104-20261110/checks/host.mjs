import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {catalog} from '../dist/experiments/workbench-compare/catalog.mjs';
import {createObservationSession} from '../dist/experiments/workbench-compare/session.mjs';
import * as actions from '../dist/experiments/workbench-compare/host-actions.mjs';

const root=new URL('../dist/experiments/workbench-compare/',import.meta.url);
export const choices=fs.existsSync(new URL('design-choices.mjs',root))?await import(new URL('design-choices.mjs',root)):{};
export {catalog};
// A controlled DOM boundary, not a browser engine. Loads the actual HTML IDs and
// real app/session/choice modules; only DOM layout and clipboard are controlled.
export function host({width=1400,clipboard='success',appRoot=root}={}){
 const ids={},events={},asks=[],frames=[],copied=[],navigation=[],observers=[];let answer=false,nextId=0;
 let document;
 class Element {
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.attributes=[];this.events={};this.style={};this.dataset={};this._text='';this._value='';this.hidden=false;this.inert=false;this.disabled=false;this.clientWidth=width<=700?340:650;this.classes=new Set();this.classList={toggle:(key,on)=>{if(on===undefined)on=!this.classes.has(key);on?this.classes.add(key):this.classes.delete(key);return on;},contains:key=>this.classes.has(key)};}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(child=>typeof child==='string'?child:child.textContent).join('');}
  set value(value){this._value=String(value);}
  get value(){return this._value;}
  setAttribute(name,value=''){value=String(value);const a=this.attributes.find(a=>a.name===name);a?a.value=value:this.attributes.push({name,value});if(name==='id'){this.id=value;ids[value]=this;}else if(name==='class')this.classes=new Set(value.split(/\s+/));else if(name==='value')this.value=value;else if(name==='hidden'||name==='inert'||name==='disabled')this[name]=true;else if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,v)=>v.toUpperCase())]=value;else this[name]=value;}
  getAttribute(name){return this.attributes.find(a=>a.name===name)?.value??null;}
  addEventListener(name,fn){(this.events[name]??=[]).push(fn);}
  async fire(name='click',event={}){if(this.disabled&&name==='click')return;for(const fn of this.events[name]??[])await fn({target:this,preventDefault(){},...event});}
  append(...children){for(const child of children){this.children.push(child);if(typeof child!=='string')child.parentElement=this;}}
  replaceChildren(...children){this.children=[];this._text='';this.append(...children);}
  replaceWith(replacement){const at=this.parentElement.children.indexOf(this);this.parentElement.children[at]=replacement;replacement.parentElement=this.parentElement;}
  add(option){this.append(option);if(!this.value&&!option.disabled)this.value=option.value;}
  matches(selector){if(selector.startsWith('#'))return this.id===selector.slice(1);if(selector.startsWith('.'))return this.classes.has(selector.slice(1));if(selector.startsWith('[')){const [,name,value]=selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/)??[];return name!==undefined&&(value===undefined?this.getAttribute(name)!==null:this.getAttribute(name)===value);}return this.tagName===selector.toUpperCase();}
  querySelectorAll(selector){return this.children.flatMap(c=>typeof c==='string'?[]:[...(c.matches(selector)?[c]:[]),...c.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
  contains(element){return this===element||this.children.some(child=>typeof child!=='string'&&child.contains(element));}
  get childElementCount(){return this.children.filter(child=>typeof child!=='string').length;}
  getClientRects(){return this.noRect?[]:[{width:650,height:700}];}
  focus(){document.activeElement=this;}
  select(){this.selected=true;}
  remove(){this.parentElement.children=this.parentElement.children.filter(c=>c!==this);}
 }
 function element(tag){const el=new Element(tag);if(tag==='iframe'){
  const appRoot=new Element();appRoot.append(new Element());appRoot._text='合成示例頁面';
  el.contentWindow={location:{pathname:'/',search:''},document:{documentElement:appRoot,getElementById:id=>id==='root'?appRoot:null},getComputedStyle:node=>({display:'block',visibility:'visible',opacity:'1',...node.style}),history:{back(){navigation.push('back');}},addEventListener(){}};
  el.appRoot=appRoot;frames.push(el);
 }return el;}
 const tree=element('document'),stack=[tree];
 for(const token of fs.readFileSync(new URL('index.html',appRoot),'utf8').match(/<[^>]+>|[^<]+/g)){
  if(token.startsWith('<!'))continue;
  if(token.startsWith('</')){stack.pop();continue;}
  if(token.startsWith('<')){
   const [,tag,attrs]=token.match(/^<([\w-]+)([\s\S]*?)\/?\s*>$/)??[];if(!tag)continue;
   const el=element(tag);for(const attr of attrs.matchAll(/([\w:-]+)(?:\s*=\s*"([^"]*)")?/g))el.setAttribute(attr[1],attr[2]??'');
   stack.at(-1).append(el);if(tag==='option'){const select=stack.at(-1);if(select.tagName==='SELECT'&&!select.value)select.value=el.value;}
   if(!['meta','link','input','br','hr','img'].includes(tag))stack.push(el);
  }else stack.at(-1).append(token);
 }
 document={body:tree.querySelector('body'),activeElement:null,getElementById:id=>ids[id]??null,createElement:element};
 for(const select of tree.querySelectorAll('select'))if(!select.value){const first=select.querySelector('option');if(first)select.value=first.value||first.textContent;}
 const w={innerWidth:width,addEventListener(name,fn){(events[name]??=[]).push(fn);},confirm(message){asks.push(message);return answer;}};w.window=w;
 const navigator={clipboard:clipboard==='missing'?undefined:{async writeText(text){if(clipboard==='failure')throw new Error('Clipboard denied');copied.push(text);}}};
 class MutationObserver{constructor(callback){this.callback=callback;observers.push(this);}observe(target){this.target=target;}disconnect(){this.target=null;}}
 const context=vm.createContext({window:w,document,navigator,MutationObserver,location:{origin:'https://preview.example'},crypto:{randomUUID:()=>String(++nextId).padStart(32,'0')},Option:function(label,value){const e=element('option');e.textContent=label;e.value=value;return e;},createObservationSession,catalog,...actions,...choices,URL,console,mountRecipeHandoff:()=>({setTasksScope(){}})});
 vm.runInContext(fs.readFileSync(new URL('app.mjs',appRoot),'utf8').split('\n').filter(line=>!line.startsWith('import ')).join('\n'),context,{filename:'app.mjs'});
 const frame=side=>ids[side+'-panel'].querySelector('iframe');
 function emit(side,route,sequence=1,overrides={}){
  const f=frame(side),parts=f.name.split(':'),version=catalog.versions.find(v=>v.id===parts[2]),caseKey=parts[3],c=catalog.cases[caseKey],url=new URL(route,'https://preview.example');
  f.contentWindow.location.pathname=url.pathname;f.contentWindow.location.search=url.search;
  const data={protocol:'historical-comparison-observation-v2',caseKey,caseId:c.caseId,caseSha256:c.caseSha256,side,variant:version.id,epoch:parts[4],documentId:side==='left'?'a'.repeat(32):'b'.repeat(32),mainSha256:version.mainSha256,sequence,route,edited:false,...overrides};
  f.contentWindow.__HISTORICAL_COMPARE_OBSERVATION__=data;return {source:f.contentWindow,origin:'https://preview.example',data};
 }
 async function event(name,event){for(const fn of events[name]??[])await fn(event);}
 async function load(side,route){const f=frame(side),parts=f.name.split(':'),version=catalog.versions.find(v=>v.id===parts[2]),caseKey=parts[3],c=catalog.cases[caseKey];if(!f.contentWindow.__HISTORICAL_COMPARE_CONFIG__)f.contentWindow.__HISTORICAL_COMPARE_CONFIG__=Object.freeze({side,variant:version.id,route:new URL(f.src,'https://preview.example').pathname.replace(/^\/+|\/+$/g,'')||'index',main:version.main,mainSha256:version.mainSha256,caseKey,caseId:c.caseId,caseSha256:c.caseSha256});emit(side,route);await f.fire('load');}
 async function click(id){assert.ok(ids[id],`UI has ${id}`);await ids[id].fire();}
 function mutate(side,text){const root=frame(side).appRoot;root.textContent=text;for(const observer of observers)if(observer.target===root)observer.callback();}
 function screen(side,{ready=false,page='tasks',hidden=false,inert=false,display='block',opacity='1',noRect=false,data=ready?'ready':'loading',scrollMissing=false,tabsMissing=false,tabsHidden=false,tabsNoRect=false}={}){
  const root=frame(side).appRoot,gate=new Element(),routes=new Element(),surface=new Element();
  gate.setAttribute('data-startup-state',ready?'ready':'loading');gate.setAttribute('aria-busy',String(!ready));
  gate.setAttribute('data-startup-data',data);
  if(ready)gate.setAttribute('data-testid','frontend-preview-ready');
  else{const logo=new Element();logo.setAttribute('data-testid','frontend-startup-loading');logo.textContent='育有方 正在開啟育有方…';gate.append(logo);}
  routes.setAttribute('aria-hidden',String(hidden||!ready));routes.inert=inert||!ready;routes.style.display=display;routes.style.opacity=opacity;
  surface.setAttribute('data-testid',page==='care'?(scrollMissing?'unrelated-scroll':'care-page-scroll'):page==='settings'?'account-settings':page==='tasks'?'tasks-reading-panel':'home-reading-panel');surface.textContent=page==='care'?'照顧記錄 合成示例':page==='settings'?'設定 帳戶 合成示例':page==='tasks'?'待辦 合成示例':'首頁 合成示例';surface.noRect=noRect;
  if(page==='care'&&!tabsMissing){const tabs=new Element();tabs.setAttribute('data-testid','care-review-tabs-bar');tabs.textContent='待確認 已保存';tabs.hidden=tabsHidden;tabs.noRect=tabsNoRect;surface.append(tabs);}
  routes.append(surface);gate.append(routes);root.replaceChildren(gate);
  for(const observer of observers)if(observer.target===root)observer.callback();return {gate,routes,surface};
 }
 return {ids,document,frames,copied,asks,navigation,window:w,frame,emit,event,load,click,mutate,screen,setAnswer(value){answer=value;}};
}
