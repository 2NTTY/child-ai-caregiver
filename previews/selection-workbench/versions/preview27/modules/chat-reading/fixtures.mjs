// Hand-authored synthetic messages. No real family information, requests or images.
const texts=[
 '今天一起看了一本畫著小船的繪本。這是一則人工合成的閱讀示例。',
 '可以把喜歡的一頁留在眼前，慢慢看看畫面。這段回覆也是合成文字，沒有調用模型。',
 '讀到燈塔那頁時，合成小朋友指著窗邊說：「這裡也有光。」',
 '原話可以原樣留著，不必替它加上新的意思。示例引用標記【1】仍屬這則正文。',
 '今天的合成片段：先翻到昨天那頁，再找一找紙上的小魚。',
 '這裡只是示範連續對話如何呈現。你可以在左邊找日期，或停在目前的位置閱讀。',
 '想把昨天的那句話找回來。關鍵字是「燈塔」，不是後來自動整理的主題。',
 '搜尋只涵蓋畫面已載入的原文。較早但還沒載入的合成頁，不會出現在這次結果裡。',
 '合成長文壓力測試：'+('繁體中文閱讀段落，在窄螢幕上也需要保留完整原話。'.repeat(6))+'\n'+('ContinuousSyntheticReadingWithoutSpaces'.repeat(9)),
 '同一段文字可慢慢讀。引用標記【1】在這裡，重複出現的【1】仍是不同位置；這一版不提供來源跳轉。',
 '如果較早的頁面沒有讀到，新畫面也不應把已經看到的這段對話抹掉。',
 '這是目前已載入的最後一則合成訊息。回到最新只改閱讀位置，不代表傳送、保存確認或模型執行。'
];
export function makeFixture(scope='a',mode='normal'){
 const binding={identityKey:'synthetic-parent-'+scope,scopeKey:'synthetic-private-'+scope,sessionGeneration:1,userId:'synthetic-parent-'+scope,childId:'synthetic-child-'+scope,privateScope:true};
 const rows=texts.map((text,i)=>({id:'synthetic-message-'+String(i+5).padStart(2,'0'),bodyRevision:'body-v1',childId:binding.childId,authorUserId:i%2?null:binding.userId,role:i%2?'model':'user',text,inReplyTo:i%2?'synthetic-message-'+String(i+4).padStart(2,'0'):null,createdAt:`2026-11-${String(2+Math.floor(i/4)).padStart(2,'0')}T${String(8+i%4).padStart(2,'0')}:00:00.000Z`,...(i%2?{agentRunId:'synthetic-run-'+(i+5)}:{}),...(i===5?{citations:[]}:{}),...(i===9?{citations:[{chunkId:'synthetic-chunk-1',sourceId:'synthetic-source-1',versionId:'synthetic-v1',versionHash:'synthetic-hash-v1',classification:'synthetic-only',publisher:'人工合成',section:'示例',excerpt:'不對應外部資料',sourceListRevision:'source-list-v1',internalOnly:false,degraded:false}]}:{})}));
 return {binding,rows:mode==='empty'||mode==='cursor-empty'||mode==='not-loaded'?[]:rows,cursor:mode==='empty'||mode==='not-loaded'?null:'synthetic-cursor-before-05',pageLimit:6,loadedAt:mode==='not-loaded'?null:'2026-11-05T10:00:00.000Z',authorizedVisible:true,online:true,unknownNotice:'合成狀態展示：原保存結果未知。這個閱讀候選不查核、不解鎖，也不重新傳送。'};
}
export function scriptedPage(snapshot,kind='success'){
 if(kind==='failure')return {error:'預設合成讀取失敗'};
 if(kind==='no-progress')return {rows:[],cursor:snapshot.cursor,limit:6};
 if(kind==='invalid')return {rows:[{...snapshot.rows[0],id:'synthetic-invalid',childId:'synthetic-other-child'}],cursor:null,limit:6};
 if(snapshot.pending?.kind==='reload')return {rows:makeFixture(snapshot.binding.childId.endsWith('b')?'b':'a').rows,cursor:'synthetic-cursor-before-05',limit:6};
 const b=snapshot.binding;
 return {rows:Array.from({length:4},(_,i)=>({id:'synthetic-message-0'+(i+1),bodyRevision:'body-v1',childId:b.childId,authorUserId:i%2?null:b.userId,role:i%2?'model':'user',text:['較早合成頁：我們從紙船的那一頁開始。','這裡保留原來的排列，不為配合布局重新排序。','合成家長想停一下，再讀一次這段話。','這四則是明確接納的本地合成頁，沒有發出網絡讀取。'][i],inReplyTo:i%2?'synthetic-message-0'+i:null,createdAt:`2026-11-01T${String(8+i).padStart(2,'0')}:00:00.000Z`,...(i%2?{agentRunId:'synthetic-run-old-'+i}:{})})),cursor:null,limit:6};
}
