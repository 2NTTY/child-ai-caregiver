import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../dist/experiments/workbench-compare/',import.meta.url);
// Execute the actual parser-entry and observation scripts. Only DOM/network/native
// history ports are controlled; no hand-authored config or marker is substituted.
export async function loadRealDocument(h,side){
 const frame=h.frame(side),w=frame.contentWindow,events={},messages=[],writes=[];
 const setLocation=value=>{const url=new URL(value,'https://preview.example');Object.assign(w.location,{href:url.href,origin:url.origin,pathname:url.pathname,search:url.search,hash:url.hash});};
 setLocation(frame.src);
 Object.assign(w,{window:w,name:frame.name,URL,btoa,crypto:{randomUUID:()=>side==='left'?'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa':'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'},parent:{postMessage(data,origin){messages.push({source:w,origin,data:structuredClone(data)});}},addEventListener(name,fn){(events[name]??=[]).push(fn);}});
 Object.assign(w.document,{write(value){writes.push(value);},addEventListener(){}});
 w.history={state:null,pushState(state,title,url){this.state=state;setLocation(url);},replaceState(state,title,url){this.state=state;setLocation(url);}};
 const context=vm.createContext(w);
 vm.runInContext(fs.readFileSync(new URL('frame-entry.js',root),'utf8'),context,{filename:'frame-entry.js'});
 const config=w.__HISTORICAL_COMPARE_CONFIG__;
 const transport=async()=>{throw new Error('No real API call in a lifecycle test');};
 w.__HISTORICAL_SHARED_READER__={caseKey:config.caseKey,caseId:config.caseId,caseSha256:config.caseSha256,transport};w.fetch=transport;
 vm.runInContext(fs.readFileSync(new URL('boundary.js',root),'utf8'),context,{filename:'boundary.js'});
 async function flush(){for(const message of messages.splice(0))await h.event('message',message);}
 async function nativeLoad(){for(const fn of events.load??[])fn();await frame.fire('load');await flush();}
 async function navigate(path){w.history.pushState({},'',path);await flush();}
 async function replace(path,{deliver=true}={}){w.history.replaceState({},'',path);if(deliver)await flush();}
 await nativeLoad();
 return {config,messages,writes,flush,nativeLoad,navigate,replace,marker:()=>w.__HISTORICAL_COMPARE_OBSERVATION__};
}
