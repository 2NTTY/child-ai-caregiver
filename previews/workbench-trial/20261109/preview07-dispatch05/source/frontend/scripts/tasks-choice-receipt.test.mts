import assert from 'node:assert/strict';
import test from 'node:test';
import { createCandidateReceipt, readCandidateReceipt, prepareCandidatePublication, commitCandidatePublication } from '../src/preview/tasks-choice-host/candidate-receipt.ts';
import { createTaskRecipeDraft, makeTaskRecipeSelection, reduceTaskRecipeDraft, serializeTaskRecipe, restoreTaskRecipeDraft, parseTaskRecipe } from '../src/preview/tasks-choice-host/recipe.ts';
import { createHeaderSession, observeHeaderSession, commitHeaderSession, captureHeaderEvent, retireHeaderSession } from '../src/preview/task-header-actions-hf01/selection.ts';

const SCOPE='synthetic:user:child-A:owner';
function observe(draft, previous=createHeaderSession(), changes={}) {
  return observeHeaderSession(previous,{authorityToken:SCOPE,live:true,occupied:false,access:'editable',admissionVerified:false,variantId:'harbour',revision:draft.revision,...changes});
}
function empty() { return {draft:createTaskRecipeDraft(),importText:'',exportText:''}; }
function choose(draft, slot='date-list', candidate='row-appearance') {
  const session=commitHeaderSession(observe(draft));
  const result=reduceTaskRecipeDraft(draft,{type:'choose',selection:makeTaskRecipeSelection(slot,candidate,'fourth')},session,captureHeaderEvent(session));
  assert.equal(result.outcome,'updated');return result.state;
}
function publish(receipt, expected, metadata, changes={}) {
  const frame={}, session=observe(metadata.draft,createHeaderSession(),changes);
  const request=prepareCandidatePublication(receipt,expected,metadata,frame,session);
  assert.ok(request,'valid metadata must prepare without writing');
  const value=commitCandidatePublication(request,receipt,frame,commitHeaderSession(session));
  assert.ok(value,'current committed mount must publish');
  return {frame,session:commitHeaderSession(session),request,value};
}

// Pure receipt/consumer test: deliberately reuses one receipt. Actual ancestor
// lifetime and browser Forward require the separate owner and browser regressions.
test('leaf consumers sharing one receipt retain the latest candidate and text, never historical copies',()=>{
  const receipt=createCandidateReceipt(SCOPE);
  let draft=choose(createTaskRecipeDraft());
  const serialized=serializeTaskRecipe(draft);assert.equal(serialized.status,'valid');
  const recipe=parseTaskRecipe(serialized.json);assert.equal(recipe.status,'valid');
  const restoreSession=commitHeaderSession(observe(draft));
  const restored=restoreTaskRecipeDraft(draft,recipe.recipe,restoreSession,captureHeaderEvent(restoreSession));
  assert.equal(restored.outcome,'updated');draft=restored.state;
  let committed=publish(receipt,null,{draft,importText:'{"schemaVersion":999}',exportText:serializeTaskRecipe(draft).json});
  for(const navigation of ['PUSH detail','REPLACE close','Back','Forward']) {
    const before=receipt.current;
    const read=readCandidateReceipt(receipt,SCOPE);
    assert.ok(read,navigation);assert.equal(read.draft.current['date-list'].variantId,'fourth',navigation);
    assert.equal(read.draft.undo.length,1,navigation);assert.equal(read.importText,'{"schemaVersion":999}',navigation);
    assert.equal(read.exportText,serializeTaskRecipe(read.draft).json,navigation);
    assert.equal(receipt.current,before,'render/read does not claim the receipt');
    // The actual lifecycle consumer constructs a new HF epoch on each route mount.
    committed=publish(receipt,read,read);
    assert.notEqual(committed.value,before,'committed mount rotates metadata identity');
  }
  const s=commitHeaderSession(observe(committed.value.draft));
  const undo=reduceTaskRecipeDraft(committed.value.draft,{type:'undo'},s,captureHeaderEvent(s));
  assert.equal(undo.outcome,'updated');assert.equal(undo.state.current['date-list'],null);
  publish(receipt,committed.value,{draft:undo.state,importText:committed.value.importText,exportText:''});
  assert.equal(readCandidateReceipt(receipt,SCOPE).draft.current['date-list'],null,'next Back sees latest undo, not a route-entry snapshot');
});

