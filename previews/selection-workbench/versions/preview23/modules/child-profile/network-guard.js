(function(root){
  'use strict';
  const hits=[];
  function deny(name){return function(){hits.push(name);throw new Error(`CP01_NETWORK_DENIED:${name}`);};}
  // Defense in depth for this synthetic preview, not a general browser sandbox.
  for(const name of ['fetch','XMLHttpRequest','WebSocket','EventSource','Worker','SharedWorker','RTCPeerConnection','webkitRTCPeerConnection']){
    Object.defineProperty(root,name,{value:deny(name),writable:false,configurable:false});
  }
  Object.defineProperty(root.navigator,'sendBeacon',{value:deny('sendBeacon'),writable:false,configurable:false});
  if(root.navigator.serviceWorker)Object.defineProperty(root.navigator.serviceWorker,'register',{value:deny('serviceWorker.register'),writable:false,configurable:false});
  root.document.addEventListener('submit',event=>{event.preventDefault();hits.push('form.submit');},true);
  Object.defineProperty(root,'CPNetwork',{value:Object.freeze({get hits(){return Object.freeze([...hits]);}}),writable:false,configurable:false});
})(globalThis);
