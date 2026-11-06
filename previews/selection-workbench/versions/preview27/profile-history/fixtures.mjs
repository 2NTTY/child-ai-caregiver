// Entirely synthetic ProfileRevisionView projections. No API, model or personal data.
const base={age:{kind:'approximate',rawValue:'01.50',unit:'years',asOf:'2026-10-01'},dueDate:null,gestationalWeeksRaw:null,region:'合成地區',language:'廣東話、普通話（合成）',allergies:null,specialNeeds:null,preferences:'喜歡安靜的閱讀角。請先說明下一步，再一起收拾。\n這是合成記錄原文，不是醫療建議。',source:'合成家長的日常補充',validUntil:null};
export const revision=(version,data=base,reason='補充照顧偏好')=>({version,data:data&&structuredClone(data),confirmedByLabel:'合成照顧者甲',confirmedAtLabel:'2026/10/20 08:30',reason});
export const older=()=>[revision(3,{...base,age:{kind:'birth_date',date:'2025-04-01'},preferences:'喜歡圖畫書（合成原文）',source:'合成匯入原文'},'補充日常資料'),{...revision(2,{...base,age:{kind:'unknown'},preferences:null,source:'合成初始資料'},null),confirmedByLabel:null,confirmedAtLabel:null}];
export function scenario(id='ready',child='a'){
 const s={scopeKey:'synthetic:parent:epoch1:child-'+child,child:{id:'child-'+child,name:'小禾（合成）'},access:'read_only',online:true,reading:false,needsRefresh:false,current:revision(6),history:[revision(5),{...revision(4,null,'此版沒有已確認檔案'),confirmedAtLabel:null,confirmedByLabel:null}],historyOpen:true,hasMoreHistory:true,operation:{state:'none',reference:null,message:''},notice:null,pending:null};
 if(id==='cold')Object.assign(s,{current:null,history:[],historyOpen:false,hasMoreHistory:false});
 if(id==='zero')Object.assign(s,{current:{...revision(0,null,null),confirmedAtLabel:null,confirmedByLabel:null},history:[],historyOpen:false,hasMoreHistory:false});
 if(id==='empty')Object.assign(s,{history:[],hasMoreHistory:false});
 if(id==='partial-empty')Object.assign(s,{history:[],hasMoreHistory:true});
 if(id==='offline')s.online=false;
 if(id==='operation-unknown')s.operation={state:'unknown',reference:null,message:'合成原操作結果未確認。請回原檔案頁查核。'};
 if(id==='loading')s.reading=true;
 if(id==='stale'){s.needsRefresh=true;s.notice='未能核對目前檔案；舊讀窗保留。';}
 if(id==='first-error')Object.assign(s,{history:[],historyOpen:false,notice:'未能讀取檔案歷史，請手動重試。'});
 if(id==='lost')Object.assign(s,{child:null,access:'lost',current:null,history:[],historyOpen:false,hasMoreHistory:false});
 if(id==='long'){s.history[0].data.preferences=('合成長文：請保留整段內容與換行。'.repeat(160))+'\n<img src=x onerror="alert(1)">';s.history[0].reason='完整長原因／'.repeat(40)}
 return s;
}
export const scenarios=[['ready','已讀兩版'],['cold','尚未核對'],['loading','正在讀取'],['zero','已核對零版'],['empty','成功空窗'],['partial-empty','空頁但還有更早'],['first-error','首次歷史失敗'],['stale','當前核對失敗'],['offline','離線舊讀窗'],['operation-unknown','原操作未確認'],['lost','權限失效'],['long','長文與特殊字元']];
