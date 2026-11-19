# 第 70 題｜一起改幾個孩子的待辦：停止後，哪些已經改好？

假設你已確認替三個孩子把「交活動回條」改至星期五，處理中卻沒再收到回覆。你想叫停的是**剩下的改期**，不是取消待辦，也不是把已經改好的日期還原。先回到發出請求的那則留言，核對同一批次的結果，不要再發一遍改期請求。

| 如果原批次的最後結果是… | 家長可以怎樣理解？ |
| --- | --- |
| 小澄：已保存 | 這次改成了星期五；不是說小澄已交回條。 |
| 小禾：版本衝突，未保存 | 這次沒有改成。另查待辦現在的日期，不能假定它仍是之前的日期。 |
| 小桐：尚未執行便已停止 | 這次沒有改小桐的日期，原待辦仍在。 |

以上三筆是虛構例子，不是實際批次或預測數字。**問「小澄那項改了嗎？」我選 A；問「現在停會不會把小澄的也改回去？」我選 B。** 兩者只是閱讀順序不同，不是兩套停止規則。

## 兩個完整工作畫面怎樣讀？

**改期-01｜Testmo：先查每一項的結果。** 先看頂部的測試批次名稱，再看左列的編號、名稱和狀態。右側詳情屬於目前選中的那一項：可以讀到 Passed 和操作記錄。窄欄令幾個狀態只露出部分文字，不能單憑顏色猜結果。作者另說，清單顯示每項最新的測試結果；Untested 是還沒有結果，不是測試失敗。借到育伴港的是這個順序：先認出同一則改期請求，再按孩子和待辦核對已保存、衝突未存或已停止。方便回答某個孩子的日期，但要決定現在停不停，還需另讀影響說明。Passed 不是育伴港的保存收據。 [看 Testmo 官方原圖：單一測試批次的清單與所選項詳情（需連網）](https://support.testmo.com/hc/article_attachments/47566738316813)。[Testmo 作者說明：怎樣在同一批測試查每項結果及歷史](https://support.testmo.com/hc/en-us/articles/47566738338701-Tests-Test-Results)；[Testmo 權利聲明](https://www.testmo.com/about/)。

Testmo 官方《Tests & Test Results》，Viewing Tests in a Run 的桌面網頁工作畫面。未列文件日期、截圖日期、產品 build 或瀏覽器版本；圖中 Release 1.0 屬示例批次名稱，不是 Testmo 版號。 Testmo GmbH 保留權利。本題只連官方原圖和文件；未取得重發授權，不嵌入、改畫或複製圖片。

**改期-02｜Mail Merge for Gmail：先看停止會影響哪部分。** 完整 Campaigns 頁顯示 Active 分頁和具名的一列：2/10 sent 表示當時已寄出兩封，不是最後結算。在作者另一張列選單圖才見到 Stop；再看獨立的確認小圖，它說明已寄出的保留、尚未寄出的將不再寄，可選繼續或停止。確認框沒有 2/10，也沒有逐人清單。對家長有用的是決定前先分清『已改好的不還原；還沒改的不再改』，不是照搬寄信或彈窗。要知道最後哪幾個孩子改成了，仍須回原留言查同一批的結果，而不是拿剛才的數字去推算。 [看 Mail Merge for Gmail 官方原圖：Active 批次完整工作畫面（需連網）](https://documentation.merge.email/files/webapp-campaigns.png)。[另看同一列的選單原圖：Stop 在這裏](https://documentation.merge.email/files/webapp-campaigns-row-menu.png)；[另看停止前確認原圖：已寄與未寄分開說明](https://documentation.merge.email/files/webapp-campaigns-stop-dialog.png)；[作者文件：Campaigns 的狀態、停止與暫停](https://documentation.merge.email/web-app/campaigns/)；[作者辨認頁：發行方是 Qualtir](https://documentation.merge.email/help/other-mail-merge-products/)；[發行方網站條款](https://merge.email/terms-of-service)。

Qualtir 發行的 Mail Merge for Gmail 桌面 Web app，不是 Google 的 Gmail 功能。Campaigns 作者文件更新於 2026-11-10；未列介面 build、截圖日期、作業系統及瀏覽器版本。圖上示例日期不是拍攝日期。 Mail Merge for Gmail 官方文件及作者圖；發行方保留權利。只連作者頁、完整工作畫面及獨立細圖，未取得轉載授權，不嵌入、拼接或重畫。

## 套回育伴港：回到同一則留言，而不是找一個「批次中心」

本題按[固定修訂 2567253（合併 #681）](https://github.com/2NTTY/child-ai-caregiver/commit/25672533effaf4dbadae31f689af300737181d3b)閱讀原始碼及既有合成測試的內容，並未執行產品測試。

- **從原留言認出這一批。** [多孩或班級對話的範圍](https://github.com/2NTTY/child-ai-caregiver/blob/25672533effaf4dbadae31f689af300737181d3b/frontend/src/production/MixedChatConversation.tsx#L177-L186)與[符合條件才會出現的留言內批次資訊](https://github.com/2NTTY/child-ai-caregiver/blob/25672533effaf4dbadae31f689af300737181d3b/frontend/src/production/MixedChatConversation.tsx#L211-L231)不同於獨立的全站批次管理頁，也不是所有家庭成員共同閱讀的對話。這裏的「批次」是一次請求內的幾項改動。
- **先問哪一項保存了。** [原結果的查核](https://github.com/2NTTY/child-ai-caregiver/blob/25672533effaf4dbadae31f689af300737181d3b/frontend/src/production/MixedChatConversation.tsx#L87-L110)與[逐項的孩子、待辦、狀態、版本及有記錄時的原因](https://github.com/2NTTY/child-ai-caregiver/blob/25672533effaf4dbadae31f689af300737181d3b/frontend/src/production/MixedChatConversation.tsx#L111-L129)讓人分開讀。「有原操作號」不是「已保存」；沒有回應也不等於全部失敗。
- **停止不會還原已保存的日期。** [畫面按批次狀態提供操作](https://github.com/2NTTY/child-ai-caregiver/blob/25672533effaf4dbadae31f689af300737181d3b/frontend/src/production/MixedChatConversation.tsx#L131-L137)：等候確認或執行中才可要求停止；只有執行中的批次可接續仍待執行的項目。[停止只標記當時仍待執行的項目](https://github.com/2NTTY/child-ai-caregiver/blob/25672533effaf4dbadae31f689af300737181d3b/server/firestore-mixed-task-batches.ts#L103-L122)，[逐項執行與保存結果](https://github.com/2NTTY/child-ai-caregiver/blob/25672533effaf4dbadae31f689af300737181d3b/server/firestore-mixed-task-batches.ts#L133-L165)則把已保存、衝突／失敗、待執行分開。不是任選項目重試、撤銷整批、重開已停止批次，亦沒有把參考圖的確認框當作育伴港現有畫面。[既有合成測試](https://github.com/2NTTY/child-ai-caregiver/blob/25672533effaf4dbadae31f689af300737181d3b/frontend/src/production/mixed-chat-controller.test.mts#L53-L69)也說明為甚麼應查最後結果，而不是用較早看到的數字猜測哪些項目停得及。

第 44 題是管理員追查多批知識索引的進度和失敗項，第 55 題是一筆照顧記錄的版本衝突。本題只處理家長同一次改期中的結果與停止範圍，不是後台失敗清單或衝突修復教學。

## 離線版本與驗證範圍

- 私用離線 HTML：`育伴港選配工作台-70主題-多孩待辦停止範圍外鏈版-20261119.html`，30,957,796 bytes，SHA-256 `4898c19539109f5895bd0b792001ec0fd4d44e8b860bb563fe1331fcdc43c2b5`。基準為已交付的第 69 題版（30,953,158 bytes，SHA-256 `be870976024e1f47885ba8460d499745ec59037a88bb4c5bdf9937484ad647e6`），該版私用文字備份的收件修訂為 `2330d8b1dab2a6049f9874d9a4acfecb88dd7a4b`。
- 共 70 題、143 款：77 款離線、66 款外鏈。移除新增記錄後，原資料區逐位元組還原為第 69 題版。原有 146 張內嵌圖按原序逐張解碼核對 SHA-256。本題兩個完整工作畫面的原圖及七個補充連結（包括 B 的列選單與停止確認細圖）都要主動點開；沒有下載、嵌入、重畫或自動載入新圖。
- 已核對離線結構、無 DNS 預取政策、內容安全策略及 JavaScript 語法；不連網的模擬閱讀器通過 78 組檢查，覆蓋全 70 題單看／並看及新題的作者連結、無預設選擇、選取、替換、摘要返回、撤選、焦點與最後一頁的界線。
- 以上是本機組裝時的狀態，不是遠端交付收據。未做瀏覽器／真機驗收、產品建置或登入測試；沒有查閱真實家庭／學校資料、寄信、操作任何批次、變更待辦、或調用模型。此分支只備份來源和驗證文字，不含完整預覽檔或私用素材，沒有 PR、合併或公開發布。
