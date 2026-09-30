# 照顧摘要與到診準備前端交接

更新：2026-10-01。FE-W16 基線 `e61bca203784d2ed87b81fe3e7294998933fcea7`，沿 `codex/fe-w11-photos`／[draft PR #73](https://github.com/2NTTY/child-ai-caregiver/pull/73)；源碼／驗證 commit `10aa70bdb3565b4f92e978f99afbe96604f55bf5`。主責 B，只修改 `frontend/**`，沒有修改 Server、Agent、正式 App、根文件或規則。不自行 merge。

## 核對依據及入口

先讀 GitHub master `ce87370b6375b25e45f016f2218d924b44f06f3c` 的 [S14-W01 交接](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/docs/P2_UI_HANDOFF.md#care-summary-handoff)，再讀 [HTTP 契約](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/docs/API.md#care-summary-http)、[care-summary 型別](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/src/shared/care-summary.ts)、[CareSummaryApi](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/src/client/care-summary-api.ts) 及 [正式 CareSummaryPanel](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/src/client/CareSummaryPanel.tsx)。本包直接取 GitHub 內容，不依賴主聊天 checkout 是否已更新。

`npm run web -- --port 8083`，入口 `/summary`；固定輸出預覽方法沿 [總交接](HANDOFF.md#預覽及驗證)。桌面「照顧摘要」及窄屏／原生「更多」可到達，四個原生底部 Tabs 保留；手機及桌面共用元件。

| 入口 | 責任 |
|---|---|
| [SummaryScreen](src/screens/SummaryScreen.tsx)、summary 路由 | 薄入口、合成工具及帳號／Server／孩子範圍重建 |
| [summary-view-model](src/summary-view-model.ts)、[SummaryView](src/components/summary/SummaryView.tsx) | 純資料／回調投影；期間、讀取及原操作狀態，dataLabel 可由正式 adapter 替換 |
| [SummaryRecords](src/components/summary/SummaryRecords.tsx) | Server 已供應數值、原單位、缺項、記錄／更正及真正任務版本，不在前端聚合 |
| [PreparationCard](src/components/summary/PreparationCard.tsx)、[summary-form](src/components/summary/summary-form.ts) | RHF／Zod 問題與清單、有限預約、來源基準、實際保存內容及共享確認 |
| [useSummaryPreview](src/preview/useSummaryPreview.ts)、[summaryFixture](src/preview/summaryFixture.ts) | 本頁記憶中的合成結果／故障；沒有 API、統計服務、Agent、儲存、預約或外發 |

## 正式映射及資料真相

沿既有 `createCareSummaryApi`、登入 cookie、`x-expected-user-id`、AbortSignal 和原 S07 transport。GET `summary(childId, query, ...)` 映射 query／page／refresh；`savePreparation(...)` 映射已核對的 `PreparationDecision`，須再經根目錄 `preparationInput` 核對；`reconcilePending`、`hasPendingOnline`、`resetOnline` 沿原控制器。本地型別只是顯示模型，不是新業務協定。

- 明確開始日、一日／七日、IANA 時區，按操作才套用。期間為當地曆日，結束日不包括在內；新選項未套用時保留顯示原期間。摘要數字、依據 hash、適用記錄及時區窗口全部由 Server 提供，前端不解析便條數字、不混加單位、不推算年齡或百分位。
- 顯示孩子／年齡約數及日期依據、檔案版本／來源／確認、期間／生成時間／basisVersion；各類數量、樣本／約數／合計或未提供／最大最小及來源 ID。零記錄不等於沒有發生。
- 未知事件時間數量屬整個孩子已掃描記錄，不標作本週缺失、不用建立／確認時間補事件時間。超過期間 200 筆可改單日；超過孩子掃描 2,000 記錄／500 任務則到記錄區查閱，不顯示部分總計或假零。
- 原記錄保留正文、數值原文／單位／精度、事件原文／時區／精度、確認與更正版本／原因／時間／來源。`onRecord(id)` 預留精確 Care history 入口；preview 目前只到 `/care`，fixture 不同步。
- 只有 Server 回傳仍 scheduled 的家庭已確認預約可選；台帳安排不代表機構確認。needs_review 任務分開顯示待覆核／停催。`onTask(id)` 預留精確入口；preview 只到 `/tasks`，不建立新預約。
- 本包是家庭摘要及家庭共享到診準備，沒有私人摘要保存／刪除、PDF、下載、剪貼簿、OS share 或新模型產生 HTTP。這些未交付能力不做假按鈕，留待主聊天界定功能包。

## 表單、共享及版本

問題最多 12 條／每條 500 字，清單最多 16 項／每項 300 字；空欄位要明確填寫或移除，不靜默刪項或截短。問題／清單以 RHF 7.88 `useFieldArray` 管理，`field.id` 作 React key，增刪不改剩餘內容。UI 用 `{text}` 包裝問題，回調才映回根契約的 string 陣列。

此根契約明確 `.trim()` 項目兩端空白；原草稿保留，保存前顯示實際送出的規範內容，才勾選共享，不把一般欄位全部 trim。核對標記與共享同意分開；改文字／清單／預約後清核對和同意，單改核對標記仍清共享同意。未核對也可明確保存，但不能顯示成來源已核對。

草稿保留原 `expectedVersion`／`basisVersion`／完整期間。一般 GET 不覆寫 dirty 表單；最新已保存問題／清單另列作比較。來源、期間或共享準備改變時鎖保存；明確勾選核對最新內容、按「改用目前依據」後才更新基準，保留草稿並清核對／共享同意。原預約失效不默換其他預約，須明確另選或「沒有指定」。只有 `reviewCurrent` 代表目前仍與全部來源吻合，不能用曾經 reviewed 推斷。

owner／caregiver 可保存，viewer 唯讀；權限及資料版本由 Server 核對。字體、控件及顏色沿共用 tokens／Paper，寬內容期間欄橫排、窄尺寸直排；動態清單共用 AppTextField／AppCheckbox，不各頁另造表單。

## 原收據與清理

保存走原 S07 opId 收據；unknown 保留原識別、完整規範內容、來源／共享準備／期間基準及原預約顯示名稱。先查原收據及 GET 原期間；GET 成功不等於原保存成功。只有原收據尚未確認、成功讀取目前摘要且重新明確同意，才能沿原識別／正文／版本重試；不自動換版本、建第二份或重新核對後暗中重送。

已確認但摘要未讀回時，停止重送和其他保存，只查收據及更新摘要。確認後的 GET 讀最新狀態，較新家庭修改不會被舊結果覆寫；是否仍吻合按最新 reviewCurrent。409／已知拒絕先停寫、保留草稿、GET 後比較並明確換基準，不以這次拒絕推論較早 unknown 的結果。pending 期間不能更換 query 或放棄原請求；純草稿放棄只在成功重讀且沒有 pending 時載入已保存準備。

身份／Server／孩子切換、session_changed 或 401／403／404 清摘要／草稿／原操作，取消並忽略晚到回應；正式 adapter 沿原控制器。離線留本頁草稿／原操作、清同意、停提交，回線手動 GET，沒有 outbox／本地資料庫。重開不保證未保存草稿存在。

## 成熟能力及驗證

首次用動態 field array，已核對 [RHF 官方實作示例](https://github.com/react-hook-form/react-hook-form/blob/master/src/useFieldArray.ts) 的 fields／append／stable id，並讀本機 7.88.0 公開型別。官方文件網站本次 403，不聲稱該頁已取得；現有依賴／許可、Paper 控件、日期／時區及 OKLCH 結論沿既有 Skill，不引入新框架。可復用方法補 [表單 Skill](.agents/skills/web-screen-delivery/references/forms-controls.md)。

typecheck、兩項日期／時區及原文／上限／規範內容檢查、Web 31 靜態路由與 Android Hermes／31 資產 export 通過。摘要頁 1440／1024／390／320、鍵盤／動態增刪／共享／原收據／confirmed-unread／來源基準／預約失效／上限／範圍清理，以及 390／320 的 150% Web 文字重排通過；沒有 pageerror、console.error 或 /api/ 請求。[證據及 bundle](verification/fe-w16/build-checks.json)。其他業務、共用色值及控件未改，保留原證據，不機械重跑全部頁面。

仍待使用者視覺、正式 CareSummaryApi／控制器／資料顯示 adapter、精確記錄／任務導航、跨頁同步及必要真服務驗收；Android export 不代表 APK、實機、Safe Area／鍵盤／返回鍵／TalkBack 或系統字體通過。主動聯絡另包接續，整套隔離前端仍未結案。
