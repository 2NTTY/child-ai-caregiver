import {installIsolation} from './network-guard.mjs';
const isolation=installIsolation(globalThis);
const[{createHost},{mount},{createDemoLoader,demoScope}]=await Promise.all([import('./host.mjs'),import('./app.mjs'),import('./fixtures.mjs')]);
const host=createHost({scope:demoScope,loader:createDemoLoader()});
const view=mount(document.getElementById('app'),host);
Object.defineProperty(globalThis,'CR01Diagnostics',{value:Object.freeze({read:()=>Object.freeze({host:host.getSnapshot(),view:view.diagnostics(),isolation:isolation.diagnostics()})}),writable:false,configurable:false});
host.actions.search('','all');
globalThis.addEventListener('pagehide',()=>{view.dispose();host.dispose();},{once:true});
