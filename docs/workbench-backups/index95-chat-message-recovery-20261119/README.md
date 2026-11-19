# 選配工作台第 81 題：聊天中斷後找回原訊息

沒收到保存結果不等於沒送出。先重新讀取，核對是否有同一則；已保存而助手仍處理就等原回覆；已保存而回覆失敗則重試同一則的回覆，開始新訊息是另一個操作。只比較設計，不連線或發訊息。

- **對話找回-01 Apple 訊息**：[香港支援原文，2026-11-19](https://support.apple.com/zh-hk/118433)，[香港繁中原圖](https://cdsassets.apple.com/live/7WUAS350/images/ios/locale/zh-hk/ios-16-iphone-16-pro-messages-not-delivered-prompt.png)。已目視「尚未送達」和「再試一次」，以原泡泡為錨。這是已知未送達，不證明逾時、後端去重或助手回覆。對應產品 build 未標。
- **對話找回-02 LibreChat**：[官方 Message Actions（Latest dev）](https://www.librechat.ai/docs/features/message_actions)，[作者原圖](https://www.librechat.ai/images/features/message_actions/action-row-light.png)，[官方 Git 源檔](https://github.com/LibreChat-AI/docs/blob/9594a7a7158e6fee41d9f319a1ed59037eab5552/public/images/features/message_actions/action-row-light.png)的核對 blob 為 `ecbdc8112b51d93603ad93567c65fe005068de99`。已目視原問題、助手回覆和其下 Regenerate；只證明可對同一問題生成另一次答案，不證明保存查核、逾時或已失敗。截圖拍攝日及產品 build 未標。兩款均只提供原作者連結，不轉載或嵌圖。

[聊天保存、進度、原文查核與重試](https://github.com/2NTTY/child-ai-caregiver/blob/d662a894f1cb1939800f7fcb15807f40aa4738db/frontend/src/screens/chatScreen.tsx#L169-L215)；[原訊息回覆入口](https://github.com/2NTTY/child-ai-caregiver/blob/d662a894f1cb1939800f7fcb15807f40aa4738db/frontend/src/screens/chatScreen.tsx#L295-L300)。與第 20 題一般離線等待、第 62 題送出前錄音草稿、第 72 題附件重試不同。

81 題、165 款，原有 146 張圖不變；離線驗證跳轉、焦點、並排、選擇、複製版本與來源、移除選擇。沒有真帳戶、模型、聊天、連線或正式環境測試。SHA-256：`13f9c62d6bf721eb65d11afacb4bca15313618e9bc27f4e170f5021abea60874`。獨立分支純文字備份，無 PR、無合併、無發布。
