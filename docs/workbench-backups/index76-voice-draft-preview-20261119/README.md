# 第 62 題｜語音草稿：錄完先聽，哪一步才送出？

「明天下午三點帶畫簿。」說完才想到，自己剛才是不是說了四點？在育伴港，停下收音、把錄音放進草稿、真正把它交給助手，是三步，不是一步。例句是虛構的，沒有錄音檔。這份純文字備份只記錄如何選畫面，不是產品操作或新功能發布。

## 對應育伴港的三步

以下是[固定修訂 3c02633a](https://github.com/2NTTY/child-ai-caregiver/commit/3c02633a4160f097732c4b56812cb882e54de48b)的源碼查核，不是瀏覽器或手機實測。

1. **錄完先聽。** [錄音區在聊天輸入區內展開](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/components/agent/AgentComposer.tsx#L149-L155)，[咪高峰和聊天送出是不同按鈕](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/components/agent/AgentComposer.tsx#L163-L170)。[網頁](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/components/agent/VoiceCapture.web.tsx#L51-L62)與[原生手機](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/components/agent/VoiceCapture.tsx#L94-L105)都可在本機核對。說錯就捨棄重錄；說對才加入草稿。介面標明每段最多兩分鐘／5 MiB；網頁不能錄時可改選已錄音訊。這不是語音通話或即時聽寫。
2. **草稿仍未送出。** [未送出附件的預覽與操作](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/components/agent/AssistantAttachmentPreview.tsx#L21-L37)：可再聽原音、更換、移除，或返回草稿。錄音區的「捨棄」和附件的「移除」都發生在送出之前，不是刪除一段已傳送的訊息。
3. **按聊天「送出」才交付。** 正式聊天[先核對孩子、連線、寫入權限與草稿](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/screens/chatScreen.tsx#L103-L109)；[送出說明](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/screens/chatScreen.tsx#L307-L311)標明會保存錄音、交 AI 理解；日後補上的背景轉錄不會重新執行指令。加入草稿不表示已上傳，更不表示待辦已建立。

第 58 題是**已保存後**，從逐字稿找一句原音；第 62 題是**尚未送出**，由自己核對整段，必要時拿走。不用已送訊息的播放氣泡作草稿證據。

## 兩款原作者畫面與取捨

**草稿-01｜Telegram：讓錄音和試聽共用一個位置。** 在影片約 4.7 秒，看看對話最下方：剛才還在走的計時，現在換成垃圾桶、播放鍵和 0:03 波形；向上箭頭另放。想核對前後差異，可倒回約 3.85 秒看錄音中的狀態。同一位置換了控制，便認得哪一刻可先聽、不必送。Telegram 示範的是暫停後還可繼續錄，沒有獨立的「加入草稿」。育伴港可借用位置的連貫性，不必加上滑鎖定或放手即送。 [看 Telegram 官方短片：從約 4.7 秒看待送狀態（需連網）](https://telegram.org/file/400780400247/2/wIawukFYgP8.3215149.mp4/3c811afe4ae814968b#t=4.7)。[Telegram 功能公告：Pause and Resume Recording](https://telegram.org/blog/new-saved-messages-and-9-more#pause-and-resume-recording)。

Telegram 於 2024-01-31 發布的 iPhone 示範。畫面保留對話標題、上文及底部輸入區；不是完整手機外框，未標 App build。 只連作者影片與公告。Telegram 新聞圖庫的截圖許可不能推及這段影片、頭像或貼圖；工作台不截取或嵌入。

**草稿-02｜Google Messages：把未送錄音放在輸入欄下方。** 在官方動圖先看計時和停止鍵，再看 0:38 的波形：它還在輸入欄下方，不是聊天串中的訊息。旁邊有播放、Restart 和 Send，說錯可重來。這張 beta 示範顯示的是 Send，不是 Attach；先 Attach、再 Send 是另一份 Google 文字說明。若想直接看「已加入、還可移除」怎樣排，可看 Canvas 的撰寫對話框：Media Comment 旁有 ×，Send 仍在底部。這是通用媒體附件，不是純音訊截圖；原圖也不能證明音訊只留本機。 [看 Google Messages 官方整機動圖：留意下方 0:38 波形（需連網）](https://storage.googleapis.com/gweb-uniblog-publish-prod/original_images/130_Voice_Mood_Real_1x1_v007.gif)。[Google 發布文章第 2 項：Voice Moods 手機示範](https://blog.google/products-and-platforms/platforms/android/new-android-features-november-2023/)；[Google 說明（文字）：先 Attach，再 Send](https://support.google.com/messages/answer/6080324?hl=en)；[延伸原圖：Canvas 撰寫對話框的附件 × 及 Send](https://us.v-cdn.net/6038536/uploads/migrated/2N5NZ87P15WU/c0a63b82-bf72-4c59-87c6-2b2f0ca488f3.png)；[Canvas 官方指南：在 Inbox 加入媒體留言](https://community.instructure.com/en/en/kb/articles/662871-how-do-i-record-or-upload-media-to-a-message-in-the-inbox)。

Google 於 2023-11-30 公布的 Android beta 示範，不代表現版；Canvas 延伸圖是完整撰寫面板，不是全站畫面，未標 App build。 Google 動圖未核實可重發，只連原檔。Canvas 指南標示 CC BY-NC-SA 4.0；這裡只連 Instructure 官方指南與原圖，不內嵌或改製。

**我會先選草稿-02。** 育伴港多了一個「加入未送出草稿」的步驟。把待送錄音留在輸入區、與已送對話分開，再讓維持原位的聊天「送出」成為最後一步，家長比較容易知道還可反悔。若最常見的疑問是「現在還在錄，還是已經停了？」，草稿-01 的同位切換更有用。不照搬 Google 的 Send，也不替 Telegram 補一個不存在的加入按鈕。

原件預檢日期：2026-11-19。Telegram 約 3.85 秒與 4.73 秒可比較錄音和預覽；Google 動圖共 871 幀，以 0 為起點，第 158 幀是錄音、第 237 幀是待送。Canvas 的原圖佐證「附件可移除並另按 Send」；指南上一步的保存圖是花朵**視訊**，不是語音專用畫面。三款示範都不能證明聲音在何時傳上別家的伺服器。

只在讀者點選後開啟作者原件。[Telegram 新聞圖庫說明](https://telegram.org/press)、[Google 媒體使用指引](https://about.google/brand-resource-center/guidance/media/)、[Canvas 指南授權](https://community.instructure.com/en/en/kb/articles/662721-can-i-repurpose-content-from-the-guides-for-my-institutions-use)。不轉載作者的對話內容、音訊、頭像或畫面。

## 檔案與驗證界線

- 私用 HTML：`育伴港選配工作台-62主題-語音草稿試聽外鏈版-20261119.html`，30,924,413 bytes，SHA-256 `d91c18288fe81db612fa20e601a3367a556acd77fa0fdb79394b4ac40f062858`。61 題版已交付檔的基準為 `90afafe85b9e1b1fd1c626ef7688c39233e40a283f1049f796ab8a5c8aec0bb0`。
- 共 62 題、127 款：77 款離線、50 款外鏈。從新版資料區移除第 62 題新增的位元組，即可逐位元組還原前版完整資料區；146 張舊圖均經解碼、逐張核對 SHA-256。新題只有兩個主要作者動態示範及 5 個補充連結，沒有新增任何內嵌圖片或遠端自動載入。
- 靜態、CSP 雜湊與 JavaScript 語法通過；離線 VM 通過 54 組檢查，包括全 62 題單看／並看、新題連結、選取／改選／撤回、摘要往返、保留舊選擇、焦點狀態及末頁邊界。VM 只模擬工作台閱讀器，不會開原站。沒有瀏覽器、真機、麥克風、實際錄製、播放、上傳、傳訊、模型、TypeScript 或產品匯出測試；沒有變更育伴港或發布預覽。
