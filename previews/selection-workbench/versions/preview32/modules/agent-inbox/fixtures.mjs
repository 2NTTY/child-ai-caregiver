// Original synthetic content. No real family, remote service or model data.
const ids=['run-fold','run-uncertain','run-reading','run-stopped','run-quiet','run-pending'];
const values=[
 {status:'completed',title:'替下一次對話，留一個清楚的起點',text:'這次只整理了合成示例內已經寫下的安排，沒有替任何人增加承諾。\n\n可先讀回原來提到的兩件事：想把週末準備清單放在同一處；想在下次對話繼續討論活動選擇。它們都只是這段示例的上下文，不是已建立的待辦。\n\n如果現在沒有時間，也可以先返回索引。這裏的閱讀選擇不會變成批准、已讀收據或新的執行。',context:{label:'原來是怎樣開始的',text:'「我想下次再看週末活動的選擇，現在先把想法放在一起。」\n\n以上是原創合成句子，沒有連到真實家庭訊息。'}},
 {status:'unknown',title:'這次結果，仍有一部分未能確認',text:'這是一筆執行結果未知的合成快照。現有內容不足以證明原操作成功，也不足以證明原操作失敗。\n\n閱讀這張回函或換一種布局，不會解除未知狀態。需要由原有入口核對原 run；不能重新呼叫模型來猜補結果。',context:{label:'本次閱讀邊界',text:'只有原 run 的結果能作確認。這裏沒有原決策或重新執行按鈕。'}},
 {status:'running',title:'目前讀到的是尚未結束的快照',text:'這是已保存的背景 run 狀態，不是即時進度串流。\n\n畫面不估計完成百分比、剩餘時間或模型下一步。重新讀取只讀同一筆合成資料，不會新增工作。',context:null},
 {status:'stopped',title:'執行已停止，原有結果另作核對',text:'停止狀態不表示之前的操作已撤銷。\n\n這個合成例子沒有任何原保存收據可供展示，所以不把停止寫成「沒有保存」或「全部已還原」。',context:null},
 {status:'completed',title:'核對過後，沒有新增行動',text:'',outcome:'no_action',context:{label:'合成核對範圍',text:'這次只核對示例內容是否有新行動可整理；沒有另造一則聊天回答。'}},
 {status:'completed',title:'有待核對的建議，先讀清楚背景',text:'此處只顯示一筆帶待決策內容的合成結果。\n\n任何接受、拒絕或共享確認，都要回到原有決策流程，沿同一個 owner 及版本處理。候選不提供假的批准成功。',pendingDecision:true,context:{label:'為甚麼這裏沒有批准按鈕',text:'閱讀結果與作出決定不是同一件事。這個模組只處理閱讀。'}}
];
export function createFixturePorts(scenario='normal'){
 let listCalls=0;
 return Object.freeze({
  async list({signal}){
   listCalls++;
   if(scenario==='loading')return new Promise((resolve,reject)=>{if(signal.aborted)return reject(new Error('Read aborted'));signal.addEventListener('abort',()=>reject(new Error('Read aborted')),{once:true});});
   if(scenario==='denied')throw {code:'denied'};
   if(scenario==='failure'||scenario==='stale'&&listCalls>1)throw new Error('Synthetic list read failure');
   return {entries:scenario==='empty'?[]:ids.map((runId,i)=>({runId,createdAt:`2026-11-05T${String(8-i).padStart(2,'0')}:30:00Z`})),loadedAt:'2026-11-05T09:00:00Z'};
  },
  async detail({runId}){
   const index=ids.indexOf(runId);if(index<0)throw new Error('Unknown synthetic result');
   if(scenario==='saved-failure'&&index===0)throw {code:'saved_read_failed',savedEvidence:{state:'confirmed',summary:'合成原操作收據已確認保存'}};
   const item={runId,outcome:null,pendingDecision:false,savedEvidence:null,...structuredClone(values[index])};
   if(scenario==='long'&&index===0){item.title='長文測試：完整保留原句與段落，不把較長的標題截斷成另一個意思';item.text=Array.from({length:80},(_,i)=>`合成段落 ${i+1}。閱讀資料時，先保留原來的語境，再分辨哪些是結果、哪些仍然未知。這段文字只用來檢查長文換行與返回定位，不是真實的育兒建議。\n連續字串測試：abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789`).join('\n\n');}
   if(scenario==='whitespace'&&index===0){item.title='   ';item.text='\n\t ';item.context={label:'  ',text:' \n '};}
   return item;
  }
 });
}
