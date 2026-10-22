# 2026-10-22 前端增量驗證

此頁只記錄 draft PR #253、`f5f69e622470bdaae24d32ccb2aaaa5218f2a56b` 之後本批變更；既有 snapshot09 證據不重算。

## 變更邊界

- 核對頁（原記錄頁）改為「待確認／已保存」，沿用待辦頁 count badge；手動新增與分頁同排靠右。已保存只呈現原 owner 的一份 server 搜尋／種類／列表／分頁，沿用詳情、更正、刪除及 deep link。核對歷史入口及助手提案的保存語義不變，沒有新增後端聚合。
- 已登入範圍共用本機背景（含聊天）。snapshot10 的分體底板在使用者後續要求下改為 snapshot11 的單一霧化玻璃面板，保留原卡片；不以舊分體圖代表最終設計。移除重複可見頁名，保留有名稱的頁面 region、原 refs、返回焦點；待辦／成長頁操作與分頁同排。
- snapshot11 恢復 desktop 左下原「與 Agent 對話／提問・整理・規劃」；已核實當前孩子聊天載入完成且為空時，顯示非每日語氣「想先聊聊什麼？」。載入、失敗及缺 scope 不冒充空對話。
- 關注事項管理改為局部展開、記憶手動管理改為 modal，保留原 owner actions、確認／草稿／unknown 保護。日期動作改「確認日期」，Web 只加強該日期彈窗的啟用確認按鈕。
- FormDialog 增加可選 owner 關閉結果觀察：只在 guard 准許後捕獲 revision；首個新 projection 拒絕即消耗回焦意圖，後續不得復活。scope、form generation、重開與 unmount 仍受保護；Care 草稿只由 modal 關閉完成後回焦，避免和 inline panel 搶焦。
- 不改後端、API、權限、資料 owner 或真模型；HomeWelcome 沒有另作版式改版。Profile 在 snapshot12 只做共用背景／頁名處理，snapshot14 按後續要求另補閱讀佈局，見下方增量。

## snapshot10 定向結果

| 檢查 | 結果 |
| --- | --- |
| Care 分頁、唯一 saved list、server 搜尋／分頁、deep link、guard；count badge | 21/21 |
| Care 真 RN Web Modal／FocusTrap DOM，包括拒絕、saving、unknown、scope、capture 單次回焦 | 8/8 |
| Modal／草稿 guard／SourceComposer／Tasks stable region＋Memory 管理 DOM | 17/17 |
| 新 close lifecycle 子集：dirty stay→再次關閉、同 projection 重繪、form／scope／重開／unmount | 5/5（包含於上一組） |
| 背景／頁名／toolbar 定向組 | 80/80 |
| Growth 最後 surface／empty flow／refresh／capacity 組 | 28/28 |
| 日期確認按鈕 | installed Paper Dates＋RN Web 的 confirm／cancel／Escape／disabled 定向 DOM 通過 |

主要可重現入口：`care-conversation-review.test.mjs`、`tab-count-badge.test.mjs`、`care-return-focus-dom.test.cjs`、`modal-layering-dom.test.cjs`、`memory-management-modal-dom.test.cjs`、`background-local.test.mjs`、`growth-empty-flow.test.mjs`、`growth-refresh.test.mjs`、`growth-concern-capacity.test.mjs`、`date-picker-action-dom.test.cjs`。DOM scripts 使用明示的既有 `JSDOM_MODULE`；幾何、外觀及合成 owner ports 不當成真 API 或像素驗收。測試組有重疊，不相加為全站案例總數。

原 refusal/capture 回焦紅在隔離 HEAD 也重現，最終 Care DOM 已綠，未刪除相應拒絕／scope／單次回焦斷言。`records-unified-focus-run06-20261022.log`、`records-formdialog-memory-regression-run03-20261022.log`、`records-unified-unit-final-run02-20261022.log` 保留本機；不提交完整 logs。

## Export 與既有阻塞

