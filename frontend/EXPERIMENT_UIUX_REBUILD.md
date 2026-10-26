# Care Workspace：UI UX Pro Max 全站重構實驗

## 第二階段：按技能重建核心旅程（2026-10-26，候選未驗）

使用者最新澄清：升級線是改進原前端；本線須完全按 skills 重構，不受舊 UI 要求或改造成本限制，並提取、改進及刪除不必要需求。保留使用目的與安全，不是凍結每個舊功能。

完整 [retain／improve／remove 需求裁決](verification/uiux-rebuild-v8/requirements-disposition.md) 是本輪設計依據。`8b512f6` 是上一版已交付基線，不把既有導航改組當作全站重構已完成。

**設計決策。**本次實際執行固定 UI UX Pro Max `--design-system` 與 React Native stack 搜尋，原輸出保存在 `verification/uiux-rebuild-v8/`。首次 `family care productivity calm` 得 Accessible & Ethical，重試 `productivity dashboard` 得 Flat Design；兩次 landing pattern 都偏向 marketing，與已登入照顧工具不符，故明確不採 hero／銷售／social proof。採其共同可用的 accessibility、flat content hierarchy、4/8 spacing、16px 閱讀字、44px 操作、低動效及 mobile-first；延續已核對比的 ink/blue 語意 tokens，不為換色聲稱重構。繁中用本機系統 fallback，無外部字型、無新套件。

**產品 IA。**從「同一排 tabs 加多層卡片」轉為按任務選用的場景：每日簡報、對話閱讀、安排工作台、關注時間線、照顧報告、證據核對、媒體庫、來源閱讀、身份編輯、活動檢索及設定表單。五個目的群組取代原六組與重複設定入口；手機直接可達更多，不要求隱藏上拉手勢；不限制每頁內部結構；頁面不必強迫用相同網格／卡片／時間欄。精細時間只在行動排程、明確紀錄或查核需要時顯示，不常駐時區標記。

**Composition / React。**資料 owner、授權、原操作識別與防重由現有 production/controller 持有；呈現以 children slots、明確變體與注入 state/actions 分解。首屏不新增 fetch、輪詢或獨立副本；可派生內容於 render 計算。維持 scope key、草稿／讀取錨點、取消與 focus 邊界，尤其既有聊天短高度 reflow 不因 UI 改組卸載輸入。

### 路由覆蓋與改組判準

| 路由 | 本候選結構目標 | 保留的使用目的／安全邊界 |
| --- | --- | --- |
| `/` | 每日簡報→需決定事項→待辦與持續關注→直接輸入；重寫舊四卡內容，不只是 HomeWorkspace wrapper | 原 Home model/actions、提醒／續辦／capture／真讀取與空態；移除正常狀態時間／刷新及強制式引導 |
| `/chat` | 閱讀優先的對話頁；精簡工作列、作者語意與來源／活動層次、直接 composer | 同 timeline/composer owner、歷史分頁、附件／語音、停止／查核、確認及短高度 reflow |
| `/tasks` | 安排總覽＋聚焦詳情／表單／月曆，重新組合真正工作內容 | 搜尋／篩選／日曆、RHF 驗證、排程、歷史、原 unknown 與 guard |
| `/growth` | 關注選擇後完整時間線／準備空間，而非窄欄壓縮閱讀 | 關注鏈、建議／歸檔、準備單背景保存、原 action callbacks |
| `/summary` | 正常頁直接閱讀四段照顧簡報，不需先開完整回顧彈窗；成長檔案章節閱讀 | 期間／來源、匯出授權、歷史與原資料模型 |
| `/care` | 待核對佇列與已存證據庫；詳情／更正用原文與解讀分層 | 候選、原文、人工新增／更正、刪除／共享確認 |
| `/photos` | 原檔媒體庫；選擇後聚焦原圖與核對，不將處理狀態當相片內容 | 原檔讀取／下載、上傳、候選、授權及刪除 |
| `/sources` | 可查找私人參考庫→來源閱讀→明示的取得／提取／整理 | 原文、來源用途、讀取同意、shared confirmation、原操作查核 |
| `/history` | 任務分類＋搜尋／日期查找＋獨立閱讀，不再混在各資料管理頁 | 原分類／分頁／日期套用／返回位置 |
| `/memory` | 事實主欄、對話脈絡副欄、來源入口；清楚區分事實與摘要 | 原 scope／版本／狀態、管理與讀取 |
| `/profile` | 身份摘要、照顧資訊、孩子管理；編輯改成明確資料分組 | 未知／約數、頭像、版本衝突、孩子建立與刪除確認 |
| `/family` | 真實未開放狀態與目前可用聯絡／設定入口 | 不掛載未開放邀請或假成員 |
| `/contact` | 聯絡任務授權主欄、本人接收設定副欄、歷史閱讀 | 渠道／同意、發送確認、原權限 |
| `/settings` | 分區目錄＋當前設定工作區，帳戶身份／安全分開 | 帳戶／孩子／家庭／外觀／通知／助手／模型／私隱 |
| `/guide` | 自選主題、主要動作先於說明；無編號前後步或重複帳戶／孩子 chooser | 必要建立與原操作恢復仍可達；登入後不強制引導 |
| `/more` | 用途搜尋的功能目錄，不再是桌面側欄複本 | 15 原目的地、真正 links、leave guard |
| `/login` | 表單先行、清楚驗證／復原路徑及次要產品說明 | 原登入／註冊／邀請／密碼／復原與 gate |
| `/admin` | 明確 gate→身份重驗→邀請／限額／用量稽核 | 管理員驗證及所有既有權限，不調整付費設定 |

