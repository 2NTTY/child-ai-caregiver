export function installIsolation(target){let attempts=0;const installed=[];const deny=function(){attempts++;throw new Error('CR01 synthetic preview: network and persistent storage are disabled');};for(const name of['fetch','XMLHttpRequest','WebSocket','EventSource','Worker','SharedWorker']){try{Object.defineProperty(target,name,{value:deny,configurable:false,writable:false});installed.push(name);}catch{}}
 for(const name of['localStorage','sessionStorage','indexedDB','caches']){try{Object.defineProperty(target,name,{get:deny,configurable:false});installed.push(name);}catch{}}
 for(const name of['sendBeacon']){try{Object.defineProperty(target.navigator,name,{value:deny,configurable:false,writable:false});installed.push(name);}catch{}}
 try{Object.defineProperty(target.navigator,'serviceWorker',{get:deny,configurable:false});installed.push('serviceWorker');}catch{}
 return Object.freeze({diagnostics:()=>Object.freeze({attempts,installed:Object.freeze([...installed])})});
}
