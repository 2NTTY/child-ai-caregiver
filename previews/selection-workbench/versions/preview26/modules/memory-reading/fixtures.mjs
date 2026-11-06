// Every name, event, source and date below is synthetic demonstration data.
export function scenarioContext(scenario){return{identity:'synthetic-user-a',scope:scenario==='shared'?'synthetic-shared-a':'synthetic-private-a',childId:'synthetic-child-a',childName:'合成小海',generation:1,shared:scenario==='shared',access:scenario==='revoked'?'revoked':'active'}}
const facts=[
 {id:'fact-book',version:3,kind:'facts',childId:'synthetic-child-a',title:'睡前的一本書',text:'合成示例：晚間整理玩具後，會挑一本圖畫書一起看。這是一項生活習慣記錄，不是健康建議。',visibility:'family',status:'confirmed',applicable:true,sourceState:'current',source:'合成照顧記錄 CR-DEMO-12 · 原記錄版本 2',confirmedAt:'2026-11-04T09:00:00Z'},
 {id:'fact-blocks',version:2,kind:'facts',childId:'synthetic-child-a',title:'積木與收納盒',text:'合成示例：試過以顏色分開放積木，但仍想核對這個描述是否準確。',visibility:'private',status:'candidate',applicable:false,sourceState:'current',source:'合成私人原訊息 MSG-DEMO-08 · 未確認',confirmedAt:null},
 {id:'fact-song',version:4,kind:'facts',childId:'synthetic-child-a',title:'曾經喜歡的歌',text:'合成示例：這項較早的描述已停用，不能當作目前偏好。',visibility:'family',status:'inactive',applicable:false,sourceState:'changed',source:'合成手動描述 · 來源已更改',confirmedAt:'2026-09-01T09:00:00Z'}
];
const personal=[
 {id:'work-books',version:2,kind:'personal',childId:'synthetic-child-a',title:'延續一次閱讀討論',text:'合成私人工作：下次一起看圖畫書時，可以先看看封面。這是保存的工作脈絡，不是未展示的模型推理。',visibility:'private',source:'合成原訊息 MSG-DEMO-01、MSG-DEMO-02'},
 {id:'work-note',version:1,kind:'personal',childId:'synthetic-child-a',title:'原訊息與摘要不同',text:'合成原訊息：「我想先整理我們說過的內容，再決定下一個問題。」整理摘要只供接續閱讀，不能取代這段原文。',visibility:'private',source:'合成私人對話 MSG-DEMO-03'}
];
const references=[
 {id:'ref-official',version:2,kind:'references',title:'公共閱讀目錄示例',text:'合成出版資訊。以發布機構、更新時間及版本追溯資料；未判定與這位孩子的任何事實相關。',usageScope:'public_noncommercial',source:'合成公共機構 · 非真實指引',checkedAt:'2026-11-04'},
 {id:'ref-recent',version:1,kind:'references',title:'近期資訊的日期線索',text:'合成時效性來源示例。資料存在、覆核日期及內容可靠性是不同問題。這裡沒有生成回答或推薦。',usageScope:'public_noncommercial',source:'合成資訊出版社 · 非真實文章',checkedAt:'2026-11-03'}
];
export function createFixturePorts(scenario='normal'){
  async function wait(signal){if(signal.aborted)throw new Error('Retired');if(scenario==='loading')await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('Retired')),{once:true}));await Promise.resolve();if(signal.aborted)throw new Error('Retired')}
  return{
    async read({kind,cursor,signal}){await wait(signal);if(scenario==='error')throw new Error('Synthetic read failure');let items={facts,personal,references}[kind]??[],nextCursor=null;
      if(scenario==='empty')items=[];
      if(scenario==='pages'){if(!cursor){items=[];nextCursor='page-2'}else if(cursor==='page-2'){items=items.slice(0,1);nextCursor='page-3'}else items=items.slice(1)}
      return structuredClone({state:scenario==='unknown'?'unknown':scenario==='stale'?'stale':'ready',items,nextCursor,summary:kind==='facts'?'合成私人整理：曾討論過一起閱讀與收拾玩具，尚未為新問題作決定。':null});
    },
    async history({id,version,cursor,signal}){await wait(signal);if(scenario==='error')throw new Error('Synthetic history failure');const current=facts.find(x=>x.id===id);const versions=current?Array.from({length:Math.max(0,version-1)},(_,i)=>({...current,version:version-i-1,text:`合成版本 ${version-i-1}：較早保存的描述，僅供對照，不當作目前事實。`})):[];return{state:'ready',items:cursor?versions.slice(1):versions.slice(0,1),nextCursor:!cursor&&versions.length>1?'older-2':null}}
  };
}
