# 育伴港 Web／手機介面交接

更新：2026-10-01。只交接 `frontend/**`；正式產品、Server、Agent、權限及協定仍以根目錄文件和程式碼為準。FE-W01–FE-W05 已隨 PR #40–#44 合併；FE-W06 基於穩定 `master` **22f5c667887e8c5a926df59686a460fc3d281c6d**，分支 `codex/fe-w06-care-record-flows`，前端源碼 checkpoint **4739b9e8594b70e78bbea19fe03d80e8cb34fa74**。本包主責 B（Web／App UI），開發責任份額 100%，相對權重 5；使用者透過共用 Codex 統籌，沒有聲稱 B 親自手寫或執行驗證。視覺由使用者驗收，正式接線及真服務由主聊天統籌。

## 交付範圍及入口

**已實作前端源碼；全部資料操作只屬合成預覽，尚未接真 API。** Web／Android 維持靜態，`/motion-preview` 只保留舊比較樣本。所有新增依賴、設定、測試、Skill 和文件均在本目錄；不替換已驗收正式首頁，不修改其他聊天的後端／Agent 或權威文件，不自行 merge。

2026-10-01 已按 GitHub `ce87370` 對照 UI-P2-01–18，補齊本期隔離前端範圍；目前交付仍在 `codex/fe-w11-photos`／draft PR #73，與正式 App 分開。最新新增聯絡及固定求助的入口／控制器差異見 [CONTACT_HANDOFF](CONTACT_HANDOFF.md)，各源碼／證據版本按功能包保存。

