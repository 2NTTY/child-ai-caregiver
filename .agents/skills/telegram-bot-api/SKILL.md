---
name: telegram-bot-api
description: 修改 Node Server 的 grammY Telegram 私聊綁定、webhook、訊息投遞或 callback 回應時使用；不適用純 UI、Agent 提示詞或照護任務規則。
---

# Telegram Bot API

適用 grammY 1.46.0、Node 24、Telegram Bot API 10.3；官方原文／本機型別最後核對：2026-09-28。文件已核對；實作檢查及真渠道驗證狀態見 [S13-W06 證據](../../../artifacts/verification/S13_W06_CHECKS.json)，不將 scripted transport 當真 Telegram。

- grammY `Api` 可單獨使用，不需 `Bot.init()`／long polling。固定版本的 `sendMessage(..., signal)` 支援取消；核心每次呼叫一次 fetch，預設 timeout 500 秒，須按工作期限縮短。不裝 auto-retry 或加入暗中重試的 transformer／fetch；關閉 webhook reply 及 sensitiveLogs。若要求單一外發嘗試，須同時核對 transport 的 redirect／retry，不只看 SDK。[固定原碼](https://github.com/grammyjs/grammY/blob/v1.46.0/src/core/client.ts#L264-L318)
- 成功返回 Message 是 API 接受證據；不是送達／已讀／照護完成。Bot API 沒有 sendMessage 通用冪等 key；逾時、斷線或無法驗證回應保留 unknown，重啟查原台帳，不盲重送。GrammyError 表示 Bot API 拒絕；429／retry_after 不自動授權重試。403 不一律等於封鎖，按有限已核對原因分類，其餘保守保留拒絕。[回應格式](https://core.telegram.org/bots/api#making-requests)／[錯誤型別](https://github.com/grammyjs/grammY/blob/v1.46.0/src/core/error.ts)
- webhook secret 用固定 header 驗證，先驗證再讀取有界 JSON；逐筆以 bot 身份＋update_id 持久去重，同交易保存業務效果再回 2xx。不把最大 update_id 當永久游標：一週無更新後 ID 可能重新隨機，亦可並行／亂序。SDK webhookCallback 不提供業務持久去重。[setWebhook](https://core.telegram.org/bots/api#setwebhook)／[Update](https://core.telegram.org/bots/api#update)
- 使用者須先啟動 bot。私聊 deep link 的 start payload 只容許英數、底線、連字號，最多 64 字元；一次性、期限及帳號確認是應用責任。分開保存及核對 Chat.id 與 User.id，不假設兩者相同；只處理獲准的 private chat 事件，忽略無關訊息／附件，不用可變 username 作身份。[deep link](https://core.telegram.org/bots/features#deep-linking)／[User](https://core.telegram.org/bots/api#user)／[Chat](https://core.telegram.org/bots/api#chat)
- callback_data 只有 1–64 bytes，不是可信授權。以不可猜的參照查台帳，再核對 sender、chat、bot、原訊息／事項及目前綁定；多次點擊仍須冪等。`answerCallbackQuery` 只清除進度提示，不作業務完成證據；業務已保存後即使清提示失敗，也不能因此重發原訊息。[CallbackQuery](https://core.telegram.org/bots/api#callbackquery)
- token／webhook secret、chat identity、任意 SDK 錯誤與 request URL 不進工程、日誌或 queue payload。secret 從受保護檔案取得；索引若涉及可枚舉數字身份，使用受保護的穩定 HMAC key，正文沿用既有加密。外發前短交易重查，網絡呼叫不持資料鎖；撤銷不能回收已進入網絡的訊息。

產品授權／任務／fallback 以 [API 通知契約](../../../docs/API.md#api-notification-02) 為準；本 Skill 不另定產品角色、重試次數或測試批准。
