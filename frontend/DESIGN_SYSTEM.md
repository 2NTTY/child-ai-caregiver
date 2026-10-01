# 育伴港 Web／手機設計規則

本版綜合主頁、Agent 對話、設定及登入參考圖；圖片只決定視覺與組件細節，產品語義仍以根目錄 [SPEC](../SPEC.md) 和 [P2 UI 清單](../docs/P2_UI_HANDOFF.md) 為準。畫面沿用項目 Logo、香港海旁美術及香港繁體中文，不照搬參考圖的嫩芽標誌、人物或虛構數據。

## 共通設計語言

- FE-W20 依使用者指定採 [Happy Hues 14](https://www.happyhues.co/palettes/14)：白色承載卡片、Dialog 及表單，淺青統一導航，深藍紫作標題／圖標／普通提交，黃色集中於 Agent 入口，較深青作選中。額外表面／警告色仍按 OKLCH 派生，明確失敗沿既有 coral，狀態必配文案。Logo／美術保留；用途及對比沿 [配色策略](COLOR_STRATEGY.md)。
- 淺青導航的內嵌控制用白色 controlSurface 配共用邊界；孩子切換、資料標籤、側欄開關及次要按鈕不跟外層同色。白卡內的安靜內容用 quietSurface，按父／子用途分層。
- 一個頁面只有清楚的主標題，下面用短說明交代資料範圍；卡片標題、內容、來源／時間次序固定。對話有訊息氣泡、來源區和底部輸入；設定有分頁、資料列及明確未保存提示；登入以品牌故事與表單分區。
- 對話底部把問題欄與工具列分開：拍照、檔案／來源、語音 SVG 入口在左，主要預覽／正式送出動作在右。窄屏保留 48 觸控及無障礙名稱，隱藏重複的圖標文字，使三項工具及主操作同一列。已有草稿不被導航或提示覆蓋；未接功能顯示真實能力，不能用假錄音或假附件充當互動。
- 寬桌面用左導覽、主內容、常駐右資訊欄。設定固定在左下，下方不另放帳戶卡片；切換帳戶集中在「設定 → 個人與帳戶 → 登入與安全」。右欄可關閉及重開。中寬或窄視窗的右欄改為可開啟面板，手機瀏覽器用底部導覽與「更多」入口，不遺失家庭／記憶／設定路由。
- 右資訊欄先顯示目前孩子與待辦摘要，再顯示已確認記錄及原操作狀態。待辦示例的勾選只在本地預覽有效；頂部鈴鐺的角標只代表需留意的原操作狀態，不代表通知已送達或未讀。窄 Web 頂部頭像直接開設定，「更多」不另放帳戶選單；原生保留「更多」頁面清單及其中的設定，移除直接登入入口。
- 頂部孩子選擇以清楚的雙層字級及柔和邊框呈現；旁邊只顯示所選孩子獲授權且已讀到的檔案摘要，未知資料直接寫「未提供」，切換孩子或載入時不沿用上一位孩子的提示。連線標籤置中並用「已連接」；合成預覽的連線狀態仍須另行標示未接駁 Server。
- 側欄由鈴鐺旁的單一面板圖示開關，不在資訊欄另放關閉鈕。左上 Logo 置中且可回主頁；左下「與 Agent 對話」主操作取代裝飾圖。首次登入或配置未完成才顯示底部引導入口；設定頁可重看。
- Agent 是桌面側欄下方的單一主要入口，固定在設定上方，上方不重複。現以黃底深字、深色 SVG 方格、短用途及箭嘴形成主次，72 px 內容高度，焦點／目前頁面有邊框提示。窄 Web／原生保留底部對話分頁。
- 以 [theme.ts](src/theme.ts) 為唯一色彩、間距、字級和 Paper 主題來源。現行間距為 4／8／12／16／24／32／40 邏輯單位，桌面圓角 10／16／22 及膠囊形，桌面字級 12／14／16／20／28／34。手機另用 mobileLayout／mobileType／mobileIcons 的 MD3 角色；不修改桌面 tokens 來縮手機。Web 使用系統繁體中文字體堆疊，不從外站載入字體。

## 共用組件與規則

| 層 | 共用入口 | 修改一處會影響甚麼 |
|---|---|---|
| 色彩、字體與尺寸 | [theme.ts](src/theme.ts) | 所有使用 token 的畫面、Paper 按鈕／表單／Dialog；新增狀態色先加語義 token，不逐頁寫色碼 |
| 基本控制項 | [ui.tsx](src/components/ui.tsx) 的 AppButton、AppTextField、SectionCard、SectionHeader、TextLink、UnderlineTabs、OperationPill、ConnectionPill | 按鈕高度／字重、輸入框、卡片、設定／記憶分頁與狀態標籤；只封裝品牌及重複語義 |
| 選單、勾選及彈窗 | AppSelect／AppSelectionTrigger、[AppCheckbox](src/components/AppCheckbox.tsx)、[AppDialog](src/components/AppDialog.tsx)、[AppMenuList](src/components/AppMenuList.tsx)、[ChildPicker](src/components/ChildPicker.tsx) | 集中選擇、選項列、明確狀態、Space／Escape、focus trap 與還原；Web ARIA 與原生 accessibilityState 分開核對 |
| SVG 圖標 | [AppIcon](src/components/AppIcon.tsx)、theme 的 iconTokens | 統一尺寸、線寬與名稱映射；PaperSvgIcon 同時供 PaperProvider 使用 |
| 日期、時間及表單 | [DateTimeFields](src/components/DateTimeFields.tsx)、[date-time](src/components/date-time.ts)、各頁 RHF／Zod schema | 共用 Paper Dates 0.24.0 的日曆／時鐘／窄屏鍵盤輸入，IANA 時區沿 Luxon 3.7.2；不逐頁手寫日期控制 |
| 原文核對欄位 | [RecordDraftFields](src/components/RecordDraftFields.tsx) | 照片和私人來源共用種類、原文、數值／單位、約數及時間原文；隱藏參考備註不適用的欄位，驗證／同意沿各功能契約 |
| 原生外殼及手機首頁 | [NativeAppShell](src/components/NativeAppShell.tsx)、[MobileHomeDashboard](src/components/MobileHomeDashboard.tsx) | Safe Area、更多／資訊面板、Expo Router Tabs、問候／孩子卡片／提問／重點／待辦／快捷記錄；與 Web 共享資料模型和功能元件 |
| 共同外殼 | [AppShell.tsx](src/components/AppShell.tsx)、[ChildKeyFacts.tsx](src/components/ChildKeyFacts.tsx)、[PageFrame.tsx](src/components/PageFrame.tsx) | 左導覽、孩子切換及其授權摘要、資訊欄、預覽情境、內頁標題與內容間距 |
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

2026-09-29 的手機圖採單欄、柔和卡片、大而清楚的問候、孩子卡片內的切換入口、膠囊提問及問題捷徑，然後依次放今日重點、待辦、快速記錄及內容卡片。手機首頁沿此順序；底部保留四個原生主要入口，更多功能從帳戶選單開啟。Web 的窄尺寸另保留「更多」，不把桌面側欄縮小塞入手機。

孩子卡片保留可換行的稱呼、年齡原值／基準及確認狀態；有真授權相片時才顯示，現在以首字头像代表合成資料。未知年齡不推算、未知過敏不寫「無過敏」。390 px 的快速記錄排四格，320 px 依內容寬度排两列；建草稿後核對共享。三個問題捷徑只準備問題並保護原草稿，不自動發送。

共用按鈕／選擇／勾選及連結在手機至少 48 的觸控範圍，普通 SVG 20／導航 22／突出符號 24；主標題 22、卡片標題 16、正文 14–16、次層 12，沿 Paper 5.15.3 MD3 tokens。卡片內距／頁邊 16、快速記錄最小 88。字體保留系統伸縮，不固定卡片文字高度；參考及成熟來源見 [MOBILE_DESIGN](MOBILE_DESIGN.md)。React Native 安全區、鍵盤與底部導航沿 [Expo Safe Areas](https://docs.expo.dev/develop/user-interface/safe-areas/)／[JavaScript Tabs](https://docs.expo.dev/router/advanced/tabs/)，原生效果仍須實機驗收。沒有正式來源的知識／醫療重點、相片／咪高峰不做成假操作；現以已有記憶／話題入口銜接。

## 表單與互動一致性

重要表單使用 RHF／Zod，錯誤放在欄位旁，原文不經 trim 或數值轉換覆寫。日期本身不轉成 UTC；時刻由明確 IANA 時區換算，無效或 DST 重複／不存在時間須要求使用者釐清。小於 360 的時間彈窗採同一 Paper Dates 公開鍵盤控件，避免其標準 328 px 時鐘溢出。

有浮動標籤的多行 AppTextField 透過 Paper 5.x 公開 contentStyle 留出標籤空間，原文捲動在其下方；不關閉字體伸縮、不修改套件。390／320 的 150% Web 文字檢查須包含實際標籤／輸入區幾何與畫面，單看控制邊界不足以確認重疊；證據見 FE-W14，Android 系統大字體仍待驗。

Dialog 採 Paper 視覺配 RN Modal 的焦點／返回鍵行為；選單及勾選用共同封裝提供 Web 明確 ARIA。刪檔案、刪單筆記錄與刪整位孩子各有範圍提示及再次確認；確認結果前保留資料，unknown 鎖定並查原操作，版本改變先比較再重新核對。

共用操作提示按語義分配：已保存用淡青色，明確失敗用淡珊瑚，待確認／unknown／衝突用黃色派生淺底及深警告字，處理中／說明保持安靜。狀態文案及原操作查核不因配色改變。

FE-W20 的 [首頁背景設定](APPEARANCE_HANDOFF.md) 復用 HomeBackground、現有 Paper 按鈕及 SVG 漸淡；本地換圖／恢復、桌面／手機同步預覽。沒有背景保存 API，原生 pickImage port 待接線，不與照顧照片／通知偏好混用。

## 照片與原文核對

FE-W11 沿既有 OKLCH／MD3 規則，沒有新增色階。原照片保持比例、contain 顯示，以中性底區分原圖與頁面；私人／共享、原檔保存及提取狀態分開標示，不以一個綠色「成功」取代整個流程。JPEG／PNG、容量與來源靠近選圖／原圖，模型同意及家庭共享分兩處核對。

桌面將原圖／核對編輯器與附件清單分欄；窄屏按原圖、草稿、清單的實際節點次序排單欄，鍵盤次序一致。正文 14、次層 12、一般 SVG 20、操作至少 48，沿共用 AppButton／AppTextField／AppCheckbox／AppDialog。手機以短可見文字「預覽共享」「確認家庭共享」控制密度，完整 accessible label 仍保留操作範圍；照片種類／數值／單位／約數及時間原文不被刪減。

手機首頁的第二個快速格為「照片記錄」，其他格為記錄情況、身高體重及睡眠，保持 88 最小高度與四／兩格規則；點擊進照片頁面，不假上傳、不直接開相機。原生選圖 adapter 待接時保持明確停用。

FE-W19：Agent 輸入工具列的「拍照」直接開同風格 AppDialog 相機，拍攝回原問題欄作未送出縮圖，不經另一個管理頁。主要動作為「拍下照片」，系統拍照／選圖及取消用共用次要／quiet 按鈕；等待／拒絕／缺裝置靠近預覽說明。相機容器 contain 顯示完整 frame，composer 的 48 縮圖只作辨識，不改原檔；照片／狀態／清除入口與文字分開。最小觸控和中性表面沿現有 tokens，沒有新配色或錄影／錄音樣式。