- snapshot10 唯一離線 Web export 成功，536 build inputs 前後完全相同，64 artifacts；`git diff --check` 通過。
- JS：`index-27f3efb8745ff7a41f518594b9fe6422.js`，SHA256 `f35cbd89cdfbd2b172b1415d44360bc56333832b323292808d8bb05d3386a149`。
- 來源 manifest SHA256：`83d82333c677c00760dd4fcb6a4ac9353420350997476babc7a2fb270d4b4788`；artifact manifest：`1edaad9880efc6a9d24f9dd4c20511934bd298eb69183346c988bfaa6e590baf`。完整 manifests／bundle 留在 QA workspace，不納 PR。
- 整合 typecheck 仍只有既有 `ContactConsentCard.tsx` 33:218、99:197 兩錯，無新 diagnostics；不是 typecheck 全綠。
- 舊 harness 阻塞另列：history-controls 5 fail（缺 usePersonalHistory）、memory-source-display 4 fail（缺 useRouter）；records-history-integration 6 fail／1 pass（5 缺 usePersonalHistory、1 舊 provider 結構斷言）。均有隔離 HEAD 同紅證據，未藉此修改產品或放寬斷言。

## 日期配色與驗收界線

本批日期確認只使用既有色值：字 `#FFFFFE`／底 `#272343` 計算對比約 **14.91:1**；hover／pressed 底 `#221F3B` 約 **15.81:1**。保留 disabled 規則、focus-visible outline 與 forced-colors fallback。這是限定色對的計算，不代表完整無障礙審核；不提交 verify-colors 重生的整份舊 palette 報告。

## snapshot10 獨立 Chrome 驗收（歷史版本）

兩組 reviewer 使用同一 snapshot10，64 個 export 檔案獨立重核全符，代表性驗收 **PASS，無新增 blocker**。

- Care 320／390／1024／1440：分頁與右側新增無重疊、文件無橫向溢出；320 透過原 overflow affordance 與 Enter 到已保存。唯一 server 搜尋／下一頁／上一頁／詳情返回保留 query；dirty stay 保留文字，再捨棄回原新增 trigger。Agent 提案仍是獨立原區塊。
- Memory 320／390：管理只在 modal 中，窄屏可換行捲動；nested editor 的 Escape、dirty stay／discard、外層關閉各回正確 trigger；合成孩子切換不殘留舊 editor。
- 自訂背景：Home 390／1440、Chat 390、Care 320／390、Growth 320／390 的亮暗合成圖上局部閱讀底板清晰，沒有整頁大底板。Tasks 320 操作 menu 保留三個原 action，捨棄表單回可見有名稱 region。
- Growth Enter 展開管理、Tab 到原結束確認、取消回原按鈕、Space 收起。巢狀日期 picker 的填色確認按鈕實測高 52.8 CSS px，有 keyboard outline；Enter／Space 確認，改日後 Escape 保留前次值並回輸入框。登出後自訂背景節點為 0。

本機證據索引：`records-controls-qa-20261022/REVIEW.md`、`browser-evidence.json` 與 7 張圖；`background-concern-qa-20261022/browser-evidence.json` 與 10 張圖。QA fixture／截圖不納產品或 PR。Memory 原有部分 editor 欄位 AX 缺 programmatic name 仍列界線，不宣稱完整無障礙通過。第二帳戶登入切換、OS reduced-transparency／不支援 blur 開關、Growth 多 action pending browser 注入未另實測，僅有相關 source／定向測試證據。

## snapshot11 增量

單面板背景定向 59/59、背景／Home timing 17/17、既有 JSDOM modal／Memory 17/17 通過；聊天入口／confirmed-empty 新測試 4/4、IME／send-focus DOM 6/6 通過。source review 無新增 blocker。

唯一離線 export 成功，536 inputs 前後相同、64 artifacts；typecheck 仍只有同兩個 ContactConsentCard 錯。JS `index-7a23d0576f24462988e14e9a3041b722.js` SHA256 `57a606702b8eb78c85689d08989dd70c777a535de95af712a1272b542b23d1a7`。來源 manifest `e0757043c49681be46f79adca3d5424fa42100b0efa2a47ef519911bdc1bacc5`；artifact manifest `11d07905ddb18940b66207297c1dcf7466dcb29b2deb2a425dd80d093eeec164`。

獨立 Chrome 代表性驗收 PASS：Home 390／1440 單一霧化面板、原 solid 卡片保留；Chat 390／歷史／confirmed-empty、Care 代表頁、捲動與焦點正常。1440 iframe 的 clientWidth 與 scrollWidth 同為 1440，外部截圖裁切不算 app 溢出。精確版本證據在 `background-single-panel-qa-20261022/snapshot11-evidence.json` 與 7 張圖；不以這組圖聲稱已驗新頁名。

