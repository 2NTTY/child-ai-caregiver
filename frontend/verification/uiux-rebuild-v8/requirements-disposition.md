# 第二線需求裁決：UI UX Pro Max 主導（2026-10-26）

## 需求來源與界線

依使用者最新澄清，本線不受舊 UI 需求、限制或改造成本約束；不是先保留所有舊功能再換外觀。保留的是照顧者的目的及資料安全，不是所有舊入口、欄位、排序或流程。

從現有實際資料與操作提取的五個目的：
1. 知道今天哪些事情需要本人決定，哪些安排正在進行。
2. 用最少步驟交代觀察或問題，但能分清私聊、未確認候選及共享事實。
3. 安排照顧事項，接續關注與準備，避免重做結果不明的操作。
4. 找到可信的孩子資料與原始證據，核對、修正及回顧。
5. 自主控制孩子、本人身份、資料、通知及外發授權。

安全約束不作 UX「精簡」：身份／孩子 scope、唯讀／失權、未知／約數、原操作識別、防重、明示同意、確認、刪除門檻、版本衝突、草稿離頁 guard 及 focus 還原均仍由原 owner 控制。沒有增加自動模型呼叫或外發。

## 固定技能與裁決方法

- UI UX Pro Max `d14efff8`：實際 `--design-system` 與 `--stack react-native` 輸出附同目錄。採 accessibility、內容層次、平面工具介面；拒絕生成結果中不適用的 marketing hero、social proof、pricing。`ux-guidelines.csv` 的 Active State、Back Button、Keyboard Navigation、Skip Links、Heading Hierarchy、Contrast Readability，以及 `references/quick-reference.md` 的功能優先原則作檢查來源。
- Web Design Guidelines（Vercel skill `063bee94`，另讀官方 command.md）：清楚 label、真正 link、visible focus、可預期 back、form error／confirmation 及 progressive disclosure。技能不是產品需求清單；以下「不必要」判斷是依照這些原則及本產品目的做出的設計裁決。
- Composition Patterns（同 pin）：compound components／state injection／children slots，使不同頁面按任務重新組成，不增加大型 boolean 模式；不把資料 owner 放進新 layout。
- React Best Practices（同 pin）：render 時派生選擇／清單、不添加同步用 effect 或第二份 server state、穩定輸入及 context identity；不靠新的讀取或輪詢改善呈現。

## Retain / Improve / Remove

