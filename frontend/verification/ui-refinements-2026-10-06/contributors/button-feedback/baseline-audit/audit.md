# 按鈕閃白相關源碼審核

## 結論與邊界

- 最直接的重複問題已定位：27 個 pressed-opacity 定義、分佈於 26 個 runtime 源碼檔，仍在按住時把整個可點區降至 0.60–0.72。文字、圖示、邊框、選中底色會一起淡向白／淺色父表面。這與已修 sidebar 的機制相同；不是必要的 Pressable 行為。
- 另一條獨立路徑：Paper 主色／危險實色按鈕以白色文字色產生白色 ripple，另有白色 hover 層。來源可確證；是否就是使用者看到的個別閃動，須以同版本 held-press 畫面核對。
- 按下後進入 busy 所造成的淺灰 disabled 色、切孩子遮幕、局部 detail 進場、資料讀取清空，均是不同機制。不能因修改按鈕 opacity 就聲稱全部內容閃動已修。
- 正常 light tools、menu、sidebar、Toolbar、restore text button 不應被全站描邊／統一 AppButton／全域禁 ripple 改造。

審核來源：`/workspace/shared/frontend_cleanup_verified_v2_20261006/frontend`。父工作提供其對應 PR #89 head `4fc6fff66640bacb9b6b925f629e617886f3ec85`、live Site v46；本次沒有自行核對 Git／Site，沒有修改來源、套件、Git 或發布。已讀根／前端 AGENTS、前端 PLAN／STATUS／WORKFLOW、Web screen skill 與 forms／motion references，以及 DESIGN_SYSTEM 操作角色／MOTION_SYSTEM／COLOR_STRATEGY 的相關原文。此還原區沒有根 STATUS.md，已使用前端現況及父工作版本資訊，沒有假定完整 checkout。

實際安裝版本已讀 package.json：Paper 5.15.3、Paper Dates 0.24.0、RN Web 0.21.2、Expo Router 57.0.22。以下行號相對此前端根；`vendor/` 簡稱 `node_modules/react-native-paper/src/components/`。

## A. 同類的全控件淡出：確證來源