## snapshot12 最終頁名增量

頁面顯示名、navigation 與可及名稱改「核對」；desktop sidebar 移至管理組、子女檔案之後／記憶之前，手機五格順序與手勢不變。`care` route 與記錄領域用語不改。相對 snapshot11 精確只有 12 個產品檔不同，背景／聊天／CTA 來源逐 byte 未改。

最相關 more-navigation 4/4、Care 16/16 通過，native 五格 route／title 及原 guarded tap／drag／keyboard 個案通過。首次 60 案批次為 24 pass／36 fail，已停止而非報綠：兩個 mobile harness 缺 TasksWorkspace、history 舊 Summary 結構與缺 usePersonalHistory（含新增 navigation case 未進斷言）、27 個 photo loader 被 RN `typeof` syntax 擋住。未擴大修復，也未另證全部 36 項在 HEAD 同紅。

唯一離線 export 成功，536 inputs 前後相同、64 artifacts；typecheck 仍僅同兩個 ContactConsentCard baseline 錯，diff check 通過。JS `index-23d3f2b8e0bd261d1067b2cf8e1490a7.js` SHA256 `5ff5cc4b8283494867d2459d0bf84168b4ea95fb5fb7f2f31b4712fcf9e098aa`。來源 manifest `7a1d7b191c543aa86414303c34c58bc65b5eea932a384b2200cf7f4aa4960d2d`；artifact manifest `194292f2a6900cf203297a6dde9583a3bcd885193ebaff51ac4c7c6cd1aad4ae`。

最小 Chrome navigation 增量 PASS，已核實載入上述 snapshot12 bundle：desktop 管理組順序為子女檔案→核對→記憶→全部功能，Enter 到 `/care` 並聚焦可見具名 region；mobile 第五格核對仍在原位、可及名稱完整，由今日點按可返回 `/care`，390 無橫向溢出。證據為 `background-single-panel-qa-20261022/snapshot12-nav-evidence.json` 與 desktop／mobile 兩張圖；snapshot11 背景證據維持獨立版本，不宣稱重跑完整回歸。

獨立頁名／sidebar source-only review PASS，16 個產品／測試 freeze hash 全符；未發現新增 blocker 或 owner／route／資料語義變更。

## snapshot14 檔案／日期／聊天增量

- Profile 首屏改孩子身份與編輯入口、基本資料／健康與照顧兩組閱讀卡；窄屏堆疊，未知欄位保留但合併呈現。版本／來源／確認資料與歷史放進「檔案詳情」，原新增孩子保留，刪除入口收進管理並保原 owner／確認／pending／unknown guards。完整確認、衝突與歷史摘要不改。
- 歷史頁移除指定分類說明句；聊天 toolbar 只移除「記憶與參考」捷徑，保留活動、sidebar 與全部功能入口。日期確認只補 `justify-content: center` 讓文字上下置中，保原尺寸、圓角、主色及語義。
- Profile 定向 7/7、8/8、12/12，日期 DOM 2/2、聊天入口 5/5 通過（測試組不相加）；Profile／日期 source review 無新增 blocker。
- snapshot13 雖完成 export，但聊天在建置期間變動，before／after hash 不一致，故明確作廢、未交驗；失敗 logs／兩份 manifest 保留，不重寫成綠。
- snapshot14 唯一重捕捉 export 成功：536 inputs 前後相同，對 snapshot12 精確 6 個產品檔不同，64 artifacts；typecheck 仍只有原兩錯。JS `index-1639a14a9294ce1a4e806127d78475e1.js` SHA256 `919f88e8585240f882125ff377f5136be23c094e75a43e5327ae6c5a4fffbc72`；來源 manifest `315b7d9f97bafa1afc56b95f1f05e6d66455a133ac082dfc9eca6b132bd02c06`；artifact manifest `6479fe28912387ef8c5c94fa9193953707a2fc2755282e6f365a03ce19344d30`。

