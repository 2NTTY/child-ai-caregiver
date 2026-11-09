import test from 'node:test';
import assert from 'node:assert/strict';
import { captureHeaderSaveAuthority, canCommitHeaderSave } from '../src/preview/task-header-actions-hf01/save-authority.ts';
import { createHeaderSession, observeHeaderSession, commitHeaderSession, captureHeaderEvent,
  enterHeaderSelection, exitHeaderSelection, retireHeaderSession } from '../src/preview/task-header-actions-hf01/selection.ts';
function selected() {
  const observed = observeHeaderSession(createHeaderSession(), {
    authorityToken:'synthetic/account-A/server-A/child-A/role-A',live:true,occupied:false,
    admissionVerified:true,access:'editable',variantId:'harbour',revision:0,
  });
  const committed=commitHeaderSession(observed);
  return commitHeaderSession(enterHeaderSelection(committed,captureHeaderEvent(committed),1).state);
}
function resultingFrame() {
  const previous=selected();
  const session=observeHeaderSession(previous,{...previous.current!,variantId:'fourth',revision:1});
  const frame={session};
  return {previous,session,frame,authority:captureHeaderSaveAuthority(frame,session)};
}

test('legitimate resulting choice revision and generation can save only at its own current commit',()=>{
  const {previous,session,frame,authority}=resultingFrame();
  assert.ok(authority);
  assert.equal(canCommitHeaderSave(authority,frame,session),false,'result has not committed');
  assert.equal(canCommitHeaderSave(authority,frame,previous),false,'origin commit cannot authorize the result');
  assert.equal(canCommitHeaderSave(authority,frame,commitHeaderSession(session)),true);
});
test('explicit save without a choice change binds the new frame rather than an old equivalent frame',()=>{
  const session=selected(), frame={session}, equivalent={session};
  const authority=captureHeaderSaveAuthority(frame,session);
  assert.equal(canCommitHeaderSave(authority,equivalent,session),false);
  assert.equal(canCommitHeaderSave(authority,frame,session),true);
});
for (const [name,patch] of [
  ['scope',{authorityToken:'synthetic/account-B/server-B/child-A/role-A'}],
  ['access',{access:'read_only'}], ['lost',{access:'lost'}], ['live',{live:false}],
  ['occupied',{occupied:true}], ['admission',{admissionVerified:false}],
] as const) test(`a ${name} retirement cannot write through a newly published frame`,()=>{
  const {session,frame,authority}=resultingFrame();
  const next=observeHeaderSession(session,{...session.current!,...patch});
  assert.equal(canCommitHeaderSave(authority,{session:next},commitHeaderSession(next)),false);
  // Independent current-session guard still rejects if a caller accidentally
  // passes the old frame object alongside the new published session.
  assert.equal(canCommitHeaderSave(authority,frame,commitHeaderSession(next)),false);
});
test('clean scope A after A to B to A cannot revive the retired request',()=>{
  const {session,frame,authority}=resultingFrame();
  const b=observeHeaderSession(session,{...session.current!,authorityToken:'synthetic/B'});
  const a=observeHeaderSession(b,session.current!);
  const committed=commitHeaderSession(a);
  const reentered=commitHeaderSession(enterHeaderSelection(committed,captureHeaderEvent(committed),2).state);
  assert.equal(canCommitHeaderSave(authority,{session:reentered},reentered),false);
  assert.equal(canCommitHeaderSave(authority,frame,reentered),false);
});
test('occupied then clean and explicitly reentered requires a new request',()=>{
  const {session,authority}=resultingFrame();
  const blocked=observeHeaderSession(session,{...session.current!,occupied:true});
  const clean=commitHeaderSession(observeHeaderSession(blocked,session.current!));
  const reentered=commitHeaderSession(enterHeaderSelection(clean,captureHeaderEvent(clean),2).state);
  const frame={session:reentered};
  assert.equal(canCommitHeaderSave(authority,frame,reentered),false);
  assert.equal(canCommitHeaderSave(captureHeaderSaveAuthority(frame,reentered),frame,reentered),true);
});
test('safe exit retires a queued selection write even if the frame argument is mistakenly retained',()=>{
  const {session,frame,authority}=resultingFrame();
  const committed=commitHeaderSession(session);
  const exited=commitHeaderSession(exitHeaderSelection(committed,captureHeaderEvent(committed)).state);
  assert.equal(canCommitHeaderSave(authority,frame,exited),false);
});
test('cleanup and restart or fresh equal lifetime never authorize the old request',()=>{
  const {session,frame,authority}=resultingFrame();
  const retired=retireHeaderSession(session);
  assert.equal(canCommitHeaderSave(authority,frame,retired),false);
  const restarted=commitHeaderSession(observeHeaderSession(retired,session.current!));
  assert.equal(canCommitHeaderSave(authority,{session:restarted},restarted),false);
  const fresh=resultingFrame();
  assert.equal(canCommitHeaderSave(authority,frame,commitHeaderSession(fresh.session)),false);
});
test('a configuration or frame replacement revokes equal numeric session stamps',()=>{
  const {session,authority}=resultingFrame();
  assert.equal(canCommitHeaderSave(authority,{session},commitHeaderSession(session)),false);
});
test('absent authority, absent commit and unusable sessions fail closed',()=>{
  const empty=createHeaderSession(), frame={session:empty};
  assert.equal(captureHeaderSaveAuthority(frame,empty),null);
  assert.equal(canCommitHeaderSave(null,frame,null),false);
  const current=resultingFrame();
  assert.equal(canCommitHeaderSave(current.authority,current.frame,null),false);
});
