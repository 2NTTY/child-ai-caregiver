import {initial,reduce} from './host.mjs';
import {renderHints,renderStage} from './view.mjs';
let state=initial();
const get=id=>document.getElementById(id),hintRegion=get('hint-region'),stage=get('stage');
function paint(){
 const active=document.activeElement,restore=(hintRegion.contains(active)||stage.contains(active))?active.id:null;
 hintRegion.innerHTML=renderHints(state);stage.innerHTML=renderStage(state);
 document.body.dataset.layout=state.layout;
 for(const value of ['A','B'])get(`layout-${value}`).setAttribute('aria-pressed',String(state.layout===value));
 for(const field of ['identity','child','scenario','guard'])get(field).value=state[field];
 get('replay').disabled=!state.held;get('feedback').textContent=state.feedback;
 if(restore){const target=get(restore);if(target&&!target.disabled)target.focus();else get('hint-heading').focus();}
}
function dispatch(event){const next=reduce(state,event);if(next===state)return false;state=next;paint();return true;}
function focus(id){(get(id)||get('hint-heading')).focus();}
for(const layout of ['A','B'])get(`layout-${layout}`).addEventListener('click',()=>dispatch({type:'layout',value:layout}));
for(const field of ['identity','child','scenario','guard'])get(field).addEventListener('change',event=>dispatch({type:field,value:event.target.value}));
get('replay').addEventListener('click',()=>{const hadRoute=state.route;dispatch({type:'resolve',key:state.held?.key});if(state.route&&state.route!==hadRoute)focus('route-heading');});
hintRegion.addEventListener('click',event=>{
 const button=event.target.closest('button[data-review]');if(!button||!hintRegion.contains(button)||button.disabled)return;
 if(dispatch({type:'review',id:button.dataset.review,expected:button.dataset.expected}))focus(state.pending?'pending-heading':'route-heading');
});
stage.addEventListener('click',event=>{
 const button=event.target.closest('button');if(!button||!stage.contains(button)||button.disabled)return;
 if(button.id==='confirm'){const key=state.pending?.key;if(dispatch({type:'resolve',key})&&state.route)focus('route-heading');}
 else if(button.id==='cancel'){const id=state.pending?.id;if(dispatch({type:'cancel'}))focus(`hint-${id}`);}
 else if(button.id==='consume'){if(dispatch({type:'consume'}))focus('route-heading');}
 else if(button.id==='back'){const id=state.route?.id;if(dispatch({type:'back'}))focus(`hint-${id}`);}
});
paint();
