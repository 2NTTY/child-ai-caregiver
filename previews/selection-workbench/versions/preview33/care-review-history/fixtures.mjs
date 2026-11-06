// Original synthetic examples. No real child, account, conversation or event IDs.
const examples=[
 ['feeding','飲食','說是喝了約半杯奶，杯子容量不清楚。','約半','杯','時間未能確定'],
 ['sleep','睡眠','午睡醒來後安靜看了一會兒窗外。','','','午飯後'],
 ['note','日常觀察','玩積木時反覆把兩塊排在一起，沒有推測原因。','','','未記下時間'],
 ['diaper','如廁／尿片','只記下照顧者說已換過尿片，沒有其他資料。','','','稍早'],
 ['measurement','身高／體重','量尺讀數寫成「大約 90」，單位尚未核對。','大約 90','未核對','不確定']
];
const labels=['已明確確認保存','已按來源確認資料匯入保存','已按預先授權保存使用者陳述；並非逐項確認的健康事實'];
export function makeInput(count=23){
 const childId='demo-child-a',scopeKey='demo-care:a';
 const items=Array.from({length:count},(_,index)=>{
  const [kind,title,text,quantityRaw,quantityUnit,eventTimeRaw]=examples[index%examples.length],id=`demo-record-${index+1}`,version=index===4?2:1;
  const values={kind,text:index===22?`${text} 合成關鍵字：月亮杯。`:text,source:'合成照顧筆記',quantityRaw,quantityUnit,quantityPrecision:'approximate',eventTimeRaw,reason:index===4?'保留更正理由原文：原讀數未核實。':'保存原句，不補推測。'};
  const current={version,values,eventTimePrecision:'unknown',timeZoneLabel:'Asia/Hong_Kong',confirmedByLabel:index%3===0?'合成照顧者甲':index%3===1?'來源確認：合成照顧者乙':'合成照顧者甲（預先授權保存的使用者陳述）',confirmedAtLabel:'合成標籤 · 未提供可推算事件時間'};
  const savedRecord={id,childId,title,createdAtLabel:'未提供加入日期',current,history:[]};
  return {id:`record:${id}`,version,childId,title,createdAtLabel:savedRecord.createdAtLabel,originalText:values.text,sourceLabel:values.source,sourceId:id,sourceVersion:String(version),sourceScope:'family',sourceState:'ready',proposedValues:values,target:{kind:'create',scope:'family'},targetDomain:'care_event',writeState:'saved',reviewRequirement:'optional',reviewState:index%3===0?'confirmed':'not_required',resolution:{label:labels[index%3],recordId:id,recordVersion:version},uncertainties:[],savedRecord};
 });
 return {context:{scopeKey,childId,authorityKey:'demo-authority',epoch:0},model:{child:{id:childId,name:'合成孩子甲',summary:'只供比較介面'},scopeKey,access:'read_only',online:true,dataLabel:'合成已載窗口',review:{state:'ready',scopeKey,items,hasMore:true,label:'目前已載保存記錄',capabilities:{create:false,update:false,skip:false,confirmImportant:false}},list:{state:'ready',hasSnapshot:true,records:items.map(i=>i.savedRecord),activeQuery:'',activeKind:'all',scanned:23,page:1,hasPrevious:false,hasMore:true,message:null},detail:null,draft:null,deletion:null,operation:{state:'none',message:'',reference:null,latest:null},submitLabel:'',checkLabel:''}};
}
