import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTaskRecipeDraft, makeTaskRecipeSelection, reduceTaskRecipeDraft,
  validateTaskRecipeDraft, serializeTaskRecipe, parseTaskRecipe, restoreTaskRecipeDraft,
  projectTaskRecipe, TASK_RECIPE_NAMESPACE,
} from '../src/preview/tasks-choice-host/recipe.ts';
import {
  captureHeaderEvent, commitHeaderSession, createHeaderSession, observeHeaderSession,
  retireHeaderSession, enterHeaderSelection,
} from '../src/preview/task-header-actions-hf01/selection.ts';
import { captureHeaderSaveAuthority, canCommitHeaderSave } from '../src/preview/task-header-actions-hf01/save-authority.ts';

// New orchestration tests use the unchanged real HF lifetime helpers, not a fake owner.
function session(revision = 0, changes = {}) {
  return commitHeaderSession(observeHeaderSession(createHeaderSession(), {
    authorityToken:'synthetic-child:editable', live:true, occupied:false,
    access:'editable', admissionVerified:false, variantId:'harbour', revision, ...changes,
  }));
}
function choose(state, slotId, candidateId, variantId) {
  const s = session(state.revision);
  return reduceTaskRecipeDraft(state, {type:'choose', selection:makeTaskRecipeSelection(slotId,candidateId,variantId)}, s, captureHeaderEvent(s));
}
function selected() {
  const result = choose(createTaskRecipeDraft(),'header-actions','header-actions','fourth');
  assert.equal(result.outcome,'updated'); return result.state;
}

test('candidate edits are pending and never claim preview application', () => {
  const result = choose(createTaskRecipeDraft(),'header-actions','header-actions','fourth');
  assert.equal(result.outcome,'updated');
  assert.equal(result.state.current['header-actions'].variantId,'fourth');
  assert.equal(result.state.current['header-actions'].coverage,'actions-only');
  assert.equal(result.state.current.filters,null);
  assert.equal(result.state.current['calendar-layout'],null);
  const s = session(result.state.revision);
  assert.deepEqual(projectTaskRecipe(result.state,s,captureHeaderEvent(s)),{status:'pending',reason:'runtime-admission-required'});
});

test('four slots stay separate and row appearance does not become whole date-list', () => {
  const result = choose(selected(),'date-list','row-appearance','fourth');
  assert.equal(result.outcome,'updated');
  assert.equal(result.state.current['header-actions'].variantId,'fourth');
  assert.equal(result.state.current['date-list'].coverage,'row-appearance');
  assert.equal(result.state.current['date-list'].hostVariantId,'harbour');
  assert.equal(makeTaskRecipeSelection('filters','row-appearance','fourth'),null);
  assert.equal(makeTaskRecipeSelection('date-list','whole-slot','fourth'),null);
  assert.equal(makeTaskRecipeSelection('header-actions','header-actions','original'),null);
});

test('undo and reset restore complete snapshots without a product-state payload', () => {
  const first = selected();
  const second = choose(first,'date-list','row-appearance','fourth').state;
  let s = session(second.revision);
  const undone = reduceTaskRecipeDraft(second,{type:'undo'},s,captureHeaderEvent(s));
  assert.equal(undone.outcome,'updated');
  assert.deepEqual(undone.state.current,first.current);
  assert.equal(undone.state.revision,3);
  s = session(undone.state.revision);
  const reset = reduceTaskRecipeDraft(undone.state,{type:'resetPrototype'},s,captureHeaderEvent(s));
  assert.deepEqual(reset.state.current,{'header-actions':null,filters:null,'date-list':null,'calendar-layout':null});
  s = session(reset.state.revision);
  assert.deepEqual(reduceTaskRecipeDraft(reset.state,{type:'undo'},s,captureHeaderEvent(s)).state.current,first.current);
});

test('same selection and empty undo do not consume revision or history', () => {
  const empty = createTaskRecipeDraft(), s = session();
  const unchanged = reduceTaskRecipeDraft(empty,{type:'undo'},s,captureHeaderEvent(s));
  assert.equal(unchanged.outcome,'noop'); assert.equal(unchanged.state,empty);
  const state = selected(), repeated = choose(state,'header-actions','header-actions','fourth');
  assert.equal(repeated.outcome,'noop'); assert.equal(repeated.state,state);
});

test('late, uncommitted, retired, occupied, lost and wrong-revision draft events cannot edit', () => {
  const state = createTaskRecipeDraft(), command = {type:'choose',selection:makeTaskRecipeSelection('header-actions','header-actions','fourth')};
  const original = session(), oldEvent = captureHeaderEvent(original);
  const uncommitted = observeHeaderSession(original,{...original.current,revision:1});
  const away = observeHeaderSession(original,{...original.current,authorityToken:'other'});
  const returned = commitHeaderSession(observeHeaderSession(away,{...original.current}));
  for (const [s,event] of [
    [uncommitted,oldEvent], [returned,oldEvent], [retireHeaderSession(original),oldEvent],
    [session(0,{occupied:true}),null], [session(0,{access:'lost'}),null],
    [session(0,{live:false}),null], [session(1),null],
  ]) {
    const result=reduceTaskRecipeDraft(state,command,s,event ?? captureHeaderEvent(s));
    assert.equal(result.outcome,'blocked'); assert.equal(result.state,state);
  }
});