| 控件族／角色 | 實際使用位置 | pressed 樣式來源 | 最小方向 |
|---|---|---|---|
| AppButton expanded disclosure | `src/components/ui.tsx:33–40` | 同檔 `271`，opacity .65 | 保留 disclosure／expanded／busy／focus；只改該角色的短暫表面或文字裝飾回饋 |
| AppSelect／AppSelectionTrigger，包括日期及時區觸發器 | `ui.tsx:75–85,114–115`；`DateTimeFields.tsx:98–125` | `ui.tsx:299`，.60 | 文字及邊界保持全 opacity；白色 field 表面用短暫較深色回饋 |
| 有 count 的選单 radio options | `ui.tsx:124–133` | `ui.tsx:299`，.60 | 改 option 的局部表面，保留 count、radio 狀態與 Space |
| TextLink | `ui.tsx:188–195` | `ui.tsx:299`，.60 | 保留 link 輕量外形；不加常駐框 |
| UnderlineTabs | `ui.tsx:232–239` | `ui.tsx:299`，.60 | 保留底線／marker 和 selected；按住不讓 label／marker 褪色 |
| AppCheckbox 整行 | `src/components/AppCheckbox.tsx:13–19` | 同檔 `25`，.68 | 文字、checkbox 狀態保持清晰；只給小範圍短暫回饋；disabled .5 是另一狀態 |
| 首頁孩子入口 homeIdentity | `src/components/ChildPicker.tsx:22–27` | 同檔 `44`，.72 | 只處理 homeIdentity；普通 child picker 已用 selectedNav 回饋，不必重寫 |
| 全站預覽工具 toggle／情境 chips | `src/components/AppShell.tsx:47–55` | 同檔 `169`，.68 | 不改已修的 NavItem／navPressed `31–38,178` |
| 首頁 DashboardLink | `src/components/HomeDashboard.tsx:20` | 同檔 `62`，.68 | 導航列式局部回饋 |
| 首頁緊湊 overview items | `src/components/HomeOverviewItems.tsx:11–13` | 同檔 `29`，.68 | 列表表面短暫回饋，保留狀態徽章 |
| 首頁重要項／「為甚麼提醒我」 | `src/components/HomeAgentImportant.tsx:27–30,69–73` | 同檔 `98`，.68 | 輕量 disclosure 與內容列分別處理，不把全部包成按鈕 |
| 首頁拍照主入口、文字／補改資料次入口 | `src/components/HomeQuickActions.tsx:31–45` | 同檔 `66`，.68 | 黃色主入口用同色系變深；次入口保留透明描邊，不能黃底按下變 mint |
| 右資訊欄記錄列 | `src/components/RightRailContent.tsx:44` | 同檔 `62`，.68 | 導航列局部回饋 |
| 聊天建議 star、預覽輸入、建議 chips | `src/components/agent/AgentComposer.tsx:92–107` | 同檔 `143`，.68 | star 保留透明工具；送出圓形保持黃底全 opacity，只使圓形變深；chips 按其底色處理 |
| Agent 活動與候選 disclosure | `src/components/agent/AgentConversationPreview.tsx:50–55` | 同檔 `92`，.70 | disclosure 局部回饋 |
| 聊天來源 tabs | `src/components/chat/AnswerSources.tsx:163–170` | 同檔 `226`，.70 | 保留來源選中／定位底線；不減低整個 tab opacity |
| 聊天執行過程 disclosure | `src/components/chat/ChatMessage.tsx:41–46` | 同檔 `73`，.70 | 僅 toggle 局部回饋，不改訊息 owner／id |
| 記錄與核對／核對歷史列 | `src/components/care/CareReviewHistoryView.tsx:104–105` | 同檔 `144`，.70 | 保留選中及重要／unknown 警示，表面回饋不能洗掉風險色 |
| 聯絡授權列表 | `src/components/contact/ContactView.tsx:79` | `contact/contact-styles.ts:11`，.70 | 保留選中與授權鎖定，不改確認內容 |
| 成長關注索引 | `src/components/growth/GrowthConcernTimeline.tsx:14` | `growth/growth-styles.ts:12`，.65 | 保留左選中標记；按住不白化 |
| 已結束關注的閱讀區 | `src/components/growth/GrowthHistoryView.tsx:54–62` | 同檔 `79`，.65 | 閱讀區局部回饋；不要動旁邊獨立 restore 按鈕或合成 nested button |
| 設定分類 navigation | `src/components/settings/SettingsNavigation.tsx:22–28` | 同檔 `41`，.68 | 保留 vertical tablist／鍵盤箭嘴與選中標記 |
| 摘要／準備單共用 disclosure | `src/components/summary/SummaryDisclosure.tsx:17–21` | `summary/summary-styles.ts:39`，.65 | 保留原有結構、focus、展開內容；不強迫採表單按鈕框 |
| 待辦列表 | `src/components/tasks/TaskListRow.tsx:17–28` | 同檔 `39`，.72 | selected／hover／focus 現用 paleTeal；按住只加較深表面回饋，保留左警告／focus 線 |
| 待辦日曆 day／上一、下一月 | `src/components/tasks/TasksCalendar.tsx:15–24,42–45` | 同檔 `78`，.70 | 日格與輕量 arrows 分別處理；保留日選中、資料基準日、狀態點及 disabled |
| 待辦待覆核 shortcut／context links | `src/components/tasks/TasksView.tsx:134,149–150` | 同檔 `221`，.70 | warning shortcut 維持 amber 意義；普通 links 維持輕量，勿統一上 mint |
| 引導 steps | `src/screens/guideScreen.tsx:47–49` | 同檔 `96`，.68 | 保留目前步驟狀態及數字 |
| 登入 tabs／顯示密碼／返回主頁 | `src/screens/loginScreen.tsx:87–106` | 同檔 `120`，.65 | 保留各自 tab、toggle、link 角色；不可降低整區透明度 |
| profile 孩子選擇列 | `src/screens/profileScreen.tsx:38–42` | 同檔 `79`，.68 | 保留目前孩子選中；改局部表面 |
| settings 孩子檔案列 | `src/screens/settingsScreen.tsx:87` | 同檔 `136`，.68 | 導航列局部回饋 |

機制證據：RN Web `src/exports/Pressable/index.js:200–233` 只合成 interactionState 及傳入 style，內建 active 只有 cursor／touchAction，沒有自動 opacity。runtime `src/`／`app/` 沒有 TouchableOpacity／TouchableHighlight 使用；不能靠一個全域 activeOpacity 修好上述問題。

注意 shared `ui.tsx:299` 同時服務多種角色，不應把所有 consumer 換成同一大色塊。可共用少量語義 state tokens／style recipes，仍保留既有元件與角色組装，不新增全站 one-size-fits-all component。

## B. Paper 的白色 ripple：另一機制

