# 第 61 題｜照顧交接：家人有沒有親自確認收到提示？

假設小晴下午要人接，家人想先查一件事：「接送提示交給哪個渠道？負責接送的人有沒有親自確認收到？」渠道接受、收件人確認、孩子已接到，是三件不同的事。就算已有本人回執，家人仍要回到原待辦查看接送是否完成。小晴和接送安排是虛構例子；工作台只選設計，不會聯絡任何家庭。

## 在育伴港可以查到甚麼？

依據 [master 固定修訂 3c02633](https://github.com/2NTTY/child-ai-caregiver/commit/3c02633a4160f097732c4b56812cb882e54de48b) 的前置源碼查核；以下不是本次在瀏覽器操作或模擬投遞得出的結果。

1. 先選孩子，到「聯絡」頁的「聯絡及收到紀錄」。[先前的聯絡授權和事後的聯絡紀錄是兩個區塊](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/components/contact/ContactView.tsx#L81-L88)。清單先列原任務、首次聯絡或一次跟進、狀態及時間；展開才看本次向誰、用甚麼渠道、結果如何。[紀錄及原任務入口](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/components/contact/ContactHistory.tsx#L15-L37)。只能按已載入的紀錄判斷；若有上限，只涵蓋最近 50 個請求。沒列出，不等於從未嘗試；「結果未知」也不等於已拒絕。
2. 渠道接受處理，不證明家人讀過或答應接送。只有該次紀錄指名的收件帳戶符合[接收者、未確認及嘗試狀態等條件](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/contact-view-model.ts#L47-L52)，而且[有相應權限、資料已載入及可編輯](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/production/useProductionContact.ts#L55-L70)，才能先勾選、再按「確認本人已收到提示」。可查閱不等於能代別人確認；渠道接受也不是本人確認的必要前一步，結果未知時有可能由本人補確認。
3. [保存這一次回執，再重新讀取](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/production/useProductionContact.ts#L76-L85)後才顯示成功。回執只回答「我收到提示」，不代表「我已接到孩子」。[查看原任務會帶入該項待辦](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/screens/ContactScreen.tsx#L10-L16)。這裡不補發訊息。第 33 題是事前授權，第 41 題是查通知內容，第 59 題是安排分工；這次問的是聯絡之後，有甚麼證據顯示收件人親自確認。

## 兩款原圖與取捨

**交接-01｜Apple 訊息：把渠道結果放在對應的那一則旁。** 看原投影片右側的整個 iPhone 畫面：前面雖然有來有回，但最後一則藍色訊息下面只有 Delivered，之後沒有對方回覆。可借這個位置，把「渠道已接受」放在爸爸那一次提示旁，另列「本人尚未確認」。不要照譯成「已送到爸爸手機」：育伴港的渠道接受比 Apple 圖中的 Delivered 更有限。即使有一般已讀標記，也不是爸爸主動確認。 [看 Apple 原投影片 PDF 第 6 頁，右側完整手機畫面（需連網）](https://devstreaming-cdn.apple.com/videos/wwdc/2016/204t23fvanrkj7a1oj7/204/204_imessage_apps_and_stickers_part_1.pdf#page=6)。[Apple 官方說明：Delivered 與 Read 的分別](https://support.apple.com/guide/iphone/turn-read-receipts-on-or-off-iph5e713a045/ios)。

Apple WWDC 2016，Session 204，第 6 頁（封面算第 1 頁），iOS 10 世代示範；不是現版畫面，也不是育伴港的多渠道紀錄。© 2016 Apple Inc.；原簡報限制再分發及公開展示。只提供作者原 PDF 的文字連結，不截取、內嵌或鏡像。

**交接-02｜PagerDuty：本人先回覆，系統才顯示已確認。** 看收件人一側：提示先列出幾個選項，收件人發出代表確認的數字，系統才回覆已確認。畫面沒有顯示事件已解決。育伴港可用直白的「我已收到這則提示」，讓爸爸先認清是哪項接送；待確認成功，才顯示本人及確認時間。借的是這個先後次序，不是要求家人以短訊回數字，也不是替他按「接送完成」。 [看 PagerDuty 教程的完整短訊對話原圖（需連網）](https://files.readme.io/9ce928131333de43980325f9bad1fed28281b9efc7162ec7725b5b47d4587d00-acknowledge_incident.webp)。[PagerDuty 官方教程：Respond to an SMS Notification](https://docs.pagerduty.com/incident-management/notifications#respond-to-an-sms-notification)。

PagerDuty 官方短訊教程的 iPhone 畫面，從對話標題到鍵盤均保留；未標明截圖日期及 App 版本，不是兒童接送產品。PagerDuty 官方文件保留權利，未核實這張截圖可以轉載；只連教程及其圖檔，不內嵌、不鏡像。

**怎樣選？** 若家長打開畫面是為了問「爸爸有沒有親自確認」，我會先選交接-02：它讓人看見，收件人要有一個明確動作，才會出現回執。若現時最大的誤會是把所有「已接受」都看成家人已讀，就先選交接-01，把每次提示的渠道結果標在正確位置。兩者都是跨產品的設計參考，不引入 Apple 的送達承諾、PagerDuty 的短訊指令、升級、重發或身分驗證。工作台選的是一款畫面，不代任何人確認。

[Apple 網站條款](https://www.apple.com/legal/internet-services/terms/site.html)與 [PagerDuty 網站條款](https://www.pagerduty.com/website-terms-of-use/)不視為轉載許可。2026-11-19 的來源預檢目視了 Apple 原投影片的完整手機示範及 PagerDuty 教程的完整對話原圖。兩者皆無須登入；工作台僅在讀者點選後才開啟原站。

## 交付檔與驗證

- 私用 HTML：`育伴港選配工作台-61主題-照顧交接回執外鏈版-20261119.html`，30,920,234 bytes，SHA-256 `90afafe85b9e1b1fd1c626ef7688c39233e40a283f1049f796ab8a5c8aec0bb0`。第 60 題的已交付基準為 `225ba819befb03e68c26b56f0e90929c7796a8687a2b4490a454604bc7b8135a`。
- 共 61 題、125 款：77 款離線、48 款外鏈。從新版資料區移除第 61 題新增的位元組，即可逐位元組還原前版完整資料區；146 張舊圖均經解碼、逐張核對 SHA-256。新題只有兩個主要原圖及 2 個補充連結，沒有新增任何內嵌圖片或遠端自動載入。
- 靜態、CSP 雜湊與 JavaScript 語法通過；離線 VM 通過 51 組檢查，包括全 61 題單看／並看、新題連結、選取／改選／撤回、摘要往返、保留舊選擇、焦點狀態及末頁邊界。VM 只模擬工作台閱讀器，不會開原站。沒有瀏覽器、真機、實際發送、收件確認或接送回報測試；沒有聯絡任何家庭、變更育伴港或發布預覽。
