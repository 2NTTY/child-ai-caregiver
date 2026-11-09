import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeHeaderSelection, validateHeaderChoice, reduceHeaderChoice,
  parseHeaderRecipe, serializeHeaderRecipe, createHeaderSession,
  observeHeaderSession, commitHeaderSession, retireHeaderSession,
  captureHeaderEvent, allowsHeaderEvent, enterHeaderSelection,
  exitHeaderSelection, headerChoiceGate, restoreHeaderChoice,
} from '../src/preview/task-header-actions-hf01/selection.ts';

// Pinned fixtures are independent of production builders and validators.
const lineage = {
  "sourceFingerprints": {
    "harbour": {
      "assemblyMembersSha256": "3f1fbfbe61217f75898e88276cb06e203d19c7ecf54c4febd4018e64329cc3e1",
      "files": [
        {
          "path": "src/components/tasks/TasksView.tsx",
          "sha256": "8483cfd203691284cdaf7550e7c5adeb6418f00242a38e684d19f0b25a8e9fd4"
        },
        {
          "path": "src/screens/tasksScreen.tsx",
          "sha256": "8f363e127d12a7db13bd0d2b1e7645450d0e6f35e7a280d5f5884b5ebb297dab"
        },
        {
          "path": "src/workspaces/TasksWorkspace.tsx",
          "sha256": "35b350e164255a1beac5a965e83397a102af72b271f3307c47d463f399cb1c68"
        }
      ]
    },
    "fourth": {
      "assemblyMembersSha256": "690eedec12c76940c236b9f5317783fd835b679dd14a49d1654bd09298d0d9bc",
      "files": [
        {
          "path": "src/components/tasks/TasksView.tsx",
          "sha256": "f19ff82be6aa169991cb80cae336530704ee67f64b4d3c8db3597266d89b1fb8"
        },
        {
          "path": "src/screens/tasksScreen.tsx",
          "sha256": "c5e9edb39172c1d5283ffaf4243afbab57dc57ac9ad65f9efa7e5fe33f5ddc0f"
        },
        {
          "path": "src/workspaces/TasksWorkspace.tsx",
          "sha256": "35b350e164255a1beac5a965e83397a102af72b271f3307c47d463f399cb1c68"
        }
      ]
    }
  },
  "dependencies": [
    {
      "path": "src/components/ui.tsx",
      "sha256": "4c04a725dabf887db7430ed02c608788b21f68f79e203bb70e7aa6e61fe65daa"
    },
    {
      "path": "src/theme.ts",
      "sha256": "5fa570023e71dcbab4c5cbcbd69865dba2d38ec3defb4e21db5ac15d57f50c23"
    },
    {
      "path": "src/motion/MotionDisclosure.tsx",
      "sha256": "7cb469d3f37b2ffcb8989294c7784e43358173d5b388981fb90bed97bb563a9f"
    },
    {
      "path": "src/motion/MotionEntrance.tsx",
      "sha256": "18cec389c5af27f74c52b343a880ff36130c09d1e43ee61c3cacf93d6a69066e"
    }
  ],
  "dependenciesFingerprint": "ff4e1776d4892fdce613f5db3aa8369c06c8ca024bfa20244f33a22c85d197d6"
} as const;
const H = {slotId:'header-actions',coverage:'actions-only',variantId:'harbour',adapterVersion:'hf01-v1',sourceFingerprint:lineage.sourceFingerprints.harbour,dependenciesFingerprint:lineage.dependenciesFingerprint};
const F = {...H,variantId:'fourth',sourceFingerprint:lineage.sourceFingerprints.fourth};
const empty = () => ({current:null,undo:[],revision:0});
const gate = (s:any, patch:any={}) => ({live:true,occupied:false,expectedRevision:s.revision,actualRevision:s.revision,sourceValid:true,...patch});
const choose = (s:any,selection:any) => reduceHeaderChoice(s,{type:'choose',selection},gate(s));
const copy = (x:any) => JSON.parse(JSON.stringify(x));
const context = (patch:any={}) => ({authorityToken:'synthetic:serverA:accountA:roleA:childA',live:true,occupied:false,admissionVerified:true,access:'editable',variantId:'harbour',revision:0,...patch});
const mounted = (c=context()) => commitHeaderSession(observeHeaderSession(createHeaderSession(),c));
const selected = (c=context(), nonce=1) => {
 const s=mounted(c), result=enterHeaderSelection(s,captureHeaderEvent(s),nonce);
 assert.equal(result.outcome,'applied'); return commitHeaderSession(result.state);
};
const recipe = (state:any) => ({schemaVersion:1,namespace:'tasks-header-actions-hf01:recipe:v1',choice:state});

