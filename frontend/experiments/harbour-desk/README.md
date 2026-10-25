# Harbour Desk：現有前端全面升級實驗

## 範圍與比較基準

- 分支：`experiment/frontend-design-upgrade-20261025`。
- 固定基線：`0b9f5d60e73eb395ea8a2898864fa1e591e27938`；不追隨 master 漂移。
- 與另一實驗共用已核修補：準備單 `ce4b90cdec16ac754e472c6f9ee11e4fcd1419fd`；聊天錨點 `874eca3127cd319c6bdbf131f1438e2437b41867`。本地 cherry-pick 分別為 `d20289e5`、`af97c845`。
- 共用型別修補 `2667e061`：RN tab ref、讀取游標型別、準備單 optional recovery callback；沒有 `any`／`ts-ignore`、新請求或權限變更。
- 保留 Expo Router、React Native Web／Paper、正式 ProductionProvider 與各 domain owner。只改前端呈現；沒有真模型、家庭資料、GCP、部署、PR 或 master 合併。

## 本分支採用的設計依據

使用者 2026-10-25 明確要求此實驗不受以往前端風格／顯示配方束縛。以下四項官方 skills 已讀原文及相關 rule refs；不是只加名稱。覆蓋只限本實驗的色彩、字體、資訊層級、版面、顯示時機與呈現元件，不覆蓋根 AGENTS 的資料、安全、授權、業務契約或驗收規則，也不變成另一分支的設計規則。

