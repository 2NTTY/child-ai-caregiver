// NP01: an in-memory contract demonstrator. No transport, credentials or storage.
export const DEFAULTS=Object.freeze({timeZone:'Asia/Hong_Kong',quietStart:'22:00',quietEnd:'08:00',allowAppointmentDuringQuiet:false});
export const FIELDS=Object.freeze(['quietStart','quietEnd','timeZone','allowAppointmentDuringQuiet']);
export const ZONES=Object.freeze([
 ['Asia/Hong_Kong','香港時間'],['UTC','協調世界時間（UTC）'],['Asia/Taipei','台北時間'],['Asia/Tokyo','東京時間'],
 ['Asia/Singapore','新加坡時間'],['Europe/London','倫敦時間'],['America/New_York','紐約時間'],['Australia/Sydney','悉尼時間']
].map(Object.freeze));
const clone=v=>structuredClone(v);
const values=p=>Object.fromEntries(FIELDS.map(k=>[k,p[k]]));
const equal=(a,b)=>FIELDS.every(k=>a[k]===b[k]);
const basis=p=>p?JSON.stringify([p.version,p.timeZone,p.quietStart,p.quietEnd,p.allowAppointmentDuringQuiet]):'null';
const hhmm=v=>typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v);
export function validate(v){
 const e={};
 if(!hhmm(v.quietStart))e.quietStart='請填 HH:mm，例如 22:00。';
 if(!hhmm(v.quietEnd))e.quietEnd='請填 HH:mm，例如 08:00。';
 else if(v.quietStart===v.quietEnd)e.quietEnd='開始及結束時間須不同。';
 try{if(typeof v.timeZone!=='string'||v.timeZone.length>100)throw Error();new Intl.DateTimeFormat('en',{timeZone:v.timeZone});}catch{e.timeZone='請選有效的 IANA 時區。';}
 if(typeof v.allowAppointmentDuringQuiet!=='boolean')e.allowAppointmentDuringQuiet='請選擇是否開啟預約例外。';
 return e;
}
export function clockSegments(start,end){
 if(!hhmm(start)||!hhmm(end)||start===end)return null;
 const m=s=>Number(s.slice(0,2))*60+Number(s.slice(3));const a=m(start),b=m(end);
 return a<b?[{from:a,to:b}]:[{from:0,to:b},{from:a,to:1440}].filter(x=>x.from<x.to);
}
const validPreferences=p=>p&&Object.keys(validate(p)).length===0&&Number.isSafeInteger(p.version)&&p.version>=0;
const validContext=c=>!!c&&typeof c.userId==='string'&&c.userId.length>0&&typeof c.serverKey==='string'&&c.serverKey.length>0&&Number.isSafeInteger(c.sessionGeneration)&&c.sessionGeneration>=0;
const identity=c=>validContext(c)?JSON.stringify([c.serverKey,c.userId,c.sessionGeneration]):null;
export function createHost({context,preferences=null}={}){
 let alive=true,ctx={...context},lifetime=1,revision=0,serial=0,opSerial=0;
 let saved=validContext(ctx)&&ctx.admitted&&!ctx.shared&&validPreferences(preferences)?clone(preferences):null;
 let draft=saved?values(saved):{...DEFAULTS},draftBase={...draft},fresh=!!saved;
 let review=null,original=null,request=null,errors={},notice='合成偏好已讀取。',layout='A',step=0,child=null,dispatches=0,canWrite=true;
 const listeners=new Set();
 const available=()=>alive&&validContext(ctx)&&ctx.online===true&&ctx.admitted===true&&ctx.shared!==true;
 const dirty=()=>!equal(draft,draftBase);
 const locked=()=>!available()||!fresh||!!request||!!original;
 const snap=()=>clone({alive,context:ctx,lifetime,revision,preferences:saved,draft,dirty:dirty(),fresh,review,original,request,errors,notice,layout,step,child,dispatches,available:available(),locked:locked(),canWrite,
  phase:request?(request.kind==='read'?'reading':'saving'):original?(original.confirmed?'confirmed-read-pending':'unknown'):!available()?'unavailable':!fresh?'stale':'ready'});
 function emit(){const own=++revision,s=snap();for(const entry of [...listeners]){if(own!==revision||!alive)break;if(entry.active)entry.fn(s);}}
 function clear(){saved=null;draft={...DEFAULTS};draftBase={...draft};fresh=false;review=null;original=null;request=null;errors={};step=0;}
 function publishPreferences(p){
  const oldBasis=basis(saved);saved=clone(p);fresh=true;
  if(oldBasis!==basis(saved)){if(review||dirty())notice='目前偏好已改變；原核對失效，草稿仍待重新核對。';review=null;}
  if(!dirty()||equal(draft,p)){draft=values(p);draftBase={...draft};errors={};}
 }
 function start(kind){
  if(!available()||request)return false;
  request={serial:++serial,lifetime,kind,scope:{serverKey:ctx.serverKey,userId:ctx.userId,sessionGeneration:ctx.sessionGeneration}};return true;
 }
 const api={
  snapshot:snap,
  subscribe(fn){const e={fn,active:true};listeners.add(e);return()=>{e.active=false;listeners.delete(e);};},
  edit(field,value){if(locked()||!FIELDS.includes(field)||draft[field]===value)return;draft={...draft,[field]:value};review=null;if(Object.keys(errors).length)errors=validate(draft);emit();},
  setLayout(next){if(!alive||!['A','B'].includes(next)||next===layout)return;layout=next;emit();},
  setStep(next){if(!alive||!Number.isInteger(next)||next<0||next>2||step===next)return;step=next;emit();},
  setChild(next){if(!alive||child===next)return;child=next;emit();},
  setWriteAdmission(next){if(!alive)return;canWrite=!!next;emit();},
  stageReview(){if(locked())return;errors=validate(draft);if(!Object.keys(errors).length&&saved){review={values:clone(draft),expectedVersion:saved.version,basis:basis(saved)};notice='核對草稿，尚未保存。';}emit();},
  closeReview(){if(!alive||!review)return;review=null;emit();},
  save(){
   if(!alive||!review)return;
   const r=review;review=null;
   if(locked()||!canWrite||r.basis!==basis(saved)||r.expectedVersion!==saved?.version){notice='保存未獲接納；請核對目前狀態。';emit();return;}
   if(!start('save')){emit();return;}
   original={id:`np01-synthetic-${++opSerial}`,input:{...r.values,expectedVersion:r.expectedVersion},confirmed:false,reviewed:false,consent:false};dispatches++;notice='合成保存處理中；尚未確認。';emit();
  },
  refresh(){
   if(!start('read'))return;
   if(original)original={...original,reviewed:false,consent:false};notice=original?'正在查合成原收據及目前偏好。':'正在讀取合成偏好；草稿不會被偷偷保存。';emit();
  },
  consentOriginal(v){if(!available()||request||!fresh||!original?.reviewed||original.confirmed)return;original={...original,consent:v===true};emit();},
  retryOriginal(){
   if(!available()||request||!fresh||!original?.reviewed||!original.consent||original.confirmed)return;
   if(!start('retry'))return;original={...original,reviewed:false,consent:false};dispatches++;notice='以同一合成原操作、原內容及原版本重試。';emit();
  },
  deliver(token,result){
   // Admission uses RAW identities before any fallback or decoding.
   if(!alive||!available()||!request||!token||token.serial!==request.serial||token.lifetime!==lifetime||token.kind!==request.kind||identity(token.scope)!==identity(ctx)||!validContext(result?.scope)||identity(result.scope)!==identity(ctx))return;
   const kind=request.kind;
   const allowed=kind==='read'?['read','read-failed','denied']:['saved','unknown','confirmed-read-failed','conflict','denied'];
   if(!allowed.includes(result.type))return;
   if((result.type==='read'||result.type==='saved')&&!validPreferences(result.preferences))return;
   request=null;
   if(result.type==='denied'){clear();notice='目前本人偏好不可讀取；私人內容及草稿已清除。';emit();return;}
   if(result.type==='conflict'){original=null;fresh=false;notice='合成版本衝突；請讀取目前版本再核對。';emit();return;}
   if(result.type==='read-failed'){fresh=false;notice=original?.confirmed?'原合成保存已確認；目前偏好待讀回，不能重送。':'合成讀取失敗；保留原投影，請明確重新讀取。';emit();return;}
   if(result.type==='unknown'||result.type==='confirmed-read-failed'){
    original={...original,confirmed:result.type==='confirmed-read-failed',reviewed:false,consent:false};fresh=false;
    notice=original.confirmed?'原合成保存已確認；目前偏好尚待讀回，不可重送。':'合成保存結果未知；先查原收據和目前偏好。';emit();return;
   }
   if(result.type==='saved'){
    original=null;publishPreferences(result.preferences);notice='合成保存已確認並讀回；真實通知偏好完全未變。';emit();return;
   }
   publishPreferences(result.preferences);
   if(original){
    if(original.confirmed||result.receipt==='confirmed'){original=null;notice='原合成保存已確認；目前偏好已讀回。';}
    else{original={...original,reviewed:result.receipt==='unconfirmed',consent:false};notice=result.receipt==='unconfirmed'?'原合成保存尚未確認；核對目前偏好後，才可明確重試原內容。':'尚無可接納的原收據；不可重試。';}
   }else if(!dirty())notice='目前合成偏好已讀取。';
   emit();
  },
  setContext(next){
   if(!alive)return;
   const n={...next};const hard=identity(n)!==identity(ctx)||n.admitted!==ctx.admitted||n.shared!==ctx.shared;
   const wasOnline=ctx.online===true;ctx=n;
   if(hard){lifetime++;clear();notice='本人範圍已更換；舊資料已退役，請讀取此範圍。';}
   else if(wasOnline&&!ctx.online){request=null;fresh=false;review=null;if(original)original={...original,reviewed:false,consent:false};notice='目前離線；回線後先重新讀取，絕不自動重送。';}
   else if(!wasOnline&&ctx.online)notice='已回到合成連線；請明確讀取目前偏好。';
   emit();
  },
  dispose(){if(!alive)return;alive=false;lifetime++;clear();for(const e of listeners)e.active=false;listeners.clear();revision++;}
 };
 return api;
}
