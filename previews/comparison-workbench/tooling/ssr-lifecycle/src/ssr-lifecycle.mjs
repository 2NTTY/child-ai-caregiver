/** S1 pure SSR observation only. No SDK/React/Node imports or host isolation implementation. */
let active = null;
const error = code => new Error(`NORMAL_SSR_${code}`);
function reject(code) { if (active) fault(active, code); throw error(code); }
function fault(s, code) { if (!s.failures.includes(code) && s.failures.length < 32) s.failures.push(code); s.phase = 'failed-observation'; }
function event(s, kind) { if (s.events.length >= 512) { fault(s, 'EVENT_LIMIT'); return; } s.events.push({sequence:s.events.length+1,kind}); }
function data(o, key) { const d=Object.getOwnPropertyDescriptor(o,key);if(!d||!Object.hasOwn(d,'value'))throw error('DATA_DESCRIPTOR');return d.value; }
function method(o, key) { for(let at=o;at;at=Object.getPrototypeOf(at)){const d=Object.getOwnPropertyDescriptor(at,key);if(d){if(!Object.hasOwn(d,'value')||typeof d.value!=='function')throw error('METHOD_DESCRIPTOR');return d.value}}throw error('METHOD_MISSING'); }
function jsonData(value) {
 const seen=new Set();function copy(v){if(v===null||['string','boolean'].includes(typeof v))return v;if(typeof v==='number'&&Number.isFinite(v))return v;if(typeof v!=='object'||seen.has(v))throw error('DIAGNOSTIC_DATA');const array=Array.isArray(v);if(!array&&![Object.prototype,null].includes(Object.getPrototypeOf(v)))throw error('DIAGNOSTIC_DATA');const keys=Reflect.ownKeys(v),out=array?[]:Object.create(null);if(array&&(keys.length!==v.length+1||keys.some(k=>k!=='length'&&(typeof k!=='string'||!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=v.length))))throw error('DIAGNOSTIC_DATA');seen.add(v);for(const k of keys){if(typeof k!=='string')throw error('DIAGNOSTIC_DATA');if(array&&k==='length')continue;Object.defineProperty(out,k,{value:copy(data(v,k)),enumerable:true,writable:true,configurable:true})}seen.delete(v);return out}const text=JSON.stringify(copy(value));if(text.length>65536)throw error('DIAGNOSTIC_LIMIT');return JSON.parse(text);
}
function context(token) { if(!active||token!==active.token)reject('TOKEN');return active; }
function same(a,b){return !!a&&Reflect.ownKeys(a).length===Reflect.ownKeys(b).length&&Reflect.ownKeys(b).every(k=>a[k]===b[k]);}
function pinMethod(object,key){for(let holder=object;holder;holder=Object.getPrototypeOf(holder)){const d=Object.getOwnPropertyDescriptor(holder,key);if(d){if(!Object.hasOwn(d,'value')||typeof d.value!=='function')throw error('METHOD_DESCRIPTOR');return {holder,descriptor:{...d},fn:d.value}}}throw error('METHOD_MISSING');}
function matchesMethod(object,key,pin){for(let holder=object;holder;holder=Object.getPrototypeOf(holder)){const d=Object.getOwnPropertyDescriptor(holder,key);if(d)return holder===pin.holder&&same(d,pin.descriptor)}return false;}
function guard(s){let intact=true;if(s.binding&&!matchesMethod(s.binding,'dispose',s.bindingDisposal)){intact=false;fault(s,'BINDING_DISPOSER_CHANGED')}if(s.owner&&!same(Object.getOwnPropertyDescriptor(s.owner,'queryClient'),s.queryClientDescriptor)){intact=false;fault(s,'QUERY_CLIENT_CHANGED')}for(const p of s.patches)if(!same(Object.getOwnPropertyDescriptor(p.object,p.key),p.installed)){intact=false;fault(s,'METHOD_CHANGED')}return intact;}
function patch(s,object,key,value){const own=Object.getOwnPropertyDescriptor(object,key);method(object,key);if(own&&(!Object.hasOwn(own,'value')||!own.configurable&&!own.writable)||!own&&!Object.isExtensible(object))throw error('METHOD_DESCRIPTOR');const installed=own?{...own,value}:{value,writable:true,configurable:true,enumerable:true};Object.defineProperty(object,key,installed);s.patches.push({object,key,installed});}
function snapshots(s){if(!s.owner)return null;const o=s.owner,read=x=>Reflect.apply(method(x,'getSnapshot'),x,[]);if(Object.hasOwn(o,'photoOwner')!==(s.variant==='harbour'))throw error('SNAPSHOT_MEMBER');const text=JSON.stringify({owner:read(o),account:read(o.accountOwner),records:read(o.controller),chat:read(o.chatController),avatarSelf:read(o.avatarOwner.self),avatarChild:read(o.avatarOwner.child),authorization:read(o.authorizationOwner),agent:read(o.agentOwner),voice:read(o.voiceOwner),file:read(o.fileOwner),admin:read(o.adminOwner),photo:s.variant==='harbour'?read(o.photoOwner):null});if(text.length>65536)throw error('SNAPSHOT_LIMIT');return text;}
function track(s,promise){if(s.terminal)fault(s,'LATE_WORK');if(s.pending.size>=256){fault(s,'PENDING_LIMIT');return}try{s.pending.add(promise);Reflect.apply(Promise.prototype.then,promise,[()=>{s.pending.delete(promise)},()=>{s.pending.delete(promise);fault(s,'PROMISE_REJECTED')}]);}catch{s.pending.delete(promise);fault(s,'PROMISE_SHAPE')}}
export function beginSSRRender(options){
 if(typeof window!=='undefined')reject('BROWSER');if(active)reject('CONTEXT_REUSED');
 if(!options||typeof options!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(options))||Reflect.ownKeys(options).length!==2||Reflect.ownKeys(options).some(k=>!['variant','pathname'].includes(k)))reject('CONFIG');
 let variant,pathname;try{variant=data(options,'variant');pathname=data(options,'pathname')}catch{reject('CONFIG')}
 if(!['original','harbour'].includes(variant)||pathname!=='/tasks')reject('CONFIG');
 const token=Object.freeze(Object.create(null));active={token,variant,pathname,phase:'render-observation',online:null,binding:null,bindingDisposal:null,owner:null,queryClientDescriptor:null,ownerDisposes:0,bindingDisposed:false,firstSnapshot:null,finalizeStarted:false,terminal:false,partialOwnerUnobserved:false,requests:0,failures:[],events:[],pending:new Set(),patches:[]};event(active,'begin');return token;
}
export function requireSSRRender(variant,online){if(typeof window!=='undefined')reject('BROWSER');if(!active)reject('CONTEXT_REQUIRED');if(active.variant!==variant)reject('VARIANT');if(typeof online!=='boolean')reject('ONLINE');if(active.finalizeStarted||active.terminal)reject('CONTEXT_CLOSED');if(active.binding)reject('FACTORY_DUPLICATE');active.online=online;return active.token;}
export function observeSSRBinding(token,binding){
 const s=context(token);if(s.finalizeStarted||s.terminal)reject('CONTEXT_CLOSED');if(s.binding)reject('BINDING_DUPLICATE');
 if(data(binding,'variant')!==s.variant||data(binding,'scenario')!=='normal'||['runtimeReady','frameReady','selectable','mutationReady','dataMapped'].some(k=>data(binding,k)!==false))reject('BINDING_IDENTITY');
 const fetcher=method(binding,'fetcher'),disposer=pinMethod(binding,'dispose');method(binding,'diagnostics');s.binding=binding;s.bindingDisposal=disposer;event(s,'binding-observed');
 return function(...args){s.requests++;fault(s,'UNEXPECTED_READ');if(s.requests>256)reject('REQUEST_LIMIT');if(s.terminal)fault(s,'LATE_WORK');let result;try{result=Reflect.apply(fetcher,this,args)}catch(e){event(s,'fetch-throw');throw e}try{Reflect.apply(Promise.prototype.then,result,[response=>{try{const json=method(response,'json');patch(s,response,'json',function(...bodyArgs){let body;try{body=Reflect.apply(json,this,bodyArgs)}catch(e){fault(s,'BODY_THROW');throw e}track(s,body);return body})}catch{fault(s,'BODY_OBSERVATION_FAILED')}},()=>{}])}catch{fault(s,'PROMISE_SHAPE')}track(s,result);return result};
}
export function registerSSROwner(token,owner,binding){
 const s=context(token);if(s.finalizeStarted||s.terminal)reject('CONTEXT_CLOSED');if(s.owner)reject('OWNER_DUPLICATE');if(s.binding!==binding)reject('BINDING_IDENTITY');
 const dispose=method(owner,'dispose'),query=data(owner,'queryClient'),cancel=method(query,'cancelQueries');method(owner,'getSnapshot');s.owner=owner;s.queryClientDescriptor={...Object.getOwnPropertyDescriptor(owner,'queryClient')};
 patch(s,query,'cancelQueries',function(...args){let result;try{result=Reflect.apply(cancel,this,args)}catch(e){fault(s,'CANCEL_THROW');throw e}track(s,result);return result});
 patch(s,owner,'dispose',function(...args){if(!guard(s))throw error('LIFECYCLE_IDENTITY');const first=++s.ownerDisposes===1;if(!first)fault(s,'OWNER_DISPOSE_DUPLICATE');if(!s.finalizeStarted)fault(s,'EARLY_OWNER_DISPOSE');if(s.terminal)fault(s,'LATE_WORK');event(s,'native-owner-dispose');let result;try{result=Reflect.apply(dispose,this,args)}catch(e){fault(s,'OWNER_DISPOSE_THROW');throw e}guard(s);try{if(first)s.firstSnapshot=snapshots(s)}catch{fault(s,'SNAPSHOT_FAILED')}return result});
 snapshots(s);event(s,'owner-registered');return owner;
}
export function observeSSRRender(token){const s=context(token);guard(s);if(s.terminal&&s.owner){try{if(snapshots(s)!==s.firstSnapshot)fault(s,'LATE_SNAPSHOT')}catch{fault(s,'SNAPSHOT_FAILED')}if(s.pending.size)fault(s,'LATE_WORK');if(s.ownerDisposes!==1)fault(s,'OWNER_DISPOSE_COUNT')}let rows=[];try{if(s.binding)rows=Reflect.apply(method(s.binding,'diagnostics'),s.binding,[]);if(!Array.isArray(rows)||rows.length>256)throw error('DIAGNOSTIC_LIMIT');rows=jsonData(rows)}catch{fault(s,'DIAGNOSTIC_FAILED')}return jsonData({schemaVersion:1,variant:s.variant,pathname:s.pathname,online:s.online,phase:s.phase,failures:[...s.failures],requests:s.requests,pending:s.pending.size,ownerDisposes:s.ownerDisposes,bindingDisposed:s.bindingDisposed,partialOwnerUnobserved:s.partialOwnerUnobserved,events:[...s.events],bindingDiagnostics:rows,explicitSSRFinalization:s.finalizeStarted,clientEffectsObserved:false,hostIsolationVerified:false,timerAttributionVerified:false,runtimeReady:false,frameReady:false,selectable:false,mutationReady:false});}
export async function finalizeSSRRender(token){
 const s=context(token);if(s.finalizeStarted)reject('FINALIZATION_REUSED');s.finalizeStarted=true;event(s,'explicit-ssr-finalization');const intact=guard(s);
 if(!s.owner){fault(s,'OWNER_MISSING');s.partialOwnerUnobserved=true;s.terminal=true;if(s.binding&&guard(s)){try{Reflect.apply(s.bindingDisposal.fn,s.binding,[]);s.bindingDisposed=true}catch{fault(s,'BINDING_DISPOSE_THROW')}}throw error('FINALIZATION_FAILED')}
 if(!intact){s.terminal=true;throw error('FINALIZATION_FAILED')}
 let nativeError,threw=false;
 if(s.ownerDisposes!==0)fault(s,'OWNER_DISPOSE_COUNT');else{try{Reflect.apply(method(s.owner,'dispose'),s.owner,[])}catch(e){threw=true;nativeError=e}}
 // S2 owns the external deadline/unknown handles. S1 never invents a timeout or cancels native work.
 for(let i=0;i<256&&s.pending.size;i++){await Promise.allSettled([...s.pending]);guard(s);}
 if(s.pending.size)fault(s,'SETTLEMENT_LIMIT');guard(s);if(s.ownerDisposes!==1||s.firstSnapshot===null)fault(s,'OWNER_DISPOSE_COUNT');
 try{if(snapshots(s)!==s.firstSnapshot)fault(s,'LATE_SNAPSHOT')}catch{fault(s,'SNAPSHOT_FAILED')}
 s.terminal=true;guard(s);if(threw)throw nativeError;if(s.failures.length)throw error('FINALIZATION_FAILED');
 try{Reflect.apply(s.bindingDisposal.fn,s.binding,[]);s.bindingDisposed=true}catch(e){fault(s,'BINDING_DISPOSE_THROW');throw e}
 s.phase='finalized-observation';event(s,'binding-disposed-after-native-settlement');const diagnostic=observeSSRRender(token);if(s.failures.length)throw error('FINALIZATION_FAILED');return diagnostic;
}
