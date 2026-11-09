/** Long-lived synthetic preview boundary. Not the short acceptance prelude. */
import {incrementCounter, createBoundedLog} from './synthetic-preview-observation.mjs';
const OWNER_PROFILES = Object.freeze({care: Object.freeze({id: 'care-native-photo-owner-v1', photoOwner: true}), handbook: Object.freeze({id: 'handbook-native-photo-owner-v1', photoOwner: true}), fourth: Object.freeze({id: 'fourth-native-photo-owner-v1', photoOwner: true}), harbour: Object.freeze({id: 'harbour-native-photo-owner-v1', photoOwner: true})});
const VARIANTS = new Set(Object.keys(OWNER_PROFILES));
const CASES = new Set(['normal', 'hold-profile', 'hold-tasks', 'hold-account']);
const C = 'c0b00000-0000-4000-8000-000000000001';
const ORIGIN = 'https://normal-bootstrap.invalid';
const HOLD_PATH = {'hold-profile': `/api/children/${C}/profile`, 'hold-tasks': `/api/children/${C}/tasks`, 'hold-account': '/api/account'};
const fail = code => { throw new Error(`SYNTHETIC_PREVIEW_${code}`); };
function method(object, key) {
  for (let at = object; at; at = Object.getPrototypeOf(at)) {
    const d = Object.getOwnPropertyDescriptor(at, key);
    if (d) { if (!Object.hasOwn(d, 'value') || typeof d.value !== 'function') fail('METHOD_DESCRIPTOR'); return d.value; }
  }
  fail('METHOD_MISSING');
}
function jsonData(value) {
  const seen = new Set();
  function copy(v) {
    if (v === null || ['string', 'boolean'].includes(typeof v)) return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v !== 'object' || seen.has(v)) fail('DIAGNOSTIC_DATA');
    const array = Array.isArray(v), proto = Object.getPrototypeOf(v);
    if (!array && proto !== Object.prototype && proto !== null) fail('DIAGNOSTIC_DATA');
    const keys = Reflect.ownKeys(v), out = array ? [] : Object.create(null); seen.add(v);
    if (array && (keys.length !== v.length + 1 || keys.some(k => k !== 'length' && (typeof k !== 'string' || !/^(0|[1-9][0-9]*)$/.test(k) || Number(k) >= v.length)))) fail('DIAGNOSTIC_DATA');
    for (const key of keys) {
      if (typeof key !== 'string') fail('DIAGNOSTIC_DATA');
      if (array && key === 'length') continue;
      const d = Object.getOwnPropertyDescriptor(v, key); if (!Object.hasOwn(d, 'value')) fail('DIAGNOSTIC_DATA');
      Object.defineProperty(out, key, {value: copy(d.value), enumerable: true, configurable: true, writable: true});
    }
    seen.delete(v); return out;
  }
  const text = JSON.stringify(copy(value)); if (text.length > 65_536) fail('DIAGNOSTIC_LIMIT'); return JSON.parse(text);
}
export function createSyntheticPreviewRuntime(realm, options) {
  if (!options || typeof options !== 'object' || ![Object.prototype,null].includes(Object.getPrototypeOf(options)) || Reflect.ownKeys(options).length !== 2 || Reflect.ownKeys(options).some(k => !['variant','case'].includes(k))) fail('CONTROL_CONFIG');
  const variantDescriptor = Object.getOwnPropertyDescriptor(options,'variant'), caseDescriptor = Object.getOwnPropertyDescriptor(options,'case');
  if (!variantDescriptor || !caseDescriptor || !Object.hasOwn(variantDescriptor,'value') || !Object.hasOwn(caseDescriptor,'value') || !VARIANTS.has(variantDescriptor.value) || !CASES.has(caseDescriptor.value)) fail('CONTROL_CONFIG');
  options = Object.freeze({variant:variantDescriptor.value,case:caseDescriptor.value});
  const profile = OWNER_PROFILES[options.variant];
  let phase = 'uninstalled', root = null, rootCount = 0, owner = null, binding = null, ownerDisposes = 0;
  let unmountReturned = false, unmountCalls = 0, probeEffects = 0, beforeDispose = null, bindingDisposed = false;
  let ui = null, uiText = null, currentProbe = null, requests = 0, sequence = 0, mountedUI = false;
  let shutdownPromise = null, shutdownError = null, acceptance = 'not-evaluated';
  let shutdownOwner = null;
  let disposalAttempted = false, disposalFailed = false, disposalError = null;
  const cleanup = {attempts: 0, error: null, before: null, forcedTimers: 0, forcedHolds: 0, remainingPending: 0};
  const timerCounts = {scheduled: 0, fired: 0, clearCalls: 0, clearedActive: 0};
  let clockNow = null;
  const saturated = {saturated: false};
  const timerLog = createBoundedLog(128, 8192), eventLog = createBoundedLog(128, 8192);
  const bodyObservers = new WeakSet(), originalClears = new Map();
  const settlement = {turns: 0, quietTurns: 0, elapsedMs: 0, stopReason: 'not-started', before: null, after: null};
  const listeners = [];
  const failures = [], patches = [], pending = new Set(), holds = new Map(), activeTimers = new Map();
  const defaultNetwork = {fetch: 0, xhr: 0, websocket: 0, eventsource: 0, beacon: 0, serviceWorker: 0};
  const fatal = code => { if (!failures.includes(code) && failures.length < 32) failures.push(code); if (shutdownPromise) acceptance = 'failed'; if (bindingDisposed) phase = 'failed-observation'; };
  function event(kind) { sequence = incrementCounter({value: sequence}, 'value', saturated); eventLog.append({sequence, kind, phase}); }
  function observe(action) { try { return action(); } catch { fatal('OBSERVATION_FAILED'); return undefined; } }
  function sameDescriptor(a,b) { return !!a && Reflect.ownKeys(a).length === Reflect.ownKeys(b).length && Reflect.ownKeys(b).every(k => a[k] === b[k]); }
  function guardsIntact() { const okay = patches.every(p => sameDescriptor(Object.getOwnPropertyDescriptor(p.object,p.key),p.installed)); if(!okay)fatal('GUARD_CHANGED'); return okay; }
  function ensure() { if (phase === 'uninstalled') fail('PRELUDE_MISSING'); if(!guardsIntact())fail('GUARD_CHANGED'); }
  function replace(object, key, value) {
    const own = Object.getOwnPropertyDescriptor(object, key);
    const original = method(object, key);
    if (own && (!Object.hasOwn(own, 'value') || !own.configurable && !own.writable)) fail('UNSUPPORTED_DESCRIPTOR');
    if (!own && !Object.isExtensible(object)) fail('UNSUPPORTED_DESCRIPTOR');
    const installed = own ? {...own, value} : {value, writable: true, enumerable: true, configurable: true};
    Object.defineProperty(object, key, installed); patches.push({object, key, own, installed}); return original;
  }
  function diagnosticRecords() {
    if (!binding) return [];
    const rows = Reflect.apply(method(binding, 'diagnostics'), binding, []);
    if (!Array.isArray(rows) || rows.length > 128) fail('DIAGNOSTIC_RECORD_LIMIT'); return jsonData(rows);
  }
  function snapshots() {
    if (!owner) return null;
    if (Object.hasOwn(owner,'photoOwner') !== profile.photoOwner) fail('SNAPSHOT_MEMBER');
    const read = object => Reflect.apply(method(object,'getSnapshot'),object,[]);
    // Exact finite JSON projection used by the previously reviewed native class control.
    // AvatarOwner has two lanes, not an invented aggregate getSnapshot. JSON optional fields
    // retain that established comparison semantics; this is not a generic object-state proof.
    const result = {owner:read(owner),account:read(owner.accountOwner),records:read(owner.controller),
      chat:read(owner.chatController),avatarSelf:read(owner.avatarOwner.self),avatarChild:read(owner.avatarOwner.child),
      authorization:read(owner.authorizationOwner),agent:read(owner.agentOwner),voice:read(owner.voiceOwner),file:read(owner.fileOwner),
      admin:read(owner.adminOwner),photo:profile.photoOwner ? read(owner.photoOwner) : null};
    const text = JSON.stringify(result); if (text.length > 65_536) fail('SNAPSHOT_LIMIT'); return text;
  }
  function snapshot() {
    guardsIntact();
    const records = observe(diagnosticRecords) ?? [];
    const timerEvidence = timerLog.snapshot(), eventEvidence = eventLog.snapshot();
    if (bindingDisposed) {
      if (ownerDisposes !== 1) fatal('OWNER_DISPOSE_DUPLICATE');
      if (pending.size || holds.size || activeTimers.size || probeEffects || !unmountReturned) fatal('LATE_LIFECYCLE_WORK');
      if (observe(snapshots) !== beforeDispose) fatal('LATE_SNAPSHOT');
      if (failures.length) phase = 'failed-observation';
    }
    return jsonData({schemaVersion: 1, variant: options.variant, ownerProfile: profile.id, case: options.case, phase, failures: [...failures], roots: rootCount,
      owners: owner ? 1 : 0, ownerDisposes, unmountCalls, probeEffects, pending: pending.size, held: holds.size, bindingDisposed,
      defaultNetwork: {...defaultNetwork}, bindingDiagnostics: records, bindingObservation: binding && typeof binding.diagnosticSummary === 'function' ? observe(() => jsonData(Reflect.apply(method(binding,'diagnosticSummary'),binding,[]))) ?? null : null, probe: currentProbe,
      acceptance, shutdownError, cleanup, settlement,
      role: 'long-lived-synthetic-preview', requests: {total: requests}, counterSaturated: saturated.saturated,
      timers: {active: activeTimers.size, counts: {...timerCounts}, retained: timerEvidence.rows.length, evicted: timerEvidence.evicted, bytes: timerEvidence.bytes, samples: timerEvidence.rows},
      events: eventEvidence.rows, eventEvicted: eventEvidence.evicted,
      eventObservation: {total: eventEvidence.total, retained: eventEvidence.rows.length, evicted: eventEvidence.evicted, bytes: eventEvidence.bytes, saturated: eventEvidence.saturated}, guardCount: patches.length,
      runtimeReady: false, frameReady: false, selectable: false, mutationReady: false});
  }
  function render() { if (uiText) observe(() => { const text = JSON.stringify(snapshot()); const next = text.length <= 65_536 ? text : 'SYNTHETIC_PREVIEW_DIAGNOSTIC_LIMIT'; if (uiText.textContent !== next) uiText.textContent = next; if (text.length > 65_536) fatal('DIAGNOSTIC_LIMIT'); }); }
  function track(promise) {
    if (bindingDisposed) fatal('LATE_PENDING_WORK');
    // Keep the caller's exact Promise; attached observers record rejections, never replace its result/error.
    try {
      if (pending.size >= 256 && !pending.has(promise)) { fatal('PENDING_LIMIT'); fail('PENDING_LIMIT'); }
      pending.add(promise);
      Reflect.apply(realm.Promise.prototype.then, promise, [() => {pending.delete(promise); render();}, () => {pending.delete(promise); event('observed-promise-rejection'); render();}]);
    } catch { pending.delete(promise); fatal('PROMISE_SHAPE'); }
  }
  function deny(channel, behavior) {
    return function () { incrementCounter(defaultNetwork, channel, saturated); event(`denied-${channel}`); fatal('DEFAULT_NETWORK_ATTEMPT'); render();
      if (behavior === 'false') return false;
      const error = new Error('SYNTHETIC_PREVIEW_DEFAULT_NETWORK_DENIED'); if (behavior === 'promise') return realm.Promise.reject(error); throw error;
    };
  }
  function countTimer(object, key) { incrementCounter(object, key, saturated); }
  function installTimers() {
    for (const [set, clear, kind] of [['setTimeout','clearTimeout','timeout'],['setInterval','clearInterval','interval']]) {
      const original = method(realm, set), clearOriginal = method(realm, clear); originalClears.set(kind, clearOriginal);
      replace(realm, set, function (callback, delay, ...args) {
        ensure(); if (bindingDisposed || disposalAttempted) {fatal('LATE_TIMER_WORK'); fail('CLOSED');}
        if (typeof callback !== 'function') { fatal('TIMER_CALLBACK'); fail('TIMER_CALLBACK'); }
        if (activeTimers.size >= 512) { fatal('ACTIVE_TIMER_LIMIT'); fail('ACTIVE_TIMER_LIMIT'); }
        const record = {kind, delay: typeof delay === 'number' && Number.isFinite(delay) ? delay : null, fired: 0};
        let id;
        function wrapped(...values) {
          ensure();
          if (disposalAttempted) {fatal('LATE_TIMER_WORK'); return;}
          if (kind === 'timeout' && activeTimers.get(id)?.record === record) activeTimers.delete(id);
          countTimer(record, 'fired'); countTimer(timerCounts, 'fired');
          return Reflect.apply(callback, this, values);
        }
        id = Reflect.apply(original, this, [wrapped, delay, ...args]);
        if (activeTimers.has(id)) {fatal('TIMER_ID_COLLISION'); fail('TIMER_ID_COLLISION');} activeTimers.set(id, {record});
        countTimer(timerCounts, 'scheduled'); timerLog.append({sequence: timerCounts.scheduled, kind, delay: record.delay});
        // Timer churn has exact aggregate counters; it does not consume lifecycle events or mutate DOM.
        return id;
      });
      replace(realm, clear, function (...args) {
        const result = Reflect.apply(clearOriginal, this, args); countTimer(timerCounts, 'clearCalls');
        const active = activeTimers.get(args[0]);
        if (active) { activeTimers.delete(args[0]); countTimer(timerCounts, 'clearedActive'); }
        return result;
      });
    }
  }
  function mountUI() {
    if (mountedUI) return;
    const doc = realm.document; if (!doc.body || doc.getElementById('synthetic-preview-runtime')) fail('CONTROL_DOM');
    mountedUI = true; ui = doc.createElement('section'); ui.id = 'synthetic-preview-runtime'; ui.setAttribute('aria-label', '合成預覽狀態');
    Object.assign(ui.style, {position: 'fixed', right: '8px', bottom: '8px', maxWidth: 'calc(100vw - 16px)', maxHeight: '40vh', overflow: 'auto', boxSizing: 'border-box', padding: '6px', background: '#fff', color: '#111', border: '1px solid #777', zIndex: '1000'});
    const disclosure = doc.createElement('details'); disclosure.open = false;
    const summary = doc.createElement('summary'); summary.textContent = '合成預覽狀態 · 持續 runtime'; disclosure.appendChild(summary); ui.appendChild(disclosure);
    uiText = doc.createElement('pre'); uiText.setAttribute('data-testid', 'synthetic-preview-runtime-diagnostic');
    Object.assign(uiText.style, {maxHeight: '24vh', overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '12px'}); disclosure.appendChild(uiText);
    const button = (label, action) => { const b = doc.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', () => { try { action(); } catch { fatal('CONTROL_COMMAND_FAILED'); render(); } }); disclosure.appendChild(b); };
    disclosure.addEventListener('toggle', render);
    button('Refresh diagnostics', render);
    button('卸載合成預覽', () => { void shutdown().catch(() => { render(); }); });
    if (options.case !== 'normal') button(`Release ${options.case.slice(5)} read`, () => release(options.case));
    doc.body.appendChild(ui); render();
  }
  function install() {
    if (phase !== 'uninstalled') fail('PRELUDE_DUPLICATE');
    if (realm.window !== realm || !realm.document || !realm.navigator) fail('BROWSER_REQUIRED');
    if ('__FIREBASE_DEFAULTS__' in realm || '__REACT_DEVTOOLS_GLOBAL_HOOK__' in realm || realm.navigator.serviceWorker?.controller) fail('CONTAMINATED_REALM');
    try {
      replace(realm, 'fetch', deny('fetch','promise')); replace(realm,'XMLHttpRequest',deny('xhr')); replace(realm,'WebSocket',deny('websocket')); replace(realm,'EventSource',deny('eventsource'));
      replace(realm.navigator,'sendBeacon',deny('beacon','false'));
      if (realm.navigator.serviceWorker) replace(realm.navigator.serviceWorker,'register',deny('serviceWorker','promise'));
      clockNow = method(realm.performance, 'now');
      installTimers();
      for (const [type, code] of [['error','BROWSER_ERROR'],['unhandledrejection','UNHANDLED_REJECTION']]) { const listener = () => { fatal(code); event(code); render(); }; realm.addEventListener(type, listener); listeners.push([type, listener]); }
      phase = 'dependency-evaluation'; event('denial-installed');
      if (realm.document.readyState === 'loading') realm.document.addEventListener('DOMContentLoaded', mountUI, {once:true}); else mountUI();
    } catch (error) { fatal('INSTALL_FAILED'); restoreOwned(); throw error; }
  }
  function captureRoot(registry) {
    ensure(); const original = method(registry, 'runApplication');
    replace(registry, 'runApplication', function (...args) {
      phase = 'native-root-registration'; event('runApplication');
      let result;
      try { result = Reflect.apply(original, this, args); } catch (error) { observe(() => {fatal('NATIVE_REGISTRATION_THROW'); render();}); throw error; }
      observe(() => { rootCount++; if (rootCount !== 1) fatal('MULTIPLE_ROOTS'); else {const nativeUnmount=method(result,'unmount');replace(result,'unmount',function(...values){ensure();return Reflect.apply(nativeUnmount,this,values)}); root=result;} phase='native-root-returned'; render(); });
      return result;
    });
  }
  function bodyObservation(response) {
    if (bodyObservers.has(response)) return response;
    const original = method(response, 'json'), own = Object.getOwnPropertyDescriptor(response, 'json');
    if (own && (!Object.hasOwn(own, 'value') || !own.configurable && !own.writable)) fail('UNSUPPORTED_DESCRIPTOR');
    const wrapped = function(...args) {
      ensure(); if (bindingDisposed || disposalAttempted) fail('CLOSED');
      if (pending.size >= 256) {fatal('PENDING_LIMIT'); fail('PENDING_LIMIT');}
      if (!sameDescriptor(Object.getOwnPropertyDescriptor(response, 'json'), installed)) {fatal('GUARD_CHANGED'); fail('GUARD_CHANGED');}
      let result;try{result=Reflect.apply(original,this,args)}catch(error){event('body-throw');throw error}track(result);return result;
    };
    const installed = own ? {...own, value: wrapped} : {value: wrapped, writable: true, enumerable: true, configurable: true};
    Object.defineProperty(response, 'json', installed); bodyObservers.add(response); return response;
  }
  function observeBinding(actual) {
    ensure(); if (binding || actual.variant !== options.variant || actual.scenario !== 'normal' || ['runtimeReady','frameReady','selectable','mutationReady','dataMapped'].some(k=>actual[k]!==false)) fail('BINDING_IDENTITY');
    method(actual,'diagnostics'); method(actual,'dispose'); const original=method(actual,'fetcher'); binding=actual;
    return function(...args) {
      ensure(); if (bindingDisposed || disposalAttempted) return realm.Promise.reject(new Error('SYNTHETIC_PREVIEW_CLOSED'));
      if (pending.size >= 256) {fatal('PENDING_LIMIT'); return realm.Promise.reject(new Error('SYNTHETIC_PREVIEW_PENDING_LIMIT'));}
      requests = incrementCounter({value: requests}, 'value', saturated); const requestToken = Object.freeze({});
      let promise;try{promise=Reflect.apply(original,this,args)}catch(error){event('fetch-throw');throw error}
      // Normal caller receives the original promise. Its body method is observed before downstream await continuations.
      observe(()=>Reflect.apply(realm.Promise.prototype.then,promise,[response=>{observe(()=>bodyObservation(response));},()=>{}]));
      let result=promise;
      if(options.case!=='normal' && args[0]===ORIGIN+HOLD_PATH[options.case]) {
        result=promise.then(response=>response.status !== 200 ? response : new realm.Promise((resolve,reject)=>{
          const signal=args[1]?.signal;if(!signal){fatal('HOLD_SIGNAL');reject(new Error('SYNTHETIC_PREVIEW_HOLD_SIGNAL'));return;}
          const key=requestToken;let done=false;const end=(error)=>{if(done)return;done=true;signal.removeEventListener('abort',abort);holds.delete(key);error?reject(error):resolve(response);render()};
          const abort=()=>end(new realm.DOMException('Synthetic read aborted','AbortError'));
          if(signal.aborted){abort();return;}holds.set(key,{release:()=>end(),abort});signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();render();
        }));
      }
      track(result);render();return result;
    };
  }
  function registerOwner(actual, actualBinding) {
    ensure(); if(owner || binding!==actualBinding) {fatal('OWNER_IDENTITY');fail('OWNER_IDENTITY');}
    const dispose=method(actual,'dispose');method(actual,'getSnapshot');const query=actual.queryClient;const cancel=method(query,'cancelQueries');owner=actual;
    replace(query,'cancelQueries',function(...args){const result=Reflect.apply(cancel,this,args);track(result);return result});
    replace(actual,'dispose',function(...args){const first=++ownerDisposes===1;if(!first)fatal('OWNER_DISPOSE_DUPLICATE');event('native-owner-dispose');let result;try{result=Reflect.apply(dispose,this,args)}catch(error){fatal('OWNER_DISPOSE_THROW');throw error}observe(()=>{if(first)beforeDispose=snapshots();render()});return result});
    snapshots();event('owner-registered');render();return actual;
  }
  function observeProbe(serialized) {
    ensure();if(['unmounting','closed-observation'].includes(phase)){fatal('LATE_PROBE');fail('LATE_PROBE');}
    if(typeof serialized!=='string'||serialized.length>16_384)fail('PROBE_DATA');currentProbe=jsonData(JSON.parse(serialized));probeEffects++;if(probeEffects>1)fatal('MULTIPLE_PROBES');phase='native-probe-committed';event('probe-commit');render();let ended=false;
    return ()=>{if(ended){fatal('PROBE_CLEANUP_DUPLICATE');return;}ended=true;probeEffects--;event('probe-cleanup');render();};
  }
  function release(which) {ensure();if(which!==options.case || which==='normal')fail('COMMAND_NOT_BOUND');for(const h of [...holds.values()])h.release();}
  function unmount() {ensure();if(!root||unmountCalls)fail('ROOT_UNMOUNT_STATE');unmountCalls++;phase='unmounting';event('root-unmount');let result;try{result=Reflect.apply(method(root,'unmount'),root,[])}catch(error){fatal('ROOT_UNMOUNT_THROW');throw error}unmountReturned=true;render();return result;}
  function finish() {
    ensure();if(bindingDisposed)return snapshot();
    if(!unmountReturned||ownerDisposes!==1||probeEffects!==0||beforeDispose===null)fail('CLEANUP_PENDING');
    if(pending.size||holds.size||activeTimers.size)fail('CLEANUP_PENDING');
    if(snapshots()!==beforeDispose){fatal('LATE_SNAPSHOT');fail('LATE_SNAPSHOT');}
    if(failures.length)fail('CONTROL_FAILED');
    disposeBinding();phase='closed-observation';event('binding-disposed-after-native-settlement');render();return snapshot();
  }
  function settlementCounts() {
    return {scheduled: timerCounts.scheduled, fired: timerCounts.fired, clearCalls: timerCounts.clearCalls,
      active: activeTimers.size, pending: pending.size, held: holds.size, ownerDisposes, probeEffects, unmountReturned};
  }
  async function settle() {
    ensure();
    const clock = () => { const value = Reflect.apply(clockNow, realm.performance, []); if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail('SETTLEMENT_CLOCK'); return value; };
    const start = clock(); let last = start;
    Object.assign(settlement, {turns: 0, quietTurns: 0, elapsedMs: 0, stopReason: 'running', before: settlementCounts(), after: null});
    try {
      for (let i = 0; i < 64; i++) {
        // Genuine task turn, not a microtask spin. Control barriers are tracked
        // exactly like native timers without a lifetime scheduling budget.
        await new realm.Promise(resolve => { Reflect.apply(method(realm, 'setTimeout'), realm, [resolve, 10]); });
        settlement.turns++; ensure();
        const now = clock(); if (now < last) fail('SETTLEMENT_CLOCK'); last = now; settlement.elapsedMs = now - start;
        settlement.after = settlementCounts();
        if (settlement.elapsedMs >= 1000) { settlement.stopReason = 'elapsed-limit'; fail('SETTLEMENT_TIME_LIMIT'); }
        // The wrapper removes this one-shot barrier before resolving its promise.
        // No remaining native timer or pending work is ignored or cancelled.
        const quiet = !pending.size && !holds.size && !activeTimers.size && unmountReturned && ownerDisposes === 1 && probeEffects === 0 && beforeDispose !== null;
        settlement.quietTurns = quiet ? settlement.quietTurns + 1 : 0;
        if (settlement.quietTurns === 2) { settlement.stopReason = 'quiescent'; return finish(); }
      }
      settlement.stopReason = 'turn-limit'; fail('SETTLEMENT_TURN_LIMIT');
    } finally {
      settlement.after = settlementCounts();
      if (settlement.stopReason === 'running') settlement.stopReason = 'exception';
    }
  }
  function errorCode(error) {
    const d = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'message') : null;
    return d && Object.hasOwn(d, 'value') && typeof d.value === 'string' && /^SYNTHETIC_PREVIEW_[A-Z_]{1,64}$/.test(d.value) ? d.value.slice('SYNTHETIC_PREVIEW_'.length) : 'NATIVE_THROW';
  }
  function disposeBinding() {
    if (disposalAttempted) { if (disposalFailed) throw disposalError; return; }
    disposalAttempted = true; cleanup.attempts++;
    // Preserve the native pre-disposal state; emergency cancellation is not evidence of native settlement.
    cleanup.before = {pending: pending.size, held: holds.size, timers: activeTimers.size, probeEffects, ownerDisposes, unmountReturned};
    try { Reflect.apply(method(binding,'dispose'), binding, []); bindingDisposed = true; }
    catch (error) { disposalFailed = true; disposalError = error; cleanup.error = errorCode(error); fatal('BINDING_DISPOSE_THROW'); throw error; }
  }
  function forceCleanup() {
    for (const hold of [...holds.values()]) { cleanup.forcedHolds++; observe(() => hold.abort()); }
    for (const [id, {record}] of [...activeTimers]) {
      try { Reflect.apply(originalClears.get(record.kind), realm, [id]); activeTimers.delete(id); cleanup.forcedTimers++; }
      catch { fatal('TIMER_CLEAR_FAILED'); }
    }
    cleanup.remainingPending = pending.size;
  }
  async function performShutdown() {
      let primary, cleanupFailure, primaryCaught = false, cleanupCaught = false, stage = 'unmount';
      try { unmount(); stage = 'settle'; await settle(); acceptance = failures.length ? 'failed' : 'native-settlement-observed'; }
      catch (error) { primaryCaught = true; primary = error; shutdownError = {stage, code: errorCode(error)}; acceptance = 'failed'; fatal('UNMOUNT_SETTLEMENT_FAILED'); }
      finally {
        try { disposeBinding(); } catch (error) { cleanupCaught = true; cleanupFailure = error; acceptance = 'failed'; }
        forceCleanup();
        if (acceptance === 'failed' || failures.length) phase = 'failed-observation';
        render();
      }
      if (primaryCaught && cleanupCaught && primary !== cleanupFailure) throw new AggregateError([primary, cleanupFailure], 'SYNTHETIC_PREVIEW_SHUTDOWN_AND_CLEANUP_FAILED');
      if (primaryCaught) throw primary;
      if (cleanupCaught) throw cleanupFailure;
      return snapshot();
  }
  // One shared native lifecycle/result. Publish ownership before any reentrant native call.
  function claimShutdown(winner, synchronous) {
    if (shutdownPromise) return null;
    let resolveResult, rejectResult;
    const shared = new realm.Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    shutdownOwner = winner; shutdownPromise = shared;
    const enter = () => {
      let result;
      try { result = performShutdown(); } catch (error) { rejectResult(error); return; }
      Reflect.apply(realm.Promise.prototype.then, result, [resolveResult, rejectResult]);
    };
    if (synchronous) enter(); else realm.Promise.resolve().then(enter);
    return shared;
  }
  function shutdown() {
    return shutdownPromise ?? claimShutdown('diagnostic', false);
  }
  function openComparisonRetirement(expectedOwner) {
    ensure();
    if (!owner || !root || !binding || expectedOwner !== owner) fail('OWNER_IDENTITY');
    const capturedOwner = owner, capturedRoot = root, capturedBinding = binding, token = Object.freeze({});
    const same = () => owner === capturedOwner && root === capturedRoot && binding === capturedBinding;
    let attempt = null;
    return Object.freeze({
      current: () => same() && (shutdownOwner === null || shutdownOwner === token),
      snapshot() { if (!same()) fail('COMPARISON_IDENTITY'); return snapshot(); },
      begin(preflight) {
        if (attempt) return attempt;
        if (typeof preflight !== 'function') fail('COMPARISON_PREFLIGHT');
        attempt = realm.Promise.resolve().then(() => {
          if (shutdownPromise) return Object.freeze({status: 'refused', reason: 'BUSY'});
          if (!same()) return Object.freeze({status: 'refused', reason: 'STALE_CONTEXT'});
          let open = true, used = false, accepted = null, result, preflightError, preflightCaught = false;
          const start = () => {
            if (!open || used) fail('COMPARISON_PREFLIGHT_CLOSED');
            used = true;
            if (!same() || shutdownPromise) return Object.freeze({status: 'refused', reason: 'BUSY'});
            const promise = claimShutdown(token, true);
            accepted = Object.freeze({status: 'accepted', shutdown: promise});
            return accepted;
          };
          try { result = preflight(start); }
          catch (error) { preflightCaught = true; preflightError = error; }
          finally { open = false; }
          // Starting the lifecycle cannot be undone by a later throw. Preserve it for cleanup,
          // but a mismatched/thrown preflight cannot become an authorized physical receipt.
          if (accepted) return Object.freeze({...accepted, preflightOkay: !preflightCaught && result === accepted, preflightCaught, preflightError});
          return Object.freeze({status: 'refused', reason: 'STALE_CONTEXT', preflightCaught, preflightError});
        });
        return attempt;
      },
    });
  }
  function restoreOwned() {
    // Installation rollback only. This function is not exported or called after activation.
    for(const p of [...patches].reverse()) {const now=Object.getOwnPropertyDescriptor(p.object,p.key);if(!sameDescriptor(now,p.installed)){fatal('FOREIGN_DESCRIPTOR');continue;}if(p.own)Object.defineProperty(p.object,p.key,p.own);else delete p.object[p.key];}
    patches.length=0;
    for (const [type, listener] of listeners) realm.removeEventListener(type, listener); listeners.length=0;
  }
  return Object.freeze({install,captureRoot,observeBinding,registerOwner,observeProbe,unmount,finish,settle,shutdown,openComparisonRetirement,release,snapshot});
}
let control = null;
export function installSyntheticPreviewEntry(realm, options) {if(control)fail('PRELUDE_DUPLICATE');const next=createSyntheticPreviewRuntime(realm,options);next.install();control=next;}
const installed=()=>{if(!control)fail('PRELUDE_MISSING');return control;};
export function captureSyntheticPreviewRoot(registry){installed().captureRoot(registry);}
export function observeSyntheticPreviewBinding(binding){return installed().observeBinding(binding);}
export function registerSyntheticPreviewOwner(owner,binding){return installed().registerOwner(owner,binding);}
export function observeSyntheticPreviewProbe(text){return installed().observeProbe(text);}
export function openSyntheticPreviewComparisonRetirement(owner){return installed().openComparisonRetirement(owner);}
