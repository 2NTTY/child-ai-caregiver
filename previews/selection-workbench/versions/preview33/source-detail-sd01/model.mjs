// Synthetic reading projection only. No authority, writer, original-file or network port.
export const READ_ERROR_TAGS = Object.freeze(['transport','malformed','not_found','denied','cancelled']);
export const readError = tag => Object.freeze({tag:READ_ERROR_TAGS.includes(tag)?tag:'transport'});
const fetchLabels={not_requested:'未要求取得',running:'正在取得正文',ready:'正文已保存',failed:'取得失敗',unknown:'取得結果未知'};
export function deriveSourceView(s){
 const v=s.source, a=s.context?.authority, detail=s.detailRead;
 const denied=!s.alive||!a?.privateRead||a.role===null||detail?.load==='denied';
 const originalCapability=denied?'denied':!v?'unavailable':v.management?.enabled===false?'disabled':v.text.trim()?'saved_text':'no_text';
 let referenceLabel='來源狀態待核對';
 if(v?.management?.enabled===false) referenceLabel='已停用';
 else if(v&&!denied&&a.online&&a.ownerReady&&!s.context.blockers.pending&&!s.context.blockers.conflict&&detail.fresh&&['ready','loading'].includes(detail.load)){
  const excerpt=v.management?.modelExcerpt;
  referenceLabel=!v.text.trim()?({running:'正在取得正文',failed:'取得失敗',unknown:'取得結果待核對'}[v.fetchState]||'尚未取得正文')
   :!excerpt?.trim()?'尚未授權 Agent':!v.sha256?'正文完整性待核對':!v.text.includes(excerpt)?'授權片段待核對':excerpt.length>6000?'授權片段超出讀取上限':'可供 Agent 讀取';
 }
 return {originalCapability,externalOriginal:'not_provided',referenceLabel,indexLabel:'未建立向量索引',candidateLabel:'未確認候選',confirmedLabel:v?.recordId?`已連結${v.confirmationKind==='reference'?'家庭參考備註':'孩子實際記錄'}；未接記錄正文`:'未連結確認記錄',fetchLabel:v?fetchLabels[v.fetchState]:'尚未讀取來源',operationLabel:s.operationProjection?.state==='unknown'?`合成原操作結果未知：${s.operationProjection.reference}；閱讀不會結案`:'沒有原操作投影'};
}
export function deriveRevisionView(s,version){
 const r=s.historyRead?.revisions.find(x=>x.version===version);if(!r||!s.source)return null;
 const m=r.management;
 return {version:r.version,changedAt:r.changedAt,reason:r.reason,currentVersion:s.source.version,provenance:'另次讀取的管理修訂；沒有舊正文',managementLabel:m?'當時的管理設定':'當時沒有管理設定',intention:m?.intention??'',purpose:m?.purpose??null,nature:m?.nature??null,timeScope:m?.timeScope??null,validityText:m?.validityText??'',enabled:m?.enabled??null,hasExcerpt:!!m?.modelExcerpt};
}
