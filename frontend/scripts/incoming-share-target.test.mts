import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionShareTarget } from '../src/production/incoming-share-target.ts';

test('system input uses the production draft and refuses busy, changed or shared targets', () => {
  let snapshot:any={identityKey:'identity-1',scopeKey:'child-1',sharedChild:{target:null},records:{user:{id:'user-1'}},activeChild:{id:'child-1'}};
  let chat:any={userId:'user-1',selectedChildId:'child-1',busy:false,drafts:{'child-1':{text:'Keep this',phase:'draft'}}};
  let draft:any={scope:'child-1',attachments:[]};
  const upload={getSnapshot:()=>({localId:null})};
  const owner:any={getSnapshot:()=>snapshot,chatWritesAllowed:()=>true,chatController:{getSnapshot:()=>chat,setText:(text:string)=>{chat.drafts['child-1'].text=text;}},
    draftOwner:{getSnapshot:()=>draft,add:(scope:string,item:unknown)=>{assert.equal(scope,'child-1');draft.attachments.push(item);return true;}},voiceOwner:upload,fileOwner:upload,photoOwner:upload};
  const target=createProductionShareTarget(owner)!;assert.ok(target);
  assert.equal(target.appendText('https://example.invalid'),true);
  assert.equal(chat.drafts['child-1'].text,'Keep this\n\nhttps://example.invalid');
  const attachment:any={id:'file'};assert.equal(target.appendAttachment(attachment),true);
  assert.equal(target.appendAttachment({id:'other'} as any),false);assert.deepEqual(draft.attachments,[attachment]);
  assert.equal(target.appendText('x'.repeat(10_001)),false);
  chat.busy=true;assert.equal(createProductionShareTarget(owner),null);chat.busy=false;
  snapshot={...snapshot,scopeKey:'child-2'};assert.equal(target.current(),false);assert.equal(target.appendText('late'),false);
  snapshot={...snapshot,scopeKey:'child-1',sharedChild:{target:{spaceId:'shared'}}};assert.equal(createProductionShareTarget(owner),null);
});
