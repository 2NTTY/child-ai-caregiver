# 第三線：育伴港「照顧手冊」重構

本文件是獨立實驗的設計及逐頁覆蓋計劃，不是 master 的產品規範。固定原始基線 `0b9f5d60e73eb395ea8a2898864fa1e591e27938`；分支 `experiment/frontend-design-rebuild-20261026`。不繼承第一線升級或第二線 UI UX Pro Max 的畫面實作，不發布、不合併。只保留本來正確的資料 owner、controller、權限、恢復與表單契約。

## 先計劃，再批判，再製作

主導技能為 Anthropic `frontend-design`，2026-10-26 從官方 main 讀取；其兩階段方法直接決定本案結構，不只是色彩參考。輔助技能為 Vercel React Best Practices、Web Design Guidelines、Composition Patterns。Vercel skills 固定來源 commit `063bee94c3f4df8453406c830b0a7df0f2860278`；Web Interface Guidelines 同日重新讀取。原文、SHA-256 保存在 `verification/frontend-design-rebuild-20261026/skills/`。僅套用與 React 19／Expo Router／RN Web 相容的規則，不加入 Next.js、SWR、第二套 owner 或新設計框架。

**使用情境：**香港照顧者在零碎時間記低孩子的事情、整理待辦、核對助手提出的內容，之後帶着有來源的記錄與家人或專業人員溝通。介面應像一本持續使用的家庭照顧手冊，而不是健康分數儀表板。

**第一稿與自我批判：**最初考慮左側導覽加三欄「今日、數字、快捷卡」。這與原站及常見 SaaS 卡片模板太相似，而且把操作與資料混成同等級，故捨棄。採用橫向章節導覽、整頁工具畫布、連續清單與安靜旁註；只讓今日頁的「手冊封面」成為記憶點。沒有無意義 01／02、英文字母眉題、裝飾漸層或每格同樣圓角陰影。

### 緊湊 token 系統

| 角色 | 色值／規則 |
|---|---|
| 墨藍 | `#183747`，正文及主操作；不是純黑替代品，而是港口與可靠記錄的主色 |
| 港藍 | `#176A80`，選中章節、連結及重點邊線 |
| 天光 | `#EDF4F6`，頁面底；與原 aqua／黃紫組合明確分開 |
| 紙白 | `#FFFFFF`，主要閱讀面及輸入 |
| 海玻璃 | `#D5E9E6`，孩子／背景上下文 |
| 信號黃 | `#F2C45A`，只有主要今日入口；錯誤仍使用獨立紅色語義 |

字體：正文採本機 `PingFang TC`／`Microsoft JhengHei`／sans-serif，避免新字型下載；大標題沿同字族而用 32／38、700、緊湊字距，輔以可辨識的章節排列，不另用裝飾 serif。正文 16／26、工具 14／22、meta 12／18。讀取面通常不超過 72 個中文字寬。全站左對齊；只有 icon hit area 居中。

### 版面架構

```text
桌面：品牌 + 主要章節                     孩子選擇 / 通知
      本章相關入口（水平，直接連結）
      頁標題 + 一句任務說明                         主要動作
      主要工具／清單（寬）          內容詳情／篩選旁註（按頁需要）

手機：品牌 / 孩子選擇 / 通知
      頁標題
      主操作 → 清單 → 詳情（既有返回與焦點保留）
      今日 / 助手 / 待辦 / 關注 / 全部
```

構成原則：使用明確的 `JournalHeading`、`JournalSection`、`JournalColumns` 等小型 children 組裝，不用一顆塞滿模式 boolean 的總元件。既有 state/actions/model 留原 provider。純呈現值直接推導；不新增同步 effect、render 內測量、每列全域 listener 或無效 memo。頁面專屬編排保留自己的語義，不強制所有頁面套同一 grid。

## 18 條路由：原結構 → 新結構與使用目標

