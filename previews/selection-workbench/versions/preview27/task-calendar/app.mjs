import {initialState,reduce,moveFocus,project,dayLabel,monthLabel,weekDates} from './model.mjs';
import {render,focusAfter} from './render.mjs';
const app=document.getElementById('app');
const status=document.getElementById('status');
let state=initialState();
let composing=false;
function paint(action=null){
 const active=document.activeElement;
 const id=active?.id;
 const caret=active instanceof HTMLInputElement?{start:active.selectionStart,end:active.selectionEnd}:null;
 const before=state;
 if(action)state=reduce(state,action);
 app.innerHTML=render(state);
 document.body.dataset.layout=state.layout;
 if(action){
  const wanted=focusAfter(action,before)||id;
  const target=document.getElementById(wanted)||document.getElementById('list-title');
  target?.focus({preventScroll:true});
  if(target instanceof HTMLInputElement&&caret&&target.id===id&&caret.start!==null){target.setSelectionRange(caret.start,caret.end);}
  if(action.type==='detail')document.getElementById('task-detail')?.scrollIntoView({block:'nearest',behavior:'auto'});
  if(action.type==='close-detail')target?.scrollIntoView({block:'nearest',behavior:'auto'});
  if(action.type!=='focus'){
   const p=project(state);
   const visibleRange=state.layout==='folio'?monthLabel(state.month):`${dayLabel(weekDates(state.focusDay)[0])}至${dayLabel(weekDates(state.focusDay).at(-1))}`;
   const navigation=['month','week','reference'].includes(action.type);
   status.textContent=navigation?`${action.type==='reference'?'已回到資料基準位置，':'目前顯示'}${visibleRange}。${state.selectedDay?`選中日仍為${dayLabel(state.selectedDay)}。`:'日期篩選未改變。'}`:action.type==='layout'?`已切換為${state.layout==='route'?'路線日程':'月曆記事'}，選中日期與篩選已保留。`:action.type==='close-detail'?'詳情已關閉。':action.type==='detail'?'已開啟唯讀詳情，可用 Escape 返回原事項。':`${state.selectedDay?dayLabel(state.selectedDay):'範圍清單'}，已載入 ${p.total} 項符合條件的合成事項。`;
  }
 }
}
app.addEventListener('click',event=>{
 const control=event.target.closest('button[data-action]');if(!control)return;
 const type=control.dataset.action;
 const action={type,value:control.dataset.value,amount:Number(control.dataset.amount),fromButton:true};
 paint(action);
});
app.addEventListener('change',event=>{if(event.target.id==='range')paint({type:'range',value:event.target.value});});
app.addEventListener('compositionstart',event=>{if(event.target.id==='search')composing=true;});
app.addEventListener('compositionend',event=>{if(event.target.id==='search'){composing=false;paint({type:'query',value:event.target.value});}});
app.addEventListener('input',event=>{if(event.target.id==='search'&&!composing&&!event.isComposing)paint({type:'query',value:event.target.value});});
app.addEventListener('keydown',event=>{
 const date=event.target.closest('button[data-date]');
 if(date&&!event.altKey&&!event.ctrlKey&&!event.metaKey){const next=moveFocus(date.dataset.date,event.key,event.shiftKey);if(next){event.preventDefault();paint({type:'focus',value:next});return;}}
 if(event.key==='Escape'&&event.target.closest('[data-detail]')){event.preventDefault();paint({type:'close-detail'});}
});
paint();
