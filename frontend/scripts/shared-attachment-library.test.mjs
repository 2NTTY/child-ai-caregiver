import assert from 'node:assert/strict';
import test from 'node:test';
import {harness} from './scope-transition-harness.mjs';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const childId=id(1),spaceId=id(2),attachment={id:id(3),childId,version:1,state:'ready',createdAt:'2026-10-27T00:00:00Z',fileName:'shared.wav',mimeType:'audio/wav',bytes:1,sha256:'a'.repeat(64),messageId:null,sharedSpaceId:spaceId,durationMs:1000};
const settle=async h=>{await new Promise(setImmediate);h.render();};
function setup({modules=['attachments'],role='caregiver'}={}){
  const calls=[],guards=[];let value,active=true;
  const env={scopeKey:'shared',apiBaseUrl:'https://example.test',childId,userId:'actor',online:true,role,sharedMode:true,sharing:{spaceId},
    current:()=>active,allows:module=>modules.includes(module),canStartWrite:()=>true,invalidate(){},accessError(){active=false;},
    owner:{voiceApi:{list(){assert.fail('private voice');}},fileApi:{list(){assert.fail('private file');}},fetcher:async(url,init)=>{
      calls.push({url:String(url),method:init?.method});const voice=String(url).includes('/voices');
      return Response.json({items:[voice?attachment:(({durationMs,...file})=>({...file,mimeType:'application/pdf'}))(attachment)],nextCursor:null,complete:true,scanned:1});}}};
  const mocks={'../preview/PreviewNavigationGuard':{},'../../../src/client/online-refresh-events':{subscribeOnlineRefresh:()=>()=>{}},
    './VoiceMessage':{VoiceMessage:'VoiceMessage'},'./ChatFileMessage':{ChatFileMessage:'ChatFileMessage'}};
  const h=harness(mocks);const {forSharedModule}=h.load('src/production/useDomainEnvironment.ts');
  mocks['./useDomainEnvironment']={useDomainEnvironment:()=>env,forSharedModule,useDomainWriteGuard:(...args)=>guards.push(args)};
  const {useAttachmentReview}=h.load('src/production/useAttachmentReview.tsx');
  function Host(){value=useAttachmentReview();return h.jsx('Host',{});}
  h.render(h.jsx(Host,{}));return{...h,calls,get value(){return value;}};
}

test('shared attachment library uses selected formal clients and null chat references, without private reads',async()=>{
  const h=setup();await settle(h);
  assert.equal(h.calls.length,2);assert.ok(h.calls.every(call=>new URL(call.url).searchParams.get('spaceId')===spaceId));
  for(const page of [h.value.voices,h.value.files]){
    assert.equal(page.state,'ready');assert.equal(page.shared,true);assert.equal(page.items[0].content.props.messageId,null);
    assert.ok(page.items[0].content.props.api);assert.equal(page.items[0].sourceLabel,'家庭共享原附件');assert.equal(typeof page.items[0].remove,'function');
  }
  h.unmount();
  const excluded=setup({modules:[]});await settle(excluded);assert.equal(excluded.calls.length,0);excluded.unmount();
  const viewer=setup({role:'viewer'});await settle(viewer);assert.equal(viewer.value.files.items[0].remove,undefined);viewer.unmount();
});

test('unknown attachment delete checks its receipt before retrying the same operation',async()=>{
  const posts=[],gets=[];let value,scope='selected',receipt='unconfirmed',domainPending=false,rejectDeletion=false;
  const env={scopeKey:scope,apiBaseUrl:'https://example.test',childId,userId:'actor',online:true,role:'caregiver',sharedMode:true,sharing:{spaceId},
    current:()=>env.scopeKey===scope,allows:()=>true,canStartWrite:()=>!domainPending,invalidate(){},accessError(){},owner:{fetcher:async(url,init)=>{
      assert.equal(init.method,'GET');gets.push(String(url));const last=posts.at(-1);
      return Response.json(receipt==='unconfirmed'?{state:receipt}:{state:receipt,path:`/api/children/${childId}/files/${last.item.id}/delete`,statusCode:200,operation:{opId:last.opId},result:{accepted:true}});}}};
  const api={delete:async(item,opId)=>{posts.push({item,opId});if(posts.length===1||rejectDeletion)throw {status:0};return{operationId:opId,deleted:true,cleanupPending:true};}};
  const h=harness({'./useDomainEnvironment':{useDomainWriteGuard(_dirty,pending){domainPending=pending;}}});
  const {useAttachmentDeletion}=h.load('src/production/useAttachmentDeletion.tsx');
  function Host(){value=useAttachmentDeletion(env,api,'files',()=>{});return value.controls;}
  h.render(h.jsx(Host,{}));
  const button=label=>h.hosts().find(n=>n.props?.label===label);
  value.remove(attachment);h.render();button('確認刪除原附件').props.onPress();await settle(h);
  assert.equal(posts.length,1);assert.equal(button('重試原刪除'),undefined);
  button('查核原刪除').props.onPress();await settle(h);assert.equal(gets.length,1);assert.equal(posts.length,1);
  button('重試原刪除').props.onPress();await settle(h);assert.equal(posts.length,2);assert.equal(posts[1].opId,posts[0].opId);
  assert.equal(button('查核原刪除'),undefined);
  // An accepted receipt still needs the original endpoint's journal-confirmed result.
  value.remove({...attachment,id:id(4)});h.render();rejectDeletion=true;
  button('確認刪除原附件').props.onPress();await settle(h);receipt='confirmed';
  button('查核原刪除').props.onPress();await settle(h);
  assert.equal(posts.length,4);assert.equal(posts[3].opId,posts[2].opId);assert.ok(button('查核原刪除'));
  rejectDeletion=false;button('查核原刪除').props.onPress();await settle(h);
  assert.equal(posts.length,5);assert.equal(posts[4].opId,posts[2].opId);assert.equal(button('查核原刪除'),undefined);h.unmount();
});
