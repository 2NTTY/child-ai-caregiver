// All people, identities, text, sources, operation identifiers and dates below are invented.
export const SCENARIOS=[['normal','一般讀窗'],['empty','空讀窗'],['error','首次讀取失敗'],['stale','保留舊讀窗＋讀取失敗'],['offline','離線保留讀窗'],['denied','權限已失效'],['shared','共享遮蔽／0 依據'],['dates','未知時間防禦示例'],['missing','關注未分享'],['unknown','原操作結果未知']];
const observation=(id,at,title,text,sourceLabel,extra={})=>({id,at,kind:'observation',title,text,sourceLabel,...extra});
export async function readFixture({identity='a',scenario='normal'}={}){
 if(scenario==='error'||scenario==='denied')throw Object.assign(new Error('Synthetic read only'),{code:scenario==='denied'?'denied':'read_error'});
 const childId=`synthetic-child-${identity}`,identityLabel=identity==='a'?'合成空間 A · 小芽':'合成空間 B · 小舟';
 const source={sourceId:'synthetic-source-A',versionId:'synthetic-v1',chunkId:'synthetic-chunk-2',contentHash:'synthetic-hash-not-a-real-digest',url:'https://example.invalid/gr01/source-A',title:'合成閱讀卡 A（非育兒建議）',section:'示例段落',checkedAt:'2026-11-02T08:00:00Z',excerpt:'這段文字只用來展示來源全文和核對欄位；不是專業指引，沒有接上知識庫。'};
 const item=(id,extra={})=>({id,childId,topicId:'toddler_play',version:1,state:'proposed',kind:'observe',title:'保留遊戲時的原話',whyNow:'合成情境：希望下次能核對原文，而不把一次表現概括成能力結論。',advice:'合成建議內容：留下當時的場景描述，供閱讀比較使用。',limits:'這不是健康建議、評分或發展評估。',basis:{stage:'synthetic',ruleRevision:'demo-rule-1',sourceHash:'synthetic',values:{example:'只有合成內容'}},evidence:{profileVersion:3,facts:[{id:'private-fact-demo',version:2}]},source:{...source},sourceAvailable:true,createdAt:'2026-11-02T08:00:00Z',updatedAt:'2026-11-04T09:00:00Z',snoozeUntil:null,previousId:null,newReason:'合成資料',taskId:null,taskState:null,lastAction:'',actorUserId:'synthetic-user',note:'',...extra});
 const items=[item('attention-a',{version:3,state:'accepted',updatedAt:'2026-11-04T15:00:00Z',taskId:'private-task-demo',taskState:'scheduled',note:'只記錄建議被接受；任務狀態是這次讀取時的 scheduled，沒有聲稱已完成。'}),item('attention-b'),item('attention-c',{state:'inapplicable',title:'舊來源狀態保留',sourceAvailable:false,evidence:{profileVersion:0,facts:[]},updatedAt:'2026-10-20T08:00:00Z',note:'原來源已不適用。此處保留當時處理狀態，不提供新的建議。'})];
 const concern=(id,title,reason,extra={})=>({id,childId,title,reason,status:'following',version:2,archivedAt:null,statusBeforeArchive:'following',attentionIds:[],events:[],historyComplete:true,followUp:null,...extra});
 const childName=identity==='a'?'小芽':'小舟';
 const long='在合成故事角活動中，小芽先坐在邊緣翻看圖卡。開始時只看旁邊的積木，後來指着圖卡說「這個像船」，再把兩塊積木放在一起。記錄只保留當時見到與聽到的內容，沒有推算原因、能力、情緒或健康狀態。\n\n換了一本書後，小芽拿起藍色圖卡，再放回原位；旁邊有人走過時停了下來。停頓多久沒有記下，也沒有拍照，所以這一部分仍是未知。下一段原文在此完整保留，不能只看卡片摘要便判斷經過。\n\n原文末段：收拾時把圖卡交回籃子，說「下次再看船」。這是合成閱讀壓力測試的最後一句，包含搜尋詞「紙船觀察」。'.replaceAll('小芽',childName);
 const concerns=[
  concern('case-a','一起看圖卡','記下共同閱讀時的具體場景，保留原話，之後回來核對。這是一條持續關注，不是問題診斷。',{attentionIds:['attention-a'],events:[observation('event-a1','2026-11-04T09:00:00Z','故事角的紙船',long,'手動觀察 · 合成家長筆記',{recordId:'private-care-demo'}),observation('event-a2','2026-11-04T17:00:00+08:00','補充當時的安排','合成記錄：把圖卡放在較容易拿取的位置。這是已確認操作的文字，不能反推它造成了任何結果。','合成手動確認',{kind:'confirmed_action',attentionId:'attention-a',attentionVersion:2}),observation('event-a3','2026-11-03T08:20:00Z','第二次閱讀','這次只記下翻到第三頁，沒有記錄停留時間。沒有資料的欄位保持未知。','手動觀察 · 合成便箋')],followUp:{id:'followup-a',at:'2026-11-06T08:00:00Z',state:'unknown',runId:null}}),
  concern('case-b','出門前的轉換','留意從遊戲到出門的過程，逐次記下情境。未確認的建議與已發生觀察分開。',{attentionIds:['attention-b'],events:[observation('event-b1','2026-11-04T09:00:00Z','先選一件隨身物品','合成原文：出門前選了小布袋。記錄沒有寫下所需時間，也沒有和其他日期比較。','手動觀察 · 合成照顧者筆記')]}),
  concern('case-c','一起看圖卡','較早的同名關注，與目前的個案有不同 ID。結束關注不會刪去原觀察或完成相關任務。',{status:'closed',version:4,archivedAt:'2026-10-21T17:10:00Z',attentionIds:['attention-c'],events:[observation('event-c1','2026-10-19T08:00:00Z','舊圖卡記錄','合成舊原文：先看動物，再看船。這條記錄屬於另一個案，不應按同名合併。','合成紙本抄錄'),observation('event-c2','2026-10-21T17:10:00Z','結束這條關注','合成操作記錄：結束持續關注，原文仍保留。沒有刪除任何記錄。','合成手動確認',{kind:'confirmed_action'})]}),
  concern('case-d','留下一個閱讀位置','合成空個案：已建立關注，但沒有原始觀察。空白不代表沒有發生事情。')
 ];
 const p={synthetic:true,childId,identityLabel,loadedAt:'2026-11-05T04:00:00Z',authorityVersion:`synthetic-${identity}-authority-1`,canManage:false,concerns:{state:'ready',items:concerns},items,historyHasMore:true,fixtureNotice:'全部內容均為合成示例，未接正式資料。',operation:null};
 if(scenario==='empty'){p.concerns.items=[];p.items=[];p.historyHasMore=false}
 if(scenario==='dates'){
  concerns[1].events.push(observation('event-unknown','not-a-time','時間原值不可解析','防禦顯示樣本：原時間沒有被轉成今天，也沒有放進本週。','合成匯入顯示測試'));
  concerns[3].events.push(observation('event-missing','','時間未提供','防禦顯示樣本：保留空字串原值，不推算日期。','合成缺欄顯示測試'));
  p.fixtureNotice='防禦顯示專用合成樣本：未知／無效事件時間不符合目前嚴格 Concern API；不代表正式介面已支援這種回傳。';
 }
 if(scenario==='shared'){
  p.fixtureNotice='共享遮蔽合成示例：0 是不可核對依據的 sentinel，不是已核實版本；GR-F01 真 client 相容性問題仍未修。';
  for(const a of items){a.evidence={profileVersion:0,facts:[]};a.basis.values={};a.taskId=null;a.taskState=null}
  for(const c of concerns)for(const e of c.events){delete e.recordId;delete e.taskId;delete e.runId}
 }
 if(scenario==='missing'){p.concerns={state:'unavailable',items:[]};p.fixtureNotice='合成 facet 限制：關注未分享；不是「沒有關注」。已提供的 GrowthAttention 保持獨立。'}
 if(scenario==='unknown'){
  const opId=identity==='a'?'00000000-0000-4000-8000-000000000001':'00000000-0000-4000-8000-000000000002';
  p.operation={state:'unknown',owner:'Concern API',opId,body:JSON.stringify({opId,confirmShared:true,change:{action:'archive',authorityVersion:`synthetic-${identity}-authority-1`,expectedVersion:2,confirm:true}})};
 }
 return p;
}
