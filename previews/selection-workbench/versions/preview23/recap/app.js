import {SAMPLE_RANGE,CATEGORIES,initialState,transition,projectRecap,getEvents,daysInWeek,shiftWeek,weekOf} from './model.mjs';
const $=selector=>document.querySelector(selector);
const make=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined&&text!==null)node.textContent=text;if(className)node.className=className;return node;};
const categoryFor=id=>CATEGORIES.find(item=>item.id===id);
const shortDate=date=>`${Number(date.slice(5,7))}/${Number(date.slice(8,10))}`;
const longDate=date=>`${Number(date.slice(5,7))}月${Number(date.slice(8,10))}日`;
const weekdays=['週一','週二','週三','週四','週五','週六','週日'];
let state=initialState();
let returnId=null;
function illustration(kind,className='moment-art'){
  const box=make('div',null,className);box.setAttribute('aria-hidden','true');
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 400 240');svg.setAttribute('preserveAspectRatio','xMidYMid slice');svg.setAttribute('focusable','false');
  const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href',`art.svg#${kind}`);svg.append(use);box.append(svg);return box;
}
function setState(action,focusId,announcement){state=transition(state,action);render(focusId);if(announcement)$('#announce').textContent=announcement;}
function openButton(item,prefix){
  const button=make('button','讀這一刻 ↗','open-moment');button.id=`${prefix}-${item.id}`;button.setAttribute('aria-label',`讀這一刻：${item.title}`);button.addEventListener('click',()=>openDetail(item,button.id));return button;
}
function meta(item){return `${shortDate(item.date)} · ${item.time} / ${categoryFor(item.category).label}`;}
function atlasCard(item){
  const article=make('article',null,'moment-card');article.append(illustration(item.art));
  const copy=make('div',null,'moment-copy');copy.append(make('p',`${item.time} / ${categoryFor(item.category).label}`,'moment-meta'),make('h5',item.title),make('p',item.snippet),openButton(item,'atlas-open'));article.append(copy);return article;
}
function atlasContent(projection){
  const list=make('div',null,'atlas-list');
  for(const date of daysInWeek(state.week)){
    const records=projection.items.filter(item=>item.date===date);if(!records.length)continue;
    const section=make('section',null,'atlas-day');const title=make('h4',null,'atlas-date');title.id=`date-heading-${date}`;title.append(make('span',shortDate(date)),make('small',weekdays[daysInWeek(state.week).indexOf(date)]));section.setAttribute('aria-labelledby',title.id);
    const cards=make('div',null,'day-stories');cards.append(...records.map(atlasCard));section.append(title,cards);list.append(section);
  }
  return list;
}
function weeklyContent(projection){
  const wrapper=make('div',null,'weekly-issue');const [first,...rest]=projection.items;if(!first)return wrapper;
  const lead=make('article',null,'weekly-lead');const visual=make('div',null,'lead-visual');visual.append(illustration(first.art,'lead-art'),make('p','原創示意插畫 · 沒有真實照片','lead-caption'));
  const copy=make('div',null,'lead-copy');copy.append(make('p','OPENING STORY / 本期開篇','lead-label'),make('h4',first.title),make('p',meta(first),'moment-meta'),make('p',first.snippet),make('p',first.note,'editorial-quote'),openButton(first,'weekly-open'));lead.append(visual,copy);wrapper.append(lead);
  const columns=make('div',null,'weekly-columns');
  for(const category of CATEGORIES){
    const records=rest.filter(item=>item.category===category.id);if(!records.length)continue;
    const column=make('section',null,'topic-column');const heading=make('div',null,'topic-heading');const title=make('h4',`${category.symbol} ${category.label}`);title.id=`topic-${category.id}`;column.setAttribute('aria-labelledby',title.id);heading.append(title,make('span',`${records.length} 則續篇`));column.append(heading);
    for(const item of records){const story=make('article',null,'editorial-story');story.append(make('p',`${longDate(item.date)} · ${item.time}`,'moment-meta'),make('h5',item.title),make('p',item.snippet),make('p',item.note,'editorial-quote'),openButton(item,'weekly-open'));column.append(story);}
    columns.append(column);
  }
  wrapper.append(columns,make('p','沒有被記下的部分，留白就好。這一頁從不替生活打分。','weekly-endnote'));return wrapper;
}
function renderDates(projection){
  const list=$('#date-map');list.replaceChildren(...projection.days.map((day,index)=>{
    const item=make('li');const button=make('button',null,'day-button');button.id=`day-${day.date}`;button.dataset.missing=String(day.recordCount===null);button.setAttribute('aria-pressed',String(state.date===day.date));
    const status=day.recordCount===null?'未記錄':`${day.recordCount} 則片刻`;button.setAttribute('aria-label',`${longDate(day.date)}${weekdays[index]}，${status}${state.category!=='all'?`，符合情境 ${day.matchingCount} 則`:''}`);
    const orbit=make('span',day.recordCount===null?'◌':'✦','day-orbit');orbit.setAttribute('aria-hidden','true');button.append(make('span',weekdays[index],'day-name'),orbit,make('span',shortDate(day.date),'day-date'),make('span',status,'day-records'));
    if(state.category!=='all')button.append(make('span',`符合篩選 ${day.matchingCount} 則`,'day-filter'));
    button.addEventListener('click',()=>setState({type:'date',value:day.date},button.id,`已選${longDate(day.date)}。${status}。`));item.append(button);return item;
  }));
}
function render(focusId){
  const projection=projectRecap(getEvents(state.scenario),state),weekly=state.view==='weekly';
  document.body.dataset.view=state.view;
  $('#date-error').hidden=true;$('#jump-date').removeAttribute('aria-invalid');
  for(const view of ['atlas','weekly'])$('#view-'+view).setAttribute('aria-pressed',String(state.view===view));
  const heading=$('#hero-title');heading.replaceChildren(document.createTextNode(weekly?'生活不必精彩，':'把一週微光，'),document.createElement('br'),make('em',weekly?'也值得一頁。':'連成自己的星圖。'));
  $('#hero-summary').textContent=weekly?'從一則小事翻開，讓同行、好奇與留白，各自有一個位置。':'不是成長成績單。只是把曾經留意到的小事，放回日子裡，再看一眼。';
  $('#section-kicker').textContent=weekly?'THE EVERYDAY / WEEKLY EDITION':'STARMAP / WEEKLY LOG';
  const dates=daysInWeek(state.week);$('#week-title').textContent=`${longDate(dates[0])} — ${longDate(dates[6])}`;
  $('#jump-date').value=state.week;$('#category').value=state.category;$('#scenario').value=state.scenario;
  $('#previous-week').disabled=shiftWeek(state.week,-1)===state.week;$('#next-week').disabled=shiftWeek(state.week,1)===state.week;
  const c=projection.coverage;$('#coverage-summary').textContent=`${c.recordedDays} / ${c.totalDays} 天有片刻文字 · ${c.recordCount} 則合成記錄 · ${c.unrecordedDays} 天未記錄`;
  $('#date-title').textContent=weekly?'本期日期索引':'沿著日子，找回片刻';$('#all-dates').setAttribute('aria-pressed',String(state.date===null));renderDates(projection);
  const subject=state.date?`${longDate(state.date)}留下的片刻`:weekly?'這一週，慢慢讀。':'這一週留下的片刻';$('#reading-title').textContent=subject;$('#reading-kicker').textContent=weekly?'THE ORDINARY IS A STORY':'MOMENT LOG';
  $('#reading-note').textContent=weekly?'開篇取目前結果最早一則，其餘按情境編排。不是最佳片刻，也不是模型推薦。':'按日期排列。每一則都是合成文字，不代表整天的全部。';
  $('#result-count').textContent=`${state.date?longDate(state.date):'整週'} · ${state.category==='all'?'所有情境':categoryFor(state.category).label} · ${projection.items.length} 則符合`;
  $('#recap-content').replaceChildren(weekly?weeklyContent(projection):atlasContent(projection));
  $('#empty-state').hidden=projection.items.length>0;
  if(!projection.items.length){
    $('#empty-title').textContent=projection.emptyReason==='filtered'?'有留下片刻，只是這個情境沒有結果。':state.date?'這一天，還沒有片刻文字。':'這一週，先留一點空白。';
    $('#empty-copy').textContent=projection.emptyReason==='filtered'?'其他情境的記錄仍在。清除日期與情境篩選，就能重新閱讀這一週。':'未記錄不代表沒有發生，也不是零活動或零分。這份示例不推測空白日子的生活。';
    const noWeekData=projection.coverage.recordCount===0;$('#empty-action').textContent=noWeekData?'返回一般示例的最新一週':'回到整週、所有情境';$('#empty-action').dataset.reset=String(noWeekData);
  }
  if(focusId){const target=document.getElementById(focusId);if(target&&!target.disabled)target.focus({preventScroll:true});else $('#jump-date').focus({preventScroll:true});}
}
function openDetail(item,triggerId){
  returnId=triggerId;$('#detail-art').replaceChildren(illustration(item.art,'detail-illustration'));$('#detail-title').textContent=item.title;$('#detail-meta').textContent=`2026/${shortDate(item.date)} · ${item.time} · ${categoryFor(item.category).label} · 全合成`;
  $('#detail-snippet').textContent=item.snippet;$('#detail-body').textContent=item.detail;$('#detail-quote').textContent=`合成引述：${item.note}`;$('#moment-dialog').showModal();$('#moment-dialog').scrollTop=0;$('#close-detail').focus({preventScroll:true});
}
for(const view of ['atlas','weekly'])$('#view-'+view).addEventListener('click',()=>setState({type:'view',value:view},'view-'+view,'已切換讀法，週、日期和情境篩選保留。'));
for(const [id,direction] of [['previous-week',-1],['next-week',1]])$('#'+id).addEventListener('click',()=>setState({type:'week',value:shiftWeek(state.week,direction)},id,'已切換示例週。情境篩選保留。'));
$('#jump-date').addEventListener('change',event=>{
  const value=event.target.value;const valid=weekOf(value)&&value>=SAMPLE_RANGE.start&&value<=SAMPLE_RANGE.end;
  $('#date-error').hidden=Boolean(valid);if(!valid){$('#date-error').textContent='請選 2026/10/19 至 2026/11/01 之間的有效日期。原本的回顧沒有改變。';event.target.setAttribute('aria-invalid','true');return;}
  event.target.removeAttribute('aria-invalid');setState({type:'week',value},'jump-date','已定位到所選日期的週。');
});
$('#category').addEventListener('change',event=>setState({type:'category',value:event.target.value},null,'已更新情境篩選，整週資料覆蓋不變。'));
$('#scenario').addEventListener('change',event=>setState({type:'scenario',value:event.target.value},null,'已切換合成資料情境，沒有載入外部資料。'));
$('#all-dates').addEventListener('click',()=>setState({type:'date',value:null},'all-dates','已顯示整週，情境篩選保留。'));
$('#clear-filters').addEventListener('click',()=>setState({type:'clear'},'clear-filters','已清除日期與情境篩選。'));
$('#empty-action').addEventListener('click',()=>{const reset=$('#empty-action').dataset.reset==='true';setState(reset?{type:'restore'}:{type:'clear'},'all-dates',reset?'已返回一般示例的最新一週。':'已顯示整週所有情境。');});
$('#reset-demo').addEventListener('click',()=>{$('#date-error').hidden=true;$('#jump-date').removeAttribute('aria-invalid');setState({type:'reset'},'reset-demo','已重設本頁示例。沒有更改任何正式資料。');});
for(const id of ['close-detail','return-detail'])$('#'+id).addEventListener('click',()=>$('#moment-dialog').close());
$('#moment-dialog').addEventListener('close',()=>{const target=returnId&&document.getElementById(returnId);(target??$('#all-dates')).focus({preventScroll:true});returnId=null;});
$('#moment-dialog').addEventListener('keydown',event=>{
  if(event.key!=='Tab')return;
  const controls=[...$('#moment-dialog').querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex="0"]')];
  const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
});
render();