| 入口 | 本包前端行為 | 正式接線位置 |
|---|---|---|
| `/`：[HomeDashboard](src/components/HomeDashboard.tsx)、[MobileHomeDashboard](src/components/MobileHomeDashboard.tsx) | 桌面主頁、手機參考圖的問候／孩子卡片／提問捷徑／今日重點／待辦／快速記錄；未知及載入分開。捷徑只準備問題，有原草稿時保留 | [records-controller](../src/client/records-controller.ts) 授權投影；HomeViewModel／HomeActions 在 [view-model](src/view-model.ts) |
| 共用外殼：[AppShell](src/components/AppShell.tsx)、[NativeAppShell](src/components/NativeAppShell.tsx)、[dashboard layout](app/(dashboard)/_layout.tsx) | 左下設定／帳戶與深綠對話入口，置中可返回主頁的 Logo，單一右欄開關，頂部孩子摘要、鈴鐺；原生四個 Tabs 和更多入口 | 正式控制器提供孩子、檔案、任務、操作及身份；不從 fixture 推斷權限 |
| `/care`：[CareRecordsView](src/components/care/CareRecordsView.tsx)、[care-view-model](src/care-view-model.ts) | 分頁搜尋／種類篩選、空頁續載、失敗／游標失效、詳情／歷史、新增／更正、原文及單位精度、共享核對、單筆永久刪除及衝突比較 | [CarePanel](../src/client/CarePanel.tsx)、[care-api](../src/client/care-api.ts)、[CareValues](../src/shared/care.ts) |
| `/photos`：[PhotosView](src/components/photos/PhotosView.tsx)、[photo-view-model](src/photo-view-model.ts) | 原檔／私人保存、模型同意／候選、人工草稿、原圖與記錄家庭共享、原操作／版本查核及兩步刪除；手機快速記錄可到達 | 原 PhotoPanel／photo-api／photos 型別；詳細接口、直接上傳與 opId 分工見 [PHOTOS_HANDOFF](PHOTOS_HANDOFF.md) |
| `/sources`：[SourcesView](src/components/shared-inputs/SourcesView.tsx)、[shared-input-view-model](src/shared-input-view-model.ts) | 本人私人來源／貼上／指定公開清單、正文／片段／候選、人工參考或孩子實際記錄核對、收據及直接 unknown、原版本／範圍清理與刪除 | 原 SharedInputPanel／shared-input-api／shared-inputs；[SHARED_INPUT_HANDOFF](SHARED_INPUT_HANDOFF.md)。合成 catalog／hash 不接成正式來源；完整輸入保持私人 |
| `/profile`：[ProfileView](src/components/profile/ProfileView.tsx)、[profile-view-model](src/profile-view-model.ts) | 未知／生日／約數年齡與日期基準、早產原文、來源、有效期、家庭共享、歷史、更正／檔案刪除；另有新增孩子及擁有人整位孩子刪除確認 | CarePanel／care-api 的 profile；[records-api](../src/client/records-api.ts) 及 records-controller 的孩子建立／刪除 |
| `/family`：[FamilyView](src/components/family/FamilyView.tsx)、[family-view-model](src/family-view-model.ts) | owner／caregiver／viewer、邀請與一次顯示的無效合成碼、預覽／接受邀請、範圍核對、角色調整、撤權及版本比較 | [FamilyPanel](../src/client/FamilyPanel.tsx)、[family-api](../src/client/family-api.ts)、[family 型別](../src/shared/family.ts) |
| `/memory`：[memoryScreen](src/screens/memoryScreen.tsx)、[MemoryCards](src/components/memory/MemoryCards.tsx)、[memory-view-model](src/memory-view-model.ts) | 私人候選、確認家庭共享、來源版本／過期阻擋、更正／停用／刪除／歷史、話題暫緩／終態／明確重開、私人摘要覆蓋明細 | [MemoryPanel](../src/client/MemoryPanel.tsx)、[memory-api](../src/client/memory-api.ts)、[memory 型別](../src/shared/memory.ts) |
| `/tasks`：[TasksView](src/components/tasks/TasksView.tsx)、[task-view-model](src/task-view-model.ts) | 建立共享事項、負責人／時間／時區、改期／轉派、完成／取消、needs_review 明確覆核、版本／歷史／分頁；worker 與提醒資格分開 | [TaskPanel](../src/client/TaskPanel.tsx)、[task-api](../src/client/task-api.ts)、[task 型別](../src/shared/tasks.ts)；對照 S13-W01／W04 |
| `/growth`：[GrowthView](src/components/growth/GrowthView.tsx)、[growth-view-model](src/growth-view-model.ts) | 理由／來源及狀態、知悉／共享任務、暫緩／關閉、有限近況／主題設定、原內容／授權／fact 版本查回及草稿清理 | 原 GrowthPanel／growth-api／growth 型別；[GROWTH_HANDOFF](GROWTH_HANDOFF.md)。不在前端評估規則、背景執行或外發 |
| `/summary`：[SummaryView](src/components/summary/SummaryView.tsx)、[summary-view-model](src/summary-view-model.ts) | 期間、原單位／未知時間／完整來源、有限預約、動態問題／清單及共享核對、原收據／草稿／來源基準清理 | 原 CareSummaryPanel／care-summary-api／care-summary 型別；[SUMMARY_HANDOFF](SUMMARY_HANDOFF.md)。統計由 Server 掌管，沒有 PDF／分享假操作 |
| `/contact`：[ContactView](src/components/contact/ContactView.tsx)、[contact-view-model](src/contact-view-model.ts) | 本人同意／綁定次序、任務 grant／期限／後備／撤回、台帳與本人 ack、原收據／版本／草稿／權限清理 | 原 ContactApi／ContactPanel；[CONTACT_HANDOFF](CONTACT_HANDOFF.md)。正式 clearDrafts 行為須按草稿需求局部調整；沒有前端 worker 或外發 |
| `/settings`：[PreferencesPreview](src/components/PreferencesPreview.tsx)、[ModelSettingsView](src/components/model-settings/ModelSettingsView.tsx) | 本人安靜時段、時區、預約例外；渠道及模型模式／密鑰／費用同意／個人上限、分開用量與 metadata-only 查核；帳戶及引導重看入口 | family-api 的 getPreferences／savePreferences；本人渠道沿 [CHANNELS_HANDOFF](CHANNELS_HANDOFF.md)，模型沿原 ModelSettingsPanel／model-settings-api，詳見 [MODEL_SETTINGS_HANDOFF](MODEL_SETTINGS_HANDOFF.md) |
| `/chat`：[AgentRunView](src/components/agent/AgentRunView.tsx)、[AgentInboxView](src/components/agent/AgentInboxView.tsx) | 對話版式／當頁問題；合成運行／完整候選／引用快照、明確共享、原決定查核、手動私人背景結果 | 原 ChatPanel／chat-controller／product-agent-api／AgentRunPanel／AgentInbox；詳見 [AGENT_HANDOFF](AGENT_HANDOFF.md)。不是通用 opId 流程，真聊天及 Agent 回覆仍待接線 |
| `/login`、`/guide` | 登入／註冊本地格式檢查，引導條件及重看入口 | Better Auth；引導完成來源仍待接線，不把「看過引導」當真初始化完成 |

桌面內容以 onLayout 的實際可用寬度重排；手機首頁在 Web 小於 650 px 或原生入口使用。390 px 快速記錄四格，較窄容器改兩列；孩子卡片可換行，不固定截圖尺寸。原生使用 SafeAreaProvider／useSafeAreaInsets、Expo Router JavaScript Tabs、Android window resize／tabBarHideOnKeyboard 及返回鍵關抽屜；沒有假系統狀態欄。手機 Web 截圖不是 Android 實機證據。

### FE-W10 手機尺寸接續

前置 `0ff9533e1c0afaf7a79cccaaa70854e72b9107fc`（FE-W09 draft PR #69）；本包 `codex/fe-w10-mobile-density`，正式契約基線仍是 `90dacd4`。主責 B；只交付 frontend 顯示及共用元件，沒有改 Server、正式 App、根指導／模型文件或新增依賴。使用者視覺及真機仍待驗收。