- AppButton `ui.tsx:41–60`：primary／danger 為 contained；accent 也是 contained 但文字是深色。secondary／quiet／danger-secondary 為 outlined。
- `vendor/Button/Button.tsx:286–309` 取 button/text 顏色，`296–297` 為 `color(textColor).alpha(0.12)`，`355–374` 傳给 TouchableRipple。primary／danger 的白色文字因此生成約 12% 白 ripple；accent／outline 類則為深色 ripple。
- 真正 Web 實作是 `vendor/TouchableRipple/TouchableRipple.tsx`（不是 `.web.tsx`）：`125` 把 ripple alpha 減半作 hover，`183–220` 建立局部 span，從半 opacity 擴張至全 ripple opacity，`237–254` 在放開後以 250 ms 淡出、500 ms 清理。
- `279–286` 在 hovered 時加背景層；`304–309` 的背景 transition 是 150 ms。primary 的白 6% hover 再疊白 12% ripple，在充分覆蓋且同時 hover 時可達約 17.28% 合成白層；父 Surface 的深色背景並沒有變白或卸載。
- Paper MD3 contained 並不走 elevated press elevation 動畫：`Button.tsx:251–274` 只對 MD3 elevated 使用該段；不能把本案歸因於陰影動畫。
- Native 另走 `.native.tsx:83–126`，Android ripple／iOS underlay 與 Web span 不同，不以 Web 結果宣稱真機通過。

最小候選：在 AppButton wrapper 對白字實色 primary／danger 指定角色適合的 `rippleColor`，用微幅變深的 state shade 取代白層；其他深色 ripple consumer 不變。把 shade 作語義 theme token、驗 held/hover 與對比。不要只傳 transparent 把所有回饋拿走；也不要改全站 onSurface、fork Paper、CSS 強制所有 [data-paper-ripple] 消失。具體 token／強度由父工作與實際畫面驗收決定；深色 ink 疊同一 ink 基底不會有可見變深，不能機械把 primary ripple 改成 colors.ink 就宣稱有回饋。

## C. 其他已區分的控制／狀態

### 有不同變亮路徑

1. AppButton busy 和 disabled：`ui.tsx:30,47–56,265–267` 把 loading 納入 unavailable，filled 背景轉 `colors.softLine=#E6E6EA`。這是「放開、開始保存」的狀態轉換，不是 held-press 白 ripple。例子：`model-settings/ModelSettingsView.tsx:156`、`care/CareRecordForm.tsx:88`、`photos/WebCameraCapture.web.tsx:94`。若畫面顯示這才是干擾來源，可另外區分 busy 與不可用樣式，保持 spinner／busy 名稱／防重複提交；不能取消 disabled 鎖或延遲操作來掩蓋。
2. PreparationRow：`preparations/PreparationWorkspace.tsx:36,186` 沒有 opacity，但 selected paleTeal 在按住時被 pressedRow quietSurface 覆蓋，表面會變淡。屬「狀態優先序造成局部變亮」；最小修法是 selected pressed 不退回較淺色，維持選中標記與全文字對比。

### 已有合適局部回饋，無同類白淡出源碼證據

- Sidebar／手機普通 NavItem：`AppShell.tsx:31–38,178`，pressed 使用 selectedNav；Expo Link 下沿既有 StyleSheet.flatten 實物件，勿改回函式 style。
- AppMenuList：`AppMenuList.tsx:12–25`，quietSurface → selectedNav。
- 非 homeIdentity ChildPicker：`ChildPicker.tsx:23,46`，selectedNav。
- 更多頁桌面 link：`screens/moreScreen.tsx:28–30,48`，quietSurface，保留 Link 實物件。
- 來源橫向 overflow arrow：`HorizontalOverflowRail.tsx:167–189`，glyph hover quietSurface、pressed paleTeal、focus border；透明常態且沒有整控件 pressed opacity。
- 聊天相機／文件／語音工具：`AgentInputToolbar.tsx:22–32`，透明常態、局部 active surface、只有 disabled opacity；不用改為框鈕。
- 回到最新：`chat/ChatTimeline.tsx:115–116,138–140`，pressed chatColors.hover。
- ToolbarIconButton：`ToolbarIconButton.tsx:19–34` 是白底＋深色 icon。`vendor/IconButton/utils.ts:143` 用 iconColor 的 12% 深色 ripple。外 Surface 已 borderWidth 0，邊框只放在實際 touchable contentStyle；不要引入雙框或縮小命中區。
- 恢復關注：`growth/GrowthHistoryView.tsx:32–36,82–85` 為 Paper text Button、深色字／深色 ripple，獨立於閱讀 Pressable，保持輕量及 locked／dirty／missing-state gates。
- AgentEntryButton：`AgentEntryButton.tsx:10–25` 局部 onSurface=onAccent，黃底上用深色透明 ripple；不是 AppButton 白字支線。
- RadioButton.Item（普通 AppSelect options、ChildPicker options）：`ui.tsx:122–123`、`ChildPicker.tsx:30` → `vendor/RadioButton/RadioButtonItem.tsx:211–247`，預設深色 onSurface ripple，不是 count options 的 .6 opacity 支線。
- DatePicker 日格：Paper Dates `src/Date/Day.tsx:88–104` 使用 TouchableRipple 的深色 onSurface 層；selected 日期基底是深色。header Save 是 `DatePickerModalHeader.tsx:46–54` 的深色 text Button。month／TextInput.Icon 是深色 IconButton 支線。不要把本身選中顏色切換叫白閃。
- AppSwitch：`AppSwitch.web.tsx` 只是 PaperSwitch wrapper；Paper `Switch/Switch.tsx:83–104` 轉 NativeSwitch 的 track／thumb 顏色，沒有這組 pressed opacity/ripple。

