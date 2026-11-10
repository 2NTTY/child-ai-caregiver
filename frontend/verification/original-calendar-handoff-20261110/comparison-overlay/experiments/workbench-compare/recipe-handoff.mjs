import {VARIANT_IDS,TASK_SLOT_IDS,getTaskSlot} from './native-catalog.mjs';
import {encodeTaskCandidateFragment} from './candidate-fragment.mjs';
const labels={original:'Original',harbour:'Harbour',care:'Care',handbook:'Handbook',fourth:'Fourth'};
const slots={'header-actions':'頁首與操作',filters:'頁籤、搜尋與範圍','date-list':'日期分組任務列','calendar-layout':'月曆與宿主布局'};
const coverage={'historical-calendar-layout-slot':'歷史月曆與布局整槽','historical-filters-controls':'分類＋搜尋＋範圍／日期觸發器','historical-filters-combination':'分類＋搜尋框組合','historical-tabs-fragment':'歷史分類分頁片段','historical-actions-fragment':'歷史操作按鈕片段','historical-row-fragment':'歷史事項列片段','actions-only':'操作區局部','row-appearance':'事項列外觀','header-appearance':'標題與操作外觀','controlled-filters-h-theme':'篩選外觀／H 元件','header-source-regions-partial-host':'頁首區域／宿主限制','date-list-source-regions-partial-host':'清單區域／宿主限制','date-groups-and-rows':'日期分組與事項列','controlled-calendar-layout-h-theme':'月曆布局／H 元件'};
export function mountRecipeHandoff(host,doc){
 let ready=false;const selected=Object.fromEntries(TASK_SLOT_IDS.map(s=>[s,null])),buttons=[],summaries={};
 const node=(tag,text)=>{const n=doc.createElement(tag);n.textContent=text??'';return n;};
 const notice=node('p');notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');host.append(notice);
 const link=node('a','另開待辦組合，帶入候選配方');link.target='_blank';link.rel='noopener noreferrer';
 function refresh(){
  buttons.forEach(b=>b.disabled=!ready);
  const hasChoice=Object.values(selected).some(Boolean),hash=encodeTaskCandidateFragment(selected);
  if(ready&&hasChoice&&hash){link.href='/tasks/?experiment=workbench-trial'+hash;link.setAttribute('aria-disabled','false');link.tabIndex=0;}
  else {link.removeAttribute('href');link.setAttribute('aria-disabled','true');link.tabIndex=-1;}
  notice.textContent=ready?'只編輯待辦候選籃，不會改動左右對照。帶入後尚未還原、尚未套用。':'請先在左右兩側開啟並核對待辦頁，才可選配及帶入；候選籃保留。';
  for(const slot of TASK_SLOT_IDS)summaries[slot].textContent=selected[slot]?`候選：${labels[selected[slot][0]]} · ${selected[slot][1]}`:'未選配：沿用原生宿主，並非還原 Original';
 }
 for(const slot of TASK_SLOT_IDS){
  const group=node('fieldset'),legend=node('legend',slots[slot]);group.append(legend);
  for(const variant of VARIANT_IDS){
   for(const candidate of getTaskSlot(variant,slot)?.narrowCandidates??[]){
    if((variant==='original'&&!((slot==='date-list'&&candidate.candidateId==='original-row-fragment01'&&candidate.coverage==='historical-row-fragment')||(slot==='header-actions'&&candidate.candidateId==='original-actions-fragment01'&&candidate.coverage==='historical-actions-fragment')||(slot==='filters'&&candidate.candidateId==='original-tabs-fragment01'&&candidate.coverage==='historical-tabs-fragment')||(slot==='filters'&&candidate.candidateId==='original-filters-combination01'&&candidate.coverage==='historical-filters-combination')||(slot==='filters'&&candidate.candidateId==='original-filters-controls01'&&candidate.coverage==='historical-filters-controls')||(slot==='calendar-layout'&&candidate.candidateId==='original-calendar-slot01'&&candidate.coverage==='historical-calendar-layout-slot')))||candidate.sourceAvailability!=='available'||!candidate.prospectiveComposable||candidate.hostVariantId!=='harbour'||!['bounded-source-accepted','source-reviewed-integration-unverified'].includes(candidate.acceptance))continue;
    const button=node('button',`${labels[variant]} · ${coverage[candidate.coverage]??candidate.coverage}（待驗收）`);button.type='button';button.setAttribute('data-slot',slot);button.setAttribute('data-variant',variant);
    button.addEventListener('click',()=>{if(!ready)return;selected[slot]=[variant,candidate.candidateId];refresh();});buttons.push(button);group.append(button);
   }
  }
  summaries[slot]=node('p');group.append(summaries[slot]);host.append(group);
 }
 const reset=node('button','清除候選籃');reset.type='button';reset.addEventListener('click',()=>{if(!ready)return;for(const slot of TASK_SLOT_IDS)selected[slot]=null;refresh();});buttons.push(reset);host.append(reset,link);refresh();
 return {setTasksScope(value){ready=value===true;refresh();}};
}