| 官方來源 | 固定版本 | 實際應用 |
|---|---|---|
| [Anthropic frontend-design](https://github.com/anthropics/skills/blob/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/frontend-design/SKILL.md) | `dbd4588f9e1033efb41dad4bef2f7947c8993d44` | 先寫具體產品方向、區分兩方案；安定的照顧工作台、任務優先文案、非陪伴角色人設、避免均質卡片及自動入場動效。 |
| [Vercel React Best Practices](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/skills/react-best-practices/SKILL.md) | `063bee94c3f4df8453406c830b0a7df0f2860278` | 閱讀 `rerender-derived-state-no-effect`、`rerender-no-inline-components`、`rerender-functional-setstate`、`bundle-analyzable-paths`、`rendering-conditional-render`；功能搜尋衍生結果不複製狀態、slots 為模組層元件、保留靜態 imports／既有資料請求、不新增 waterfall。這是 Expo，不套 Next.js／RSC 專用 API。 |
| [Vercel Web Design Guidelines](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/skills/web-design-guidelines/SKILL.md) | 同上 | 閱讀實際 [command.md](https://github.com/vercel-labs/web-interface-guidelines/blob/434b7f91364665f2f733b310ec54809bf8f37937/command.md)，版本 `434b7f91364665f2f733b310ec54809bf8f37937`；skip-to-content、可見焦點、語意 heading、表單 label、URL 搜尋、窄屏與狀態檢查。 |
| [Vercel Composition Patterns](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/skills/composition-patterns/SKILL.md) | 同上 | 閱讀 avoid-boolean-props／compound-components／decouple-implementation／context-interface／children-over-render-props／React19 refs；`Workspace.Provider / Header / Heading / Actions / Content / Split / Main / Aside` 和 `HomeWorkspace.Provider / Setup / Important / Tasks / Ongoing / Capture / Shortcuts`。既有 PageFrame 作相容 adapter，不逼所有 domain 改 API。 |

只讀官方文本；沒有執行外來 scripts、安裝持久 agent 權限或新前端框架。

## 設計取捨

**目標：**家長可辨認現在所在頁、先看值得處理的內容，再直接回到資料或行動；這是一個多功能育兒 agent 的工作台，不是情緒陪伴 app。

**基本 tokens：**松綠墨色 `#233A35`、主動作 `#245C50`、紙白 `#FFFFFF`、霧灰 `#F3F6F4`、淡綠 `#E8F1EC`、琥珀 `#EBC483`。琥珀只引導助手入口／重點，不滿頁鋪黃色；error／unknown 保持獨立語義。

**字體：**繁體中文系統字體優先（PingFang TC／Microsoft JhengHei），不增加外部字體或網路請求。頁標 30/40、手機 24/32，內文 16/26、工具 14/22。移除非使用者要求的強制 `html zoom:1.4/1.2`，保留瀏覽器及系統縮放。

**佈局：**穩定側導航＋孩子身份頂欄；desktop 把全部日常功能直接分組列出，聊天入口位於品牌下面。手機仍保留五個原生 tabs／手勢及全部功能入口，不把桌面導航壓成橫向小字。

```text
桌面
┌ 品牌／助手 ┬ 孩子與必要操作提示 ─────────────────┐
│ 工作台     │ 頁名＋用途                 頁操作 │
│ 孩子與資料 │ ─────────────────────────────── │
│ 協作與支援 │ 功能自身內容：對話 / 清單 / 文件   │
│ 設定       │ （保留各頁已存在的分頁與操作）    │
└──────────┴─────────────────────────────────┘
首頁：重要提醒 → 待辦 → 持續關注；旁欄放交代入口與常用資料。
手機：頁名 → 重點與操作 → 主內容；底部原生功能導航。
```

**自我批判後的修訂：**不使用第一輪泛化「大數字＋四張統一卡」方案。首頁改為可行動內容與具體資料入口；不加假進度、假統計。頁面標題不再因舊規則被隱藏。問候不再三秒後自動塌縮，改為穩定、有實際用途的方向面板。

**內容優先度：**列表保留事件時間與重要狀態；內部版本、原操作參考和技術時間按需展開。時區仍在安排時間的表單與必要衝突詳情可核對，沒有修改底層 timestamp／時區換算／游標。來源版本移至原有技術資料 disclosure；不把未知讀取當空態，不用外觀代替保存／送達證據。

## 完整路由與功能對等矩陣

「保留」指程式接點與操作存在，不表示真人／真 API 已驗收。所有路由使用同一正式身份／孩子 owner；未開放功能維持誠實狀態。

**交付層級：**`02e84085` 是只完成核心工作頁的中間 checkpoint，不是全面完成證據。第二輪已逐一審查全部入口，下表分別列出頁級改動；各頁仍共同使用第一輪殼層、狀態與 controls。保留適合當前任務的既有閱讀／確認模式，不為差異量重寫 domain。所有 browser／真後端結果仍按驗證邊界單列。

| 入口 | 保留的功能與原接點 | 本分支實際呈現改動 |
|---|---|---|
| `/` | 首次引導、孩子選擇、重要 Agent 提醒、原操作恢復、待辦、關注、照片／文字交代、快捷導航；`useProductionHome` | 真 owner 注入 HomeWorkspace，穩定主視覺、雙區工作台與手機明確組合。 |
| `/login` | 登入／註冊、密碼顯示、驗證／重設、離線／服務錯誤；ProductionProvider/account owner | 任務導向故事欄、獨立表單紙面、清晰標籤；保留原品牌插畫。 |
| `/chat` | 聊天分頁、回讀錨點、草稿、照片／語音／文件、停止回覆、引用／來源、Agent 活動、原上傳查核；ChatContents 原控制器 | 可見育兒助手頁首、實務空態、820 閱讀欄與新輸入 surface；沒有真模型。 |
| `/tasks` | 搜尋／日期／範圍、calendar、詳情、手動新增、改期轉派、完成取消／覆核、歷史、recovery | 自有 Workspace 頁首、清單閱讀面、任務 leading icon、版本與技術時間按需。 |
| `/growth` | 關注鏈、建立／編輯／結束、timeline、`tab=preparation` 準備單、原操作恢復 | 選中關注的明確主題 heading、次要原因、獨立下一次跟進面板；準備單文件紙面、總核對數與分節數分開、更新／資料截至移來源詳情。 |
| `/care` | 待確認／已保存、Agent 候選與核對、手動記錄、編輯刪除、`view=photos` 原 alias、草稿與焦點 guard | 以「核對與照顧記錄」明確區分閱讀與確認；重要內容組標籤與整行閱讀卡。保留成熟的原文／理解／修改比較和顯式確認，不改寫決策流程。 |
| `/summary` | 孩子概況、成長檔案、measurement／關注連結、archive、legacy-preparation recovery、原 preparation redirect | 最近確認量度移到概況主閱讀區（仍經權限投影），日常照顧要點與持續關注並列；來源留詳情。成長報告的章節／依據／修訂層級已適合任務，保留而非重造報告。 |
| `/photos` | 照片／語音／文件列表、原檔與預覽、拍攝選擇、候選提取／核對、權限／unknown recovery | 附件資料庫定位、照片入庫主動作、相片與來源詳情分層，操作參考按需查看；私人→核對→共享仍明確，不自動上傳。 |
| `/profile` | 孩子選擇／新增／刪除、avatar、基本資料表單／預覽／確認、更正與歷史 | 健康與照顧置前、基本資料置後；孩子與頭像管理另區；修改基準／版本只在編輯、衝突與詳情，健康未知不偽作沒有。 |
| `/memory` | 參考／記憶、詳細內容／來源、搜尋／分頁、更正與清除範圍 | 每個tab有任務導向說明：接續工作／核對事實／查閱來源；事實內容主導，來源44px可展開、助手核對仍只交未發送草稿。 |
| `/sources` | 私人來源 intake、手動新增、全文／網址、技術與修改歷史、提取／候選、來源管理 | 新增來源動作提級、來源列表狀態減少badge競爭、去重複版本heading；完整版本留原技術展開，原文與候選的權限不變。 |
| `/history` | 分類／日期篩選／搜尋／分頁、各 domain 歷史及回原項 | 八分類桌面rail／窄屏select、獨立內容heading、篩選與reader穩定組合；數值搜尋限制移說明，已載入／未完整警示常駐。跨尺寸不重讀或關閉原文。 |
| `/family` | 正式入口既有「家庭協作尚未開放」及本人聯絡入口；未將未接入的 FamilyView 當作已開放功能 | 誠實availability主區＋目前可用的本人聯絡／帳戶設定入口；不畫假成員、不開放邀請。 |
| `/contact` | 渠道、聯絡授權、接收者與範圍、到期／撤回／原操作查核 | 本人同意與渠道優先、背景worker開關移按需詳情，保留「授權不等於送達」；任務接收者與授權卡清楚分區，必要確認保持。 |
| `/settings` | 帳戶／孩子／家庭／偏好、個人模型、background、motion、通知渠道、資料管理／登出 | 有界側分類與獨立表單面板，保留原 keyboard tab 邏輯。 |
| `/guide` | 使用引導、孩子建立、完成狀態及恢復 | 現有三步閱讀重新排為描述→直接操作→補充說明；閱讀紙面與步驟索引分工，刪除無必要的進度防禦句，保留真孩子建立／恢復。 |
| `/more` | 全功能目錄及原 guard，photos alias、native 列表、desktop links | 新增純導航 metadata 搜尋，`q` query 可還原；無結果可清除。 |
| `/admin` | Web gate、重驗身份、邀請資格、平台配置與用量；非 Web 原說明 | 非管理員有明確權限狀態及回工作台路徑；授權管理視圖的限額欄位可換行分組、audit識別按需；權限完全不改，不放普通導航。 |

## 實作／驗證邊界

- 沒有替換 ProductionProvider、router guard、query/cache、domain workspace 或 wire contracts；Composition context 只持呈現 metadata，Home context 引用原 view model/actions。
- 搜尋只查公開功能名稱，不讀任何孩子內容。普通路由不新增 API 請求。
- 新 idle 介面不新增自動動效；既有互動動效、reduced motion 和 modal focus owner 保留。
- 型別／build／離線測試、四尺寸瀏覽器、自查及獨立 review 的實際結果見 `frontend/verification/harbour-desk-20261025/`，未跑項不得從程式存在推定通過。
- 最終候選不自動合併 master，不發布現有公開站點。

## 頁級保留判斷與驗證對照

- 日期／時間不是一律刪除：任務發生時間與時區影響安排，保留表單及必要詳情；關注事件以分鐘辨識先後；報告版本已能區分同期間修訂，不靠秒數辨識；來源／操作 IDs 不佔主閱讀面。管理審計時間屬專業細節，僅管理員可見。
- 共用恢復／來源 disclosure 不掩蓋 error、unknown、stale、權限喪失或未完整讀取；只有技術參考折疊。
- 自查修正：獨立review指出首頁三個純導航捷徑不能只有 button。Web 已改為原 guarded `PreviewLink`＋href／link role；native 保留 `actions.open`，並新增對應測試。第二輪亦將 family／admin 純導航改為原 guarded link；修正孩子管理不能保證「不影響資料」和已結束關注不能叫「正在跟進」的誤導文案，原刪除確認與關注狀態不變。
- 定向離線覆蓋：首頁組合／ready-empty、聊天history port／pending、全部功能URL搜尋、準備單真hook勾選／歸檔／恢復、care提案／詳情／原操作、profile確認／discard／scope、history跨尺寸reader／日期dialog／guards、來源及照片真hook權限／原payload重試、記憶來源／澄清草稿、概況來源投影／深鏈／權限、guide真RecordsController。登入／設定／管理頁仍需browser檢查；fixture不提供特權管理寫入。
- 合成資料邊界為共用 `harbour-preview-contracts-0b9f5d6-v4`，SHA256 `e3fc5b9af380991f25434cd8dae4430ed01f34a71b1dbacac9a84d6d9b67358d`。不替換ProductionProvider；僅export後前置fetch邊界及CSP；模型／真外發全部封鎖，未支援寫入405。
