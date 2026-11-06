import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntime} from './subject.mjs';
import {realm, binding, owner, turns} from './realm.mjs';
function fixture(options={}) {
 const {r,calls}=realm(); let now=0; r.performance.now=()=>now;options.configureRealm?.(r);
 const c=createRuntime(r,{variant:'fourth',case:options.case??'normal'});c.install();
 const b=options.binding??binding('fourth');const fetcher=c.observeBinding(b);const {o}=owner();if(options.configureOwner)options.configureOwner(o);
 c.registerOwner(o,b);const off=c.observeProbe('{}');
 const root={unmount(){off();o.dispose();options.onUnmount?.(r);}},reg={runApplication(){return root}};
 c.captureRoot(reg);reg.runApplication();
 async function drive(p,{runNative=true}={}) {let done=false,result,error,rejected=false; p.then(x=>{done=true;result=x},e=>{done=true;rejected=true;error=e});const seen=new Set();
  for(let i=0;i<300&&!done;i++){await turns();for(const t of [...calls.timers])if(!seen.has(t.n)&&!calls.clears.includes(t.n)&&(runNative||t.delay===10)){seen.add(t.n);now+=10;t.fn();}}
  assert.equal(done,true,'shutdown terminates');if(rejected)throw error;return result;
 }
 return {r,c,calls,b,fetcher,o,root,reg,off,drive};
}
test('4096 completed native timers do not exhaust lifetime budget',()=>{
 const f=fixture();for(let i=0;i<4096;i++){const id=f.r.setTimeout(()=>{},i%4);f.calls.timers.at(-1).fn();f.r.clearTimeout(id)}
 const s=f.c.snapshot();assert.equal(s.timers.counts.scheduled,4096);assert.equal(s.timers.counts.fired,4096);assert.equal(s.timers.active,0);assert.ok(s.timers.retained<=128);assert.ok(s.timers.evicted>0);assert.ok(JSON.stringify(s).length<=65536);
});
test('1024 sequential reads and probe updates remain live with bounded observation',async()=>{
 const f=fixture();f.off();for(let i=0;i<1024;i++){await (await f.fetcher('x',{})).json();await turns();f.c.observeProbe(JSON.stringify({i}))();}
 const s=f.c.snapshot();assert.equal(s.requests.total,1024);assert.ok(s.events.length<=128);assert.ok(s.eventEvicted>0);assert.equal(s.pending,0);assert.ok(s.guardCount<30);
});
test('active timer budget recovers after clear and preserves interval cross-clear',()=>{
 const f=fixture();const ids=Array.from({length:512},()=>f.r.setInterval(()=>{},3));assert.throws(()=>f.r.setTimeout(()=>{},0),/ACTIVE_TIMER_LIMIT/);
 f.r.clearTimeout(ids[0]);assert.doesNotThrow(()=>f.r.setTimeout(()=>{},0));assert.equal(f.c.snapshot().timers.active,512);
});
test('native callback this arguments result and exception are unchanged',()=>{
 const f=fixture(),receiver={},value={same:true};let got;
 f.r.setTimeout(function(...args){got=[this,args];return value},'2','a',3);const t=f.calls.timers.at(-1);assert.equal(t.delay,'2');assert.deepEqual(t.args,['a',3]);assert.equal(t.fn.call(receiver,...t.args),value);assert.deepEqual(got,[receiver,['a',3]]);
 const thrown={error:true};f.r.setTimeout(()=>{throw thrown},0);assert.throws(()=>f.calls.timers.at(-1).fn(),e=>e===thrown);assert.equal(f.c.snapshot().timers.active,0);
 let hits=0;const id=f.r.setInterval(()=>hits++,4);const it=f.calls.timers.at(-1);it.fn();it.fn();assert.equal(hits,2);assert.equal(f.c.snapshot().timers.active,1);f.r.clearTimeout(id);f.r.clearInterval(id);assert.equal(f.c.snapshot().timers.active,0);
});
test('network denials never invoke original transports',async()=>{
 const f=fixture();await assert.rejects(f.r.fetch('/x'),/NETWORK_DENIED/);for(const k of ['XMLHttpRequest','WebSocket','EventSource'])assert.throws(()=>new f.r[k](),/NETWORK_DENIED/);assert.equal(f.r.navigator.sendBeacon('/x','x'),false);await assert.rejects(f.r.navigator.serviceWorker.register('/x'),/NETWORK_DENIED/);assert.equal(f.calls.network,0);assert.deepEqual(Object.values(f.c.snapshot().defaultNetwork),[1,1,1,1,1,1]);
});
test('tampering global root and owner descriptors fails closed',()=>{
 for(const target of ['global','root','owner']){const f=fixture();if(target==='global')f.r.fetch=()=>{};if(target==='root')f.reg.runApplication=()=>{};if(target==='owner')f.o.dispose=()=>{};assert.throws(()=>f.fetcher('x',{}),/GUARD_CHANGED/);assert.ok(f.c.snapshot().failures.includes('GUARD_CHANGED'));}
});
test('pending budget rejects before delegating excess reads',async()=>{
 const b=binding('fourth');let delegates=0;b.fetcher=()=>{delegates++;return new Promise(()=>{})};const f=fixture({binding:b});for(let i=0;i<256;i++)f.fetcher('x',{});await assert.rejects(f.fetcher('x',{}),/PENDING_LIMIT/);assert.equal(delegates,256);assert.equal(f.c.snapshot().pending,256);
});
test('native shutdown succeeds after prior timers and disposes once',async()=>{
 const f=fixture();for(let i=0;i<700;i++){const id=f.r.setTimeout(()=>{},0);f.r.clearTimeout(id)}const p=f.c.shutdown();assert.equal(p,f.c.shutdown());const s=await f.drive(p);assert.equal(s.acceptance,'native-settlement-observed');assert.equal(s.bindingDisposed,true);assert.equal(s.ownerDisposes,1);assert.equal(s.cleanup.attempts,1);assert.equal(s.cleanup.forcedTimers,0);assert.equal(s.timers.active,0);assert.equal(f.b.disposed,1);assert.notEqual(f.r.fetch.name,'fetch');
});
test('forced timer cleanup is reported as failure rather than native settlement',async()=>{
 const f=fixture({onUnmount:r=>r.setInterval(()=>{},999)});await assert.rejects(f.drive(f.c.shutdown(),{runNative:false}),/SETTLEMENT_/);const s=f.c.snapshot();assert.equal(s.acceptance,'failed');assert.equal(s.cleanup.forcedTimers,1);assert.equal(s.timers.active,0);assert.equal(s.bindingDisposed,true);assert.equal(f.b.disposed,1);
});
test('held reads release abort and reject without converting unavailable to success',async()=>{
 for(const mode of ['release','abort','unavailable']){const b=binding('fourth');b.fetcher=()=>Promise.resolve(new Response('{}',{status:mode==='unavailable'?503:200}));const f=fixture({binding:b,case:'hold-account'}),ac=new AbortController();const p=f.fetcher('https://normal-bootstrap.invalid/api/account',{signal:ac.signal});await turns();if(mode==='unavailable'){assert.equal((await p).status,503);assert.equal(f.c.snapshot().held,0)}else{assert.equal(f.c.snapshot().held,1);if(mode==='release'){f.c.release('hold-account');assert.equal((await p).status,200)}else{ac.abort();await assert.rejects(p,e=>e.name==='AbortError')}await turns();assert.equal(f.c.snapshot().held,0)}}
});
test('falsey native failures and binding cleanup failures remain observable',async()=>{
 const b=binding('fourth');b.dispose=()=>{throw null};const f=fixture({binding:b});await assert.rejects(f.drive(f.c.shutdown()),e=>e===null);assert.equal(f.c.snapshot().bindingDisposed,false);assert.equal(f.c.snapshot().acceptance,'failed');
});
test('formal runtime cannot restore live transports and watches captured root unmount',()=>{const f=fixture();assert.equal(f.c.restore,undefined);f.root.unmount=()=>{};assert.throws(()=>f.c.unmount(),/GUARD_CHANGED/)});
test('diagnostics expose source-side request retention and overflow truthfully',()=>{const b=binding('fourth');b.diagnosticSummary=()=>({total:900,requests:900,evicted:772,bytes:16300,counterSaturated:false,saturated:false});const f=fixture({binding:b});assert.deepEqual(f.c.snapshot().bindingObservation,{total:900,requests:900,evicted:772,bytes:16300,counterSaturated:false,saturated:false})});
test('queued callback stops before native code if transport guards were changed',()=>{const f=fixture();let native=0;f.r.setTimeout(()=>native++,0);f.r.fetch=()=>{};assert.throws(()=>f.calls.timers.at(-1).fn(),/GUARD_CHANGED/);assert.equal(native,0)});
test('native scheduler and clear errors preserve exact exceptions and accounting',()=>{const failure={source:'native'},f=fixture({configureRealm:r=>{r.setTimeout=()=>{throw failure}}});assert.throws(()=>f.r.setTimeout(()=>{},1),e=>e===failure);assert.equal(f.c.snapshot().timers.counts.scheduled,0);assert.equal(f.c.snapshot().timers.active,0);const g=fixture({configureRealm:r=>{r.clearInterval=()=>{throw failure}}});const id=g.r.setInterval(()=>{},1);assert.throws(()=>g.r.clearInterval(id),e=>e===failure);assert.equal(g.c.snapshot().timers.active,1)});
test('pending capacity recovers after actual native promise settlement',async()=>{const b=binding('fourth'),resolves=[];b.fetcher=()=>new Promise(resolve=>resolves.push(resolve));const f=fixture({binding:b});const promises=Array.from({length:256},()=>f.fetcher('x',{}));await assert.rejects(f.fetcher('x',{}),/PENDING_LIMIT/);for(const resolve of resolves.splice(0))resolve(new Response('{}'));await Promise.all(promises);await turns();assert.equal(f.c.snapshot().pending,0);const next=f.fetcher('x',{});resolves[0](new Response('{}'));await next;assert.equal(f.c.snapshot().requests.total,257)});
test('independent held read tokens release all and shutdown aborts unreleased reads honestly',async()=>{const f=fixture({case:'hold-account'}),controllers=Array.from({length:5},()=>new AbortController());const reads=controllers.map(ac=>f.fetcher('https://normal-bootstrap.invalid/api/account',{signal:ac.signal}));await turns();assert.equal(f.c.snapshot().held,5);controllers[1].abort();await assert.rejects(reads[1],e=>e.name==='AbortError');assert.equal(f.c.snapshot().held,4);f.c.release('hold-account');await Promise.all(reads.filter((_,i)=>i!==1));await turns();assert.equal(f.c.snapshot().held,0);
 const g=fixture({case:'hold-account'});const pending=g.fetcher('https://normal-bootstrap.invalid/api/account',{signal:new AbortController().signal});const caught=pending.catch(e=>e);await turns();await assert.rejects(g.drive(g.c.shutdown()),/SETTLEMENT_/);assert.equal((await caught).name,'AbortError');await turns();const s=g.c.snapshot();assert.equal(s.cleanup.forcedHolds,1);assert.equal(s.held,0);assert.equal(s.pending,0);assert.equal(s.acceptance,'failed');
});
test('cleanup failure cannot pretend a surviving native timer was removed',async()=>{const g=fixture({configureRealm:r=>{r.clearInterval=()=>{throw Error('native clear denied')}},onUnmount:r=>r.setInterval(()=>{},999)});await assert.rejects(g.drive(g.c.shutdown(),{runNative:false}),/SETTLEMENT_/);const s=g.c.snapshot();assert.equal(s.cleanup.forcedTimers,0);assert.equal(s.timers.active,1);assert.ok(s.failures.includes('TIMER_CLEAR_FAILED'));assert.equal(s.acceptance,'failed')});
test('native unmount and owner disposal failures preserve falsey errors',async()=>{for(const failure of [undefined,null,false,0,'']){const f=fixture({configureOwner:o=>{o.dispose=()=>{throw failure}}});await assert.rejects(f.drive(f.c.shutdown()),e=>e===failure);const s=f.c.snapshot();assert.equal(s.acceptance,'failed');assert.equal(s.bindingDisposed,true);assert.equal(s.ownerDisposes,1);assert.equal(s.unmountCalls,1);assert.equal(s.cleanup.attempts,1)}});
test('role config getters string callbacks and profile mismatch are refused',()=>{const {r}=realm();let read=0;const config={case:'normal',get variant(){read++;return 'handbook'}};assert.throws(()=>createRuntime(r,config),/CONTROL_CONFIG/);assert.equal(read,0);assert.throws(()=>createRuntime(r,{variant:'original',case:'normal'}),/CONTROL_CONFIG/);const f=fixture();assert.throws(()=>f.r.setTimeout('run()',0),/TIMER_CALLBACK/);assert.equal(f.calls.timers.length,0);const g=realm(),c=createRuntime(g.r,{variant:'care',case:'normal'});c.install();const b=binding('care');c.observeBinding(b);const {o}=owner();delete o.photoOwner;assert.throws(()=>c.registerOwner(o,b),/SNAPSHOT_MEMBER/)});
test('visible event totals remain exact after bounded event sample eviction',()=>{const f=fixture();f.off();for(let i=0;i<300;i++)f.c.observeProbe('{}')();const s=f.c.snapshot();assert.equal(typeof s.eventObservation,'object');assert.equal(s.eventObservation.total,605);assert.equal(s.eventObservation.retained,s.events.length);assert.equal(s.eventObservation.total,s.eventObservation.retained+s.eventObservation.evicted);assert.ok(s.eventObservation.bytes<=8192);assert.equal(s.eventObservation.saturated,false)});