| 路由 | 原結構／問題 | 新結構與理由 | 使用目標與安全驗收入口 |
|---|---|---|---|
| `/` | 雙欄摘要、獨立手機版本、功能散落 | 一個跨斷點的手冊封面：孩子上下文＋記低事情入口，然後待辦、需核對、持續關注；行動先於摘要 | 無孩子建立入口、按需說明、助手快捷輸入、重要結果、待辦／關注跳轉、離線及舊資料狀態 |
| `/chat` | 時間線外散列管理工具，短視窗擠壓 | 對話閱讀畫布＋獨立工具帶；工作管理與發訊息分層，composer 永遠同一 owner | 草稿、照片／附件、錄音、歷史 prepend 錨點、run／提案／引用、取消／unknown／返回最新 |
| `/tasks` | 清單頂部多重工具與可選日曆 | 行程工作台：明確頁首動作、日期／狀態篩選帶、連續事項清單，寬屏才顯示日曆／詳情 | 新增、編輯、完成、取消、篩選、搜尋、日曆、分頁、歷史、返回焦點、pending／unknown |
| `/growth` | 關注鏈／準備單平行 tab 與重卡片 | 關注手冊：章節索引＋連續關注清單；詳情成獨立閱讀面，準備單是行動工作面 | 關注 CRUD、狀態／來源、相關記錄、準備單 CRUD／checkbox 背景保存、原 opId 查核 |
| `/care` | 待確認提案與記錄清單混合 | 核對工作台：待確認入口先行、共享記錄另成清單；詳細閱讀與修訂清楚分區 | 原話／理解／來源、候選確認／拒絕、手動記錄、記錄修訂／刪除確認、附件入口、焦點返回 |
| `/summary` | 四區概況與多重摘要子頁 | 孩子手冊的總覽頁：基本脈絡先行、近期記錄與關注雙區、文件目錄另層 | overview、period、來源、準備、摘要／成長文件、版本、閱讀／下載／原操作恢復 |
| `/history` | 共用搜尋列加多種類型結果 | 檔案索引：分類索引與搜尋結果分開，查詢條件在結果前清楚呈現 | 所有歷史分類、搜尋、日期、分頁、詳情、URL 入口、原來源與返回位置 |
| `/profile` | 孩子管理與檔案內容堆疊 | 人物檔案：身份抬頭＋基本資料摘要，編輯表單按資料主題分組，管理動作置末 | 切換／建立／刪除孩子、頭像、檔案修訂、未知／約數、待確認、歷史／讀回、guard |
| `/memory` | 主題／來源多組卡片與工具 | 參考手冊：主題索引＋選中內容閱讀面，相關來源靠近原文 | 主題／記憶 CRUD、狀態、來源、封存與歷史、搜尋／分頁、個人 scope、確認／恢復 |
| `/photos` | 多種附件控制與卡片網格 | 附件工作台：篩選工具帶＋媒體／文件清單，選中附件以閱讀窗展開 | 上傳／原檔名、照片／音訊／影片／文件、原圖、下載、重用／移除確認、授權與取消 |
| `/sources` | 私人來源工具與列表相互堆疊 | 來源目錄：新增入口清楚獨立、來源清單與詳情／來源片段分欄 | 私人來源新增／編輯／刪除、檔案連結、原來源／版本、狀態／搜尋與原操作重試 |
| `/family` | 成員、孩子、邀請同樣卡片 | 家庭通訊冊：可用時以成員名錄優先；目前 production 未開放，明確給出現況與可用入口 | 不得繞過未開放 gate；可用 consumer 的成員／角色／可見範圍、邀請、撤權、回焦與草稿清理仍保留 |
| `/contact` | 渠道與同意區堆疊 | 聯絡授權頁：渠道清單和具體授權對象／範圍分區，風險操作最後 | 渠道配置、通知同意／撤銷、目標範圍、確認、只讀、pending／unknown；不發真訊息 |
| `/settings` | 左側 tab 加多個同級框 | 設定目錄＋單章內容：本人身份固定上下文，外觀／通知／助手／模型／私隱依任務分組 | 全部 8 sections、頭像、登入安全、通知、模型表單、Agent 授權、來源、資料操作 guards |
| `/guide` | 數字步驟＋讀取卡 | 真正順序性的入門手冊：先建立孩子，再讀各步驟；每一步只有清楚下一個動作 | 登入／登出、建立／選擇孩子、原建立 unknown 查核、步驟／完成狀態與偏好入口 |
| `/more` | 短標籤功能卡網格 | 全功能索引：4 組用途清楚的文字目錄＋完整功能名，避免辨認 icon 才懂 | 所有原路由可達、guard、正確附件入口、窄屏單列／寬屏目錄 |
| `/login` | 玻璃介紹欄＋表單欄 | 安靜的歡迎頁：品牌與具體照顧場景，單一主要表單面；窄屏不留裝飾空間 | 登入、註冊、忘記密碼、驗證／重設、表單錯誤、鍵盤、返回與真 auth controller |
| `/admin` | 管理功能一長串卡片 | 權限明確的管理工作台：資格與平台設定成兩個明確區域，用量獨立讀取 | 原 admin gate、重驗、邀請／撤銷確認、平台政策、用量／cursor、unknown；不改權限或正式資料 |

## 提取並改善需求：不是保留歷史清單

