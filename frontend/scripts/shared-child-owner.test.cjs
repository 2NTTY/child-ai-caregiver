const assert=require('node:assert/strict');
const test=require('node:test');
const {load,settle}=require('./child-delete-owner-harness.cjs');
const {ProductionOwner}=load('frontend/src/production/ProductionOwner.ts');
const {projectProductionHome}=load('frontend/src/production/home-projection.ts');
const {sharedRouteMessage,sharedRefreshSelections}=load('frontend/src/production/shared-route-access.ts');
const {selectHomeOverview}=load('frontend/src/home-overview.ts');
const id='00000000-0000-4000-8000-000000000001',space='00000000-0000-4000-8000-000000000002';

test('formal owner selects shared child without private fallback, clears revoked scope and returns to personal selection',async()=>{
  const user={id:'test-parent',name:'Parent',email:'test@example.invalid'};
  const child={id,workspaceId:'private-space',displayName:'Same child privately',createdAt:'2026-10-27T00:00:00Z',accessRole:'owner'};
  const view={spaceId:space,spaceName:'Selected family',childId:id,childName:'Shared child',role:'viewer',modules:['tasks'],
    basis:{spaceVersion:1,membershipVersion:1,shareVersion:1,actorAuthorizationVersion:'1',sourceAuthorizationVersion:'1'}};
  const reads=[],requests=[];let revoked=false,accountFailure=false;
  const reject=async()=>{throw new Error('No writes or model calls in this test');};
  const api={getSession:async()=>user,authenticate:reject,signOut:reject,listChildren:async()=>[child],listRecords:async()=>({records:[],limit:100}),createChild:reject,createRecord:reject,deleteChild:reject};
  const chat={getSession:async()=>user,listMessages:async childId=>{reads.push(childId);return{messages:[],limit:100};},getStatus:async()=>true,
    getUsage:async()=>({day:'2026-10-27',attempts:0,inputTokens:0,outputTokens:0,cachedTokens:0,unknownUsageAttempts:0}),saveMessage:reject,requestReply:reject};
  const account={canVerifyDeletionIdentity:()=>false,clearDeletionVerification(){},setIdentity(){},deletionRecovery:()=>null,
    status:async()=>{if(accountFailure)throw new Error('Transient account read failure');return{enabled:false,registration:'trial',mailConfigured:false,policyVersion:'synthetic',notice:'Synthetic only',user:null};}};
  const fetcher=async(input,init)=>{
    const url=new URL(input,'http://local.invalid');requests.push(url.pathname+url.search);
    assert.equal(new Headers(init?.headers).get('x-expected-user-id'),user.id);
    if(url.pathname===`/api/shared-spaces/${space}/children/${id}`)return Response.json(revoked?{error:{code:'access_denied'}}:view,{status:revoked?403:200});
    throw new Error('Unexpected request: '+url.pathname);
  };
  const owner=new ProductionOwner('/api',true,api,chat,{read:()=>null,write(){},clear(){}},{api:account},{platform:'web',fetcher});
  try{
    await owner.controller.restoreSession();await settle();
    const privateScope=owner.getSnapshot().scopeKey,privateReads=reads.length;
    owner.queryClient.setQueryData(['production',privateScope,'private'],{private:true});
    await owner.selectSharedChild(space,id);
    const shared=owner.getSnapshot();assert.ok(shared.scopeKey);assert.notEqual(shared.scopeKey,privateScope);
    assert.equal(shared.activeChild.accessRole,'viewer');assert.equal(shared.records.children[0].accessRole,'owner');
    assert.equal(shared.chat.selectedChildId,null);assert.equal(owner.chatWritesAllowed(),false);
    assert.equal(await owner.voiceOwner.prepare({id:'unsent',fileName:'voice.m4a',mimeType:'audio/mp4',bytes:4}),null);
    assert.equal(owner.queryClient.getQueryData(['production',privateScope,'private']),undefined);
    const home=projectProductionHome(shared);
    assert.notEqual(home.selectedChildId,id);assert.equal(home.children.length,2);assert.equal(home.records.length,0);
    assert.equal(selectHomeOverview(home),home.overview,'shared overview belongs to the same presentation selection');
    const shellState={...shared.sharedChild,view:{...view,modules:['profile','care','tasks','concerns']}};
    assert.deepEqual(sharedRefreshSelections(shellState,'/care',{},true).map(item=>item.module),['profile','care','tasks','concerns']);
    assert.deepEqual(sharedRefreshSelections(shellState,'/care',{},false).map(item=>item.module),['profile','care']);
    assert.equal(sharedRouteMessage(shared.sharedChild,'/tasks'),null);
    assert.match(sharedRouteMessage(shared.sharedChild,'/care'),/沒有共享/);
    assert.match(sharedRouteMessage(shared.sharedChild,'/chat'),/尚未接通/);
    await owner.refresh();assert.equal(reads.length,privateReads,'shared refresh must not fetch the private conversation');
    accountFailure=true;await owner.refresh();
    assert.equal(owner.getSnapshot().scopeKey,null);
    assert.equal(owner.getSnapshot().sharedChild.target?.spaceId,space,'account read failure retains the selected shared target');
    assert.equal(owner.getSnapshot().sharedChild.view,null);
    accountFailure=false;await owner.refresh();
    assert.equal(owner.getSnapshot().sharedChild.view?.spaceId,space);
    assert.equal(reads.length,privateReads,'account recovery must not silently select the private child');
    revoked=true;await owner.refresh();
    assert.equal(owner.getSnapshot().scopeKey,null);assert.equal(owner.getSnapshot().activeChild,null);
    assert.equal(owner.getSnapshot().sharedChild.target.spaceId,space,'retain failed target rather than exposing private same-ID data');
    await owner.selectPersonalChild(id);assert.equal(owner.getSnapshot().scopeKey,privateScope);
    assert.equal(owner.getSnapshot().sharedChild.target,null);assert.equal(owner.chatWritesAllowed(),true);
    assert.ok(requests.length>=3);
  }finally{owner.dispose();}
});
