import {resolveReducedMotion,readStoredReducedMotion,canApplyInitialPreference,motionPreferenceStorageKey} from './policy.mjs';

// In-memory teaching adapter. This is not MotionProvider and never touches platform storage.
const cases={ready:{system:false,mode:'available'},system:{system:true,mode:'available'},unknown:{system:null,mode:'available'},loading:{system:null,mode:'available',systemReady:false},'write-fail':{system:false,mode:'write-fail'},'read-fail':{system:false,mode:'read-fail'},native:{system:false,mode:'native'}};
export function createOwner(){
 let alive=true,lifetime=0,systemRevision=0,revision=0,epoch=0,system=false,systemReady=true,manual=false,storage='browser',mode='available',raw=null,active=true,scenario='ready';
 const listeners=new Set();
 function snapshot(){const reducedMotion=resolveReducedMotion(system,manual);const preferenceReady=systemReady&&storage!=='loading';return Object.freeze({systemReducedMotion:system,manualReducedMotion:manual,reducedMotion,preferenceReady,preferenceStorage:storage,active,epoch,lifetime,revision,scenario,savedRaw:raw,mode,enabled:alive&&active&&preferenceReady&&!reducedMotion,canChange:alive&&preferenceReady&&system===false});}
 function publish(){const own=++revision;const state=snapshot();for(const registration of [...listeners]){if(!alive||revision!==own)break;if(listeners.has(registration))registration.fn(state);}}
 function readMemory(){manual=mode==='read-fail'||mode==='native'?false:readStoredReducedMotion(raw);storage=mode==='read-fail'||mode==='native'?'session':'browser';}
 function configure(id){if(!alive||!Object.hasOwn(cases,id))return false;const c=cases[id];lifetime++;systemRevision++;epoch++;scenario=id;system=c.system;systemReady=c.systemReady!==false;mode=c.mode;active=true;raw=null;readMemory();publish();return true;}
 function setManual(value){if(!snapshot().canChange||typeof value!=='boolean')return false;manual=value;if(mode==='available'){raw=value?'1':null;storage='browser';}else storage='session';publish();return true;}
 function reload(){if(!alive)return false;lifetime++;epoch++;readMemory();publish();return true;}
 function externalStorage(event){if(!alive||mode==='native'||mode==='read-fail'||!event||(event.key!==motionPreferenceStorageKey&&event.key!==null)||event.storageArea!=='same')return false;raw=event.newValue;manual=readStoredReducedMotion(event.newValue);publish();return true;}
 function systemEvent(value){if(!alive||typeof value!=='boolean')return false;systemRevision++;system=value;systemReady=true;publish();return true;}
 function initialRequest(){return Object.freeze({lifetime,revision:systemRevision});}
 function resolveInitial(token,value){if(!token||typeof value!=='boolean'||token.lifetime!==lifetime||!canApplyInitialPreference(alive,token.revision,systemRevision))return false;system=value;systemReady=true;publish();return true;}
 function setActive(value){if(!alive||typeof value!=='boolean')return false;active=value;epoch++;publish();return true;}
 function resize(){if(!alive)return false;epoch++;publish();return true;}
 function subscribe(fn){if(!alive)return ()=>{};const registration={fn};listeners.add(registration);return ()=>listeners.delete(registration);}
 function dispose(){if(!alive)return;alive=false;lifetime++;revision++;listeners.clear();}
 return {snapshot,subscribe,setManual,configure,reload,externalStorage,systemEvent,initialRequest,resolveInitial,setActive,resize,dispose};
}
