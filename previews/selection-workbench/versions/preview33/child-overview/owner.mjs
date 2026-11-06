import { readChildProfile, authorizedChildMeasurements, childProfileAgeLabel } from './source-overview.mjs';
import { fixture } from './fixtures.mjs';
const copy=value=>structuredClone(value);
export function createOwner({schedule=fn=>setTimeout(fn,650),readProvider=null}={}){
 let child='a',env=fixture(child),epoch=1,publication=0,readGeneration=0,live=true,nav=null;
 const listeners=new Set();
 const token=()=>({epoch,scopeKey:env.scopeKey});
 const current=t=>live&&t?.epoch===epoch&&t.scopeKey===env.scopeKey;
 function projection(){
  const model=env.model,reading=readChildProfile(model,env.scopeKey,env.today,env.profileSource);
  const measurements=authorizedChildMeasurements(env.measurements,env.scopeKey,model);
  const pending=['unknown','saving'].includes(model?.operation.state);
  const accessible=!!model&&model.access!=='lost';
  return {scopeKey:env.scopeKey,childChoice:child,childId:accessible?model?.child?.id??null:null,name:accessible?model?.child?.name??'孩子概況':'孩子概況',reading,measurements,age:childProfileAgeLabel(reading.data,env.today),pending,operation:model?.operation.state??'none',online:model?.online??false,needsRefresh:model?.needsRefresh??false,loading:model?.reading??true,revision:reading.data?model.current:null,scenario:env.scenario,today:env.today,epoch,publication,canRefresh:accessible&&!!model.child&&model.online&&!model.reading&&!pending,canProfile:accessible,canHistory:accessible&&!!model.child&&model.online&&!model.reading&&!pending,lastKnown:['expired','validity_unknown'].includes(reading.state)||model?.needsRefresh||model?.online===false,nav};
 }
 function allowed(target,p=projection()){
  if(target.kind==='profile')return p.canProfile;
  if(target.kind==='history')return p.canHistory;
  if(target.kind==='measurement')return p.measurements?.state==='ready'&&['height','weight'].some(k=>{const f=p.measurements[k];return f&&f.recordId===target.recordId&&f.state!=='source_invalidated';});
  return false;
 }
 function snapshot(){const p=projection();if(p.nav&&!allowed(p.nav,p))p.nav=null;return copy(p);}
 function emit(){publication++;if(nav&&!allowed(nav))nav=null;for(const listener of [...listeners]){if(!live)break;listener(snapshot());}}
 function replace(scenario,nextChild=child){if(!live)return false;child=nextChild;epoch++;readGeneration++;nav=null;env=fixture(child,scenario);emit();return true;}
 function refresh(){
  if(!live||!projection().canRefresh)return false;
  const t=token(),g=++readGeneration,previous=copy(env);
  env.model.reading=true;emit();
  schedule(()=>{
   if(!current(t)||g!==readGeneration)return;
   let incoming;
   try{incoming=readProvider?readProvider(copy(previous)):fixture(child,previous.scenario==='optional'?'optional':'confirmed');}
   catch {if(!current(t)||g!==readGeneration)return;env.model.reading=false;env.model.needsRefresh=true;env.profileSource.state='unavailable';emit();return;}
   if(!current(t)||g!==readGeneration)return;
   if(!incoming||incoming.scopeKey!==env.scopeKey||incoming.model?.child?.id!==env.model.child.id){env.model.reading=false;env.model.needsRefresh=true;env.profileSource.state='unavailable';emit();return;}
   env=copy(incoming);env.model.reading=false;emit();
  });return true;
 }
 return {snapshot,token,current,subscribe(fn){if(!live)return()=>{};listeners.add(fn);return()=>listeners.delete(fn);},refresh,
  setScenario(name){return replace(name);},switchChild(id){return ['a','b'].includes(id)?replace('confirmed',id):false;},
  completeCold(){if(!live||env.scenario!=='cold')return false;return replace('confirmed');},
  navigate(target,t){if(!current(t)||!allowed(target))return false;nav=copy(target);emit();return true;},
  back(t){if(!current(t)||!nav)return false;nav=null;emit();return true;},
  dispose(){if(!live)return;live=false;epoch++;readGeneration++;nav=null;listeners.clear();}
 };
}