### 無 press 動態樣式的 controls

`GrowthArchive.tsx:136–144,231–233` 的期間 filters／report cards／用途 radio、`CareSavedRecordsView.tsx:29` 的 row、`AnswerSources.tsx:199–200` 的版本 disclosure、附件 preview/remove、citation marker、DirectionalPressable／RecordsNavButton／MobileQuickInputDock 的主要 tap／choices 均沒有本案的整控件 pressed opacity。它們可能改變 selected、dialog、route 或 loading，不能以「可點」為由批量重寫。runtime 有 65 個直接 Pressable JSX sites；完整機械清單見 control-inventory.json，含 callback style、label、disabled、loading。

### 套件另有實色深色 ripple 缺陷，與白閃分開

Paper Dates 0.24.0 `src/Time/TimeInput.tsx:119–137`，僅 clock picker 模式覆在 hour/minute 上的 TouchableRipple：非 iOS 用 `Color(theme.colors.onSurface).fade(0.7).hex()`。本機同版 color 模組實際計算為 `#272343`，alpha 被 hex 丟棄，並非預期約 .3 深色透明層。這可能是「黑一下」，不是白閃。沒有在 app wrapper 可直接傳入該內部 rippleColor 的現成接口證據；目前最小 button patch 不應改 node_modules、默默移除 clock、或全站關 ripple。需要同版本 clock 模式 probe 後獨立決定局部 vendor workaround／升級／保留限制。

## D. 真正獨立的內容閃動風險

- 普通 route／tab 淡出已非當前實作：`MotionEntrance.tsx:27–28,47` 對 route/panel 固定 opacity 1。`AppShell.tsx:149` 路由外殼沒有 pathname key；`app/(dashboard)/_layout.tsx:22–49` child owner 與 shell 分離，BackgroundProvider 僅 caregiver key。不要再為這次按鈕問題重掛整頁。
- 孩子 scope 遮幕：`MotionScopeBoundary.tsx:44–59,87–103` 在 mismatch／covering 隱藏 live 子樹，顯示 canvas placeholder，並播放 scope curtain；scope token `tokens.ts:15` 為 160 ms cover／260 ms reveal。這可以覆蓋大範圍淺色區，但涉及跨孩子安全、inert、遲到回呼與既有動效，不能換成繼續顯示上一孩子資料。須分開量測 stage opacity／curtain 與切換時序；source 路徑不等於已重現缺陷。
- Detail forward/back 的 MotionEntrance 仍會 opacity 0→1，`MotionEntrance.tsx:25–47,54–55`；待辦 narrow list/detail 使用 `TasksView.tsx:131,176`。局部詳情短暫露出背景屬獨立動畫路徑，不是 button surface 淡出。
- AppDialog／DatePickerDialog 只對新浮層 fade/slide：`AppDialog.tsx:23–37`、`DateTimeFields.tsx:28–35`，透明 RN Modal／独立 backdrop，不是整頁白底替換。modal first-open/reopen/close 後的 owner、焦點復原與 backdrop 分開測。
- MotionReveal 用不透明淡綠幕布覆蓋只讀區 `MotionReveal.tsx:88–113`；photo candidate、source text/candidate、profile-current、summary-basis 等有具名 regions。不要為「白閃」刪除全部局部轉換或遮幕。
- Tasks reading：`TasksView.tsx:120,134–145,176` 明示更新時部分舊資料與 calendar/filter 暫不展示；主 list 資料是否為空由 model 控制，source 本身不證明每次 refresh 都清空。此路徑有版面變更風險，應觀察 release 後 reading 狀態，不要動 unknown／access-loss 清除規則來留住舊畫面。
- FirstScreenGate 在第一次 revealed 後保持 ready，`FirstScreenGate.tsx:19–24`，不會因普通 pathname 變更重啟；`app/_layout.tsx:23` navigation animation 已 none。不得加另一個全站 loading／opaque layer 掩蓋局部按壓問題。
- RN Web reset `exports/StyleSheet/dom/index.js:26` 已把 webkit-tap-highlight-color 設為透明；沒有相同範圍內額外全域 :active 白底 CSS，現有 app CSS 只有 scrollbar 與 reduced-motion。來源足以排除「全站瀏覽器預設 tap highlight」作通用解釋，仍不能代替特定瀏覽器實測。

