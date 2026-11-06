import {DEFAULTS} from './host.mjs';
export const INITIAL_CONTEXT=Object.freeze({serverKey:'synthetic-server',userId:'synthetic-a',sessionGeneration:1,online:true,admitted:true,shared:false});
export const INITIAL_PREFERENCES=Object.freeze({...DEFAULTS,version:7});
// Fixture replies contain no true account information and call no transport.
export const fixtureChoices=s=>s.request?.kind==='read'?['success','failure','denied','confirmed','new-version']:['success','unknown','failure','conflict','denied'];
export function deliverFixture(host,choice){
 const s=host.snapshot();if(!s.request||!fixtureChoices(s).includes(choice))return;
 const scope={serverKey:s.context.serverKey,userId:s.context.userId,sessionGeneration:s.context.sessionGeneration};
 const current=s.preferences?{...s.preferences}:{...DEFAULTS,version:0};
 const original=s.original?.input;
 const applied=original?{timeZone:original.timeZone,quietStart:original.quietStart,quietEnd:original.quietEnd,allowAppointmentDuringQuiet:original.allowAppointmentDuringQuiet,version:original.expectedVersion+1}:current;
 let result;
 if(s.request.kind==='read'){
  if(choice==='failure')result={type:'read-failed'};
  else if(choice==='denied')result={type:'denied'};
  else if(choice==='confirmed')result={type:'read',preferences:applied,receipt:'confirmed'};
  else if(choice==='new-version')result={type:'read',preferences:{...current,version:current.version+1,quietEnd:current.quietEnd==='08:00'?'09:00':'08:00'},receipt:s.original?'unconfirmed':undefined};
  else result={type:'read',preferences:current,receipt:s.original?'unconfirmed':undefined};
 }else{
  if(choice==='unknown')result={type:'unknown'};
  else if(choice==='failure')result={type:'confirmed-read-failed'};
  else if(choice==='denied')result={type:'denied'};
  else if(choice==='conflict')result={type:'conflict'};
  else result={type:'saved',preferences:applied};
 }
 host.deliver(s.request,{scope,...result});
}
