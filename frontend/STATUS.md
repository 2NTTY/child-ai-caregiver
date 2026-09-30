# 育伴港前端狀態

更新：2026-10-01。只記 `frontend/**`；根目錄 STATUS 才是產品、Server 和正式 App 的進度。

**FE-W06 已交付 `6c7216f`；FE-W07 本人渠道已交付 `1e1fb7b`（draft PR #65）；FE-W08 單一 Agent 入口已交付 `83106c0`（#68）；FE-W09 Agent 投影已交付 `0ff9533`（#69）；FE-W10 手機密度已交付 `596c657`（#70）；FE-W11 照片畫面已實作，必要合成檢查及 Web／Android export 通過。** 視覺、真 API 和原生實機仍待驗。所有修改只在 frontend，沒有改 Server／Agent／正式 App、根依賴、根目錄 AGENTS 或子代理規則文件；持續目標按已合併契約及使用者回饋接續。

| 工作包 | 現況 | 待接續 |
|---|---|---|
| FE-W01–FE-W04 | 主頁、外殼、待辦／鈴鐺、孩子摘要、引導已合併；仍是合成預覽 | 使用者視覺确认、正式 API 接線 |
| FE-W05 | 動態比較樣本已合併，使用者選擇現階段靜態 | 不自動套入 Web／Android |
| FE-W06 Web 流程 | 源碼已實作：照顧記錄搜尋／分頁／詳情／歷史／更正／刪除、結構化檔案、新增／擁有人刪除孩子、家庭邀請／角色／撤權、記憶生命週期、任務／預約、本人偏好；共用 RHF／Zod、日期／時間、選單／Dialog／勾選。最終 Web export 通過 | 使用者比較及主聊天正式接線／驗收 |
| FE-W06 手機介面 | 按手機參考圖完成共用首頁排列、孩子卡片／切換、提問捷徑、重點、待辦、快速記錄；原生 Safe Area／Tabs／鍵盤／返回鍵外殼已實作。最終 Android Hermes／資產 export 通過 | 使用者視覺比較；APK、系統行為、TalkBack／大字體及真機仍未驗 |
| FE-W06 共用設計修訂 | 沿原品牌 OKLCH 色階重新安排中性側欄／畫布、白色資料卡片與主操作；完整 MD3、統一 22 px Dialog／導航選單、SVG 圖標及孩子切換比例。固定輸出預覽通過 | 使用者比較顏色放置；完整可存取及實機仍待驗 |
| FE-W07 渠道設定前端 | 基於已 review 的前端 `6c7216f`；核對主線 `34892c7` 已合併的 S13-W05／W06。新增 /settings 通知渠道、Web Push 權限／訂閱／撤銷／明確測試、Telegram 私人綁定／候選核對／撤銷／投遞與回覆分開；共用控件與合成原操作查核，四尺寸及建置通過 | 使用者視覺驗收；主聊天以本人身份接真 API／瀏覽器 adapter。沒有請求系統權限、Push 訂閱、bot 或真外發 |
| FE-W08 Agent 入口 | 桌面側欄只保留下方主要入口，深綠／SVG／雙層文字及箭嘴；手機對話分頁保留。共用導航改用真 Expo Link，Enter、目前頁面及問題草稿保留通過 | 使用者比較；沒有改 Agent 行為或業務接口 |
| FE-W09 Agent 對話投影 | 基於 `83106c0`；核對主線 `90dacd4` 的 Agent API／Panel／Inbox。共用運行、完整候選、明確共享、原決定查核／重試、來源快照與手動私人結果已實作，四尺寸及建置通過 | [AGENT_HANDOFF](AGENT_HANDOFF.md)；composer 仍只預覽輸入，真聊天／回覆／引用／跨頁同步待主聊天沿原控制器接線 |
| FE-W10 手機比例與密度 | 依最新意見及手機參考，復用 Paper 5.15.3 MD3：主標 22、區塊 16、正文 14–16、次層 12、SVG 20–24，主要控制觸控至少 48；孩子卡片 390／320 均 110 高，快捷格 88。40 個重排、手機關鍵互動／150% Web 文字及 Web／Android export 通過 | [MOBILE_DESIGN](MOBILE_DESIGN.md)；等待視覺比較與原生實機。色階／業務規則未改，正式接線仍由主聊天統籌 |
| FE-W11 照片與記錄 | 原圖選擇／hash／預覽、私人保存、提取同意／候選、人工原文、明確家庭共享、原操作查核、版本／刪除／清理及範圍清除已實作；三項原文單元、44 個重排及照片／手機互動通過 | [PHOTOS_HANDOFF](PHOTOS_HANDOFF.md)；真附件／模型／原生選圖 adapter 及使用者視覺待接線／驗收 |
| 尚未投影的已合併畫面 | GitHub master `ce87370` 已有分享、成長關注、到診摘要、主動聯絡及新增的本人模型 key／可調上限；正式 P2 結案已合併 | FE-W11 後逐項投影；正式整合、未讀及產品整包狀態由主聊天統籌 |