2026-10-26 最新指示明確允許移除不必要要求，不受舊畫面、顯示精度或改造成本限制。下列目標由照顧者工作推導；「保留」指正確使用目標與安全契約，不等於保存每一顆舊按鈕。

技能依據：**FD** = frontend-design 的 subject-specific hierarchy、structural devices encode information、restraint／plain copy；**WG** = Web Guidelines 的 keyboard／focus／responsive／navigation-state；**RP** = React Best Practices 的 derive rather than sync、avoid duplicate subscriptions；**CP** = Composition Patterns 的 explicit composition／state ownership。

| 使用需求 | 處置與具體改進 | 依據／實作 |
|---|---|---|
| 在零碎時間記下事情 | 保留文字／照片直接入口；移除跨頁浮動輸入 dock 與隱藏長按依賴。錄音仍在真正 composer；第五手機入口直接是全部功能 | FD／WG；HomeQuickActions、AppShell、dashboard layout |
| 知道目前處理哪個孩子 | 保留一次清楚的孩子選擇；移除全站重複基本資料與右側今日事項。只有待核對操作時出現提示列 | FD／RP；AppShell、NativeAppShell；原 useHeaderOperationHints 未改 |
| 從今日接續工作 | 改為一個 responsive 組合；移除定時歡迎、已建立孩子後強制教學、不可用助手的常駐空警告。新用戶有直接建立孩子及可選說明 | FD／CP；HomeDashboard、HomeAgentImportant |
| 首屏及閱讀舒適 | 移除首頁不再顯示的裝飾圖 readiness 等待；移除 1.4／1.2 強制 CSS zoom，尊重使用者縮放；沒有弱化資料 readiness | FD／WG；imageReadiness、root layout |
| 聊天與核對助手內容 | 保留同一 scope-keyed timeline／composer 和原所有送出/附件/unknown guard；移除外掛活動 rail 幾何及重複私隱 footer，資訊與活動成清楚工具帶 | CP／RP／WG；chatScreen |
| 安排要做的事 | 清單為主、日期篩選為工具、日曆為寬屏輔助；真正空列表不再佔用無內容日曆；完成/取消/查核仍用原 action | FD；TasksView、TaskListRow、TaskDetail、TaskForm |
| 追蹤關注與會面準備 | 關注索引→選中閱讀；準備單是連續 checklist，不把每條內容包成卡片。保留背景保存、dirty／pending／unknown 及原 opId | FD／CP；GrowthView、PreparationWorkspace |
| 留下可核對記錄 | 待確認與既有記錄分層；頁首新增動作不與刷新／內容混放；表單按原話、理解、來源排序，保留返回焦點 | FD／WG；careScreen、Care* |
| 理解孩子概況 | 原記錄閱讀成主體，統計數字移至旁欄按需展開，避免沒有工作目的的數字儀表板；保留來源與期間 | FD；ChildOverviewContent、SummaryRecords |
| 查回過往內容 | 分類索引與搜尋結果分開；移除所有類型橫排 tab 的同等視覺權重，保留 reader identity、URL 與日期草稿 | FD／CP；HistoryCategoryIndex、historyScreen |
| 維護孩子資料 | 身份抬頭、基本資料、按主題編輯；管理動作在內容後，不把刪除與日常閱讀同級。未知／約數仍正確呈現 | FD／WG；ProfileView、ProfileSummary、ProfileForm |
| 閱讀助手記憶 | 主題索引＋單篇內容；窄屏可選主題，選中資料移除時回第一個仍授權項；保留既有 hidden reader 身份避免丟本地展開狀態 | CP／WG；MemoryReferenceView |
| 回看原附件及決定提取 | 保留原檔名、媒體種類、原檔閱讀及明確同意；移除把私人保存必然導向家庭共享的四步導覽 | FD／WG；PhotosView、AttachmentLibrary、PhotoRecordForm |
| 知道來源可否使用 | 清單僅主要可用狀態，有連結才顯示共享；完整狀態留詳情，不在每列堆四個 chip；私密/範圍與錯誤未隱藏 | FD；SourcesView、SourceDetails、SourceIntakeEditor |
| 管理聯絡、家庭、設定 | 聯絡按對象/同意/渠道分區；家庭保留真未開放 gate，不承諾不存在功能；第四主章預設進可用設定。8 設定章有鍵盤導覽與 scope 說明 | FD／WG／CP；ContactView、familyScreen、SettingsNavigation、settingsScreen |
| 入門與尋找工具 | 入門順序確實存在才使用編號；每步直接動作，全功能目錄使用完整可理解名稱，不依賴 icon 猜用途 | FD／WG；guideScreen、moreScreen |
| 身份登入與管理權限 | 登入從玻璃宣傳面改成單一表單；admin 只改工作區層次，不把 preview 假設為管理員、不執行任何管理寫入 | FD／CP；loginScreen、AdminScreen.web |

