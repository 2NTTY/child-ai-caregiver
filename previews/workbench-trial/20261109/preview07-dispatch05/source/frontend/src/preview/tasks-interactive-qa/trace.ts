import { readSyntheticSceneAcceptance } from '../tasks-choice-host/scene-admission';
import type { TasksChoiceSceneObserver } from '../tasks-choice-host/scene-barrier';
type Source = { subscribe(listener: () => void): () => void; getSnapshot?(): object };
type Guard = Source & { read(): { revision: number; state: string } };
export type FocusSample = { tag: string; id: string; label: string | null; testID: string | null };
type Primitive = string | number | boolean | null;
export type WitnessFields = Readonly<Record<string, Primitive>>;
export type WitnessRow = Record<string, Primitive> & { sequence: number; event: string; rowType: 'witness' };
/** Fixed safe sampler: an early producer cannot lock the singleton to a null closure. */
function focusSample(): FocusSample | null {
  if (typeof document === 'undefined' || typeof HTMLElement === 'undefined') return null;
  const node = document.activeElement;
  return node instanceof HTMLElement ? { tag:node.tagName, id:node.id.slice(0,96),
    label:node.getAttribute('aria-label')?.slice(0,96) ?? null, testID:node.getAttribute('data-testid')?.slice(0,96) ?? null } : null;
}
export function createAcceptanceTrace(focus: () => FocusSample | null = focusSample) {
  const capacity = 240, ids = new WeakMap<object, number>();
  let failures = 0, traceSession: string | null = null;
  try { traceSession = crypto.randomUUID(); } catch { failures++; }
  const observers = { attached:0, detached:0, active:0, cleanupFailures:0 };
  let sequence = 0, identity = 0, dropped = 0, caseId = 0, caseStart = 1, caseLost = 0, caseFailures = failures;
  function id(value: object | null | undefined) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return null;
    let n = ids.get(value); if (n === undefined) { n = ++identity; ids.set(value, n); } return n;
  }
  function sample(event: string, scene: TasksChoiceSceneObserver | null, owner: Source | null, guard: Guard | null) {
    const s = scene?.read(), g = guard?.read();
    return { sequence: ++sequence, event: event.slice(0,96), rowType:'sample' as const, caseId, coordinator: id(scene), owner: id(owner),
      ownerSnapshot:id(owner?.getSnapshot?.()), bindingInstance:id(s?.binding?.instance), bindingOwner:id(s?.binding?.ownerIdentity),
      routeInstance:id(s?.binding?.routeInstance), workspaceIdentity:id(s?.binding?.workspaceIdentity),
      bindingCoordinator:id(s?.bindingStamp?.coordinatorInstance), stampBindingInstance:id(s?.bindingStamp?.bindingInstance),
      controlsHost:id(s?.controlsHost), sceneGeneration:id(s?.ticket?.generation), authorityGeneration:id(s?.authority?.generation),
      revision: s?.revision ?? null, phase: s?.phase ?? null, retired: s?.retired ?? null,
      refusal: s?.refusal ?? 'CONTEXT_MISSING', ticket: id(s?.ticket), frame: id(s?.authority?.frame),
      guardRevision: g?.revision ?? null, guardState: g?.state ?? 'missing',
      overlayCount: s?.overlays.length ?? 0, overlaysTruncated: (s?.overlays.length ?? 0) > 24,
      overlays: s?.overlays.slice(0,24).map(o => ({ ticket:id(o.ticket), instance:id(o.ticket.instance), generation:id(o.ticket.generation), phase:o.phase })) ?? [], focus:focus() };
  }
  const rows: (ReturnType<typeof sample> | WitnessRow)[] = [];
  function append(row: typeof rows[number]) {
    if (rows.length === capacity) { const evicted=rows.shift()!; dropped++; if(evicted.sequence>=caseStart)caseLost++; }
    rows.push(row);
  }
  function witness(event: string, fields: WitnessFields = {}): WitnessRow | null {
    try {
      if(Object.keys(fields).length>32)throw Error('WITNESS_FIELD_CAP');
      const values:Record<string,Primitive>={};
      for(const [key,value] of Object.entries(fields)) {
        if(key.length>64 || ['sequence','event','rowType'].includes(key))throw Error('WITNESS_KEY');
        if(value!==null && !['string','number','boolean'].includes(typeof value))throw Error('WITNESS_NOT_INERT');
        if(typeof value==='number'&&!Number.isFinite(value))throw Error('WITNESS_NUMBER');
        values[key]=typeof value==='string'?value.slice(0,160):value;
      }
      const row:WitnessRow={...values,sequence:++sequence,event:event.slice(0,96),rowType:'witness'};
      append(row);return {...row};
    } catch { failures++;return null; }
  }
  function latest(event: string, match: WitnessFields = {}): WitnessRow | null {
    for(let i=rows.length-1;i>=0;i--) {
      const row=rows[i];
      if(row.rowType==='witness'&&row.event===event&&Object.entries(match).every(([key,value])=>row[key]===value))return {...row};
    }
    return null;
  }
  return {
    identity:id, witness, latest,
    invalidate() { failures++; },
    beginCase() {
      witness('case-ended',{caseId,caseLost});caseId++;caseStart=sequence+1;caseLost=0;caseFailures=failures;
      witness('case-started',{caseId});return caseId;
    },
    caseStatus() { return {caseId,startSequence:caseStart,lost:caseLost,failures:failures-caseFailures,valid:traceSession!==null&&caseLost===0&&failures===caseFailures}; },
    observerAttached() {
      observers.attached++; observers.active++;let ended=false;
      return (count: number) => { if(ended)return;ended=true;observers.detached++;observers.active--;observers.cleanupFailures+=count; };
    },
    record(event: string, scene: TasksChoiceSceneObserver | null, owner: Source | null, guard: Guard | null) {
      try { const row=sample(event,scene,owner,guard);if(row.overlaysTruncated)failures++;append(row); } catch { failures++; }
    },
    read(scene: TasksChoiceSceneObserver | null, owner: Source | null, guard: Guard | null) {
      let current:ReturnType<typeof sample>|null=null;
      try { current=sample('explicit-read',scene,owner,guard);if(current.overlaysTruncated)failures++; } catch { failures++; }
      let syntheticQA = { ...readSyntheticSceneAcceptance(null), sceneGateAllowed:false,
        sceneGateMeaning:'legacy-releaseAllowed-is-synthetic-scene-gate-not-release-verification' };
      try {
        const snapshot = scene?.read();
        const productRoot = snapshot?.controlsHost?.parentElement?.querySelector<HTMLElement>('[data-tasks-choice-product-root]') ?? null;
        syntheticQA = { ...readSyntheticSceneAcceptance(productRoot), sceneGateAllowed:snapshot?.releaseAllowed===true,
          sceneGateMeaning:'legacy-releaseAllowed-is-synthetic-scene-gate-not-release-verification' };
      } catch { failures++; }
      return { schemaVersion:4, traceSession, observers:{...observers}, evidence:'observation-only', runtimeAdmission:false,
        releaseAdmission:false, runtimeAdmissionMeaning:'legacy-release-verification-not-synthetic-grant', syntheticQA,
        capacity,dropped,failures,valid:traceSession!==null&&dropped===0&&failures===0,
        case:{caseId,startSequence:caseStart,lost:caseLost,failures:failures-caseFailures,valid:traceSession!==null&&caseLost===0&&failures===caseFailures},
        current, rows:JSON.parse(JSON.stringify(rows)) as typeof rows };
    },
  };
}
export type AcceptanceTrace = ReturnType<typeof createAcceptanceTrace>;
let retainedTrace: AcceptanceTrace | null = null;
export function getAcceptanceTrace(): AcceptanceTrace {
  if (!retainedTrace) retainedTrace = createAcceptanceTrace();
  return retainedTrace;
}
/** Passive only. No callbacks/listeners/state scheduling from producers. */
export function recordDrawerLatch(latch: object, confirm: () => void, animation: boolean, focus: boolean, confirmed: boolean) {
  const trace=getAcceptanceTrace();
  trace.witness('drawer-latch',{latch:trace.identity(latch),confirm:trace.identity(confirm),animation,focus,confirmed,
    focusedNode:trace.identity(typeof document==='undefined'?null:document.activeElement)});
}
export function recordSceneLifecycle(event: string, scene: TasksChoiceSceneObserver | null, container: object, product: object, controls: object) {
  const trace=getAcceptanceTrace(),coordinator=trace.identity(scene),candidate=trace.latest('whole-hide-request',{coordinator});
  const reveal=trace.latest('whole-reveal-request');
  const request=candidate&&candidate.caseId===trace.caseStatus().caseId&&(!reveal||reveal.sequence<candidate.sequence)?candidate:null;
  const latch=request?trace.latest('drawer-latch',{latch:request.latch}):null;
  trace.witness(event,{coordinator,container:trace.identity(container),product:trace.identity(product),controls:trace.identity(controls),
    caseId:request?.caseId??null,requestId:request?.requestId??null,latch:request?.latch??null,
    latchAnimation:latch?.animation??null,latchFocus:latch?.focus??null,
    timing:request?(latch?.animation===false&&latch?.focus===true?'animation-incomplete':'INCONCLUSIVE'):'not-armed'});
}
export function observeAcceptanceSources(trace: AcceptanceTrace, ports: {
  scene: TasksChoiceSceneObserver | null; owner: Source; guard: Guard | null;
  listenFocus(listener: () => void): () => void;
}) {
  let active = true;
  let sources:typeof ports|null=ports;
  const finish = trace.observerAttached();
  const stops: (() => void)[] = [];
  const record = (event: string) => { if(active&&sources) trace.record(event,sources.scene,sources.owner,sources.guard); };
  record('observation-attach');
  try {
    if(sources.scene) stops.push(sources.scene.subscribe(()=>record('scene-publication')));
    stops.push(sources.owner.subscribe(()=>record('owner-publication')));
    if(sources.guard) stops.push(sources.guard.subscribe(()=>record('guard-publication')));
    stops.push(sources.listenFocus(()=>record('focusin')));
  } catch { trace.invalidate();record('observation-connect-failed'); }
  return () => {
    if(!active)return;active=false;const ending=sources;sources=null;let failures=0;
    for(const stop of stops.splice(0)) { try { stop(); } catch { failures++;trace.invalidate();trace.record('observation-cleanup-failed',ending?.scene??null,ending?.owner??null,ending?.guard??null); } }
    finish(failures);trace.record('observation-detach',ending?.scene??null,ending?.owner??null,ending?.guard??null);
  };
}
