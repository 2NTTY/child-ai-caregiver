---
name: web-push-delivery
description: 修改 Web Push 的 VAPID、端點校驗、單次 HTTP 投遞、瀏覽器訂閱或 service worker 通知時使用；不適用 Telegram、產品 prompt 或任務選人／授權政策。
---

# Web Push 有界投遞

適用 Node 24、web-push 3.6.7、@types/web-push 3.6.4、Expo Web 57。最後核對：2026-09-28。固定 SDK 原碼及下列官方協定已核對；型別與 mock 檢查通過，真 Push／瀏覽器／PostgreSQL 待驗。產品權威見 [通知契約](../../../docs/API.md#notification-contract)。

- 固定 SDK 是 CJS，型別另包。generateRequestDetails 只處理加密及 VAPID，可接單次原生 HTTPS；sendNotification 沒有自動重試，但 timeout 是 socket inactivity，沒有 AbortSignal，且收集回應正文。需要取消／總期限／回應上限時不要把 SDK timeout 當完整保障。錯誤可帶 endpoint、headers、body，不輸出原始錯誤。[固定原碼](https://github.com/web-push-libs/web-push/blob/v3.6.7/src/web-push-lib.js)
- SDK 不替產品核准端點。endpoint 是不透明 capability，保密保存；校驗 HTTPS、支援 provider、無 credentials／fragment／非標準 port，DNS 後拒絕非公開位址並固定連線位址，保留 hostname TLS 驗證，不跟 redirect。不要依 endpoint 路徑猜帳號。provider 清單按實際支援範圍核對。[Chrome](https://developer.chrome.com/blog/web-push-interop-wins)／[Mozilla](https://mozilla-services.github.io/autopush-rs/http.html)
- VAPID P-256 金鑰與 payload 加密 key 不同；applicationServerKey 綁定訂閱，金鑰需穩定且備份私鑰。輪換不能假定舊訂閱自動轉移。JWT audience 是 push origin、有效期上限 24 小時，subject 是可聯絡的 mailto／https URI。[RFC 8292](https://www.rfc-editor.org/rfc/rfc8292.html)
- 201 只證明服務接受，不證明裝置收到／已讀／回應／任務完成；失效回應按 provider 404／410 處理。連線中斷後可能已接受，保留 unknown，不盲重發／fallback。外部效果與 SQL commit 無法原子化；先保存嘗試識別，恢復時避免第二次 HTTP。[RFC 8030](https://www.rfc-editor.org/rfc/rfc8030.html)
- Push API 需要 secure context；由明確使用者操作請求通知權限，不在頁面載入時自動提示。userVisibleOnly 要求可見通知，不用 silent push 做隱形背景同步；訂閱改變不能默默綁給另一帳號。[Push API](https://www.w3.org/TR/push-api/)／[Firefox](https://hacks.mozilla.org/2019/11/upcoming-notification-permission-changes-in-firefox-72/)
- SW 可在頁面關閉後存在。登出／帳號切換另設本機綁定清理，並令先前非同步 activation 失效；不只在 React unmount 刪變數。內容最少，目的頁固定並重新走正常登入，不把 payload URL 直接交 openWindow。已在途投遞及 OS 既有顯示不能保證收回。
- Expo Web public 檔案複製至 dist；實際 export 核對 SW 路徑／內容，避免 fallback 到 index.html。SW 不必同時成為離線快取框架。[Expo export](https://docs.expo.dev/guides/publishing-websites/#create-a-build)