// Catches a render-side write, missing commit gate, or saved mutable runtime capability.
test('preparation is read-only and publication requires a real committed frame with detached metadata only',()=>{
  const receipt=createCandidateReceipt(SCOPE), metadata={...empty(),draft:choose(createTaskRecipeDraft())};
  const frame={}, session=observe(metadata.draft);
  const request=prepareCandidatePublication(receipt,null,metadata,frame,session);assert.ok(request);
  assert.equal(receipt.current,null);
  assert.equal(commitCandidatePublication(request,receipt,frame,session),null,'observed is not committed');
  const saved=commitCandidatePublication(request,receipt,frame,commitHeaderSession(session));assert.ok(saved);
  assert.deepEqual(Object.keys(saved).sort(),['draft','exportText','importText']);
  assert.equal(Object.hasOwn(saved,'applied'),false);assert.equal(Object.hasOwn(saved,'session'),false);
  assert.notEqual(saved,metadata);assert.notEqual(saved.draft,metadata.draft);
  metadata.draft.current['date-list'].variantId='harbour';
  assert.equal(saved.draft.current['date-list'].variantId,'fourth');
  assert.equal(Object.isFrozen(saved),true);assert.equal(Object.isFrozen(saved.draft.current['date-list'].sourceFingerprint.files),true);
  assert.deepEqual(JSON.parse(JSON.stringify(saved)),saved,'receipt contains JSON metadata only');
});

// Catches late old-mount writes even when the new mount has not edited any values.
test('a new committed mount invalidates old mount publications and late events',()=>{
  const receipt=createCandidateReceipt(SCOPE), first=publish(receipt,null,empty());
  const oldFrame={}, oldSession=observe(choose(first.value.draft),first.session);
  const oldRequest=prepareCandidatePublication(receipt,first.value,{draft:choose(first.value.draft),importText:'old',exportText:''},oldFrame,oldSession);
  assert.ok(oldRequest);
  const newRead=readCandidateReceipt(receipt,SCOPE);
  const current=publish(receipt,newRead,newRead);
  assert.equal(commitCandidatePublication(oldRequest,receipt,oldFrame,commitHeaderSession(oldSession)),null);
  const late=prepareCandidatePublication(receipt,first.value,{...first.value,importText:'late'},first.frame,first.session);
  assert.equal(commitCandidatePublication(late,receipt,first.frame,first.session),null);
  assert.equal(receipt.current,current.value);assert.equal(receipt.current.importText,'');
});

// Catches reusing only draft revision as text-write authority, or replaying a request.
test('older frames and duplicate commits cannot overwrite newer same-revision text',()=>{
  const receipt=createCandidateReceipt(SCOPE), initial=publish(receipt,null,empty());
  const frameA={},frameB={},session=initial.session;
  const a=prepareCandidatePublication(receipt,initial.value,{...initial.value,importText:'earlier'},frameA,session);
  const b=prepareCandidatePublication(receipt,initial.value,{...initial.value,importText:'latest'},frameB,session);
  assert.ok(a);assert.ok(b);
  assert.equal(commitCandidatePublication(a,receipt,frameB,session),null,'wrong current frame');
  const newest=commitCandidatePublication(b,receipt,frameB,session);assert.ok(newest);
  assert.equal(commitCandidatePublication(a,receipt,frameA,session),null,'stale expected snapshot');
  assert.equal(commitCandidatePublication(b,receipt,frameB,session),null,'one-shot CAS');
  assert.equal(receipt.current.importText,'latest');
});

