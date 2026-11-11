import {initialState,transition} from './guide-state.mjs';
import {introFor} from './guide-data.mjs';
import {readingMarkup,stepsMarkup} from './guide-view.mjs';
let state=initialState();
const byId=id=>document.getElementById(id);
function render() {
 byId('intro').textContent=introFor(state.guideStatus);
 byId('workspace').className=`workspace variant-${state.variant}`;
 for(const variant of ['A','B']) byId(`variant-${variant}`).setAttribute('aria-pressed',String(state.variant===variant));
 byId('guide-status').value=state.guideStatus;
 byId('steps').innerHTML=stepsMarkup(state);
 byId('reading').innerHTML=readingMarkup(state);
}
function dispatch(event,focusId) {
 const next=transition(state,event);
 if(next===state) return;
 state=next; render();
 if(focusId) byId(focusId)?.focus();
}
for(const value of ['A','B']) byId(`variant-${value}`).addEventListener('click',()=>dispatch({type:'variant',value}));
byId('guide-status').addEventListener('change',event=>dispatch({type:'status',value:event.target.value}));
byId('steps').addEventListener('click',event=>{
 const button=event.target.closest('button[data-step]');
 if(button) {const focusId='reading-title';dispatch({type:'select',index:Number(button.dataset.step)},focusId);}
});
byId('reading').addEventListener('click',event=>{
 const button=event.target.closest('button');
 if(!button||button.disabled) return;
 if(button.id==='previous'||button.id==='next') {const focusId='reading-title';dispatch({type:button.id},focusId);}
 else if(button.id==='action') dispatch({type:'intent',destination:button.dataset.destination},'action');
 else if(button.id==='return') {const focusId='action';dispatch({type:'return'},focusId);}
});
render();
