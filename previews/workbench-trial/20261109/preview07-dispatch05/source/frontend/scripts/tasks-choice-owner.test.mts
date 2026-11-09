import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { TaskCandidatePresentationProvider } from '../src/preview/tasks-choice-host/TaskCandidatePresentation.ts';
import { createCandidateReceipt, readCandidateReceipt, prepareCandidatePublication, commitCandidatePublication } from '../src/preview/tasks-choice-host/candidate-receipt.ts';
import { createTaskRecipeDraft, makeTaskRecipeSelection, reduceTaskRecipeDraft, serializeTaskRecipe } from '../src/preview/tasks-choice-host/recipe.ts';
import { createHeaderSession, observeHeaderSession, commitHeaderSession, captureHeaderEvent } from '../src/preview/task-header-actions-hf01/selection.ts';

const identity=JSON.stringify(['https://synthetic.invalid','user-A',1]);
const scope=(server='https://synthetic.invalid',user='user-A',generation=1,child='child-A',role='owner')=>JSON.stringify([server,user,generation,child,role]);
const A=scope(), B=scope(undefined,undefined,undefined,'child-B');
const props=(scopeKey,children=null)=>({scopeKey,children});
const derive=(previous,scopeKey)=>TaskCandidatePresentationProvider.getDerivedStateFromProps(props(scopeKey),previous)??previous;
function observe(receipt,draft) {
  return observeHeaderSession(createHeaderSession(),{authorityToken:receipt.scopeKey,live:true,occupied:false,
    access:'editable',admissionVerified:false,variantId:'harbour',revision:draft.revision});
}
function selected(receipt) {
  const draft=createTaskRecipeDraft(),session=commitHeaderSession(observe(receipt,draft));
  const result=reduceTaskRecipeDraft(draft,{type:'choose',selection:makeTaskRecipeSelection('date-list','row-appearance','fourth')},session,captureHeaderEvent(session));
  assert.equal(result.outcome,'updated');return result.state;
}
function publication(receipt,metadata,expected=receipt.current) {
  const frame={},session=observe(receipt,metadata.draft);
  const request=prepareCandidatePublication(receipt,expected,metadata,frame,session);assert.ok(request);
  return {request,frame,session:commitHeaderSession(session)};
}
function commit(receipt,metadata) {
  const p=publication(receipt,metadata);
  const saved=commitCandidatePublication(p.request,receipt,p.frame,p.session);assert.ok(saved);return saved;
}
function seed(receipt) {
  const draft=selected(receipt),serialized=serializeTaskRecipe(draft);assert.equal(serialized.status,'valid');
  return commit(receipt,{draft,importText:'{"schemaVersion":999}',exportText:serialized.json});
}
const source=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

