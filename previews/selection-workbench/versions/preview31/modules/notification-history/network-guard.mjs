// Fail closed. This page may load its local assets, but has no transport capability.
export function installNetworkGuard(realm){
 const attempts=[];
 const block=name=>function(){attempts.push({name});throw Error(`NH01 network/permission blocked: ${name}`)};
 for(const name of ['fetch','XMLHttpRequest','WebSocket','EventSource','Worker','SharedWorker'])Object.defineProperty(realm,name,{value:block(name),writable:false,configurable:true});
 if(realm.navigator){Object.defineProperty(realm.navigator,'sendBeacon',{value:block('sendBeacon'),writable:false,configurable:true});if(realm.navigator.serviceWorker)Object.defineProperty(realm.navigator.serviceWorker,'register',{value:block('serviceWorker.register'),writable:false,configurable:true})}
 if(realm.Notification)Object.defineProperty(realm.Notification,'requestPermission',{value:block('Notification.requestPermission'),writable:false,configurable:true});
 if(realm.PushManager?.prototype)Object.defineProperty(realm.PushManager.prototype,'subscribe',{value:block('PushManager.subscribe'),writable:false,configurable:true});
 return Object.freeze({get attempts(){return Object.freeze(attempts.map(x=>Object.freeze({...x})))}});
}
