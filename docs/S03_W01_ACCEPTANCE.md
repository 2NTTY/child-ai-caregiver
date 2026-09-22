# S03-W01 Web 縱向流程驗收

狀態：2026-09-22 已獲使用者批准；16 組 HTTP integration 及 12 階段本機 Web E2E 全部通過。證據見 [EV-S03-W01](../artifacts/verification/S03_W01_CHECKS.json)。前置 S06-W03 已通過真 PostgreSQL／Better Auth 驗收並合併；後續測試仍按 [AGENTS](../AGENTS.md#finish) 決定批准範圍。

## 已批准範圍與成本

- 本機 PostgreSQL 沿用專用合成資料庫及既有 volume，執行增量 migration；不清空資料。
- `npm run test:records` 經真 HTTP／Better Auth 建立兩帳號、三個孩子及原始文字，核對原文／作者、帳號與孩子隔離、無效輸入、帳號切換前置拒絕、登出及重啟持久化。共 16 組檢查，內含既有 11 組身份基礎驗收。
- 本機 Chromium Web E2E：註冊／登入、建立孩子、確認保存、關閉頁面重開與重新登入、切換孩子、斷線保留輸入及禁止假保存、恢復連線後保存、退出及跨帳號畫面清理。
- 全部使用即場產生的合成資料；不呼叫 Gemini、郵件或雲端。預計數分鐘，僅本機 CPU／記憶體／磁碟成本；可能需要本機 browser runtime。
- 這不是 S16 全階段驗收、Android 真機、真 Gemini、加密備份或組員獨立試玩。

## 環境與結果

HTTP runner 沿用 [S06 驗收](S06_W03_ACCEPTANCE.md) 的本機 URL guard、秘密隔離、有限 rate-limit retry，以及只停止自己程序的規則。`--records` 額外核對孩子／文字記錄；合成行留在測試 DB。

Web runner 由 `npm run test:web` 啟動。需 Node 24、已安裝的 Playwright 及本機 Edge；此環境使用工具 runtime 提供的 Playwright 1.62.1。若 Playwright 不在 Node 模組搜尋路徑，可將 `PLAYWRIGHT_MODULE_PATH` 設為其 `index.mjs` 絕對路徑；`BROWSER_CHANNEL` 預設 `msedge`，亦可明確設定 `BROWSER_EXECUTABLE_PATH`。這些是測試工具設定，不納入應用程式 bundle。

runner 使用 `localhost:3101` Server／`localhost:8181` Web，端口已佔用便退出；不終止其他程序。它會建立隔離的 headless browser context，阻止非本機網絡請求，不使用使用者瀏覽器 profile、不輸出帳號／密碼／正文，不保存 Cookie、trace 或截圖。驗收後停止自己的 Server、Expo 及 browser。

本機 Kaspersky 向 HTTP 頁面注入 `me.kis.v2.scr.kaspersky-labs.com` 腳本。runner 仍阻擋它，只把此已識別的環境注入排除於產品外連失敗判定；其他未知外部 origin 仍會令驗收失敗。沒有更改防毒或系統安全設定，沒有將注入腳本納入產品依賴。

實際執行後保存通過／失敗、環境、修正及未執行項，不能以 unit mock 取代真 Web 保存／斷線的驗收結果。不記錄密碼、Cookie、連線字串或家庭正文。
