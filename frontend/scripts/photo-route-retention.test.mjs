import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import ts from 'typescript';

// Actual photo owner and React effects with synthetic API/router/native ports.
// This test needs an existing external jsdom; it does not prove Expo URL parsing.
const require=createRequire(import.meta.url);
const {JSDOM}=require(process.env.TEST_JSDOM_PATH || 'jsdom');
const source=process.env.PHOTO_ROUTE_SOURCE || path.resolve(import.meta.dirname,'../src/production/PhotoInputDomains.tsx');
const dom=new JSDOM('<div id="root"></div>',{url:'https://synthetic.invalid/'});
globalThis.window=dom.window; globalThis.document=dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT=true;
class ApiError extends Error { constructor(status=0,onlineCode=null){super('Synthetic failure');Object.assign(this,{status,onlineCode});} }
const empty=()=>({text:'',kind:'note',rawValue:'',unit:'',approximate:false,timeRaw:''});
function fixture(initialPath='/photos',initialView){
  let route={path:initialPath,view:initialView}, scope='scope-a', latest, guard, previous=initialPath, pending=false;
  const counts={reads:0,reserves:0,uploads:0,extracts:0,resets:0}, subscriptions=new Set();
  const draft={scope,attachments:[]};
  const owner={draftOwner:{getSnapshot:()=>draft,subscribe:fn=>{subscriptions.add(fn);return ()=>subscriptions.delete(fn);}}};
  const emit=()=>{for(const fn of subscriptions)fn();};
  const api={resetOnline(){counts.resets++;},hasPendingOnline:()=>pending,
    photos:async()=>{counts.reads++;return {photos:[],canCreate:true};},
    reserve:async()=>{counts.reserves++;pending=true;throw new ApiError();},
    upload:async()=>{counts.uploads++;assert.fail('No remote upload should occur');},extract:async()=>{counts.extracts++;assert.fail('No model call should occur');}};
  let currentEnv;
  const createEnv=key=>({apiBaseUrl:'/synthetic-api',scopeKey:key,userId:'synthetic-parent',childId:key==='scope-a'?'child-a':'child-b',childName:'Synthetic',role:'owner',online:true,owner,
    current:()=>scope===key,currentIdentity:()=>scope===key,canStartWrite:()=>true,invalidate(){},accessError(){},queryClient:{fetchQuery:({queryFn})=>queryFn()}});
  currentEnv=createEnv(scope);
  const code=ts.transpileModule(readFileSync(source,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const exports={};
  new Function('require','exports',code+'\nexports.reviewPhotoOwner=useProductionPhotos;')(name=>{
    if(name==='react'||name==='react/jsx-runtime')return require(name);
    if(name==='react-native')return {Platform:{OS:'web'}};
    if(name==='expo-router')return {usePathname:()=>route.path,useGlobalSearchParams:()=>({view:route.view})};
    if(name.includes('/photo-api'))return {createPhotoApi:()=>api,PhotoApiError:ApiError};
    if(name.includes('/use-online-updates'))return {ONLINE_REFRESH_EVENT:'synthetic-photo-refresh'};
    if(name.includes('/photo-view-model'))return {emptyPhotoDraft:empty,samePhotoOriginal:(a,b)=>a.bytes===b.bytes&&a.sha256===b.sha256&&a.mimeType===b.mimeType};
    if(name==='./useDomainEnvironment')return {forSharedModule:env=>env,useDomainEnvironment:()=>currentEnv,useDomainWriteGuard:(dirty,isPending)=>{guard={dirty:!!dirty,pending:!!isPending};return 'photo';}};
    if(name.endsWith('/shared/photos'))return {photoMetadataSchema:{safeParse:value=>({success:true,data:value})}};
    if(name.includes('/photo-form'))return {photoDraftSchema:{safeParse:value=>({success:true,data:value})}};
    if(name==='./usePhotoInputSources'||name==='./ProductionProvider'||name.includes('/PreviewNavigationGuard')||name==='react-native-paper'||name.startsWith('../components/'))return {};
    assert.fail('Unexpected import '+name);
  },exports);
  function Host(){latest=exports.reviewPhotoOwner();React.useLayoutEffect(()=>{if(previous==='/chat'&&route.path!=='/chat'){draft.attachments=[];emit();}previous=route.path;},[route.path]);return null;}
  const root=createRoot(document.getElementById('root'));
  const render=()=>act(async()=>{root.render(React.createElement(Host,{key:scope}));});
  return {counts,draft,api,model:()=>latest.model,guard:()=>guard,read:()=>latest,
    ready:render,change:async(p,v)=>{route={path:p,view:v};await render();},
    action:fn=>act(async()=>{await fn(latest.actions,latest);}),
    switchScope:async()=>{scope='scope-b';draft.scope=scope;draft.attachments=[];currentEnv=createEnv(scope);await render();},
    close:()=>act(async()=>{scope='unmounted';root.unmount();})};
}
async function original(){
  let disposed=0;const bytes=new Uint8Array([1,2,3]),encoded=btoa(String.fromCharCode(...bytes));
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  return {value:{fileName:'synthetic.png',mimeType:'image/png',bytes:bytes.length,sha256,imageSource:{uri:'synthetic'},readBase64:async()=>encoded,dispose(){disposed++;}},encoded,disposed:()=>disposed};
}
async function draftPhoto(f){const o=await original();await f.action(a=>a.pickOriginal(o.value));await f.action(a=>a.editDraft({...empty(),text:'Synthetic unsaved photo note'}));return o;}

test('a photos-first array alias retains the actual original and edited draft on route entry',async()=>{
  const f=fixture();try{await f.ready();const o=await draftPhoto(f),reads=f.counts.reads;await f.change('/care',['photos','records']);
    assert.equal(f.model().original,o.value,'a visible Photos alias must not release the original');assert.equal(o.disposed(),0);assert.equal(f.model().draft.text,'Synthetic unsaved photo note');assert.equal(f.guard().dirty,true);assert.equal(f.counts.reads,reads);
  }finally{await f.close();}
});
test('leaving a cold-mounted photos-first array alias disposes ordinary original and draft',async()=>{
  const f=fixture('/care',['photos','records']);try{await f.ready();const o=await draftPhoto(f);await f.change('/care',['records','photos']);
    assert.equal(f.model().original,null);assert.equal(f.model().draft.text,'');assert.equal(o.disposed(),1);assert.equal(f.guard().dirty,false);
  }finally{await f.close();}
});
test('actual chat transfer keeps independent owned bytes entering the array Photos alias',async()=>{
  const f=fixture('/chat');try{await f.ready();const o=await original();f.draft.attachments=[{photo:o.value}];let received;
    await f.action(async(_a,v)=>{received=await v.receiveComposerOriginal(o.value);});assert.equal(received,true);const owned=f.model().original;assert.notEqual(owned,o.value);
    await f.change('/care',['photos','records']);assert.equal(f.model().original,owned);assert.equal(await owned.readBase64(),o.encoded);assert.equal(f.draft.attachments.length,0);
    await f.change('/tasks');assert.equal(f.model().original,null);await assert.rejects(owned.readBase64(),/Original released/);
    assert.equal(f.counts.reserves,0);assert.equal(f.counts.uploads,0);assert.equal(f.counts.extracts,0);
  }finally{await f.close();}
});
test('scalar, array and photos route aliases preserve the same draft until real departure',async()=>{
  const f=fixture('/care','photos');try{await f.ready();const o=await draftPhoto(f);
    for(const [p,v] of [['/care',['photos']],['/care',['photos','other']],['/photos',undefined],['/care','photos']]){await f.change(p,v);assert.equal(f.model().original,o.value);assert.equal(f.model().draft.text,'Synthetic unsaved photo note');}
    await f.change('/care',undefined);assert.equal(f.model().original,null);assert.equal(o.disposed(),1);
  }finally{await f.close();}
});
test('pending original receipt still blocks draft disposal across non-photo route departure',async()=>{
  const f=fixture('/care',['photos','records']);try{await f.ready();const o=await draftPhoto(f);await f.action(a=>a.upload());assert.equal(f.model().operation.state,'unknown');assert.equal(f.guard().pending,true);
    const before={...f.counts};await f.change('/tasks');assert.equal(f.model().original,o.value);assert.equal(o.disposed(),0);assert.equal(f.model().operation.state,'unknown');assert.equal(f.guard().pending,true);assert.deepEqual(f.counts,before);
  }finally{await f.close();}
});
test('changing child scope clears owned drafts even on an array Photos alias',async()=>{
  const f=fixture('/care',['photos']);try{await f.ready();const o=await draftPhoto(f);await f.switchScope();assert.equal(f.model().original,null);assert.equal(f.model().draft.text,'');assert.equal(o.disposed(),1);assert.equal(f.guard().dirty,false);
  }finally{await f.close();}
});
