import {readFixture,SCENARIOS} from './fixtures.mjs';
import {concernKey,filterConcerns,filterEntries} from './model.mjs';
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const v of Object.values(value))freeze(v);Object.freeze(value)}return value};
const caseDefaults=()=>({q:'',status:'following',from:'',to:''});
const trackDefaults=()=>({q:'',status:'all',kind:'all',from:'',to:'',time:'all'});
// This owns only a disposable synthetic reading window. It cannot send a domain command.
export function createHost({read=readFixture,identity='a',scenario='normal'}={}){
 let epoch=0,listeners=new Set();
 let state=freeze({identity,scenario,generation:0,layout:'folio',page:null,selected:null,returnRow:null,load:'idle',online:true,disposed:false,caseFilter:caseDefaults(),trackFilter:trackDefaults()});
 const update=patch=>{if(state.disposed)return;state=freeze({...state,...patch});for(const fn of [...listeners])fn(state)};
 const selectAllowed=key=>state.page&&filterConcerns(state.page,state.page.childId,state.caseFilter).some(c=>concernKey(c)===key);
 async function load(){
  if(state.disposed||!state.online)return;
  const ticket=++epoch,current=state,generation=state.generation;
  update({load:'loading'});
  try{
   const page=await read({identity:current.identity,scenario:current.scenario});
   if(state.disposed||ticket!==epoch||generation!==state.generation)return;
   if(!page?.synthetic||page.childId!==`synthetic-child-${state.identity}`){update({load:'denied',page:null,selected:null,returnRow:null});return}
   // Fixture state demonstrations; not evidence that a real API was called or failed.
   const snapshot=freeze(structuredClone(page));
   const rows=filterConcerns(snapshot,page.childId,state.caseFilter);
   const selected=state.selected&&rows.some(c=>concernKey(c)===state.selected)?state.selected:!current.page&&rows.length?concernKey(rows[0]):null;
   update({page:snapshot,selected,load:state.scenario==='stale'?'error':'ready',online:state.scenario!=='offline'});
  }catch(error){
   if(state.disposed||ticket!==epoch||generation!==state.generation)return;
   if(error?.code==='denied')update({load:'denied',page:null,selected:null,returnRow:null});
   else update({load:'error'});
  }
 }
 function reset(patch){++epoch;update({...patch,generation:state.generation+1,page:null,selected:null,returnRow:null,load:'idle',online:true,caseFilter:caseDefaults(),trackFilter:trackDefaults()});return load()}
 return{
  getSnapshot:()=>state,
  subscribe(fn){if(state.disposed)return()=>{};listeners.add(fn);return()=>listeners.delete(fn)},
  load,
  setIdentity(value){if(!['a','b'].includes(value)||state.disposed)return Promise.resolve();return reset({identity:value})},
  setScenario(value){if(!SCENARIOS.some(([id])=>id===value)||state.disposed)return Promise.resolve();return reset({scenario:value})},
  setOnline(online){if(!online)++epoch;update({online,load:state.load==='loading'?'idle':state.load})},
  setLayout(layout){if(['folio','track'].includes(layout))update({layout,returnRow:null})},
  setCaseFilter(patch){const filter={...state.caseFilter,...patch};update({caseFilter:filter});if(state.selected&&!selectAllowed(state.selected))update({selected:null,returnRow:null})},
  setTrackFilter(patch){update({trackFilter:{...state.trackFilter,...patch},returnRow:null})},
  selectCase(key){if(selectAllowed(key))update({selected:key})},
  closeCase(){update({selected:null,returnRow:null})},
  openFromTrack(key){if(!state.page)return;const row=filterEntries(state.page,state.page.childId,state.trackFilter).find(r=>r.key===key);if(row)update({layout:'folio',caseFilter:{...caseDefaults(),status:'all'},selected:row.concernKey,returnRow:key})},
  backToTrack(){if(!state.returnRow||!state.page)return null;const key=state.returnRow;const exists=filterEntries(state.page,state.page.childId,state.trackFilter).some(r=>r.key===key);update({layout:'track',returnRow:null});return exists?key:null},
  destroy(){if(state.disposed)return;++epoch;listeners.clear();state=freeze({...state,disposed:true,page:null,selected:null,returnRow:null})}
 };
}