沒有為「簡潔」移除授權同意、來源依據、撤銷確認、dirty guard、錯誤恢復或原 unknown 操作查核。時間資料在需要追溯的詳情可讀；不要求所有清單顯示同一精度。沒有新資料 provider、另製成功結果或第二套 backend。

## 共通正確性修復

- PR #328 的準備單新勾選清除舊 saved 提示：從同基線獨立 cherry-pick `390d7d7`，本線 `e19249c`。
- PR #329 的 zoom-correct 聊天閱讀錨點：從同基線獨立 cherry-pick `15ece7a`，本線 `767a389`；不改 native adapter。
- 既有 native ref／optional recovery／task knowledge 型別三項小修復：`98cbe6e` → 本線 `3b8cc50`。只為本基線可檢查，沒有帶入第二線設計。

## 驗收及 freeze

先完整 frontend typecheck、必要定向 source／DOM 合成測試，再以獨立 Metro cache 匯出 Web。來源與產物逐檔 manifest，記錄 exact commit。安全 fixture 只接真 client 邊界，拒絕外網 fallback；自然示例內容，不顯示「合成孩子／QA」。不呼叫真模型、正式 API，不帶真家庭資料。父代理管理 browser queue 與獨立 review／Sites；本線未獲 queue 前不啟動瀏覽器。

必要畫面矩陣：1440、1024、390、320 CSS px；所有 18 路由的主要操作、長文及空／讀取／錯誤狀態；鍵盤、焦點、取消／返回、重複操作、換孩子清理、短高視窗與 zoom。源碼檢查、typecheck、export、瀏覽器、真機與正式服務分開記錄；沒有跑的一律待驗，不借用前兩線結論。

## 當前狀態

2026-10-26：18 路由重構與需求處置已實作；完整 frontend TypeScript 已 exit 0，獨立 review 增量後 74/74 定向測試通過。首候選 ac745bd 已 export，420 本倉文字與 6 本地依賴 source-map bytes 符合；該候選由下列改善取代，新 freeze/export 進行中。Browser、獨立最終 review 尚未完成。機器證據見 verification/frontend-design-rebuild-20261026；舊 source-photo-controls harness 27 項因 undefined.fetcher／RN Flow 載入失敗，保留原紅，不算產品互動通過。未發布、未推送、未開 PR、未合併。


### 獨立 review 後的實際掛載核對

- 18 個入口沿 Expo Router 真 context/reexport 核對，不以檔案存在當作畫面覆蓋。`/summary` 是 `SummaryScreen → TaskKnowledgeSummaryContent → SummaryRecords`，已把舊「完整回顧」中間閱讀 modal 移除、直接展示期間記錄與統計旁欄；原 scope／child／access-lost gate、pending 原操作、prepared shared form dialog 及 dirty cleanup 留原契約。
- `FamilyView` 未在 production route 掛載，撤回其無作用設計改動；`/family` 只驗真 `familyScreen` 未開放 gate 與可用入口，不宣稱家庭成員管理已展示。
- `PreviewLink` 修正原無條件 preventDefault：Ctrl／Meta／Shift／Alt／非左鍵／已阻止事件由瀏覽器處理，普通同頁導航仍用原 dirty／saving／unknown guard。
- 原 RN Web 的 `accessibilityRole="header"` 預設生成 h1；共享 SectionHeader 明確 default h2 可選 h3／h4，dialog title h2，Journal 的頁面 h1 與子節可選 level。實際 mounted reader、表單、空狀態及 gate 按層次明示，新增真 RNW SSR 與來源檢查，不以「有一個 h1」冒稱階層正確。
- 首 export 在 Metro 前因 telemetry 預設 home 不存在 exit7；沒有產物。唯一環境修正使用 /tmp 隔離 HOME／TMPDIR、NO_TELEMETRY／OFFLINE，第二次 export exit0。未改依賴或產品來繞過，原 log 保留。新 freeze 有獨立新產物，不覆寫 ac745bd。
- 真實 Expo 文件根部另以 `app/+html.tsx` 在 hydration 前宣告 `lang="zh-Hant"`，沿官方 `ScrollViewStyleReset` 與原 viewport 行為；不是只改 comparison wrapper。`OperationNotice` 在上一修正已明確 h2，包括 unknown/pending 狀態。
