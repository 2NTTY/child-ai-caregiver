# 育有方前端狀態

更新：2026-10-04。只記 `frontend/**`；根目錄 STATUS 才是產品、Server 和正式 App 的進度。

**FE-W36 引用返回補修：** 「返回引用句」改為 instant 定位原引用的上下文並顯示焦點框，短回覆已可見時也有回饋；改看其他來源後仍返回最初引用。實際指標／Enter、長回覆、四尺寸來源與草稿、typecheck 及 Web export 通過；[補修原因與證據](HANDOFF.md#codex-chat-presentation)。沒有新增計劃階段或正式接線。

**FE-W36 Codex 聊天呈現：** 已研究官方桌面對話／輸入圖，將泛用 ChatMessage／ChatTimeline、每則底部來源及 AgentComposer 套用中性白底、系統字體、800 同寬正文／輸入、15／24 正文及單一圓角輸入面板。Web 多行增減高度、Shift＋Enter／中文選字、精簡工具與箭嘴已實作；合成活動區預設收起，保持原 unknown／候選控制器掛載。四尺寸及短視窗／寬觸控、來源／串流時間線、照片草稿／焦點／清理、原操作恢復、typecheck、Web／Android bundle 通過；[官方研究與選值](CHAT_UI_RESEARCH.md#codex-desktop-presentation)／[交接及證據](HANDOFF.md#codex-chat-presentation)。前置 #80 已合併；沿使用者自行審核後合併授權。正式 Agent／API／歷史游標／軟鍵盤／真機及使用者視覺仍待驗收，沒有改換頁動畫。

**FE-W35 商業方案推廣：** 任務、記憶、照片、私人來源、設定及其他工作頁已套用共用閱讀／工作密度、行式清單、分組細線、讀取狀態、轉換播報及表單錯誤／實際焦點。照片和來源共用欄位；設定 Tabs、秘密及身份／孩子清理保留。補修 blur 驗證令按鈕在按下／放開之間移位的首次點擊問題。60 個靜態重排、桌面及 320 表單、typecheck、35 路由 Web／29 資產 Android bundle 通過；必要流程及範圍證據見 [交接](HANDOFF.md#commercial-rollout)／[檢查](verification/fe-w35-commercial/build-checks.json)。Astra 方案前四階段的採納實作及八卡正式 adapter／預覽移除交接已齊；正式 App 接線、使用者視覺、讀屏及真機仍待主聊天／驗收。使用者本輪已授權自行審核後合併，前置 #78／#79 已依序合併；下方歷史「沿 draft／不自行 merge」不是本輪限制。

**FE-W34 首頁及記錄工作區：** 首頁承接一個明確授權的 focus 投影，正常無事項／讀取不可用分開；已有孩子可直接提問，引導是可選入口。兩種首頁共用焦點及最近記錄，右欄預設收起且不再重複主要內容。記錄詳情改閱讀正文／相關資料／技術 metadata 三層；窄版返回保留篩選、捲動位置及上次查看標記，表單錯誤有欄位關聯、摘要及實際焦點。四尺寸八組首頁／記錄／表單、原照顧流程與九組手機動畫檢查、typecheck、Web／Android bundle 通過。[交接](HANDOFF.md#commercial-home-records)／[證據](verification/fe-w34-home-records/build-checks.json)。接續推廣到待辦、記憶、照片及設定；正式 API、使用者視覺與真機仍待驗。

**FE-W33 商業方案首包：** 按 Astra 全份方案及 DESIGN_REVIEW 的已採納範圍，完成共用字級／表面／觸控密度、純 OperationNotice、狀態轉換播報、可達導覽／路由右欄選擇、Modal 抽屜、真 Tabs 及欄位 ref。普通聊天改連續正文，輸入框及建議分開；來源改閱讀優先、技術區次層、原引用返回及 disclosure 語意。四尺寸來源／時間線、1440／900 短窗／390／320 焦點及 Tabs、60 個靜態重排、typecheck、Web／Android bundle 通過。[交接](HANDOFF.md#commercial-reading)／[證據](verification/fe-w33-reading/build-checks.json)。正式 API、讀屏／真機與使用者視覺仍待驗；下一包首頁及記錄詳情，不改換頁動畫。

**最新 FE-W31 結尾閃動補修：** 使用者回報完成一刻閃動，605 px 量度確認初版最後一幀將容器由 relative／72 高切成 absolute／168 高，文字 flex 及問候子樹亦同時切換。現在整段沿同一自然流佈局，以 minWidth／maxWidth、上移及內距共用 intro；完成只更新可讀狀態，沒有定位、文字 flex 或子樹切換。649／605／390／320 末幀尺寸／箭嘴跳變均為 0，完成後 12 幀穩定；九組局部互動及放大文字、typecheck、Web／Android export 通過。[補修交接](HANDOFF.md#home-motion-stability)／[證據](verification/fe-w31-motion-stability/build-checks.json)。沿原分支及 draft PR #77；保留手機標語、外框半途淡出、3 秒及每會話一次，修正版使用者視覺／真登入／實機仍待驗。

**FE-W31 首頁外框動畫及手機標語初版：** 外框和箭嘴沿同一 intro 進度收窄上移，以實際孩子文字寬度作終點；外框在進度 20%–60% 淡出，孩子資訊保持可見。收起後按內容自然寬度、最多佔左側 62%，避免放大文字被舊量度鎖住。只放大手機首頁問候／副句／標語至 26／16／14，桌面字體不改。649／390／320 逐幀、1440／1024 工具列、3 秒及首次會話、選單／中途點擊／減少動畫和 320 的 150% 文字檢查通過；typecheck、Web／Android export 通過。[交接](HANDOFF.md#home-frame-motion)／[當時證據](verification/fe-w31-home-motion/build-checks.json)。新分支 `codex/fe-w31-home-motion`；初版結尾重排由上方補修取代，真登入會話及原生實機仍待驗。

**最新 FE-W30 契約審查修復：** 已核對使用者提供的 review 與 GitHub `master d3213e6`、前端 `949d088`。修正原操作查核／同一參考重試／已確認待重讀、草稿離頁保護及設定頁籤保留；補記憶權威旗標／確認者／分頁、任務分頁、Push／Telegram 測試差異、來源標籤、照片重連重新核對、模型 key 說明／驗證及 366 日上限。[逐項判定及正式 App 待修項](HANDOFF.md#contract-review)／[證據](verification/fe-w30-contract-review/build-checks.json)。新分支 `codex/fe-w30-contract-review`；使用者已授權以 B 賬號 CherylNg-2526 按相依順序合併 #54／#65／#68／#69／#70／#73 及本次新 PR，GitHub 狀態為合併結果權威。這次授權取代下方歷史條目的「沿 draft／不自行 merge」，不取消真 API、視覺或原生實機關口。

正式 App 的 A1–A6、D1 及孩子稱呼長度另交主聊天，沒有改目錄外程式。瀏覽器返回已驗 Edge 的可取消 Navigation API；缺少該能力的瀏覽器返回仍有缺口，不能當全面跨瀏覽器驗收。重新載入／系統關閉不保證恢復私人草稿，沒有本地持久化或離線寫入隊列。

**FE-W29 出現閃動補修（2026-10-02）：** 使用者確認回到底部會隱藏，但回報出現時閃一下。已重現底部無位移的 wheel 亦會誤顯示；手勢現在只暫停跟隨，按鈕按實際離底距離及 40／24 px 緩衝顯隱，引用跳到尾部也會隱藏而不重啟跟隨。四尺寸逐幀／DOM 變化只有一次出現及隱藏；390 串流中引用定位、歷史錨點、草稿／停止及 scope 清理、typecheck／Web export 通過。[交接](HANDOFF.md#chat-timeline)／[證據](verification/fe-w29-return-stability/build-checks.json)。使用者修正版視覺、真 API 及原生實機仍待驗，沒有重跑完整四尺寸聊天或 Android export。

**FE-W29 懸浮按鈕補修（2026-10-02）：** 「回到最新」改為聊天區底部的透明覆蓋層，只保留按鈕；顯示／收起不佔整行、不改可視高度，兩旁點擊及捲動穿透，與輸入欄留 12 px 間距。1440／1024／390／320 的高度、穿透、Enter 返回及草稿檢查，typecheck／35 路由 Web export 通過；[交接](HANDOFF.md#chat-timeline)／[證據](verification/fe-w29-floating-latest/build-checks.json)。使用者視覺及原生實機仍待驗，未重跑整套聊天或 Android export。

**最新 FE-W29 共用聊天（2026-10-02）：** ChatMessage／ChatTimeline 共用訊息與來源；最新在底部，較早記錄分批展開並保持閱讀位置，回到最新才恢復跟隨。可顯示逐字更新、思考／工具過程、停止、失敗、未知及待確認；安全公開過程預設收起，同一訊息 id 保留展開狀態。四尺寸、390 停止／scope 清理／放大文字、來源再驗、typecheck 及 Web／Android export 通過；[交接](HANDOFF.md#chat-timeline)／[研究](CHAT_UI_RESEARCH.md)／[證據](verification/fe-w29-chat/build-checks.json)。目前正式接口只提供最近 100 則／完整回覆；更早游標、真串流／取消及逐句引用映射待主聊天。全部仍為合成預覽，視覺、正式 API 及原生實機待驗。

**FE-W28 來源補修（2026-10-02）：** 取消淺綠底板及多餘內距，相鄰來源用細直線分隔；底線與滑塊分開，詳情分組加線。首頁文字 flex 與外框共用動畫進度，修正終態箭嘴約 211 px 跳動，三寬度逐幀接縫降至約 1 px。通用 AnswerSources／CitationText 及平台 adapter 移到 `components/chat/`，基本聊天與 Agent 共用；來源投影獨立於 Agent，各訊息各自保留來源、展開及定位狀態。四尺寸的 3／12 項、跨訊息互不干擾、收起／長回覆瞬間定位／窄版放大文字，typecheck、Web／Android export 通過；[復用交接](HANDOFF.md#chat-source-reuse)／[證據](verification/fe-w28-source-separators/build-checks.json)。正式真來源及原生實機、使用者視覺待驗。

**最新 FE-W28（2026-10-02）：** 全部 Web 垂直／橫向捲動條改為 6／4 px 透明覆蓋同款；頂部只留鈴鐺與資訊側欄，設定沿「更多」。首頁等待改 3 秒，修正返回時孩子／快捷欄數及桌面首幀重排。六寬度首幀、來源長回覆／12 項、首次會話／選單／減少動畫／放大文字、typecheck、Web／Android export 通過；[交接](HANDOFF.md#shell-feedback)／[證據](verification/fe-w28-shell-feedback/build-checks.json)。[正式移除清單](PRODUCTION_UI_HANDOFF.md) 已交接，[換頁研究](MOTION_OPTIONS.md#page-transitions)已記錄，換頁動畫未實作。真身份／API／原生實機及使用者視覺待驗。

**此前 FE-W27 首頁孩子入口補修（2026-10-02）：** 同一合成會話只在首次首頁播放 5 秒閱讀／360 ms 上移，切頁返回、提前離頁、切孩子及 649／650 斷點不重播；上層入口預留真正登入會話接線。移除點開時的白色長條，動畫後箭嘴靠近文字；頭像改 48，名字／年齡 18／14，入口至少 72 高。四尺寸、選單／鍵盤／動畫中點擊、閱讀暫停／減少動畫及 320 放大文字、typecheck、Web／Android export 通過；[交接](HANDOFF.md#home-simplification)／[當時證據](verification/fe-w27-child-control/build-checks.json)。此前移除首頁提問／重複切換／日期及手機 6／4 px 覆蓋條的[證據保留](verification/fe-w27-home/build-checks.json)。最新時長及全部 Web 滑塊由 FE-W28 接續；真登入接線、使用者視覺及原生實機仍待驗收。

**FE-W26 來源面板補修（2026-10-02）：** 每則回答只留一個底部來源分頁組件，顯示來源標題；過多可左右捲動，點同一項再收起。正文上標立即跳到該則訊息的來源面板，標示及聚焦對應分頁；沒有平滑捲動，也不自動展開關閉的詳情。四尺寸及長回覆／12 項來源、390／320 放大文字、typecheck、Web／Android export 通過；原 Agent 合成流程沿用未變業務證據。[交接](HANDOFF.md#answer-citations)／[本次證據](verification/fe-w26-source-tabs/build-checks.json)。正式 API 沒有逐句引用映射，真接線須核對正文編號與原來源次序，不能前端猜配。使用者視覺及原生實機仍待驗收；未改根文件或業務控制器。

**最新 FE-W25 聊天版面減量（2026-10-02）：** 按使用者指示移除聊天頁的常駐「緊急求助」卡及標題／訊息頭像；問題保持靠右，Agent 回覆用回完整列寬。1440／1024／390／320 的版面、間距、本地問題預覽及離線檢查，typecheck、Web／Android export 通過；[交接](HANDOFF.md#chat-presentation)／[證據](verification/fe-w25/build-checks.json)。使用者已澄清 UI-P2-06 的「固定」指需要顯示時用統一、最權威的官方入口，不代表常駐；前端已更正解讀，正式觸發仍待主聊天接線。未改根文件、API 或正式 App，視覺／實機仍待驗收。

**FE-W24 捲動及響應式修補（上一版）：** 900 以下的登入頁只保留品牌／表單，桌面介紹文字加 Expo BlurView 半透明模糊面板，續用固定右側裁切。Web 垂直捲動復用 OverlayScrollbars，透明軌道覆蓋內容、不預留寬度；原生及橫向捲動保留 RN ScrollView。桌面首頁轉單欄採自然高度，修正記錄／確認卡片重疊；手機首頁完整等比顯示兩位人物，左側漸淡。15 頁四尺寸重排、登入／共用選單、局部高度／圖片／滑鼠／鍵盤／清理及 Web／Android export 通過；[交接](HANDOFF.md#responsive-scroll)／[證據](verification/fe-w24/build-checks.json)。使用者視覺、Android 實機及原生 BlurTargetView 尚待驗收／接續。

**FE-W23 固定圖片右邊界（上一版）：** 沿用已從 `cab2841` 精確還原的左介紹／右登入、表單品牌及 0.55 圖片透明度；桌面右欄仍為 36%／至少 400。按使用者補充要求，改以原圖 x=1552 作固定可見右邊界，排除太陽並保留指尖；視窗變窄只從左側裁切。當時窄版上下排列已由 FE-W24 的表單單欄取代。七個尺寸（包含 1024 × 1237 窄高視窗）、五次同頁 CSS 縮放等效重排、本地驗證／鍵盤、typecheck 及 Web／Android export 通過；[交接](HANDOFF.md#login-original-reset)／[原版還原證據](verification/fe-w23-reset/restore-checks.json)／[本次建置](verification/fe-w23-anchor/build-checks.json)。舊裁切證據保留；真登入、使用者視覺及原生實機仍待接線／驗收，未宣稱操作瀏覽器原生 Zoom 選單。

**最新 FE-W22（2026-10-01）：** 鈴鐺／資訊欄開關改用同一 [ToolbarIconButton](src/components/ToolbarIconButton.tsx)，白底／邊框／22 px SVG 一致，桌面實際點擊 44、手機 48；「已連接」同表面並置中。共用 danger 按鈕／Dialog 已套用刪除確認；刪整位孩子採紅色彈窗、完整稱呼及範圍勾選，unknown 保留查核。四尺寸、Enter／Escape／焦點、照片二次確認、記錄／孩子失敗及 unknown 檢查、typecheck 及 Web／Android export 通過；[交接及刪除保障清單](HANDOFF.md#toolbar-delete-safeguards)／[證據](verification/fe-w22/build-checks.json)。只有合成操作，帳戶刪除及真正密碼／身份重新驗證尚未實作，待主聊天接線；原生實機及使用者視覺仍待驗收。

**最新 FE-W21（2026-10-01）：** 從暫時收尾基線 `6f36765` 接續，前端顯示品牌已改為「育有方」。[branding.ts](src/branding.ts) 集中名稱及衍生文案，[BrandLogo](src/components/BrandLogo.tsx) 共用原 SVG 圖形與新字樣；Web／原生外殼、登入／啟動畫面、內頁、背景／模型／照片示例及 Web／Expo 顯示名稱同步。typecheck、Web／Android export、60 個重排、共用設計／Agent 導覽及四尺寸 Logo／標題／鍵盤返回通過；[交接](HANDOFF.md#brand-rename-pending)／[證據](verification/fe-w21/build-checks.json)。沿現有 draft PR #73，使用者視覺及原生實機仍待驗收；正式品牌／API 整合由主聊天處理。

**FE-W20 帳戶導覽補修：** 左下帳戶卡片及重複帳戶選單已移除，Agent 固定在設定上方；切換入口集中在「設定 → 個人與帳戶 → 登入與安全」，窄 Web 頭像開設定。四尺寸首頁／設定、Enter／登入預覽、typecheck 及 Web／Android export 通過，見 [交接](HANDOFF.md#account-navigation-follow-up)。真登入／登出／身份切換仍待主聊天，原生只驗 bundle。

**FE-W20 按下效果補修：** Agent 入口移除遺留的實色青色 ripple，復用 Paper 5.15.3 由 onAccent 生成的 12% 透明深色；按住保留黃底與文字。1440／1024 的八項按下／清理、共用 accent／secondary 及鍵盤／草稿檢查、typecheck、Web／Android export 通過，見 [交接補修](APPEARANCE_HANDOFF.md#ripple-follow-up)。沒有新增動畫系統或修改業務／後端；原生實際按下仍待驗。

**最新 FE-W20 `3ae41c7`：共用色盤改為使用者指定的 Happy Hues 14，按用途分配白色內容、淺青導航、深色文字／普通提交、黃色 Agent 入口。** OKLCH 保留給必要派生色，Logo／美術不改；Web「設定 → 應用偏好 → 首頁背景」可本地選圖／恢復，桌面及手機首頁一起套用。typecheck、22 組對比、Web／Android export、60 個重排、六寬度 Dialog／SVG 及四尺寸背景／150% Web 文字通過；[配色](COLOR_STRATEGY.md)／[交接](APPEARANCE_HANDOFF.md)。未上傳／保存，原生選圖及正式背景保存待接線；使用者視覺及真機仍待驗收。

**FE-W19 `f541a2d`：Web 對話的拍照按鈕直接開啟頁內相機，不再跳照片頁。** 按下後才請求相機權限，拍攝回到原輸入框作本地預覽；取消、沒有相機／拒絕權限、系統拍照／選圖後備、移除及切換孩子／離頁清理已實作。復用原 JPEG／PNG、4 MiB、hash／blob 與 Paper／SVG，不新增依賴或後端協定。typecheck、Web／Android export、四尺寸合成串流／原檔與 390／320 放大文字通過；[交接及證據](AGENT_HANDOFF.md)。實際裝置相機／權限待驗收；原生 adapter、上傳及對話附件待接線。

**本期隔離 Web／共用手機前端的已授權實作與必要輕量檢查已齊備，沿現有 [draft PR #73](https://github.com/2NTTY/child-ai-caregiver/pull/73)。** FE-W17 `ebcaa73` 補齊本人同意／任務聯絡授權／投遞台帳，並在對話頁補固定緊急入口；[本包交接](CONTACT_HANDOFF.md)。FE-W16 `10aa70b`、FE-W15 `ef536e8`、FE-W14 `d00a6bb`、FE-W13 `095f135`、照片 `ddcf651` 及手機背景／外殼 `62b07fd` 的證據保留。視覺、真 API 和原生實機仍待驗，未標產品或整套 Web 驗收完成。全部修改只在 frontend，不改 Server／Agent／正式 App、根依賴或指導文件，不自行 merge。

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
| FE-W12 手機背景及外殼層次 | 源碼／驗證已交付 `62b07fd`。海旁家庭插畫鋪滿問候背景，左側及底部漸淡；頂部／孩子摘要列與側欄同色，現有 OKLCH 色階未改。44 個外殼重排、最終 390／320／150% Web 文字、typecheck 及 Web／Android export 通過，沿用 draft PR #73 | [MOBILE_DESIGN](MOBILE_DESIGN.md)／[COLOR_STRATEGY](COLOR_STRATEGY.md)；背景及表面規則已補既有 Skill，待使用者視覺及真機驗收 |
| FE-W13 本人模型設定 | 源碼／驗證 `095f135`，沿 `433d312`／draft PR #73，核對 GitHub `ce87370` 的 UI-P2-18、API／型別／Panel／封裝。模型模式、密鑰及費用／背景同意、上限、分開用量、metadata-only 查核、刪除／unknown 重讀及範圍清理已實作；三項單元、四尺寸及放大文字、typecheck、Web／Android export 通過 | [MODEL_SETTINGS_HANDOFF](MODEL_SETTINGS_HANDOFF.md)；合成資料與無密鑰 metadata，真 API、Google／帳單、使用者視覺及原生真機待接線／驗收 |
| FE-W14 私人來源／共享核對 | 沿 `c09c22b`，直接讀 GitHub `ce87370` UI-P2-15／API／型別／Panel／封裝；私人保存、原日期、指定正文取得、精確片段／候選、參考／孩子實際記錄分開核對、刪除、原收據／直接 unknown 及範圍清理已實作。四項來源／三項照片規則、48 個重排及關鍵來源流程／放大文字、typecheck、Web／Android export 通過 | [SHARED_INPUT_HANDOFF](SHARED_INPUT_HANDOFF.md)；全部合成，真 API／正式清單／跨頁同步、OS share、視覺及原生真機待接線／驗收 |
| FE-W15 成長階段關注 | 沿 `3e153a7`，直接讀 GitHub `ce87370` UI-P2-07／API／型別／Panel。理由／來源／真正狀態、知悉／共享任務分開、暫緩／關閉、四主題及有限近況／共享同意、凍結原 body 查回、版本／草稿／權限及範圍清理已實作；三項單元、四尺寸／150% Web 文字、typecheck 及 Web／Android export 通過 | [GROWTH_HANDOFF](GROWTH_HANDOFF.md)；真 API／規則／refresh、精確任務／記憶及首頁／跨頁、使用者視覺及原生真機待接線／驗收 |
| FE-W16 照顧摘要／到診準備 | 沿 `e61bca2`，直接讀 GitHub `ce87370` 的 S14-W01 交接／API／型別／Panel；完整期間／來源／原單位、有限預約、RHF 動態問題／清單、規範內容／共享核對、原收據及草稿／基準／範圍清理已投影；兩項規則、四尺寸／150% Web 文字、typecheck 及 Web／Android export 通過 | [SUMMARY_HANDOFF](SUMMARY_HANDOFF.md)；真 API／統計與控制器、精確記錄／任務及跨頁、使用者視覺和原生真機待接線／驗收 |
| FE-W17 主動聯絡及功能補缺 | 本人渠道同意／次序／撤回、任務 grant／期限／後備／撤回、台帳／本人 ack 分開、原收據與版本／草稿／範圍清理已投影；UI-P2-06 固定求助入口補齊。三項規則、四尺寸／150% Web 文字、typecheck 及 Web／Android export 通過 | [CONTACT_HANDOFF](CONTACT_HANDOFF.md)；真 API、正式面板 clearDrafts 差異、精確導航、worker／通知及視覺／實機待接線／驗收 |
| FE-W18 表面／輸入入口 | 白色控制與暖灰導航分層，孩子／資料／側欄和共用次要按鈕一致；拍照／檔案／語音工具列、照片 capture／來源導航、草稿及 Modal 關閉後 Web 焦點已實作，輕量檢查通過 | [AGENT_HANDOFF](AGENT_HANDOFF.md)／[證據](verification/fe-w18)；Web capture 實際相機、原生 adapter／焦點、語音、PDF／Word及真對話附件待接續／驗收 |
| FE-W19 對話頁直接拍照 | 沿 `bed1342`；直接重核 GitHub `ce87370`，其他 worktree 無 frontend 重疊。Web 相機／等待／拒絕／後備選圖、原頁照片預覽／原草稿、track／blob 清理及遲到結果隔離已實作；四尺寸合成串流／原檔與必要 build 通過 | [AGENT_HANDOFF](AGENT_HANDOFF.md)／[證據](verification/fe-w19)；取代 FE-W18 拍照跳頁。真相機／權限、原生 adapter、上傳及正式聊天多模態待接線／驗收 |
| 當前功能覆蓋 | 已對照 GitHub `ce87370` UI-P2-01–18，既有契約的本期隔離畫面已投影，見 [覆蓋及界線](HANDOFF.md#p2-coverage) | 接線／跨頁、正式通知中心／未讀與無契約功能由主聊天統籌；不因後端已合併便宣稱預覽接通 |
| FE-W20 配色及自選背景入口 | 第 14 款逐區角色／實際畫面已核對；共用 MD3／SVG／Agent／卡片／導航同步，Web 本地選圖／錯誤保留／跨頁／恢復及 blob 清理已實作，必要輕量檢查通過 | [APPEARANCE_HANDOFF](APPEARANCE_HANDOFF.md)；當前偏好 API 沒有背景欄位，正式保存／帳戶隔離／原生 adapter／視覺及實機待接線／驗收 |
| FE-W21 前端品牌更名 | 共用名稱／SVG Logo、各頁文案、Web／Expo 顯示名稱及相應 selector 已同步；四尺寸、鍵盤及 Web／Android export 通過 | [HANDOFF](HANDOFF.md#brand-rename-pending)；使用者視覺、Android 字體／App 顯示名稱實機與正式品牌整合待驗收／接線 |
| FE-W22 頂部控件及刪除保障 | 共用鈴鐺／側欄按鈕、置中狀態、danger 樣式及整位孩子稱呼／範圍確認已實作；四尺寸、必要合成操作及 Web／Android export 通過 | [HANDOFF](HANDOFF.md#toolbar-delete-safeguards)；帳戶刪除／Server 身份重新驗證、真 API、視覺與實機待接續／驗收 |
| FE-W23 登入原版還原及裁切 | 五檔精確還原證據保留；固定圖片右邊界，排除太陽並保留指尖，變窄由左側裁切；七尺寸、同頁重排、本地操作及 Web／Android export 通過 | [HANDOFF](HANDOFF.md#login-original-reset)；真身份、使用者視覺及原生實機待接線／驗收 |
| FE-W24 捲動及響應修補 | Web 透明覆蓋捲動、桌面介紹模糊面板、窄登入表單、首頁自然高度／完整手機插畫已實作；60 重排及局部互動／Web／Android export 通過 | [HANDOFF](HANDOFF.md#responsive-scroll)；使用者視覺、其他瀏覽器／輔助技術及原生實機待驗 |

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

讓使用者比較 [桌面層次](verification/fe-w12/home-1440.png)、[390 背景插畫](verification/fe-w12/home-390.png)、[桌面照片](verification/fe-w11/photos-1440.png)、[模型設定](verification/fe-w13/model-settings-1440.png)、[私人來源](verification/fe-w14/sources-composer-1440.png)、[成長桌面](verification/fe-w15/growth-1440.png)、[到診準備](verification/fe-w16/summary-390.png) 及 [聯絡桌面](verification/fe-w17/contact-1440.png)／[390 選項](verification/fe-w17/contact-task-options-390.png)。FE-W14 共用／48 重排及各包局部證據保留；FE-W17 只檢查聯絡、固定求助與新增導航，沒有聲稱重跑所有頁，見 [證據](verification/fe-w17/build-checks.json)。當前隔離範圍沒有剩餘待實作包；下一關是使用者視覺比較、主聊天正式接線／驗收及 P3 真機，不自行 merge。
