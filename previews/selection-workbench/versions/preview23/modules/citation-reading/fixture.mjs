// Original synthetic examples. No family records, medical advice, remote reads or real sources.
export function fixture(scope='family-a',scenario='ready') {
  const second=scope==='family-b';
  const a={id:'s1',number:1,title:second?'合成乙冊：閱讀角佈置':'合成甲冊：共讀角落',publisher:'虛構編輯室',section:'第二節 · 閱讀安排',excerpt:second?'這是另一個合成範圍的摘錄，不可沿用甲範圍選取。':'預留一段安靜的共讀時間，讓孩子自行選擇想翻看的圖畫書。這段文字只供測試來源詳讀。',classification:'synthetic',version:'demo-v3',checkedAt:'2026-11-04 09:00 UTC',url:'https://example.invalid/guide-a',state:'available'};
  const b={id:'s2',number:2,title:'合成資料卡：輪流說故事',publisher:'虛構活動組',section:'遊戲卡 02',excerpt:'兩人輪流接一句故事，內容可以完全虛構。這是另一份合成摘錄，不代表已核對現實資料。',classification:'synthetic',version:'demo-v1',checkedAt:'未知',url:'https://example.invalid/guide-b',state:'stale'};
  let text=second?'乙範圍可先安排一個閱讀角。【1】再逐段輪流說故事。【2】':'先留一個安靜的共讀角落。【1】不急着讀完整本書，讓孩子先選擇。【1】也可輪流接一句故事。【2】';
  let status='complete',reason=null;
  if(['stopped','unknown'].includes(scenario)){status=scenario;reason=scenario==='stopped'?'使用者停止這次合成運行':'目前無法確認合成運行結果'}
  const run={id:'r1',text,status,reason,retrieval:scenario==='degraded'?'keyword_degraded':'normal',sources:[a,b]};
  if(scenario==='withdrawn') run.sources=run.sources.filter(s=>s.id!=='s1');
  if(scenario==='missing') run.sources=[];
  if(scenario==='stale') run.sources=run.sources.map(s=>({...s,state:'stale',checkedAt:'2020-01-01 00:00 UTC'}));
  const wrapped=reason?`這次回覆未完成：${reason}。\n\n${text}`:text;
  const other={...a,title:'合成第二訊息：書本分類',excerpt:'這段摘錄只屬於第二訊息的 r2，不可由 r1 的舊控制開啟。',url:'https://example.invalid/message-two'};
  return {runs:{r1:run,r2:{id:'r2',text:'另一則合成訊息先將圖書分成兩盒。【1】',status:'complete',reason:null,retrieval:'normal',sources:[other]}},messages:[{id:'m1',runId:'r1',text:scenario==='mismatch'?'文字已修改，但舊 run 未同步。【1】':wrapped},{id:'m2',runId:'r2',text:'另一則合成訊息先將圖書分成兩盒。【1】'}]};
}
export const scenarios=[['ready','正常合成資料'],['missing','來源缺失'],['withdrawn','來源撤回'],['mismatch','正文不匹配'],['stale','來源過時'],['stopped','已停止'],['unknown','結果未知'],['degraded','降級檢索']];
