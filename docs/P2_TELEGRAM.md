# P2 Telegram 操作

本文件保存 Telegram 的操作方法；開關預設關閉，以下步驟不是啟用授權。包狀態看 [PLAN](../PLAN.md#s13-w06)，最後公開 webhook／回覆結果看 [S17-W02](../artifacts/verification/S17_W02_CHECKS.json)，即時服務狀態須另查 [STATUS](../STATUS.md#deployment)。

1. 由負責組員在 Telegram 的官方 BotFather 建立／選用 bot。token 不貼進聊天或工程；保存於工程外的受保護 JSON，Windows 限本人 ACL、Linux 僅服務帳號可讀。字段為 token、botId（字串）、botUsername（不含 @）、webhookSecret（32–128 個英數／底線／連字號，使用隨機值）。token 的 ID 前綴須與 botId 相符。
2. Server 與 worker 設 TELEGRAM_ENABLED=true、TELEGRAM_CONFIG_FILE 指向同一受保護檔案；未批准前不啟用。bot 身份先透過官方 getMe 核對，不能把手填名字當驗證；[官方 API](https://core.telegram.org/bots/api#getme)。
3. 經批准先加密備份，再套用 migration 018／queue。Server 的 webhook 為 HTTPS 根入口下 /api/telegram/webhook；不開另一資料 API、不放寬其他 POST 的 Origin 驗證。以官方 setWebhook 設同一 secret_token，allowed_updates 限 message、callback_query、my_chat_member；可設 max_connections=1 降低並行，但應用仍持久去重。不要透過含 token 的命令 URL／終端輸出洩漏憑據，使用受保護檔案讀取及不打印請求的管理操作。
4. 接收者先登入育有方開始連結，在 Telegram 按 Start，再回網頁刷新並核對顯示身份後確認。這只完成本人渠道綁定，沒有授予家庭聯絡權。換 Telegram 帳號先解除既有綁定；/stop 或封鎖 bot 會撤銷已識別綁定及候選。
5. 一般測試需本人明確即時確認，每人 24 小時最多 3 次且相隔至少 60 秒；只發固定無孩子資料訊息。Telegram 的收到按鈕只回報 acknowledgement，不完成照護任務。停用 TELEGRAM_ENABLED 可停止新 adapter 執行，worker 全局暫停／restore 世代沿用 [既有流程](P2_WORKER.md)。

結果 unknown 不重發、不盲目切渠道。檢查站內台帳及 Telegram 實際訊息後，集中驗收／維護人員再判斷後續，不手改成 accepted。送出前已進入網絡的訊息不能靠撤銷追回；provider 接受不能當作送達或已讀。更換 bot 身份須先撤銷舊綁定；同 bot token 輪換保留 bot ID 但須重新核對 secret／webhook 配置。

## S13-W06 當時驗收記錄（歷史）

下列失敗及未部署只描述該次驗收；後續 S17-W02 已補公開接線，原結果不改寫，亦不把原暫留綁定指示當今日授權。

2026-09-30：[必要證據](../artifacts/verification/S13_W06_CHECKS.json)。既有 migration 018／配對還原及原資料保留通過；本機 45 業務／2 輪詢核對私人綁定、update 去重、交易入列、unknown 不重發、撤銷及重建後終態，合成資料已清理。真 bot 單次 sendMessage 獲 HTTP 200，使用者確認收到並按鈕回覆，持久 acknowledgement 可核對，不完成照護任務。

公開 HTTPS webhook／即時 answerCallbackQuery 回應留 S17-W02；本次即時回應未成功且原因未保留，沒有重發。真人 Start／身份核對／收到證據不等於完整 Web UI E2E；該項未驗。綁定暫供已規劃的單次 W07 照護聯絡沿用，完成後須撤銷；不再重發一般渠道測試。沒有部署或延長試用。
