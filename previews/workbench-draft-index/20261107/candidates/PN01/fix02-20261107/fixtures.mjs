// Synthetic data only. These finite responses do not implement backend search semantics.
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const at='2026-11-07T08:00:00Z';
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
export const notes=freeze(Array.from({length:21},(_,i)=>({
 id:uuid(i+1),childId:uuid(90),version:1,title:i===0?'偏好的示例文字與排版':`合成備註 ${i+1}`,
 text:i===0?'這是合成排版偏好，不是健康事實。\n請用清楚的短句。<img src=x onerror=alert(1)>\n'+('完整可選正文，用於核對閱讀。'.repeat(35)):`合成示例 ${i+1}：請把標題與內文分開。`,
 sourceMessageId:i===1?null:uuid(100+i),createdAt:at,updatedAt:at,provenance:i===1?'imported_source':'user_statement',
 ...(i===1?{importedFrom:{current:{source:{serverId:'synthetic-server',accountId:'synthetic-account',childId:uuid(90),section:'instructions',resourceId:uuid(2),resourceVersion:1,authorUserId:null,createdAt:at,confirmedBy:null,confirmedAt:null,confirmationBasis:'imported_source',assigneeUserId:null},sourceHash:'0'.repeat(64),packageId:uuid(200),packageVersion:1,manifestSha256:'0'.repeat(64),integrity:'missing_proof',importedBy:'synthetic-owner',importedAt:at},previous:[]}}:{})
})));
export function fixturePage(query,after){
 if(query==='')return after?{items:[notes[20]],nextAfterId:null}:{items:notes.slice(0,20),nextAfterId:notes[19].id};
 if(query==='示例')return {items:[notes[0],notes[1]],nextAfterId:null};
 if(query==='空頁')return after?{items:[notes[20]],nextAfterId:null}:{items:[],nextAfterId:notes[19].id};
 return {unsupported:true,items:[],nextAfterId:null};
}
