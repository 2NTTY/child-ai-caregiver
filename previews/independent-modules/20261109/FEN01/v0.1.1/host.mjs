export const FIELDS=Object.freeze([{id:'title',label:'示例標題'},{id:'category',label:'示例分類'},{id:'note',label:'示例說明'}]);
const messageFor=field=>`請填寫${field.label}；這只是合成欄位的檢查。`;
// This tiny fixture validator is outside the summary renderer. It is not any product schema.
function fixtureErrors(values){return FIELDS.filter(f=>!values[f.id].trim()).map(f=>({field:f.id,label:f.label,message:messageFor(f)}));}
function announcement(entries){return entries.length?`有 ${entries.length} 項資料需要修正。${entries.map(e=>`${e.label}：${e.message}`).join(' ')}`:'';}
export function initial(){const values={title:'',category:'',note:''};return {scope:'demo-A',layout:'A',values,entries:fixtureErrors(values),selected:'title',detailsOpen:false,locked:false,revision:0,announcement:'',feedback:'錯誤來自上一次合成檢查；輸入後須明確重新檢查。'};}
export function canFocus(s,field){return !s.locked&&FIELDS.some(f=>f.id===field)&&s.entries.some(e=>e.field===field);}
export function reduce(s,e){
 if(!e||typeof e!=='object')return s;
 if(e.type==='layout')return ['A','B'].includes(e.value)&&e.value!==s.layout?{...s,layout:e.value}:s;
 if(e.type==='edit')return !s.locked&&FIELDS.some(f=>f.id===e.field)&&typeof e.value==='string'?{...s,values:{...s.values,[e.field]:e.value},feedback:'草稿已改動；錯誤仍是上一次檢查結果。沒有保存。'}:s;
 if(e.type==='choose')return s.entries.some(item=>item.field===e.field)&&s.selected!==e.field?{...s,selected:e.field}:s;
 if(e.type==='step'){
  if(![-1,1].includes(e.delta))return s;const index=s.entries.findIndex(item=>item.field===s.selected),next=index+e.delta;
  return index>=0&&next>=0&&next<s.entries.length?{...s,selected:s.entries[next].field}:s;
 }
 if(e.type==='details')return typeof e.value==='boolean'&&s.detailsOpen!==e.value?{...s,detailsOpen:e.value}:s;
 if(e.type==='lock')return typeof e.value==='boolean'&&s.locked!==e.value?{...s,locked:e.value,feedback:e.value?'合成欄位已鎖定；不能編輯或移動焦點到欄位。':'合成欄位已解鎖；草稿及錯誤保留。'}:s;
 if(e.type==='scope')return ['demo-A','demo-B'].includes(e.value)&&e.value!==s.scope?{...initial(),scope:e.value,layout:s.layout,revision:s.revision+1,feedback:'已切換合成表單，並重設草稿、錯誤、選取及補充欄位；只保留布局。'}:s;
 if(e.type==='fill')return s.locked?s:{...s,values:{title:'紙船小實驗',category:'合成活動',note:'把三隻不同形狀的紙船放到清水盤，比較浮起的樣子。'},feedback:'已放入完整合成範例；尚未重新檢查，沒有保存。'};
 if(e.type==='check'){
  if(s.locked)return s;const entries=fixtureErrors(s.values),changed=announcement(entries)!==announcement(s.entries);
  return {...s,entries,selected:entries.some(item=>item.field===s.selected)?s.selected:entries[0]?.field??null,revision:s.revision+1,announcement:changed?announcement(entries):s.announcement,feedback:entries.length?`本次合成檢查：${entries.length} 項待修正。沒有保存。`:'本次合成檢查未發現空白欄位。這不等於正式驗證，也沒有保存。'};
 }
 if(e.type==='long-errors'){
  const entries=[{field:'title',label:'示例欄位',message:'這是一則完整保留的合成長錯誤。請回到標題欄位檢查原本輸入，不要只憑摘要認為已修正。'.repeat(4)},{field:'category',label:'示例欄位',message:'這是另一個同名標籤的欄位，實際對應示例分類。辨識依 field ID，不是標籤文字。'},{field:'note',label:'示例說明',message:'補充欄位目前可能收起，前往欄位會先展開它。'}];
  return {...s,entries,selected:entries.some(item=>item.field===s.selected)?s.selected:'title',revision:s.revision+1,announcement:announcement(entries),feedback:'合成宿主已提供長錯誤snapshot；草稿保持原樣。'};
 }
 return s;
}