上述已完成 source 實作；結果分 source／focused tests／TypeScript／export／獨立 review／browser 記錄。沒有真家庭資料、真 API、真模型或部署；舊 v7 artifact 不改。


## v7 及更早歷史（以下不是 v8 當前需求）

以下保留舊設計與驗證原文。舊文「所有功能保留」「六組」「原手勢」「沒有執行搜尋」等僅描述當時，已由上方本輪設計與需求裁決取代，不代表 v8。

## 範圍與基線

2026-10-25；分支 `experiment/uiux-pro-max-rebuild-20261025`，固定共同基線 `0b9f5d60e73eb395ea8a2898864fa1e591e27938`。這是使用者明確要求的第二條實驗線，不是 master 的已採納設計、不會自行合併或發布。

本次例外只覆蓋舊前端視覺／資訊密度指引：不沿用舊側欄、強制 1.4×／1.2× 頁面縮放、短暫自動收起的首頁問候、常駐精細時間或版本欄。功能、家庭權限、資料 owner、原操作識別、確認及刪除門檻照舊；沒有接真模型、真家庭資料、後端或 GCP。全站仍是 Expo Router／React Native Web／React 19／Paper，不另造假應用。

### 共同修復

- `ce4b90cdec16ac754e472c6f9ee11e4fcd1419fd`：準備單背景保存狀態。
- `874eca3127cd319c6bdbf131f1438e2437b41867`：聊天閱讀錨點；與作者本地 `bfd33260` 同來源。
- `2667e061ee7d0b0053100dd6ebd2b51bb772fc94`：兩路共用最小 TypeScript 修補（native ref、read-window 型別、準備單 optional callbacks）。

三項正常 cherry-pick，未更新基底或混入其他 master 增量。

## 主導方法及固定來源

以下只有閱讀官方 Skill／資料並手動比對；**沒有執行外來 Skill 的 Python／安裝腳本**，沒有安裝持久 agent 權限。

| 來源 | 固定版本 | 實際使用 |
| --- | --- | --- |
| [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/d14efff8ed1faa4187f004f79926f428c8074ec7/.claude/skills/ui-ux-pro-max/SKILL.md) | `d14efff8ed1faa4187f004f79926f428c8074ec7`；MIT | 主導產品分析、風格／資訊層級、tokens、可用性與交付檢查 |
| [Composition Patterns](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/skills/composition-patterns/SKILL.md) | `063bee94c3f4df8453406c830b0a7df0f2860278`；Skill 1.0.0／MIT | Workspace、WorkspaceNavigation、HomeWorkspace compound components；children slots；UI context 與 domain owner 分離；明確 Primary／Local／mobile 組合，不擴張 boolean modes |
| [React Best Practices](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/skills/react-best-practices/SKILL.md) | 同上 | 搜尋結果／目前分組於 render 派生；context 值 memo；新 UI 不增資料讀取、輪詢或第三方套件；不為簡單算式加 memo；取消首頁收縮造成的版面移動 |
| [Web Design Guidelines](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/skills/web-design-guidelines/SKILL.md) | 同上；另讀官方 `web-interface-guidelines/main/command.md`，2026-10-25 | 實際 link、skip control、可見 focus、heading、44px 控制、錯態／空態、窄屏與 reduced motion 檢查 |

