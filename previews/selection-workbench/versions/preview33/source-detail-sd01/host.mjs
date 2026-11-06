import {READ_ERROR_TAGS,readError} from './model.mjs';
const bindingKeys=['serverKey','userId','childId','scopeKey','authorityKey'];
const keys=(o,names)=>o&&Object.keys(o).length===names.length&&names.every(k=>Object.hasOwn(o,k));
const str=(x,max=64000)=>typeof x==='string'&&x.length<=max&&!/[\u0000\uD800-\uDFFF]/u.test(x);
const nonempty=x=>str(x,1000)&&!!x.trim();
const nullable=(x,check)=>x===null||check(x);
const version=x=>Number.isInteger(x)&&x>=1&&x<=2147483647;
function date(x){
 if(!str(x,80)||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(x)||!Number.isFinite(Date.parse(x)))return false;
 const year=Number(x.slice(0,4)),month=Number(x.slice(5,7)),day=Number(x.slice(8,10)),last=new Date(0);last.setUTCFullYear(year,month,0);
 return month>=1&&month<=12&&day>=1&&day<=last.getUTCDate()&&Number(x.slice(11,13))<24&&Number(x.slice(14,16))<60&&Number(x.slice(17,19))<60;
}
function classified(error){
 try{const tag=error&&Object.getOwnPropertyDescriptor(Object(error),'tag')?.value;return readError(tag);}catch{return readError('transport');}
}
const bool=x=>typeof x==='boolean';
const one=(x,values)=>values.includes(x);
function jsonData(value,ancestors=new Set(),depth=0){
 if(depth>30)return false;
 if(value===null||typeof value==='string'||typeof value==='boolean')return true;
 if(typeof value==='number')return Number.isFinite(value);
 if(typeof value!=='object'||ancestors.has(value))return false;
 if(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype)return false;
 const ds=Object.getOwnPropertyDescriptors(value);if(Reflect.ownKeys(ds).some(k=>typeof k!=='string'||!('value' in ds[k])))return false;
 if(Array.isArray(value))for(let i=0;i<value.length;i++)if(!Object.hasOwn(ds,i))return false;
 ancestors.add(value);const ok=Object.values(ds).every(d=>jsonData(d.value,ancestors,depth+1));ancestors.delete(value);return ok;
}
const copy=x=>JSON.parse(JSON.stringify(x));
function freeze(x){if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;}
const immutable=x=>freeze(copy(x));
function management(m){return m===null||keys(m,['intention','purpose','nature','timeScope','validityText','enabled','modelExcerpt'])&&str(m.intention,1000)&&one(m.purpose,['answer_reference','record_candidate','track_topic'])&&one(m.nature,['unspecified','external_material','claimed_official','personal_observation'])&&one(m.timeScope,['unspecified','long_reference','recent','specific_period'])&&str(m.validityText,300)&&(m.timeScope!=='specific_period'||!!m.validityText.trim())&&bool(m.enabled)&&nullable(m.modelExcerpt,x=>str(x,6000));}
function candidate(c){return c===null||c&&str(c.text)&&str(c.rawValue,1000)&&str(c.unit,1000)&&bool(c.approximate)&&str(c.timeRaw,1000)&&Array.isArray(c.uncertainties)&&c.uncertainties.length<=50&&c.uncertainties.every(x=>str(x,1000));}
function validSource(v,b,target){
 return keys(v,['id','childId','ownerUserId','version','createdAt','canManage','kind','sourceNotes','sourceId','sourceLabel','sourceUrl','sourceDateText','text','sha256','retrievedAt','fetchState','extraction','recordId','confirmationKind','management'])&&v.id===target&&v.childId===b.childId&&v.ownerUserId===b.userId&&version(v.version)&&date(v.createdAt)&&bool(v.canManage)&&one(v.kind,['paste','public_source','personal_source'])&&str(v.sourceNotes,1000)&&nullable(v.sourceId,nonempty)&&((v.kind==='public_source')===(v.sourceId!==null))&&str(v.sourceLabel,200)&&!!v.sourceLabel.trim()&&nullable(v.sourceUrl,x=>str(x,1000))&&nullable(v.sourceDateText,x=>str(x,200))&&str(v.text)&&nullable(v.sha256,x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x))&&nullable(v.retrievedAt,date)&&one(v.fetchState,['not_requested','running','ready','failed','unknown'])&&keys(v.extraction,['state','runId','excerpt','draft','stopReason','processedAt','model'])&&one(v.extraction.state,['not_requested','running','available','failed','unknown'])&&nullable(v.extraction.runId,nonempty)&&nullable(v.extraction.excerpt,x=>str(x,10000))&&candidate(v.extraction.draft)&&nullable(v.extraction.stopReason,x=>str(x,200))&&nullable(v.extraction.processedAt,date)&&nullable(v.extraction.model,x=>str(x,200))&&nullable(v.recordId,nonempty)&&one(v.confirmationKind,[null,'reference','family_record'])&&((v.recordId===null)===(v.confirmationKind===null))&&management(v.management);
}
function validOperation(o){
 if(keys(o,['state'])&&o.state==='none')return true;
 if(!keys(o,['state','origin','reference','kind','basis'])||o.state!=='unknown'||!nonempty(o.reference)||!keys(o.basis,['sourceId','version']))return false;
 if(o.origin==='owner_pending'&&!one(o.kind,['create','confirm','delete','manage'])||o.origin==='owner_direct'&&!one(o.kind,['fetch','extract'])||!one(o.origin,['owner_pending','owner_direct']))return false;
 return o.kind==='create'&&o.basis.sourceId===null&&o.basis.version===null||nonempty(o.basis.sourceId)&&version(o.basis.version);
}
function validInput(i){
 try{return jsonData(i)&&keys(i,['binding','authority','allowedTargetId','blockers','operationProjection','source'])&&keys(i.binding,bindingKeys)&&bindingKeys.every(k=>nonempty(i.binding[k]))&&keys(i.authority,['online','role','privateRead','ownerReady'])&&bool(i.authority.online)&&one(i.authority.role,['viewer','non_viewer',null])&&bool(i.authority.privateRead)&&bool(i.authority.ownerReady)&&nullable(i.allowedTargetId,nonempty)&&keys(i.blockers,['pending','direct','conflict'])&&Object.values(i.blockers).every(bool)&&validOperation(i.operationProjection)&&(i.source===null||keys(i.source,['value','freshness'])&&one(i.source.freshness,['fresh','stale'])&&i.authority.role!==null&&i.authority.privateRead&&i.allowedTargetId!==null&&validSource(i.source.value,i.binding,i.allowedTargetId));}catch{return false;}
}
function validHistory(h){
 try{return jsonData(h)&&keys(h,['revisions','hasMore'])&&Array.isArray(h.revisions)&&h.revisions.length<=20&&bool(h.hasMore)&&(!h.hasMore||h.revisions.length===20)&&h.revisions.every((r,i)=>keys(r,['version','changedAt','reason','management'])&&version(r.version)&&(!i||r.version<h.revisions[i-1].version)&&date(r.changedAt)&&str(r.reason,500)&&!!r.reason.trim()&&management(r.management));}catch{return false;}
}
const sameOperation=(a,b)=>a.state===b.state&&a.origin===b.origin&&a.reference===b.reference&&a.kind===b.kind&&a.basis.sourceId===b.basis?.sourceId&&a.basis.version===b.basis?.version;
const sameBinding=(a,b)=>bindingKeys.every(k=>a[k]===b[k]);
const readState=(load='idle',extra={})=>({load,errorTag:null,fresh:false,requestId:null,sourceId:null,...extra});
const emptyHistory=(load='idle')=>({...readState(load),requestedSourceId:null,requestedBasisVersion:null,revisions:[],hasMore:false});
export function createSourceDetailHost({input:initial,ports}){
 if(!validInput(initial))throw new TypeError('Invalid synthetic Input');
 if(!ports||typeof ports.readSource!=='function'||typeof ports.readHistory!=='function')throw new TypeError('Synthetic read ports required');
 let input=immutable(initial),alive=true,lifetime=1,inputRevision=1,publicationRevision=1,requestId=0,slot=null,denied=false;
 let source=input.source?.value??null;
 let presentation={mode:'A',panel:'original',selectedRevisionVersion:null,disclosures:{technical:false,candidate:false},presentationEpoch:1};
 let detail=source?readState('ready',{sourceId:source.id,fresh:input.source.freshness==='fresh'}):readState();
 let history=emptyHistory(),historyHasData=false;
 const registrations=new Set(),tickets=new WeakMap();
 const authorized=()=>alive&&input.authority.privateRead&&input.authority.role!==null&&!denied;
 const visible=()=>authorized()&&source!==null;
 if(!authorized()){detail=readState('denied');history=emptyHistory('denied');}
 function snapshot(){
  if(!alive)return Object.freeze({alive,lifetime,inputRevision,publicationRevision});
  return immutable({alive,lifetime,inputRevision,publicationRevision,context:{binding:input.binding,authority:input.authority,allowedTargetId:input.allowedTargetId,blockers:input.blockers},source:visible()?source:null,operationProjection:authorized()?input.operationProjection:{state:'none'},detailRead:detail,historyRead:history,currentPresentation:presentation,busy:slot!==null});
 }
 function publish(revision){
  if(!alive||revision!==publicationRevision)return;
  const s=snapshot(),entries=[...registrations];
  for(const r of entries){if(!alive||revision!==publicationRevision)break;if(registrations.has(r)){try{r.listener(s);}catch{/* Consumer failure cannot undo committed state. */}}}
 }
 function commit(){publicationRevision++;publish(publicationRevision);}
 function validTicket(t){const v=t&&tickets.get(t);return alive&&v&&v.lifetime===lifetime&&v.inputRevision===inputRevision&&v.epoch===presentation.presentationEpoch;}
 function prunePresentation(){
  let next={...presentation,disclosures:{...presentation.disclosures}};
  if(!visible()){next.selectedRevisionVersion=null;next.disclosures={technical:false,candidate:false};}
  else {if(!history.revisions.some(r=>r.version===next.selectedRevisionVersion))next.selectedRevisionVersion=null;if(!source.extraction.draft)next.disclosures.candidate=false;}
  if(JSON.stringify(next)!==JSON.stringify(presentation))next.presentationEpoch++;
  presentation=next;
 }
 function replaceInput(next){
  if(!alive||!validInput(next))return false;
  const bindingSame=sameBinding(input.binding,next.binding),old=input.operationProjection;
  if(bindingSame&&old.state==='unknown'&&(!sameOperation(old,next.operationProjection)||input.blockers.pending&&!next.blockers.pending||input.blockers.direct&&!next.blockers.direct))return false;
  const wasVisible=visible(),hard=!bindingSame||input.authority.role!==next.authority.role||input.authority.privateRead!==next.authority.privateRead||input.allowedTargetId!==next.allowedTargetId;
  const keep=bindingSame&&input.allowedTargetId===next.allowedTargetId&&wasVisible&&next.authority.privateRead&&next.authority.role!==null&&next.source!==null;
  const retired=slot;slot=null;input=immutable(next);inputRevision++;if(hard)lifetime++;denied=false;source=input.source?.value??null;
  detail=!authorized()?readState('denied'):source?readState('ready',{sourceId:source.id,fresh:input.source.freshness==='fresh'}):readState();
  if(!keep)historyHasData=false;
  history=keep?{...history,load:historyHasData?'ready':'idle',fresh:false,errorTag:null}:emptyHistory(authorized()?'idle':'denied');
  prunePresentation();publicationRevision++;const revision=publicationRevision;
  retired?.controller.abort();
  publish(revision);return true;
 }
 function requestCurrent(q){return alive&&slot===q&&!q.controller.signal.aborted&&q.lifetime===lifetime&&q.inputRevision===inputRevision&&sameBinding(q.binding,input.binding)&&q.target===input.allowedTargetId&&(q.kind!=='history'||visible()&&source.id===q.target&&source.version===q.basisVersion);}
 function finish(q,value,error){
  if(!requestCurrent(q))return;
  let tag=error?READ_ERROR_TAGS.includes(error.tag)?error.tag:'transport':null;
  if(!tag){let ok=false;try{ok=q.kind==='history'?validHistory(value):jsonData(value)&&validSource(value,q.binding,q.target);}catch{}if(!ok)tag='malformed';}
  if(!requestCurrent(q))return;
  slot=null;
  if(!tag){
   if(q.kind==='detail'){source=immutable(value);detail=readState('ready',{fresh:true,requestId:q.id,sourceId:q.target});}
   else {history={...immutable(value),...readState('ready',{fresh:true,requestId:q.id,sourceId:q.target}),requestedSourceId:q.target,requestedBasisVersion:q.basisVersion};historyHasData=true;}
  }else if(tag==='not_found'||tag==='denied'){
   source=null;historyHasData=false;denied=tag==='denied';const load=denied?'denied':'unavailable';detail=readState(load,{errorTag:tag});history={...emptyHistory(load),errorTag:tag};
  }else if(q.kind==='detail')detail={...detail,load:tag==='cancelled'&&!source?'idle':'error',fresh:false,errorTag:tag};
  else history={...history,load:tag==='cancelled'&&!historyHasData?'idle':'error',fresh:false,errorTag:tag};
  prunePresentation();commit();
 }
 function read(kind,target,t){
  if(!validTicket(t)||!authorized()||target===null||target!==input.allowedTargetId||!input.authority.online||!input.authority.ownerReady||Object.values(input.blockers).some(Boolean)||slot||kind==='history'&&(!visible()||!detail.fresh))return false;
  const q={kind,id:++requestId,lifetime,inputRevision,binding:input.binding,target,basisVersion:kind==='history'?source.version:null,controller:new AbortController()};slot=q;
  if(kind==='detail')detail={...detail,load:'loading',errorTag:null,requestId:q.id,sourceId:target};
  else history={...history,load:'loading',errorTag:null,requestId:q.id,sourceId:target,requestedSourceId:target,requestedBasisVersion:q.basisVersion};
  commit();if(!requestCurrent(q))return true;
  let result;try{result=kind==='detail'?ports.readSource({binding:q.binding,targetId:target,requestId:q.id,signal:q.controller.signal}):ports.readHistory({binding:q.binding,sourceId:target,basisVersion:q.basisVersion,requestId:q.id,signal:q.controller.signal});}catch(e){finish(q,null,classified(e));return true;}
  Promise.resolve(result).then(value=>finish(q,value,null),error=>finish(q,null,classified(error)));return true;
 }
 function present(t,change){if(!validTicket(t))return false;const next=change();if(!next)return false;presentation={...next,presentationEpoch:presentation.presentationEpoch+1};commit();return true;}
 const host=Object.freeze({
  snapshot,
  subscribe(listener){if(!alive||typeof listener!=='function')return ()=>{};const r={listener};registrations.add(r);return ()=>registrations.delete(r);},
  ticket(){if(!alive)return null;const t=Object.freeze({});tickets.set(t,{lifetime,inputRevision,epoch:presentation.presentationEpoch});return t;},
  readSource:(target,t)=>read('detail',target,t),readHistory:t=>read('history',input?.allowedTargetId??null,t),
  setMode:(mode,t)=>present(t,()=>one(mode,['A','B'])&&mode!==presentation.mode?{...presentation,mode}:null),
  setPanel:(panel,t)=>present(t,()=>visible()&&one(panel,['original','history'])&&panel!==presentation.panel?{...presentation,panel}:null),
  selectRevision:(v,t)=>present(t,()=>visible()&&history.revisions.some(r=>r.version===v)&&(presentation.selectedRevisionVersion!==v||presentation.panel!=='history')?{...presentation,selectedRevisionVersion:v,panel:'history'}:null),
  setDisclosure:(name,open,t)=>present(t,()=>visible()&&one(name,['technical','candidate'])&&bool(open)&&(name!=='candidate'||source.extraction.draft)&&presentation.disclosures[name]!==open?{...presentation,disclosures:{...presentation.disclosures,[name]:open}}:null),
  dispose(){if(!alive)return false;alive=false;const retired=slot;slot=null;publicationRevision++;source=null;history=null;historyHasData=false;detail=null;presentation=null;input=null;registrations.clear();retired?.controller.abort();return true;}
 });
 return Object.freeze({host,control:Object.freeze({replaceInput})});
}