// A reducer that drops undo/reset history or calls a task owner fails this trace.
test('H to F to undo to prototype reset to undo retains exact presentation history',()=>{
 const a=choose(empty(),H); assert.equal(a.outcome,'applied');
 assert.deepEqual(a.state,{current:H,undo:[null],revision:1});
 const b=choose(a.state,F); assert.equal(b.outcome,'applied');
 assert.deepEqual(b.state,{current:F,undo:[null,H],revision:2});
 const c=reduceHeaderChoice(b.state,{type:'undo'},gate(b.state));
 assert.deepEqual(c.state,{current:H,undo:[null],revision:3});
 const d=reduceHeaderChoice(c.state,{type:'resetPrototype'},gate(c.state));
 assert.deepEqual(d.state,{current:null,undo:[null,H],revision:4});
 const e=reduceHeaderChoice(d.state,{type:'undo'},gate(d.state));
 assert.deepEqual(e.state,{current:H,undo:[null],revision:5});
});
test('same choice, empty undo and already-null reset are identity noops',()=>{
 const a=choose(empty(),H).state;
 for(const [s,cmd] of [[a,{type:'choose',selection:copy(H)}],[empty(),{type:'undo'}],[empty(),{type:'resetPrototype'}]]){
  const r=reduceHeaderChoice(s,cmd,gate(s)); assert.equal(r.outcome,'noop'); assert.equal(r.state,s);
 }
});
test('only newest 50 prior choices are retained and undo pops exactly once',()=>{
 let s=empty(); for(let i=0;i<61;i++) s=choose(s,i%2?F:H).state;
 assert.equal(s.revision,61); assert.equal(s.undo.length,50); assert.deepEqual(s.undo[0],H);
 const r=reduceHeaderChoice(s,{type:'undo'},gate(s));
 assert.equal(r.state.undo.length,49); assert.equal(r.state.revision,62); assert.deepEqual(r.state.current,F);
});
test('accepted selections are detached from caller mutations and frozen input is untouched',()=>{
 const input=copy(H), state=Object.freeze({current:null,undo:Object.freeze([]),revision:0});
 const r=choose(state,input); input.sourceFingerprint.files[0].sha256='0'.repeat(64);
 assert.deepEqual(r.state.current,H); assert.deepEqual(state,{current:null,undo:[],revision:0});
});
for(const patch of [{live:false},{occupied:true},{expectedRevision:1},{actualRevision:1},{sourceValid:false}]){
 test('blocked choice preserves original state '+JSON.stringify(patch),()=>{
  const s=empty(), r=reduceHeaderChoice(s,{type:'choose',selection:H},gate(s,patch));
  assert.equal(r.outcome,'blocked'); assert.equal(r.state,s);
 });
}
for(const variantId of ['original','handbook','care']){
 test('unsupported '+variantId+' cannot be selected or remapped',()=>{
  const s=empty(), r=choose(s,{...H,variantId}); assert.equal(r.outcome,'invalid'); assert.equal(r.state,s);
 });
}
test('strict command and gate shapes reject unknown fields without invoking callbacks',()=>{
 let calls=0; const cb=()=>{calls++; throw new Error('owner must never run');}; const s=empty();
 for(const cmd of [{type:'choose',selection:H,onAgent:cb},{type:'undo',extra:true},{type:'resetOriginal'},Object.defineProperty({},'type',{get:cb})]){
  const r=reduceHeaderChoice(s,cmd,gate(s)); assert.equal(r.outcome,'invalid'); assert.equal(r.state,s);
 }
 const r=reduceHeaderChoice(s,{type:'choose',selection:H},{...gate(s),onHistory:cb});
 assert.equal(r.outcome,'invalid'); assert.equal(r.state,s); assert.equal(calls,0);
});
test('every current and undo entry is checked, including holes, accessors and excess history',()=>{
 const bad=copy(F); bad.sourceFingerprint.files[2].sha256='0'.repeat(64);
 const hole=Array(1); let calls=0; const accessor=Object.defineProperty({},'current',{get(){calls++;return H;}});
 for(const s of [
  {current:bad,undo:[],revision:0},{current:H,undo:[null,bad],revision:2},
  {current:null,undo:Array(51).fill(null),revision:51},{current:null,undo:hole,revision:1},
  {...empty(),extra:true},{...accessor,undo:[],revision:0},
 ]){
  assert.equal(validateHeaderChoice(s),false); const r=reduceHeaderChoice(s,{type:'undo'},gate(s));
  assert.equal(r.outcome,'invalid'); assert.equal(r.state,s);
 }
 assert.equal(calls,0);
});
test('negative fractional unsafe revisions and mutation overflow are rejected',()=>{
 for(const revision of [-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) assert.equal(validateHeaderChoice({...empty(),revision}),false);
 const s={current:H,undo:[null],revision:Number.MAX_SAFE_INTEGER}; assert.equal(validateHeaderChoice(s),true);
 const r=reduceHeaderChoice(s,{type:'choose',selection:F},gate(s)); assert.equal(r.outcome,'invalid'); assert.equal(r.state,s);
 assert.equal(reduceHeaderChoice(s,{type:'choose',selection:H},gate(s)).outcome,'noop');
});
test('recipe round-trip stores metadata only and never transient authorization',()=>{
 const s={current:F,undo:[null,H],revision:2}; const encoded=serializeHeaderRecipe(s);
 assert.equal(encoded.status,'valid'); assert.deepEqual(JSON.parse(encoded.json),recipe(s));
 const parsed=parseHeaderRecipe(encoded.json); assert.equal(parsed.status,'valid'); assert.deepEqual(parsed.recipe,recipe(s));
 assert.equal(parseHeaderRecipe(JSON.stringify({...recipe(s),authorityToken:'forbidden'})).status,'invalid');
});
test('corrupt JSON, unknown schema, missing and extra fields are invalid',()=>{
 for(const json of ['{','null','[]',JSON.stringify({...recipe(empty()),schemaVersion:2}),JSON.stringify({...recipe(empty()),namespace:'other'}),JSON.stringify({...recipe(empty()),extra:1}),JSON.stringify({schemaVersion:1,namespace:'tasks-header-actions-hf01:recipe:v1'})]){
  assert.equal(parseHeaderRecipe(json).status,'invalid');
 }
 assert.equal(parseHeaderRecipe({}).status,'invalid');
});
test('unknown lineage in current or undo is quarantined unavailable with no H fallback',()=>{
 for(const place of ['current','undo']){
  const bad=copy(F); bad.sourceFingerprint.assemblyMembersSha256='0'.repeat(64);
  const state=place==='current'?{current:bad,undo:[],revision:0}:{current:null,undo:[bad],revision:1};
  assert.equal(parseHeaderRecipe(JSON.stringify(recipe(state))).status,'unavailable');
 }
 const bad=copy(H); bad.dependenciesFingerprint='0'.repeat(64);
 assert.equal(parseHeaderRecipe(JSON.stringify(recipe({current:bad,undo:[],revision:0}))).status,'unavailable');
});
test('64KiB is an inclusive UTF-8 byte limit, not a JS character count',()=>{
 const json=JSON.stringify(recipe(empty()));
 assert.equal(parseHeaderRecipe(json+' '.repeat(65536-Buffer.byteLength(json))).status,'valid');
 assert.equal(parseHeaderRecipe(json+' '.repeat(65537-Buffer.byteLength(json))).status,'invalid');
 assert.equal(parseHeaderRecipe(' '.repeat(32768)+'é'.repeat(16385)).status,'invalid');
});
test('factory only exposes the two pinned sources and rejects Original',()=>{
 assert.deepEqual(makeHeaderSelection('harbour'),H); assert.deepEqual(makeHeaderSelection('fourth'),F);
 assert.equal(makeHeaderSelection('original'),null);
});
test('initial, observed-uncommitted and cleaned-up event gates are fail closed',()=>{
 let s=createHeaderSession(); assert.equal(captureHeaderEvent(s),null);
 s=observeHeaderSession(s,context()); assert.equal(captureHeaderEvent(s),null);
 s=commitHeaderSession(s); const event=captureHeaderEvent(s); assert.ok(event);
 assert.equal(allowsHeaderEvent(s,event,'history'),true);
 const retired=retireHeaderSession(s); assert.equal(captureHeaderEvent(retired),null); assert.equal(allowsHeaderEvent(retired,event,'history'),false);
 const restarted=commitHeaderSession(observeHeaderSession(retired,context()));
 assert.equal(allowsHeaderEvent(restarted,event,'history'),false); assert.ok(captureHeaderEvent(restarted));
});
test('portal admission unknown refuses entry even clean but product history stays permitted',()=>{
 const s=mounted(context({admissionVerified:false})), event=captureHeaderEvent(s);
 const r=enterHeaderSelection(s,event,1); assert.equal(r.outcome,'blocked'); assert.equal(r.state,s);
 assert.equal(allowsHeaderEvent(s,event,'history'),true);
});
for(const reason of ['read-error','reading','draft','saving','unknown','conflict']){
 test('occupied '+reason+' immediately releases selection without recipe or owner changes',()=>{
  const state={current:F,undo:[null,H],revision:2}, before=copy(state);
  const s=selected(context({variantId:'fourth',revision:2})), event=captureHeaderEvent(s);
  const suspended=observeHeaderSession(s,context({variantId:'fourth',revision:2,occupied:true}));
  assert.equal(suspended.mode,'interact'); assert.equal(suspended.suspended,true);
  assert.equal(allowsHeaderEvent(suspended,event,'recipe'),false);
  const r=reduceHeaderChoice(state,{type:'choose',selection:H},headerChoiceGate(suspended,event,true));
  assert.equal(r.outcome,'blocked'); assert.equal(r.state,state); assert.deepEqual(state,before);
  const clean=commitHeaderSession(observeHeaderSession(suspended,context({variantId:'fourth',revision:2})));
  assert.equal(clean.mode,'interact'); assert.equal(clean.suspended,true);
  const current=captureHeaderEvent(clean);
  assert.equal(enterHeaderSelection(clean,current,1).outcome,'blocked');
  const admitted=enterHeaderSelection(clean,current,2); assert.equal(admitted.outcome,'applied'); assert.equal(admitted.state.mode,'select');
 });
}
test('current-scope exit ignores occupied and unknown admission; stale exit cannot affect a new session',()=>{
 const s=selected(), old=captureHeaderEvent(s);
 const changed=observeHeaderSession(s,context({occupied:true,admissionVerified:false}));
 const current={epoch:changed.epoch,authorityToken:changed.current.authorityToken,generation:changed.generation,mode:changed.mode,variantId:changed.current.variantId,revision:changed.current.revision};
 const r=exitHeaderSelection(changed,current); assert.equal(r.outcome,'noop'); assert.equal(r.state,changed);
 assert.equal(exitHeaderSelection(changed,old).outcome,'blocked');
 const active=selected(), event=captureHeaderEvent(active), result=exitHeaderSelection(active,event);
 assert.equal(result.outcome,'applied'); assert.equal(result.state.mode,'interact');
 assert.equal(result.state.current.revision,0); assert.ok(result.state.generation>active.generation);
 assert.equal(allowsHeaderEvent(commitHeaderSession(result.state),event,'recipe'),false);
});
test('scope loss withholds old scene; A to B to A never revives selection or event authority',()=>{
 const a=selected(), event=captureHeaderEvent(a);
 const lost=observeHeaderSession(a,context({live:false,access:'lost'}));
 assert.equal(lost.mode,'interact'); assert.equal(allowsHeaderEvent(lost,event,'history'),false);
 const b=commitHeaderSession(observeHeaderSession(lost,context({authorityToken:'synthetic:serverB:accountB:roleB:childA'})));
 const back=commitHeaderSession(observeHeaderSession(b,context()));
 assert.equal(back.mode,'interact'); assert.equal(back.suspended,true); assert.equal(allowsHeaderEvent(back,event,'recipe'),false);
 assert.equal(exitHeaderSelection(back,event).outcome,'blocked');
});
test('dispatch checks mode variant revision access occupied and generation every time',()=>{
 const s=mounted(), event=captureHeaderEvent(s);
 for(const patch of [{revision:1},{variantId:'fourth'},{access:'read_only'},{occupied:true},{live:false}]){
  const next=commitHeaderSession(observeHeaderSession(s,context(patch)));
  assert.equal(allowsHeaderEvent(next,event,'create'),false);
 }
 const readonly=mounted(context({access:'read_only'})), readEvent=captureHeaderEvent(readonly);
 assert.equal(allowsHeaderEvent(readonly,readEvent,'create'),false);
 assert.equal(allowsHeaderEvent(readonly,readEvent,'assistant'),false);
 assert.equal(allowsHeaderEvent(readonly,readEvent,'history'),true);
 const select=selected(), selectEvent=captureHeaderEvent(select);
 assert.equal(allowsHeaderEvent(select,selectEvent,'create'),false);
 assert.equal(allowsHeaderEvent(select,selectEvent,'recipe'),true);
 assert.equal(allowsHeaderEvent(s,event,'invented'),false);
});
test('bad admission nonces and exhausted generations cannot authorize events',()=>{
 const s=mounted(), e=captureHeaderEvent(s);
 for(const nonce of [0,-1,0.5,Infinity,Number.MAX_SAFE_INTEGER+1]) assert.equal(enterHeaderSelection(s,e,nonce).outcome,'blocked');
 const exhausted=observeHeaderSession({...s,generation:Number.MAX_SAFE_INTEGER},context({revision:1}));
 assert.equal(captureHeaderEvent(commitHeaderSession(exhausted)),null);
});
test('restore uses live revision plus one and fresh uncommitted generation, never stored authority',()=>{
 const state={current:H,undo:[null],revision:1}, s=selected(context({revision:1})), event=captureHeaderEvent(s);
 const stored=recipe({current:F,undo:[H,null],revision:900});
 const r=restoreHeaderChoice(state,stored,gate(state),s,event);
 assert.equal(r.outcome,'applied'); assert.deepEqual(r.state,{current:F,undo:[H,null],revision:2});
 assert.ok(r.session.generation>s.generation); assert.equal(r.session.current.revision,2);
 assert.equal(captureHeaderEvent(r.session),null);
 const committed=commitHeaderSession(r.session);
 assert.equal(allowsHeaderEvent(committed,event,'recipe'),false);
 assert.equal(captureHeaderEvent(committed).revision,2); assert.equal(captureHeaderEvent(committed).variantId,'fourth');
});
test('restore is blocked without explicit current selection admission and never mutates its inputs',()=>{
 const state=empty(), s=mounted(), e=captureHeaderEvent(s), stored=recipe({current:F,undo:[],revision:5});
 const r=restoreHeaderChoice(state,stored,gate(state),s,e);
 assert.equal(r.outcome,'blocked'); assert.equal(r.state,state); assert.equal(r.session,s);
 const a=selected(), event=captureHeaderEvent(a), bad=copy(stored); bad.choice.undo=[{...H,extra:1}];
 const rejected=restoreHeaderChoice(state,bad,gate(state),a,event);
 assert.equal(rejected.outcome,'invalid'); assert.equal(rejected.state,state); assert.equal(rejected.session,a);
});

test('a fresh owner lifetime cannot accept events from a different retired or recreated session',()=>{
 const original=mounted(), old=captureHeaderEvent(original);
 const recreated=mounted();
 assert.equal(allowsHeaderEvent(recreated,old,'history'),false);
 assert.equal(enterHeaderSelection(recreated,old,1).outcome,'blocked');
});
