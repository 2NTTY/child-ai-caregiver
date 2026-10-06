# 預覽轉正式介面的移除及接線清單

<a id="production-wiring"></a>
## 正式接線接點

活動狀態及驗收以 [根 INT 計劃](../PLAN.md#production-integration) 為準。INT-W01 已把標準 Web 建置及身份／孩子 owner 接回本目錄；INT-W02 接真聊天、來源、工具結果、持久候選及普通交代。下方預覽清單保留尚待替換位置的用途，不能把已替換位置仍視為合成模式。

- `src/production/ProductionOwner.ts` 持有既有 RecordsController／ChatController；`ProductAgentOwner.ts` 查原 run、來源及待確認索引，`AgentAuthorizationOwner.ts` 管本人預授權、私人交代及原操作收據。畫面收合不卸載待查核操作；換本人／孩子時隔離並取消舊回應。
- `chatScreen.tsx` 使用原 ChatTimeline／ChatMessage／composer；移除合成回覆和計時串流。授權與記憶放收合入口，來源／候選仍沿既有 AgentRunView；不改已確認的版面、美術或動效。
- 普通照護整理與私人備註引用真正資源；前者按家庭權限共享，後者只屬本人陳述。收據不是「已通知」證據；舊保存收據後須另讀目前政策。
- 目前歷史仍為最近 100 則，待確認索引不受此限制。照片提交、其餘功能頁、較舊歷史游標及真 run 取消以根包／契約的未完成項為準，不提供假成功或假停止。跨頁正式投影於 INT-W03 接續。

## 私人來源協助接入補充

設定與聊天均導向同一 sources 清單及 editor；SourceComposer 保留原 create 投影，新增意向由正式接入草稿契約承接，不能塞入舊 API。將 SourceIntakeConversation／Editor 的合成閱讀、建議及確認結果替換為實際授權 controller；無真結果不能顯示已讀、已核實或已接入。正式缺口、回調、同意及清理見 [私人來源交接](SHARED_INPUT_HANDOFF.md#assisted-source-management)；記憶上下文後續安排見 [Agent 交接](AGENT_HANDOFF.md#memory-context-integration)。保留人工入口及唯一資料權威，不挪用原 fetch／extract／confirm 的 unknown／版本契約。


本文件只管由隔離預覽換成正式掛載的移除／替換邊界，不定義另一套產品需求。先沿 [接線閱讀入口](HANDOFF.md#reading-order)；正式 wire schema、授權及 client 封裝回到根 [P2 UI 清單](../docs/P2_UI_HANDOFF.md)／[API](../docs/API.md)。較早 backend 核對基線為 `d3213e6`，本次文件清理未重新驗 backend；整合時固定實際版本，不把歷史缺口當最新已驗結果。

## 接線後移除

| 位置／symbol | 預覽用途 | 正式處理 |
|---|---|---|
| src/components/AppShell.tsx：PreviewToolbar；NativeAppShell.tsx 的同名呼叫 | 「介面預覽 · 合成資料 · 未接駁 Server」、切換情境及 loading／unknown 等模擬控制 | 移除兩個平台的呼叫及僅供工具的展開狀態／選項，不留下空白高度 |
| src/components/agent/AgentConversationPreview.tsx：agent-preview-toggle／expanded、toolsVisible／toolsToggle 及情境工具卡 | 預設收起的合成活動入口；本人身份、運行情境、決定結果、重讀結果及聊天回覆 phase／計時串流的模擬選擇 | 移除合成 disclosure、整個開發工具分支、onPreviewReply 及合成身份選擇；保留 AgentRunView／AgentInboxView 及真正操作回調。隱藏正式活動不能卸載待查核的原操作 |
| src/preview/useChatTimelinePreview.ts：initialMessages／showReply／timer | 合成歷史、逐字計時、假公開工具步驟及最終合成快照 | 整個 hook 替換為真 controller 投影；不能把定時器包成真 streaming adapter，或保存合成訊息／工具結果 |
| 各功能 use*Preview 對應的情境／合成 outcome 控制 | 人為製造成功、衝突、未知、拒絕等畫面 | 由真正 controller 狀態驅動畫面後移除。具體掛接位置見各功能 *_HANDOFF，不批量刪除結果提示 |
| app/(dashboard)/motion-preview.tsx 及比較入口 | A／B／C 動態樣板 | 正式導航／交付不含此比較頁；已採納的 MotionEntrance route 等產品動效須保留，依 [MOTION_SYSTEM](MOTION_SYSTEM.md)，不能連同研究入口刪除 |

外殼及卡片沿自然 flow。刪除工具呼叫即可收回其高度，來源正文的定位使用實際捲動容器，不依工具列高度的固定數字；不另加負 margin 或保留佔位。Web 回首頁首幀量度、孩子控制及 PageFrame 的真內容不能隨預覽工具一起刪除。

## 替換資料或 controller，不能只改文案

| 位置 | 正式接線內容／邊界 |
|---|---|
| src/preview/PreviewContext.tsx／fixture.ts、dashboard/_layout.tsx 的 PreviewProvider | 正式本人／孩子／session、資料及操作回調投影。現有領域 workspace 已讓多頁共用同一合成 owner，仍非正式持久化；正式替換保留[同源界線](HANDOFF.md#shared-workspace-injection)，不拆成各頁獨立資料。BackgroundProvider／私人子樹的合成名稱 scope 須換成穩定本人／session 身份 |
| src/screens/chatScreen.tsx：ChatContents header、kind=intro 正文、useChatTimelinePreview／previewMessage | 接既有 ChatController 與授權訊息；移除固定正文／來源、合成 header 工具及「預覽輸入」分支。保留共用 ChatMessage／ChatTimeline／AnswerSources 和原 composer 資源清理；controller 真成功及授權上下文吻合後才投影訊息 |
| ChatMessageView.phase／activities、ChatTimeline.items／followRequest／recentLimit | 顯示投影不另定 transport：真 phase／公開活動由後端核定，增量更新沿同一 message id、最終快照具權威。followRequest 只表示本人明確提交／回到最新，不用每次收到 delta 都重設跟隨。recentLimit 只是已載入清單的視窗；GET messages 目前最近 100 則，沒有更早游標，超過該範圍須主聊天先補契約。真取消、恢復／去重及逐句引用映射仍待接線 |
| src/components/agent/AgentConversationPreview.tsx：isolated-preview key、useAgentPreview、conversationRunId | 用實際 Server／本人／孩子 key 及 run id；原運行、候選、原決定查核和來源仍由既有 controller 驅動，不能去掉 key 的身份清理 |
| HomeAgentImportant／HomeOngoing／側欄 attention／HomeQuickActions | 第一區接明確 Agent-important owner 投影，第二區接持續觀察，側欄與任務頁才沿同一授權 Task 資料；不能以普通待辦補位 Agent 推送。本地 capture handoff 只到未送出對話預覽，正式相機／上傳／模型／保存及 scope 清理沿 [助手入口交接](AGENT_HANDOFF.md#home-assistant-entry)。移除獨立 fixture，不拼成正式資料庫 |
| NotificationBell 的原操作投影 | 鈴鐺保留。目前角標是需留意操作，不是正式未讀；未讀／通知中心須沿實際已交付契約，不能用網絡連接推斷通知送達 |
| loginScreen.tsx：validate／返回預覽、登入（預覽）及未接通說明 | 接實際身份服務後才替換格式檢查；沒有契約的第三方／手機／忘記密碼功能不能把說明刪掉後加假按鈕 |
| HomeDashboard：introductionPending／onIntroductionPresented | 真正新登入的會話上層重設；同會話首次首頁消耗一次。閱讀 3 秒後上移，切頁、切孩子及重讀不重設；不要改成每次掛載進場 |
| 個人背景選圖／設定中的合成帳戶切換 | 沿 APPEARANCE_HANDOFF 的正式保存及本人隔離缺口；不將本地 blob 直接當成正式 URL。帳戶切換留在設定，頂部只保留鈴鐺及資訊側欄；窄 Web／原生均可從「更多」進入設定 |

## 必須保留

- 保存中、failed、unknown、衝突、撤權／登入失效、各領域原操作查核，以及既有候選確認／共享範圍／按風險的具名確認。普通自動保存與重要記錄確認的目標見 [記錄需求](HANDOFF.md#conversation-change-review)；尚未補齊正式政策前，不自行略過既有 proposal accept。它們是正式業務狀態，不能因曾用模擬情境展示就刪掉。
- 真來源的標題分頁、片段、版本／日期／適用範圍及來源缺失提示；正文編號只按真實映射，不把合成三來源移植成知識證據。
- 最新在底部、歷史閱讀位置、明確回到最新及每則訊息自己的展開／來源狀態；停止的部分文字、failed／unknown 與待確認不能改成普通成功答案。公開過程由資料層核定，內部思維鏈及秘密不進顯示模型。
- 本人／孩子切換的私人內容清理、草稿邊界、未保存附件／blob／camera track 清理。文字依同 scope 草稿規則保留；附件由共用 owner 管理，Today → Assistant 可轉交，離開助手沿既有離頁確認清附件；身份／孩子／Server／授權改變清理舊私人資源及遲到回呼。不可把文字保留推廣成附件永久保留，亦不重設首頁首次 flag。
- 未接通功能的誠實限制，直至它實際接通；真正帳戶刪除及 password／最近身份重新驗證仍由主聊天完成，不把名字輸入或紅色 Dialog 視為身份認證。
- 求助需要時用統一權威來源；聊天沒有常駐求助卡，並非刪除真正求助能力。

順序為：接實際授權資料／控制器 → 逐項移除開發工具與合成分支 → 核對無空白高度、路由／來源定位及首幀 → 按當次正式包的授權驗真身份、原操作未知及跨頁一致性。全域搜尋刪掉「預覽／合成」字樣不能完成接線；`PreviewToolbar` 消失不代表所有功能已可用。隔離畫面的常駐開發說明集中於收合工具，實際未接通／unknown／權限限制就地保留；移走說明不代表正式接線或真 API 已通過。