- `theme.ts` 的 mobileLayout／mobileType／mobileIcons 集中手機比例；沿 Paper 5.15.3 MD3 的 22／16／14–16／12 字級、20–24 SVG，主要控制觸控至少 48。一般頁由 PageFrame 的 onLayout 決定內容邊距，首頁快速格由實際內容寬度決定四／兩格；Desktop tokens 和 OKLCH 未改。成熟依據、數值及 Skill 見 [MOBILE_DESIGN](MOBILE_DESIGN.md)。
- HomeChild 新增可選的 `ageSummaryLabel`／`ageReferenceLabel` **只屬顯示投影，不是新 API 欄位**。主聊天須從既有年齡／約數／基準資料同時投影二者；缺任一項時顯示完整 ageLabel，禁止解析格式化字串、移除「約」或隱去基準。選單仍顯示完整標籤。ChildPicker 的短「切換」只適用窄卡片，accessible label 保留目前孩子。
- 手機 composer 的「預覽」仍是本地輸入預覽；accessible label 是「預覽輸入」，沒有送出或保存。提問捷徑是獨立橫向列，鍵盤能到達；已有草稿仍禁用，孩子切換／原文保留沿原控制器要求。不要把短按鈕接成第二套 chat transport。
- NativeDashboardTabs 的最小內容高度與 safe-area bottom 分開，底部仍由 Router Tabs 處理；原生外殼只處理頂部／左右 inset。字體保留系統伸縮，沒有固定整頁比例、PixelRatio 補償或虛構系統狀態欄。Android 真字體、鍵盤、返回鍵、TalkBack 和安全區仍待主聊天安排。
- typecheck、Web 23 路由／Android Hermes 31 資產輸出、40 個重排及手機必要互動／150% Web 文字通過；沒有 API、pageerror 或 console.error。證據：[checks](verification/fe-w10/checks-layout-mobile-density.json)／[build-checks](verification/fe-w10/build-checks.json)，[390 主頁](verification/fe-w10/home-390.png)、[320](verification/fe-w10/home-320.png)、[完整排列](verification/fe-w10/home-390-full-layout.png)。Web 放大文字不當作 Android 系統字體驗收。

### FE-W11 照片接續

前置 FE-W10 `596c657fa7c67eb264c31bc65538c6822c360df2`（draft PR #70）；分支 `codex/fe-w11-photos`，源碼／驗證 `ddcf651d820c12f6f46b2c1c01357afb6789fc1f`，由 `CherylNg-2526` 推送及建立 [draft PR #73](https://github.com/2NTTY/child-ai-caregiver/pull/73)。按使用者要求直接讀 GitHub master 的 P2 UI 交接，再讀照片 API／型別／封裝；交付前重核最新 `ce87370`。固定來源連結、元件／操作映射和待接線項見 [PHOTOS_HANDOFF](PHOTOS_HANDOFF.md)。照片章節及型別／封裝未變，總表新增本人模型設定，沒有依賴主聊天 checkout 是否已拉取。

`/photos` 採純 view model／回調、RHF／Zod、共用 Paper／MD3／SVG。Web 真正選擇原檔、hash 及 blob 預覽，本頁沒有 Server／模型呼叫。原生預留 `selectOriginal` 薄 port，未接 adapter 時明確停用；沒有假相機、相簿或權限操作。手機快速格改為記錄情況／原照片／身高體重／睡眠，仍沿四格／兩列及最小 88 的共用密度規則。

必要 typecheck、三項照片原文／數值單元、Web 25 路由／Android Hermes 31 資產 export、44 個重排及照片／手機關鍵互動通過，沒有 pageerror、console.error 或 API 請求。見 [checks](verification/fe-w11/checks-layout-photos-mobile-density.json)／[build-checks](verification/fe-w11/build-checks.json)；[1440 照片](verification/fe-w11/photos-1440.png)／[320 草稿](verification/fe-w11/photos-320-manual-review.png)。未知結果、刪除清理、私人候選、原文與 scope 清除等語義須按照片交接保留；正式 UI 接線及原生實機未驗。

### FE-W12 手機背景及外殼層次增補

按使用者 2026-10-01 意見，以桌面主頁的海旁家庭美術鋪滿 MobileHomeDashboard 問候區背景；基線 `685cdfc`，源碼／驗證交付 `62b07fd`，沿現有 draft PR #73 交付，未合併。原圖在 `assets/images/harbour-family-hero.png`，文字可換行；RN Image 100% 寬高／cover 配 SVG 漸變，左側淡至 canvas、底部接回畫布，裝飾不攔截操作或朗讀。AppShell 的 topbar／compactFacts 及 NativeAppShell 的 header／childStrip 使用相同 sidebar 色；只重新安排現有表面角色，沒有新增色值或資料接口。

typecheck、Web 25 路由／Android Hermes 31 資產 export、44 個共用外殼重排通過；最終圖片尺寸修正後重驗 390／320／150% Web 文字及必要手機互動。其他頁和照片規則沿用未變範圍，不新增單元測試。[證據](verification/fe-w12/build-checks.json)／[桌面](verification/fe-w12/home-1440.png)／[390](verification/fe-w12/home-390.png)／[320](verification/fe-w12/home-320.png)，真機及使用者視覺仍待驗。

### FE-W13 本人模型設定

