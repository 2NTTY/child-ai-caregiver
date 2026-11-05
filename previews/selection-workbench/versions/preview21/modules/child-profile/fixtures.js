(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.CPFixtures=api;})(globalThis,function(){
  'use strict';
  function binding(extra={}){return {identityEpoch:'合成使用者A/1',scopeKey:'個人／合成孩子A／唯讀',childId:'synthetic-child-A',childName:'合成小禾',authorityFingerprint:'synthetic-personal-profile',...extra};}
  function revision(){return {version:7,data:{age:{kind:'approximate',rawValue:' 04.50 ',unit:'months',asOf:'2026-10-30'},dueDate:null,gestationalWeeksRaw:' 37+2 ',region:'合成地區',language:'廣東話、繁體中文',allergies:null,specialNeeds:null,preferences:'合成示例：接觸新物件前，先用短句說明；留一點時間觀察。不從這些偏好推論疾病或發展狀態。',source:'合成來源紀錄：紙本摘錄示例，沒有真實家庭、照片或健康資料。',validUntil:'2026-11-30'},confirmedByLabel:'來源確認：合成照顧者（並非本人本次確認）',confirmedAtLabel:'2026/10/30 09:15（宿主提供的香港時間標籤）',reason:'合成更正說明：保留原文，沒有重新核對健康事實。'};}
  const options=[['full','完整欄位 · 來源匯入'],['long','長文字與連續字串'],['unknown','已讀但欄位未知'],['birthday','出生日期基準'],['empty','版本 0 · 無檔案'],['unread','尚未讀取'],['loading','首次讀取中'],['offline','離線保留上次資料'],['error','首次讀取失敗'],['stale-error','重讀失敗保留資料'],['lost','存取失效'],['unavailable','宿主暫不可讀'],['no-child','沒有孩子範圍'],['identity-b','另一身份 · 同名孩子'],['shared','相同孩子 ID · 共享範圍']];
  function get(id){
    if(!options.some(([key])=>key===id))throw new TypeError('Unknown synthetic fixture');
    const r=revision();const spec={binding:binding(),access:'read_only',online:true,current:r};
    if(id==='long'){r.data.preferences='合成長文：照顧者可完整記錄需要留意的說明，內容不因欄寬而截斷，也不以完成度或風險分數取代原文。\n'.repeat(6)+'長字串示例：SyntheticProfileSourceWithoutSpaces_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';r.data.source='合成匯入來源鏈：家庭紙本示例 → 人手轉錄示例 → 原資料保留示例。'.repeat(5);r.data.allergies='';}
    if(id==='unknown'){r.version=2;r.data={age:{kind:'unknown'},dueDate:null,gestationalWeeksRaw:null,region:null,language:null,allergies:null,specialNeeds:null,preferences:null,source:'',validUntil:null};r.confirmedByLabel=null;r.confirmedAtLabel=null;r.reason=null;}
    if(id==='birthday'){r.data.age={kind:'birth_date',date:'2025-04-03'};r.confirmedByLabel='合成本人（來源原有確認標籤；非本次閱讀確認）';}
    if(id==='empty'){Object.assign(r,{version:0,data:null,confirmedByLabel:null,confirmedAtLabel:null,reason:null});}
    if(['unread','loading','error','lost','unavailable','no-child'].includes(id))spec.current=null;
    if(id==='loading')spec.loading=true;
    if(id==='offline')spec.offlineAfterRead=true;
    if(id==='error'||id==='stale-error')spec.error='合成讀取失敗。未連線任何服務，可用合成控制再次閱讀。';
    if(id==='lost')spec.access='lost';
    if(id==='unavailable')spec.unavailable='合成宿主表示目前帳戶不可讀；不是空檔案，也不是新增入口。';
    if(id==='no-child')spec.binding=null;
    if(id==='identity-b')spec.binding=binding({identityEpoch:'合成使用者B/1',childId:'synthetic-child-B',scopeKey:'個人／合成孩子B／唯讀',authorityFingerprint:'synthetic-user-B-profile'});
    if(id==='shared')spec.binding=binding({scopeKey:'共享示例空間／合成孩子A／viewer',authorityFingerprint:'synthetic-grant-2-profile'});
    return spec;
  }
  return Object.freeze({options,get,revision});
});
