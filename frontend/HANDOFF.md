# 育有方 Web／手機介面交接

更新：2026-10-02。只交接 `frontend/**`；正式產品、Server、Agent、權限及協定仍以根目錄文件和程式碼為準。FE-W01–FE-W05 已隨 PR #40–#44 合併；FE-W06 基於穩定 `master` **22f5c667887e8c5a926df59686a460fc3d281c6d**，分支 `codex/fe-w06-care-record-flows`，前端源碼 checkpoint **4739b9e8594b70e78bbea19fe03d80e8cb34fa74**。本包主責 B（Web／App UI），開發責任份額 100%，相對權重 5；使用者透過共用 Codex 統籌，沒有聲稱 B 親自手寫或執行驗證。視覺由使用者驗收，正式接線及真服務由主聊天統籌。

## 交付範圍及入口

<a id="chat-source-reuse"></a>
### FE-W28 補修：共用聊天來源及分隔線（2026-10-02）

基線 `5980ff41a98b8f34574e308f99e42014423107de`，只修改 frontend，主責 B，沿 draft PR #73。使用者要求來源之間加線、取消淺綠底板，並要求日後每則聊天回覆沿用同一組件；本次直接核對 GitHub master `d3213e6` 的 P2 UI 清單，接口／來源型別 blob 未變，14 個其他 worktree 沒有 frontend 重疊。沒有新 API、依賴或換頁動畫。

[AnswerSources／CitationText](src/components/chat/AnswerSources.tsx)、[上標 Web／原生 adapter](src/components/chat/CitationMarker.web.tsx) 和 [定位 Web／原生 adapter](src/components/chat/locateCitationSource.web.ts) 移到共用 `components/chat/`。[ChatPage](src/screens/chatScreen.tsx) 的回覆及 [AgentRunView](src/components/agent/AgentRunView.tsx) 均直接使用同一份組件；沒有為各畫面複製來源版式。通用來源投影 [ChatCitationView](src/chat-view-model.ts) 不依賴 Agent runtime 或合成 fixture，原 AgentCitationView 僅 alias 此型別，欄位、分類、日期格式及正式協定不變。

