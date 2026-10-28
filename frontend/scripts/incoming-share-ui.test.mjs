import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {harness} from './scope-transition-harness.mjs';

const tick=()=>new Promise(setImmediate);
function mocksFor(h,mocks){
  mocks.react={...h.react,useSyncExternalStore(subscribe,getSnapshot){
    const [,update]=h.react.useState(0);h.react.useLayoutEffect(()=>subscribe(()=>update(n=>n+1)),[subscribe]);return getSnapshot();
  }};
  mocks['../theme']={spacing:{sm:8,md:12,lg:16},colors:{controlSurface:'white',line:'gray'},chineseFont:'sans-serif'};
  mocks['../components/ui']={AppButton:'Button',SectionCard:'Card'};
}

test('incoming provider preserves anonymous input for sign-in and synchronously clears an earlier account',()=>{
  const mocks={},h=harness(mocks);mocksFor(h,mocks);
  let identity=null,notifyPlatform,context;
  const observers=new Set(),pushes=[];
  let raw=[{shareType:'text',value:'PRIVATE_INCOMING_BODY'}];
  const platform={read:()=>raw,clear(){raw=[];},subscribe(fn){notifyPlatform=fn;return()=>{notifyPlatform=null;};},prepare(){assert.fail('No automatic attachment prepare');}};
  const owner={getSnapshot:()=>({identityKey:identity}),subscribe(fn){observers.add(fn);return()=>observers.delete(fn);}};
  mocks['../platform/incoming-share']={createIncomingSharePlatform:()=>platform};
  mocks['react-native']={View:'View',StyleSheet:{create:x=>x}};
  mocks['expo-router']={useRouter:()=>({push:value=>pushes.push(value)}),usePathname:()=>'/chat'};
  mocks['../preview/PreviewNavigationGuard']={usePreviewNavigation:()=>action=>action()};
  const {IncomingShareProvider,useIncomingShare}=h.load('src/production/IncomingShareProvider.tsx');
  function Child(){context=useIncomingShare();return null;}
  h.render(h.jsx(IncomingShareProvider,{owner,children:h.jsx(Child,{})}));
  assert.equal(context.snapshot.items.length,1);assert.equal(pushes.length,0);
  assert.doesNotMatch(JSON.stringify(h.hosts()),/PRIVATE_INCOMING_BODY/);
  const change=next=>{identity=next;for(const fn of observers)fn();};
  change('actor-a');assert.equal(context.inbox.getSnapshot().items.length,1);
  change('actor-b');assert.equal(context.inbox.getSnapshot().items.length,0,'Clear happens inside owner notification, before the next render');
  raw=[{shareType:'image',value:'content://private/attachment'}];notifyPlatform();h.render();assert.equal(context.snapshot.items.length,1);
  assert.doesNotMatch(JSON.stringify(h.hosts()),/content:\/\//);
  change(null);assert.equal(context.inbox.getSnapshot().items.length,0);h.render();
  h.unmount();assert.equal(observers.size,0);assert.equal(notifyPlatform,null);
});

test('share screen shows local text and media types, personal children, and only accepts an explicit item',async()=>{
  const mocks={},h=harness(mocks);mocksFor(h,mocks);
  const pushes=[],takes=[],discards=[],selections=[],guards=[];
  const target={current:()=>true};let accept=false;
  const production={owner:{},identityKey:'actor',selectedChildId:'child-a',sharedChild:{target:null},account:{gate:'ready'},
    recordsState:{selectedChildId:'child-a',children:[{id:'child-a',displayName:'Child A',accessRole:'owner'},{id:'child-b',displayName:'Child B',accessRole:'owner'}]},
    model:{children:[{id:'child-a',displayName:'Child A'},{id:'child-b',displayName:'Child B'},{id:'shared:space:child',displayName:'Shared child'}]},
    actions:{selectChild:id=>selections.push(id)},chatDraft:'Existing draft',agentAttachments:[{kind:'photo'}]};
  const share={snapshot:{items:[{id:1,payload:{shareType:'text',value:'Local text'}},{id:2,payload:{shareType:'image',value:'content://private/secret'}}],busyId:null,error:null},
    inbox:{async take(id,value){takes.push([id,value]);return accept;},discard:id=>discards.push(id)}};
  mocks['../production/IncomingShareProvider']={useIncomingShare:()=>share};
  mocks['../preview/PreviewNavigationGuard']={usePreviewLeaveGuard:(...args)=>guards.push(args)};
  mocks['../production/ProductionProvider']={useProduction:()=>production};
  mocks['../production/incoming-share-target']={createProductionShareTarget:owner=>{assert.equal(owner,production.owner);return target;}};
  mocks['../components/PageFrame']={PageFrame:'PageFrame'};
  mocks['../components/ChildPicker']={ChildPicker:props=>h.jsx('Picker',{options:props.children,selectedId:props.selectedId,onSelect:props.onSelect})};
  mocks['expo-router']={useRouter:()=>({push:path=>pushes.push(path)}),usePathname:()=>'/share'};
  const Screen=h.load('src/screens/shareScreen.tsx').default;h.render(h.jsx(Screen,{}));
  assert.equal(guards.at(-1)?.[0],true,'The existing attachment must be protected while inspecting incoming shares');
  assert.equal(guards.at(-1)?.[2],'child');
  const text=JSON.stringify(h.hosts());assert.match(text,/Local text/);assert.doesNotMatch(text,/content:\/\/private\/secret/);
  const picker=h.hosts().find(node=>node.type==='Picker');assert.deepEqual(picker.props.options.map(x=>x.id),['child-a','child-b']);picker.props.onSelect('child-b');assert.deepEqual(selections,['child-b']);
  const add=h.hosts().filter(node=>node.type==='Button'&&node.props.label==='加入目前聊天草稿');assert.equal(add.length,2);assert.equal(takes.length,0);
  await add[0].props.onPress();assert.deepEqual(takes,[[1,target]]);assert.deepEqual(pushes,[]);
  accept=true;await add[1].props.onPress();assert.deepEqual(pushes,['/chat']);
  h.hosts().find(node=>node.type==='Button'&&node.props.label==='捨棄這項').props.onPress();assert.deepEqual(discards,[1]);
  assert.equal(production.chatDraft,'Existing draft');assert.equal(production.agentAttachments.length,1);h.unmount();await tick();
});

test('incoming provider rejects late preparation after switching away and back to the same child',async()=>{
  const mocks={},h=harness(mocks);mocksFor(h,mocks);
  let scope='child-a',context,resolve,disposed=0,added=0;
  const observers=new Set();
  let raw=[{shareType:'file',value:'content://documents/file'}];
  const platform={read:()=>raw,clear(){raw=[];},subscribe:()=>()=>{},prepare:()=>new Promise(r=>{resolve=r;})};
  const owner={getSnapshot:()=>({identityKey:'actor',scopeKey:scope}),subscribe(fn){observers.add(fn);return()=>observers.delete(fn);}};
  mocks['../platform/incoming-share']={createIncomingSharePlatform:()=>platform};
  mocks['react-native']={View:'View',StyleSheet:{create:x=>x}};
  mocks['expo-router']={useRouter:()=>({push(){}}),usePathname:()=>'/share'};
  mocks['../preview/PreviewNavigationGuard']={usePreviewNavigation:()=>action=>action()};
  const {IncomingShareProvider,useIncomingShare}=h.load('src/production/IncomingShareProvider.tsx');
  function Child(){context=useIncomingShare();return null;}
  h.render(h.jsx(IncomingShareProvider,{owner,children:h.jsx(Child,{})}));
  const item=context.inbox.getSnapshot().items[0];
  const pending=context.inbox.take(item.id,{current:()=>scope==='child-a',appendText:()=>false,appendAttachment(){added++;return true;}});
  for(const next of ['child-b','child-a']){scope=next;for(const fn of observers)fn();}
  resolve({id:'copy',kind:'file',bytes:1,dispose(){disposed++;}});
  assert.equal(await pending,false);assert.equal(added,0);assert.equal(disposed,1);
  assert.equal(context.inbox.getSnapshot().items.length,1);h.unmount();
});

test('share route is connected, has no data curtain requirement, and preserves chat attachments',()=>{
  const h=harness({'../startup/FirstScreenGate':{FirstScreenGate:'FirstScreenGate'}});assert.equal(h.load('src/production/routes.ts').isProductionRouteConnected('/share'),true);
  assert.deepEqual(h.load('src/startup/dataReadiness.ts').routeStartupRequirements('/share',{},true,true),[]);
  assert.equal(h.load('src/production/shared-route-access.ts').sharedRouteMessage({target:{},view:null},'/share'),null);
  h.production({identityKey:null,scopeKey:null,recordsState:{auth:'checking'},sharedChild:{target:null},account:{gate:'checking'},controller:{}});h.route('/share');
  const Gate=h.load('src/production/ProductionFirstScreenGate.tsx').ProductionFirstScreenGate;
  h.render(h.jsx(Gate,{width:390,launch:null,children:null}));assert.equal(h.hosts().find(node=>node.type==='FirstScreenGate').props.dataState,'ready');
  const source=readFileSync(new URL('../src/production/ProductionProvider.tsx',import.meta.url),'utf8');
  const condition=source.match(/if \((\(!\[.*?\r?\n\s*&& .*?)\) owner\.draftOwner\.clearAttachments/u)?.[1];assert.ok(condition);
  const shouldClear=new Function('pathname','previousPath','owner',`return ${condition};`);
  const owner={voiceOwner:{getSnapshot:()=>({})},fileOwner:{getSnapshot:()=>({})},photoOwner:{getSnapshot:()=>({})},draftOwner:{getSnapshot:()=>({attachments:[]})}};
  assert.equal(shouldClear('/share',{current:'/chat'},owner),false);assert.equal(shouldClear('/chat',{current:'/share'},owner),false);
  assert.equal(shouldClear('/care',{current:'/chat'},owner),true);
});

test('same-ID personal selection exits shared context through the existing child leave guard',()=>{
  const source=readFileSync(new URL('../src/production/ProductionProvider.tsx',import.meta.url),'utf8');
  const body=source.match(/selectChild\(id\) \{([\s\S]*?)\r?\n    \},\r?\n    refresh:/u)?.[1];assert.ok(body);
  const select=new Function('id','snapshot','current','model','leave','owner',body);
  const calls=[],guards=[],snapshot={identityKey:'actor',sharedChild:{target:{spaceId:'space-a'}}};
  const current={current:{identityKey:'actor'}},model={selectedChildId:'child-a'},owner={selectPersonalChild:id=>calls.push(id)};
  const leave=(action,intent)=>{guards.push(intent);action();};
  select('child-a',snapshot,current,model,leave,owner);assert.deepEqual(calls,['child-a']);assert.deepEqual(guards,['child']);
  snapshot.sharedChild.target=null;select('child-a',snapshot,current,model,leave,owner);assert.equal(calls.length,1);
  current.current.identityKey='another-actor';select('child-b',snapshot,current,model,leave,owner);assert.equal(calls.length,1);
});