| 原需求／現象 | 裁決 | 改進後需求與實作位置 | 理由與技能依據 |
| --- | --- | --- | --- |
| 六類全局導航，另有設定齒輪；窄屏「記錄」上拉才找到更多 | **改善／刪除** | 五個目的群組：今天、助手、安排、照顧資料、管理。移除重複齒輪；Web／native 五個直接底部入口，更多是普通 link／tab。`workspace-navigation.ts`、`AppShell.tsx`、dashboard layout | 減少選擇層級與隱藏操作；UIUX active-state／touch、Web 可辨識 link／keyboard。深連結及 leave guard 保留，不刪目的地資料。 |
| 首頁四卡等重、巨大問候、總是展示精細讀取時間及刷新 | **改善／刪除** | 每日簡報→需決定→待辦／持續關注→輸入；正常連線不展示讀取時間或泛用刷新，只在 offline／checking／失敗段顯示真狀態及重試。HomeWorkspace＋重寫 Home 內頁元件 | 以需要決定的內容而非系統雜訊建立視覺層次；UIUX Flat／readability；React 無新 fetch。 |
| 未完成引導便持續催促開始設定；說明三步前進／後退；重複登出及孩子選擇 | **刪除／改善** | 首頁有孩子即可開始；沒有孩子直接建立，說明可選。Guide 改主題閱讀，取消序號、前後步、帳戶列與重複 chooser；只有無孩子、讀取錯誤或原操作待處理才呈現建立／查核。 | 使用說明不應成為產品使用的前置流程；Web task-oriented content／避免多餘步驟。原建立／unknown modal、guard、identity reset 仍可達。 |
| 每個工作頁都要同樣 tabs／卡片／兩欄 list-detail | **改善** | 任務採 agenda＋聚焦詳情、編輯→核對；照顧採證據閱讀＋人工更正；日曆過窄時改完整日期選擇。TaskWorkspaceParts、TaskDetail/Form/Calendar、CareRecordDetail/Form | 每個任務按內容選結構；UIUX mobile-first／touch，Composition 可組合 slots。RHF、confirm、原 callbacks 不換。 |
| 報告作大卡片堆疊；歷史版本和閱讀同等權重 | **改善** | 正常概況直接呈現四部分照顧簡報，刪除「生活片段→完整回顧」中間彈窗；成長檔案版本單列、章節導航與連續閱讀。SummaryScreen→TaskKnowledgeSummaryContent→SummaryRecords／Disclosure、GrowthArchive | 以閱讀次序組織資訊、技術追溯次要；UIUX heading hierarchy／line height；原匯出資格與資料完整性保留。 |
| 附件庫同屏壓縮原檔及處理表單；固定「四步」總暗示必須共享 | **改善／刪除** | 庫→聚焦原檔／核對工作區；返回庫不清草稿，回到原選擇焦點；刪除不具狀態含義的四步進度條。PhotosView | 參考原檔不等於要提取／共享；降低無關動作。UIUX hierarchy／Back Button；所有同意及確認仍明示。 |
| 來源先看到設定及處理狀態；「未建索引」常駐每張卡 | **改善／刪除常駐資訊** | 保存原文預設展開→用途→可選工具→管理；索引及 hash／版本歸技術 disclosure，卡面只留行動相關 readiness。SourceDetails／SourcesView／SourceComposer／SourceRecordForm | 先完成閱讀及核對目的；Web progressive disclosure；索引不冒充可用內容，原候選／同意／private-v-shared 分界不刪。 |
| 檔案長表單、身份與照顧資料混讀 | **改善** | 已知身份／成長量度／照顧背景分組編輯；未知／約數仍是顯式選項。ProfileForm | 降低輸入／核對負荷，Web form grouping／validation，Composition 注入既有 RHF。 |
| 聊天裝飾訊息條及泛用宣傳語佔閱讀高度 | **改善／刪除** | 明示作者、閱讀層次、孩子範圍與私人對話；保留同一 composer/timeline 及短高度 reflow。ChatMessage／chatScreen | UIUX readability／mobile-first；React 穩定輸入；不能以重掛載換布局。 |
| Settings 靜態「24小時制」列；家庭目錄聲稱已有成員分工 | **刪除／修正** | 移除不可操作時間資訊；帳戶身份／安全分組；Family 入口僅說明目前開放狀態及真可用控制。settingsScreen、navigation metadata | 無決策價值的重複資訊不必展示；Web 準確 content，不能為設計假造能力。 |
| 關注／聯絡／歷史／記憶／登入／管理員仍需可達 | **保留目的、按頁改善** | 關注完整時間線；聯絡授權與本人接收分層；歷史分類檢索；記憶事實與摘要分欄；登入表單先行；admin gate／重驗後分組管理 | 這些是五個使用目的所需，沒有因改造成本保留舊排列。完整十八路由矩陣見 EXPERIMENT_UIUX_REBUILD.md。 |
| 「保存」應即成功、逾時可重試新操作、模型結果自動變事實 | **明確拒絕** | 保留已確認結果、原 opId 查核、版本／權限／人工確認，讀取錯誤不當空態 | Safety／資料正確性，不是可移除的冗餘 UX。 |

## 驗收判準

不是以 diff 行數或改名判斷完成。要核對每條旅程的主要閱讀順序、第一個可操作目標、必要確認、窄屏呈現與返回焦點是否真的改變。作者 focused DOM／controller tests 只證其有界情境；四尺寸、200%、長內容、完整鍵盤、讀屏及 native 由後續獨立 QA 分層報告。尚未取得的結果不以本文件宣稱通過。

## 實際掛載追溯修正

第一份 export 的 source-map 指出 SummaryView 只由未掛載的 LegacySummaryRecovery 引用。其本輪修改已撤回至 v7 原碼，不計完成證據。真正正常路徑改在 TaskKnowledgeSummaryContent 的 JSX：保留同一 owner、scope／child 交叉核對、lost／unknown／retry／cleanup／準備單 guard，讓新簡報直接可讀，移除唯讀中間 dialog 與常駐技術時間。其他路由依 Router entry→screen→actual mapped first-party module 列於外部 evidence 的 route-mount-coverage.json。
