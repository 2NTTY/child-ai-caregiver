# 育有方 Web／手機介面交接

本文件只作**現行整合差異與專項索引**。當前包／下一步讀 [PLAN#active](PLAN.md#active)，已採納呈現讀 [DESIGN_SYSTEM](DESIGN_SYSTEM.md)，開發方法讀 [Web Skill](.agents/skills/web-screen-delivery/SKILL.md)。不在此追加逐包進度或測試流水帳；歷史與失敗原文在[指定版本索引](#history)。

## 共通接線邊界

正式接線採「一處接線，多處呈現」：同一本人／孩子／Server scope 的資料由一個 controller adapter 掌管讀取、保存、原操作及刷新；各頁只接相同投影與回調，不各自再接一套 API／保存邏輯。交接須列出唯一 owner 掛載點與所有 consumer，並驗 A 修改後 B 反映、B 修改後 A 反映；unknown／已確認但讀回失敗由 owner 管理，不以重送當刷新。不同私人／家庭權限不可因共用而合併。既有各頁 fixture 尚未正式同步，不把這項要求宣稱為已完成。

各頁版型按功能焦點安排，與共用元件分開；規範只在 [DESIGN_SYSTEM](DESIGN_SYSTEM.md#function-specific-layouts) 保存，不在交接另寫一套視覺規則。

`*-view-model.ts` 及回調是呈現投影，`src/preview/` fixture／use*Preview／usePreviewOperation 不是正式 transport。各頁合成寫入彼此獨立；正式畫面須由同一授權 controller 投影，不把 fixture 拼成資料庫。業務權限、版本、原 opId／unknown 由 [正式 API](../docs/API.md) 及既有 shared 型別掌管，按 [P2 UI 清單](../docs/P2_UI_HANDOFF.md) 只讀相關部分。

以下只摘要必要安全邊界：身份／孩子／Server 及 generation 隔離，保留正確作用域的原操作與草稿；已確認但讀回失敗只重讀、不重送；候選確認、通知 accepted、本人 ack 及照護完成分開。具體例外及方法在各專項，不在總交接重寫一份契約。

正式掛載前依 [PRODUCTION_UI_HANDOFF](PRODUCTION_UI_HANDOFF.md) 替換 controller／fixture／開發工具，保留真正狀態及清理；移除「預覽」字樣不代表接通。歷次 Web／Android bundle 證據不能代替真 API、跨頁、使用者視覺或真機驗收。

<a id="p2-coverage"></a>
## 功能 → 專項交接 → 正式接點

只讀本次涉及的列。專項保留當時核對的正式 commit／symbol；整合時重核相關差異，不重讀全部功能。

| 功能 | 前端交接 |
|---|---|
| Agent、來源及 composer | [AGENT_HANDOFF](AGENT_HANDOFF.md)、[正式掛載](PRODUCTION_UI_HANDOFF.md) |
| Push／Telegram 本人渠道 | [CHANNELS_HANDOFF](CHANNELS_HANDOFF.md) |
| 照片／原圖 | [PHOTOS_HANDOFF](PHOTOS_HANDOFF.md) |
| 本人模型 key／上限 | [MODEL_SETTINGS_HANDOFF](MODEL_SETTINGS_HANDOFF.md) |
| 私人來源／共享核對 | [SHARED_INPUT_HANDOFF](SHARED_INPUT_HANDOFF.md) |
| 成長關注 | [GROWTH_HANDOFF](GROWTH_HANDOFF.md) |
| 摘要／到診準備 | [SUMMARY_HANDOFF](SUMMARY_HANDOFF.md) |
| 主動聯絡 | [CONTACT_HANDOFF](CONTACT_HANDOFF.md) |
| 個人背景與偏好 | [APPEARANCE_HANDOFF](APPEARANCE_HANDOFF.md) |

| GitHub UI 清單 | 已投影位置 | 仍待主聊天 |
|---|---|---|
| 01 家庭、02 檔案、03 記錄、04 記憶 | `/family`、`/profile`／孩子切換、`/care`、`/memory`；FE-W04／06 | 原控制器／角色／版本／歷史與跨成員刷新 |
| 05 Agent、06 引用／固定求助 | `/chat` 的運行／候選／來源快照／背景結果；FE-W09／17。FE-W25 撤去誤設的常駐求助卡及聊天頭像；「固定」按上文使用者澄清理解 | 原 ChatController composer／回覆、AgentRunApi／Inbox；按正式安全流程在需要時顯示統一的權威求助入口，不能連 fixture |
| 07 成長、08 任務／預約 | `/growth`、`/tasks`；FE-W15／06 | 原 GrowthApi／TaskApi、規則結果、精確歷史／導航及跨頁 |
| 09 聯絡授權、13 執行／投遞 | `/contact` 的本人／grant／台帳，`/tasks` 的 worker metadata；FE-W17／06 | ContactApi／原 opId 控制器、dirty 草稿差異、真 worker／渠道；ack 不作完成 |
| 10 偏好、11 Push、12 Telegram | `/settings` 本人偏好及渠道；FE-W06／07 | 本人身份、瀏覽器／bot adapter、原操作；不把測試接受作收到 |
| 14 照片、15 來源／分享 | `/photos`、`/sources`；FE-W11／14 | 原 PhotoApi／SharedInputApi、附件／模型、正式 catalog、原生選圖／OS share |
| 16 摘要／到診準備 | `/summary`；FE-W16 | CareSummaryApi／Server 統計、完整來源、原收據、精確記錄／任務與跨頁 |
| 17 在線確認／更新 | 各保存／直接操作的特定查核、原版本、草稿／撤權；FE-W06–17 | 原 S07 transport、AbortSignal／世代、可見刷新／正式收據；不套通用假重試器 |
| 18 本人模型／上限 | `/settings` 本人模型區；FE-W13 | ModelSettingsApi／秘密清理／費用及背景同意、metadata／真服務；不重播密鑰 |

首頁的 first_login／incomplete／complete 尚無上述基線權威來源；不能以本地看過頁面代替初始化狀態。沒有資料顯示「未提供」，不猜「沒有過敏／沒有事項」。登入供應商、帳戶匯出／刪除、方案／儲存、PDF／OS 分享、疫苗百分位及獨立知識首頁等未交付契約，不能按圖片加假操作。

<a id="home-assistant-entry"></a>
## 助手式首頁接點

第一區 `agentImportant` 只呈現明確提供的 Agent 重要事項；側欄 `attention` 及第二區 `ongoing` 各自保留來源，不以普通待辦補成 Agent 推送。首頁拍照直接接既有相機，再交同 scope 的對話本地預覽；表單為補改入口。投影／照片所有權、未知與未接通能力沿 [Agent 專項](AGENT_HANDOFF.md#home-assistant-entry)，照片 port 沿 [照片交接](PHOTOS_HANDOFF.md)。本節取代舊首頁 Task／Growth focus 分工；舊 commercial-home-records 錨點僅供歷史追溯。

<a id="commercial-rollout"></a>
## 正式 adapters 的接線映射

| 工作卡／可重用入口 | 主聊天的正式接線位置及責任 | 上下文／移除邊界 |
| --- | --- | --- |
| 1：theme／ui、OperationNotice、ReadStateNotice、FormErrorSummary | 接既有 controller 的合法 read／write 投影及原 callbacks；共用提示不執行 API 或決定重試 | 不以連線、中文 notice 或 UI 顏色推斷保存；保留原 opId／body、reload-needed／unavailable |
| 2：AppShell／NativeAppShell、AppTabPanel／UnderlineTabs | 正式 `app` 外殼與導航沿原 session／URL／dirty guard；保留路由 rail 人工選擇及穩定 Tabs 子樹 | 抽屜清理後返回原控制；身份未知不展示舊私人快照，帳戶入口留設定 |
| 3：ChatTimeline／ChatMessage／AgentComposer | 原 ChatController、AgentRunApi／Inbox 及 [Agent handoff](AGENT_HANDOFF.md)；保持 message id、final snapshot、run phase／公開活動及真正取消 | `recentLimit` 只是已載入視窗；更早歷史須正式游標。清 attachment／blob／track，逐字內容不播報，不顯示內部思維鏈 |
| 4：AnswerSources／CitationText | 由正式 AgentPresentation／KnowledgeEvidence 投影原來源 id、次序、片段及權限；[原引用交接](#answer-citations) | 每訊息／每引用 ref 獨立，instant 到自己的面板，返回原句；沒有真逐句映射就只呈現底部來源，不猜編號 |
| 5：HomeAgentImportant／HomeOngoing／HomeQuickActions | Agent 重要事項、持續觀察與側欄待辦各有獨立同孩子投影；本地拍照 handoff 沿 [助手式首頁接點](#home-assistant-entry) | 未接線不作空清單，不以待辦冒充推送；照片只供未送出預覽，正式身份、上傳、模型及保存分別接線 |
| 6：CareRecordsView／CareRecordDetail、TasksView／TaskForm、MemoryCards／MemoryEditor、PhotosView／PhotoRecordForm、SourcesView／SourceRecordForm | 原 Care／Task／Memory／Photo／SharedInput controllers；按 [P2 對照](#p2-coverage) 及各功能 HANDOFF map metadata、版本、游標、原操作、同意與直接 request 差異 | 權限／身份／Server／孩子變更清草稿、refs、選取及附件。保留未知原操作在正確作用域；不要把 preview hooks／回調當 transport |
| 7：StatusAnnouncement、ModelSettingsView／ChannelCards | 本人 ModelSettingsApi／Push／Telegram adapters；模型 key、直接 unknown 查 metadata、通知原 opId、quota／cooldown及本人回覆沿原契約 | 模型 hidden tab 清秘密；accepted／ack／照護完成分開，Push 不套 Telegram 回覆 gate |
| 8：各 screen 的掛載及 PreviewProvider 替換 | 正式 App／client 的 auth、abort／generation、可見刷新及 scope orchestration；沿 [正式移除清單](PRODUCTION_UI_HANDOFF.md) | 先接真資料／callbacks，再逐項移除 PreviewToolbar／fixture／timer／情境工具；不能搜尋刪「合成」後宣稱接通 |

部分工作表單仍直接依賴 preview controller／PreviewWriteControls／PreviewNavigationGuard，並非全部都可不改 wrapper 直接接正式 API。正式包要替換這些 orchestration 層，重用閱讀、控件和狀態視覺；原業務規則／協定不由本節重定。

**明確缺口：** 任務現有投影沒有獨立 read-error；記憶只有自己的 loading，不能借 Home.recordsLoad 當其失敗。模型查核 failed／429 目前只有 notice／keyCheck=null，正式 adapter 須提供明確失敗／限流投影才可按語義 urgent，不能解析文案。正式 A1–A6／D1、身份世代、真歷史／stream／取消、逐句映射和 raw eventTime 接線仍沿 [既有契約審查](#contract-review)，沒有漏作前端假實作。

<a id="contract-review"></a>
## 正式 App 尚需重核的差異

下表是 FE-W30 在正式版本 `d3213e6` 核對的發現，**不是本次在最新程式重現的結果**。原審查及前端修正見 [固定原文](https://github.com/2NTTY/child-ai-caregiver/blob/c51dd52e0cdea03b1d412a10d08ac6761e010d9b/frontend/HANDOFF.md#contract-review)。正式包先檢查是否已被後續修復，再局部處理；不得按舊行號直接 patch，也不在本次文件整理順帶改程式。

| Review | 已確認的問題／證據 | 建議的局部修法 |
|---|---|---|
| A1 P1 | `app/index.tsx:68–71,257–262`：checking／logout unknown 時保留 careScope，AgentInbox 只按 scope 掛載，online flag 沒有 auth gate；其他面板有 careVisible。這是私人 cache 顯示邊界，沒有證據宣稱已跨帳戶讀取 | 只有已確認的有效身份可顯示／啟動 Inbox；失效 abort。待查原操作可保留於同身份上層，但不能讓未知身份讀舊快照 |
| A2 | `app/index.tsx:104–113` 先 suspendPushBrowser，`records-controller.ts:571–578` 才問 dirty；取消登出仍可能已暫停 Push | 在暫停前完成草稿確認；身份 unknown 時不能擅自恢復渠道 |
| A3 | `FamilyPanel.tsx:73–127,185–203,271–283` 只記 uncertain boolean，unconfirmed 後解鎖；原目標／payload／版本可改。transport `online-transport.ts:141–166` 會阻擋不同 body，因此主要是無法恢復，不能直接推斷重複寫入 | 保存 frozen family／target／payload／version／原 opId callback。unconfirmed 仍 pending，明確重試原 body，不以 reload 解鎖另提交 |
| A4 | root 登出只檢查 Chat／Records dirty；FamilyPanel 本地邀請／代碼／稱呼／偏好只用 beforeunload (`:213–223`) | 聚合各 workspace dirty／pending；未知操作先查核，已確認身份切換／撤權才清理，不只以頁面卸載代替 |
| A5 | `CarePanel.tsx:169–197,199–237,249–256` 背景 focus／online refresh 調用初始 load，重設 query／kind 為 all；搜尋及游標之後已另按 filters 讀取 | 分開 initial 與 background read，保留 applied filters／分頁語義。前端本來已有 activeQuery／activeKind，不為此重做搜尋 |
| A6 | 正式 `MemoryPanel.tsx:21–22,351–354,426–430` 仍漏 confirmedBy／confirmedAt，shared memory 型別已提供 | 在目前與每個歷史版本投影原 metadata；不能用 author 或目前時鐘代替確認者／時間 |
| D1 部分修補 | `CareDetails.eventTime` 有 rawText／at／timeZone／precision；正式 manual form (`CarePanel.tsx:258–264,286–296`) 只存 raw、at=null。summary policy `:62–72` 正確把未知時間排除期間統計，不是摘要公式錯 | 前端已明示未知時間不納入期間摘要。日期／時間／precision 輸入及更正時保留完整 eventTime 尚待正式包；未知不能自動轉 exact，不能用 createdAt 代替 |
| P3 稱呼 | 正式 Family 仍有 UTF-16 `.length` 與 Server code point 80 的差異 | 只修正式表單的同一長度規則；前端現有 `[...value].length` 已符合 |

不支援可取消 Navigation API 的瀏覽器返回、真 session、歷史／stream／取消／逐句引用仍需按正式範圍核對；前端 Edge 合成證據不擴大為跨瀏覽器保證。

<a id="codex-chat-presentation"></a>
## FE-W36 現行聊天接點及證據

共用 ChatMessage／ChatTimeline／AnswerSources 與 AgentComposer 沿 DESIGN_SYSTEM；穩定 textarea、多行／IME 與原 controller 狀態保留。正式活動來源接 AgentRunView／AgentInboxView，移除合成 disclosure／timer，收合不能卸載 unknown 的原操作。

只在審閱相關行為時讀：[聊天及建置](verification/fe-w36-codex-chat/build-checks.json)、[引用返回](verification/fe-w36-citation-return/source-tabs-checks.json)、[來源箭嘴](verification/fe-w36-source-scroll-hint/build-checks.json)。各自只適用其被測版本；完整演變與失敗在 [固定交接](https://github.com/2NTTY/child-ai-caregiver/blob/c51dd52e0cdea03b1d412a10d08ac6761e010d9b/frontend/HANDOFF.md#codex-chat-presentation)。當前動效包仍看 [PLAN](PLAN.md#active)。

<a id="預覽及驗證"></a>
## 預覽入口（舊連結相容）

安裝／預覽命令統一移至 [WORKFLOW#preview](WORKFLOW.md#preview)，檢查方法在 Web Skill；本節不再保存另一份命令或舊測試結果。

<a id="semantic-motion"></a>
## 語意動效接點

正式外殼保留 `MotionProvider`／共用 `src/motion` tokens 與偏好；畫面只提供 stable id、scope、contentKey 及一次性操作 intent。範圍變更清私人呈現及失效回呼，草稿／業務控制器不交給動畫保存。Web Modal 關閉立即釋放原焦點及互動，只允許不可互動的裝飾灰幕短暫退出；native／相機 owner 卸載的限制照實保留。

成熟 Paper／RN Modal 與自訂 portal 的焦點生命週期分開；減少動畫及清理優先於視覺。方法讀 [動效接合](.agents/skills/web-screen-delivery/references/motion-implementation.md)，採納要求讀 [MOTION_SYSTEM](MOTION_SYSTEM.md)。當前結果／下一步只看 [PLAN](PLAN.md#active)；歷史詳細交接可追 [固定 fa696d6](https://github.com/2NTTY/child-ai-caregiver/blob/fa696d60ef390383ddf049b4dfba54bd2069e81a/frontend/HANDOFF.md#semantic-motion)。

<a id="history"></a>
## 歷史與舊錨點

以下只供追溯，不是當前任務／新授權；原全文固定在 master `c51dd52e0cdea03b1d412a10d08ac6761e010d9b`，SHA-256 及前端證據分層入口見 [archive](../_archive/README.md#frontend-history)。原文中 draft、帳號、下一包與「當前」均屬當時快照。保留舊錨點，避免既有證據或專項引用失效。

| 指定主題 | 固定來源 |
|---|---|
| <a id="home-frame-motion"></a>FE-W31：首頁外框動畫及手機標語 | [當時原文](https://github.com/2NTTY/child-ai-caregiver/blob/c51dd52e0cdea03b1d412a10d08ac6761e010d9b/frontend/HANDOFF.md#home-frame-motion) |
| <a id="home-motion-stability"></a>結尾閃動補修 | [當時原文](https://github.com/2NTTY/child-ai-caregiver/blob/c51dd52e0cdea03b1d412a10d08ac6761e010d9b/frontend/HANDOFF.md#home-motion-stability) |
| <a id="chat-timeline"></a>FE-W29：共用聊天時間線及增量顯示 | [當時原文](https://github.com/2NTTY/child-ai-caregiver/blob/c51dd52e0cdea03b1d412a10d08ac6761e010d9b/frontend/HANDOFF.md#chat-timeline) |
| <a id="chat-source-reuse"></a>FE-W28 補修：共用聊天來源及分隔線 | [當時原文](https://github.com/2NTTY/child-ai-caregiver/blob/c51dd52e0cdea03b1d412a10d08ac6761e010d9b/frontend/HANDOFF.md#chat-source-reuse) |
| <a id="shell-feedback"></a>FE-W28 統一捲動、頂部減量及首頁首幀 | [當時原文](https://github.com/2NTTY/child-ai-caregiver/blob/c51dd52e0cdea03b1d412a10d08ac6761e010d9b/frontend/HANDOFF.md#shell-feedback) |
| <a id="home-simplification"></a>FE-W27 首頁減量、孩子入口及手機捲動條 | [當時原文](https://github.com/2NTTY/child-ai-caregiver/blob/c51dd52e0cdea03b1d412a10d08ac6761e010d9b/frontend/HANDOFF.md#home-simplification) |
| <a id="answer-citations"></a>FE-W26 回覆引用及來源面板 | [當時原文](https://github.com/2NTTY/child-ai-caregiver/blob/c51dd52e0cdea03b1d412a10d08ac6761e010d9b/frontend/HANDOFF.md#answer-citations) |
| <a id="chat-presentation"></a>FE-W25 聊天版面減量 | [當時原文](https://github.com/2NTTY/child-ai-caregiver/blob/c51dd52e0cdea03b1d412a10d08ac6761e010d9b/frontend/HANDOFF.md#chat-presentation) |
| <a id="responsive-scroll"></a>FE-W24 捲動及響應式修補 | [當時原文](https://github.com/2NTTY/child-ai-caregiver/blob/c51dd52e0cdea03b1d412a10d08ac6761e010d9b/frontend/HANDOFF.md#responsive-scroll) |
| <a id="login-original-reset"></a>FE-W23 登入原版還原及固定右側裁切 | [當時原文](https://github.com/2NTTY/child-ai-caregiver/blob/c51dd52e0cdea03b1d412a10d08ac6761e010d9b/frontend/HANDOFF.md#login-original-reset) |
| <a id="login-story-balance"></a>FE-W23 登入原版還原及固定右側裁切 | [當時原文](https://github.com/2NTTY/child-ai-caregiver/blob/c51dd52e0cdea03b1d412a10d08ac6761e010d9b/frontend/HANDOFF.md#login-story-balance) |
| <a id="login-background-layout"></a>FE-W23 登入原版還原及固定右側裁切 | [當時原文](https://github.com/2NTTY/child-ai-caregiver/blob/c51dd52e0cdea03b1d412a10d08ac6761e010d9b/frontend/HANDOFF.md#login-background-layout) |
| <a id="toolbar-delete-safeguards"></a>FE-W22 頂部控件及刪除保障 | [當時原文](https://github.com/2NTTY/child-ai-caregiver/blob/c51dd52e0cdea03b1d412a10d08ac6761e010d9b/frontend/HANDOFF.md#toolbar-delete-safeguards) |
| <a id="brand-rename-pending"></a>FE-W21 品牌更名及正式整合邊界 | [當時原文](https://github.com/2NTTY/child-ai-caregiver/blob/c51dd52e0cdea03b1d412a10d08ac6761e010d9b/frontend/HANDOFF.md#brand-rename-pending) |
| <a id="account-navigation-follow-up"></a>帳戶／孩子導航接續 | [當時原文](https://github.com/2NTTY/child-ai-caregiver/blob/c51dd52e0cdea03b1d412a10d08ac6761e010d9b/frontend/HANDOFF.md#account-navigation-follow-up) |
| <a id="commercial-reading"></a>FE-W33 商業方案：共用基礎與完整閱讀切片 | [當時原文](https://github.com/2NTTY/child-ai-caregiver/blob/c51dd52e0cdea03b1d412a10d08ac6761e010d9b/frontend/HANDOFF.md#commercial-reading) |
| <a id="commercial-home-records"></a>FE-W34 商業方案：首頁及記錄工作區 | [當時原文](https://github.com/2NTTY/child-ai-caregiver/blob/c51dd52e0cdea03b1d412a10d08ac6761e010d9b/frontend/HANDOFF.md#commercial-home-records) |
