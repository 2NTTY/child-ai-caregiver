// Entry guard complements CSP. It is not an OS-level network sandbox.
export function installTransportTripwire(target){
 let attempts=0;
 const blocked=function(){attempts++;throw Error('CH01 synthetic preview: transport blocked');};
 for(const key of ['fetch','XMLHttpRequest','WebSocket','EventSource','Worker','SharedWorker','open'])Object.defineProperty(target,key,{value:blocked,writable:false,configurable:false});
 if(target.navigator)Object.defineProperty(target.navigator,'sendBeacon',{value:blocked,writable:false,configurable:false});
 return Object.freeze({get attempts(){return attempts;}});
}