**後續每則聊天的使用方式：** 在已按 Server／本人／孩子隔離的訊息子樹中，為每則 AI 回覆渲染一個 AnswerSources，使用該訊息穩定 id 作 key，傳入自己的 `sources`、正文 `children`、`onOpenSource` 和 `onLocateSource`；正文要呈現已核對的引用標記時用 CitationText。來源編號從每則回覆自己的清單開始，展開／收起、標示及 ref 均留在該組件實例，不用全頁共用 selected source，也不把示例標題／來源寫入組件。沒有來源時保留無來源提示，降級旗標仍由資料層傳入。正式 adapter 仍須核對真實編號映射、快照及開啟權限，不能由通用元件猜配來源或執行 API；資料及清理界線沿 [原交接](#answer-citations)／[正式移除清單](PRODUCTION_UI_HANDOFF.md)。

來源面板取消淺綠背景、外框／圓角、12 px 四邊內距及額外橫向留白；相鄰分頁之間加 1 px × 20 px 細直線，首尾不加多餘線。觸控高度仍為 48 px，分頁下方留 8 px 捲動條位置，收起的來源區由原 102 px 縮至 80 px；實際有橫向捲動時核對選中底線與滑塊至少相隔 2 px。selected／located 底線、按下回饋、同項收起、12 項橫向捲動及正文瞬間定位保留。展開詳情分為「引用內容」「版本與核對」「日期與適用範圍」三組，同組欄位靠近、組間用細線及留白分隔；原資料不刪減。

**首頁動畫補修：** [ChildPicker](src/components/ChildPicker.tsx) 的文字 flexGrow 與 [MobileHomeDashboard](src/components/MobileHomeDashboard.tsx) 的外框／位置共用原 intro Animated.Value，由 1 連續變至 0，避免只在動畫結束切換 homeDockedCopy 而把箭嘴由右端瞬移左側。3 秒閱讀、360 ms 上移、一次會話、開選單暫停及中途點擊處理保留。649／390／320 的實際逐幀記錄分別有 21／22／21 個移動幀；原 649 結束時箭嘴跳動約 211 px，補修後三寬度切換終態均約 1 px，來源是外框移除。原生只驗 bundle，實機動畫待驗。證據：[改前](verification/fe-w28-home-motion/before-home-motion-checks.json)／[改後及會話檢查](verification/fe-w28-home-motion/child-control-checks.json)。

**已驗／未驗：** typecheck、Web 35 路由及 Android Hermes 30 資產 export 通過；[沿用來源檢查](scripts/verify-answer-sources.mjs) 在 1440／1024／390／320 核對透明／零內距、3／12 項的相鄰分隔、48 px 目標、同項 click／Enter 收起、長回覆立即定位、不同訊息各自展開／切換且互不干擾、草稿及窄版 150% Web 文字。實際截圖已覆核；沒有 runtime error 或 API／模型請求。[本次證據](verification/fe-w28-source-separators/build-checks.json)／[四尺寸檢查](verification/fe-w28-source-separators/source-tabs-checks.json)。原業務／權限／unknown 及歷史證據保留，沒有全量重跑；使用者視覺、正式真來源接線及原生實機仍待驗收。

<a id="shell-feedback"></a>
### FE-W28 統一捲動、頂部減量及首頁首幀（2026-10-02）

基線 `95431add2b5da596ba85d571025a9aabb8aba6cb`，只修改 frontend，主責 B，沿 draft PR #73。重新從 GitHub 核對 master `d3213e6` 的 P2／API／來源型別 blob 未變，14 個其他 worktree 沒有 frontend 重疊。沒有改正式 App、Server、API 或依賴。

[AppScrollView.web](src/components/AppScrollView.web.tsx) 垂直及橫向都沿原 RN viewport／事件／scrollTo ref 接 OverlayScrollbars；不再讓來源橫向列回退到原生白色軌道。共用 CSS 的 6 px 覆蓋區、border-box／1 px 內距及 4 px 滑塊套用全部 Web 寬度。原本隱藏的 facts／UnderlineTabs／composer indicator 保持隱藏，來源面板顯示同款。原生仍沿 RN／系統捲動，未聲稱手機 App 改成 Web 滑塊。

右上角只保留鈴鐺及資訊側欄，移除 Web／原生帳戶頭像與 Web 被動連線 pill；offline／unknown 業務提示仍在相應內容。設定由桌面側欄、窄 Web「更多」及原生第五個「更多」分頁進入，原生舊帳戶選單的功能移到 [moreScreen](src/screens/moreScreen.tsx)，不是移除路由。

首頁閱讀時間改為 3 秒。MobileHomeDashboard 上移完成後以 hero 內垂直置中的孩子區呈現，不再於返回時用預設高度計算負 margin；快捷記錄首幀用實際視窗及既有內距估算欄數，再沿 onLayout 核對。桌面 HomeDashboard 在 Web useLayoutEffect 透過 RN 公開 viewport 於繪畫前量度可用寬度，保留原生 onLayout；避免 900／1280 返回時先雙欄再單欄。沒有新增全域尺寸 cache 或換頁動畫。

局部檢查通過：320／390／900／1024／1280／1440 返回首幀一致、四種一般寬度及中間寬度的覆蓋條量度、窄版橫向拖動／更多設定／自然分頁高度；八組 3 秒首次會話／選單／減少動畫／斷點及 320 放大文字；四寬度來源分頁／12 項／長回覆瞬間定位／草稿及放大文字。來源 helper 原本只按 overflow:auto／scroll 找 viewport，無溢出時套件可用 hidden；首輪量度失敗後改為辨認既有 overlay viewport，應用程式未因此改動，補驗通過。最終 typecheck、Web 35 路由及 Android Hermes 30 資產 export 通過。[本次證據](verification/fe-w28-shell-feedback/build-checks.json)；既有業務規則及權限／unknown 證據按未變來源沿用，沒有全量回歸或真 API／身份／原生實機驗收。

主聊天按 [正式移除及接線清單](PRODUCTION_UI_HANDOFF.md) 區分開發工具、合成資料替換及必須保留的狀態，不能全域刪「預覽」字樣。換頁動畫只完成 [成熟方案研究](MOTION_OPTIONS.md#page-transitions)，未改路由／外殼進出場；建議先做內容區約 200 ms 的短過場，詳情才交代前進／返回方向，採用待使用者決定。

<a id="home-simplification"></a>
### FE-W27 首頁減量、孩子入口及手機捲動條（2026-10-02）

原基線 `02f76518624066cc75d4be3fde8b3166c6f3a6f7`、交付 `9df6c671e0affe2386ac04498a53d5621c47a210`，本次從交付版補修孩子入口及「登入後首次首頁」生命週期。只修改 frontend，沿 draft PR #73，主責 B。直接重新核對 GitHub master `d3213e6dde2b72fd34a955b5ceebab1f046f3f6e` 的 P2 UI 交接／API／來源型別，內容 blob 未變；14 個其他 worktree 沒有 frontend 修改重疊。沒有更改正式 App、API、業務控制器或依賴。

[MobileHomeDashboard](src/components/MobileHomeDashboard.tsx) 移除首頁提問欄及快速提問三項，也移除孩子右側重複切換按鈕和卡片的日期／已確認列。左側名字／頭像／年齡直接復用 [ChildPicker](src/components/ChildPicker.tsx) 的選單及原 selectChild 回調，取代原來進入 profile 的左側動作；未確認檔案仍標待核對。homeIdentity 只顯示 supplied ageSummaryLabel，缺少時沿原 ageLabel，沒有解析或改寫年齡；完整日期及原文仍在資料模型、選單及 profile。loading 保留讀取狀態。首次登入引導、待辦及快速記錄保留。這是窄版 Web 與隔離原生預覽共用元件；桌面對話按鈕及底部導覽保留，沒有改 HomeActions 協定或草稿範圍。

首頁沿已安裝 RN Animated／Expo Router useFocusEffect。播放記錄現在由 [PreviewProvider](src/preview/PreviewContext.tsx) 的合成會話保留，經首頁入口傳入 [HomeDashboard](src/components/HomeDashboard.tsx) 的可選 `introductionPending`／`onIntroductionPresented`。首次顯示即消耗，不等動畫完成；桌面首次顯示也消耗，以免縮窄才重播。MobileHomeDashboard 只在初次掛載捕捉待播放值；在同一會話來回切頁、切孩子、讀取或 649／650 重掛載均直接顯示已上移版式。真 App 須由既有登入/session 上層投影同樣的顯示 flag／回調，在真正新登入時重設，不能隨路由／孩子／refresh 重設；未傳入時預設不播放。這不是新 API、引導完成狀態或持久登入資料，不使用 localStorage，也未接真登入。

原 FE-W27 提供 5 秒標語閱讀時間；FE-W28 按最新要求改為 3 秒，360 ms 上移至左側 62%，圖片置於獨立背景層，完整 contain 尺寸不動。閱讀期間打開選單暫停，關閉後重新提供閱讀時間；開始移動後點開則先收斂至最終位置，避免停止半途、關閉回跳。AccessibilityInfo 減少動畫模式保留延遲後直接切換；提前離頁清除 timer／停止動畫並保留最終版式，之後返回不再重播。未有孩子時維持提示及建立入口，後續建立孩子不重新啟動動畫。

ChildPicker 的 `homeIdentity`／`homeDocked` 只改首頁：48 頭像、18／14 名字／年齡、至少 72 高度及 20 SVG 箭嘴；動畫後文字按內容收窄，箭嘴距離 8。點開／關閉沿透明底，按下用透明度回饋，取消原通用 open 白色長條；Dialog、完整年齡日期、Enter／Escape及原 selectChild 保留。一般工具列 picker 的比例及樣式不變。

[appScrollView.css](src/components/appScrollView.css) 只在 650 以下縮小 Web 垂直捲動條：6 px 覆蓋區、1 px 橫向內距及 border-box，實測滑塊 4 px，透明軌道不佔寬。首輪量度發現自訂主題沿 content-box，padding 會增加實際覆蓋寬度；手機規則已修正盒模型。沿既有 OverlayScrollbars 的捲動／拖動與清理，沒有自建位置系統；桌面及原生 RN／系統捲動條沿原樣。

補修後的 typecheck、Web 33 路由及 Android Hermes 30 資產 export 通過。[最新證據](verification/fe-w27-child-control/build-checks.json)／[八組局部檢查](verification/fe-w27-child-control/child-control-checks.json)涵蓋 649／390／320 普通首輪、390 減少動畫、閱讀中選單、動畫中點擊、開啟／Escape／切換比例不跳、提前離頁及正常返回不重播、649／650 重掛載、1440／1024 工具列不變及桌面轉窄版不重播、320 的 150% Web 文字。新合成會話可再播放一輪；測試沒有執行真正登入。沒有 runtime error 或 API／模型請求。此前首頁減量、捲動條／日期／草稿／引導及快速記錄的[交付證據](verification/fe-w27-home/build-checks.json)保留，未改部分不重跑整套。使用者視覺、真登入會話接線、APK／原生捲動／動畫與實機仍待驗收；不以 Web 量度代替原生驗收。

<a id="answer-citations"></a>
### FE-W26 回覆引用及來源面板（2026-10-02，現行來源版式）

原版基線 `20da9da6c6f7b5a56e45194b6dc0a3d4acd371a3`、交付 `02f76518624066cc75d4be3fde8b3166c6f3a6f7`；本次從交付版依使用者意見補修。只修改 frontend，沿 draft PR #73，主責 B。重新核對 GitHub master `d3213e6dde2b72fd34a955b5ceebab1f046f3f6e` 的 [P2 UI 交接](https://github.com/2NTTY/child-ai-caregiver/blob/d3213e6dde2b72fd34a955b5ceebab1f046f3f6e/docs/P2_UI_HANDOFF.md)、API 及 product-agent／knowledge 型別；blob 及 14 個其他 worktree 無 frontend 重疊的核對見 [本次 build-checks](verification/fe-w26-source-tabs/build-checks.json)。沒有新 API、依賴或正式 App 改動。

[AnswerSources／CitationText](src/components/chat/AnswerSources.tsx) 復用來源 view model，將每則回答的來源放在正文最底部，以細線分開，只留一個來源分頁組件，移除上方重複清單。分頁顯示編號及來源標題，過多時左右捲動；點一次展開，再點同一項收起，點另一項切換詳情。有效的【n】或 [n] 原文標記以較小上標呈現；點擊立即跳到該則訊息的來源面板，定位、聚焦及標示對應分頁，包括原先未露出的來源；不平滑捲動或自動展開關閉的詳情。內容區保留原片段、發布者／分類、版本校驗、日期、有效期及適用／內部範圍，可獨立捲動。開啟原來源仍只傳原 source id 給既有回調，不直接開未核對 URL。沒有 Portal 或中央來源 Dialog。FE-W28 的底板／分隔線及共用入口由 [補修交接](#chat-source-reuse)接續；本節的驗證及截圖保留原版事實。

[Web 上標](src/components/chat/CitationMarker.web.tsx) 用原生 sup／button 保留文字縮放及鍵盤焦點；[Web 定位](src/components/chat/locateCitationSource.web.ts) 復用實際 ancestor viewport 的 scrollIntoView，明確使用 instant，先定位橫向來源再捲到自己的面板；接近頁尾時沿可捲範圍顯示。展開詳情時也把面板捲到可見位置，避免落在 composer 下方。[原生上標](src/components/chat/CitationMarker.tsx) 及 [原生定位](src/components/chat/locateCitationSource.ts) 使用 RN inline View／Pressable、fontScale、ScrollView measureLayout／scrollTo；橫向來源及垂直面板皆 animated: false，沒有 DOM 或框架新增。小型平台差異按現有薄 adapter 處理；依 [RN Web Text](https://necolas.github.io/react-native-web/docs/text/)、[View](https://necolas.github.io/react-native-web/docs/view/) 及 [RN Text](https://reactnative.dev/docs/text) 核對，2026-10-02，文件核對不等於真機驗收。

**正式引用關聯：** 現有 AgentPresentation／ProductAgentResult 提供 text 和 KnowledgeEvidence 清單，沒有逐句編號、offset 或映射欄位。本元件只呈現原文中有對應清單項的標記；未對應／超出範圍的編號保留原文字，不自動附引用。正式 adapter 須確認正文編號與來源的真實關聯，沿原清單次序及唯一穩定 id 投影，不能由前端按句子、關鍵字或來源標題猜配。沒有映射時仍可呈現底部來源，不製造文內證據。[三來源 fixture](src/preview/answer-citations.ts) 和運行示例只作合成版式，沒有真知識證據或健康建議。

**清理及驗證：** 來源狀態屬單則回覆，原 Server／本人／孩子的 keyed 子樹和 ready／failed／denied 投影不變。原候選、共享勾選、版本／unknown／原決定查核、草稿和 composer 保留。原交付已修正 AnswerSources 和 RunDetails 重複 key 的殘留，本次保持唯一 key。單一分頁版首輪既有 Agent 流程通過權限／孩子清理、unknown／原決定及草稿；其後只調定位 port 和來源可見性，未重跑業務流程，並局部核對原決定／候選／controller 未變。本次四 Web 寬度 1440／1024／390／320 通過單一來源列、來源標題、同項 click／Enter 收起、切來源時詳情可見、12 項橫向捲動及未露出的來源焦點；在一般動畫偏好下，包含加長 1800 px 回覆的正文數字仍立即定位自己的面板。390／320 的 150% Web 文字無橫向溢出。typecheck、Web 33 路由／Android Hermes 30 資產 export 通過，沒有 runtime error 或真 API／模型請求。最後僅 Web 手機捲動條 CSS 盒模型修補，來源 JS／定位及可用寬度未變；沿用其已過的局部檢查。[本次來源證據](verification/fe-w26-source-tabs/source-tabs-checks.json)／[原流程](verification/fe-w26-source-tabs/checks-agent-flow.json)／[桌面面板](verification/fe-w26-source-tabs/single-source-panel-1440.png)／[窄版多來源](verification/fe-w26-source-tabs/many-sources-390.png)。原 [FE-W26 證據](verification/fe-w26/build-checks.json) 保留歷史版式，不當本次版本。使用者視覺、真來源映射／正式接線，以及原生基線／大字體／觸控／定位／輔助技術待驗收。

<a id="chat-presentation"></a>
### FE-W25 聊天版面減量（2026-10-02，現行版本）

基線 `ccc224e2e10006c277e817f7fe5160682732fe8c`，只修改 frontend，沿 draft PR #73，主責 B。直接核對 GitHub master `d3213e6dde2b72fd34a955b5ceebab1f046f3f6e` 的 P2 UI 清單（blob `6488b8c53ae58e37a12e7a3683aea94924aa3981`）。FE-W17 把 UI-P2-06 的「固定緊急求助入口」誤讀為每次聊天均顯示常駐卡；FE-W25 已按使用者指示撤去 `/chat` 的渲染及 import，原顯示快照／元件保留，沒有另加彈窗、按鈕或自動求助。

**2026-10-02 使用者澄清：**「固定」指需要顯示求助入口時，統一使用已核對、最權威的官方入口及資訊，不隨每次回答生成或更換；不代表普通聊天必須常駐展示。移除常駐卡不是取消求助功能或變更這項需求。正式顯示時機仍沿主聊天的安全流程接線，前端不另造症狀判斷，也不恢復舊常駐卡。本次只更正前端解讀，沒有改根文件或正式 App。FE-W25 `build-checks.json` 的 `handoffDifference`／相關待辦保留當時記錄，其需求解讀由本段更正；原建置、檢查及產物不變。

[ChatPage](src/screens/chatScreen.tsx) 移除標題、問題、Agent 回覆及本地預覽問題的頭像；靠右氣泡和回覆卡片區分內容。回覆保留水平列與 `flex: 1`，用回完整寬度；問題仍沿原 82% 上限。原問題／答案／資料說明、按孩子分開的本地訊息、草稿、相機／檔案／語音工具列及候選結果保持原行為。沒有 API、依賴或正式 App 改動。

**已驗／未驗：** typecheck、Web 33 路由及 Android Hermes／30 資產 export 通過；1440／1024／390／320 的訊息列無頭像、問題靠右、答案全列寬、自然間距、本地預覽及離線無常駐求助卡均通過，沒有 runtime error 或 API／模型請求。沿用既有局部檢查入口 `node scripts/verify-ui.mjs emergency-help`，更新其已被取代的展示預期，沒有全量回歸。[證據](verification/fe-w25/build-checks.json)／[桌面](verification/fe-w25/chat-layout-1440.png)／[390](verification/fe-w25/chat-layout-390.png)。使用者視覺、原生實機及正式接線仍待驗收；先前共用流程／捲動證據按各包保留。

<a id="responsive-scroll"></a>
### FE-W24 捲動及響應式修補（2026-10-02，捲動／首頁／登入續用）

基線 `5b77d907fd827198e53f8f41f44c209e12f62310`，只修改 frontend，沿 draft PR #73，主責 B。重核 GitHub master `d3213e6dde2b72fd34a955b5ceebab1f046f3f6e` 的 P2 UI 清單，blob 仍為 `6488b8c53ae58e37a12e7a3683aea94924aa3981`；此包屬視覺及共用捲動修補，不增加 API。來源、建置及同期 worktree 核對見 [build-checks](verification/fe-w24/build-checks.json)。

- [AppScrollView.web](src/components/AppScrollView.web.tsx) 保留 RN Web 原 viewport、onScroll 和 ScrollView ref，只讓 OverlayScrollbars 2.16.0 在同一區域提供覆蓋式垂直捲動條。[局部 CSS](src/components/appScrollView.css) 統一透明軌道及既有 theme 的滑塊色，卸載時 destroy；主要內容、右欄、Dialog／選單及長來源使用同一入口。橫向捲動直接沿 RN，[原生檔](src/components/AppScrollView.tsx) 亦直接導出 RN ScrollView，沒有 DOM／CSS 原生依賴。
- [LoginPage](src/screens/loginScreen.tsx) 在 900 以下只展示單一品牌及表單，移除頂部宣傳故事／插畫；桌面介紹在 Expo BlurView 57.0.3 的半透明面板內，文字本身不模糊。沿用 Expo 57 官方相容版本及 Paper／SVG；原圖固定 x=1552 右界／0.55 透明度、右欄比例及本地登入驗證不變。Android 大尺寸若顯示介紹，目前只有 tint 後備，實際模糊需再接 SDK 57 的 BlurTargetView；手機不渲染此區。
- [HomeDashboard](src/components/HomeDashboard.tsx) 的單欄列取消 `flex: 1` 的高度壓縮，卡片按內容自然增高；雙欄維持原比例。[手機主頁](src/components/MobileHomeDashboard.tsx) 使用 [HomeBackground](src/components/appearance/HomeBackground.tsx) 的 fitIllustration，原圖等比 contain、靠右及垂直置中，兩位人物、手指和腳完整保留，漸淡從實際圖片左緣銜接畫布。這與移除手機登入的宣傳圖片分開；使用者自選背景仍沿原 cover 行為，沒有裁切／改寫圖片原檔或修改保存契約。

**已驗／未驗：** 15 個頁面在 1440／1024／390／320 共 60 次重排、320 本地登入及六尺寸共用 Dialog／SVG／選單檢查通過。最後只再調整完整插畫的漸淡起點，沿用上述不受影響的共用證據；最終 bundle 的局部檢查再次確認桌面六次同頁縮放重排、篩選／空結果／讀取／unknown 高度，320／390／640 完整插畫，桌面模糊及窄登入、無 gutter／透明軌道、溢出有無的欄位不位移、滾輪／PageDown／拖滑塊、右欄獨立捲動、路由清理及 390 × 600 選單焦點。沒有 pageerror、console.error 或 API 請求。typecheck、Web 33 路由及 Android Hermes／30 資產 export 通過；Android export 只證明打包。

見 [重排與既有流程](verification/fe-w24/checks-layout-login-design.json)、[局部檢查](verification/fe-w24/responsive-scroll-checks.json)、[完整 390 圖片](verification/fe-w24/home-whole-390.png)、[縮窄桌面卡片](verification/fe-w24/home-stacked-744.png)、[桌面模糊面板](verification/fe-w24/login-responsive-1440.png)。共用研究已補 [web-screen-delivery Skill](.agents/skills/web-screen-delivery/references/scroll-and-blur.md)。使用者視覺、其他瀏覽器／輔助技術、原生 BlurTargetView 及實機仍待確認；真身份／API 和正式 App 整合維持由主聊天處理。

<a id="login-original-reset"></a>
<a id="login-story-balance"></a>
<a id="login-background-layout"></a>
### FE-W23 登入原版還原及固定右側裁切（2026-10-02，上一版；裁切規則續用）

使用者要求先還原檔案再改；工作 HEAD `4496f47e9880a61a1d70e990895925837de150d6`。已先將 LoginPage、STATUS、PLAN、HANDOFF、DESIGN_SYSTEM 這五個 frontend 檔案還原至登入改版前 `cab28414a39a2b6e25c77c68e349024247623122`，逐一核對 Git blob 一致後才重新修改，見 [還原記錄](verification/fe-w23-reset/restore-checks.json)。Git 歷史及先前 verification 保留；`87d82dc`／`4496f47` 的排列已取代，舊錨點指向本節。只交付前端，沿 draft PR #73，主責 B。

[LoginPage](src/screens/loginScreen.tsx) 保留原品牌介紹／四項功能、右側表單上方 Logo、共用 AppTextField／AppButton 及原 0.55 圖片透明度。桌面右欄 36%／至少 400、卡片最寬 500，左側取得餘下展示空間；介紹的閱讀寬度另限在左側。先前 95% 裁切重心在窄而高的容器仍會裁掉部分右側，本次從 `8295fa7` 改為固定右邊界。

原圖尺寸由 `harbourSourceSize` 記錄（1672 × 941）；`harbourRightEdge=1552` 是已排除太陽、仍保留指尖的可見右邊界。onLayout 取得實際容器，按這個可見範圍計算等比 cover；右側位置固定、垂直置中，視窗變窄只裁掉更多左側，圖片原檔不改。首幀未量得尺寸時先隱藏圖片，避免閃出未裁切版本。若更換素材，須重核尺寸、指尖及太陽的邊界。此版當時的 900 px 以下故事／表單上下排列，已由 FE-W24 的單欄表單取代；以下窄版截圖只屬歷史證據。

本地登入／註冊驗證、密碼顯示及返回主頁的程式保留原內容，沒有 Server／session、密碼保存或新 API／背景偏好。正式認證／初始化仍由主聊天接線。直接重核 GitHub master `d3213e6dde2b72fd34a955b5ceebab1f046f3f6e` 的 UI 清單（blob `6488b8c53ae58e37a12e7a3683aea94924aa3981`）；其他 14 個 worktree 未見 frontend 重疊。

**本次驗證：** 2237 × 1265、1440 × 900、1024 × 1237／768、900 × 1237、390 × 844、320 × 720 共七個尺寸的重排／比例／登入及註冊模式切換通過，包含使用者指出的窄高情況。同頁按 1600 × 1000 視窗的 100%／125%／150%／200% 縮放等效 CSS 尺寸重排，再回原尺寸；這是佈局驗證，沒有操作瀏覽器原生 Zoom 選單，也不把 DPR 當作 zoom。每次右側都停在原圖約 x=1552，指尖完整、太陽在可見範圍外，實際截圖已對照；視覺定位數值並非業務資料。既有 320 本地驗證／密碼顯示／Enter、typecheck、Web 33 路由及 Android Hermes／30 資產 export 通過；沒有 pageerror、console.error 或 API 請求。

見 [版面及重排](verification/fe-w23-anchor/layout-checks.json)、[登入](verification/fe-w23-anchor/checks-login.json)、[source/build](verification/fe-w23-anchor/build-checks.json)、[桌面](verification/fe-w23-anchor/login-1440x900.png) 及 [窄高視窗](verification/fe-w23-anchor/login-1024x1237.png)。上一版 [fe-w23-reset](verification/fe-w23-reset/build-checks.json) 的還原及裁切證據保留；使用者視覺、真身份及原生實機仍待驗收，未重跑無關業務。

<a id="toolbar-delete-safeguards"></a>
### FE-W22 頂部控件及刪除保障（2026-10-01）

基線 `d2f1124fe157d147857b0e644351f3bfbd827b97`，沿現有 draft PR #73，主責 B。只修改 frontend；未改後端、正式 App、權限／刪除協定或依賴。交付前直接重核 GitHub master `d3213e6dde2b72fd34a955b5ceebab1f046f3f6e` 的 [P2 UI 清單](https://github.com/2NTTY/child-ai-caregiver/blob/d3213e6dde2b72fd34a955b5ceebab1f046f3f6e/docs/P2_UI_HANDOFF.md)（blob `6488b8c53ae58e37a12e7a3683aea94924aa3981`）及 [API](https://github.com/2NTTY/child-ai-caregiver/blob/d3213e6dde2b72fd34a955b5ceebab1f046f3f6e/docs/API.md)（blob `69fd07e18f649e4862030001837662d5e2fdc19b`）。相對開包的 `ce87370`，UI 清單只新增育有方品牌說明，API blob 不變；14 個其他 worktree 沒有 frontend 修改重疊。

**頂部入口：** [ToolbarIconButton](src/components/ToolbarIconButton.tsx) 復用 Paper 5.15.3 IconButton，Web／原生鈴鐺及資訊欄開關共用白底／邊框／圓角及 22 px SVG。桌面實際點擊區 44 × 44，手機 48 × 48；用公開 contentStyle 將邊框放在 TouchableRipple 內，不縮小點擊區。Web 明確 aria-expanded；按 Enter 開關資訊欄，Escape 關訊息 Dialog 後回鈴鐺。ConnectionPill 同表面、置中，仍是不可點擊狀態。角色、提示角標、側欄與導航行為不變。

**目前刪除保障清單：以下全屬合成預覽，沒有真正密碼／身份重新驗證。**

| 刪除範圍 | 前端已實作 | 接線／限制 |
|---|---|---|
| 整位孩子及關聯資料 | owner 才有入口；紅色 AppDialog；清楚顯示不可恢復範圍；完整稱呼與範圍勾選都符合才可提交；離線／有其他提交時停用。失敗重新核對；處理中／unknown 不能取消或用 Escape 避開查核 | [DeleteChildPreview](src/components/DeleteChildPreview.tsx) 的 onDeleted／onActiveChange 只屬預覽。正式刪除只用原 `{confirmChildId}`、session 及 x-expected-user-id；網絡失敗／unknown 重讀孩子清單，不把預覽參考當 Server opId |
| 孩子檔案及其歷史 | 頁內顯示原版本與範圍、第二次明確按鈕確認，紅色最終按鈕；不等於刪孩子或全部記錄 | ProfileView／原 profile actions；沿 expectedVersion／confirmDelete、權限及原操作查核 |
| 單筆照顧記錄及其歷史 | 頁內顯示名稱、版本及不可恢復範圍、勾選、紅色最終按鈕；版本衝突先比較，unknown 保留原操作 | CareRecordDelete；原 record actions／版本／收據不變，其他孩子與記錄保留 |
| 記憶事實／話題 | 原內容、版本、範圍及再次核對／勾選，刪除最後按鈕為紅色；停用／終態與刪除不同 | MemoryEditor 的既有 delete_fact／delete_topic、版本／收據；話題完成不會自行刪除記憶 |
| 照片及連結記錄 | 紅色 AppDialog／標題／最後按鈕；原附件／版本與範圍，兩次明確勾選 | PhotosView 原 actions／版本／查核；UI 確認不表示實體檔案／備份已即時清理 |
| 私人來源及連結記錄 | 紅色 AppDialog／標題／最後按鈕；原來源／版本與範圍，兩次明確勾選 | SourcesView 原 actions／收據及 unknown；私人原文不可因預覽同意而自行家庭共享 |
| 個人模型密鑰 | 紅色 AppDialog／標題／最後按鈕及範圍勾選；刪除並停用 AI | ModelSettingsView；秘密立即清理，unknown 重讀 metadata／版本；沒有業務 opId，不通用重送 |
| 整個帳戶 | 未提供可操作刪除按鈕；設定清楚說明尚無完整契約 | 主聊天需處理完整帳戶刪除政策與正式流程；預覽不假收密碼、不清空真帳戶 |

**待主聊天：真正身份重新驗證。** [OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#require-re-authentication-for-sensitive-features) 建議敏感操作重新驗證身份；[Carbon Remove](https://carbondesignsystem.com/community/patterns/remove-pattern/) 對重大不可逆刪除採資源名稱核對。2026-10-01 已讀官方原文。依此建議，刪整位孩子／帳戶等高影響操作須由 Server 執行相應登入方式的重新驗證，並限制有效期、當前身份及目標資源；必要時另用第二因素。輸入名稱／勾選是防誤操作，前端密碼格式檢查不是安全驗證。

目前根 API 的孩子刪除 body 只接受 confirmChildId，沒有此流程的密碼重新驗證欄位／接線；勿任加 password／自定 reauth token。正式整合須沿既有 Better Auth 1.7.5 評估原生能力，由主聊天補權威契約／Server 控制及測試，再將身份驗證結果接確認步驟。維持 owner／session／帳號一致性、原版本、草稿／孩子清理及遲到回覆隔離；unknown 先查原請求的正式來源，不能因重新登入而自動再刪。密碼不進 URL、storage、日誌、收據或一般重試正文。

**已驗／未驗：** typecheck、Web 33 路由／Android Hermes 30 資產 export；1440／1024／390／320 的同表面／SVG／點擊區／置中、鍵盤開關與焦點、紅色孩子 Dialog／稱呼及範圍／取消保留、320 照片兩次確認通過；記錄及孩子失敗／衝突／unknown／owner 隔離沿針對性合成檢查通過。首輪發現舊外殼測試仍找已被照片格取代的飲食格，已對齊現有功能；新樣式測量改為 Paper 公開 surface，關閉檢查等待 React 更新。未為測試更改產品行為。見 [checks](verification/fe-w22/checks-toolbar-safety.json)、[刪除狀態](verification/fe-w22/checks-deletion.json) 及 [sources/build](verification/fe-w22/build-checks.json)，[頂部截圖](verification/fe-w22/toolbar-1440.png)／[刪除確認](verification/fe-w22/child-delete-dialog-1440.png)。使用者視覺、真 API／身份重新驗證、帳戶刪除及 Android 系統／實機仍待驗收；沒有呼叫真 Server 或執行真刪除。

<a id="brand-rename-pending"></a>
**FE-W21 前端品牌更名（2026-10-01，恢復基線 `6f367657179d2d38f4d5ceef6627482658680646`）：** 前端顯示名稱已改為「育有方」，沿 draft PR #73。集中入口是 [branding.ts](src/branding.ts)，各頁標題、平台服務、背景恢復、照片合成名稱及無障礙名稱引用同一來源。[BrandLogo](src/components/BrandLogo.tsx) 復用只讀根 `assets/brand/logo-horizontal.svg` 的弧線／引導光、原 512 × 152 比例與顏色，用 react-native-svg 的文字呈現新名稱。AppShell／NativeAppShell、RootLayout 啟動畫面及 LoginPage 共用此元件；首頁 Logo 保留真路由及鍵盤操作。舊 PNG 留作原素材／測試樣本，已沒有運行時 Logo 引用。

RootLayout 透過已安裝的 Expo Router `Head` 統一 Web 標題；[app.json](app.json) 的靜態 Expo 顯示名稱同步為「育有方 · 前端預覽」，日後須與 brand.previewName 一起維護。各頁及 scripts/flows selector 已同步；合成照片的原檔／hash 不變。當前前端文件／既有 Skill 名稱已更新，歷史 verification 與先前動態建議保留當時名稱。Happy Hues 14、背景和功能語義不變。

typecheck、Web 33 路由 export、Android Hermes／30 項資產 export、15 頁四尺寸共 60 重排、共用 Dialog／SVG／孩子切換及 Agent 導覽通過。最終 1440／1024／390／320 的 SVG 名稱／字框、Web 標題、首頁 Logo 的 Enter 返回及背景／模型／照片名稱通過，沒有 pageerror、console.error 或 API 請求；[brand-checks](verification/fe-w21/brand-checks.json)／[source and build](verification/fe-w21/build-checks.json)。首輪 SVG 字框檢查發現字體度量在小尺寸有不足 1 個 viewBox 單位的上方越界，基線由 116 調至 118 後保留內邊；全頁重排證據在此微調前，最終字框及受影響首頁／登入畫面另驗。登入窄版沿原結構仍有故事／表單兩個 Logo，已修正檢查預期，沒有為測試改畫面排列。

此包沒有遷移內部 slug／Android package、根目錄／Server／正式 App、session／API、GitHub repo 或網域。主聊天正式整合時可復用上述品牌入口，另處理正式 metadata／素材／文檔；Android 字體度量及 App 顯示名稱須在實機核對，bundle 不代替 APK／實機驗收。預覽：在 frontend 執行 `npm run build:web`，再 `npx expo serve --port 8083`；目前已按新名稱重新輸出。使用者視覺、正式身份／API 和原生實機仍待原關口。

<a id="account-navigation-follow-up"></a>
**FE-W20 帳戶導覽補修**（2026-10-01，基線 `24a54c6465ef9b1e84ff2895b3bbac0308b1d047`）：依使用者要求，[AppShell](src/components/AppShell.tsx) 移除左下帳戶卡片／Dialog 及「更多」的重複帳戶項，窄 Web 頭像以 Expo Link 開設定；[SettingsPage](src/screens/settingsScreen.tsx) 的「個人與帳戶 → 登入與安全」提供唯一切換帳戶入口，沿共用 AppButton 開既有 `/login` 預覽。原生更多頁面保留各功能／設定，僅移除直接登入項，避免遺失其他頁面的入口。

此按鈕目前不呼叫 signOut、不切換真身份；正式版由主聊天將其 onPress 接既有登入／退出控制器，沿原規則處理未保存草稿／unknown，取消舊身份讀取並清理私人資料、渠道／模型設定、照片／背景 URI，不能只 router.push 後沿用舊 session。直接核對的 GitHub master 仍為 `ce87370`，P2 UI 交接 blob `8124bf61b31ed402d5b3f1cd264079f931eeeac1`；未改 API／業務協定。1440／1024／390／320 的首頁／設定重排、單一入口／手機 48 觸控／Enter／登入預覽及 typecheck、Web／Android export 通過，見 [account-checks](verification/fe-w20-account-nav/account-checks.json)／[source and build](verification/fe-w20-account-nav/build-checks.json)。兩份既有流程的 selector 已對齊新入口，沒有重跑全部業務／背景測試；原生實機／真帳戶切換及使用者視覺仍待驗收。

**最新 FE-W20**（源碼／驗證 `3ae41c7`）：依使用者指定 [Happy Hues 14](https://www.happyhues.co/palettes/14) 及逐區用色指導替換共用 UI 色盤，保留 Logo／美術與 OKLCH 派生；Agent 用黃底深字，一般提交用深底白字，白卡／白控件與青色導航分層。Web 設定的首頁背景入口可本地換圖／恢復，桌面及手機共用，沒有上傳／保存或新 API。元件／原生 pickImage port、路由區 blur／blob 清理、當前偏好無背景契約及待接線，見 [APPEARANCE_HANDOFF](APPEARANCE_HANDOFF.md)／[FE-W20 證據](verification/fe-w20)。不修改主聊天範圍或自行 merge。

**FE-W19**（源碼／驗證 `f541a2da0f97e2cf463f380d3f8449dad3525892`；基線 `bed1342`／現有 draft PR #73）：按使用者要求，Agent 拍照改成直接開頁內 Web 相機，完整 frame 經原 JPEG／PNG／4 MiB／hash／blob 流程後回原輸入框預覽；等待／取消／權限拒絕／系統選圖後備、原問題保留、track／blob 與遲到回應清理已實作。新增 [AgentComposer](src/components/agent/AgentComposer.tsx) 的私有範圍及 [WebCameraCapture](src/components/photos/WebCameraCapture.web.tsx)，不改後端／聊天契約或依賴。[AGENT_HANDOFF](AGENT_HANDOFF.md) 列回調、清理及能力；[最終檢查](verification/fe-w19/checks-composer-surfaces-camera.json)／[來源及產物 hash](verification/fe-w19/build-checks.json)。typecheck、Web／Android export、四尺寸合成串流／原檔及放大文字通過；沒有真相機、系統權限、上傳或模型呼叫。Webcam／手機權限及視覺待裝置驗收；原生 adapter、正式上傳及真正對話附件待主聊天接線。

**FE-W18**（源碼／驗證 `eb9b48c17160066f585c4fcbd7ad871a27d9045d`；基線 `f3ba9e35b718e68b5a23bf73072ec437cd746d22`）：內嵌控制、資料標籤和側欄開關統一 `controlSurface`；`quietSurface` 留給另一層內容，不改品牌 OKLCH 值。Agent 新增 [AgentInputToolbar](src/components/agent/AgentInputToolbar.tsx)，文字／網址沿原 `/sources`；拍照跳頁已由 FE-W19 取代，檔案選單仍可到 `/photos` 管理原檔。語音／PDF／Word 未支援及保留草稿要求見 [AGENT_HANDOFF](AGENT_HANDOFF.md)，原生相機 port 見 [PHOTOS_HANDOFF](PHOTOS_HANDOFF.md)。正式語音／任意文件及對話附件仍須接線，不能把本地選圖／拍攝當聊天已支持多模態。

FE-W18 只改 frontend。必要 typecheck、20 組對比、15 頁四尺寸共 60 個重排、輸入／草稿／48 觸控與 150% Web 文字、六寬度 Dialog／SVG／選單及 Web／Android export 通過；實際 PNG／結果與產物／23 檔案 hash 見 [build-checks](verification/fe-w18/build-checks.json)／[最終檢查](verification/fe-w18/checks-layout-design-composer-surfaces.json)。首輪發現並修正 Modal 焦點先還原開啟者的競態；Web 已驗、原生未驗。FE-W19 色值／外殼與業務規則未變，沿用上述對比與整頁證據，只補受影響拍攝／輸入流程。

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

源碼／驗證 `ebcaa73`，前置 `3d4badf`，直接讀 GitHub `ce87370` 的 ContactPage／ContactApi／ContactPanel。本人渠道同意／次序／後備資格、任務固定 generic_notice／task_due／期限／跟進／撤回，以及實際台帳／本人收到確認分開；原 opId／409／unknown／confirmed-unread、最新版本、dirty 選項及範圍清理見 [CONTACT_HANDOFF](CONTACT_HANDOFF.md)。正式 ContactPanel 會在 GET／離線清草稿，主聊天不能直接把該畫面行為套回新視圖。

UI-P2-06 固定緊急入口補在 `/chat` 的模型結果前，資料由根 EMERGENCY_HELP 提供、原核對日期保留；官方連結沿 Expo Link／RN Web hrefAttrs。typecheck、三項契約規則、四尺寸／150% Web 文字／關鍵合成操作及固定入口、Web 33 靜態路由／Android 31 資產 export 通過；[證據](verification/fe-w17/build-checks.json)。沒有真 API、網站點擊、模型／通知呼叫或 Client worker。

<a id="p2-coverage"></a>
### 本期 P2 隔離介面覆蓋及界線

下列「已投影」只指 frontend 程式／合成操作及相應輕量證據，不代表正式 App 接通、使用者視覺或產品驗收。最新根 P2 已合併，不能把未接預覽的功能寫成後端未實作。

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
