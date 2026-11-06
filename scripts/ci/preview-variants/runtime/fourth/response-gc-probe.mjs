import {realm,binding,owner,turns} from './realm.mjs';
import {pathToFileURL} from 'node:url';
const legacy=false;const {createSyntheticPreviewRuntime}=await import(pathToFileURL(process.env.RUNTIME_UNDER_TEST));
const {r}=realm(), c=createSyntheticPreviewRuntime(r,{variant:'fourth',case:'normal'});c.install();const b=binding('fourth'),fetcher=c.observeBinding(b);c.registerOwner(owner().o,b);const weak=[];
async function visit(){for(let i=0;i<64;i++){const response=await fetcher('x',{});await response.json();weak.push(new WeakRef(response));}await turns();}
await visit();
for(let n=0;n<8;n++){await new Promise(resolve=>setImmediate(resolve));global.gc();}
const retained=weak.filter(ref=>ref.deref()!==undefined).length;
console.log(JSON.stringify({mode:legacy?'legacy':'runtime',created:64,collected:64-retained,retained,guardCount:c.snapshot().guardCount??null}));
if(!legacy&&retained>0)process.exitCode=1;