### UI UX Pro Max 資料比對及裁決

從固定版本 `data/products.csv`、`styles.csv`、`colors.csv`、`typography.csv`、`ui-reasoning.csv`、`stacks/react-native.csv`，按「育兒工作工具／可信／清楚行動」手動篩選；另讀 `references/quick-reference.md` 和 `pro-rules.md`。這不是聲稱執行過 `--design-system` 的生成結果。

- Product：Healthcare App 第 8 項、Productivity Tool 第 16 項及 SaaS 第 1 項。取可讀性、清楚行動、可信藍色與低延遲；不把產品當醫療診斷或情感陪伴。
- Style：採 `minimalism-and-swiss-style` 的清楚網格、功能優先與字級層次。比對 Data-Dense Dashboard 後，**不採**其 12px 密集表格為日常照顧主版，亦不採 Healthcare 建議中的低對比 neumorphism。技能建議須按任務及 accessibility 裁決，不照抄資料庫。
- Typography：Minimal Swiss 第 5 項；單一 sans 體系、700/600/400 層次，Inter 優先但不下載外部字型，保留香港繁體系統 fallback。正文／輸入 16px，次要工具 14px，metadata 12px。
- Palette：以 trust-blue 方向另做語意配色：ink `#182C45`、action `#2557CA`、canvas `#F4F6FA`、white、warm accent `#F2BD67`。已用公式測量主要文字／背景組合至少 4.5:1；不宣稱所有未知使用者背景或深色模式已驗。
- 佈局：1320px 最大內容寬、24/32px 工作區節奏；1024px 起用水平主導航＋局部分組，窄屏保持 5 個主要入口及既有更多功能手勢／按鈕。沒有強制縮放、沒有新沉浸動畫、沒有新增純裝飾圖片下載。

## 重構結構

- **全局架構**：移除常駐左側主導航，改為六個工作區；每個工作區提供完整 contextual links。孩子切換、通知、操作提示與右資訊側欄仍由原 owner／guard 管理。
- **全頁骨架**：所有 PageFrame 頁都使用 Workspace.Root／Header／Heading／Actions／Body；頁名、任務說明與內容不再只靠一排 tabs 暗示。Tasks 的獨立 scroll owner 使用同一 Header；Chat 保留自己 timeline/composer 的高度管理。
- **首頁**：注入 HomeWorkspace.Provider，明確組合 Start／Signals／Ongoing／Agenda／Capture，保持重要提醒與原行動回呼；不製造假數字、假完成或模型回答。手機與桌面共用同一 owner，而非兩份狀態。
- **助手**：固定可見標題、以文字／版面分開使用者及助手回答、來源與活動仍可開啟；輸入區、附件、錄音、停止／重試、確認詳情保留原 callback。
- **工作頁**：任務 list-detail、關注索引／時間線、概況報告、附件庫、來源編輯、檔案身份列、家庭及記憶卡、設定分區按同一 workspace hierarchy 重整。沒有刪除原功能。
- **功能目錄**：所有尺寸均為真正可導航的 link，提供按名稱／用途搜尋；照片仍沿 `/care?view=photos` 相容入口。未匹配時顯示有用空態。
- **登入**：重新組合表單與產品說明區；原登入／註冊、邀請、密碼管理、復原與帳戶 gate 不變；現有美術改為次要背景。
- **資訊取捨**：來源清單不常駐「保存於」精細時間；詳細保存時間原樣留在已有技術 disclosure。來源版本移至同一 disclosure，衝突／確認場合保留精確版本。任務時間仍按原 schedule context 計算，不改時區／排序或儲存值。

## 全路由功能對照

