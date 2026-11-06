// Entirely invented examples. No external request, identity, storage or model use.
export function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
export const kinds=freeze(['family_document_change','task_create','task_change','memory_fact','memory_fact_revise','memory_fact_deactivate','private_source_create','private_source_change','concern_create','concern_change']);
const row=(label,value)=>({label,value});
const unknown=row('其他原始詳情／未識別欄','合成擴充值：保留原順序 α→β；不是執行指令。');
const sourceBoundary='只供本人，不建立家庭事實、訂閱或外發。修改正文會撤回原模型授權，之後須再次核對。此預覽不調用模型。';
const concernBoundary='結束關注不代表照護完成，也不取消相關任務；恢復不重新啟動舊跟進。不會自動外發通知。';
const sourceRows=()=>[row('用途','回答參考'),row('適用性聲稱','個人筆記 · 本週 · 只描述合成桌遊活動；不是已核實官方資料'),row('來源連結','https://example.invalid/synthetic-note（僅文字，不開啟）'),row('將保存的原文','合成筆記全文：星星喜歡在安靜角落拼圖。桌上放置海星貼紙；這只是測試文字，不描述真實孩子。'),row('明確授權交模型的片段','合成片段：星星喜歡在安靜角落拼圖。'),row('邊界',sourceBoundary)];
// Explicit local fixture pairs, not a backend version-allocation rule or wire payload.
const resources=freeze({
 family_document_change:{mode:'update',kind:'family_document',id:'document-synthetic-01',originalVersion:12,savedVersion:13},
 task_create:{mode:'create',kind:'task',id:'task-synthetic-created-01',originalVersion:null,savedVersion:1},
 task_change:{mode:'update',kind:'task',id:'task-synthetic-01',originalVersion:8,savedVersion:9},
 memory_fact:{mode:'create',kind:'memory_fact',id:'fact-synthetic-created-01',originalVersion:null,savedVersion:1},
 memory_fact_revise:{mode:'update',kind:'memory_fact',id:'fact-synthetic-01',originalVersion:6,savedVersion:7},
 memory_fact_deactivate:{mode:'update',kind:'memory_fact',id:'fact-synthetic-02',originalVersion:4,savedVersion:5},
 private_source_create:{mode:'create',kind:'private_source',id:'input-synthetic-created-01',originalVersion:null,savedVersion:1},
 private_source_change:{mode:'update',kind:'private_source',id:'input-synthetic-01',originalVersion:5,savedVersion:6},
 concern_create:{mode:'create',kind:'concern',id:'concern-synthetic-created-01',originalVersion:null,savedVersion:1},
 concern_change:{mode:'update',kind:'concern',id:'concern-synthetic-01',originalVersion:9,savedVersion:10}
});
export function readSyntheticResource(proposal){
 const r=proposal?.syntheticResource,expected=resources[proposal?.kind];
 if(!r||!expected||r.mode!==expected.mode||r.kind!==expected.kind||typeof r.id!=='string'||!r.id.trim()||!Number.isInteger(r.savedVersion)||r.savedVersion<1)return null;
 if(r.mode==='update'?(!Number.isInteger(r.originalVersion)||r.originalVersion<1||r.savedVersion<=r.originalVersion):r.originalVersion!==null)return null;
 return r;
}
const definitions={
 family_document_change:{title:'週末遊戲準備單',content:'核對以下指定修改後，保存到同一份家庭共享文件。這是一整份提案，不能逐行接受。',scope:'family',details:[row('原文件及版本','document-synthetic-01 · 12'),row('1. 修改文件資料','文件標題：週末遊戲準備單\n摘要：準備紙卡與安靜角落\n事情日期：2099-05-08'),row('2. 新增／修改項目','目標章節：section-synthetic-play\n目標項目：item-synthetic-sticker\n項目文字：將海星貼紙與紙卡放在矮桌。\n共享來源參照：source-synthetic-note'),row('3. 移動項目','目標章節：section-synthetic-play\n目標項目：item-synthetic-sticker\n移至：項目「item-synthetic-water」之前'),row('範圍','只共享列出的文件修改，不建立新事實或分享整段私人聊天。')]},
 task_create:{title:'整理紙卡材料',content:'合成任務詳細：準備十張彩色紙卡，核對是否放在有標籤的盒中。沒有實際指派或通知。',scope:'family',details:[row('種類','普通任務（ordinary）'),row('負責人','合成照顧者甲'),row('負責人識別','user-synthetic-helper-A'),row('到期時間','2099-05-08T17:00:00+08:00'),row('時區','Asia/Hong_Kong')]},
 task_change:{title:'整理紙卡材料／合成照顧者乙',content:'合成備註：改至週日下午，由合成照顧者乙整理。這不是已完成紀錄。',scope:'family',details:[row('操作','改期／轉派'),row('原任務','task-synthetic-01'),row('原任務版本','8'),row('新到期時間','2099-05-09T16:00:00+08:00'),row('時區','Asia/Hong_Kong'),row('新負責人識別','user-synthetic-helper-B')]},
 memory_fact:{title:'合成偏好：拼圖角落',content:'合成完整正文：星星偏好在安靜角落拼圖，旁邊放一張小桌。此句不是對真實家庭的推斷。',scope:'private',details:[row('來源','你在這次聊天提供的內容，需由你核對'),row('接受後可見範圍','只限你本人'),row('有效至','未設定')]},
 memory_fact_revise:{title:'合成偏好記錄',content:'更正後完整正文：星星目前較喜歡在窗邊拼大型紙片拼圖；保留原有更正歷史。',scope:'family',targetVisibility:'family',details:[row('操作','更正原事實'),row('原事實與版本','fact-synthetic-01 · 6'),row('更新後名稱','合成偏好：窗邊紙片拼圖'),row('有效至','2099-06-01T00:00:00+08:00'),row('本人原話參照','message-synthetic-07'),row('原因','合成近況有所改變，請核對新版文字。'),row('範圍','更新原孩子共用事實，不分享私人聊天原文')]},
 memory_fact_deactivate:{title:'合成舊偏好記錄',content:'停用這項事實；保留更正歷史，不代表永久刪除。這不會刪除其他家庭資料。',scope:'private',targetVisibility:'private',details:[row('操作','停用原事實'),row('原事實與版本','fact-synthetic-02 · 4'),row('原因','合成舊偏好已不適用。'),row('範圍','只更新本人可見事實')]},
 private_source_create:{title:'合成私人桌遊筆記',content:'只用於核對合成桌遊安排的參考筆記。先閱讀完整正文與精確模型片段，再決定。',scope:'private',details:[row('操作','保存新的私人來源'),...sourceRows()]},
 private_source_change:{title:'合成私人筆記修訂',content:'更新同一份合成私人來源。改正文會撤回原模型授權，不能沿用舊授權。',scope:'private',details:[row('操作','更新原來源'),row('來源及原版本','input-synthetic-01 · 5'),...sourceRows()]},
 concern_create:{title:'合成拼圖活動觀察',content:'合成原因：想在下次家庭活動核對桌面安排。這是觀察，不是診斷或已確認健康事實。',scope:'family',details:[row('將共享的觀察','合成觀察全文：星星在矮桌前完成兩塊紙片拼圖，之後選擇畫畫。'),row('觀察時間','2099-05-07T15:00:00+08:00'),row('一次站內跟進','2099-05-09T09:00:00+08:00'),row('關聯','task: task-synthetic-01 · document: document-synthetic-01'),row('邊界','接受後加入家庭共享持續關注；觀察不是診斷或已確認健康事實。跟進只回站內，不自動外發。')]},
 concern_change:{title:'合成拼圖活動觀察',content:'追加共享觀察：核對下次桌遊的合成安排。原關注保持同一識別，沒有自動外發。',scope:'family',details:[row('操作','追加共享觀察（append）'),row('原關注與版本','concern-synthetic-01 · 9'),row('將共享的觀察','合成新觀察：矮桌移到窗邊後，紙片拼圖與畫筆分別放入兩個盒中。'),row('觀察時間','2099-05-08T15:00:00+08:00'),row('關聯','task: task-synthetic-01'),row('邊界',concernBoundary)]}
};
export function createScenario(id='family_document_change'){
 const alias={invalidated:'family_document_change','missing-visibility':'memory_fact_revise',expired:'task_change','run-unknown':'memory_fact',accepted:'memory_fact','accepted-no-result':'memory_fact',dismissed:'task_create','task-resolve':'task_change','source-disable':'private_source_change','concern-archive':'concern_change','concern-restore':'concern_change','concern-followup':'concern_change'};
 const kind=alias[id]??id;if(!kinds.includes(kind))throw new Error('Unknown synthetic scenario');
 let p={id:'synthetic-proposal-'+kind,runId:'synthetic-run-01',childId:'synthetic-child-A',version:3,status:'pending',contentState:'ready',kind,createdAt:'2099-05-07T08:00:00+08:00',expiresAt:'2099-05-10T18:00:00+08:00',result:null,syntheticResource:structuredClone(resources[kind]),...structuredClone(definitions[kind])};
 p.details.push({...unknown});
 if(id==='invalidated')p={...p,contentState:'invalidated',title:'原家庭文件修改',content:'原文件或來源已改變，候選正文已遮蔽；請重新核對。',details:[p.details[0]]};
 if(id==='expired')p={...p,status:'expired',expiresAt:'2000-01-01T00:00:00Z'};
 if(id.startsWith('accepted'))p={...p,status:'accepted',version:4,syntheticResource:{...p.syntheticResource,id:'fact-synthetic-saved-01',savedVersion:7},result:id==='accepted-no-result'?null:{kind:'memory_fact',id:'fact-synthetic-saved-01',version:7,label:'確認記憶 · fact-synthetic-saved-01'}};
 if(id==='dismissed')p={...p,status:'dismissed',version:4};
 if(id==='task-resolve')p.details=[row('操作','覆核終態（resolve）'),row('原任務','task-synthetic-01'),row('原任務版本','8'),row('覆核為','已取消（cancelled）'),unknown];
 if(id==='source-disable')p.details=[row('操作','停用原來源'),row('來源及原版本','input-synthetic-01 · 5'),...sourceRows().filter(r=>!['來源連結','將保存的原文','明確授權交模型的片段'].includes(r.label)),row('明確授權交模型的片段','未授權；不讀來源正文'),unknown];
 if(['concern-archive','concern-restore','concern-followup'].includes(id))p.details=[row('操作',id==='concern-archive'?'結束關注（archive）':id==='concern-restore'?'恢復關注（restore）':'調整站內跟進（schedule_followup）'),row('原關注與版本','concern-synthetic-01 · 9'),...(id==='concern-followup'?[row('一次站內跟進','2099-05-11T09:00:00+08:00')]:[]),row('邊界',concernBoundary),unknown];
 const target={runId:p.runId,id:p.id,kind:p.kind,scope:p.scope,version:p.version};
 return freeze({id,binding:{identityKey:'synthetic-session-A',userId:'synthetic-user-A',childId:'synthetic-child-A',scopeKey:'synthetic-private-A',private:true},target,proposal:id==='missing-visibility'?null:p,dataError:id==='missing-visibility'?'缺少原事實可見範圍；不能猜測 private 或 family。':null,runStatus:id==='run-unknown'?'unknown':'completed',readState:'ready',online:true,writesBlocked:false});
}
export const scenarioOptions=freeze([...kinds,'invalidated','expired','run-unknown','accepted','accepted-no-result','dismissed','missing-visibility','task-resolve','source-disable','concern-archive','concern-restore','concern-followup']);
