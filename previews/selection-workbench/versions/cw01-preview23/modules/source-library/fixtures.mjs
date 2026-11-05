// Entirely fictional source records. No real people, documents, URLs or model responses.
export const scopeA={key:'synthetic-a',userId:'synthetic-owner-a',childId:'synthetic-child-a',name:'示例範圍 A',access:'read_only'};
export const scopeB={key:'synthetic-b',userId:'synthetic-owner-b',childId:'synthetic-child-b',name:'示例範圍 B',access:'read_only'};
const text1='合成原文：故事角有三種圖卡。這份素材只用來比較來源閱讀介面，沒有描述真實孩子，也不是照顧建議。\n\n第二段：先辨認來源，再核對保存正文與授權片段。正文存在不代表內容正確，提取候選仍須人工確認。\n\n';
export function sampleItems(scope=scopeA){
 const base=(id,title,kind='personal_source')=>({id,childId:scope.childId,ownerUserId:scope.userId,version:1,sourceLabel:title,kind,sourceDateText:'合成日期文字：秋季閱讀活動',sourceUrl:null,sourceNotes:'只作介面探索的虛構素材。',sourceId:null,createdAt:'2026-11-01T08:00:00Z',retrievedAt:null,text:'',sha256:null,fetchState:'not_requested',extraction:{state:'not_requested',runId:null,excerpt:null,draft:null,stopReason:null,processedAt:null,model:null},recordId:null,confirmationKind:null,management:null,canManage:false});
 const one={...base('s1','故事角素材','paste'),version:4,text:text1+'完整原文尾段：橙色書籤。',sha256:'a'.repeat(64),fetchState:'ready',retrievedAt:'2026-11-01T08:05:00Z'};
 const two={...base('s2','紙船步驟草稿'),version:2,text:'合成原文：把正方形紙沿中線摺起，再攤開。這是虛構示例，沒有安全或適齡建議。',sha256:'b'.repeat(64),fetchState:'ready',extraction:{state:'available',runId:'synthetic-extract-2',excerpt:'把正方形紙沿中線摺起',draft:{text:'合成未確認候選：紙張有一條中線。',uncertainties:['動作及時間未核對。']},stopReason:null,processedAt:'2026-11-02T08:00:00Z',model:'synthetic-placeholder'}};
 const three={...base('s3','等待正文的連結','public_source'),sourceId:'synthetic-reference',sourceUrl:'https://example.invalid/source-placeholder',fetchState:'not_requested'};
 const four={...base('s4','未成功取得的資料'),fetchState:'failed'};
 const five={...base('s5','原次提取未查明','paste'),text:'合成原文：三張不同形狀的卡片。',sha256:'c'.repeat(64),fetchState:'ready',extraction:{state:'unknown',runId:'synthetic-extract-5',excerpt:'三張不同形狀',draft:null,stopReason:null,processedAt:null,model:null}};
 const six={...base('s6','已停用的舊素材'),text:'合成停用正文：這段不應出現在可讀 DOM。',sha256:'d'.repeat(64),fetchState:'ready',management:{enabled:false,modelExcerpt:null,purpose:'answer_reference',nature:'unspecified',timeScope:'unspecified',validityText:'',intention:''}};
 const seven={...base('s7','已授權的圖形描述','paste'),version:3,text:'合成原文：圓形、方形及三角形放在同一張紙上。',sha256:'e'.repeat(64),fetchState:'ready',management:{enabled:true,modelExcerpt:'圓形、方形及三角形',purpose:'answer_reference',nature:'external_material',timeScope:'long_reference',validityText:'',intention:'介面測試'}};
 const eight={...base('s8','長篇顏色索引'),version:2,text:Array.from({length:85},(_,i)=>`合成段落 ${i+1}：這裏排列不同顏色名稱，只用來驗證全文閱讀，不包含家庭資料。`).join('\n')+'\n合成全文結尾：最後一個色塊是紫色。',sha256:'f'.repeat(64),fetchState:'ready',recordId:'synthetic-record-8',confirmationKind:'reference'};
 return [one,two,three,four,five,six,seven,eight];
}
export function scenarioData(name,scope=scopeA){const items=sampleItems(scope);return {items:name==='empty'?[]:name==='partial'?items.slice(0,3):items,readState:name==='stale'?'stale':name==='error'?'error':name==='loading'?'loading':'ready',operation:name==='unknown'?{state:'unknown',phase:'extract',reference:'synthetic-op-5'}:{state:'none',phase:null,reference:null},windowNote:name==='partial'?'合成部分窗口：僅提供 3 筆；其他來源與總數未知。':name==='empty'?'合成空窗口：本次提供 0 筆，不代表正式全庫已清空。':'合成已載窗口：8 筆示例；不是正式全庫筆數。'};}
