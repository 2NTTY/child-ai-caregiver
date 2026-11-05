import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {SharingController} from '../src/production/SharingController.ts';
import {createSharingApi} from '../../src/client/sharing-api.ts';
import * as sharingController from '../src/production/SharingController.ts';
import * as sharing from '../../src/shared/sharing.ts';

const require = createRequire(import.meta.url);
const React = require('react'), {renderToStaticMarkup} = require('react-dom/server'), ts = require('typescript');
const root = fileURLToPath(new URL('../../', import.meta.url));
const wrap = ({children}) => React.createElement('div', null, children);
let buttons = [], host;
const AppButton = props => { buttons.push(props); return React.createElement('button', {disabled: props.disabled}, props.label); };
const empty = () => null;
function load(relative, injected) {
  const file = path.join(root, relative), raw = fs.readFileSync(file, 'utf8');
  const result = ts.transpileModule(raw, {fileName:file, reportDiagnostics:true,
    compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022, jsx:ts.JsxEmit.ReactJSX}});
  assert.deepEqual(result.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error), [], 'Single-file TS/TSX syntax diagnostics');
  const module={exports:{}};
  new Function('require','module','exports',result.outputText)(name => {
    if(Object.hasOwn(injected,name))return injected[name];
    if(name==='react'||name==='react/jsx-runtime'||name==='react-hook-form'||name==='@hookform/resolvers/zod'||name==='zod')return require(name);
    throw new Error('Unexpected unclosed UI dependency: '+name);
  },module,module.exports);
  return module.exports;
}
const screen = load('frontend/src/screens/familyScreen.tsx', {
  'expo-router':{useRouter:()=>({push:empty})},
  'react-native':{View:wrap, StyleSheet:{create:x=>x}}, 'react-native-paper':{Text:({children})=>React.createElement('span',null,children)},
  '../components/PageFrame':{PageFrame:wrap}, '../components/ui':{AppButton,AppSelect:empty,AppTextField:empty,SectionHeader:wrap},
  '../components/AppCheckbox':{AppCheckbox:empty}, '../components/AppDialog':{AppDialog:empty}, '../components/settings/SettingsSection':{SettingsSection:wrap},
  '../production/ProductionProvider':{useProduction:()=>host.production},
  '../production/useProductionSharing':{useProductionSharing:()=>({controller:host.controller,state:host.controller.getSnapshot()})},
  '../production/SharingController':sharingController,
  '../production/useDomainEnvironment':{useDomainWriteGuard:empty}, '../preview/PreviewNavigationGuard':{usePreviewNavigation:()=>empty},
  '../../../src/shared/sharing':sharing,
  '../theme':{chineseFont:{}, colors:{}, readingType:{}, spacing:{}}
});
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const first={operationId:id(2),action:'dissolve',space:null,exit:{spaceId:id(1),version:2,state:'dissolved',cleanupState:'pending'}};
function fixture({unknown=false,lookup=()=>first}={}){
  const gets=[],posts=[];
  const fetcher=async(input,init)=>{
    const url=new URL(String(input));assert.equal(url.origin,'https://ui-test.invalid');
    if(url.pathname.endsWith('/commands')){
      const command=JSON.parse(init.body);posts.push(command);
      if(command.action==='dissolve')return Response.json({...first,operationId:command.operationId,exit:{...first.exit,spaceId:command.spaceId}});
      if(unknown)throw new Error('Synthetic lost response');
      return Response.json({error:{code:'invalid_input'}},{status:400});
    }
    if(url.pathname.includes('/operations/')){const op=url.pathname.split('/').at(-1);gets.push(op);return Response.json({operation:await lookup(op)});}
    assert.equal(url.pathname,'/api/shared-spaces/classes');return Response.json({items:[],nextCursor:null});
  };
  const controller=new SharingController(createSharingApi('https://ui-test.invalid',fetcher),'class');controller.syncContext('synthetic-user','session:1',true);
  host={controller,production:{actions:{open:empty},recordsState:{children:[]},userId:'synthetic-user',identityKey:'session:1',owner:{getSnapshot:empty}}};
  return {controller,gets,posts,fetcher};
}
function render(){buttons=[];return renderToStaticMarkup(React.createElement(screen.SharedSpacesScreen,{mode:'class'}));}
const cleanupButtons=()=>buttons.filter(b=>b.label==='查核班級清理進度');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const firstCommand={action:'dissolve',operationId:id(2),spaceId:id(1),expectedVersion:1};
const nextCommand={action:'create',operationId:id(3),kind:'class',name:'Synthetic next'};