## E. 按優先次序的最小 patch 計劃，供父工作裁決

1. 先以真正 held-press probe 記錄代表 controls：selected／unselected AppSelect、tabs、task row/day、GrowthHistory read vs restore、chat star vs toolbar、primary vs secondary。按住未觸發 callback 仍淡白，即可把按壓與內容切換分開。browser worker 已收到精確 labels／testIDs。
2. 修所有已確認的 enabled pressed-opacity 支線；26 檔不代表 26 種新設計，只局部換 state style。維持現有常態外形、尺寸、邊框、role／ARIA、callbacks、focus、選中／警告區別、disabled 樣式、scope／owner keys。按 primary/accent、outlined action、light tool、disclosure、navigation/list 分別選短暫回饋；warning amber 不覆為一般 mint，selected surface 不變淺。不抽全站統一按鈕。
3. AppButton primary／danger white ripple 若 probe 證實干擾，單在 wrapper 加明確 darkening state shade（及 theme token）。secondary／quiet、Toolbar、Agent yellow、restore text 的現有深色 ripple 保留。不要全域關 feedback。
4. Preparation selected row 的 pressed 覆蓋變亮屬小而明確的同批狀態優先序修正；busy→灰底、TimeInput opaque dark ripple、内容遮幕只在各自實測後裁決，不把它們混進全域 CSS 修法。
5. 回歸測試要改意圖，不能保留舊錯誤：`scripts/history-controls.test.mjs:224` 現在明確要求 GrowthHistory read opacity .65，應改為 enabled press 整體 opacity 不下降、仍有局部回饋，原鎖定／缺原狀態／viewer／keyboard／hover 断言保留。`scripts/owner-shell-lifecycle.test.mjs:247–250` 已保護 sidebar navPressed 和 route keepVisible；新增 representative style-state／AppButton ripple props／selected-priority 斷言，保留它們。
6. 改源碼後才對該確切新版本跑 typecheck、相關 controls／history／calendar／lifecycle／growth confirmation tests，再做各角色按住、移出取消、滑鼠 hover、Enter／Space、focus 邊界、disabled／busy／反覆觸發、dialog 首開重開及必要窄尺寸。截圖必須 before/held/after；單一停穩截圖和 source 斷言不足以宣稱每幀無閃動。
7. 規範原文同步由主模型裁決：`COLOR_STRATEGY.md:22` 現仍明確採納白字 12% ripple；`DESIGN_SYSTEM.md:147` 仍記 homeIdentity 按壓透明度。新的反淡白規則獲批後須局部修這兩段，避免後續代理恢復舊樣式。

## F. 同場看見但不是閃白根因的視覺偏差

- `AgentEntryButton.tsx:34–35` 黃底仍有常駐 2 px 深框，active 或 focused 再加 outline；`AgentComposer.tsx:137` 黃色 sendCircle 有 1 px 深框。若沿使用者「實色或描邊、不雙框」最新方向，這兩處應獨立處理常駐裝飾框，並保留真正 keyboard focus ring，不把刪全部 focus 當修法。
- 幾個 disclosure 現有淺青底＋框，和輕量角色可以透明的規則並不代表本批必須統一全改透明。只在父工作批准的 consumer／角色上做最小改動，避免借本案重新設計整站。

## 實際執行／未執行

已執行：源碼與 installed vendor read-only 審核、TypeScript AST control inventory（666 個相關 JSX 使用點，包含 wrappers 與 fixture/conditional consumers，不代表 666 個同屏按鈕）、27 個 pressed-opacity 定義定位、安裝版本確認、Color expression 的無副作用計算、來源 hash 記錄。

未執行：browser（由獨立唯一 owner 執行）、修改／build／typecheck／完整測試、Git/Sites 操作、真資料／外發、原生裝置。沒有聲稱白閃已修或全部被重現。

配套：`control-inventory.json` 保存可點控制、樣式和狀態入口；`source-hashes.json` 保存本次讀取源碼指紋。兩者只作本工作審核證據，不能當 live bundle attestation。
