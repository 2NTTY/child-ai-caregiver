import {createOwner} from './owner.mjs';
import {dateTimeParts,dateTimeValue,timeZoneLabel} from './date-time.mjs';

export function mount(doc,owner){
 const $=id=>doc.getElementById(id),dialog=$('picker'),listeners=[];
 let disposed=false;
 const on=(el,type,fn)=>{el.addEventListener(type,fn);listeners.push(()=>el.removeEventListener(type,fn));};
 const text=(id,value)=>{$(id).textContent=value;};
 const guardedFocus=(id,stamp,reveal=false)=>{
  if(disposed||owner.snapshot().revision!==stamp.revision)return;
  const el=$(id);if(el.closest('[hidden]'))return;
  el.focus();
  if(reveal&&!disposed&&owner.snapshot().revision===stamp.revision&&doc.activeElement===el&&!el.closest('[hidden]'))el.scrollIntoView?.({block:'nearest',inline:'nearest'});
 };
 const render=()=>{
  if(disposed)return;
  const s=owner.snapshot(),ready=s.availability==='ready';
  doc.body.dataset.layout=s.layout;
  for(const prefix of ['','dialog-'])for(const mode of ['A','B'])$(prefix+'layout-'+mode).setAttribute('aria-pressed',String(s.layout===mode));
  text('hero-title',s.layout==='A'?'把同一刻，說清楚。':'循著時區，找到同一刻。');
  const parts=typeof s.value==='string'?dateTimeParts(s.value,s.zone):null;
  text('chosen-local',!ready?'來源狀態未知':parts?`${parts.date} · ${parts.time}`:'尚未選擇明確日期時間');
  text('chosen-zone',`${timeZoneLabel(s.zone)} · ${s.zone}`);
  text('chosen-value',!ready?'未知：尚無可用的來源值':s.value===null||s.value===undefined?'未提供（null / undefined）':s.value===''?'空值：尚未選用':s.value);
  text('hero-clock',parts?.time??'—:—');text('hero-zone',timeZoneLabel(s.zone));
  $('open-picker').setAttribute('aria-disabled',String(!ready));$('open-picker').setAttribute('aria-expanded',String(s.open));
  $('clear-value').setAttribute('aria-disabled',String(!ready||s.open));
  text('picker-title',s.layout==='A'?'校準這一刻':'循著時區，逐站核對');
  $('step-nav').hidden=s.layout!=='B';$('step-actions').hidden=s.layout!=='B';
  const fields=['zone','date','time'];
  for(const [i,name] of ['zone','date','time','review'].entries()){
   $('stage-'+name).hidden=s.layout==='B'&&s.step!==i;
   $('step-'+i).setAttribute('aria-current',s.step===i?'step':'false');
  }
  for(const name of fields){const value=name==='zone'?s.zone:s.draft?.[name]??'';if($(name).value!==value)$(name).value=value;$(name).setAttribute('aria-invalid',String(Boolean(s.error)&&s.errorField===name));$(name).setAttribute('aria-describedby',name+'-help'+(s.error&&s.errorField===name?' error':''));}
  const result=s.draft?dateTimeValue(s.draft.date,s.draft.time,s.zone):{value:null,error:null};
  text('draft-local',s.draft?`${s.draft.date||'未填日期'} · ${s.draft.time||'未填時間'}`:'尚未開啟草稿');text('draft-zone',`${timeZoneLabel(s.zone)} · ${s.zone}`);
  text('draft-utc',result.value??'尚不能換算');text('interpretation-note',result.value?'這組日期、時間及時區可對應到唯一時刻。':result.error??'填妥後核對。');
  text('error',s.error??'');$('error').hidden=!s.error;
  $('back-step').setAttribute('aria-disabled',String(s.step===0));$('next-step').setAttribute('aria-disabled',String(s.step===3));
  text('next-step',s.step===3?'已到核對站':'下一步');
  $('choose-time').hidden=s.layout==='B'&&s.step!==3;
  text('draft-caption',`本頁已觸發 ${s.callbackCount} 次選用 / 清除 callback，沒有正式保存。`);
  // Native dialog is a platform port. No tests claim that JSDOM models top-layer focus.
  if(s.open&&!dialog.open)dialog.showModal();
  else if(!s.open&&dialog.open){
   const heldFocus=dialog.contains(doc.activeElement);dialog.close();
   if(heldFocus&&dialog.contains(doc.activeElement))guardedFocus('open-picker',s,true);
  }
  // Rescue only the currently focused node that this projection just hid.
  // Another control or a newer publication keeps its own focus.
  if(s.open&&dialog.contains(doc.activeElement)&&doc.activeElement.closest('[hidden]'))guardedFocus('picker-title',s,true);
 };
 on($('open-picker'),'click',()=>{
  const before=owner.snapshot();if(!owner.open())return;const s=owner.snapshot();
  if(s.open&&s.session===before.session+1)guardedFocus(s.layout==='A'?'date':'zone',s,true);
 });
 const cancel=()=>{const s=owner.snapshot();if(!owner.cancel(s.session))return;const after=owner.snapshot();if(!after.open&&after.session===s.session+1)guardedFocus('open-picker',after,true);};
 on($('cancel-picker'),'click',cancel);on($('close-picker'),'click',cancel);
 on(dialog,'cancel',e=>{e.preventDefault();cancel();});
 on($('clear-value'),'click',()=>owner.clear());
 for(const prefix of ['','dialog-'])for(const mode of ['A','B'])on($(prefix+'layout-'+mode),'click',()=>owner.setLayout(mode));
 for(let i=0;i<4;i++)on($('step-'+i),'click',()=>owner.setStep(i));
 on($('next-step'),'click',()=>{const s=owner.snapshot();if(s.step<3)owner.setStep(s.step+1);});
 on($('back-step'),'click',()=>{const s=owner.snapshot();if(s.step>0)owner.setStep(s.step-1);});
 for(const field of ['date','time'])on($(field),'input',()=>owner.edit(field,$(field).value));
 on($('zone'),'input',()=>owner.setZone($('zone').value));
 on($('choose-time'),'click',()=>{
  const before=owner.snapshot();const result=owner.choose(before.session);const after=owner.snapshot();
  if(result.accepted&&!after.open&&after.session===result.closedSession)guardedFocus('open-picker',after,true);
  else if(result.invalid&&after.open&&after.session===before.session&&after.errorField)guardedFocus(after.errorField,after,true);
 });
 for(const a of doc.querySelectorAll('a[href="#main"]'))on(a,'click',()=>{$('main').focus();});
 const unsubscribe=owner.subscribe(render);render();
 return()=>{if(disposed)return;disposed=true;unsubscribe();for(const remove of listeners)remove();};
}

if(typeof document!=='undefined'&&document.getElementById('picker')){
 const owner=createOwner({value:'2024-02-29T10:15:00+08:00',zone:'Asia/Hong_Kong',availability:'ready',epoch:'dt01-synthetic'});
 mount(document,owner);
}
