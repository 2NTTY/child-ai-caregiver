// Tripwires complement CSP. They do not pretend to be a browser security sandbox.
const installed=new WeakMap();
export function installIsolation(window){
 if(installed.has(window))return installed.get(window);
 let networkAttempts=0,storageAttempts=0;
 const network=function(){networkAttempts++;throw new Error('合成候選隔離：不允許網絡或外部視窗');};
 const storage=function(){storageAttempts++;throw new Error('合成候選隔離：不允許持久儲存');};
 const value=(object,key,fn)=>Object.defineProperty(object,key,{value:fn,writable:false,configurable:false});
 for(const name of ['fetch','XMLHttpRequest','WebSocket','EventSource','Worker','SharedWorker','WebTransport','RTCPeerConnection','open'])value(window,name,network);
 value(window.navigator,'sendBeacon',network);
 value(window.navigator,'serviceWorker',Object.freeze({register:network}));
 for(const key of ['localStorage','sessionStorage','indexedDB','caches'])Object.defineProperty(window,key,{get:storage,set:storage,configurable:false});
 Object.defineProperty(window.document,'cookie',{get:storage,set:storage,configurable:false});
 const guard=Object.freeze({snapshot:()=>Object.freeze({networkAttempts,storageAttempts})});installed.set(window,guard);return guard;
}
