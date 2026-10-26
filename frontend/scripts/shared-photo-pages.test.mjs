import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {harness} from './scope-transition-harness.mjs';

const root=path.resolve(import.meta.dirname,'..');
const photo={id:'photo-a',childId:'child-a',ownerUserId:'source-owner',createdAt:'2026-10-27T00:00:00Z',version:1,
  state:'ready',visibility:'shared',sharedSpaceId:'space-a',canManage:true,recordId:null,fileName:'shared.png',mimeType:'image/png',bytes:1,
  sha256:'a'.repeat(64),source:'Human source',extraction:{state:'not_requested',runId:null,draft:null}};
class ApiError extends Error{constructor(status=0){super('Synthetic failure');this.status=status;}}
const settle=async h=>{await new Promise(setImmediate);h.render();await new Promise(setImmediate);h.render();};
function fixture({shared=true,role='caregiver',modules=['attachments']}={}){
  let active=true,denied=false,value,sourceValue,selection;
  const calls=[],accessErrors=[];
  const env={apiBaseUrl:'/api',userId:'actor',childId:'child-a',childName:'Synthetic',scopeKey:'shared-scope',role,online:true,
    sharedMode:shared,sharing:shared?{spaceId:'space-a',expectedBasis:{shareVersion:1}}:undefined,
    allows:module=>!shared||modules.includes(module),current:()=>active,currentIdentity:()=>active,
    owner:{fetcher(){assert.fail('Real network forbidden');},draftOwner:{getSnapshot:()=>({attachments:[]}),subscribe:()=>()=>{}}},
    canStartWrite:()=>true,invalidate(){},accessError:error=>{accessErrors.push(error);active=false;},queryClient:{fetchQuery:({queryFn})=>queryFn()}};
  const api={resetOnline(){},hasPendingOnline:()=>false,photos:async()=>{calls.push('photos');if(denied)throw new ApiError(403);return{photos:[{...photo,canManage:role!=='viewer'}],canCreate:!shared&&role!=='viewer'};},
    photo:async()=>({...photo,canManage:role!=='viewer'}),content:async()=>new Blob([new Uint8Array([1])]),
    delete:async()=>{calls.push('delete');return{deleted:true,cleanupPending:true};},
    ...Object.fromEntries(['reserve','upload','extract','confirm'].map(name=>[name,async()=>assert.fail('Private photo write forbidden: '+name)]))};
  const mocks={};const h=harness(mocks);
  mocks.react={...h.react,useId:()=> 'photo-test',memo:fn=>fn};
  mocks['../preview/PreviewNavigationGuard']={usePreviewNavigation:()=>action=>action(),usePreviewLeaveGuard(){}};
  const {forSharedModule}=h.load('src/production/useDomainEnvironment.ts');
  mocks['./useDomainEnvironment']={useDomainEnvironment:()=>env,forSharedModule,useDomainWriteGuard(){}};
  mocks['./ProductionProvider']={useProduction:()=>({actions:{open(){}},attachSavedPhoto(){}})};
  mocks['../../../src/client/photo-api']={PhotoApiError:ApiError,createPhotoApi:(_base,_fetch,_hash,sharing)=>{selection=sharing;return api;}};
  mocks['../../../src/client/shared-input-api']={SharedInputApiError:ApiError,createSharedInputApi:()=>({resetOnline(){},inputs:async()=>{calls.push('private-inputs');return{inputs:[],sources:[],canCreate:false};}})};
  mocks['../platform/photo-bytes']={photoPreview:()=>({uri:'synthetic',dispose(){}}),photoSha256(){}};
  mocks['../components/photos/PhotosView']={PhotosView:'PhotosView'};
  mocks['../components/shared-inputs/SourcesView']={SourcesView:'SourcesView'};
  mocks['../components/ui']={AppButton:'Button',SectionCard:'SectionCard',SectionHeader:'SectionHeader'};
  mocks['./useAttachmentReview']={useAttachmentReview:()=>({})};
  mocks['./usePhotoInputSources']={};
  function loadOwner(){
    const file=path.join(root,'src/production/PhotoInputDomains.tsx');
    const code=ts.transpileModule(readFileSync(file,'utf8')+'\nexport {useProductionPhotos};',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
    const module={exports:{}};
    new Function('require','module','exports',code)(name=>{
      if(name in mocks)return mocks[name];
      if(name==='react/jsx-runtime')return{jsx:h.jsx,jsxs:h.jsx};
      if(name==='react-native')return{View:'View'};
      if(name==='react-native-paper')return{Text:'Text'};
      if(name==='expo-router')return{usePathname:()=>'/photos',useGlobalSearchParams:()=>({}),useRouter:()=>({})};
      if(name==='../../../src/client/online-refresh-events')return{subscribeOnlineRefresh:()=>()=>{}};
      if(name.startsWith('.')){const target=path.resolve(path.dirname(file),name);return h.load(existsSync(target)?target:existsSync(target+'.ts')?target+'.ts':target+'.tsx');}
      throw Error('Unexpected import '+name);
    },module,module.exports);return module.exports;
  }
  const owner=loadOwner();
  // Keep the actual private source hook mounted as the shared bridge does.
  delete mocks['./usePhotoInputSources'];
  const sources=h.load('src/production/usePhotoInputSources.ts');
  function Host(){value=owner.useProductionPhotos();sourceValue=sources.usePhotoInputSources();return null;}
  return{h,calls,env,owner,get:()=>value,sources:()=>sourceValue,selection:()=>selection,accessErrors,
    async start(){h.render(h.jsx(Host,{}));await settle(h);},async action(fn){fn(value.actions,value);h.render();await settle(h);},
    deny(){denied=true;},close(){h.unmount();}};
}

test('shared photo owner passes selection, blocks private flows and retains role-based deletion',async()=>{
  const f=fixture();try{
    await f.start();assert.equal(f.selection(),f.env.sharing);assert.deepEqual(f.calls,['photos']);
    assert.equal(f.get().model.capacityReached,false);assert.equal(f.get().model.canPick,false);assert.equal(f.get().model.formLocked,true);
    let disposed=false;await f.action(a=>a.pickOriginal({dispose(){disposed=true;}}));assert.equal(disposed,true);
    await f.action((a,v)=>a.openPhoto(v.model.items[0]));assert.equal(f.get().model.selected.id,photo.id);assert.equal(f.get().model.canDelete,true);
    await f.action(a=>{a.upload();a.extract();a.confirmShared();a.openDeletion();});
    await f.action(a=>a.setDeleteScope(true));await f.action(a=>a.setDeleteFinal(true));await f.action(a=>a.deletePhoto());
    assert.equal(f.calls.filter(call=>call==='delete').length,1);assert.equal(f.get().model.operation.state,'saved');
    assert.equal(f.calls.includes('private-inputs'),false);
    f.deny();await f.action(a=>a.refresh());assert.equal(f.get().model.access,'lost');assert.deepEqual(f.get().model.items,[]);assert.equal(f.accessErrors.length,1);
  }finally{f.close();}
});

test('missing attachments grant makes no photo or private-source read',async()=>{
  const f=fixture({modules:['tasks']});try{await f.start();assert.deepEqual(f.calls,[]);}finally{f.close();}
});

test('shared viewer cannot delete while personal photo and source entry remain available',async()=>{
  const viewer=fixture({role:'viewer'});try{await viewer.start();await viewer.action((a,v)=>a.openPhoto(v.model.items[0]));
    assert.equal(viewer.get().model.canDelete,false);await viewer.action(a=>{a.openDeletion();a.deletePhoto();});
    assert.equal(viewer.get().model.deletion,false);assert.equal(viewer.calls.includes('delete'),false);
  }finally{viewer.close();}
  const personal=fixture({shared:false});try{await personal.start();assert.equal(personal.selection(),undefined);
    assert.equal(personal.get().model.canPick,true);assert.equal(personal.calls.includes('private-inputs'),true);
  }finally{personal.close();}
});

test('shared photo routes wait for attachments reads and keep private sources disabled',()=>{
  const h=harness(),route=h.load('src/production/shared-route-access.ts');
  const state={target:{spaceId:'space-a',childId:'child-a'},view:{modules:['attachments']}};
  assert.equal(route.sharedRouteMessage(state,'/photos'),null);
  assert.equal(route.sharedRouteMessage(state,'/care',{view:'photos'}),null);
  assert.equal(route.sharedStartupReads(state,{photos:'loading',sources:'loading'}).photos,'loading');
  assert.equal(route.sharedStartupReads(state,{photos:'loading',sources:'loading'}).sources,'ready');
  assert.match(route.sharedRouteMessage({...state,view:{modules:['tasks']}},'/photos'),/沒有共享/);
});

test('shared PhotosView keeps deletion but hides private workflow and unavailable care navigation',()=>{
  const mocks={},h=harness(mocks);
  mocks.react={...h.react,useId:()=> 'shared-view'};
  mocks['../useContainerWidth']={useContainerWidth:()=>({width:1000})};
  mocks['../../theme']={colors:{},mobileLayout:{breakpoint:600}};
  const Dialog=Object.assign(p=>h.jsx('Dialog',p),{Title:'DialogTitle',Content:'DialogContent',Actions:'DialogActions',ScrollArea:'DialogScrollArea'});
  mocks['../AppDialog']={AppDialog:Dialog};
  mocks['react-native-paper']={Text:'Text',Portal:'Portal'};
  for(const leaf of ['AppStatusBadge','AppCheckbox','AppIcon','PageFrame','ReadStateNotice','StatusAnnouncement','FormDialog'])
    mocks['../'+leaf]={[leaf==='FormDialog'?'ManualFormDialog':leaf]:leaf};
  mocks['../ui']=Object.fromEntries(['AppButton','AppTextField','SectionCard','SectionHeader','UnderlineTabs','AppTabPanel'].map(name=>[name,name]));
  mocks['../FormErrorSummary']={FormFieldMessage:'FormFieldMessage'};
  mocks['../../motion']={MotionFeedback:'MotionFeedback',MotionReveal:'MotionReveal'};
  mocks['../shared-inputs/useContentListMotion']={useContentListMotion:()=>null};
  mocks['../shared-inputs/useContentDeletionFocus']={useContentDeletionFocus:()=>({start(){},onClosed(){}})};
  mocks['./PhotoFilePicker']={PhotoFilePicker:'PhotoFilePicker'};
  mocks['./PhotoRecordForm']={PhotoRecordForm:'PhotoRecordForm'};
  mocks['./photo-styles']={photoStyles:{}};
  mocks['./AttachmentLibrary']={PhotoGallery:'PhotoGallery',OriginalMediaLibrary:'OriginalMediaLibrary'};
  const {PhotosView}=h.load('src/components/photos/PhotosView.tsx');
  const model={childName:'Synthetic',online:true,access:'editable',load:'ready',items:[photo],selected:{...photo,extraction:{state:'not_requested',candidate:null}},
    operation:{state:'none'},capacityReached:true,canCreate:false,canDelete:true,fresh:true,draft:{},deletion:true};
  h.render(h.jsx(PhotosView,{model,actions:new Proxy({},{get:()=>()=>{}}),sharedScope:true,onChat(){},onChatPhoto(){}}));
  const tree=JSON.stringify(h.hosts()),labels=h.hosts().map(node=>node.props.label).filter(Boolean);
  for(const label of ['返回核對','加入聊天','人工核對照片記錄','加入原照片'])assert.equal(labels.includes(label),false,label);
  assert.equal(labels.includes('刪除照片及連結記錄'),true);
  assert.equal(h.hosts().some(node=>node.type==='PhotoFilePicker'),false);
  assert.doesNotMatch(tree,/已達到新增容量限制|照片先私人保存|私人保存原照片/);
  assert.match(tree,/原附件/);h.unmount();
});