「保留」指原 production 功能與 callback 源碼仍接通，不等於每個後端操作／瀏覽器流程已通過。

| 路由 | 新呈現 | 保留功能／門檻 |
| --- | --- | --- |
| `/` | 照顧工作台、助手入口、分欄工作摘要 | 提醒、進行中事項、待辦、拍照／文字、引導、建立檔案入口 |
| `/chat` | 對話工作區、可讀回答與新 composer 容器 | 歷史分頁、文字／照片／檔案／語音、停止／重試、引用、活動、待確認、原操作查核 |
| `/tasks` | 事項工作台、列表／詳情／日曆 | 搜尋、篩選、日期、分頁、新增／修改／完成、負責人、歷史、未知結果 |
| `/growth` | 關注索引、事件時間線與準備單 | 關注鏈、管理、建議、歸檔、準備單編輯／背景保存、關聯事項與記錄 |
| `/summary` | 結構化概況與報告 | 概況、照顧摘要、期間、成長檔案、PDF／原授權、舊準備單相容入口 |
| `/care` | 待確認／已保存任務選擇、原文卡片網格、已存記錄搜尋台 | 候選、待確認、已保存記錄、人工新增／更正／刪除、原確認流程 |
| `/photos` | 附件資料庫面板 | 原檔回看／下載、照片、錄音／影片／文件、選檔、處理狀態、刪除確認 |
| `/history` | 分類任務卡、目前分類與對應工作入口、獨立搜尋台及閱讀區 | 所有原分類、搜尋、日期、分頁、詳情閱讀、返回位置 |
| `/memory` | 任務選擇、已確認事實主欄與對話摘要側欄、來源資料庫 | 記憶、來源、對話脈絡、管理、分頁、scope 清理 |
| `/sources` | 私人來源索引／編輯雙欄 | 用途、原文、取得／提取、來源狀態、家庭共享確認、刪除門檻、技術詳情 |
| `/profile` | 身份區、已知資料分組 | 檔案、未知／約數、頭像、編輯／更正、版本、建立／刪除孩子與確認 |
| `/family` | 開放狀態與本人可用控制 | **目前 production 家庭協作尚未開放**；保留真聯絡入口，新增既有設定入口。不掛載未開放 FamilyView、不假造邀請／成員操作 |
| `/contact` | 渠道狀態卡、任務授權主欄、本人接收側欄、歷史區 | 渠道、同意、聯絡任務、歷史、原發送確認及權限 |
| `/settings` | 分區設定面板 | 帳戶／孩子／家庭／外觀／通知／助手／模型／私隱，頭像、資料與安全操作 |
| `/guide` | 三任務選擇卡、當步主要行動、閱讀要點、孩子與帳戶區 | 三步說明、孩子選擇／建立、未完成引導、帳戶操作 |
| `/more` | 可搜尋功能目錄 | 15 個原普通目的地、真連結與離頁 guard，不混入管理員入口 |
| `/login` | 表單優先的登入頁 | 登入／註冊／邀請、密碼顯示／復原、offline／unavailable gate |
| `/admin` | 存取狀態、驗證區、邀請表單／資格清單、限額網格、用量及稽核區 | 原管理員 gate、重驗身份、用量及設定；不授予新權限、不操作付費或平台設定 |

## 獨立 review 後的逐頁加深

`752e367` 只保留為架構 checkpoint；獨立 review 指出部分頁面仍只是表面樣式，因此不把該版當全站完成。第二輪以原 owner 的主要工作及操作區重新組合：