// This is a source topology contract, not a React or browser Forward test.
// Reintroducing allocation in RoutePresentation or moving the provider under
// ProductionProjection must fail it even while pure receipt tests stay green.
test('only the stable host owns the candidate provider; replaceable route presentation reads that same receipt',()=>{
  const production=source('src/production/ProductionProvider.tsx');
  const host=production.split('export function ProductionOwnerHost(')[1]?.split('/** Static rendering')[0];
  assert.ok(host);assert.match(host,/<TaskCandidatePresentationProvider scopeKey=\{snapshot\.scopeKey\s*\?\?\s*snapshot\.identityKey\}>/);
  assert.match(host,/:children\}<\/TaskCandidatePresentationProvider><\/ProductionOwnerContext>/);
  assert.doesNotMatch(production.split('function ProductionProjection(')[1],/<TaskCandidatePresentationProvider/);
  const route=source('src/navigation/RoutePresentation.tsx');
  assert.doesNotMatch(route,/createCandidateReceipt|TaskCandidateContext|TaskCandidatePresentationProvider/);
  assert.match(route,/const taskCandidate\s*=\s*useTaskCandidatePresentation\(\)/);
  assert.match(route,/tasksLifetimeQA\.mount\('presentation'[\s\S]*?receipt:taskCandidate/);
  assert.match(route,/const value = useMemo\(\(\) => new Map/);
  assert.match(route,/const memory = useMemo\(\(\) => createMemoryPresentation/);
  assert.match(route,/const taskFocus = useMemo\(\(\) => createTaskFocusReturn/);
  assert.match(source('src/entry/Application.tsx'),/wrapper: ProductionOwnerHost/);
});

// These call the real pure derived-state method. They do not pretend to mount
// React, run StrictMode, suspend a render, or navigate a browser.
test('same committed scope preserves receipt and payload across consumer replacements without memo or navigation keys',()=>{
  const marker='unchanged child',provider=new TaskCandidatePresentationProvider(props(A,marker));
  const initial=provider.state,receipt=initial.receipt,saved=seed(receipt);
  for(const replacement of ['detail consumer','closed consumer','historical consumer','new Expo root consumer']) {
    assert.equal(derive(initial,A),initial,replacement);
    assert.equal(initial.receipt,receipt);assert.equal(receipt.current,saved);
  }
  const rendered=provider.render();assert.equal(rendered.props.value,receipt);
  assert.equal(rendered.props.children,marker);assert.equal(rendered.key,null,'no navigation remount key');
  assert.equal(typeof provider.componentWillUnmount,'undefined','no cleanup erases metadata');
  assert.equal(saved.draft.current['date-list'].variantId,'fourth');
  assert.equal(saved.importText,'{"schemaVersion":999}');
});

test('null to identity to full scope allocates distinct empty receipts and never reads a previous scope',()=>{
  let state=new TaskCandidatePresentationProvider(props(null)).state;
  const receipts=[state.receipt];
  for(const next of [identity,A,null,A]) {
    const previous=state;state=derive(state,next);
    assert.notEqual(state.receipt,previous.receipt);assert.equal(state.receipt.scopeKey,next);
    assert.equal(state.receipt.current,null);assert.equal(readCandidateReceipt(previous.receipt,next??''),null);
    receipts.push(state.receipt);
  }
  assert.equal(new Set(receipts).size,receipts.length);
});

test('every production authority dimension and a committed A to B to A transition creates a fresh receipt',()=>{
  const initial=new TaskCandidatePresentationProvider(props(A)).state, saved=seed(initial.receipt);
  const variants=[scope('https://other.invalid'),scope(undefined,'user-B'),scope(undefined,undefined,2),B,
    scope(undefined,undefined,undefined,undefined,'reader'),identity,null];
  for(const next of variants) {
    const away=derive(initial,next),returned=derive(away,A);
    assert.notEqual(away.receipt,initial.receipt);assert.notEqual(returned.receipt,initial.receipt);
    assert.equal(away.receipt.current,null);assert.equal(returned.receipt.current,null);
    assert.equal(readCandidateReceipt(away.receipt,A),null);
  }
  assert.equal(initial.receipt.current,saved,'retirement does not actively erase old metadata');
});

test('discarded alternate-scope allocation and preparation do not mutate the committed state or claim its receipt',()=>{
  const committed=new TaskCandidatePresentationProvider(props(A)).state,saved=seed(committed.receipt);
  const alternate=derive(committed,B),draft=createTaskRecipeDraft();
  publication(alternate.receipt,{draft,importText:'uncommitted B',exportText:''});
  assert.equal(alternate.receipt.current,null);
  assert.equal(committed.receipt.current,saved);assert.equal(derive(committed,A),committed);
  const sameScopePrepared=publication(committed.receipt,{...saved,importText:'abandoned A'});
  assert.ok(sameScopePrepared.request);assert.equal(committed.receipt.current,saved);
  assert.notEqual(derive(committed,B).receipt,alternate.receipt,'discarded allocations are not cached by token');
});

test('a still-held old control request cannot publish into B or fresh A; a new committed mount rejects old same-scope publications',()=>{
  const initial=new TaskCandidatePresentationProvider(props(A)).state,saved=seed(initial.receipt);
  const late=publication(initial.receipt,{...saved,importText:'late old control'});
  const b=derive(initial,B),freshA=derive(b,A);
  for(const current of [b.receipt,freshA.receipt]) {
    assert.equal(commitCandidatePublication(late.request,current,late.frame,late.session),null);
    assert.equal(current.current,null);
  }
  // Before React updates the old Control it may still write its old object.
  // That is not zero writes, but neither current-scope receipt is affected.
  assert.ok(commitCandidatePublication(late.request,initial.receipt,late.frame,late.session));
  assert.equal(b.receipt.current,null);assert.equal(freshA.receipt.current,null);
  const newSaved=seed(freshA.receipt),oldMount=publication(freshA.receipt,{...newSaved,importText:'old frame'});
  const newest=commit(freshA.receipt,newSaved);
  assert.equal(commitCandidatePublication(oldMount.request,freshA.receipt,oldMount.frame,oldMount.session),null);
  assert.equal(freshA.receipt.current,newest);
});

test('candidate control retains committed frame, mount, scope and receipt guards with renderer admission disabled',()=>{
  const control=source('src/preview/tasks-choice-host/TasksChoiceHostControl.tsx');
  assert.match(control,/const RUNTIME_ADMISSION_VERIFIED = false/);
  assert.match(control,/this\.mounted&&this\.committedFrame===frame&&this\.state\.frame===frame/);
  assert.match(control,/frame\.presentation===presentationFor\(this\.props\)&&this\.ownsPresentation\(frame\)/);
  assert.match(control,/sameScope\(frame\.scope,scopeFor\(this\.props,this\.state\.draft,this\.state\.applied\)\)/);
  assert.match(control,/this\.mounted=false;this\.restart=true/);
  assert.match(control,/this\.committedFrame=null;this\.committedSession=null/);
});
