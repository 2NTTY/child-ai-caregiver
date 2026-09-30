# Agent 對話及私人結果交接

更新：2026-09-30。FE-W09 前置為已 review 的前端 `83106c0`（draft PR #68），分支 `codex/fe-w09-agent-conversation`。正式契約核對穩定主線 `90dacd4e5c0a8be9e490fa7d94830ea369c57521`；只讀 API／控制器，沒有改 Server、正式 App 或根文件。

## 交付與預覽

開啟 `/chat` →「查看來源與候選」。[AgentRunView](src/components/agent/AgentRunView.tsx) 和 [AgentInboxView](src/components/agent/AgentInboxView.tsx) 是受資料模型／回調驅動的共用 React Native 畫面；[agent-view-model](src/agent-view-model.ts) 是顯示投影，不是 HTTP 協定。共用 Paper 按鈕、勾選、選單、卡片、SVG 和既有 OKLCH tokens，沒有新依賴或第二套色盤。

[AgentConversationPreview](src/components/agent/AgentConversationPreview.tsx)／[useAgentPreview](src/preview/useAgentPreview.ts)／[agent-fixture](src/preview/agent-fixture.ts) 只注入合成結果。工具提供不同運行、原決定、讀取、過期和執行區身份情境；沒有模型呼叫、真引用、任務／記憶寫入或外發。原 composer 仍只把問題加入當頁版式，不保存聊天、不要求真 AI 回覆；捷徑不覆蓋已有問題草稿。

候選逐項展示內容、對象、操作、原任務版本、原時差／IANA 時區、來源、可見範圍、建立／期限及候選版本。建立任務、改期／轉派、完成、取消、覆核終態及私人／家庭記憶均有顯示樣本。運行統計和工具結果收在詳情；來源保留原片段、發布者、分類、版本校驗、日期、適用範圍及內部用途限制。沒有百分比、思考過程或假附件／咪高峰。

## 正式接線入口

以下位置已按 `90dacd4` 原文核對；payload、授權、版本及收據仍以這些檔案為準。

| 顯示／回調 | 主聊天復用位置及映射 |
|---|---|
| 問題草稿、已保存訊息及要求回覆 | `src/client/ChatPanel.tsx`、`chat-controller.ts`、`chat-api.ts`；訊息的 `agentRunId` 只連到本人／同一孩子可見的已保存回覆。不得給每次本地輸入配一個假 run |
| `AgentRunActions.refresh` | `product-agent-api.getRun(childId, runId, signal, userId)`；既有 GET `/children/:childId/agent/runs/:runId`。控制器核對運行、孩子及引用／候選歸屬，再投影畫面 |
| 運行、停止原因及統計 | `src/shared/product-agent.ts`、`src/client/AgentRunPanel.tsx`；`countsKnown=false` 投影為 `counts=null`，不顯示零用量。停止原因沿既有 allowlist，不展示任意內部錯誤文字 |
| `proposals[].details` | 逐類投影正式 `value` 的完整內容；`task_change` 保留 action／原任務 expectedVersion／負責對象／新時間與時區／覆核 outcome／note，不能只傳一句標題 |
| `decide`／`retryOriginal` | `product-agent-api.decideProposal` 的既有 POST `.../proposals/:proposalId/decide`；原 proposalId／expectedVersion／decision／confirmShared 完整保留。正式 API 已有 pending／原決定核對，不包成另一套通用寫入流程 |
| 私人背景結果 | `src/client/AgentInbox.tsx` 既有 GET `/children/:childId/agent/runs`；手動讀取最多 20 個 runId／createdAt，再以相同組件開啟。不自造未讀、投遞、輪詢或背景完成通知 |
| 引用與開啟來源 | `ProductAgentResult.citations` 及 `product-agent-api.ts` 的 KnowledgeEvidence 驗證；sourceDate 保留 sourceDateText 或原日期，不把文字硬解析成 instant。versionHash 是版本校驗，不冒稱 contentHash。正式 adapter 核對 HTTPS、主機、無 credentials／控制字元後才提供可開啟 URL |

## 必須保留的語義

- 運行 completed 是「已結束」，不等於照護任務完成；工具成功保存候選不等於候選已執行。接受後保存的任務或記憶由原控制器重新讀取，不複製成另一個 authoritative store。
- 候選是私人待核對內容；接受家庭任務或家庭記憶前明確勾選內容、對象及共享範圍。私人記憶不要求家庭勾選，但仍須明確接受。期限已過或無效、離線、讀取失敗、忙碌及權限失效皆不能提交。terminal 候選不再提供確認按鈕。
- 候選決定 unknown **沒有通用 opId 查核契約**。保留原運行／候選／版本／決定／共享值，阻擋另一個新決定，再讀取原運行。沒有候選不能推斷「未保存」；同版本 pending 也不能聲稱寫入沒發生，只能明確沿用原決定重試，並重新核對共享內容。
- 出現 terminal 候選才清除該 pending；版本改變或既有 API 要求 fresh confirmation 時停用舊基準，再明確核對新內容。409 不能只換 expectedVersion 或直接重送。讀取中清除舊共享勾選；失敗保留原操作但鎖住確認及重試。
- 正式 Server／user／child／run 範圍改變時先換 private subtree 的 key，清除舊結果、引用、勾選及原決定，再開始新讀取；abort／generation 防止舊 response 回填。401／403／404／session_changed 清除私人內容。本包身份工具只切執行區樣本，不是真正全頁換帳戶；正式聊天、草稿、inbox 和其他控制器仍須按既有身份／刪除 gate 一起清理。
- 引用是回答當時的快照，不能保證今天仍適用；無引用不能冒稱官方支持。組內非商業來源不成為公開知識卡片。展示的引用文字和校驗字串均清楚標為合成，沒有真健康資訊或外部網頁。

## 驗證與限制

typecheck、Web 23 個靜態路由及 Android Hermes／31 個資產 export 通過。實際固定 Web 輸出在 1440／1024／390／320 CSS px 核對來源長字串、共享 Space／接受 Enter、收據及問題草稿；針對原決定重試、確認基準變更、讀取失敗／缺失、孩子／執行區身份／撤權清理、手動 inbox、過期、統計未知及任務變更投影的必要合成流程通過，沒有 pageerror、console.error 或 `/api/` 請求。證據見 [checks-agent-flow](verification/fe-w09/checks-agent-flow.json)／[build-checks](verification/fe-w09/build-checks.json)。曾停在工具隨孩子重設及重複狀態文案的測試定位，修正後通過，沒有因此改產品行為。

手機截圖只驗共用組件的 Web 執行結果；正式 ChatController 接線、真 session／Server／模型／知識／跨頁同步、APK／系統字體／TalkBack／返回鍵及主聊天集中驗收未執行。使用者最新要求是重新整理手機比例、大小與密度；下一包獨立處理，不把上述 checks 當視覺滿意或真機通過。