- Growth 將主題索引由窄左欄移至上方選擇區，留下完整歷程閱讀面；準備單有用途→整理的規劃台。
- Summary 以照顧要點先於生活偏好，原本藏於詳情的真量度卡移至概況可見位置；歷史來源仍可開啟。
- Photos 將原檔、提取候選、人工核對與附件管理拆開；分類卡說明三種附件用途，不假造空集合數量。
- Profile 將健康／照顧資料優先，未知項保留獨立可讀標籤；檔案正文與孩子／頭像管理分欄，窄屏改堆疊。
- Memory 把已確認事實與對話摘要分欄，避免把整理文字視為事實；原來源／版本／失效狀態不隱藏。
- Care 的待確認及已保存清單重新建為內容卡片與搜尋工作台；卡面不常駐精細時間，原詳情仍保留確認／來源 metadata。
- Tasks 將真主要操作移到頁首，事項卡分時間欄／內容與負責人；日曆、閱讀、編輯與焦點 owner 不換。
- Contact 任務授權與本人接收同意分區；Guide 的三步改為任務選擇，當步行動放在閱讀區首。
- History 在分類之外明示所選資料的用途與唯一對應工作入口，日期仍在原彈窗先編輯再套用。
- Sources 新增只篩已載入名稱的本地搜尋，未選來源有真工作流程說明，選後分接入用途／原文與工具區；無新網路讀取。
- Settings 分成身份資料、使用體驗、授權控制，所選頁有清楚任務標題；Admin 真 gate 後才有驗證、邀請、限額與稽核分組。
- Family 保持 production 未開放的真實狀態，不把未掛載的 FamilyView 誤列為目前功能。

新增 `WorkspaceSwitch` 是手動 activation 的可鍵盤 tab 卡：方向鍵只移焦點，Enter／Space 才交回 caller；未通過原 guard 的選擇不會自行切換。它保留原 panel ID／aria 關係，不接 domain 狀態或資料。

獨立 review 另找到移除 HomeWelcome 後的 `home-hero` readiness 殘留；只移除首頁已不存在圖片的依賴，並以真 FirstScreenGate＋React／jsdom 驗證首頁 ready 立即顯示、資料仍 loading 不能通過、桌面登入仍等待真 login-hero。不是取消全站啟動畫面或身份 gate。

## 驗證記錄

驗證會分別記錄 source／合成 React／型別／build／真 browser，不以一層代替另一層。

- 新 `uiux-workspace.test.mjs`：5/5（16 route 一對一、真 React compound render、4 尺寸 props、目錄搜尋、token contrast）。此為 server render／source 檢查，不是瀏覽器幾何驗收。
- 原 `workspace-navigation.test.mjs`：1/1；`task-layout`＋`task-calendar`：27/27；`shared-status-read-state`：21/21。
- `more-navigation.test.mjs`：4/4；只更新本實驗已重建的 mobile link 呈現斷言，保留原路由、guard 及目的地完整性。
- 全 frontend TypeScript 在共享修補與本 clone 固定官方缺包補齊後通過。最初缺包及型別失敗保留在作者日誌；沒有改 `package.json`／lockfile。
- 舊 Profile harness 8/8 失敗於基底與候選均可重現：新頭像 port 未 mock、歷史描述斷言過時。補齊 avatar 邊界 mock 及按現行工作區調整描述斷言後 8/8 通過；檔案確認、取消、未知、刪除與失權斷言原樣，不更改產品 guard。
- 共享準備單真 owner 背景保存檢查：2/2。首次完整 Web export 已成功（35 route outputs）；凍結來源後會再匯出作 browser 候選。
- Web export 及共享 HTTP fixture 的所有 route／390／320／1024／1440、keyboard／彈窗／讀屏證據待獨立 browser owner 排隊。沒有宣稱未執行的驗收已通過。

### 第二輪回歸界線

- 35/35：workspace／route／contrast、task layout／calendar、image readiness。
- 4/4：真 React／jsdom FirstScreenGate 及 WorkspaceSwitch keyboard／未接受 guard 選擇（無外部 fetch）。
- 58/58：Care 真 proposal owner 組合／記錄卡、History filters及來源入口、Memory scope／來源與讀取邊界、Guide controller／guard／建立操作、Profile閱讀與編輯／刪除控制。只更新已授權的新視覺斷言與 UI 邊界 mock，不放寬 domain 判斷。
- 原 Agent activity 23/23；共享 preparation background save 2/2；第二輪全 frontend TypeScript 通過。
- 額外 Profile history recovery 18 項中 17 通過，另 1「重新讀取檔案」舊按鈕斷言在固定 base 亦同樣失敗，未改產品以遷就舊 harness。既有 source-photo／photo-route harness 的 RN Flow import 及 empty-card 的未 mock 依賴仍不是已過證據。
- Browser、實際幾何／觸控、全讀屏、正式後端與真模型未驗；不以上述合成測試取代。checkpoint export 35 routes 成功；新來源凍結後重新 export 並逐 source-map 核來源。

