import {createState,reduce,SCENARIOS,POLICY_VERSION} from './state.mjs';
import {render} from './view.mjs';

let state=createState();
const root=document.getElementById('candidate');
const scenario=document.getElementById('scenario');
for(const [value,label] of Object.entries(SCENARIOS)) {const option=document.createElement('option');option.value=value;option.textContent=label;scenario.append(option);}
function paint(focusId) {
  root.innerHTML=render(state);
  document.getElementById('result').textContent=state.notice;
  document.body.dataset.layout=state.layout;
  for(const layout of ['A','B']) document.getElementById(`layout-${layout}`).setAttribute('aria-pressed',String(layout===state.layout));
  scenario.value=state.scenario;
  document.getElementById('identity').value=state.identity;
  const online=document.getElementById('online');online.textContent=state.online?'模擬在線':'模擬離線';online.setAttribute('aria-pressed',String(state.online));
  if(focusId) {
    const target=document.getElementById(focusId);
    if(target&&!target.disabled) target.focus({preventScroll:true});
    else document.getElementById('action-heading').focus({preventScroll:true});
  }
}
function dispatch(event) {
  const before=state,active=document.activeElement;
  state=reduce(state,event);
  if(state===before) return;
  const focusId=root.contains(active)?active.id:null;
  paint(focusId);
}
document.getElementById('layout-A').addEventListener('click',()=>dispatch({type:'layout',value:'A'}));
document.getElementById('layout-B').addEventListener('click',()=>dispatch({type:'layout',value:'B'}));
scenario.addEventListener('change',()=>dispatch({type:'scenario',value:scenario.value}));
document.getElementById('identity').addEventListener('change',event=>dispatch({type:'identity',value:event.target.value}));
document.getElementById('online').addEventListener('click',()=>dispatch({type:'online',value:!state.online}));
document.getElementById('policy-change').addEventListener('click',()=>dispatch({type:'policy',value:state.policyVersion===POLICY_VERSION?'synthetic-next-version':POLICY_VERSION}));
root.addEventListener('change',event=>{if(event.target.id==='accept') dispatch({type:'accept',value:event.target.checked});});
root.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button||button.disabled||!root.contains(button)) return;
  if(['ack','mail','recheck'].includes(button.id)) dispatch({type:'start',action:button.id});
  if(button.id==='reply-success'||button.id==='reply-error') dispatch({type:'settle',token:state.pending?.token,outcome:button.id==='reply-success'?'success':'error'});
});
paint();
