import {REFERENCE_DAY,TASKS,RANGES} from './data.mjs';
const DAY=86400000;
const dateObject=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value)?new Date(value+'T00:00:00Z'):null;
export function validDay(value){const d=dateObject(value);return !!d&&Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value&&+value.slice(0,4)>=1000;}
const iso=d=>d.toISOString().slice(0,10);
const addDays=(value,amount)=>iso(new Date(dateObject(value).getTime()+amount*DAY));
export function shiftMonth(month,amount){
 if(typeof month!=='string'||!/^\d{4}-\d{2}$/.test(month)||!validDay(month+'-01')||!Number.isInteger(amount))return null;
 const d=dateObject(month+'-01');d.setUTCMonth(d.getUTCMonth()+amount);const result=iso(d).slice(0,7);return validDay(result+'-01')?result:null;
}
function monthLength(month){const end=dateObject(month+'-01');end.setUTCMonth(end.getUTCMonth()+1,0);return end.getUTCDate();}
function shiftDayMonth(day,amount){const month=shiftMonth(day.slice(0,7),amount);if(!month)return day;return month+'-'+String(Math.min(+day.slice(-2),monthLength(month))).padStart(2,'0');}
export function taskDay(task){
 const value=task.dueAt;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)||!validDay(value.slice(0,10)))return null;
 const time=Date.parse(value);if(!Number.isFinite(time))return null;const local=iso(new Date(time+8*3600000));return validDay(local)?local:null;
}
export function taskTime(task){const date=taskDay(task);if(!date)return '時間待核對';const d=new Date(Date.parse(task.dueAt)+8*3600000);return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;}
export function dayLabel(day,short=false){if(!validDay(day))return '日期待核對';const d=dateObject(day),week='日一二三四五六'[d.getUTCDay()];return `${short?'':d.getUTCFullYear()+'年'}${d.getUTCMonth()+1}月${d.getUTCDate()}日 星期${week}`;}
export function monthLabel(month){return validDay(month+'-01')?`${+month.slice(0,4)}年${+month.slice(5)}月`:'月份待核對';}
const pending=tasks=>tasks.filter(t=>t.state==='scheduled'||t.state==='needs_review');
export function initialState(){return {layout:'route',selectedDay:REFERENCE_DAY,month:'2026-11',focusDay:REFERENCE_DAY,filter:'near',query:'',detailId:null};}
export function reduce(state,action){
 switch(action.type){
 case 'layout':return ['route','folio'].includes(action.value)?{...state,layout:action.value}:state;
 case 'day':return validDay(action.value)?{...state,selectedDay:state.selectedDay===action.value?null:action.value,focusDay:action.value,month:action.value.slice(0,7),detailId:null}:state;
 case 'clear-day':return {...state,selectedDay:null,detailId:null};
 case 'range':return RANGES.some(([key])=>key===action.value)?{...state,filter:action.value,selectedDay:null,detailId:null}:state;
 case 'query':return {...state,query:String(action.value),detailId:null};
 case 'month':{const next=shiftMonth(state.month,action.amount);if(!next)return state;const oldFocus=state.focusDay.slice(0,7)===state.month?state.focusDay:state.month+'-01';return {...state,month:next,focusDay:shiftDayMonth(oldFocus,action.amount)};}
 case 'week':{const next=addDays(state.focusDay,action.amount*7);return validDay(next)?{...state,focusDay:next,month:next.slice(0,7)}:state;}
 case 'focus':return validDay(action.value)?{...state,focusDay:action.value,month:action.value.slice(0,7)}:state;
 case 'reference':return {...state,month:REFERENCE_DAY.slice(0,7),focusDay:REFERENCE_DAY};
 case 'detail':return {...state,detailId:action.value};
 case 'close-detail':return {...state,detailId:null};
 case 'reset':return {...state,filter:'all',selectedDay:null,query:'',detailId:null};
 default:return state;
 }
}
export function project(state,tasks=TASKS){
 const counts={near:0,earlier:0,later:0,review:0,unconfirmed:0,all:0};
 const entries=pending(tasks).map((task,index)=>{const date=taskDay(task),bucket=!date?'unconfirmed':date<REFERENCE_DAY?'earlier':date<'2026-11-11'?'near':'later';counts.all++;counts[bucket]++;if(task.state==='needs_review')counts.review++;return {task,date,bucket,index};});
 const query=state.query.trim().toLocaleLowerCase('zh-HK');
 const eligible=entries.filter(({task,date,bucket})=>state.selectedDay?date===state.selectedDay:state.filter==='all'||(state.filter==='review'?task.state==='needs_review':state.filter===bucket));
 const matched=eligible.filter(({task})=>!query||[task.title,task.details,task.assignee].some(v=>v.toLocaleLowerCase('zh-HK').includes(query)));
 matched.sort((a,b)=>a.date&&!b.date?-1:!a.date&&b.date?1:a.date&&b.date?Date.parse(a.task.dueAt)-Date.parse(b.task.dueAt)||a.index-b.index:a.index-b.index);
 return {items:matched.map(({task})=>task),counts,total:matched.length,emptyReason:matched.length?null:query?'query':state.selectedDay?'day':'range',selectedTotal:eligible.length};
}
export function calendarCells(month,tasks=TASKS){
 if(!validDay(month+'-01'))return [];
 const counts=new Map();for(const t of pending(tasks)){const day=taskDay(t);if(!day)continue;const c=counts.get(day)||{scheduled:0,review:0};c[t.state==='needs_review'?'review':'scheduled']++;counts.set(day,c);}
 const first=dateObject(month+'-01');
 const days=monthLength(month),cells=Array((first.getUTCDay()+6)%7).fill(null);
 for(let n=1;n<=days;n++){const date=month+'-'+String(n).padStart(2,'0');cells.push({date,day:n,...(counts.get(date)||{scheduled:0,review:0})});}
 while(cells.length%7)cells.push(null);return cells;
}
export function weekDates(day){if(!validDay(day))return [];const start=addDays(day,-((dateObject(day).getUTCDay()+6)%7));return Array.from({length:7},(_,i)=>addDays(start,i)).filter(validDay);}
export function moveFocus(day,key,shift=false){
 if(!validDay(day))return null;
 const moves={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};
 if(key in moves){const next=addDays(day,moves[key]);return validDay(next)?next:day;}
 if(key==='Home')return weekDates(day)[0];if(key==='End')return weekDates(day).at(-1);
 if(key==='PageUp'||key==='PageDown')return shiftDayMonth(day,(key==='PageUp'?-1:1)*(shift?12:1));return null;
}
