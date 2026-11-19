# 選配工作台：第 88 題，聊天閱讀位置

比對固定原站版本 `86a68b787af90fbe2379247f13030125b1804742`，只增加選配題目；沒有更改聊天程式、啟用後端、部署或合併。

育伴港現版在手動向上翻時暫停跟隨，載入更舊內容會保留閱讀位置；「回到最新」箭頭表示目前離底部較遠，不表示有未讀回覆。這題比較同一聊天頁在新回覆到達時怎麼提示，不改串流、送達或重試。讀者選定前不會套用到產品。

## 閱讀位置-01｜Telegram：在聊天頁按鈕顯示未讀數

官方發布介紹在聊天頁的回底按鈕合併未讀數，入口隨畫面可見。這個參考用來比較直接回到末端的做法，不代表育伴港現有箭頭已有未讀計數；靜態圖也不能驗證續讀錨點。

- [作者來源](https://telegram.org/blog/drafts)
- Telegram v3.10，2016-06-14 官方發布；文中個別畫面的 Desktop build 未標。
- [Telegram 作者發布：…and more 段落及未讀計數原始畫面](https://telegram.org/blog/drafts#:~:text=New%20unread%20messages%20counters)
- [Stream React v15 官方操作截圖：讀舊訊息時下方顯示新訊息數（獨立參考，非 Telegram 畫面）](https://getstream.io/docs-assets/images/8e38e1d70fde.png)
- [Stream React v15：未讀提示與回底的原始操作說明](https://getstream.io/chat/docs/sdk/react/ui-cookbooks/message-list/unread-and-scroll-controls/#default-controls)
- [育伴港固定版本：閱讀錨點與跟隨狀態](https://github.com/2NTTY/child-ai-caregiver/blob/86a68b787af90fbe2379247f13030125b1804742/frontend/src/components/chat/ChatTimeline.tsx#L65-L90)
- 只連結官方原始畫面，不封裝或轉載 Telegram 圖像及訊息內容。

## 閱讀位置-02｜Slack：在聊天清單畫出新舊分界

官方企業指南的完整工作區畫面以 New 分界線標示訊息清單內的位置；它不是固定在畫面上的回底按鈕。Slack 另把跳到首則未讀與跳到最新做成兩個不同動作。原圖不能證明捲動時是否保住位置。

- [作者來源](https://d34u8crftukxnk.cloudfront.net/slackpress/prod/sites/6/What-Is-Slack-Ebook-GB.pdf#page=11)
- Slack《What Is Slack? An Enterprise Guide》GB 版，©2024，PDF 第 11 頁 #project-beta；畫面 build 未標。
- [Slack 官方快捷鍵：首則未讀與最新訊息是兩個動作](https://slack.com/help/articles/115003340723-Navigate-Slack-with-your-keyboard)
- [育伴港固定版本：聊天頁接上實際時間線](https://github.com/2NTTY/child-ai-caregiver/blob/86a68b787af90fbe2379247f13030125b1804742/frontend/src/screens/chatScreen.tsx#L246-L250)
- 只連結 Slack 原始文件，不封裝或轉載圖像、商標及示例訊息。

## 驗證

88 題、179 選項、102 外部參考；原 87 題資料與 146 張既有圖片不變。靜態驗證、模擬 DOM 的雙欄選取／來源複製／清除、主題搜尋既有案例均通過。未執行真瀏覽器；沒有測試聊天產品功能。Stream 操作原圖不是 Telegram 畫面。

- HTML SHA-256: `c5d5233fb63603b14b9ea0aa369980279cb70efe45fa5eaa93caad7139e0a916`
- HTML bytes: 31018911
- 基準 SHA-256: `51a1a6ce1c8a476280f699368d0b8432c71210759ed2a9ab7632a1f67bca0866`
