(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.CPModel=api;})(globalThis,function(){
  'use strict';
  const definitions=[
    ['age','年齡資料','基本資料'],['dueDate','預產期','基本資料'],['gestationalWeeksRaw','出生孕週原文','基本資料'],['region','地區','基本資料'],['language','語言','基本資料'],
    ['allergies','過敏資料','照顧資料'],['specialNeeds','特別需要','照顧資料'],['preferences','照顧偏好','照顧資料'],
    ['source','資料來源','來源與確認'],['validUntil','資料有效至','來源與確認'],['version','版本','來源與確認'],['confirmedByLabel','確認人標籤','來源與確認'],['confirmedAtLabel','確認時間標籤','來源與確認'],['reason','確認／更正原因','來源與確認']
  ];
  const units={days:'日',weeks:'星期',months:'個月',years:'歲'};
  const optional=['dueDate','gestationalWeeksRaw','region','language','allergies','specialNeeds','preferences','validUntil'];
  const nullable=v=>v===null||typeof v==='string';
  function validRevision(r){
    if(!r||!Number.isSafeInteger(r.version)||r.version<0||!['confirmedByLabel','confirmedAtLabel','reason'].every(k=>nullable(r[k])))return false;
    if(r.data===null)return true;
    if(r.version===0||!r.data||typeof r.data.source!=='string'||!optional.every(k=>nullable(r.data[k])))return false;
    const age=r.data.age;
    return !!age&&(age.kind==='unknown'||age.kind==='birth_date'&&typeof age.date==='string'||age.kind==='approximate'&&typeof age.rawValue==='string'&&Object.hasOwn(units,age.unit)&&typeof age.asOf==='string');
  }
  function fields(r){
    if(!r)return [];
    return definitions.filter(([id])=>r.data!==null||['version','confirmedByLabel','confirmedAtLabel','reason'].includes(id)).map(([id,label,group])=>{
      const raw=['version','confirmedByLabel','confirmedAtLabel','reason'].includes(id)?r[id]:r.data[id];
      let value=raw===null?'未知（未提供）':raw===''?'空字串（未提供內容；不代表沒有）':String(raw);
      let state=raw===null?'unknown':raw===''?'empty':'provided';
      let details=[['資料種類',raw===null?'null（未提供）':typeof raw],['原值',raw===null?'null':String(raw)]];
      if(id==='age'){
        if(raw.kind==='unknown'){value='未知';state='unknown';details=[['種類','unknown（未知）']];}
        if(raw.kind==='birth_date'){value=`出生日期 ${raw.date}`;details=[['種類','出生日期'],['日期原值',raw.date]];}
        if(raw.kind==='approximate'){value=`約 ${raw.rawValue} ${units[raw.unit]}（截至 ${raw.asOf}）`;details=[['種類','約數年齡'],['原值',raw.rawValue],['單位原值',raw.unit],['截至原值',raw.asOf]];}
      }
      const note=id==='allergies'?'未知或空白不代表沒有過敏。':id==='age'?'按原有年齡基準閱讀，不推算生日或矯正年齡。':id==='validUntil'?'保留來源提供的期限；不推算健康風險，也不代表剛完成核對。':id==='confirmedByLabel'?'來源匯入的確認，不等於本人在本次閱讀確認。':id==='confirmedAtLabel'?'這是宿主提供的顯示標籤，不重新當作 API 時間解析。':id==='source'?'來源為資料記錄，並非醫療結論或新的分享授權。':'保留原始內容；未提供不代表沒有或不需要。';
      return {id,label,group,value,state,details,note};
    });
  }
  function status(s){
    if(s.disposed)return {code:'disposed',title:'閱讀已結束',body:'這個合成宿主已結束，不再接受舊控制。'};
    if(!s.binding)return {code:'no-child',title:'尚未提供孩子範圍',body:'目前沒有可讀對象。這不是孩子名冊或新增入口。'};
    if(s.access==='lost')return {code:'lost',title:'存取已失效',body:'已清除原有檔案內容。舊控制與讀取結果均不可沿用。'};
    if(s.unavailable)return {code:'unavailable',title:'目前不可閱讀',body:s.unavailable};
    if(s.readState==='loading')return {code:'loading',title:s.current?'正在重讀，先保留上次資料':'正在讀取合成檔案',body:s.current?'上次內容尚未重新核對；新結果未到前不視為最新。':'還沒有已讀內容，不把等待顯示為空檔案。'};
    if(s.error)return {code:s.current?'stale-error':'error',title:s.current?'重讀未成功，保留上次資料':'尚未成功讀取',body:s.error};
    if(!s.current)return {code:'neverRead',title:'尚未讀取檔案',body:s.online?'請使用下方合成示例控制讀取。':'目前離線，沒有可用的已讀內容。'};
    if(s.stale)return {code:'stale',title:'上次已讀資料，尚未核對',body:s.online?'已回到線上，仍須重讀才能更新。':'離線保留供閱讀，不表示資料仍有效。'};
    if(s.current.data===null)return {code:'empty',title:'尚無已確認檔案',body:`已成功讀取版本 ${s.current.version}；這和未讀或讀取失敗不同。`};
    return {code:'ready',title:'已讀取合成檔案',body:'閱讀原有欄位與標籤，不作健康或發展判斷。'};
  }
  return Object.freeze({fields,status,validRevision});
});
