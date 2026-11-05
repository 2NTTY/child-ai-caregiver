// Entirely invented local examples. No real account, child, message or endpoint.
export const SCENARIOS=[['normal','合成日常'],['long','長文字'],['empty','零列仍有下一頁'],['complete','當下讀窗末端'],['stale','普通失敗／舊內容'],['error','首讀失敗'],['unavailable','內容暫未提供'],['authority','讀窗授權失效']];
const C=(channel,title,body,sentAt='2026-11-04T12:00:00.000Z')=>({channel,title,body,sentAt,contentVersion:'synthetic-v1'});
const M=(n,date,scope,contents)=>({messageId:`contact:00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,contentVersion:1,sentAt:date,scope,contents});
const account={kind:'account'},child={kind:'child',childId:'00000000-0000-4000-8000-000000009001',childName:'星星（合成）'};
export function fixture(name='normal',userId='synthetic-a'){
 const items=[
  M(1,'2026-11-05T00:00:00.000Z',child,[C('web_push','把今天，慢慢打開','今天的合成觀察提案：看看窗台的小葉子，找出一片你最喜歡的形狀。\n不用趕著回答，一起看就好。','2026-11-05T00:00:00.000Z'),C('telegram','留一點時間給小發現','合成渠道內容：今晚可以聊聊月牙，也可以只記住一句今天喜歡的話。','2026-11-05T00:02:00.000Z')]),
  M(2,'2026-11-04T17:10:00.000Z',account,[C('native_push','一封給自己的小提醒','合成示例：先喝一口水，伸展肩膀，再決定接下來的小步驟。沒有需要立即完成的清單。','2026-11-04T17:10:00.000Z')]),
  M(3,'2026-11-04T08:20:00.000Z',child,[C('web_push','小小的散步筆記','合成示例：一起聽聽路上的三種聲音。腳步聲、樹葉聲，還有你們說話的聲音。'),C('native_push','走走看看，不趕時間','合成渠道內容：可以在熟悉的路上找一個從未留意的小角落。')]),
  M(4,'2026-11-03T10:45:00.000Z',account,[C('telegram','把片刻收進口袋','合成示例：今天留下的一點想法，等有空再回來看。這裡只保存示例文字，沒有家人的真實訊息。')])
 ];
 if(name==='long'){items[0].contents[0].title='給很長很長的一天保留閱讀空間'.repeat(7);items[0].contents[0].body='長篇合成正文。'.repeat(140)+'\n'+'ContinuousSyntheticText'.repeat(40)+'\n<img src=x onerror=alert(1)> 這段只會顯示文字。'}
 return{schemaVersion:1,userId,scopeVersion:'a'.repeat(64),asOf:'2026-11-05T00:10:00.000Z',items:name==='empty'?[]:items,nextCursor:name==='complete'?null:'synthetic-opaque-page-2',complete:name==='complete',coverage:{kind:'recorded_provider_acceptances',historical:'unknown',excluded:['authentication_email','unconfirmed_or_unsaved_sends'],pagination:'live'}};
}
export async function syntheticLoader(request){await new Promise(resolve=>setTimeout(resolve,450));const data=fixture('normal',request.context.identity);if(request.kind==='more'){data.items=[M(5,'2026-11-02T02:00:00.000Z',account,[C('web_push','較早的一頁','合成示例：翻到這裡，只代表這次讀窗走到當下末端。更早的保存範圍仍未確認。')])];data.asOf=request.window.asOf;data.scopeVersion=request.window.scopeVersion;data.nextCursor=null;data.complete=true}return data}
