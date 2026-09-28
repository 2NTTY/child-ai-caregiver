# P2 最小正式 Web 驗收入口

S16-W05 已以 Playwright Test 1.63.0 通過一次必要 Chromium 真 API 情景。2026-09-29 使用者確認 Firefox 專項延後，不阻塞 P2；後續必要功能檢查使用 Codex 內置瀏覽器，不因更換工具重跑已通過項。前端 `frontend/` 的合成預覽不在本入口；P1 `verify-web.mjs` 與 node:test 保留。

## 唯一情景與邊界

`tests/browser/family-boundaries.spec.mjs` 用同一情景串起家庭隔離／viewer 唯讀、真保存後遺失回應再查原 opId、撤權後清除介面與草稿；Chromium 為預設入口，Firefox 保留明確選入的後續入口。單 worker、零重試、首次失敗停止；不跑其他矩陣、視覺快照或全量回歸。

每瀏覽器最多 3 個新合成帳號、1 個新孩子及 2 筆記錄；HTTP 硬上限 180（包含頁面 API），只刪本輪新建孩子，合成帳號保留。cookies／密碼只留記憶體，沒有 storageState 檔案、trace／video／screenshot。資源清理失敗須記錄，不擴大到既有資料。頁面外網被阻擋，模型／Push／Telegram 停用；本包不證明模型、渠道或照片品質。

## 獲批後執行

1. 沿用工程外的加密合成庫 `localhost:5434/yuban_s06_test`；先完成集中備份及所需 014–022 migration，worker 保持暫停。入口本身不做 migration／加密升級或清庫。
2. 提供 `TEST_DATABASE_URL`、`STORAGE_KEY_FILE`、`TEST_ATTACHMENTS_DIR`，勿把值寫入工程或日誌。附件目錄須為該合成庫配對的工程外目錄；沒有資料時用新的專用空目錄。
3. 確認 localhost 3101／8181 無佔用及固定版本的 本次獲批瀏覽器執行檔已準備。需要下載瀏覽器時納入集中批准；不自行下載。設定 `P2_BROWSER_APPROVED=true` 只代表操作者已取得該次批准，不構成批准本身。
4. Node 24 執行 `node node_modules/@playwright/test/cli.js test --config=playwright.config.mjs`；只開自有 API／Expo Web 子程序，預設只列 Chromium。日後 Firefox 專項獲批准後才設定 `P2_FIREFOX_APPROVED=true` 並加 `--project=firefox`；環境旗標本身不構成批准，未執行仍是未驗。
5. 任一失敗先保存錯誤與已建立資源範圍，不自動重試、放寬限制或改用假 API；修正後只補受影響的必要情景。

`--list` 不開瀏覽器／Server、不連資料庫或建立帳號；離線命令只核對 native runner 能載入配置及案例。先前 P1 試玩及本機 HTTP 證據不自動視為本包瀏覽器通過。

主聊天統籌正式 API 接線、授權及資料清理；B 配合正式 UI 入口，D 的人工試玩與 PPT 另行安排。沒有把 AI 準備腳本寫成組員已手動驗收。


## 已驗證與延後項

Chromium 在整合版本 `2b6e0bf` 的一次完整流程通過，147 次 HTTP、3 個合成帳號、1 個孩子已刪除；沒有非預期外網、模型、通知或部署。正式產品元件、照顧記錄 API 契約及測試斷言沿用受驗版本；獨立交付分支只取本包的工具／測試／文件，未將其他待驗 P2 功能合併 master。之前 locator 及錯誤搜尋路由的失敗保留於集中原始證據，已局部修正，沒有放寬斷言。

Firefox 在 Playwright 獨立測試版的 Windows Side-by-Side 啟動階段失敗，產品情景未開始；不是使用者日常 Firefox 或其個人 profile。依使用者確認停止本輪系統診斷，保留「未驗」與後續相容性工作，不宣稱任何 Firefox 通過結果。Chromium 證據不需改用內置瀏覽器重做。

[Codex 內置瀏覽器](https://learn.chatgpt.com/docs/browser?surface=app)可操作本機頁面及核對可見功能，後續只按缺項使用。它不自動替代指定瀏覽器版本的相容性證據，也不放寬真服務／通知及人工回報的批准要求。