test('serialization includes only pinned candidate metadata, never runtime authority or product data', () => {
  const state=choose(selected(),'date-list','row-appearance','fourth').state;
  const encoded=serializeTaskRecipe(state);
  assert.equal(encoded.status,'valid');
  const value=JSON.parse(encoded.json);
  assert.deepEqual(Object.keys(value).sort(),['draft','namespace','schemaVersion']);
  assert.equal(value.namespace,TASK_RECIPE_NAMESPACE);
  assert.equal(value.draft.current['date-list'].variantId,'fourth');
  assert.equal(parseTaskRecipe(encoded.json).status,'valid');
  for (const field of ['authorityToken','epoch','generation','child','taskId','route','draftText','operation','runtimeAdmission']) {
    assert.equal(Object.hasOwn(value.draft,field),false);
    assert.equal(parseTaskRecipe(JSON.stringify({...value,[field]:'unexpected'})).status,'invalid');
  }
});

test('invalid or unavailable recipe lineage is rejected, never silently mapped to a baseline', () => {
  const serialized=serializeTaskRecipe(selected()); assert.equal(serialized.status,'valid');
  const original=JSON.parse(serialized.json);
  for (const change of [
    value => value.draft.current['header-actions'].sourceFingerprint.assemblyMembersSha256='0'.repeat(64),
    value => value.draft.current['header-actions'].dependenciesFingerprint='0'.repeat(64),
    value => value.draft.current['header-actions'].variantId='care',
    value => value.draft.current['header-actions'].coverage='whole-slot',
    value => value.draft.undo.push({'header-actions':null,filters:{variantId:'fourth'},'date-list':null,'calendar-layout':null}),
  ]) {
    const value=structuredClone(original);change(value);assert.notEqual(parseTaskRecipe(JSON.stringify(value)).status,'valid');
  }
  assert.equal(parseTaskRecipe(' '.repeat(65537)).status,'invalid');
  assert.equal(parseTaskRecipe('{').status,'invalid');
  const accessor={...selected()};Object.defineProperty(accessor,'revision',{get(){throw new Error('must not evaluate getter');},enumerable:true});
  assert.equal(validateTaskRecipeDraft(accessor),false);
});

test('explicit restore uses a fresh live revision and cannot import persisted event authority', () => {
  const source=choose(selected(),'date-list','row-appearance','fourth').state;
  const serialized=serializeTaskRecipe(source);assert.equal(serialized.status,'valid');
  const parsed=parseTaskRecipe(serialized.json);assert.equal(parsed.status,'valid');
  const local=createTaskRecipeDraft(), s=session(0), event=captureHeaderEvent(s);
  const result=restoreTaskRecipeDraft(local,parsed.recipe,s,event);
  assert.equal(result.outcome,'updated');assert.equal(result.state.revision,1);
  assert.deepEqual(result.state.current,source.current);
  const next=commitHeaderSession(observeHeaderSession(s,{...s.current,revision:result.state.revision}));
  assert.equal(reduceTaskRecipeDraft(result.state,{type:'resetPrototype'},next,event).outcome,'blocked');
});

test('bounded undo and revision exhaustion fail safely', () => {
  let state=createTaskRecipeDraft();
  for(let i=0;i<55;i++) state=choose(state,'header-actions','header-actions',i%2?'harbour':'fourth').state;
  assert.equal(state.undo.length,50);assert.equal(state.revision,55);
  const exhausted={...state,revision:Number.MAX_SAFE_INTEGER},s=session(Number.MAX_SAFE_INTEGER);
  const result=reduceTaskRecipeDraft(exhausted,{type:'resetPrototype'},s,captureHeaderEvent(s));
  assert.equal(result.outcome,'invalid');assert.equal(result.state,exhausted);
});

test('real preview and save projection retain the unchanged HF admission/commit gate', () => {
  const state=selected();
  let s=session(state.revision,{admissionVerified:true});
  const before=projectTaskRecipe(state,s,captureHeaderEvent(s));
  assert.equal(before.status,'pending');
  const entered=enterHeaderSelection(s,captureHeaderEvent(s),1);assert.equal(entered.outcome,'applied');
  const frame={};const authority=captureHeaderSaveAuthority(frame,entered.state);
  assert.equal(canCommitHeaderSave(authority,frame,entered.state),false);
  s=commitHeaderSession(entered.state);
  const projection=projectTaskRecipe(state,s,captureHeaderEvent(s));
  assert.equal(projection.status,'eligible');
  assert.equal(projection.headerVariant,'fourth');assert.equal(projection.rowAppearance,undefined);
  assert.equal(canCommitHeaderSave(authority,frame,s),true);
  assert.equal(canCommitHeaderSave(authority,{},s),false);
  assert.equal(canCommitHeaderSave(authority,frame,retireHeaderSession(s)),false);
});

test('untrusted undo arrays reject sparse keys and accessors without evaluating them', () => {
  const state=createTaskRecipeDraft();
  const sparse=new Array(1);sparse.extra=state.current;
  assert.equal(validateTaskRecipeDraft({...state,undo:sparse}),false);
  let reads=0;const accessor=[state.current];
  Object.defineProperty(accessor,0,{get(){reads++;return state.current;},enumerable:true});
  assert.equal(validateTaskRecipeDraft({...state,undo:accessor}),false);
  assert.equal(reads,0);
});

test('multi-slot history stays bounded without blocking further candidate edits', () => {
  let state=createTaskRecipeDraft();
  for(let i=0;i<120;i++) {
    const slot=i%2?'date-list':'header-actions', candidate=i%2?'row-appearance':'header-actions';
    const result=choose(state,slot,candidate,Math.floor(i/2)%2?'harbour':'fourth');
    assert.equal(result.outcome,'updated');state=result.state;
  }
  const serialized=serializeTaskRecipe(state);assert.equal(serialized.status,'valid');
  assert.ok(Buffer.byteLength(serialized.json)<=65536);assert.ok(state.undo.length>0&&state.undo.length<=50);
});
