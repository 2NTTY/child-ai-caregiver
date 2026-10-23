# 育伴港問題與處理映射

Source 審閱原始 15 項為 1 P1、7 P2、7 P3；視覺審閱原始 12 組為 7 P2、5 P3。這是兩組互補證據，**不能相加成 27 個獨立問題**，也不換算全站分數。下表保留原 ID 與交叉映射。

P1 表示主要動作無法抵達所指對象；P2 表示內容、主動作、狀態或能力辨識有明顯摩擦；P3 表示次級資訊、一致性或非阻斷取捨。

## 源碼確認事項

### IA-01 P1 概況未定位所選任務

**家長目的**：從概況核對同一項安排。父頁沒有傳遞 taskId，只開待辦清單，家長須重新尋找。
**處理狀態**：snapshot27 有界瀏覽器通過 A/B 精確定位、返回及320鍵盤重訪；未遍歷所有衝突／失效分支。
**做法與界線**：沿既有 guarded navigation 傳遞原 taskId，不猜標題或重建任務。
**源碼**：[`frontend/src/screens/SummaryScreen.tsx:69-85`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/screens/SummaryScreen.tsx#L69-L85)；[`frontend/src/components/summary/SummaryRecords.tsx:40-48`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/summary/SummaryRecords.tsx#L40-L48)；[`frontend/src/screens/tasksScreen.tsx:15-22`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/screens/tasksScreen.tsx#L15-L22)。
**畫面映射**：沒有另行映射的已證視覺問題；不代表沒有代表畫面。

### IA-02 P2 概況負責人顯示機器識別

**家長目的**：辨認誰負責安排。主 metadata 直接顯示 assigneeUserId；概況資料沒有權威顯示名稱契約。
**處理狀態**：snapshot27 320／390／1024 實屏確認安全替代文字、不露UUID；權威姓名契約仍未提供。
**做法與界線**：有 assignee 時顯示「負責人：見原安排」，沒有則「未指定」；不猜本人／家人。
**源碼**：[`frontend/src/components/summary/SummaryRecords.tsx:40-48`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/summary/SummaryRecords.tsx#L40-L48)；[`src/client/care-summary-api.ts:65-87`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/src/client/care-summary-api.ts#L65-L87)；[`src/shared/tasks.ts:13-53`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/src/shared/tasks.ts#L13-L53)。
**畫面映射**：沒有另行映射的已證視覺問題；不代表沒有代表畫面。

### IA-03 P2 有關注時助手入口不在近旁

**家長目的**：讀完關注後請助手跟進。有內容時近旁先是手動新增／跟進，與空態及待辦入口不一致。
**處理狀態**：snapshot27原主次RED保留；27a在320／390／1024重驗通過，完整手動名稱／表單／回焦保留。
**做法與界線**：把既有「與助手跟進」放在手動入口之前；保留正文、手動 modal 及管理。
**源碼**：[`frontend/src/components/growth/GrowthView.tsx:90-99`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/growth/GrowthView.tsx#L90-L99)；[`frontend/src/screens/GrowthScreen.tsx:40-49`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/screens/GrowthScreen.tsx#L40-L49)。
**畫面映射**：V06

### IA-04 P2 準備單助手入口在全清單後

**家長目的**：閱讀準備單並交代下一份需要。文件增加時，助手動作離清單入口更遠。
**處理狀態**：snapshot27 準備單入口／用途／手動層級有界通過；27a保留未改實作，另重驗共用手動dialog標題與回焦。
**做法與界線**：把既有助手動作移到清單前的緊湊工具列，刷新與歸檔退至次級。
**源碼**：[`frontend/src/components/preparations/PreparationWorkspace.tsx:219-238`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/preparations/PreparationWorkspace.tsx#L219-L238)。
**畫面映射**：V06

### IA-05 P2 家庭入口承諾超出落地能力

**家長目的**：查看成員分工與交接。入口描述成員／角色／分工，落地頁卻尚未開放，讓家長白走一次。
**處理狀態**：待處理，本批未修改。
**做法與界線**：只修正入口承諾及未開放標示，不趁機實作家庭協作。
**源碼**：[`frontend/src/components/navigation/app-navigation.ts:50-53`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/navigation/app-navigation.ts#L50-L53)；[`frontend/src/components/RightRailContent.tsx:15`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/RightRailContent.tsx#L15)；[`frontend/src/screens/familyScreen.tsx:9-13`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/screens/familyScreen.tsx#L9-L13)。
**畫面映射**：沒有另行映射的已證視覺問題；不代表沒有代表畫面。

### IA-06 P3 安排記錄含背景管線診斷

**家長目的**：理解安排何時如何改動。次級記錄中的 worker 狀態、失敗次數可能被誤讀成通知進度。
**處理狀態**：待處理，本批未修改。
**做法與界線**：保留修改內容、時間、原因及未確認送達界線；不把 processed 當已送達。
**源碼**：[`frontend/src/components/tasks/TaskDetail.tsx:20-48`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/tasks/TaskDetail.tsx#L20-L48)；[`frontend/src/components/tasks/TaskContent.tsx:40-52`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/tasks/TaskContent.tsx#L40-L52)。
**畫面映射**：沒有另行映射的已證視覺問題；不代表沒有代表畫面。

### IA-07 P2 聯絡授權混用讀取與提交狀態

**家長目的**：理解本人同意與可用渠道。主要說明偏向系統關卡，busy 同時描述讀取與提交；失敗態另有重複提示。
**處理狀態**：待處理，本批未修改。
**做法與界線**：分開已知讀取／保存階段；不臆造細分狀態，不刪渠道與投遞／已讀界線。
**源碼**：[`frontend/src/components/contact/ContactView.tsx:45-66`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/contact/ContactView.tsx#L45-L66)。
**畫面映射**：V12

### IA-08 P3 記憶術語及來源識別不易理解

**家長目的**：知道助手記住甚麼及來源。來源展開偏重機器 ID；部分技術識別實際在第二層，不能說全在首屏。
**處理狀態**：待處理，本批未修改。
**做法與界線**：用不改資料語義的用途說明及已有可讀來源；短期摘要不能改稱有效任務。
**源碼**：[`frontend/src/components/memory/MemoryReferenceView.tsx:23-24`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/memory/MemoryReferenceView.tsx#L23-L24)；[`frontend/src/components/memory/MemoryReferenceView.tsx:48-120`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/memory/MemoryReferenceView.tsx#L48-L120)。
**畫面映射**：沒有另行映射的已證視覺問題；不代表沒有代表畫面。

### IA-09 P3 歷史先解釋搜尋實作

**家長目的**：找回內容並理解搜尋範圍。掃100則／最多10命中與 API 缺日期欄位等文字先於內容。
**處理狀態**：部分處理：核對類日期限制已改短；對話掃描額度及全文成功提示仍待處理。
**做法與界線**：保留未完整、日期只覆已搜尋資料及帳戶／孩子範圍。
**源碼**：[`frontend/src/components/history/PersonalHistoryViews.tsx:48-69`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/history/PersonalHistoryViews.tsx#L48-L69)；[`frontend/src/screens/historyScreen.tsx:126`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/screens/historyScreen.tsx#L126)；[`frontend/src/components/history/HistoryMessageDetail.tsx:25`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/history/HistoryMessageDetail.tsx#L25)。
**畫面映射**：V10

### IA-10 P3 助手設定仍含 worker 與 raw 來源識別

**家長目的**：分清授權助手與核對私人備註。現版已有兩個區塊，不把它誤報成授權等於確認；技術文字仍可簡化。
**處理狀態**：待處理，本批未修改。
**做法與界線**：保留可寫入種類、共享同意、私人備註非健康事實及未知操作恢復。
**源碼**：[`frontend/src/production/AgentAuthorization.tsx:35-77`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/production/AgentAuthorization.tsx#L35-L77)。
**畫面映射**：沒有另行映射的已證視覺問題；不代表沒有代表畫面。

### IA-11 P3 模型設定的實作說明過重

**家長目的**：選模型方式並理解成本與資料去向。本地開發／接線用語與家長可控制選項混在正文。
**處理狀態**：source／DOM通過；瀏覽器只驗正確未確認讀取態，成功模型表單未覆蓋。
**做法與界線**：保留 key、模型 ID、endpoint、本人額度、送往服務及不自動後備；限制歸於本服務，不誤稱供應商本身不支援。
**源碼**：[`frontend/src/components/model-settings/ModelSettingsView.tsx:118-170`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/model-settings/ModelSettingsView.tsx#L118-L170)。
**畫面映射**：V10

### IA-12 P2 回訪說明頁先呈現帳戶管理

**家長目的**：直接查使用方法。已完成引導者仍先看到帳戶與孩子管理，三步說明後移。
**處理狀態**：待處理，本批未修改。
**做法與界線**：按既有首次引導狀態排序；保留首次必需設定與安全界線。
**源碼**：[`frontend/src/screens/guideScreen.tsx:62-133`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/screens/guideScreen.tsx#L62-L133)。
**畫面映射**：V08

### IA-13 P2 登入錯誤與普通通知同語意

**家長目的**：辨認輸入錯誤並修正。已知本地錯誤與一般通知使用同一文字／色彩，可能誤讀成功。
**處理狀態**：待處理；錯誤分支僅 source-confirmed。
**做法與界線**：沿用既有錯誤語意及欄位關聯，不用訊息字串猜結果。
**源碼**：[`frontend/src/screens/loginScreen.tsx:59-64`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/screens/loginScreen.tsx#L59-L64)；[`frontend/src/screens/loginScreen.tsx:124-144`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/screens/loginScreen.tsx#L124-L144)。
**畫面映射**：沒有另行映射的已證視覺問題；不代表沒有代表畫面。

### IA-14 P3 私人來源重複解釋同一流程

**家長目的**：讀來源並決定助手如何使用。範圍、用途、保存與接入說明重複，把原內容壓後。
**處理狀態**：待處理，本批未修改。
**做法與界線**：一次必要摘要，授權細節就近於模型／共享動作；不合併保存與接入承諾。
**源碼**：[`frontend/src/components/shared-inputs/SourcesView.tsx:74-99`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/shared-inputs/SourcesView.tsx#L74-L99)；[`frontend/src/components/shared-inputs/SourceIntakeConversation.tsx:13-26`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/shared-inputs/SourceIntakeConversation.tsx#L13-L26)。
**畫面映射**：V01、V11

### IA-15 P3 背景預覽用設計系統解說

**家長目的**：查看背景下的真實閱讀效果。「霧化面板承托內容」不是家長需要的示例；不是功能故障。
**處理狀態**：待處理，本批未修改。
**做法與界線**：可改短合成照顧內容；保留本裝置、不送助手等私隱界線。
**源碼**：[`frontend/src/components/appearance/BackgroundSettings.tsx:24`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/appearance/BackgroundSettings.tsx#L24)；[`frontend/src/components/appearance/BackgroundSurface.tsx:18-24`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/appearance/BackgroundSurface.tsx#L18-L24)。
**畫面映射**：V10

## 視覺問題去重映射

| 原 ID | 優先級 | 主題與 source 關係 | snapshot27 邊界 |
|---|---|---|---|
| V01 | P2 | 首屏控制及維護資訊過重；對應 IA-14 | snapshot27 history工具列與通知層級有界通過；sources完全未改，模型成功表單未驗。 |
| V02 | P2 | 手機目前位置語意不穩定；獨立畫面觀察 | 待處理；本批沒有修改頁名或底欄高亮。 |
| V03 | P2 | 首頁異常及未完成提示壓過既有內容；獨立畫面觀察 | 待處理；不能為精簡偽裝助手可用。 |
| V04 | P3 | 浮動相機閱讀干擾屬非阻斷取捨；獨立畫面觀察 | 保留使用者指定外形；正常捲動可讀所有現有段落及最後卡，不是待修阻斷。 |
| V05 | P2 | 較早未處理事項被近期零筆弱化；獨立畫面觀察 | 待處理；保留期間邊界，不假稱全量統計。 |
| V06 | P2 | 助手與手動入口跨工作頁不一致；對應 IA-03、IA-04 | 與 IA-03／04 同一主題；27a關注主次重驗通過，準備單沿27已驗部分及27a共用dialog回歸，不代表助手生成。 |
| V07 | P2 | 概況窄版身份區日期斷行；獨立畫面觀察 | 待處理；保留估計年齡與截至日期。 |
| V08 | P2 | 說明頁先成帳戶管理頁；對應 IA-12 | 與 IA-12 同一主題，待處理。 |
| V09 | P3 | 已保存卡通用類型壓過事件；獨立畫面觀察 | 待處理；保留原領域卡及全文入口。 |
| V10 | P3 | 維護用語應退位；對應 IA-09、IA-11、IA-15 | 模型文案source／DOM已納候選；成功模型表單未驗；對話掃描額度與背景預覽仍未改。 |
| V11 | P3 | 來源詳情反覆解釋流程；對應 IA-14 | 與 IA-14 同一主題，待處理。 |
| V12 | P3 | 聯絡失敗提示重複且混讀寫；對應 IA-07 | 同屬 IA-07 狀態語意；只見合成讀取失敗，正常授權關卡未實屏。 |

V01 橫跨 history、settings、sources；V10 橫跨歷史掃描文案、模型及背景示例。單一原 ID 可能有多處觀察，不能因其中一處修改便整組關閉。IA-07 的 source 正常關卡與 V12 的畫面失敗態互補，嚴重度保留各自原判。

## 相機補核裁定

V04 保留為 P3 設計取捨。正常捲動已把助手提醒、兩項關注及最後待辦完整移到相機上方；底部既有 88 px 避讓。最後卡底部約 417.25 px，相機按鈕頂部約 455.02 px；按鈕矩形不是黃色裝飾全形狀，不能把數值差冒充全機型安全距離。E110、E111、E112 是正常捲動補核證據。本批不改使用者指定外形，不把中途重疊叫永久遮擋。
