# 育有方 Web／手機設計規則

本版綜合主頁、Agent 對話、設定及登入參考圖；圖片只決定視覺與組件細節，產品語義仍以根目錄 [SPEC](../SPEC.md) 和 [P2 UI 清單](../docs/P2_UI_HANDOFF.md) 為準。畫面沿用項目 Logo、香港海旁美術及香港繁體中文，不照搬參考圖的嫩芽標誌、人物或虛構數據。

## 共通設計語言

2026-10-03：使用者確認按 Astra 原方案、DESIGN_REVIEW 及 PLAN 持續實作。三張旗艦畫面採明亮、準確及有香港溫度的閱讀／工作層級；先做完整答案連來源，再推廣首頁及記錄詳情。青色維持品牌、黃色集中主 Agent 入口，現有插畫及首登動畫保留。

- 記錄等工作頁的長正文使用 16／26，工具正文 14／22，次要 metadata 12／18；工作標題 24／32、區段 16／24、清單列 14／20。聊天在 FE-W36 按使用者指定改採下方 Codex 配方，其他頁沿 theme 的閱讀及工作角色。
- 聊天正文及 composer 使用同一 800 上限、寬版 24／窄版 16 內距。普通回答是連續內容，候選操作才用明確卡片；載入背景與本次使用資料分清，不把合成例子冒充正式育兒答案。
- 來源先呈現發布者、引用及日期／適用資料，技術版本／校驗可收合但完整保留；引用往返暫停閱讀跟隨，同項來源可全收起，因此用 disclosure 語意。面板仍位於每訊息底部，多來源橫向捲動與細線保留。
- 字體縮放與自然高度保留。觸控能力獨立於 pane 寬度；新增緊湊按鈕配方不能縮小寬觸控裝置的操作範圍。一般狀態按真轉換 polite 宣告，歷史快照首次掛載不重新播報。