// Catches a shared map keyed by scope token resurrecting a retired child/authority instance.
test('scope A to B to A creates fresh receipts and rejects previous-instance requests',()=>{
  const a=createCandidateReceipt(SCOPE), saved=publish(a,null,{...empty(),draft:choose(createTaskRecipeDraft())});
  const oldFrame={},oldRequest=prepareCandidatePublication(a,saved.value,saved.value,oldFrame,saved.session);assert.ok(oldRequest);
  const b=createCandidateReceipt('synthetic:user:child-B:owner'), nextA=createCandidateReceipt(SCOPE);
  assert.equal(readCandidateReceipt(b,SCOPE),null);assert.equal(readCandidateReceipt(nextA,SCOPE),null);
  assert.equal(readCandidateReceipt(a,'synthetic:user:child-A:reader'),null);
  assert.equal(commitCandidatePublication(oldRequest,b,oldFrame,saved.session),null);
  assert.equal(commitCandidatePublication(oldRequest,nextA,oldFrame,saved.session),null);
  assert.equal(nextA.current,null);assert.equal(b.current,null);
  assert.equal(readCandidateReceipt(null,SCOPE),null);
  assert.equal(prepareCandidatePublication(null,null,empty(),{},observe(createTaskRecipeDraft())),null);
});

// Catches weakening dirty/saving/unknown/lost gates to make retention work.
test('occupied, not-live, lost and retired HF sessions cannot publish or erase the existing draft',()=>{
  const receipt=createCandidateReceipt(SCOPE), saved=publish(receipt,null,{...empty(),draft:choose(createTaskRecipeDraft())});
  for(const changes of [{occupied:true},{live:false},{access:'lost'},{authorityToken:'other'}]) {
    const frame={},session=observe(saved.value.draft,saved.session,changes);
    const request=prepareCandidatePublication(receipt,saved.value,{...saved.value,importText:'blocked'},frame,session);
    assert.equal(commitCandidatePublication(request,receipt,frame,commitHeaderSession(session)),null);
    assert.equal(receipt.current,saved.value);
  }
  assert.equal(commitCandidatePublication(saved.request,receipt,saved.frame,retireHeaderSession(saved.session)),null);
  const clean=publish(receipt,saved.value,{...saved.value,importText:'clean again'});
  assert.equal(clean.value.draft.current['date-list'].variantId,'fourth');
});

// Catches unchecked payloads, excessive text or getters in the presentation receipt.
test('receipt accepts only bounded exact candidate metadata, not product state or capability fields',()=>{
  const receipt=createCandidateReceipt(SCOPE), frame={},session=observe(createTaskRecipeDraft());
  let getterReads=0;
  const accessor={...empty()};Object.defineProperty(accessor,'importText',{get(){getterReads++;return 'bad';},enumerable:true});
  for(const metadata of [
    {...empty(),applied:{}},{...empty(),session},{...empty(),importText:'x'.repeat(65537)},
    {...empty(),exportText:'x'.repeat(65537)},{...empty(),exportText:'not a recipe'},
    {...empty(),draft:{...createTaskRecipeDraft(),child:'private'}},accessor,
  ]) assert.equal(prepareCandidatePublication(receipt,null,metadata,frame,session),null);
  assert.equal(getterReads,0);assert.equal(receipt.current,null);
  const text='x'.repeat(65536);
  assert.ok(prepareCandidatePublication(receipt,null,{...empty(),importText:text},frame,session));
});

// Catches treating metadata's serialized revision as authority or accepting a different epoch.
test('publication matches receipt, frame, revision and HF epoch without granting renderer admission',()=>{
  const receipt=createCandidateReceipt(SCOPE),metadata={...empty(),draft:choose(createTaskRecipeDraft())},frame={};
  const session=observe(metadata.draft),request=prepareCandidatePublication(receipt,null,metadata,frame,session);assert.ok(request);
  const wrongRevision=commitHeaderSession(observe(createTaskRecipeDraft()));
  assert.equal(commitCandidatePublication(request,receipt,frame,wrongRevision),null);
  const otherEpoch=commitHeaderSession(observe(metadata.draft));
  assert.equal(commitCandidatePublication(request,receipt,frame,otherEpoch),null);
  assert.equal(prepareCandidatePublication(receipt,null,metadata,frame,observe(createTaskRecipeDraft())),null);
  const committed=commitHeaderSession(session),saved=commitCandidatePublication(request,receipt,frame,committed);assert.ok(saved);
  assert.equal(committed.current.admissionVerified,false);assert.equal(committed.mode,'interact');
});