- 第二次獨立 review 以真 RN Web 找到 Space 未啟動 tab；前述 4/4 只證明 host-adapter 事件交接，不能取代 PressResponder。現已補 keydown 防捲動、keyup 單次啟動、blur 取消，Enter 保留 RN Web 原處理；新增真 RN Web 0.21.2／React／jsdom 1/1，涵蓋 repeat、拒絕 guard、blur、Enter、pointer、fetch 0。jsdom 無 ResizeObserver 的提醒保留；此測試不宣稱版面幾何通過。

### 真 browser 導航樣式修正

獨立 browser 在 1180px 發現選中水平導航白字但背景透明，並指出功能目錄失去 padding。根因是 Expo Router `asChild` 的 RN／Radix Slot 將 direct-child 的 `style` callback 合併為空 object；token 對比測試無法發現這種整合問題。新增純呈現 `WorkspaceLink`，把本地 pressed／hovered 狀態先解析為 flattened style object，再交給原 `PreviewLink`，只替換主要／局部導航與功能目錄三個新用法；href、照片相容入口、導航 guard 不變。

`uiux-navigation.web.test.cjs` 使用真 Expo BaseExpoRouterLink、RN Slot、Radix Slot、RN Web Pressable 與實際 PreviewLink，僅隔離 router 的導航狀態 hook。修前 2/2 紅：背景透明及目錄 minHeight=0；修後 2/2 綠，逐六工作區檢查 DOM computed background／文字色／padding／minHeight／局部底線、15 個目錄 anchor 及原導航 callback，fetch 0。相關 10/10 與 frontend TypeScript 通過。這不是瀏覽器幾何替代；固定新 export 後仍由唯一 owner 回驗。

同輪真 browser 另確認 skip-link 的 `position:absolute` 被稍後 RN base class 蓋為 relative：佔用 44px 空位、left=16px 加全寬而令 dashboard 外界多出 16px。將 absolute／left／right／zIndex 移至 RN 元件 style，兩側各 16px；原 CSS 只保留隱藏 top 與 focus 顯示位置，跳轉焦點 handler 不變。新增直接抽取真 AppShell skip JSX／stylesheet 的 RNW leaf 測試，按觀察到的後載 RN stylesheet 順序重現 relative 紅，再驗 absolute、左右界、focus CSS 與真 handler 聚焦頁面綠；合計 3/3。jsdom pseudo-state style cache 以重解析相同 CSS 處理，沒有宣稱幾何已通過，仍待真 browser 複驗。

### 短高度／200% 縮放的聊天 reflow

v6 真 browser 已確認導航、目錄、skip-link、來源小記與正常高度聊天修復，但 Chrome 真 200% 縮放（CSS 590×378）令原固定 composer 與工具列耗盡閱讀高度，只有 5.5px 未被覆蓋，訊息不可見。此為真產品失敗，保留原證據，不以單元測試抵銷。

短於 600px 的 Web viewport 現採明確 `reflow` 呈現：原工作區容器可垂直捲動並可鍵盤聚焦，原 ChatTimeline 置於 260px 閱讀窗，原 composer 以 `placement="flow"` 取消負 margin。所有文字大小、輸入、附件、活動、私隱、錯誤／未知狀態與確認仍可達，不隱藏控制、不禁止縮放。容器型別與孩子 scope key 不變；縮放不卸載 ChatContents、Timeline 或 textarea，也不改原 scrollRef／controlsRef、history controller、讀取 anchor 或跟隨策略。正常高度與 native 仍為原 bounded 呈現。

新增真 React／RNW viewport＋真 ChatTimeline／web textarea 測試，跨 378／599／600／757 高度保留 DOM 節點、草稿、焦點與明示 offset port；另以真 AgentComposer 驗 flow/overlap 不 remount、不縮字、不移除原按鈕、不送出。既有 IME／Enter／autosize／send-focus 測試一併執行。jsdom 無版面引擎，這些不代表 nested wheel、實際 prepend 像素、Tab 自動捲到輸入或 200% 幾何已通過；固定新 export 後由唯一 browser owner 回驗，並返回 100% 核閱讀意圖與草稿。
