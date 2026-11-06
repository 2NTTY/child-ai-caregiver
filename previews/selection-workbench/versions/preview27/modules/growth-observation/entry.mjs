import {createHost} from './host.mjs';
import {mountGrowth} from './view.mjs';
export function mountDemo(root){const host=createHost(),view=mountGrowth(root,host);const ready=host.load();return{host,ready,destroy(){view.destroy();host.destroy()}}}
export function installPage(root,win){
 let current=mountDemo(root),stopped=false;
 const hide=()=>{current?.destroy();current=null};
 const show=event=>{if(!stopped&&event.persisted&&!current)current=mountDemo(root)};
 win.addEventListener('pagehide',hide);win.addEventListener('pageshow',show);
 return{get current(){return current},destroy(){if(stopped)return;stopped=true;win.removeEventListener('pagehide',hide);win.removeEventListener('pageshow',show);hide()}};
}
if(typeof document!=='undefined'){const root=document.getElementById('gr01');if(root)installPage(root,window)}
