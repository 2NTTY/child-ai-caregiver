# S06-W03 本機 integration 驗收

狀態：2026-09-22 已獲使用者批准，11 組驗收全部通過；版本、範圍及失敗修正見 [EV-S06-W03](../artifacts/verification/S06_W03_CHECKS.json)。這是 [S06-W03](../PLAN.md#s06-w03) 的 Server／PostgreSQL／Better Auth 驗收；後續執行仍按 [驗證制度](../PLAN.md#verification) 決定批准範圍。

## 範圍與成本

- 使用兩個即場產生的 `@example.test` 合成帳號，經真實 Better Auth HTTP handler 註冊、登入及退出。
- 核對未登入拒絕、帳號／資料空間隔離、客戶端偽造身份無效、重複建立回傳同一資料空間、重新讀取、錯誤密碼及 Origin 拒絕。
- 退出後以舊 Cookie 再請求須被拒絕；重新登入後重啟 Server，原會話及資料空間仍可讀取，舊會話仍失效。
- 只連本機 PostgreSQL，沒有雲端、模型或郵件服務調用，沒有相關服務費用。預計數分鐘；如需首次下載 PostgreSQL Docker image，另需下載時間及本機磁碟空間。
- 這不涵蓋 browser E2E、Android 真機、真 Gemini、家庭邀請、備份還原或 P1 全部驗收。

## 批准後的準備與命令

使用 Node.js 24 及本工作包的已安裝依賴。預先準備 PostgreSQL 18.6、專用測試角色及已存在的測試資料庫；若使用 Docker，先由使用者啟動 Docker Desktop engine。runner 不啟動 Docker、不建立或刪除資料庫。

`TEST_DATABASE_URL` 是唯一資料庫輸入，不會回退至 `DATABASE_URL`。URL 只接受 `postgres:`／`postgresql:`、`127.0.0.1`／`localhost`／`::1`，且資料庫名稱必須以 `yuban_s06_test` 開頭，只含英數字及底線，總長不超過 63 字元。URL 必須有使用者名稱，不接受 query 或 fragment，避免連線選項覆蓋本機限制。例如：`postgresql://<test-user>:<password>@127.0.0.1:5432/yuban_s06_test`。不要使用正式資料或正式角色。

本專案的 `npm run setup:local` 會在已忽略的 `.env` 產生專用測試設定；不覆寫既有檔案、不輸出秘密。取得批准及啟動 Docker engine 後，可直接執行：

```powershell
npm run setup:local
docker compose -f compose.dev.yaml --profile test up -d postgres-test
npm run test:integration
```

測試 PostgreSQL 只綁定 `127.0.0.1:5434`，使用獨立 named volume；預設開發資料庫不會因這條指定服務命令而啟動。runner 透過 Node 的 env-file 支援讀取本機配置，不把 `.env` 內容輸出。不要使用 `docker compose down -v` 清除資料來令驗收通過。

如使用自行準備的本機 PostgreSQL，可改在專案根目錄執行以下 PowerShell；輸入 URL 時會遮罩，避免把密碼直接寫進指令歷史或專案檔案：

```powershell
$testDatabaseUrl = Read-Host '本機專用測試 PostgreSQL URL' -AsSecureString
try {
    $env:TEST_DATABASE_URL = [System.Net.NetworkCredential]::new('', $testDatabaseUrl).Password
    npm run test:integration
} finally {
    Remove-Item Env:TEST_DATABASE_URL -ErrorAction SilentlyContinue
    $testDatabaseUrl.Dispose()
}
```

Server 預設使用 `127.0.0.1:3099`；需要時可先設定 `$env:TEST_PORT = '3100'`。若端口已佔用，runner 會退出，不終止佔用端口的程序。`SERVER_ORIGIN`、`WEB_ORIGIN`、密碼及 Better Auth secret 均由 runner 在記憶體設定；同一次重啟驗收沿用同一 secret。外部 `NODE_OPTIONS`、`PG*` 及其他應用程式設定不會傳給測試子程序。

## 實際影響與結果判讀

runner 先執行 `server/migrate.ts`，再直接啟動 `server/index.ts`，只透過公開 HTTP 驗收業務行為。它不重設資料庫，亦不執行資料清理 SQL；本次產生的合成使用者、會話及資料空間會留在專用測試資料庫。每次使用新的隨機標記，毋須刪除舊資料重跑。

Better Auth 的登入限流保持啟用。短時間重新登入如收到 429，runner 只按有效且不超過 10 秒的 `Retry-After` 或 Better Auth 1.7.5 的 `X-Retry-After` 等候並重試一次；不改上限或使用無限重試。

正常完成、失敗或 Ctrl+C 均會在 `finally` 停止由 runner 啟動的 Node 子程序；不搜尋或終止其他程序。子程序 stdout／stderr 不轉錄，HTTP 正文、帳號標記、密碼、secret 及 Cookie 不會輸出或另存檔案。

成功時輸出固定的 `[PASS]` 項目及總數，exit code 為 `0`。失敗時只輸出固定驗收項目及錯誤類別，exit code 為 `1`；中斷為 `130`。保留合成資料的提示不代表已清理資料。`node --check scripts/verify-server.mjs` 只證明 JavaScript 語法可解析，不能代替上述 integration 結果。

正式驗收記錄應列明實際執行日期、Git 版本、Node／PostgreSQL 版本、通過或失敗項目及未執行範圍；不要記錄連線 URL、密碼、Cookie 或資料庫正文。