沿 `433d312` 及現有 draft PR #73，源碼／驗證 `095f1356c1f1d1b9ad62ee1ad589b2d7e23582cb`；直接核對 GitHub `ce87370` 的 UI-P2-18／API／共用型別／正式 ModelSettingsPanel 和 transport，內容未變。新增 /settings「模型設定」及帳戶內入口：平台／個人／停用、秘密欄清理、費用與背景 opt-in、個人上限、平台及個人分開用量、metadata-only 查核及二次刪除。全部仍是無 Server／Google 呼叫的合成預覽，沒有保存真密鑰或建立新業務協定。

typecheck、三項安全／command 輕量檢查、四尺寸／鍵盤／unknown 重讀版本／範圍清理及 390／320 放大文字、Web／Android export 通過，沿共用 Paper／RHF／Zod，沒有新依賴或色階。元件入口、直接 API 回調、無 opId／密鑰重播、已保存後用量讀取失敗、正式接線及真機限制見 [MODEL_SETTINGS_HANDOFF](MODEL_SETTINGS_HANDOFF.md)／[證據](verification/fe-w13/build-checks.json)。使用者視覺及真 API 仍待驗收。

### FE-W14 私人來源與共享核對

沿 `c09c22b` 及現有 draft PR #73，源碼／驗證 `d00a6bb0bd5c48834a00fa3057c5793bd49cf650`；直接核對 GitHub `ce87370` UI-P2-15／API／型別／正式 Panel／封裝。/sources 以私人保存、正文取得、私人候選、人工核對及家庭共享分開呈現；reference 預設備註，family_record 需孩子關係及共享兩份明確同意。候選不確定內容、原日期及原片段保留，無自動採納、網頁抓取、模型呼叫或新增協定。版本／原收據 unknown、已確認但結果不可讀及直接 unknown 的原版本查回沿正式控制器；細節見 [SHARED_INPUT_HANDOFF](SHARED_INPUT_HANDOFF.md)。

照片及來源共用 [RecordDraftFields](src/components/RecordDraftFields.tsx)，不另造表單。AppTextField 使用 Paper 5.x 公開 contentStyle 處理多行捲動內容與浮動標籤，保留字體伸縮。四項來源／三項照片規則、48 個四尺寸重排、關鍵來源互動／390 及 320 放大文字、typecheck 及 Web 27 路由／Android 31 資產 export 通過；實際檔案／bundle 及重用證據見 [build-checks](verification/fe-w14/build-checks.json)。使用者視覺、真 API／跨頁及 OS share／原生真機仍待接線／驗收。

### FE-W15 成長階段關注

源碼／驗證 `ef536e8`，沿 `3e153a7`／現有 draft PR #73，核對 GitHub `ce87370` 的 UI-P2-07、正式 GrowthPanel／growth-api／型別。/growth 按資料模型呈現理由／來源及真正狀態，展開處理選項，知悉與建立共享任務分開；四主題及有限近況沿 API，不預填否定。原完整 body、項目／授權／fact 基準、unknown 和草稿清理沿正式控制器，不套 opId 收據或重做規則。回調、版本／來源失效、精確任務／記憶導航和跨頁缺口見 [GROWTH_HANDOFF](GROWTH_HANDOFF.md)。

typecheck、三項關鍵規則、四尺寸及 390／320 放大文字／導航／互動、Web 29 路由／Android 31 資產 export 通過；[實際證據](verification/fe-w15/build-checks.json)。沿 Paper／RHF／Zod、日期時間和 SVG，沒有新依賴或色彩。使用者視覺及真 API／refresh／跨頁、APK／真機仍待驗。

### FE-W16 照顧摘要與到診準備

源碼／驗證 `10aa70b`，沿 `e61bca2`／現有 draft PR #73，直接讀 GitHub `ce87370` 的 S14-W01 交接及 CareSummaryPanel／API／型別。/summary 顯示 Server 統計、完整來源及原期間，不重新聚合或把未知事件時間歸入當週；RHF useFieldArray 管問題及準備清單，保留原草稿，另核對根契約規範內容及家庭共享。原 opId／confirmed-unread、來源／準備／期間基準比較、失效預約及清理見 [SUMMARY_HANDOFF](SUMMARY_HANDOFF.md)。

typecheck、兩項規則、四尺寸／150% Web 文字／動態增刪及必要互動、Web 31 路由／Android 31 資產 export 通過；[證據](verification/fe-w16/build-checks.json)。沿既有 Paper／RHF／Zod、日期／時區及 SVG／OKLCH，沒有新依賴。使用者視覺、真 API／控制器／統計、精確導航／跨頁及 APK／真機待驗。後續聯絡交付見下，不以此取代產品驗收。

### FE-W17 主動聯絡及固定求助

前置 `3d4badf`，直接讀 GitHub `ce87370` 的 ContactPage／ContactApi／ContactPanel。本人渠道同意／次序／後備資格、任務固定 generic_notice／task_due／期限／跟進／撤回，以及實際台帳／本人收到確認分開；原 opId／409／unknown／confirmed-unread、最新版本、dirty 選項及範圍清理見 [CONTACT_HANDOFF](CONTACT_HANDOFF.md)。正式 ContactPanel 會在 GET／離線清草稿，主聊天不能直接把該畫面行為套回新視圖。

