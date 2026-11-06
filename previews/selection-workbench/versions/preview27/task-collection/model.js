(function(g){
'use strict';
const CONTEXT={asOf:'2026-11-05T04:00:00Z',timeZone:'Asia/Hong_Kong'};
const PEOPLE=[{userId:'p1',name:'合成照顧者 青'},{userId:'p2',name:'合成照顧者 橙'}];
const FILTERS=['near','earlier','later','review','unconfirmed','all'];
function day(value,zone){
 if(typeof value!=='string'||!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)||!Number.isFinite(Date.parse(value)))return null;
 const fields=/^(\d{4})-(\d{2})-(\d{2})T/.exec(value);if(!fields)return null;const year=Number(fields[1]),month=Number(fields[2]),date=Number(fields[3]);if(month<1||month>12||date<1||date>new Date(Date.UTC(year,month,0)).getUTCDate())return null;
 try{let p=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));return ['year','month','day'].map(t=>p.find(x=>x.type===t).value).join('-')}catch{return null}
}
function plusDay(value,n){return value?new Date(Date.parse(value+'T00:00:00Z')+n*86400000).toISOString().slice(0,10):null}
function project(items,context,options,people){
 if(options.tab==='completed'){
  let rows=items.filter(x=>x.occurrence.state==='completed').map((task,index)=>({task,index,time:Number.isFinite(Date.parse(task.completedAt))?Date.parse(task.completedAt):null})).sort((a,b)=>a.time!==null&&b.time!==null?b.time-a.time||a.index-b.index:a.time!==null?-1:b.time!==null?1:a.index-b.index).slice(0,10).map(x=>x.task);
  return {items:rows,page:0,pageCount:1,total:rows.length,from:rows.length?1:0,to:rows.length,counts:{},limitedRecent:true};
 }
 let today=day(context.asOf,context.timeZone),end=plusDay(today,7),counts={near:0,earlier:0,later:0,review:0,unconfirmed:0,all:0};
 let entries=items.filter(x=>['scheduled','needs_review'].includes(x.occurrence.state)).map((task,index)=>{let date=day(task.occurrence.dueAt,context.timeZone),bucket=!date||!today||!end?'unconfirmed':date<today?'earlier':date<end?'near':'later';counts[bucket]++;counts.all++;if(task.occurrence.state==='needs_review')counts.review++;return {task,index,date,bucket}});
 let query=options.query.trim().toLocaleLowerCase('zh-HK');
 let matches=entries.filter(({task,date,bucket})=>(options.selectedDay?date===options.selectedDay:options.filter==='all'||(options.filter==='review'?task.occurrence.state==='needs_review':options.filter===bucket))&&(!query||[task.title,task.details,people.find(p=>p.userId===task.assigneeUserId)?.name??''].some(v=>v.toLocaleLowerCase('zh-HK').includes(query)))).sort((a,b)=>!a.date&&b.date?1:a.date&&!b.date?-1:a.date&&b.date?Date.parse(a.task.occurrence.dueAt)-Date.parse(b.task.occurrence.dueAt)||a.index-b.index:a.index-b.index);
 let pageCount=Math.max(1,Math.ceil(matches.length/10)),page=Math.min(Math.max(0,Number.isFinite(options.page)?Math.trunc(options.page):0),pageCount-1);
 return {counts,page,pageCount,total:matches.length,from:matches.length?page*10+1:0,to:Math.min((page+1)*10,matches.length),items:matches.slice(page*10,(page+1)*10).map(entry=>entry.task)};
}
function fixtures(scope='demo-a'){
 const titles=['準備外出小袋','整理閱讀角','帶上水樽','一起看圖畫書','檢查換洗衣物','收好拼圖','準備畫畫紙','安排公園散步'];
 return Array.from({length:67},(_,i)=>{let state=i%17===0?'completed':i%19===0?'cancelled':i%11===0?'needs_review':'scheduled',date=plusDay('2026-11-02',i%16);return {id:String(i+1).padStart(3,'0'),childId:scope,version:1,title:titles[i%8]+' · '+String(i+1).padStart(2,'0'),details:'這是一筆合成的日常安排，用來比較清單閱讀與篩選。沒有真實家庭資料。',kind:i%7===0?'appointment':'ordinary',assigneeUserId:i%2?'p1':'p2',createdBy:'synthetic',createdAt:'2026-11-01T00:00:00Z',updatedAt:`${date}T08:00:00Z`,completedAt:state==='completed'?`${date}T08:00:00Z`:undefined,occurrence:{id:'occ-'+i,dueAt:i===26?'invalid-synthetic-time':`${date}T${i%2?'02':'09'}:00:00Z`,timeZone:'Asia/Hong_Kong',state,terminalBasisVersion:null}}});
}
function freeze(x){if(x&&typeof x==='object'&&!Object.isFrozen(x)){Object.values(x).forEach(freeze);Object.freeze(x)}return x}
function createHost(){
 let epoch=1,revision=0,serial=0,disposed=false,scope='demo-a',all=fixtures(scope),items=all.slice(0,50),request=null;
 let state={layout:'board',filter:'near',tab:'pending',query:'',selectedDay:null,page:0,readState:'ready',reading:false,online:true};
 let listeners=new Set();const token=()=>scope+':'+epoch;
 function snapshot(){let projection=project(items,CONTEXT,state,PEOPLE);return freeze({ ...state,scope,epoch,token:token(),revision,items:[...items],people:[...PEOPLE],context:{...CONTEXT},projection,hasMore:items.length>0&&items.length<all.length,disposed})}
 function publish(){revision++;let r=revision,s=snapshot();for(let registration of [...listeners]){if(disposed||r!==revision)break;if(listeners.has(registration))registration.fn(s)}}
 function valid(t){return !disposed&&t===token()&&state.readState!=='invalidated'}
 function intent(change,t){if(!valid(t)||state.reading||!['ready','stale'].includes(state.readState))return false;
  const allowed=['layout','filter','tab','query','selectedDay','page','reset'];if(Object.keys(change).some(k=>!allowed.includes(k)))return false;
  if(change.layout!==undefined&&!['board','index'].includes(change.layout)||change.filter!==undefined&&!FILTERS.includes(change.filter)||change.tab!==undefined&&!['pending','completed'].includes(change.tab)||change.query!==undefined&&(typeof change.query!=='string'||change.query.length>400)||change.selectedDay!==undefined&&change.selectedDay!==null&&(!/^\d{4}-\d{2}-\d{2}$/.test(change.selectedDay)||day(change.selectedDay+'T00:00:00Z','UTC')!==change.selectedDay))return false;
  let next={...state};if(change.reset){next={...next,filter:'all',query:'',selectedDay:null,page:0,tab:'pending'}}
  else {if(change.tab!==undefined){next.query='';next.filter='near';next.selectedDay=null;next.page=0}if(change.filter!==undefined){next.selectedDay=null;next.page=0}if(change.query!==undefined||change.selectedDay!==undefined)next.page=0;Object.assign(next,change)}
  if(change.page!==undefined&&!change.reset)next.page=change.page;next.page=project(items,CONTEXT,next,PEOPLE).page;delete next.reset;state=next;publish();return true;
 }
 function beginRead(kind,t){if(!valid(t)||request||!state.online||!['more','refresh','reload'].includes(kind)||kind==='more'&&items.length>=all.length)return null;
  request=freeze({id:++serial,token:token(),kind});let ticket=request;state={...state,reading:true,readState:items.length?state.readState:'loading'};publish();return ticket;
 }
 function finishRead(ticket,outcome){if(!ticket||request!==ticket||!valid(ticket.token)||!['success','failed','invalidated'].includes(outcome))return false;request=null;
  if(outcome==='invalidated'){invalidate();return true}
  if(outcome==='failed'){state={...state,reading:false,readState:items.length?'stale':'error'}}
  else if(outcome==='success'){items=all.slice(0,ticket.kind==='more'?items.length+50:ticket.kind==='refresh'?items.length:50);state={...state,reading:false,readState:'ready'};state.page=project(items,CONTEXT,state,PEOPLE).page}
  else return false;publish();return true;
 }
 function setScope(next){if(disposed||!['demo-a','demo-b'].includes(next))return false;epoch++;scope=next;request=null;all=fixtures(scope);items=all.slice(0,50);state={layout:state.layout,filter:'near',tab:'pending',query:'',selectedDay:null,page:0,readState:'ready',reading:false,online:true};publish();return true}
 function invalidate(){if(disposed)return;epoch++;request=null;items=[];state={...state,query:'',selectedDay:null,page:0,reading:false,readState:'invalidated'};publish()}
 function dispose(){if(disposed)return;epoch++;request=null;items=[];disposed=true;listeners.clear();state={...state,reading:false,readState:'invalidated',query:'',selectedDay:null,page:0}}
 return {snapshot,intent,beginRead,finishRead,setScope,invalidate,dispose,subscribe(fn){const registration={fn};listeners.add(registration);return()=>listeners.delete(registration)}};
}
g.TC01={project,day,plusDay,fixtures,createHost,CONTEXT,PEOPLE};if(typeof module!=='undefined')module.exports=g.TC01;
})(globalThis);
