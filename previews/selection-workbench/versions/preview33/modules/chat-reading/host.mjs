// A new deterministic preview host, NOT ChatController or a production adapter.
const BINDING_KEYS=['identityKey','scopeKey','sessionGeneration','userId','childId','privateScope','lifetimeId'];
let hostSequence=0;
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
function validate(rows,binding){
 if(!Array.isArray(rows))throw Error('invalid rows');
 const ids=new Set();let last=-Infinity;
 for(const r of rows){
  if(!r||typeof r.id!=='string'||!r.id||ids.has(r.id))throw Error('invalid duplicate or missing message ID');
  if(typeof r.bodyRevision!=='string'||!r.bodyRevision||typeof r.text!=='string')throw Error('invalid body/revision');
  if(r.childId!==binding.childId||!['user','model'].includes(r.role)||(r.role==='user'?r.authorUserId!==binding.userId:r.authorUserId!==null))throw Error('invalid row scope/author');
  if(!(r.inReplyTo===null||typeof r.inReplyTo==='string')||(r.agentRunId!==undefined&&typeof r.agentRunId!=='string'))throw Error('invalid relation/run');
  if(typeof r.createdAt!=='string'||(r.citations!==undefined&&!Array.isArray(r.citations)))throw Error('invalid time/citation shape');
  const t=Date.parse(r.createdAt);if(!Number.isFinite(t)||t<last)throw Error('invalid chronology');last=t;ids.add(r.id);
 }
}
export function createHost(initial){
 const instance=++hostSequence;let lifetime=0,revision=0,ticketSequence=0,disposed=false,s;
 const listeners=new Set();let consumedCursors=new Set();
 function emit(patch){
  s=freeze({...s,...patch,revision:++revision});
  const snap=s;
  for(const registration of [...listeners]){if(disposed||s!==snap)break;if(listeners.has(registration))registration.fn(snap);}
 }
 function project(patch={}){
  const next={...s,...patch};
  const reason=!next.authorizedVisible?'revoked':!next.online?'offline':next.pending?'busy':null;
  emit({...patch,loadedCount:next.rows.length,totalCount:null,offlineStale:!next.online&&next.rows.length>0,
   confirmedEmpty:next.authorizedVisible&&next.online&&!!next.loadedAt&&!next.rows.length&&!next.cursor&&!next.pending&&!next.error,
   readAvailability:{reload:reason,older:reason||(!next.cursor?'no-cursor':null)}});
 }
 function replaceContext(f){
  if(disposed)return false;
  const b={...f.binding,lifetimeId:`ch01-${instance}-${++lifetime}`};
  for(const key of BINDING_KEYS)if(b[key]===undefined)throw Error('invalid binding '+key);
  validate(f.rows,b);
  consumedCursors=new Set();
  const visible=f.authorizedVisible!==false&&b.privateScope===true;
  project({binding:freeze(b),authorizedVisible:visible,online:f.online!==false,rows:visible?freeze(structuredClone(f.rows)):freeze([]),cursor:visible?(f.cursor??null):null,pageLimit:f.pageLimit??6,loadedAt:f.loadedAt??null,pending:null,outcome:'ready',error:null,newReplyId:null,unknownNotice:visible?(f.unknownNotice??null):null});
  return true;
 }
 const matches=b=>!disposed&&b&&BINDING_KEYS.every(k=>b[k]===s.binding[k]);
 function request(kind,b,cursor){
  if(!matches(b))return freeze({accepted:false,reason:'retired'});
  const reason=s.readAvailability[kind];if(reason)return freeze({accepted:false,reason});
  if(kind==='older'&&cursor!==s.cursor)return freeze({accepted:false,reason:'stale-cursor'});
  const ticket=freeze({id:++ticketSequence,kind,binding:s.binding,cursor:s.cursor});
  project({pending:ticket,outcome:'pending',error:null,newReplyId:null});
  return matches(b)?freeze({accepted:true,ticket}):freeze({accepted:false,reason:'retired'});
 }
 function settle(ticket,result){
  if(disposed||s.pending!==ticket||!matches(ticket?.binding)||!s.authorizedVisible)return false;
  if(result?.error){project({pending:null,outcome:'failed',error:String(result.error)});return true;}
  try{
   if(!result||!(result.cursor===null||typeof result.cursor==='string')||!Number.isInteger(result.limit)||result.limit<1)throw Error('invalid page');
   validate(result.rows,s.binding);
   if(ticket.kind==='older'&&result.cursor===ticket.cursor){
    if(result.rows.length)throw Error('invalid nonadvancing cursor');
    project({pending:null,outcome:'no-progress',error:null});return true;
   }
   if(ticket.kind==='older'&&result.cursor!==null&&consumedCursors.has(result.cursor))throw Error('invalid cursor cycle');
   for(const row of result.rows){const old=s.rows.find(r=>r.id===row.id);if(old&&old.bodyRevision===row.bodyRevision&&old.text!==row.text)throw Error('invalid unchanged body revision');}
   let rows,cursor;
   if(ticket.kind==='older'){rows=[...result.rows,...s.rows];cursor=result.cursor;}
   else{
    const incoming=new Set(result.rows.map(r=>r.id));
    const retain=s.rows.length>result.limit&&s.rows.some(r=>incoming.has(r.id));
    rows=retain?[...s.rows.filter(r=>!incoming.has(r.id)),...result.rows]:result.rows;
    cursor=retain?s.cursor:result.cursor;
   }
   validate(rows,s.binding);
   if(ticket.kind==='older')consumedCursors.add(ticket.cursor);else if(cursor===result.cursor)consumedCursors=new Set();
   project({rows:freeze(structuredClone(rows)),cursor,pending:null,outcome:'success',error:null,newReplyId:null,
    ...(ticket.kind==='reload'?{pageLimit:result.limit,loadedAt:'2026-11-05T10:05:00.000Z'}:{})});
  }catch(error){project({pending:null,outcome:'invalid',error:error.message});}
  return true;
 }
 replaceContext(initial);
 return Object.freeze({getSnapshot:()=>s,binding:()=>s.binding,isCurrent:matches,
  subscribe(fn){const registration={fn};listeners.add(registration);return()=>listeners.delete(registration);},
  requestOlder:(b,cursor)=>request('older',b,cursor),requestReload:b=>request('reload',b),settle,
  setOnline(value){if(!disposed)project({online:!!value});},replaceContext,
  revoke(){if(!disposed)replaceContext({...s,binding:s.binding,rows:[],authorizedVisible:false});},
  dispose(){disposed=true;listeners.clear();}
 });
}