UI-P2-06 固定緊急入口補在 `/chat` 的模型結果前，資料由根 EMERGENCY_HELP 提供、原核對日期保留；官方連結沿 Expo Link／RN Web hrefAttrs。typecheck、三項契約規則、四尺寸／150% Web 文字／關鍵合成操作及固定入口、Web 33 靜態路由／Android 31 資產 export 通過；[證據](verification/fe-w17/build-checks.json)。沒有真 API、網站點擊、模型／通知呼叫或 Client worker。

<a id="p2-coverage"></a>
### 本期 P2 隔離介面覆蓋及界線

下列「已投影」只指 frontend 程式／合成操作及相應輕量證據，不代表正式 App 接通、使用者視覺或產品驗收。最新根 P2 已合併，不能把未接預覽的功能寫成後端未實作。

| GitHub UI 清單 | 已投影位置 | 仍待主聊天 |
|---|---|---|
| 01 家庭、02 檔案、03 記錄、04 記憶 | `/family`、`/profile`／孩子切換、`/care`、`/memory`；FE-W04／06 | 原控制器／角色／版本／歷史與跨成員刷新 |
| 05 Agent、06 引用／固定求助 | `/chat` 的運行／候選／來源快照／背景結果及常駐求助；FE-W09／17 | 原 ChatController composer／回覆、AgentRunApi／Inbox、根 EMERGENCY_HELP；不能連 fixture |
| 07 成長、08 任務／預約 | `/growth`、`/tasks`；FE-W15／06 | 原 GrowthApi／TaskApi、規則結果、精確歷史／導航及跨頁 |
| 09 聯絡授權、13 執行／投遞 | `/contact` 的本人／grant／台帳，`/tasks` 的 worker metadata；FE-W17／06 | ContactApi／原 opId 控制器、dirty 草稿差異、真 worker／渠道；ack 不作完成 |
| 10 偏好、11 Push、12 Telegram | `/settings` 本人偏好及渠道；FE-W06／07 | 本人身份、瀏覽器／bot adapter、原操作；不把測試接受作收到 |
| 14 照片、15 來源／分享 | `/photos`、`/sources`；FE-W11／14 | 原 PhotoApi／SharedInputApi、附件／模型、正式 catalog、原生選圖／OS share |
| 16 摘要／到診準備 | `/summary`；FE-W16 | CareSummaryApi／Server 統計、完整來源、原收據、精確記錄／任務與跨頁 |
| 17 在線確認／更新 | 各保存／直接操作的特定查核、原版本、草稿／撤權；FE-W06–17 | 原 S07 transport、AbortSignal／世代、可見刷新／正式收據；不套通用假重試器 |
| 18 本人模型／上限 | `/settings` 本人模型區；FE-W13 | ModelSettingsApi／秘密清理／費用及背景同意、metadata／真服務；不重播密鑰 |

根契約未交付的登入供應商、帳戶匯出／刪除、方案／儲存、PDF／OS 分享、疫苗百分位及獨立知識首頁等，保留下面具體缺口，不按參考圖添假操作。各頁合成 fixture 獨立，不代表跨頁同步。

## 共用元件與成熟方案

