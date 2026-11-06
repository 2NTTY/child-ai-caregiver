// Original presentation projection. No formal API schema, writer or controller is imported.
const lex=(a,b)=>a<b?-1:a>b?1:0;
export function timeInfo(raw) {
 const m=typeof raw==='string'&&/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(raw);
 if(!m)return{raw,known:false,epoch:null,day:null,label:'時間未提供／不可解析'};
 const [,y,mo,d,h,mi,s]=m,days=new Date(Date.UTC(+y,+mo,0)).getUTCDate();
 const epoch=Date.parse(raw);
 if(+mo<1||+mo>12||+d<1||+d>days||+h>23||+mi>59||+s>59||!Number.isFinite(epoch))return{raw,known:false,epoch:null,day:null,label:'時間未提供／不可解析'};
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(epoch));
 const v=t=>parts.find(x=>x.type===t)?.value;
 const day=`${v('year')}-${v('month')}-${v('day')}`;
 return{raw,known:true,epoch,day,label:`${day} ${v('hour')}:${v('minute')} 香港時間`};
}
export const concernKey=c=>JSON.stringify([c.childId,c.id,c.version]);
export function compareEntries(a,b){
 const l=timeInfo(a.at),r=timeInfo(b.at);
 if(l.known&&r.known&&l.epoch!==r.epoch)return r.epoch-l.epoch;
 if(l.known!==r.known)return l.known?-1:1;
 return lex(a.key,b.key);
}
export function entriesFor(concern,page){
 const base={concern,concernKey:concernKey(concern)};
 const rows=concern.events.map(record=>({...base,kind:'event',record,at:record.at,timeKind:'事件時間',key:JSON.stringify([concern.childId,concern.id,concern.version,'event',record.id])}));
 for(const record of page.items??[]){
  if(record.childId!==concern.childId||!concern.attentionIds.includes(record.id)||record.state==='proposed')continue;
  if(concern.events.some(e=>e.kind==='confirmed_action'&&e.attentionId===record.id&&e.attentionVersion===record.version))continue;
  rows.push({...base,kind:'attention',record,at:record.updatedAt,timeKind:'建議狀態更新時間',key:JSON.stringify([concern.childId,concern.id,concern.version,'attention',record.id,record.version])});
 }
 return rows.sort(compareEntries);
}
export const evidenceLabel=version=>Number.isInteger(version)&&version>0?`孩子檔案版本 ${version}`:'檔案依據未提供／目前不可核對（遮蔽、不吻合或匯入來源不可用）';
const text=v=>String(v??'').toLocaleLowerCase('zh-HK');
const contains=(values,q)=>!q||text(values.join('\n')).includes(text(q).trim());
export function filterConcerns(page,childId,filters={}){
 if(page?.concerns?.state!=='ready')return[];
 return page.concerns.items.filter(c=>{
  if(c.childId!==childId||filters.status&&filters.status!=='all'&&c.status!==filters.status)return false;
  if(!contains([c.id,c.title,c.reason,...c.events.flatMap(e=>[e.title,e.text,e.sourceLabel,e.at])],filters.q))return false;
  if(filters.from||filters.to){const t=timeInfo(c.archivedAt);if(c.status!=='closed'||!t.known||filters.from&&t.day<filters.from||filters.to&&t.day>filters.to)return false}
  return true;
 });
}
export function filterEntries(page,childId,filters={}){
 return filterConcerns(page,childId,{status:filters.status}).flatMap(c=>entriesFor(c,page)).filter(row=>{
  const r=row.record,t=timeInfo(row.at),kind=row.kind==='attention'?'attention':r.kind;
  if(filters.kind&&filters.kind!=='all'&&kind!==filters.kind)return false;
  if(filters.time==='unknown'&&t.known)return false;
  if((filters.from||filters.to)&&(!t.known||filters.from&&t.day<filters.from||filters.to&&t.day>filters.to))return false;
  return contains([row.concern.title,row.concern.reason,r.title,r.text,r.note,r.sourceLabel,r.source?.title,r.source?.excerpt,row.at],filters.q);
 }).sort(compareEntries);
}
export const attentionLabels={proposed:'待確認建議',snoozed:'建議已延後',accepted:'建議已接受',dismissed:'建議已關閉',inapplicable:'建議目前不適用'};
export const eventLabel=row=>row.kind==='attention'?attentionLabels[row.record.state]??'建議狀態未提供':row.record.kind==='confirmed_action'?'已確認操作':'原始觀察';