Chrome 390 驗收發現 Profile 兩張閱讀卡因窄屏 flex-basis 高度收縮而文字重疊，故此版 Profile **未通過**；已交原作者作最小修復，後續候選須重新驗證，不以 source／DOM 測試代稱實屏通過。日期／聊天／歷史的獨立增量通過：日期 save、文字 line box、close 的 midY 同為 44.796875，原 108×44 hit area 不變；Tab／Enter、dirty stay／discard、精確 edit trigger 回焦通過。聊天僅刪指定 toolbar 捷徑，歷史僅刪指定動態說明。證據在 `records-controls-qa-20261022/profile-review-snapshot14.json`，不把整個 snapshot14 當綠。

## snapshot15 活動／去重／檔案高度修復

- 活動視窗以目前狀態、待確認事項與操作結果為主，已完成詳情、處理步驟、原回覆／來源按需展開；私人背景同名項目保留分鐘級時間與可及名稱。原 run／proposal／receipt owner、共享確認、unknown／expired／denied／offline guards、讀取分頁與來源回調不變，不把待確認冒充已保存。
- Memory／全部功能／設定移除明確重複頁名與純介紹，保留功能名稱、原 actions 與必要狀態提示。Profile 唯一高度修復為 `ProfileSummary` 窄卡 `flexBasis: "auto"`，不改資料或卡片排列。
- Activity 新布局／guard 8＋原收據 8 共 16/16，舊 suite 僅活動相關 5/5 通過；首次兩個舊 harness port 缺失紅保留，最小 mock 補齊後未宣稱整份 suite 全綠。Memory／同類去重三 suite 17/17；source review 均無新增 blocker。
- 最終離線 export 成功，536 inputs 前後完全相同；對 snapshot14 精確 6 個產品檔不同，64 artifacts。typecheck 仍只有同兩個 ContactConsentCard baseline 錯。JS `index-60cda9efa6f87e8a636f58043d69d2a4.js` SHA256 `4bbb051fa7d375ab8b28531efb030b612a6f8ba7148f4d7c14c8e40b34a36d6d`；來源 manifest `932e3bd84015ae84889b7ef0845ddf784c1f76ed79ac6bee9cf3abfd5a8d2a2e`；artifact manifest `91427c268b0235d4d41f3eae87141da7946ba7356024f710b2cbd60e2cd8ced7`。

兩組獨立 Chrome 增量驗收 **PASS，無剩餘 blocker**，各自核對 64 artifact hashes 及實際 iframe bundle：

- 活動 desktop 1440／1024 結果層次與收合詳情；390 待確認內容／動作、收據讀取失敗、鍵盤展開／Escape 回原 trigger；320 expired 禁用確認且保留略過；390 合成固定 503 unknown 顯示原決定恢復、禁新決定，讀取後只啟用明確原重試，未實際重送。Memory 390 去重而保留真正內容標題及私人／來源提示。窄屏 document 無橫向溢出。
- Profile 320／390 卡片為 `0 0 auto`，內容完整位於卡內、不重疊；1024 保持並排。詳情／更正歷史完整欄位、鍵盤收合／讀取、管理原刪除確認只按保留孩子、新增空 modal 關閉，均通過；原 14 紅證據不覆寫。日期／聊天／歷史來源與 14 相同，沿用其獨立通過結果，沒有冒稱重跑。
- 本機證據：`activity-dialog-qa-20261022/review.md` 及有效 pending／expired／unknown／Memory／完整 desktop 圖；`records-controls-qa-20261022/profile-review-snapshot15.json` 及 5 張圖。desktop 原過渡圖不用於精確 viewport 宣稱；補圖時 80% browser zoom 有整數取整，還原 100% 後 document client／scrollWidth 均為 1024。iframe 使用當前 app zoom；外層 viewport 裁切不是 app 溢出，DOM 幾何另核完整卡片界線。

unknown 固定失敗為 repo 外合成 fixture，不是真保存；共享確認／版本／授權邊界沿 source 與既有測試，未另做完整 browser 安全矩陣。未執行最終刪除、真 API／模型或原決定重試。

僅合成資料／圖片，無真家庭資料、真訊息或模型呼叫；不宣稱 Android 真機、完整讀屏或所有尺寸／狀態組合通過。維持同一 draft PR，不合併；公開預覽更新由主代理按本次明確授權處理。