- [theme.ts](src/theme.ts) 是色彩、字級、間距、圓角及 Paper 主題唯一入口；[ui.tsx](src/components/ui.tsx) 集中品牌按鈕、輸入、選單、卡片、標題、分頁和狀態。
- [AppDialog](src/components/AppDialog.tsx) 以 React Native Modal 承載 Paper Dialog，沿其 Web focus trap／Escape／焦點還原。Paper 的 [Modal 官方文件](https://oss.callstack.com/react-native-paper/docs/components/Modal) 要求 accessible modal 採 RN Modal；不用裸 Paper Modal 假設焦點已被限制。
- [AppCheckbox](src/components/AppCheckbox.tsx) 集中勾選、Space、disabled、Web aria-checked 與原生 accessibilityState；[ChildPicker](src/components/ChildPicker.tsx) 集中孩子切換。RN Web 0.21.2 須明確提供相應 ARIA，不因 TypeScript 接受 accessibilityState 就當 DOM 已有狀態。
- 複雜表單沿根工程已採用 RHF 7.88.0／resolvers 5.9.1／Zod 4.5.4；schema 在各功能組件目錄，Controller 接共用欄位，原草稿不為顯示而 trim／數值轉換覆寫；根契約明確規範值時另行核對實際保存內容。
- [DateTimeFields](src/components/DateTimeFields.tsx) 復用 MIT 的 Paper Dates **0.24.0** 日曆／時間輸入及 zh-HK 文案。標準時鐘視窗最小寬度 328，因此小於 360 的容器用同庫公開 TimePicker 的鍵盤模式和共用 Dialog；保留可手填欄位。
- [date-time](src/components/date-time.ts) 透過 MIT Luxon **3.7.2** 處理 IANA 時區轉換；日期本身不变成 UTC instant。安排時間需明確 offset／時區，拒絕無效日、DST 不存在或重複的本地時間，不按電腦時區暗中偏移。未改動的原值保留。
- 基線仍是 Expo 57.0.24／Router 57.0.22／RN 0.86.3／RN Web 0.21.2／Paper 5.15.3。依賴在本目錄鎖版本，不複製 lockfile 覆蓋根檔。路由／畫面／元件／狀態分檔，StyleSheet.create 與組件共置，沒有單一 HTML 巨檔。

重複使用的方法與官方來源在 [前端 Skill](.agents/skills/web-screen-delivery/SKILL.md) 及其原生／表單參考；不重選框架，不把 Skill 變成第二份需求或協定。

2026-09-30 的樣式修訂沿 [COLOR_STRATEGY](COLOR_STRATEGY.md)：原品牌種子、OKLCH 明暗派生與已核對 HEX 集中 theme.ts；完整 MD3 角色及 elevation 防止預設紫色漏入。Paper roundness 是倍率基數 4，Dialog 的實際圓角由 AppDialog 統一為 22 px。AppMenuList 統一導覽列；ChildPicker 的文字層次、方形頭像、桌面 44／52 及手機至少 48 高度集中一處。

使用者認為色階改善後，本次按 Material／Carbon／Atlassian 官方的角色分工重新安排位置：常駐側欄／畫布用 paper 派生中性色，資料卡片／彈窗用白色；次要操作／孩子摘要用 ink，普通圖標用 muted，teal 集中於主要操作、選中及手機重點。既有色階與業務回調保留，狀態不互換；成熟方案與理由見 COLOR_STRATEGY。

[AppIcon](src/components/AppIcon.tsx) 使用 Lucide 1.49.0 公開單圖標入口及 react-native-svg 15.15.4；根 PaperProvider 的 settings.icon 接 PaperSvgIcon，日期、單選及其他內建圖標也沿映射。線寬／尺寸改 iconTokens；新增名稱補此映射。SVG 的 Web 屬性與原生 accessibility 分開，沒有改業務回調。套件仍可能攜帶內建 fallback 字體資產；本包沒有 fork vendor 或以資產存在推斷畫面用了字體圖標。Culori 4.0.2 僅供開發時檢查，不進 runtime。

## 接線及狀態邊界

*-view-model.ts 是顯示模型和回調，不是 wire contract。[preview](src/preview) 的 fixture／use*Preview、[usePreviewOperation](src/preview/usePreviewOperation.ts) 只供展示，不得充當正式 transport。正式版由既有 API／控制器投影畫面，回調交給原 online transport；root shared 型別、Server 授權、收據及版本規則不改。

**各頁合成寫入目前彼此獨立，不能當作跨畫面同步已接通。** 只有新增／整位孩子刪除更新 PreviewProvider 的孩子投影；care／profile／tasks 修改不回填主頁／右欄 fixture。主聊天須用同一個授權 controller／refresh 結果投影所有位置，確認後重讀必要摘要，不能把兩套 fixture 拼成正式資料來源。

| 顯示狀態 | 正式行為 |
|---|---|
| 待確認 | 候選／預覽未保存或公開；核對來源、內容、對象、時間、共享及版本 |
| 處理中 | 保留原操作身份並等候，鎖定重複提交和改變對象的控制 |
| 已保存／已確認刪除 | 必須有可信原操作收據。確認後重讀失敗顯示「已確認，需重讀」，不能轉成未保存或再建立一次 |
| 失敗 | 已知未成功；保留草稿或刪除對象，重新核對才可提交 |
| 結果未知 | 用同一 Server opId 查核；不換 ID 自動重送、提前移除對象、清草稿或重建已刪除資料 |
| 版本衝突 | 保留本地值，並列原基準與最新值；明確換基準，再重新預覽／勾選及確認，不靜默覆蓋 |

合成 preview-operation-*／preview-care-operation-* 不是 Server opId。「已連接」不代表保存或 worker 正常。整合須保留：

1. 以孩子、身份及 generation 隔離請求；切換孩子、登出、身份改變、撤權或整位孩子刪除時清理相應可見資料、草稿、一次性碼、收據查核及遲到回覆，取消／忽略舊請求。同一身份短暫離線保留當頁草稿；沒有跨關閉恢復、離線主庫或 outbox。
2. 搜尋用既有 CareSearch／nextCursor；空頁仍有游標可續載，已載入數量不是總數。游標失效重新搜尋，不重送寫入；原文及查詢不放 URL／日誌。
3. CareValues.quantity 是一組原值／單位／精度，不擴成新協定；事件／加入時間分開。更正時 eventTime 原文未變，沿 CarePanel 保留完整原 eventTime（包括 at、timeZone、precision）；原文改變按既有程式碼重建，不猜精確時間。
4. 刪檔案／單筆照顧記錄／整位孩子是三種範圍。deleteProfile／care.delete 核對 expectedVersion；只有 owner 經 records.deleteChild 及原 childDeletion gate 刪整位孩子，payload 為 confirmChildId。沿原控制器阻擋私人聊天／其他 pending 寫入；Server 確認後才清理孩子和關聯資料。預覽按鈕不是授權機制。
5. owner 管邀請、角色和撤權；caregiver／owner 可寫共享照護，viewer 的私人記憶與家庭共享權限分開。token 只建立時一次展示，清單／URL／日誌不含碼，刷新／離開／切換範圍清除；合成碼不能用於真邀請。
6. 記憶候選另行核對家庭共享；來源變更／過期不能確認舊值。摘要顯示覆蓋 ID／版本，變更後舊摘要失效；本包只讀摘要，沒有模型「生成」假按鈕。終態話題重開建立相連新話題，舊話題保持終態。
7. task、occurrence、work、reminder 和投遞分開。完成／取消不能重開；needs_review 明確覆核終態。workerEnabled=true 不是存活證據，processed 不是發送或照護完成。提醒須匹配 taskVersion／occurrence／接收者當下權限。

## 已交付 API 對照

基線已合併 S05-W02、S06-W02、S07-W03、S09-W02、S13-W01 及 S13-W04；未接線不表示後端沒有實作。詳細 payload 沿既有型別，不另抄第二份協定。

2026-09-30 同步核對主線 `fe7ac9e`：上述 client API／型別沒有變動；S10-W02 已補知識證據的 lastSuccessfulCheckAt／usageScope，仍沒有獨立知識 Web 路由。後續引用畫面須保留公開／組內用途限制，不能把 CHP／RTHK 組內來源當成公開知識卡片。主線的模型規則更新由主聊天管理，本包沒有回寫。

其後同步主線 `34892c7`，PR #58／#59 已合併 Web Push／Telegram：已核對 src/shared/web-push.ts／telegram.ts、src/client/web-push-api.ts／telegram-api.ts、WebPushPanel／TelegramPanel 及 use-web-push。FE-W07 已按這些本人渠道 API 建顯示模型及合成流程，入口與接線映射見 [CHANNELS_HANDOFF](CHANNELS_HANDOFF.md)。切孩子不重綁本人渠道，切帳號／Server 清理舊狀態；accepted 不是已讀，acknowledgedAt 不是照護完成。投遞及主動聯絡完整台帳仍沿 W07，不自行新增未讀協定。

| 領域 | 主聊天應復用 |
|---|---|
| 孩子／身份／私人聊天 | records-api／records-controller 的 session、children、createChild、deleteChild、原 ChatPanel；保留身份及刪除 gate |
| 照顧／檔案 | care-api 的 search／create／revise／history／delete、getProfile／saveProfile／profileHistory／deleteProfile |
| 家庭／偏好 | family-api 的家庭／成員讀取、create／preview／accept／revokeInvitation、changeMember、createChild、get／savePreferences |
| 記憶 | memory-api 的 facts／topics／summary／history、create／confirm／revise／deactivate／delete fact、create／change／reopen／delete topic |
| 任務 | task-api 的 tasks／task／history／createTask／changeTask、S13-W04 work／reminder 投影；不新增前端 worker |
| 一致性 | [online](../src/shared/online.ts) 及原 online transport：原操作收據、版本及可見頁面重讀 |

HomeChild.profileConfirmed／ageLabel／allergiesLabel 只投影同一 selectedChildId 的授權資料。沒有過敏資料是「未提供」，不能寫「沒有過敏」；載入或錯誤不沿用上一位孩子摘要。引導的 first_login／incomplete／complete 尚無本基線權威來源，主聊天須按身份／初始化流程定義；本地看過頁面只是示意。

## 待主聊天接續

- 所有真 session／API／opId／跨畫面及跨成員同步、正式 UI 掛載，以及接線後針對新增介面的必要瀏覽器驗收。主線已經 `9f0febd` 合併既有正式 App 的 S16-W05 Chromium 情景；該證據可按未變部分復用，但沒有驗過本包隔離介面，不要求無理由重跑整套舊情景。
- S13-W05／W06 的本人渠道已在 FE-W07 投影，W07 聯絡授權／台帳已在 FE-W17 投影，待接正式 adapter；真通知中心／未讀另按所屬契約確認。不代改後端／正式 App。
- 最新直接讀 GitHub `ce87370`：P2 正式結案／交付已隨 PR #71 合併，PR #72 新增本人模型 key／可調上限。本期 UI-P2-01–18 已按上表投影；全部隔離畫面仍待正式 adapter／跨畫面接線與必要驗收。P3 未因 Android bundle 完成，不修改主聊天權威文件。
- 真通知中心、Web Push／Telegram／FCM 及未讀。鈴鐺只提示合成原操作，右欄勾選只是本地清單；/tasks 的合成流程另列，不能互相冒充。
- 圖中的第三方／手機登入、忘記密碼、方案／儲存用量、帳戶匯出／刪除、疫苗百分比及知識首頁，不能憑圖片當已承諾 API。手機首頁暫用已有記憶／話題入口；照片已可進入 FE-W11 原檔預覽，沒有假醫療建議、真上傳或咪高峰操作。
- 正式 P3 共用服務、APK／簽署、實機畫面／鍵盤／返回鍵／Safe Area／TalkBack／大字體、登入及相機／通知權限。Android JS bundle 不代表上述已驗收。

## 預覽及驗證

在 frontend/ 執行：

```powershell
npm ci --cache .npm-cache --no-audit --no-fund
$env:__UNSAFE_EXPO_HOME_DIRECTORY = Join-Path (Get-Location) '.expo-home'
$env:EXPO_NO_TELEMETRY = '1'
npm run web -- --port 8082
```

瀏覽 http://localhost:8082。另外按變更執行 npm run typecheck、npm run test:forms、npm run verify:colors、npm run build:web、npm run build:android-ui。npm run verify:web 只驗本機合成畫面；可用 node scripts/verify-ui.mjs care，或 profile／family／tasks／memory／shell／settings／shared／login／deletion／design 選群組。新證據可設定 FRONTEND_VERIFICATION_DIR，避免覆寫舊版本。預設 Edge；其他 Chromium 設 BROWSER_EXECUTABLE，其他埠設 FRONTEND_PREVIEW_URL。

本次固定輸出以 `node node_modules/expo/bin/cli serve --port 8083` 預覽；先執行 build:web，再設 FRONTEND_PREVIEW_URL=http://localhost:8083 檢查。修復 export 的 desktop hydration 418：root 在 Web SSR／首次 client render 顯示同一品牌啟動畫面，effect 後才掛載依 viewport 重排的路由；原生入口不延遲。這是私人隔離預覽的 client UI，需 JavaScript；不是公開內容頁完整 SSR／SEO 方案，也沒有忽略錯誤。app.json 的 favicon 指向 frontend 內原有品牌副本。

共用控件／外殼變更已檢查 **10 個靜態路由 × 1440／1024／390／320 CSS px**，另查表單／歷史／搜尋、確認／失敗／unknown／409、角色／撤權、孩子切換、邀請及終態。腳本監察 pageerror、console.error 和 /api/ 請求，沒有呼叫 Server。19 項單元檢查涵蓋日期／時區／DST、檔案原文／未知、家庭角色／邀請、記憶及任務終態；不是正式服務測試。

證據及截圖在 [verification/fe-w06](verification/fe-w06)，實際結果以 JSON 及 [STATUS](STATUS.md) 為準。手機截圖是共享 React Native 畫面的 Web 執行結果；Android 另有資產／Hermes bundle 建置證據，未跑 emulator／實機。視覺仍待使用者比較，P2／P3 未因前端交付完成。

2026-09-30 已接續上次未完成的收尾，對源碼 checkpoint `4739b9e` 補跑最後版本的 Web／Android export，兩者 exit 0；產物版本見 [build-checks](verification/fe-w06/build-checks.json)。40 個版面／11 組流程及其後手機首頁針對性檢查、typecheck、19 項單元結果沿用，沒有因恢復聊天重跑整套檢查。全部真 API、視覺確認及 Android 實機仍待驗收；交付及文件補完 commit 以本分支 Git 記錄為準。

共用設計修訂另見 [verification/fe-w06-design](verification/fe-w06-design)：typecheck、16 個 token 對比、Web 23 個路由輸出及 Android Hermes／31 項資產 export 通過；固定輸出在 40 個版面及 shell／shared／design 檢查通過（包含 840／744／390／320 的更多選單），沒有 pageerror、console.error 或 /api/ 請求。實際源碼及產物 hash 在該目錄 build-checks.json；19 項未變表單規則沿原證據。曾發現的 SVG accessible DOM、SSR 首次渲染及 favicon 問題已修復並針對性驗證，不以建置成功取代執行畫面。

FE-W07 沿 FE-W06 `6c7216f` 隔離接續；/settings 通知渠道的四尺寸、明確勾選、失敗草稿、同一原操作、切孩子保留／換帳戶清理、候選版本／過期／封鎖及接受／回覆語義通過。Web／Android export 通過；[verification/fe-w07](verification/fe-w07) 保存結果及產物 hash。共用 PreviewWriteNotice 容器按 saved／failed／待確認或 unknown 採淡青綠／淡珊瑚／淡琥珀，處理中維持中性，不再所有狀態都是警告底。操作邏輯未變，沒有重新跑整套舊檢查。

FE-W08 沿 FE-W07 `1e1fb7b`（draft PR #65）隔離接續，只處理使用者最新 Agent 導覽要求：桌面上方去除重複入口，下方 [AgentEntryButton](src/components/AgentEntryButton.tsx) 固定在設定及帳戶上方。沿 Paper TouchableRipple、共用 SVG／原有深綠／字級 token，72 px 內容高度、短用途說明及箭嘴；手機底部分頁保留。沒有改 Agent、資料或業務回調語義。

外殼導覽與 Logo 使用 Expo Link asChild，輸出真 href；Slot 的直接子元件先 flatten style，避免本版 Router／Radix 合併 array／function style。原先只有 role=link 的 div 按 Enter 無效，之後 array style 曾令 export 頁出現 indexed CSS 錯誤；修復後 typecheck、Web／Android export、40 個重排及四尺寸單一入口／Enter／目前頁面／草稿保留通過。證據見 [verification/fe-w08](verification/fe-w08)。正式接線須保留這些共用導航與樣式規則；一般業務寫入繼續由既有 controller／回調驅動，不能因外殼導航而重置草稿或假發送訊息。