- FE-W29 對話共用 ChatMessage／ChatTimeline：舊至新排列、最新在底部，較早訊息分批展開；讀歷史時停跟，明確回到最新才恢復。「回到最新」在聊天底部懸浮，與輸入欄留 12 px；不佔整行，兩旁點擊及捲動穿透，顯示／收起不改可視高度。按實際離底距離顯隱，40／24 px 緩衝避免閃動；手勢暫停跟隨不等於先顯示按鈕，尾部引用的隱藏也不代表重新跟隨。每則訊息用穩定 id 更新並保留自己的過程／來源狀態；進度／工具摘要預設收起，停止、失敗、未知和待確認配各自文案，不以完結表示照護完成。來源定位不即時改可視高度，固定輸入列與時間線保持分離。只有公開摘要進畫面，不呈現內部思維鏈。正式接線與示例邊界見 [共用聊天交接](HANDOFF.md#chat-timeline)。

- FE-W20 依使用者指定採 [Happy Hues 14](https://www.happyhues.co/palettes/14)：白色承載卡片、Dialog 及表單，淺青統一導航，深藍紫作標題／圖標／普通提交，黃色集中於 Agent 入口，較深青作選中。額外表面／警告色仍按 OKLCH 派生，明確失敗沿既有 coral，狀態必配文案。Logo／美術保留；用途及對比沿 [配色策略](COLOR_STRATEGY.md)。
- 淺青導航的內嵌控制用白色 controlSurface 配共用邊界；孩子切換、資料標籤、側欄開關及次要按鈕不跟外層同色。白卡內的安靜內容用 quietSurface，按父／子用途分層。
- 一個頁面只有清楚的主標題，下面用短說明交代資料範圍；卡片標題、內容、來源／時間次序固定。對話有訊息氣泡、來源區和底部輸入；設定有分頁、資料列及明確未保存提示；登入以品牌故事與表單分區。
- 每則 AI 回覆共用 [AnswerSources／CitationText](src/components/chat/AnswerSources.tsx)，來源放在正文底部，以細線分開，只留一個來源分頁組件，不另列重複清單。FE-W28 補修取消來源淺綠底板、外框／圓角及內距；相鄰分頁以 1 px × 20 px 直線分隔，保留 48 px 觸控高度及選中底線。FE-W36 按最新指示以右側提示取代這列的橫向滑塊，取消原 8 px 滑塊留位；右方還有來源時在獨立 48 px 區域顯示箭嘴，點擊／Enter 揭示並聚焦下一個來源，不蓋住標題、不展開詳情。到最右端後箭嘴消失，溢出列仍保留該區寬度避免來源跳動；全部放得下時不留提示區。詳情按引用、日期／適用及可收合的技術資料分組，同組靠近、組間加細線。分頁顯示編號及來源標題，過多時左右捲動；點一次展開詳情，再點同一項收起，切另一項則顯示該來源。正文上標【n】立即跳到自己的來源面板，定位／聚焦對應分頁；不平滑捲動或自動展開關閉的詳情。各訊息的來源狀態獨立，通用元件不讀取 Agent／預覽／路由狀態；詳情沿父層底色及獨立捲動，不放中央彈窗。真引用關聯和復用接線見 [交接](HANDOFF.md#chat-source-reuse)。
- FE-W25 對話標題及訊息不放頭像，以靠右問題氣泡／回覆卡片及文字區分內容，答案用回完整列寬。按使用者指示移除聊天常駐「緊急求助」卡；帳戶／孩子選擇的資料頭像及功能控件 SVG 仍按各自用途保留。來源及正式交接差異見 [聊天版面](HANDOFF.md#chat-presentation)。
- 對話底部把問題欄與工具列分開：拍照、檔案／來源、語音 SVG 入口在左，主要預覽／正式送出動作在右。窄屏保留 48 觸控及無障礙名稱，隱藏重複的圖標文字，使三項工具及主操作同一列。已有草稿不被導航或提示覆蓋；未接功能顯示真實能力，不能用假錄音或假附件充當互動。
- 寬桌面用左導覽、主內容、常駐右資訊欄。設定固定在左下，下方不另放帳戶卡片；切換帳戶集中在「設定 → 個人與帳戶 → 登入與安全」。右欄可關閉及重開。中寬或窄視窗的右欄改為可開啟面板，手機瀏覽器用底部導覽與「更多」入口，不遺失家庭／記憶／設定路由。
- 右資訊欄先顯示目前孩子與待辦摘要，再顯示已確認記錄及原操作狀態。待辦示例的勾選只在本地預覽有效；頂部鈴鐺的角標只代表需留意的原操作狀態，不代表通知已送達或未讀。頂部右側只保留鈴鐺及資訊側欄，不另放帳戶頭像或設定按鈕；窄 Web／原生均從底部「更多」進入設定，切換帳戶集中在設定內。
- 頂部孩子選擇以清楚的雙層字級及柔和邊框呈現；旁邊只顯示所選孩子獲授權且已讀到的檔案摘要，未知資料直接寫「未提供」，切換孩子或載入時不沿用上一位孩子的提示。連線標籤置中並用「已連接」；合成預覽的連線狀態仍須另行標示未接駁 Server。
- 側欄由鈴鐺旁的單一面板圖示開關，不在資訊欄另放關閉鈕。左上 Logo 置中且可回主頁；左下「與 Agent 對話」主操作取代裝飾圖。首次登入或配置未完成才顯示底部引導入口；設定頁可重看。
- Agent 是桌面側欄下方的單一主要入口，固定在設定上方，上方不重複。現以黃底深字、深色 SVG 方格、短用途及箭嘴形成主次，72 px 內容高度，焦點／目前頁面有邊框提示。窄 Web／原生保留底部對話分頁。
- 以 [theme.ts](src/theme.ts) 為品牌、一般工作頁及 Paper 主題來源；聊天局部呈現集中於 [chat-presentation.ts](src/components/chat/chat-presentation.ts)，不逐則訊息自定字級。一般間距為 4／8／12／16／24／32／40 邏輯單位，桌面圓角 10／16／22 及膠囊形，桌面字級 12／14／16／20／28／34。手機另用 mobileLayout／mobileType／mobileIcons 的 MD3 角色；不修改桌面 tokens 來縮手機。Web 使用系統繁體中文字體堆疊，不從外站載入字體。

## 共用組件與規則

<a id="codex-chat-presentation"></a>
### FE-W36 Codex 聊天配方

2026-10-04 按使用者指定及 [官方視覺研究](CHAT_UI_RESEARCH.md#codex-desktop-presentation)改 Agent 聊天；以下是本項目選值，不當作 Codex 的實際 CSS。

- chat-presentation 集中系統字體、中性白底／灰氣泡／灰細線／深色箭嘴。正文與區段 15／24（區段 600），工具 13／20、metadata 12／18、輸入 16／24。助手為連續正文；使用者氣泡 20 圓角、上下 12／左右 16 內距。
- 同一 800 正文／composer 寬度，寬版左右 24、窄版 16。訊息間 24／窄版 20、段間 12；同一區段的標題與正文靠近，分節留 16。
- composer 一個 20 圓角面板，多行輸入自然增減於 48–168；工具及箭嘴在同一行。本地照片及錯誤留在面板內，預覽限制在外側短列。圖示的實際可點範圍為一般滑鼠 40、窄版／任何觸控能力 48，箭嘴圖形 32；不能按 pane 寬度推斷裝置沒有觸控。
- 來源仍是每則回答的單一底部組件，正文細線、編號、48 來源點擊範圍、分隔線／右側捲動提示、詳情分組及引用返回共用。收起合成活動區保留控制器掛載及 unknown／待確認狀態；正式 UI 移除合成 disclosure 及情境工具。
- Web 輸入以穩定 textarea 節點量度，先在同一繪製前階段重算再恢復高度；不以換 key／卸載欄位做尺寸變更。Enter、Shift＋Enter及中文組字各有處理。原生沿 Paper adapter，不把 Web 靜態檢查當作軟鍵盤或實機驗收。

| 層 | 共用入口 | 修改一處會影響甚麼 |
|---|---|---|
| 品牌文字及 Logo | [branding.ts](src/branding.ts)、[BrandLogo](src/components/BrandLogo.tsx) | 共用顯示名稱、頁面／提示／無障礙文案、Web／原生／登入 Logo；原圖形及美術沿用，Expo 靜態 name 另同步，不遷移技術身份 |
| 色彩、字體與尺寸 | [theme.ts](src/theme.ts) | 所有使用 token 的畫面、Paper 按鈕／表單／Dialog；新增狀態色先加語義 token，不逐頁寫色碼 |
| 基本控制項 | [ui.tsx](src/components/ui.tsx) 的 AppButton、AppTextField、SectionCard、SectionHeader、TextLink、UnderlineTabs、OperationPill、ConnectionPill | 按鈕高度／字重、輸入框、卡片、設定／記憶分頁與狀態標籤；只封裝品牌及重複語義 |
| 頂部工具按鈕 | [ToolbarIconButton](src/components/ToolbarIconButton.tsx) | 鈴鐺／側欄共用 Paper IconButton 白底、邊框、圓角、22 px SVG；桌面實際點擊 44、手機 48。沿公開 contentStyle 把邊框放在可點區，避免外框扣掉 2 px |
| 選單、勾選及彈窗 | AppSelect／AppSelectionTrigger、[AppCheckbox](src/components/AppCheckbox.tsx)、[AppDialog](src/components/AppDialog.tsx)、[AppMenuList](src/components/AppMenuList.tsx)、[ChildPicker](src/components/ChildPicker.tsx) | 集中選擇、選項列、明確狀態、Space／Escape、focus trap 與還原；Web ARIA 與原生 accessibilityState 分開核對 |
| SVG 圖標 | [AppIcon](src/components/AppIcon.tsx)、theme 的 iconTokens | 統一尺寸、線寬與名稱映射；PaperSvgIcon 同時供 PaperProvider 使用 |
| 日期、時間及表單 | [DateTimeFields](src/components/DateTimeFields.tsx)、[date-time](src/components/date-time.ts)、各頁 RHF／Zod schema | 共用 Paper Dates 0.24.0 的日曆／時鐘／窄屏鍵盤輸入，IANA 時區沿 Luxon 3.7.2；不逐頁手寫日期控制 |
| 原文核對欄位 | [RecordDraftFields](src/components/RecordDraftFields.tsx) | 照片和私人來源共用種類、原文、數值／單位、約數及時間原文；隱藏參考備註不適用的欄位，驗證／同意沿各功能契約 |
| 原生外殼及手機首頁 | [NativeAppShell](src/components/NativeAppShell.tsx)、[MobileHomeDashboard](src/components/MobileHomeDashboard.tsx) | Safe Area、更多／資訊面板、Expo Router Tabs、問候／孩子卡片／重點／待辦／快捷記錄；與 Web 共享資料模型和功能元件 |
| 共同外殼 | [AppShell.tsx](src/components/AppShell.tsx)、[ChildKeyFacts.tsx](src/components/ChildKeyFacts.tsx)、[PageFrame.tsx](src/components/PageFrame.tsx) | 左導覽、孩子切換及其授權摘要、資訊欄、預覽情境、內頁標題與內容間距 |
| 捲動區域 | [AppScrollView.web](src/components/AppScrollView.web.tsx)、[原生入口](src/components/AppScrollView.tsx) | Web 垂直滑塊覆蓋內容、透明軌道及不預留寬度；保留 RN viewport／事件／ref。原生及橫向捲動維持 RN ScrollView |
| Agent 主要入口 | [AgentEntryButton](src/components/AgentEntryButton.tsx) | 桌面側欄的固定入口、主操作層次、SVG、焦點／目前頁面；復用 Paper TouchableRipple 與既有 token，不改一般 AppButton |
| 待辦與提示 | [PreviewTodoCard.tsx](src/components/PreviewTodoCard.tsx)、[NotificationBell.tsx](src/components/NotificationBell.tsx) | 跨頁一致的右欄待辦示例及頂部原操作提示；兩者只處理展示與本地交互，不擔當正式任務／通知協議 |
| 本人渠道設定 | [ChannelCards](src/components/notifications/ChannelCards.tsx)、[channel-view-model](src/channel-view-model.ts) | Web Push／Telegram 的狀態、核對、本人撤銷、明確測試及投遞；沿相同卡片／表單／狀態控件，與安靜時段和任務完成分開 |
| 畫面與路由 | [screens](src/screens)、[app](app) | 每頁只組合現有元件；app 內只保留路由與 layout 入口 |
| 合成狀態 | [view-model.ts](src/view-model.ts)、[preview](src/preview) | 孩子、記錄、連線及原操作展示；不是 Server 契約或正式資料源 |

基礎控制項採 React Native Paper 5.x；介面圖示統一由 [AppIcon](src/components/AppIcon.tsx) 的 Lucide 1.49.0／react-native-svg 15.15.4 輸出 SVG，線寬／尺寸沿 theme 的 iconTokens。Paper 內建鈴鐺、日期及 radio 同樣走此映射，不混用字體或 Unicode 圖標；帳戶與孩子的文字頭像仍是資料內容。路由採 Expo Router，樣式用 React Native StyleSheet.create 與組件共置，沒有單一 HTML 巨檔。結構參考 [Expo Router 官方規則](https://docs.expo.dev/router/basics/core-concepts/)、[Expo 設計系統 Skill](https://github.com/expo/skills/blob/main/plugins/expo/skills/expo-design-system/SKILL.md) 和 [Paper 主題](https://oss.callstack.com/react-native-paper/docs/guides/theming)。

2026-09-30 按視覺回饋修訂：[配色策略](COLOR_STRATEGY.md) 保留原有八個品牌種子與 OKLCH 色階，以中性層次、白色資料卡片和完整 MD3 語義色取代過量淡綠及預設紫浮層。使用者認為色階改善後，進一步按官方成熟方案降低常駐區及次要控件的強度，把品牌色集中於主要操作和選中位置。Dialog 使用卡片圓角與標題字級，AppMenuList 統一左 SVG／文字／右箭嘴。孩子切換的頭像不縮扁，窄版觸控高度 44；寬版保留雙行資料。只改 theme／共用元件即可同步各頁，沒有逐頁另造配色。

## 狀態與圖片差異

待確認是候選、處理中是原操作等結果、已保存須有可信收據、失敗須確知未成功、結果未知須以原 opId 查核，網絡可用不代表保存。合成預覽可切換版式，但不能冒稱收到真收據。現有待辦勾選及鈴鐺角標均明示合成來源；沒有完整接線的 Agent 百分比、正式背景任務／通知、附件／咪高峰、疫苗數字、儲存用量和第三方登入不做成假操作；由 [HANDOFF](HANDOFF.md) 列明後續責任。

三款候選動態及實際比較頁見 [MOTION_OPTIONS](MOTION_OPTIONS.md)。使用者已選擇現階段保持靜態；比較頁只作日後參考，不把任何一款寫成全站設計規則。如日後需要，再將觸發位置與時長收斂為共用元件行為，分別驗收 Web 與 Android。

## 手機參考圖的組件排列

首頁動畫的結尾沿同一容器定位及文字 flex；完成時只收斂 intro 和可讀狀態，不改另一套排版或移除問候子樹。外框淡出與孩子內容分開。逐幀覆核必須包含末幀寬／高及完成後的穩定性，不能只比較箭嘴位置。

2026-09-29 的手機圖採單欄、柔和卡片、大而清楚的問候及孩子切換入口。2026-10-02 使用者要求首頁減量，移除膠囊提問及問題捷徑；左側孩子資料直接開原選單，不另放右側切換按鈕或卡片日期。同一登入會話只在首次進入首頁展示問候及下方孩子卡片約 3 秒，再以 360 ms 上移孩子選擇區取代文字；右側完整圖片保持位置，今日重點、待辦、快速記錄及內容卡片跟隨自然高度。切頁返回、切孩子及桌面／手機斷點重掛載均直接顯示已上移版式，播放記錄由會話上層保留，不依首頁掛載次數。閱讀期間開啟孩子選單時暫停；開始移動後點開則收斂至最終位置，關閉不回跳。減少動態效果時保留閱讀時間後直接切換；離頁取消未完成計時和動畫並保留最終版式。首頁孩子入口使用 48 頭像、18／14 名字及年齡、至少 72 高度，動畫後文字按內容收窄，20 SVG 箭嘴與文字相距 8；開啟不添加白色長條背景，按下以透明度回饋。其他介面仍沿既有靜態設計。對話沿原底部導覽進入；原生四個主要入口及第五個「更多」分頁保留。Web 的窄尺寸另保留「更多」，不把桌面側欄縮小塞入手機。

2026-10-03 補充：只把手機首頁的問候／副句／標語放大至 26／16／14（行高 34／24／22），桌面字體不變。孩子外框與箭嘴跟隨同一容器收窄上移，外框在移動進度 20%–60% 淡出，不隱藏孩子資訊；終態按內容自然寬度、最多 62%，避免放大字體被初始量度壓窄。3 秒閱讀及每會話一次播放沿用。

孩子卡片保留可換行的稱呼、年齡原值／基準及確認狀態；有真授權相片時才顯示，現在以首字头像代表合成資料。未知年齡不推算、未知過敏不寫「無過敏」。390 px 的快速記錄排四格，320 px 依內容寬度排两列；建草稿後核對共享。三個問題捷徑只準備問題並保護原草稿，不自動發送。

共用按鈕／選擇／勾選及連結在手機至少 48 的觸控範圍，普通 SVG 20／導航 22／突出符號 24；主標題 22、卡片標題 16、正文 14–16、次層 12，沿 Paper 5.15.3 MD3 tokens。卡片內距／頁邊 16、快速記錄最小 88。字體保留系統伸縮，不固定卡片文字高度；參考及成熟來源見 [MOBILE_DESIGN](MOBILE_DESIGN.md)。React Native 安全區、鍵盤與底部導航沿 [Expo Safe Areas](https://docs.expo.dev/develop/user-interface/safe-areas/)／[JavaScript Tabs](https://docs.expo.dev/router/advanced/tabs/)，原生效果仍須實機驗收。沒有正式來源的知識／醫療重點、相片／咪高峰不做成假操作；現以已有記憶／話題入口銜接。

## 表單與互動一致性

重要表單使用 RHF／Zod，錯誤放在欄位旁，原文不經 trim 或數值轉換覆寫。日期本身不轉成 UTC；時刻由明確 IANA 時區換算，無效或 DST 重複／不存在時間須要求使用者釐清。小於 360 的時間彈窗採同一 Paper Dates 公開鍵盤控件，避免其標準 328 px 時鐘溢出。

有浮動標籤的多行 AppTextField 透過 Paper 5.x 公開 contentStyle 留出標籤空間，原文捲動在其下方；不關閉字體伸縮、不修改套件。390／320 的 150% Web 文字檢查須包含實際標籤／輸入區幾何與畫面，單看控制邊界不足以確認重疊；證據見 FE-W14，Android 系統大字體仍待驗。

Dialog 採 Paper 視覺配 RN Modal 的焦點／返回鍵行為；選單及勾選用共同封裝提供 Web 明確 ARIA。刪檔案、刪單筆記錄與刪整位孩子各有範圍提示及再次確認；確認結果前保留資料，unknown 鎖定並查原操作，版本改變先比較再重新核對。

FE-W22：不可恢復操作的最後提交用 AppButton `variant="danger"`，沿 errorInk／white；刪除 Dialog 用 `danger` 和 `Title danger`，白色表面、紅色邊框／標題，內容仍清楚可讀。單筆記錄／檔案／事實保留既有頁內核對，不為同一操作再疊彈窗；整位孩子的高影響刪除用 AppDialog，輸入完整稱呼及勾選範圍才啟用按鈕。風險分層參考 [Carbon Remove](https://carbondesignsystem.com/community/patterns/remove-pattern/)，2026-10-01 已核對。稱呼與勾選只防誤操作，不能代替 Server 身份重新驗證；缺口見 [交接](HANDOFF.md#toolbar-delete-safeguards)。

「已連接」是狀態標籤，與工具按鈕同用白色表面及邊框、垂直置中，保留膠囊外形；不加點擊或製造保存成功語義。離線／檢查中仍沿原狀態色。

共用操作提示按語義分配：已保存用淡青色，明確失敗用淡珊瑚，待確認／unknown／衝突用黃色派生淺底及深警告字，處理中／說明保持安靜。狀態文案及原操作查核不因配色改變。

FE-W20 的 [首頁背景設定](APPEARANCE_HANDOFF.md) 復用 HomeBackground、現有 Paper 按鈕及 SVG 漸淡；本地換圖／恢復、桌面／手機同步預覽。沒有背景保存 API，原生 pickImage port 待接線，不與照顧照片／通知偏好混用。

FE-W23 先精確還原登入改版前檔案，再從原左介紹／右登入結構調整：桌面右欄 36%／至少 400、表單最寬 500。圖片沿原 0.55 透明度，以原圖 x=1552 作固定可見右邊界，排除太陽並保留指尖；按容器等比 cover、垂直置中，變窄只由左側裁切。FE-W24 在桌面介紹文字下面加半透明模糊面板；900 以下移除整個宣傳故事／插畫，只保留表單上方品牌及登入內容。[現行交接](HANDOFF.md#responsive-scroll)／[還原證據](HANDOFF.md#login-original-reset)。

FE-W24：Web 垂直捲動區使用共用 AppScrollView，透明軌道及 10 px 覆蓋區不佔內容寬度，滑塊顏色沿 controlOutline／ink；內容保持原本邊距，控制不放到滑塊下面。頁面、右欄及選單獨立捲動，保留原生鍵盤／滾輪及焦點；不以 stable gutter 預留空白。桌面首頁轉單欄時列採自然高度，區塊保留 16 間距，不用固定高度遮掉記錄。手機首頁原插畫 contain 完整展示，靠右、左緣及底部漸淡；自選背景維持 cover。研究及平台界線見 [捲動／模糊指引](.agents/skills/web-screen-delivery/references/scroll-and-blur.md)。

FE-W28：全部 Web 垂直及橫向捲動區均使用 6 px 覆蓋區、1 px 垂直於軸的內距及 border-box，可見滑塊 4 px；桌面與手機同款。透明軌道不佔內容寬度／高度，不造成左右跳動。原本隱藏 indicator 的分頁及清單保持隱藏；原生沿 RN／系統捲動條。FE-W27 的手機限定[舊證據](verification/fe-w27-home/home-checks.json)保留，本次見 [局部驗證](verification/fe-w28-shell-feedback/shell-feedback-checks.json)。

## 照片與原文核對

FE-W11 沿既有 OKLCH／MD3 規則，沒有新增色階。原照片保持比例、contain 顯示，以中性底區分原圖與頁面；私人／共享、原檔保存及提取狀態分開標示，不以一個綠色「成功」取代整個流程。JPEG／PNG、容量與來源靠近選圖／原圖，模型同意及家庭共享分兩處核對。

桌面將原圖／核對編輯器與附件清單分欄；窄屏按原圖、草稿、清單的實際節點次序排單欄，鍵盤次序一致。正文 14、次層 12、一般 SVG 20、操作至少 48，沿共用 AppButton／AppTextField／AppCheckbox／AppDialog。手機以短可見文字「預覽共享」「確認家庭共享」控制密度，完整 accessible label 仍保留操作範圍；照片種類／數值／單位／約數及時間原文不被刪減。

手機首頁的第二個快速格為「照片記錄」，其他格為記錄情況、身高體重及睡眠，保持 88 最小高度與四／兩格規則；點擊進照片頁面，不假上傳、不直接開相機。原生選圖 adapter 待接時保持明確停用。

FE-W19：Agent 輸入工具列的「拍照」直接開同風格 AppDialog 相機，拍攝回原問題欄作未送出縮圖，不經另一個管理頁。主要動作為「拍下照片」，系統拍照／選圖及取消用共用次要／quiet 按鈕；等待／拒絕／缺裝置靠近預覽說明。相機容器 contain 顯示完整 frame，composer 的 48 縮圖只作辨識，不改原檔；照片／狀態／清除入口與文字分開。最小觸控和中性表面沿現有 tokens，沒有新配色或錄影／錄音樣式。

## FE-W34 首頁及記錄配方

首頁只承接一個授權 focus：operation 優先顯示既有恢復操作，其他 task／growth／none／unavailable 由 adapter 明確提供，不用記錄數或本地清單推斷。已設孩子可直接進入聊天，可選引導不阻擋。HomeFocus／HomeRecentRecords 供兩種首頁共用，最近記錄用行與細線，技術狀態次層；右欄預設收起，不重複主要內容。手機動畫子樹、三秒閱讀及右側完整圖片保留。

工作頁用 PageFrame compact（24／32 標題）及 SectionHeader compact（16／24）；記錄原文用 reading 16／26，相關欄位 tool 14／22，metadata 12／18 分組。ReadStateNotice 分清 initial／empty／stale／error，普通狀態只在轉換時播報。FormFieldMessage 關聯控件的 help／error，FormErrorSummary 可定位實際欄位；不覆寫 RHF schema 或原 request。窄詳情返回保留篩選、列表位置和非顏色標記，身份／孩子／權限改變即清理閱讀錨點。

## FE-W35 既有工作頁配方

任務、記憶、照片、私人來源、設定及其他工作頁沿同一 compact 容器。原文用 16／26，相關操作及欄位 14／22，版本、來源及時間 12／18；相同用途貼近排列，群組之間用細線。任務和記憶清單以行與明確文字標記區分選取；原照片維持 contain，不為密度而裁切。

一般狀態在轉換時 polite 播報，明確失敗、撤權或身份失效才 urgent；歷史 mount 和逐字正文不重播。讀取提示只承接該資源自己的 loading／error／freshness，未提供錯誤旗標時不從其他頁或中文 notice 猜測。設定的真正 Tabs 保持編輯器掛載；模型秘密在 inactive／送出／失效時仍須清理。

驗證錯誤使用實際欄位 ref、穩定 id 和 help／error 關聯，摘要按畫面順序定位。普通表單首次提交時驗證，之後隨輸入重驗；不在 pointerdown 造成的 blur 中插入摘要，避免按鈕於 pointerup 前移位而失去點擊。schema、原文空格、日期精度、共享同意和原操作保持由既有控制器決定。[實作及驗證](HANDOFF.md#commercial-rollout)。
