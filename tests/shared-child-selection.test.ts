import assert from 'node:assert/strict';
import test from 'node:test';
import { SharedChildController, sharedChildScopeKey } from '../src/client/shared-child-controller.ts';
import type { SharedChildView } from '../src/shared/sharing-control.ts';

const childId='00000000-0000-4000-8000-000000000001';
const first='00000000-0000-4000-8000-000000000002';
const second='00000000-0000-4000-8000-000000000003';
const view=(spaceId=first):SharedChildView=>({spaceId,spaceName:'Family',childId,childName:'Child',role:'caregiver',modules:['tasks'],
  basis:{spaceVersion:1,membershipVersion:1,shareVersion:1,actorAuthorizationVersion:'1',sourceAuthorizationVersion:'1'}});

test('shared selection separates spaces and rejects stale identity, grant and read results',async()=>{
  let value=view(), reject=false, release:((value:SharedChildView)=>void)|undefined, hold=false;
  const controller=new SharedChildController({child:async(space)=>{
    if(hold) return new Promise<SharedChildView>(resolve=>{release=resolve;});
    if(reject) throw Object.assign(new Error('revoked'),{status:403});
    return {...value,spaceId:space};
  }});
  controller.syncContext('session-a','user-a',true);
  await controller.select(first,childId);
  const initial=sharedChildScopeKey(controller.getSnapshot());
  assert.ok(initial);assert.equal(controller.getSnapshot().view?.childId,childId);
  await controller.select(second,childId);
  assert.notEqual(sharedChildScopeKey(controller.getSnapshot()),initial);
  value={...value,basis:{...value.basis,shareVersion:2}};
  const before=sharedChildScopeKey(controller.getSnapshot());await controller.refresh();
  assert.notEqual(sharedChildScopeKey(controller.getSnapshot()),before);
  reject=true;await controller.refresh();
  assert.equal(controller.getSnapshot().view,null);assert.equal(sharedChildScopeKey(controller.getSnapshot()),null);
  assert.equal(controller.getSnapshot().target?.spaceId,second,'revocation must not select a private child');
  reject=false;hold=true;const pending=controller.select(first,childId);
  assert.equal(sharedChildScopeKey(controller.getSnapshot()),null);
  controller.syncContext('session-b','user-b',true);release!(view());await pending;
  assert.equal(controller.getSnapshot().target,null);assert.equal(controller.getSnapshot().view,null);
  controller.dispose();
});
