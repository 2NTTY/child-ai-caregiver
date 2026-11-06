/** Actual runtime and closed bootstrap; owner/root/clock are explicit finite test adapters. */
import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';import {realm,owner,turns} from './realm.mjs';
const runtime=await import(pathToFileURL(process.env.RUNTIME_UNDER_TEST));
const base=process.env.PROJECT_UNDER_TEST;
const {createSyntheticPreviewReadBootstrap,bootstrapPins}=await import(pathToFileURL(process.env.BOOTSTRAP_UNDER_TEST));
const {default:registry}=await import(pathToFileURL(process.env.BOOTSTRAP_UNDER_TEST.replace('/src/synthetic-preview-read-bootstrap.mjs','/sources/registry.json')),{with:{type:'json'}});
export const createRuntime=runtime.createSyntheticPreviewRuntime;
export const variant=process.env.RED_BASE==='1'?'fourth':'harbour';
export const request=()=>({method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json'},signal:new AbortController().signal});
export async function fixture(options={}){
 const {r,calls}=realm();let now=0;const schedule=r.setTimeout;r.performance.now=()=>now;
 if(options.scheduleError)r.setTimeout=function(...args){if(args[1]===10)throw options.scheduleError;return Reflect.apply(schedule,this,args)};
 const c=createRuntime(r,{variant,case:'normal'});c.install();
 const b=createSyntheticPreviewReadBootstrap({registry,variant,scenario:'normal',...bootstrapPins});
 // RED uses the accepted Fourth common base; GREEN uses the own Harbour binding unchanged.
 let disposed=0;const dispose=b.dispose;b.dispose=function(){disposed++;options.bindingDispose?.();if(options.disposeThrow)throw options.disposeError;return Reflect.apply(dispose,this,[])};
 const fetcher=c.observeBinding(b),{o,count}=owner();if(options.never)o.queryClient.cancelQueries=()=>new Promise(()=>{});
 c.registerOwner(o,b);const off=c.observeProbe('{}');let cleanupCalls=0;
 const root={unmount(){options.onUnmount?.();if(options.unmountThrow)throw options.unmountError;off();o.dispose();for(let i=0;i<(options.nativeTasks??0);i++)r.setTimeout(()=>{cleanupCalls++;options.onNative?.()})}};
 const registryPort={runApplication(){return root}};c.captureRoot(registryPort);registryPort.runApplication();
 async function drive(p,{runNative=true,step=10,afterTurn=()=>{}}={}){
  let done=false,value,error,rejected=false;p.then(x=>{done=true;value=x},e=>{done=true;rejected=true;error=e});const fired=new Set();
  for(let n=0;n<1000&&!done;n++){await turns();if(done)break;
   if(runNative)for(const t of [...calls.timers])if(t.delay===undefined&&!fired.has(t.n)&&!calls.clears.includes(t.n)){fired.add(t.n);t.fn()}
   const t=calls.timers.find(t=>t.delay===10&&!fired.has(t.n)&&!calls.clears.includes(t.n));if(t){fired.add(t.n);now+=step;t.fn();afterTurn(fired.size)}
  }assert.equal(done,true,'finite injected queue reached terminal');if(rejected)throw error;return value;
 }
 return {r,c,calls,b,o,root,fetcher,drive,advance:x=>now+=x,disposed:()=>disposed,cleanupCalls:()=>cleanupCalls,ownerDisposals:count,turns};
}
export function openView(f){assert.equal(typeof f.c.openComparisonRetirement,'function','missing actual runtime comparison facade');return f.c.openComparisonRetirement(f.o)}
