export const fields=[['age','年齡資料'],['dueDate','預產期'],['gestationalWeeksRaw','出生孕週原文'],['region','地區'],['language','語言'],['allergies','過敏資料'],['specialNeeds','特別需要'],['preferences','照顧偏好'],['source','資料來源'],['validUntil','資料有效至']];
const units={days:'日',weeks:'星期',months:'個月',years:'歲'};
export function fieldValue(row,key){if(row.data===null)return '沒有已確認檔案';const v=row.data[key];if(key==='age'){if(v.kind==='unknown')return '未知';if(v.kind==='birth_date')return '出生日期 '+v.date;return `約 ${v.rawValue} ${units[v.unit]}（截至 ${v.asOf}）`;}return v??'未知';}
export function visibleRows(s,query=''){if(s.access==='lost'||!s.child)return [];const q=query.trim().toLocaleLowerCase();return s.history.filter(r=>!q||[String(r.version),r.reason,r.confirmedAtLabel,r.confirmedByLabel,...fields.map(([k])=>fieldValue(r,k))].filter(v=>v!==null).join('\n').toLocaleLowerCase().includes(q));}
export function readStatus(s){
 if(s.access==='lost'||!s.child)return {kind:'unavailable',text:'孩子權限已失效或尚未選擇，檔案歷史已隱藏。'};
 if(['saving','unknown','conflict'].includes(s.operation.state))return {kind:'operation',text:'檔案有未完成原操作。請回原檔案頁查核；此候選沒有重送或還原操作。'};
 if(!s.online)return {kind:'offline',text:'目前離線。已載入版本保留，最新歷史尚未核對。'};
 if(s.reading)return {kind:'loading',text:'正在讀取合成檔案歷史，已讀內容仍可閱讀。'};
 if(s.needsRefresh||!s.current)return {kind:'unknown',text:s.notice||'目前檔案尚未核對，不能據此判斷沒有修改記錄。'};
 if(s.notice)return {kind:'error',text:s.notice+' 已讀內容與分頁位置保留。'};
 if(s.current.version===0)return {kind:'empty',text:'尚未有檔案修改記錄：這位孩子的檔案尚未確認。'};
 if(!s.historyOpen)return {kind:'unknown',text:'尚未讀取較早版本。'};
 if(!s.history.length)return s.hasMoreHistory?{kind:'partial-empty',text:'這一頁沒有較早版本，仍可繼續讀取。'}:{kind:'empty',text:'目前已讀取的版本範圍沒有較早記錄。'};
 return {kind:'ready',text:`已載入 ${s.history.length} 個較早版本。${s.hasMoreHistory?'仍有更早版本未讀取。':'本次分頁已讀至末頁。'}`};
}
export function readMode(s){if(s.access==='lost'||!s.child)return null;if(!s.current||s.needsRefresh)return 'current';if(s.current.version===0)return null;if(!s.historyOpen)return 'first';return s.hasMoreHistory?'more':null;}
export function canRead(s,mode){return !!mode&&!s.paused&&!s.reading&&s.online&&s.access!=='lost'&&!!s.child&&!['saving','unknown','conflict'].includes(s.operation.state)&&(mode==='current'||!!s.current&&!s.needsRefresh&&s.current.version>0&&(mode!=='more'||s.historyOpen&&s.hasMoreHistory));}
