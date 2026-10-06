import type { GrowthArchiveProjection, GrowthArchiveSource, GrowthAttention,GrowthPage,GrowthTopic,GrowthTopicId } from "../growth-view-model";
import { createCareFixtures } from "./care-fixture";

function archiveFixture(childId: string, scopeKey: string, ageLabel: string): GrowthArchiveProjection {
  // Reuse the existing synthetic record source. This is a derived reading sample, not an Agent run.
  const records = createCareFixtures(childId);
  const older = childId === "preview-child-2";
  const moment = records.find(record => record.id === (older ? "preview-care-school" : "preview-care-park"));
  const sleep = records.find(record => record.id === "preview-care-sleep");
  const height = records.find(record => record.id === "preview-care-height");
  const selected = [moment, sleep, height].filter(record => record !== undefined);
  const sources: GrowthArchiveSource[] = selected.map(record => ({
    id: record.id, kind: "record", recordId: record.id, label: record.title, version: record.current.version,
    state: "available", excerpt: record.current.values.text,
    timeLabel: record.current.values.eventTimeRaw || "事件時間未提供",
  }));
  return {
    scopeKey, childId, authorityVersion: `preview-authority:${childId}:1`, state: moment ? "ready" : "not_generated",
    label: "合成檔案示例 · Agent 持續整理尚未接通",
    periods: moment ? [
      {id: "preview-2026-year", kind: "year", year: 2026, label: "2026 年度", snapshotId: `preview-archive:${childId}`, snapshotVersion: 2, currentAnnual: true, coverage: "partial", coverageLabel: "部分內容：只包含已載入的 2026 年 9 月片段，不是全年檔案。"},
      {id: "preview-2026-q3", kind: "quarter", year: 2026, quarter: 3, label: "2026 年第 3 季", snapshotId: `preview-archive:${childId}`, snapshotVersion: 2, currentAnnual: false, coverage: "partial", coverageLabel: "部分內容：只包含已載入的 2026 年 9 月片段，不是完整季度。"},
    ] : [],
    history: [],
    snapshot: moment ? {
      id: `preview-archive:${childId}`, version: 2, ageLabel,
      periodLabel: "2026 年 9 月的已載入片段",
      generatedAt: "2026-10-01T02:00:00Z", sourceBasisVersion: `preview-care-basis:${childId}:2`,
      coverageNote: "只整理這份合成示例中的已確認記錄，並非完整月份或完整成長歷史。原文中的約數及模糊時間保持原樣。",
      revisionChanges: [{id: "preview-revision-2", text: sleep
        ? "本版採用已補充夜間醒來描述的睡眠記錄；這是記錄修訂，並不代表睡眠情況有新變化。"
        : "本版加入家人記下的課後分享片段；目前沒有足夠的前後記錄作比較。", sourceIds: [sleep?.id ?? moment.id]}],
      sources,
      sections: [
        {id: "overview", title: "這段時間的孩子", entries: [{id: "preview-overview", reportDomain: "profile" as const, status: "agent_summary", sourceIds: sources.map(source => source.id), text: older
          ? "完成畫作後，孩子和家人分享了自己的想法。這個課後片段，保留了一次表達和相處的經過，讓日後回看時，不只有日期，也能記起當時發生的事情。"
          : "公園玩耍後，孩子回家主動分享見聞，是這段時間值得留下的生活片段。家人也記下了在家量度身高和晚間睡眠的情況，為日後回看留下具體依據。"}]},
        {id: "changes", title: "一路以來的變化", entries: [{id: "preview-changes", reportDomain: "changes_support" as const, title: "先保留片段，再慢慢看見變化", status: "agent_summary", sourceIds: [moment.id], text: "目前已取得的記錄還不足以比較長期變化。這份檔案先保留有依據的觀察，不把一次分享寫成能力進步，也不替未記錄的日子補上故事。"}]},
        {id: "moments", title: "值得留下的片段", entries: [{id: "preview-moment", reportDomain: "abilities_interests" as const, title: older ? "畫作完成後的分享" : "把公園見聞帶回家", status: "confirmed_record", text: moment.current.values.text, timeLabel: moment.current.values.eventTimeRaw, sourceIds: [moment.id]}]},
        ...(sleep && height ? [{id: "observations" as const, title: "仍在觀察的事情", entries: [
          {id: "preview-sleep-observation", reportDomain: "body_life" as const, title: "睡眠的原始描述", status: "agent_summary" as const, text: "目前的睡眠記錄保留了入睡、醒來的約數，以及一次短暫夜醒。後續若有新觀察，可再與同一段原文對照；現時不能據此判斷長期規律。", sourceIds: [sleep.id]},
          {id: "preview-height-observation", reportDomain: "body_life" as const, title: "一次在家量度", status: "confirmed_record" as const, text: `${height.current.values.quantityRaw} ${height.current.values.quantityUnit}。${height.current.values.text}`, timeLabel: height.current.values.eventTimeRaw, sourceIds: [height.id]},
        ]}] : []),
      ],
    } : null,
  };
}

export function growthFixture(childId:string, archiveContext?: {scopeKey: string; ageLabel: string}):GrowthPage{
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
  return {archive: archiveContext ? archiveFixture(childId, archiveContext.scopeKey, archiveContext.ageLabel) : undefined, concerns:{state:"ready",label:"關注時間軸為隔離合成示例；正式 Agent 建立及事件讀取 port 未接通。",items:[{
    id:`preview-concern-play:${childId}`,childId,version:1,archivedAt:null,title:childId==="preview-child-2"?"課後分享與表達":"日常遊戲與表達",status:"proposed",reason:"助手從家長提供的生活片段提出持續觀察，讓前後變化與依據放在一起。這不是發展評估。",attentionIds:[item.id,previous.id],historyComplete:false,
    events:[
      {id:"preview-event-proposal",at:"2026-09-30T01:00:00Z",kind:"agent_proposal",title:"助手提出關注",text:"建議整理日常遊戲時的表達與互動，等待家長核對。沒有執行真正 Agent。",sourceLabel:"合成助手提議 · 未當作已確認事實"},
      {id:"preview-event-observation",at:"2026-09-30T02:00:00Z",kind:"observation",title:"連到家長的原始觀察",text:childId==="preview-child-2"?"完成畫作後，和家人分享今天的想法。":"下午到公園玩耍後，回家主動分享見聞。",sourceLabel:"家庭已確認記錄 · 合成",recordId:childId==="preview-child-2"?"preview-care-school":"preview-care-park"},
      {id:"preview-event-pending",at:"2026-10-01T02:00:00Z",kind:"pending_record",title:"新的生活片段待核對",text:"先比較家長原文與助手整理結果；未確認前不寫成家庭事實。",sourceLabel:"私人候選 · 合成示例"},
    ],
  }]},authorityVersion:`preview-authority:${childId}:1`,items:[item,previous],historyHasMore:true,topics,notices:["全部資料及四主題選項均屬合成；沒有執行規則、背景 Agent 或醫療評估。"],eligibleAssignees:[{userId:"preview-mom",name:"媽媽"},{userId:"preview-dad",name:"爸爸"}],canManage:true};
}
