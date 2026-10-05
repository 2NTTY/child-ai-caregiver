import type { GrowthAttention,GrowthPage,GrowthTopic,GrowthTopicId } from "../growth-view-model";
export function growthFixture(childId:string):GrowthPage{
  const titles:Record<GrowthTopicId,string>={solid_food:"加副食準備",toddler_play:"幼兒遊戲",preschool_development:"學前發展",school_vision:"學齡視力"};
  const topics:GrowthTopic[]=Object.entries(titles).map(([id,title])=>({id:id as GrowthTopicId,title,version:1,disabled:false,inputs:[{
    key:"preview_context",label:"相關日常情況（合成選項）",choices:[{value:"observed",label:"已與家人核對觀察"},{value:"not_yet",label:"尚未核對觀察"}],value:null,conflict:false,factRefs:[],
  }]}));
  const source={sourceId:"preview-fhs",versionId:"preview-source-version",chunkId:"preview-source-chunk",contentHash:"a".repeat(64),url:"https://www.fhs.gov.hk/",title:"家庭健康服務（合成來源示例）",section:"僅展示來源快照",checkedAt:"2026-09-30T02:00:00Z",excerpt:"這段文字只示範來源欄位，並非官方文章或產品育兒建議。正式片段及版本由 API 提供。"};
  const item:GrowthAttention={id:"preview-growth-current",childId,topicId:"preschool_development",version:1,state:"proposed",title:"整理日常遊戲觀察",kind:"observe",
    whyNow:"按這位孩子的合成年齡資料，示範如何顯示關注理由。",advice:"先與家人核對自己的觀察，再決定是否需要安排下一步（合成示例）。",limits:"不作診斷或醫療分流；此預覽沒有評估孩子或讀取正式資料。",
    basis:{stage:"preview-preschool",ruleRevision:"preview-rule-1",sourceHash:source.contentHash,values:{"年齡依據":"合成約數；正式版由 API 提供"}},evidence:{profileVersion:1,facts:[]},source,sourceAvailable:true,
    createdAt:"2026-09-30T01:00:00Z",updatedAt:"2026-09-30T01:00:00Z",snoozeUntil:null,previousId:"preview-growth-previous",newReason:"這是另一份合成依據；舊關閉紀錄保持終態。",taskId:null,taskState:null,lastAction:"propose",actorUserId:null,note:""};
  const previous:GrowthAttention={...item,id:"preview-growth-previous",version:2,state:"dismissed",title:"上次遊戲觀察",previousId:null,newReason:"",note:"上次已核對，保留關閉結果。",sourceAvailable:false};
  return {concerns:{state:"ready",label:"關注時間軸為隔離合成示例；正式 Agent 建立及事件讀取 port 未接通。",items:[{
    id:`preview-concern-play:${childId}`,childId,title:childId==="preview-child-2"?"課後分享與表達":"日常遊戲與表達",status:"proposed",reason:"助手從家長提供的生活片段提出持續觀察，讓前後變化與依據放在一起。這不是發展評估。",attentionIds:[item.id,previous.id],historyComplete:false,
    events:[
      {id:"preview-event-proposal",at:"2026-09-30T01:00:00Z",kind:"agent_proposal",title:"助手提出關注",text:"建議整理日常遊戲時的表達與互動，等待家長核對。沒有執行真正 Agent。",sourceLabel:"合成助手提議 · 未當作已確認事實"},
      {id:"preview-event-observation",at:"2026-09-30T02:00:00Z",kind:"observation",title:"連到家長的原始觀察",text:childId==="preview-child-2"?"完成畫作後，和家人分享今天的想法。":"下午到公園玩耍後，回家主動分享見聞。",sourceLabel:"家庭已確認記錄 · 合成",recordId:childId==="preview-child-2"?"preview-care-school":"preview-care-park"},
      {id:"preview-event-pending",at:"2026-10-01T02:00:00Z",kind:"pending_record",title:"新的生活片段待核對",text:"先比較家長原文與助手整理結果；未確認前不寫成家庭事實。",sourceLabel:"私人候選 · 合成示例"},
    ],
  }]},authorityVersion:`preview-authority:${childId}:1`,items:[item,previous],historyHasMore:true,topics,notices:["全部資料及四主題選項均屬合成；沒有執行規則、背景 Agent 或醫療評估。"],eligibleAssignees:[{userId:"preview-mom",name:"媽媽"},{userId:"preview-dad",name:"爸爸"}],canManage:true};
}
