import {dateTimeParts,dateTimeValue} from './date-time.mjs';

// One page-only synthetic host. This is NOT a production domain/operation owner.
export function createOwner(initial,onChange=()=>{},onZoneChange=()=>{}) {
 let s={...initial,open:false,session:0,revision:0,layout:'A',step:0,draft:null,error:null,errorField:null,callbackCount:0};
 let disposed=false;
 const listeners=new Set();
 const publish=()=>{s={...s,revision:s.revision+1};for(const listener of [...listeners]) if(listeners.has(listener)) listener();};
 const snapshot=()=>Object.freeze({...s,draft:s.draft?Object.freeze({...s.draft}):null});
 const active=session=>!disposed&&s.availability==='ready'&&s.open&&session===s.session;
 const retire=()=>{s={...s,open:false,draft:null,error:null,errorField:null,session:s.session+1};};
 const errorField=()=>!/^\d{4}-\d{2}-\d{2}$/.test(s.draft.date)||!calendarDayValid(s.draft.date)?'date':!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.draft.time)?'time':!dateTimeParts('2024-01-01T00:00:00Z',s.zone)?'zone':'time';
 return {
  snapshot,
  subscribe(fn){if(disposed)return()=>{};listeners.add(fn);return()=>listeners.delete(fn);},
  open(){
   if(disposed||s.availability!=='ready')return false;
   if(s.open)return true;
   const parts=typeof s.value==='string'?dateTimeParts(s.value,s.zone):null;
   s={...s,open:true,session:s.session+1,draft:parts??{date:'',time:''},error:null,errorField:null,step:0};publish();return true;
  },
  edit(field,value,session=s.session){
   if(!active(session)||!['date','time'].includes(field)||typeof value!=='string')return false;
   s={...s,draft:{...s.draft,[field]:value},error:null,errorField:null};publish();return true;
  },
  setZone(zone){
   if(disposed||s.availability!=='ready'||typeof zone!=='string')return false;
   if(zone===s.zone)return true;
   s={...s,zone,error:null,errorField:null};onZoneChange(zone);publish();return true;
  },
  setLayout(layout){if(disposed||!['A','B'].includes(layout))return false;s={...s,layout};publish();return true;},
  setStep(step){if(!active(s.session)||!Number.isInteger(step)||step<0||step>3)return false;s={...s,step};publish();return true;},
  choose(session=s.session){
   if(!active(session))return {accepted:false};
   const result=dateTimeValue(s.draft.date,s.draft.time,s.zone);
   if(result.value===null){s={...s,error:result.error,errorField:errorField()};if(s.layout==='B')s.step=s.errorField==='zone'?0:s.errorField==='date'?1:2;publish();return{accepted:false,invalid:true,session};}
   const value=result.value;s={...s,value,callbackCount:s.callbackCount+1};retire();const closedSession=s.session;onChange(value);publish();
   return{accepted:true,closedSession,value};
  },
  cancel(session=s.session){if(!active(session))return false;retire();publish();return true;},
  clear(){if(disposed||s.availability!=='ready'||s.open)return false;s={...s,value:'',callbackCount:s.callbackCount+1};onChange('');publish();return true;},
  reread(next){
   if(disposed)return false;
   const retirement=next.epoch!==s.epoch||next.availability!=='ready';
   s={...s,value:next.value,zone:next.zone,availability:next.availability,epoch:next.epoch};
   if(retirement)retire();publish();return true;
  },
  dispose(){if(disposed)return;retire();disposed=true;publish();listeners.clear();}
 };
}
function calendarDayValid(date){return dateTimeValue(date,'12:00','UTC').value!==null;}
