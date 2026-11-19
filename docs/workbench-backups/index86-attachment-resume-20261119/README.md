# 第 72 題｜家庭附件上傳中斷：已存好，還是要找回原檔？

假設有附件寫入權的家長，在孩子的家庭共享空間上傳自製的「運動日清單.pdf」，畫面中斷，不知道有沒有存好。回到同一空間和孩子，若原上傳紀錄仍在，先查那一次。確認已保存便不用重傳；只留了位置、尚欠檔案，才選回同一原件。同名但改過內容的檔案不能接續。仍未查清就不當作成功，也不另開一份。育伴港不保證重開或換機後仍有紀錄，也不承諾續傳位元組；工作台不讀檔或上傳。

## 兩個原作者的畫面

**附件接續-01｜Egnyte：先看同一份傳送是否已完成。** 先打開上傳中心，找回正在處理的項目。主圖把這一列的失敗／重試與下方另一筆已上傳的紀錄分開。輔圖同時看見等候、傳送中與已上傳。原圖的失敗原因是空間不足，不是斷線；兩張亦不是同一份檔的前後畫面。可參考的是怎樣區分已完成和尚待處理，不是用同名或百分比代替育伴港查回原上傳。

[看 Egnyte 原圖：上傳失敗及最近完成的完整頁面（需連網）](https://helpdesk.egnyte.com/hc/article_attachments/37332003957901)。[Egnyte 第二張原圖：等候、傳送中與已上傳分開](https://helpdesk.egnyte.com/hc/article_attachments/37332003954445)；[Egnyte 作者文件：Upload Center 指引](https://helpdesk.egnyte.com/hc/en-us/articles/37331359732365-Android-App-Upload-Center-User-Guide)；[Egnyte Android 8.62 版本說明](https://helpdesk.egnyte.com/hc/en-us/articles/37079943254413-Egnyte-for-Android-App-V-8-62-Redesigned-Upload-Experience-and-Support-for-Android-15)；[Egnyte 網站條款及外鏈規定](https://www.egnyte.com/website-terms-of-use)。

Egnyte Android 8.62 於 2025-06-12 引入 Upload Center；作者指引的確切畫面 build、裝置及拍攝日期未列。 Egnyte 官方原圖。網站條款限制複製、再發布及鏡像；僅連原圖、作者文件和版本說明，不嵌入或改畫。

**附件接續-02｜React Upload console：在原來那一筆找回原檔。** 看頁面上方的中斷項目：原本的檔案名稱、已保存進度和「重新選回原檔」放在一起。下方是另一個新增檔案入口。可參考的是怎樣把『繼續這一筆』與『開一筆新傳送』分開。作者的示範支援重開與部分續傳，不是育伴港的能力證明；圖中也沒顯示檔案選擇器或完成收據。

[看 React Upload console 原圖：重新選回原件及獨立新上傳區（需連網）](https://raw.githubusercontent.com/moneychaudhary/presigned-multipart-upload/887dd16b3c75c4a90a4d6b0cbd8d014224350f0a/playground/screenshots/resume-after-reload.png)。[作者文件：重載後續傳及重選條件](https://github.com/moneychaudhary/presigned-multipart-upload/blob/887dd16b3c75c4a90a4d6b0cbd8d014224350f0a/README.md#resume-after-a-reload)；[作者版本 v0.1.1](https://github.com/moneychaudhary/presigned-multipart-upload/releases/tag/v0.1.1)；[固定版 MIT 授權](https://raw.githubusercontent.com/moneychaudhary/presigned-multipart-upload/887dd16b3c75c4a90a4d6b0cbd8d014224350f0a/LICENSE)。

moneychaudhary 的 React 示範；v0.1.1 提交 887dd16，2026-10-30 UTC。截圖日期、瀏覽器及作業系統版本未列。 作者倉庫軟件及文件採 MIT；這次只連原圖及文件，不嵌入或改畫。

## 現行 master 的依據
 
透過 GitHub connector 讀取 master，釘選 [ae32af38308b2f70fd100faa5c1d4db47268fdad／PR #687](https://github.com/2NTTY/child-ai-caregiver/commit/ae32af38308b2f70fd100faa5c1d4db47268fdad)。以下是逐檔閱讀，不是瀏覽器、網絡或上傳實測。
 
1. [家庭共享附件庫的實際入口](https://github.com/2NTTY/child-ai-caregiver/blob/ae32af38308b2f70fd100faa5c1d4db47268fdad/frontend/src/production/PhotoInputDomains.tsx#L466-L476)及[附件庫分頁與私人處理界線](https://github.com/2NTTY/child-ai-caregiver/blob/ae32af38308b2f70fd100faa5c1d4db47268fdad/frontend/src/components/photos/PhotosView.tsx#L94-L117)：共享範圍的資料屬來源空間；必須有 attachments 模組，非 viewer 才提供這個上傳入口。私人照片編輯、辨識和家庭共享確認是另一個工作流，不代入。
2. [作用範圍及查上一次上傳](https://github.com/2NTTY/child-ai-caregiver/blob/ae32af38308b2f70fd100faa5c1d4db47268fdad/frontend/src/production/FamilyLibraryUpload.tsx#L12-L51)：顯示指定空間及孩子，須連線、分享依據有效、角色 owner 或 caregiver；有原操作時，查的是其原 opId。ready 才清除原參照、顯示存好並刷新；reserved 則提示「預留已保存。請選回同一原件繼續上傳」。其他未明狀態標作待查。回到本範圍且仍有原參照時也會先查；[「查回原上傳」、選錯原檔、格式、失權及未找到所顯示的不同提示](https://github.com/2NTTY/child-ai-caregiver/blob/ae32af38308b2f70fd100faa5c1d4db47268fdad/frontend/src/production/FamilyLibraryUpload.tsx#L52-L82)。查結果不是重新上傳。
3. [同一原件的核對及同一操作編號](https://github.com/2NTTY/child-ai-caregiver/blob/ae32af38308b2f70fd100faa5c1d4db47268fdad/frontend/src/production/family-library-upload.ts#L20-L53)：核對種類、檔名、長度、媒體類型及內容摘要；不符會提示選回原件，保留原操作，不因檔名相同便接受。文件已 ready 時不再上傳；reserved 才傳內容。這裡的「接續」指原來的一次保存，不代表從已傳位元組繼續；沒有證據支持百分比、多任務佇列、任意改用另一裝置、離線排程或持久化跨重開恢復。[工作範圍內的記憶中參照](https://github.com/2NTTY/child-ai-caregiver/blob/ae32af38308b2f70fd100faa5c1d4db47268fdad/frontend/src/production/ProductionOwner.ts#L55-L63)。其他產品的歷史中心可作閱讀參考，不應報成育伴港已有完整傳送中心。

## 版本及必要驗證

- 私用離線檔：`育伴港選配工作台-72主題-家庭附件上傳接續-20261119.html`；30,967,079 bytes；SHA-256 `17a33f1daa909fccf1042119717ca3144e364b9d00711d4ddfe5d8c2550d16d2`。直接基準為第 71 題（`e6ab09edb986327436ef0ca95e0ec795005df39cc738772303e00d990adf4810`），先修摘錄、再加題，中間修正版 SHA-256 `deb63117210ef2292ae68907e805ff12154b33616c6cc46c43ece1736aa90183`。

- 72 題、147 款。此前 71 題原紀錄及 146 張圖檔未變。第 72 題僅連原作者整頁畫面、說明與版本，無新增內嵌圖、背景請求或業務操作。

- 修正「複製已選方案」只帶第一張圖的問題：已選外鏈保留原始主連結、可用的具名補充來源與既有版本。改選或撤選會移除原來選項的來源；未變更離線方案摘錄。

- 校對原圖與作者說明；驗證舊 71 題結構保留、圖片逐張雜湊、CSP／JS 語法及不連網閱讀器的導覽、比較、選擇與摘要。未做真機／瀏覽器驗收、上傳實測或操作家庭資料。本分支只有文字備份，沒有上傳原圖、建立 PR、合併或發布網站。
