import { Suspense, createContext, startTransition, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { TasksChoiceSceneObserver } from '../tasks-choice-host/scene-barrier';
import { useProductionOwner } from '../../production/ProductionProvider';
import { getAcceptanceTrace, type WitnessRow } from './trace';
import { callbackBalance, createDeferredPool, createPrerequisiteWatch, registerCommittedCallbacks, releaseCallbackWitness,
  type CallbackRegistration, type DeferredGate, type RequestLabel } from './callback-witness';
export const MountedRequestContext=createContext<RequestLabel|null>(null);
export function CallbackCommitWitness(props:CallbackRegistration) {
  useLayoutEffect(()=>registerCommittedCallbacks(props),[props.control,props.token,props.frame,props.request,props.scene,props.apply,props.exit,props.isCurrent]);
  return null;
}
type Attempt={label:RequestLabel;gate:DeferredGate|null};
type Supervisor={attempt:Attempt;arm:(opener:HTMLElement|null,scene:TasksChoiceSceneObserver|null)=>string;routeLease:()=>()=>void};
const SupervisorContext=createContext<Supervisor|null>(null);
function Gate({gate,kind}:{gate:DeferredGate|null;kind:string}) {
  if(gate?.status==='pending') {
    const trace=getAcceptanceTrace();trace.witness('suspender-throw',{...gate.label,boundary:kind,promise:trace.identity(gate.promise)});
    throw gate.promise;
  }
  return null;
}
function WholeFallback({reveal,gate}:{reveal:()=>void;gate:DeferredGate|null}) {
  useLayoutEffect(()=>{
    const trace=getAcceptanceTrace(),roots=document.querySelectorAll<HTMLElement>('[data-tasks-choice-scene-root]');
    const root=roots.length===1?roots[0]:null,cleanup=gate?trace.latest('scene-cleanup-begin',{requestId:gate.label.requestId}):null;
    const hidden=!!root&&getComputedStyle(root).display==='none';
    trace.witness('whole-fallback-commit',{caseId:gate?.label.caseId??null,requestId:gate?.label.requestId??null,
      container:trace.identity(root),hidden,cleanupSequence:cleanup?.sequence??null,
      timing:hidden&&cleanup?.container===trace.identity(root)&&cleanup?.latchAnimation===false&&cleanup?.latchFocus===true?'incomplete-at-cleanup':'INCONCLUSIVE'});
  },[gate]);
  return <div role="status" data-testid="tasks-qa-scene-fallback">
    場景已暫停。這會中斷實際動畫，不表示原動畫連續完成。
    <button type="button" onClick={reveal}>恢復整個場景</button>
  </div>;
}
/** Module-scope boundary; never recreates the component type or changes a key. */
export function TasksAttemptBoundary({renderPage}:{renderPage:()=>ReactNode}) {
  const supervisor=useContext(SupervisorContext);
  useLayoutEffect(()=>supervisor?.routeLease(),[supervisor?.routeLease]);
  return <MountedRequestContext.Provider value={supervisor?.attempt.label??null}>
    <Suspense fallback={<div role="status">候選轉場待完成，使用上方驗收控制取消或解決。</div>}>
      {renderPage()}<Gate gate={supervisor?.attempt.gate??null} kind="attempt"/>
    </Suspense>
  </MountedRequestContext.Provider>;
}
export function useMountedLifecycleWitness() { return useContext(SupervisorContext); }
/** Lives below MotionProvider but outside the genuine scene layout-effect disconnect. */
export function MountedLifecycleWitness({children}:{children:ReactNode}) {
  const owner=useProductionOwner(),trace=getAcceptanceTrace();
  const [caseId,setCaseId]=useState(()=>trace.beginCase());
  const counter=useRef(1),live=useRef(true),generation=useRef(0),routeCount=useRef(0);
  const [pool]=useState(createDeferredPool);
  const [attempt,setAttempt]=useState<Attempt>(()=>({label:{caseId,requestId:counter.current,kind:'A'},gate:null}));
  const requested=useRef<DeferredGate|null>(null),cancelled=useRef<DeferredGate|null>(null);
  const [hideGate,setHideGate]=useState<DeferredGate|null>(null);
  const hidden=useRef<DeferredGate|null>(null);
  const watch=useRef<ReturnType<typeof createPrerequisiteWatch<WitnessRow>>|null>(null);
  const observerBalance=useRef({attached:0,detached:0,active:0});
  const [output,setOutput]=useState(''),[message,setMessage]=useState('先在待辦工具保留回調或預先武裝抽屜。所有 mounted 結果仍需實際觀測。');
  const [routeLease]=useState(()=>()=>{
    routeCount.current++;trace.witness('attempt-route-attach',{routes:routeCount.current});let ended=false;
    return ()=>{if(ended)return;ended=true;routeCount.current--;trace.witness('attempt-route-detach',{routes:routeCount.current});};
  });
  const disableWatch=()=>{generation.current++;watch.current?.stop();};
  function reveal() {
    disableWatch();const gate=hidden.current;hidden.current=null;setHideGate(null);
    if(gate)pool.resolve(gate);trace.witness('whole-reveal-request',{caseId});
    setMessage('恢復要求已送出。Control 會執行真實 restart；未知 overlay 不會被工具清除。');
  }
  function arm(opener:HTMLElement|null,scene:TasksChoiceSceneObserver|null) {
    disableWatch();
    if(!opener?.isConnected||!scene||routeCount.current!==1||hidden.current)return 'INCONCLUSIVE：沒有單一可用待辦／抽屜開啟按鈕。';
    const stamp=generation.current,currentCase=caseId,openerId=trace.identity(opener),coordinator=trace.identity(scene);
    const armed=trace.witness('prerequisite-armed',{caseId,generation:stamp,opener:openerId,coordinator});
    let observer:MutationObserver|null=null;
    const read=():WitnessRow|null=>{
      if(!live.current||generation.current!==stamp||trace.caseStatus().caseId!==currentCase||!trace.caseStatus().valid
        ||!opener.isConnected||document.activeElement!==opener)return null;
      const close=trace.latest('fixture-drawer-close-request',{coordinator,opener:openerId});
      if(!armed||!close||close.sequence<=armed.sequence)return null;
      const button=document.querySelector('[data-testid="tasks-qa-close-drawer"]');
      const drawer=button?.closest('[data-motion-kind="drawer-right"]');
      if(!drawer?.isConnected||drawer.getAttribute('data-motion-phase')!=='exiting'||trace.identity(drawer)!==close.drawer)return null;
      // Require an unambiguous closing latch whose real focus signal names this opener.
      const rows=trace.read(null,null,null).rows;
      const latches=new Map<number,WitnessRow>();
      for(const row of rows)if(row.rowType==='witness'&&row.event==='drawer-latch'&&typeof row.latch==='number')latches.set(row.latch,row);
      const candidates=[...latches.values()].filter(row=>row.sequence>close.sequence&&row.focusedNode===openerId&&row.focus===true&&row.animation===false);
      if(candidates.length!==1)return null;
      const latch=candidates[0],capture=trace.latest('overlay-capture',{coordinator,confirm:latch.confirm});
      if(!capture||capture.visible!==false||capture.unfinished!==true||capture.sequence<=close.sequence)return null;
      return {...latch,coordinator,opener:openerId,drawer:trace.identity(drawer),hook:capture.hook,physical:capture.physical,
        caseId:currentCase,generation:stamp};
    };
    // Preserve the captured native function and its Window receiver when called through the queue port.
    const next=createPrerequisiteWatch({queue:queueMicrotask.bind(globalThis),read,limit:64,
      disconnect:()=>{if(observer){observer.disconnect();observer=null;observerBalance.current.detached++;observerBalance.current.active--;}trace.witness('prerequisite-detached',{caseId:currentCase,generation:stamp,...observerBalance.current,...next.balance()});},
      request:facts=>{
        if(!live.current||generation.current!==stamp)return;
        const gate=pool.create({caseId:currentCase,requestId:++counter.current,kind:'hide'});if(!gate)return;
        trace.witness('whole-hide-request',{...gate.label,coordinator:facts.coordinator,latch:facts.latch,confirm:facts.confirm,
          opener:facts.opener,drawer:facts.drawer,hook:facts.hook,physical:facts.physical,generation:stamp});
        generation.current++;hidden.current=gate;setHideGate(gate);
        setMessage('已要求暫停；必須核對實際 scene-cleanup-begin 的 latch 時序，錯過視窗即 INCONCLUSIVE。');
      }});
    watch.current=next;
    observer=new MutationObserver(()=>next.schedule());
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-motion-phase','style','aria-hidden']});
    observerBalance.current.attached++;observerBalance.current.active++;
    trace.witness('prerequisite-observer-attached',{caseId:currentCase,generation:stamp,...observerBalance.current});
    next.schedule();return '已武裝。現在開啟抽屜，再使用抽屜內原有關閉按鈕。';
  }
  function startAttempt() {
    if(routeCount.current!==1||requested.current||cancelled.current||hidden.current){setMessage('INCONCLUSIVE：先完成目前案例，並保持單一待辦路由。');return;}
    const gate=pool.create({caseId,requestId:++counter.current,kind:'B'});if(!gate)return;
    requested.current=gate;startTransition(()=>setAttempt({label:gate.label,gate}));
    setMessage('B 轉場已要求。必須先讀到真實 Control render-token，再見同一 B 的 suspender-throw；pending 本身不是證據。');
  }
  function cancelAttempt() {
    const gate=requested.current;if(!gate||gate.status!=='pending')return;
    pool.cancel(gate);cancelled.current=gate;requested.current=null;
    const label:RequestLabel={caseId,requestId:++counter.current,kind:'C'};
    trace.witness('attempt-cancel-request',label);setAttempt({label,gate:null});
    setMessage('已要求 C。C 可合法重發相同 metadata；B 不得有歸屬於自己的 commit/publication。');
  }
  function resolveAttempt(cancelledOnly:boolean) {
    const gate=cancelledOnly?cancelled.current:requested.current;if(!gate)return;
    pool.resolve(gate);if(cancelledOnly)cancelled.current=null;
    setMessage(cancelledOnly?'只解決已撤銷 B 的 promise，不將 B 寫回。':'正控制：B 的 promise 已解決，檢查實際 commit/publication。');
  }
  function reset() {
    disableWatch();releaseCallbackWitness();
    // Clear fixture requests before settling their old promises; no product operation is called.
    requested.current=null;cancelled.current=null;hidden.current=null;setHideGate(null);
    const next=trace.beginCase();setCaseId(next);setAttempt({label:{caseId:next,requestId:++counter.current,kind:'A'},gate:null});pool.clear();
    setMessage('已結束前案並開始新案；歷史、UUID、序號與 dropped 保留。產品 guard／未知 ticket 不變。');
  }
  useLayoutEffect(()=>{
    live.current=true;trace.witness('supervisor-setup',{owner:trace.identity(owner)});
    return ()=>{live.current=false;generation.current++;watch.current?.stop();watch.current=null;releaseCallbackWitness();
      requested.current=null;cancelled.current=null;hidden.current=null;pool.dispose();
      trace.witness('supervisor-cleanup',{owner:trace.identity(owner),...callbackBalance(),gates:pool.balance().active});};
  },[owner,pool,trace]);
  return <SupervisorContext.Provider value={{attempt,arm,routeLease}}>
    <div style={{display:'flex',flexDirection:'column',flex:1,minHeight:0}}>
      <details data-testid="tasks-qa-mounted-supervisor"><summary>Mounted lifecycle 合成驗收</summary>
        <button type="button" onClick={startAttempt}>開始未完成轉場 B</button>
        <button type="button" onClick={cancelAttempt}>撤銷轉場，要求 C</button>
        <button type="button" onClick={()=>resolveAttempt(true)}>解決已撤銷 B</button>
        <button type="button" onClick={()=>resolveAttempt(false)}>直接解決 B（正控制）</button>
        <button type="button" onClick={reset}>讀取後結束並重設案例</button>
        <button type="button" onClick={()=>setOutput(JSON.stringify({callbacks:callbackBalance(),gates:pool.balance(),prerequisiteObservers:{...observerBalance.current},watch:watch.current?.balance()??null,...trace.read(null,owner,null)},null,2))}>讀取 mounted 觀測</button>
        <p>{message}</p><pre style={{maxHeight:160,overflow:'auto'}}>{output}</pre>
      </details>
      <Suspense fallback={<WholeFallback reveal={reveal} gate={hideGate}/>}>
        {children}<Gate gate={hideGate} kind="whole-scene"/>
      </Suspense>
    </div>
  </SupervisorContext.Provider>;
}