test('actual screen projection retains one cleanup block per ID and its callback checks only that receipt',async()=>{
  const f=fixture({lookup:op=>op===id(2)?first:{...first,operationId:id(6),exit:{...first.exit,spaceId:id(5)}}});
  try{
    await f.controller.submit(firstCommand);await f.controller.submit({...firstCommand,operationId:id(6),spaceId:id(5)});
    const html=render();assert.equal(cleanupButtons().length,2);assert.ok(html.includes(id(1)));assert.ok(html.includes(id(5)));
    cleanupButtons()[0].onPress();await flush();assert.deepEqual(f.gets,[id(2)]);
    render();cleanupButtons()[1].onPress();await flush();assert.deepEqual(f.gets,[id(2),id(6)]);assert.equal(f.posts.length,2);
  }finally{f.controller.dispose();}
});

test('actual screen keeps unknown-command warning and allows safe targeted cleanup read without enabling another write',async()=>{
  const f=fixture({unknown:true});
  try{
    await f.controller.submit(firstCommand);await f.controller.submit(nextCommand);const html=render();
    assert.ok(html.includes('剛才的操作結果仍待確認'));assert.equal(cleanupButtons().length,1);assert.equal(cleanupButtons()[0].disabled,false);
    assert.equal(buttons.find(b=>b.label==='建立這個班級').disabled,true);
    cleanupButtons()[0].onPress();await flush();assert.deepEqual(f.gets,[id(2)]);assert.equal(f.controller.getSnapshot().pending.command.operationId,id(3));
    assert.equal(f.controller.getSnapshot().pending.checked,false);assert.equal(f.posts.length,2);
  }finally{f.controller.dispose();}
});

test('actual screen disables cleanup checks offline and during an in-flight check',async()=>{
  let release;const f=fixture({lookup:()=>new Promise(resolve=>{release=resolve;})});
  try{
    await f.controller.submit(firstCommand);f.controller.syncContext('synthetic-user','session:1',false);render();assert.equal(cleanupButtons()[0].disabled,true);
    f.controller.syncContext('synthetic-user','session:1',true);const check=f.controller.checkOriginal(id(2));render();
    assert.equal(cleanupButtons()[0].disabled,true);assert.equal(cleanupButtons()[0].loading,true);release(first);await check;
  }finally{f.controller.dispose();}
});

// Render the real identity projection hook separately with a synthetic host owner.
// This does not substitute the controller/API/schema and is not a mounted app/browser test.
test('actual useProductionSharing identity mismatch masks retained cleanup before host synchronization',async()=>{
  const f=fixture();let capture;const listeners=new Set();
  const snapshot={records:{auth:'signedIn',user:{id:'synthetic-user'},online:true},account:{gate:'ready'},identityKey:'owner:1',sessionGeneration:1};
  const owner={apiBaseUrl:'https://ui-test.invalid',fetcher:f.fetcher,getSnapshot:()=>snapshot,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},setDomainPending:empty};
  let context={owner,userId:'synthetic-user',identityKey:'owner:1',sessionGeneration:1,auth:'signedIn',account:{gate:'ready'},online:true};
  const hook=load('frontend/src/production/useProductionSharing.ts',{
    '../../../src/client/sharing-api.ts':{createSharingApi}, './SharingController.ts':sharingController,
    './ProductionProvider':{useProduction:()=>context},
    // React server rendering requires a server snapshot for this client-only hook. Use the real store's snapshot getter.
    react:{...React,useSyncExternalStore:(_subscribe,getSnapshot)=>getSnapshot()},
  });
  const Probe=()=>{capture=hook.useProductionSharing('class');return null;};
  try{
    renderToStaticMarkup(React.createElement(Probe));await capture.controller.submit(firstCommand);
    renderToStaticMarkup(React.createElement(Probe));assert.equal(capture.state.cleanupReceipts.length,1);
    context={...context,identityKey:'owner:2',sessionGeneration:2};renderToStaticMarkup(React.createElement(Probe));
    assert.deepEqual(capture.state.cleanupReceipts,[]);assert.equal(capture.state.receipt,null);assert.equal(capture.state.pending,null);
    assert.equal(capture.controller.getSnapshot().cleanupReceipts.length,1,'The source projection, not a controller reset, masks the old identity');
    snapshot.identityKey='owner:2';snapshot.sessionGeneration=2;for(const listener of listeners)listener();
    renderToStaticMarkup(React.createElement(Probe));assert.deepEqual(capture.controller.getSnapshot().cleanupReceipts,[]);
  }finally{capture?.controller.dispose();f.controller.dispose();}
});