## 已驗證及限制

- 最新 typecheck 通過；19 項表單、日期／時區／DST、家庭、記憶及任務規則單元檢查通過。
- 10 個靜態路由在 1440／1024／390／320 CSS px 共 40 個版面檢查通過；11 組關鍵合成互動檢查通過，沒有 pageerror 或 /api/ 請求，見 [checks-all](verification/fe-w06/checks-all.json)。
- 此後只調整手機首頁問題捷徑換行／排列，針對外殼及手機首頁的再次檢查通過，包含問題準備、原草稿保護、390 四格快捷記錄和 320 重排；見 [checks-shell](verification/fe-w06/checks-shell.json)。
- 2026-09-30 對源碼 checkpoint `4739b9e` 補跑最終 Web export 及 Android Hermes／資產 export，兩者 exit 0；Web 23 個靜態路由輸出，Android 49 項資產。詳細版本及產物見 [build-checks](verification/fe-w06/build-checks.json)。
- 共用設計修訂的 typecheck、16 個 token 對比、Web／Android export 通過；實際 export 在 10 頁四種寬度共 40 個重排及外殼／共用日期／6 種寬度設計檢查通過，沒有 pageerror、console.error 或 /api/ 請求。新證據見 [checks-layout-shell-shared-design](verification/fe-w06-design/checks-layout-shell-shared-design.json)／[build-checks](verification/fe-w06-design/build-checks.json)。沒有改表單業務規則，不重跑已通過的 19 項單元檢查。
- 實際 export 首次檢查曾發現桌面 SSR／client 重排不一致及 favicon 404；以固定品牌啟動畫面和原有 favicon 修復後，上述檢查通過。Web 預覽內容需要 JavaScript，不宣稱完整內容 SSR／SEO。
- 手機截圖展示共用 React Native 元件的 Web 執行結果；沒有 emulator／Android 實機／APK、真 session／Server／通知或正式 E2E 證據。各頁 fixture 寫入彼此獨立，不能当作跨頁同步已接通。
- FE-W07 typecheck、18 組 token 對比、Web 23 個路由輸出及 Android Hermes／31 項資產 export 通過；/settings 渠道在 1440／1024／390／320 重排及未勾選阻擋、失敗／重讀草稿保留、狀態容器、原操作查核、切孩子保留、換帳戶清理、不可用仍可撤銷、Telegram 手動重讀／候選版本／過期／封鎖／回覆語義通過。沒有 pageerror、console.error 或 /api/ 請求；見 [checks-channels](verification/fe-w07/checks-channels.json)／[build-checks](verification/fe-w07/build-checks.json)。沒有因新卡片機械重跑舊 19 項單元或全部頁面。
- FE-W08 typecheck、Web／Android export、10 頁四種寬度共 40 個重排及四尺寸單一入口／固定位置／SVG／Enter／目前頁面／問題草稿檢查通過，沒有 pageerror、console.error 或 /api/ 請求；見 [checks-layout](verification/fe-w08/checks-layout.json)、[checks-agent](verification/fe-w08/checks-agent.json) 及 [build-checks](verification/fe-w08/build-checks.json)。曾發現 role=link 無 href 不能 Enter，以及 Slot 接收 array style 的生產錯誤，已用 Expo Link 和 flattened style 修復；色值／表單規則未變，沿用 FE-W07 18 組對比和既有單元證據。

## 接續入口

先讀本文件、[PLAN](PLAN.md) 及 [HANDOFF](HANDOFF.md)，fetch GitHub 並核對其他 active worktree 的 frontend 重疊。現場分支 `codex/fe-w11-photos`，已 review 的前置 `596c657`（FE-W10 draft PR #70）；直接從 GitHub 讀 P2 UI 交接，再讀照片 API／型別／封裝，交付前已重核最新 master `ce87370`，照片章節及型別／封裝未變，沒有依賴主聊天本機是否已拉取。另外 14 個 active worktree 未見 frontend 重疊；P2 隔離接續沒有豁免正式合併／驗收。B 負責前端交付，使用 `CherylNg-2526` 核對及推送，保留真實 Committer，不改全局認證或 Git 身份。

讓使用者比較 [桌面照片](verification/fe-w11/photos-1440.png)、[320 原圖](verification/fe-w11/photos-320.png)、[320 草稿](verification/fe-w11/photos-320-manual-review.png) 及 [390 手機首頁](verification/fe-w11/home-390-full-layout.png)。FE-W11 typecheck、Web 25 路由／Android export、三項照片原文單元及 [44 個重排／照片／手機互動](verification/fe-w11/checks-layout-photos-mobile-density.json) 通過；既有 19 項規則及 18 組色階對比沿用，沒有機械重跑。其後逐包投影分享、成長、摘要、主動聯絡及新增的本人模型設定；真接線、正式驗收及 P3 真機仍由主聊天統籌，不自行 merge。
