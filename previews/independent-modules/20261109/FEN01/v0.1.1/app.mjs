import {initial,reduce,canFocus,FIELDS} from './host.mjs';
import {renderSummary} from './summary.mjs';
let state=initial();
const summary=document.getElementById('summary'),get=id=>document.getElementById(id);
function paint({restore=false}={}){
 const active=document.activeElement,oldFocus=restore&&summary.contains(active)?active.id:null;
 summary.innerHTML=renderSummary(state);
 document.body.dataset.layout=state.layout;
 for(const layout of ['A','B'])get(`layout-${layout}`).setAttribute('aria-pressed',String(state.layout===layout));
 get('scope').value=state.scope;get('scope-label').textContent=state.scope==='demo-A'?'示例 A':'示例 B';
 get('details-fields').hidden=!state.detailsOpen;get('details-toggle').setAttribute('aria-expanded',String(state.detailsOpen));get('details-toggle').textContent=state.detailsOpen?'收起補充欄位 −':'展開補充欄位 ＋';
 get('lock').setAttribute('aria-pressed',String(state.locked));get('lock').textContent=state.locked?'解鎖合成欄位':'鎖定合成欄位';
 for(const field of FIELDS){
  const input=get(`field-${field.id}`),entry=state.entries.find(e=>e.field===field.id);
  if(input.value!==state.values[field.id])input.value=state.values[field.id];
  input.disabled=state.locked;input.setAttribute('aria-invalid',String(!!entry));get(`error-${field.id}`).textContent=entry?.message??'';
 }
 get('check').disabled=state.locked;get('fill').disabled=state.locked;
 get('feedback').textContent=state.feedback;
 if(get('announcer').textContent!==state.announcement)get('announcer').textContent=state.announcement;
 if(oldFocus){const next=get(oldFocus);if(next&&!next.disabled)next.focus();else get('summary-heading').focus();}
}
function dispatch(event,options={restore:true}){const next=reduce(state,event);if(next===state)return false;state=next;paint(options);return true;}
function focusField(field){
 if(!canFocus(state,field))return;
 state=reduce(state,{type:'choose',field});
 if(field!=='title')state=reduce(state,{type:'details',value:true});
 paint();get(`field-${field}`).focus();
}
for(const field of FIELDS)get(`field-${field.id}`).addEventListener('input',event=>{
 state=reduce(state,{type:'edit',field:field.id,value:event.target.value});get('feedback').textContent=state.feedback;
});
for(const layout of ['A','B'])get(`layout-${layout}`).addEventListener('click',()=>dispatch({type:'layout',value:layout}));
get('scope').addEventListener('change',event=>dispatch({type:'scope',value:event.target.value}));
get('lock').addEventListener('click',()=>dispatch({type:'lock',value:!state.locked}));
get('long-errors').addEventListener('click',()=>dispatch({type:'long-errors'}));
get('fill').addEventListener('click',()=>dispatch({type:'fill'}));
get('check').addEventListener('click',()=>{if(dispatch({type:'check'}))get('summary-heading').focus();});
get('details-toggle').addEventListener('click',()=>dispatch({type:'details',value:!state.detailsOpen}));
summary.addEventListener('click',event=>{
 const button=event.target.closest('button');if(!button||button.disabled||!summary.contains(button))return;
 if(button.dataset.focusField)focusField(button.dataset.focusField);
 else if(button.dataset.pickField)dispatch({type:'choose',field:button.dataset.pickField});
 else if(button.id==='previous-error')dispatch({type:'step',delta:-1});
 else if(button.id==='next-error')dispatch({type:'step',delta:1});
});
paint();
