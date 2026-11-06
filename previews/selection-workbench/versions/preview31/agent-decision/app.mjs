import {createDecisionHost} from './decision-host.mjs';
import {createScenario} from './fixtures.mjs';
import {renderDecision} from './decision-view.mjs';
export function startApplication(document,window){
 const host=createDecisionHost(createScenario()),view=renderDecision(document.getElementById('ad'),host);let disposed=false;
 const retire=()=>view.retire();
 const visibility=()=>{if(document.hidden)retire();};
 const hide=event=>{if(event.persisted)retire();else dispose();};
 function dispose(){if(disposed)return;disposed=true;window.removeEventListener('pagehide',hide);window.removeEventListener('blur',retire);document.removeEventListener('visibilitychange',visibility);view.dispose();host.dispose();}
 window.addEventListener('pagehide',hide);window.addEventListener('blur',retire);document.addEventListener('visibilitychange',visibility);
 return Object.freeze({host,view,dispose});
}
export const application=typeof document!=='undefined'&&typeof window!=='undefined'?startApplication(document,window):null;
