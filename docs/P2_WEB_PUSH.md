# P2 Web Push 操作與驗收

S13-W05 提供本人訂閱、撤銷、固定一般測試及投遞狀態；照護任務聯絡／預授權／fallback 仍在 S13-W07。前置 S06-W02／S13-W04 已合併，不依賴 S10-W02。[UI 對接](P2_UI_HANDOFF.md)／[HTTP](API.md#p2-web-push-http)。

## 配置與保護

- 預設 WEB_PUSH_ENABLED 未設定或 false，不啟用外發；true 時 API／worker 均需 WEB_PUSH_VAPID_FILE，指向工程外受保護 JSON，含 publicKey、privateKey、subject（可聯絡的 mailto／HTTPS）。
- 固定 web-push 3.6.7／@types 3.6.4，只用 generateRequestDetails 加密；原生 HTTPS 一次嘗試、15 秒總期限／10 秒 socket 閒置期限，不跟 redirect、不記原始供應商錯誤。
- 首版支援 fcm.googleapis.com 與 updates.push.services.mozilla.com 的公開 IPv4 端點，對應正式 Chrome／Firefox 的支援端點。Edge 的 Microsoft provider、Safari 及 Chromium 測試端點未列支援；不能把 Chromium 核心視為同一 Push 服務。Firefox localhost secure context 已實測，公開 HTTPS origin 留部署驗收。
- 建立金鑰的指令為 node scripts/setup-web-push-key.mjs <工程外全新絕對目錄> <mailto或https聯絡地址>，只在獲准配置範圍執行；Windows 建立目前使用者專用 ACL，不覆寫既有目錄／金鑰，不輸出 key。將產生的 vapid.json 路徑交給上述環境變數。
- VAPID 私鑰固定使用，不每次啟動生成；遺失／輪換須重新訂閱。金鑰與資料備份分開保管，不寫入工程、log 或前端環境變數。
- migration 015 只新增訂閱／投遞表，不依賴獨立 S10 的 014。沿用 pg-boss schema 42、同交易入列及 worker_control 世代。遷移／真 DB 檢查另獲批准，既有表及加密資料不清空。

## 使用與結果

每人最多 5 項 active 綁定；滾動 24 小時最多新增 20 項及測試 3 次，兩次測試至少相隔 60 秒。測試按鈕明確授權立即投遞，只有固定一般文案，不含孩子、聊天或照護事項；不是一般照護通知的安靜時段例外。家庭通知限制由 S13-W07 接入。

訂閱、撤銷及測試經 S07 原 opId 收據。未知提交先查原操作，明確重試沿用原 payload／opId，不以新通知補償未知投遞。worker 啟用旗標不表示程序在線。

queued／sending／accepted／rejected／unknown／stopped 分開。201 只標服務接受；404／410 清除失效訂閱密文及 endpoint hash；429 不自動重試。嘗試後中斷／結果未能落庫，恢復標 unknown 而不再發送。撤銷阻止新投遞，已開始的請求仍可能到達。

瀏覽器只在明確操作下請求權限。SW 的 IndexedDB 保存綁定參照、短去重清單及失效世代，不保存家庭內容／cookie。登出或身份未確認時清除本機活躍綁定及目前通知；舊 activation 不可重啟。關閉網頁刻意保留已確認綁定供背景通知使用。只有 Server 確認本人現有 subscription 可恢復；另一帳號須明確重新訂閱。通知點擊只開根頁並正常核對登入。

## 驗收邊界

型別及 mock 檢查不證明 SQL 可執行或瀏覽器送達。必要本機腳本 scripts/verify-web-push.mjs 於批准後配合先備份／套用 015，以合成身份及 scripted gateway 核對隔離、原子入列、持久化、失效／撤銷／世代及 unknown 不重發；零真 Push。

真 Push／瀏覽器另行批准：指定受控測試瀏覽器、工程外 VAPID 金鑰、有限一般通知，核對關閉頁面後顯示、拒絕權限、退訂及跨帳號清理。不用真家庭資料、不呼叫模型，不把 mock、201 或 export 代作送達證據。必要驗收、review 及合併前 W05 不標完成。


## 2026-09-30 必要驗收結果

015／既有資料保留及加密還原復用 S16 共用證據；現有 SQL 入口 49 業務／2 輪詢、2 合成帳號／3 訂閱／7 入列通過，驗原子入列、隔離、失效、撤銷、unknown 不重發及重新連線。自己的合成資料已清理，原行保留。

使用者以既有 Firefox 明確訂閱後關閉分頁，唯一一則固定測試獲 HTTP 201，並實際回報收到；隨後以原頁退訂，Server 綁定已核對撤銷。沿用產品 client 模組、Service Worker、store、pg-boss consumer 與真 gateway；不是整套 UI／Firefox 相容性驗收。內置瀏覽器先產生 Google staging 訂閱而被拒，零發送並已退訂；未改寫 endpoint 或放寬白名單。參見 [Chromium 常數](https://chromium.googlesource.com/chromium/src/+/refs/tags/141.0.7390.94/components/push_messaging/push_messaging_constants.cc)。

本包必要本機／真接收證據齊備，完成隨 PR 合併生效。公開 HTTPS origin、部署配置及現網接線留 S17-W02；不把本機接收當公開部署通過，也未續期或改現網。[EV-S13-W05](../artifacts/verification/S13_W05_CHECKS.json)。
